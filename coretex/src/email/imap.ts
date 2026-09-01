// Coretex — real mailbox transport. Fetches mail over IMAP (imapflow) and sends
// over SMTP (nodemailer), so a user can connect an actual account with an app
// password. Provider presets bake in the well-known endpoints; "custom" lets the
// user point at any server. Gmail, iCloud, Yahoo, and Fastmail can use app
// passwords. Exchange Online requires OAuth and is disabled in the password UI.

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type { EmailAddress, EmailMessage, EmailProvider } from "../types.js";

const MAX_MESSAGE_SOURCE_BYTES = 1024 * 1024;
const MAX_BODY_TEXT_CHARS = 200_000;
const MAX_BODY_HTML_CHARS = 400_000;

export interface MailEndpoint {
    imapHost: string;
    imapPort: number;
    imapSecure: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
}

/** Well-known IMAP/SMTP endpoints per provider. "custom" is filled in by the user. */
export const PROVIDER_PRESETS: Record<Exclude<EmailProvider, "custom">, MailEndpoint> = {
    gmail: { imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true },
    // Endpoint metadata is retained for a future OAuth transport; password-only IMAP is not offered.
    outlook: { imapHost: "outlook.office365.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecure: false },
    yahoo: { imapHost: "imap.mail.yahoo.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, smtpSecure: true },
    icloud: { imapHost: "imap.mail.me.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecure: false },
    fastmail: { imapHost: "imap.fastmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.fastmail.com", smtpPort: 465, smtpSecure: true },
};

/** Resolve the concrete endpoints for a provider, honoring any explicit overrides. */
export function resolveEndpoint(provider: EmailProvider, overrides: Partial<MailEndpoint>): MailEndpoint {
    const base: MailEndpoint = provider === "custom"
        ? { imapHost: "", imapPort: 993, imapSecure: true, smtpHost: "", smtpPort: 465, smtpSecure: true }
        : { ...PROVIDER_PRESETS[provider] };
    const imapPort = overrides.imapPort ?? base.imapPort;
    const smtpPort = overrides.smtpPort ?? base.smtpPort;
    return {
        imapHost: overrides.imapHost || base.imapHost,
        imapPort,
        imapSecure: overrides.imapSecure ?? (overrides.imapPort !== undefined ? imapPort === 993 : base.imapSecure),
        smtpHost: overrides.smtpHost || base.smtpHost,
        smtpPort,
        smtpSecure: overrides.smtpSecure ?? (overrides.smtpPort !== undefined ? smtpPort === 465 : base.smtpSecure),
    };
}

export interface ImapCredentials {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
}

function addr(a: { name?: string; address?: string } | undefined): EmailAddress {
    return { name: a?.name || a?.address || "", email: a?.address || "" };
}

function addrList(v: { value?: { name?: string; address?: string }[] } | undefined): EmailAddress[] {
    return (v?.value ?? []).filter((x) => x.address).map(addr);
}

/** Open an IMAP connection; caller must logout(). Throws a clean Error on auth/host failure. */
async function connect(creds: ImapCredentials): Promise<ImapFlow> {
    const client = new ImapFlow({
        host: creds.host,
        port: creds.port,
        secure: creds.secure,
        doSTARTTLS: creds.secure ? undefined : true,
        auth: { user: creds.user, pass: creds.pass },
        logger: false,
        // Give slow/enterprise servers room, but fail rather than hang forever.
        socketTimeout: 30_000,
    });
    client.on("error", () => { /* surfaced by the awaited call that fails */ });
    await client.connect();
    return client;
}

/** Turn IMAP/SMTP library errors into short, user-readable messages. */
export function friendlyError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/AUTHENTICATIONFAILED|Invalid credentials|auth/i.test(msg)) {
        return "Authentication failed — check the address and app password. Gmail/Yahoo/iCloud require an app-specific password, not your normal one.";
    }
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return "Could not reach the mail server — check the host name.";
    if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg)) return "Connection to the mail server timed out — check the host/port and your network.";
    if (/certificate|self.signed|TLS|SSL/i.test(msg)) return "TLS/certificate error connecting to the mail server.";
    return msg.slice(0, 240);
}

