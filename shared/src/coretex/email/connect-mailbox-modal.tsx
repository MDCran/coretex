// @ts-nocheck
"use client";

// Coretex — Connect a real mailbox. Collects IMAP/SMTP credentials (with provider
// presets so the common case is just email + app password) and fires
// emailConnectImap. The Brain verifies both incoming and outgoing servers before
// it stores anything, then syncs the inbox.

import { useEffect, useState } from "react";
import { Mail01, X, Lock01, ChevronDown, InfoCircle } from "@untitledui/icons";
import type { EmailConnectInput, EmailProvider, EmailState } from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { BrandLogo } from "../ui/brand-logo";
import type { CoretexActions } from "../use-coretex";

const PROVIDERS: { value: EmailProvider; label: string; domain: string; appPass?: string; disabled?: boolean; note?: string }[] = [
    { value: "gmail", label: "Gmail / Google Workspace", domain: "google.com", appPass: "Google Account → Security → 2-Step Verification → App passwords" },
    { value: "outlook", label: "Outlook / Microsoft 365 — OAuth required", domain: "outlook.com", disabled: true, note: "Microsoft no longer accepts password-only IMAP sign-in. Coretex needs a registered OAuth desktop client before this provider can be enabled." },
    { value: "yahoo", label: "Yahoo Mail", domain: "yahoo.com", appPass: "Yahoo Account Security → Generate app password" },
    { value: "icloud", label: "iCloud Mail", domain: "icloud.com", appPass: "appleid.apple.com → Sign-In & Security → App-Specific Passwords" },
    { value: "fastmail", label: "Fastmail (paid plan)", domain: "fastmail.com", appPass: "Settings → Privacy & Security → App passwords" },
    { value: "custom", label: "Other (IMAP/SMTP)", domain: "" },
];