/** Verify credentials by connecting + selecting INBOX. Returns null on success or a message on failure. */
export async function testConnection(creds: ImapCredentials): Promise<string | null> {
    let client: ImapFlow | undefined;
    try {
        client = await connect(creds);
        const lock = await client.getMailboxLock("INBOX");
        lock.release();
        return null;
    } catch (err) {
        return friendlyError(err);
    } finally {
        try { await client?.logout(); } catch { /* ignore */ }
    }
}

/** Fetch the most recent `limit` messages from INBOX and map them to EmailMessage. */
export async function fetchInbox(accountId: string, creds: ImapCredentials, limit = 40): Promise<EmailMessage[]> {
    let client: ImapFlow | undefined;
    const out: EmailMessage[] = [];
    try {
        client = await connect(creds);
        const lock = await client.getMailboxLock("INBOX");
        try {
            const total = client.mailbox && typeof client.mailbox !== "boolean" ? client.mailbox.exists : 0;
            const uidValidity = client.mailbox && typeof client.mailbox !== "boolean" ? String(client.mailbox.uidValidity ?? "0") : "0";
            if (!total) return [];
            const start = Math.max(1, total - limit + 1);
            for await (const msg of client.fetch(`${start}:*`, { uid: true, flags: true, source: { maxLength: MAX_MESSAGE_SOURCE_BYTES }, size: true, internalDate: true })) {
                try {
                    if (!msg.source) continue;
                    const parsed = await simpleParser(msg.source as Buffer);
                    const text = (parsed.text ?? "").trim().slice(0, MAX_BODY_TEXT_CHARS);
                    const flags = msg.flags ?? new Set<string>();
                    const when = new Date(parsed.date ?? msg.internalDate ?? 0).getTime();
                    const messageId = `${accountId}:${uidValidity}:${msg.uid}`;
                    const html = typeof parsed.html === "string" && parsed.html
                        ? parsed.html.slice(0, MAX_BODY_HTML_CHARS)
                        : `<pre>${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))}</pre>`;
                    out.push({
                        id: messageId,
                        threadId: parsed.inReplyTo || parsed.messageId || messageId,
                        accountId,
                        from: addr(parsed.from?.value?.[0]),
                        to: addrList(parsed.to as { value?: { name?: string; address?: string }[] } | undefined),
                        cc: addrList(parsed.cc as { value?: { name?: string; address?: string }[] } | undefined),
                        subject: parsed.subject ?? "(no subject)",
                        bodyHtml: html,
                        bodyText: text || html.replace(/<[^>]+>/g, " ").slice(0, MAX_BODY_TEXT_CHARS),
                        snippet: (text || (parsed.subject ?? "")).replace(/\s+/g, " ").slice(0, 200),
                        attachments: (parsed.attachments ?? []).map((a, i) => ({
                            id: `${messageId}:att${i}`,
                            name: a.filename ?? `attachment-${i + 1}`,
                            sizeBytes: a.size ?? 0,
                            mimeType: a.contentType ?? "application/octet-stream",
                        })),
                        folder: "inbox",
                        labels: [],
                        aiCategory: null,
                        isRead: flags.has("\\Seen"),
                        isStarred: flags.has("\\Flagged"),
                        timestamp: when,
                        inReplyTo: parsed.inReplyTo ?? null,
                    });
                } catch { /* skip a message that won't parse */ }
            }
        } finally {
            lock.release();
        }
        // Newest first.
        return out.sort((a, b) => b.timestamp - a.timestamp);
    } finally {
        try { await client?.logout(); } catch { /* ignore */ }
    }
}

export interface SmtpCredentials {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    /** From header — display name + address. */
    fromName: string;
    fromEmail: string;
}

function smtpTransport(smtp: SmtpCredentials) {
    return nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        // Port 587 is explicit TLS (STARTTLS), not plaintext SMTP.
        requireTLS: !smtp.secure,
        auth: { user: smtp.user, pass: smtp.pass },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
    });
}

/** Verify the outgoing server and credentials without sending a message. */
export async function testSmtpConnection(smtp: SmtpCredentials): Promise<string | null> {
    const transport = smtpTransport(smtp);
    try {
        await transport.verify();
        return null;
    } catch (err) {
        return friendlyError(err);
    } finally {
        transport.close();
    }
}

/** Send a message over SMTP. Returns the provider message id. */
export async function sendMail(
    smtp: SmtpCredentials,
    msg: { to: string; subject: string; body: string; inReplyTo?: string | null },
): Promise<string> {
    const transport = smtpTransport(smtp);
    try {
        const info = await transport.sendMail({
            from: { name: smtp.fromName, address: smtp.fromEmail },
            to: msg.to,
            subject: msg.subject,
            text: msg.body,
            html: `<div style="white-space:pre-wrap">${msg.body.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))}</div>`,
            ...(msg.inReplyTo ? { inReplyTo: msg.inReplyTo, references: msg.inReplyTo } : {}),
        });
        if (Array.isArray(info.rejected) && info.rejected.length > 0) {
            throw new Error("The outgoing server rejected the recipient address.");
        }
        return info.messageId;
    } finally {
        transport.close();
    }
}

/** Move an INBOX message to the provider's Archive/All Mail or Trash mailbox. */
export async function moveServerMessage(creds: ImapCredentials, uid: number, destination: "archive" | "trash"): Promise<void> {
    let client: ImapFlow | undefined;
    try {
        client = await connect(creds);
        let folders = await client.list();
        const wantedFlags = destination === "archive" ? ["\\Archive", "\\All"] : ["\\Trash"];
        let target = folders.find((f) => wantedFlags.includes(f.specialUse ?? ""));
        if (!target) {
            const names = destination === "archive" ? ["Archive", "All Mail", "[Gmail]/All Mail"] : ["Trash", "Deleted Items", "Deleted Messages"];
            target = folders.find((f) => names.some((name) => f.path.toLowerCase() === name.toLowerCase()));
        }
        if (!target) {
            const path = destination === "archive" ? "Archive" : "Trash";
            await client.mailboxCreate(path);
            folders = await client.list();
            target = folders.find((f) => f.path.toLowerCase() === path.toLowerCase());
        }
        if (!target) throw new Error(`The server did not expose a ${destination} mailbox.`);

        const lock = await client.getMailboxLock("INBOX");
        try {
            const moved = await client.messageMove({ uid: String(uid) }, target.path, { uid: true });
            if (!moved) throw new Error("The message no longer exists in the inbox.");
        } finally {
            lock.release();
        }
    } finally {
        try { await client?.logout(); } catch { /* ignore */ }
    }
}

/** Mark a message read/starred on the server. Throws when the server rejects the change. */
export async function setServerFlags(creds: ImapCredentials, uid: number, patch: { isRead?: boolean; isStarred?: boolean }): Promise<void> {
    let client: ImapFlow | undefined;
    try {
        client = await connect(creds);
        const lock = await client.getMailboxLock("INBOX");
        try {
            if (patch.isRead !== undefined) {
                if (patch.isRead) await client.messageFlagsAdd({ uid: String(uid) }, ["\\Seen"], { uid: true });
                else await client.messageFlagsRemove({ uid: String(uid) }, ["\\Seen"], { uid: true });
            }
            if (patch.isStarred !== undefined) {
                if (patch.isStarred) await client.messageFlagsAdd({ uid: String(uid) }, ["\\Flagged"], { uid: true });
                else await client.messageFlagsRemove({ uid: String(uid) }, ["\\Flagged"], { uid: true });
            }
        } finally {
            lock.release();
        }
    } finally {
        try { await client?.logout(); } catch { /* ignore */ }
    }
}