export const ConnectMailboxModal = ({ actions, emailState, onClose }: { actions: CoretexActions; emailState: EmailState | null; onClose: () => void }) => {
    const [provider, setProvider] = useState<EmailProvider>("gmail");
    const [email, setEmail] = useState("");
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [username, setUsername] = useState("");
    const [smtpUsername, setSmtpUsername] = useState("");
    const [advanced, setAdvanced] = useState(false);
    // Custom / override endpoints (only surfaced under "Advanced" or provider === custom).
    const [imapHost, setImapHost] = useState("");
    const [imapPort, setImapPort] = useState("993");
    const [smtpHost, setSmtpHost] = useState("");
    const [smtpPort, setSmtpPort] = useState("465");
    const [submitting, setSubmitting] = useState(false);
    const [requestId, setRequestId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const meta = PROVIDERS.find((p) => p.value === provider)!;
    const isCustom = provider === "custom";
    const showEndpoints = advanced || isCustom;
    const valid = email.trim().includes("@") && password.length > 0 && (!isCustom || (imapHost.trim() && smtpHost.trim()));

    useEffect(() => {
        const result = emailState?.connection;
        if (!requestId || !result || result.requestId !== requestId) return;
        if (result.status === "success") {
            setPassword("");
            setSubmitting(false);
            onClose();
        } else if (result.status === "error") {
            setSubmitting(false);
            setError(result.error || "The mailbox could not be connected.");
        }
    }, [emailState?.connection, onClose, requestId]);

    const connect = () => {
        if (!valid) return;
        const input: EmailConnectInput = {
            provider,
            email: email.trim(),
            name: name.trim() || undefined,
            user: username.trim() || undefined,
            smtpUser: smtpUsername.trim() || undefined,
            password,
        };
        if (showEndpoints) {
            if (imapHost.trim()) { input.imapHost = imapHost.trim(); input.imapPort = Number(imapPort) || 993; input.imapSecure = (Number(imapPort) || 993) === 993; }
            if (smtpHost.trim()) { input.smtpHost = smtpHost.trim(); input.smtpPort = Number(smtpPort) || 465; input.smtpSecure = (Number(smtpPort) || 465) === 465; }
        }
        setError(null);
        const id = actions.emailConnectImap(input);
        if (!id) {
            setError("Coretex is offline. Reconnect to the Brain and try again.");
            return;
        }
        setRequestId(id);
        setSubmitting(true);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "color-mix(in srgb, var(--c-bg, #000) 55%, transparent)" }} onMouseDown={onClose}>
            <div
                className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl shadow-2xl"
                style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3" style={{ background: "var(--sidebar-bg)", borderBottom: "1px solid var(--c-border)" }}>
                    <span className="flex items-center gap-2 text-sm font-semibold text-primary">
                        <Mail01 className="size-4 text-brand-secondary" /> Connect a mailbox
                    </span>
                    <button type="button" onClick={onClose} className="rounded p-1 text-quaternary transition hover:text-secondary"><X className="size-4" /></button>
                </div>

                <div className="flex flex-col gap-3 p-4">
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-secondary">Provider</span>
                        <div className="flex items-center gap-2">
                            <BrandLogo domain={meta.domain || "mail.com"} name={meta.label} size={26} />
                            <div className="min-w-0 flex-1">
                                <NativeSelect
                                    options={PROVIDERS.map((p) => ({ label: p.label, value: p.value, disabled: p.disabled }))}
                                    value={provider}
                                    onChange={(e) => setProvider(e.target.value as EmailProvider)}
                                />
                            </div>
                        </div>
                    </label>

                    {meta.note && (
                        <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-[11px] leading-snug text-warning-primary" style={{ background: "color-mix(in srgb, var(--color-warning-500, #f79009) 10%, transparent)" }}>
                            <InfoCircle className="mt-px size-3.5 shrink-0" /> {meta.note}
                        </div>
                    )}

                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-secondary">Email address</span>
                        <Input value={email} onChange={setEmail} type="email" placeholder="you@example.com" size="sm" />
                    </label>

                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-secondary">Display name <span className="text-quaternary">(optional)</span></span>
                        <Input value={name} onChange={setName} placeholder="Your name" size="sm" />
                    </label>

                    <label className="flex flex-col gap-1">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-secondary"><Lock01 className="size-3" /> {isCustom || provider === "outlook" ? "Password" : "App password"}</span>
                        <Input value={password} onChange={setPassword} type="password" placeholder="•••• •••• •••• ••••" size="sm" />
                        {meta.appPass && (
                            <span className="flex items-start gap-1 text-[11px] leading-snug text-quaternary">
                                <InfoCircle className="mt-px size-3 shrink-0" />
                                Use an <span className="font-medium text-tertiary">app password</span>, not your normal one: {meta.appPass}.
                            </span>
                        )}
                    </label>

                    {!isCustom && (
                        <button type="button" onClick={() => setAdvanced((v) => !v)} className="flex w-fit items-center gap-1 text-xs font-medium text-brand-secondary">
                            <ChevronDown className={`size-3.5 transition-transform ${advanced ? "rotate-180" : ""}`} /> Advanced (server settings)
                        </button>
                    )}

                    {showEndpoints && (
                        <div className="grid grid-cols-2 gap-2 rounded-lg p-2.5" style={{ background: "var(--surface-2)" }}>
                            <label className="col-span-2 flex flex-col gap-1">
                                <span className="text-[11px] font-medium text-secondary">IMAP login username <span className="text-quaternary">(defaults to email address)</span></span>
                                <Input value={username} onChange={setUsername} placeholder={email.trim() || "you@example.com"} size="sm" />
                            </label>
                            <label className="col-span-2 flex flex-col gap-1">
                                <span className="text-[11px] font-medium text-secondary">SMTP login username <span className="text-quaternary">(defaults to IMAP username)</span></span>
                                <Input value={smtpUsername} onChange={setSmtpUsername} placeholder={username.trim() || email.trim() || "you@example.com"} size="sm" />
                            </label>
                            <label className="col-span-2 flex flex-col gap-1">
                                <span className="text-[11px] font-medium text-secondary">IMAP host (incoming)</span>
                                <Input value={imapHost} onChange={setImapHost} placeholder="imap.example.com" size="sm" />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-[11px] font-medium text-secondary">IMAP port</span>
                                <Input value={imapPort} onChange={setImapPort} type="number" placeholder="993" size="sm" />
                            </label>
                            <div />
                            <label className="col-span-2 flex flex-col gap-1">
                                <span className="text-[11px] font-medium text-secondary">SMTP host (outgoing)</span>
                                <Input value={smtpHost} onChange={setSmtpHost} placeholder="smtp.example.com" size="sm" />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-[11px] font-medium text-secondary">SMTP port</span>
                                <Input value={smtpPort} onChange={setSmtpPort} type="number" placeholder="465" size="sm" />
                            </label>
                            <p className="col-span-2 text-[10px] leading-snug text-quaternary">Connections are encrypted: ports 993/465 use direct TLS; other ports must negotiate STARTTLS.</p>
                        </div>
                    )}

                    {error && (
                        <div role="alert" className="rounded-lg px-3 py-2 text-xs text-error-primary" style={{ background: "color-mix(in srgb, var(--color-error-500, #f04438) 10%, transparent)" }}>
                            {error}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderTop: "1px solid var(--c-border)" }}>
                    <span className="text-[11px] text-quaternary">Incoming and outgoing access are verified before the credential is saved.</span>
                    <div className="flex items-center gap-2">
                        <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                        <Button size="sm" color="primary" iconLeading={Mail01} isDisabled={!valid} isLoading={submitting} onClick={connect}>Connect</Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
