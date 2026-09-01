// Coretex — email module. Real accounts use IMAP/SMTP; a seed inbox keeps the
// UI and categorizer demonstrable until a mailbox is connected. Account config,
// cached mail, categories, and sorter settings persist to email.json. Passwords
// are handled separately by ConfigStore and are never placed in this file.

import path from "node:path";
import type {
    EmailAccount,
    EmailAgentConfig,
    EmailCategory,
    EmailFolder,
    EmailMessage,
    EmailConnectionStatus,
    EmailSendStatus,
    EmailSortDecision,
    EmailState,
} from "../types.js";
import type { LLMHub } from "../llm/hub.js";
import { readProtectedJson, writeProtectedJson } from "../security/protected-file.js";

const DEFAULT_CATEGORIES: EmailCategory[] = [
    { id: "important", name: "Important", color: "#ef4444", emoji: "🔥", icon: "Star01" },
    { id: "financial", name: "Financial", color: "#22c55e", emoji: "💰", icon: "CurrencyDollarCircle" },
    { id: "career", name: "Career", color: "#3b82f6", emoji: "💼", icon: "Briefcase01" },
    { id: "newsletter", name: "Newsletter", color: "#8b5cf6", emoji: "📰", icon: "Announcement01" },
    { id: "personal", name: "Personal", color: "#ec4899", emoji: "👤", icon: "User01" },
    { id: "promotions", name: "Promotions", color: "#f59e0b", emoji: "🏷️", icon: "Tag01" },
    { id: "spam", name: "Spam", color: "#667085", emoji: "🚫", icon: "SlashCircle01" },
];
/** Default Untitled UI icon per built-in category id (backfilled onto older stored categories). */
const DEFAULT_CATEGORY_ICONS: Record<string, string> = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.id, c.icon as string]));

const DEFAULT_AGENT: EmailAgentConfig = {
    enabled: true,
    backend: "ollama",
    model: "llama3.1:latest",
    systemPrompt:
        "You are an email categorization AI. Analyze the sender, subject, and body preview of each email and assign it to exactly one category from the list. Return ONLY the category name, nothing else.",
    autoSortOnReceive: true,
    sortBatch: 25,
    confidenceThreshold: 60,
};

function mins(n: number): number {
    return Date.now() - n * 60_000;
}

/** Realistic seed mail so the client + categorizer are demonstrable offline. */
function seedMessages(): EmailMessage[] {
    const mk = (
        id: string,
        fromName: string,
        fromEmail: string,
        subject: string,
        snippet: string,
        ts: number,
        opts: Partial<EmailMessage> = {},
    ): EmailMessage => ({
        id,
        threadId: id,
        accountId: "acct_demo",
        from: { name: fromName, email: fromEmail },
        to: [{ name: "You", email: "demo@example.test" }],
        cc: [],
        bcc: [],
        subject,
        bodyHtml: `<p>${snippet}</p><p>Best,<br/>${fromName}</p>`,
        bodyText: `${snippet}\n\nBest,\n${fromName}`,
        snippet,
        attachments: [],
        folder: "inbox",
        labels: [],
        aiCategory: null,
        isRead: false,
        isStarred: false,
        timestamp: ts,
        inReplyTo: null,
        ...opts,
    } as EmailMessage);

    return [
        mk("m1", "Stripe", "receipts@stripe.com", "Your invoice for May is ready", "Your monthly subscription invoice of $49.00 has been charged to your card ending 4242.", mins(12)),
        mk("m2", "Sarah Chen", "sarah.chen@acme.io", "Re: Q3 roadmap review — can we move to Thursday?", "Hey, something came up on Wednesday. Could we push the roadmap review to Thursday 2pm instead?", mins(48), { isStarred: true }),
        mk("m3", "GitHub", "noreply@github.com", "[coretex] CI failed on main", "The workflow 'build-and-test' failed on commit a1b2c3d. 2 jobs failed: typecheck, e2e.", mins(90)),
        mk("m4", "LinkedIn", "jobs-noreply@linkedin.com", "5 new jobs for 'Senior TypeScript Engineer'", "Based on your profile, here are new roles: Staff Engineer at Vercel, Senior FE at Linear...", mins(200), { isRead: true }),
        mk("m5", "The Pragmatic Engineer", "gergely@pragmaticengineer.com", "Issue #214: How AI is changing code review", "This week: a deep dive into how teams are restructuring code review around AI assistants.", mins(320), { isRead: true }),
        mk("m6", "Chase Bank", "alerts@chase.com", "Your statement is available", "Your monthly checking account statement is now available to view online. Balance: $8,412.55.", mins(700)),
        mk("m7", "Mom", "demo@example.test", "Dinner Sunday?", "Are you free for dinner this Sunday? Your sister is coming too. Let me know!", mins(1100), { isStarred: true }),
        mk("m8", "Notion", "team@makenotion.com", "🎁 50% off Notion AI this week only", "Upgrade to Notion AI and save 50%. Limited-time offer ends Friday. Don't miss out!", mins(1500)),
        mk("m9", "Recruiter @ Anthropic", "talent@anthropic.com", "Opportunity: Member of Technical Staff", "Your background in agent systems caught our eye. Would you be open to a quick chat about a role?", mins(1900)),
        mk("m10", "AWS Billing", "no-reply-aws@amazon.com", "AWS bill: $312.48 due", "Your AWS account incurred $312.48 in charges this month, primarily EC2 and S3. Payment due June 3.", mins(2600)),
        mk("m11", "Postmark", "support@postmarkapp.com", "Suspicious sign-in blocked", "We blocked a sign-in attempt from an unrecognized device in Lagos, Nigeria. Was this you?", mins(3300)),
        mk("m12", "Figma", "updates@figma.com", "New in Figma: AI-powered layout", "We just shipped AI-powered auto layout suggestions. Here's how to try them in your files.", mins(4000), { isRead: true }),
    ];
}

export class EmailStore {
    private messages: EmailMessage[] = seedMessages();
    private categories: EmailCategory[] = DEFAULT_CATEGORIES.slice();
    private agent: EmailAgentConfig = { ...DEFAULT_AGENT };
    private sortLog: EmailSortDecision[] = [];
    private sorting = false;
    private sortProgress: { done: number; total: number } | undefined;
    private connection: EmailConnectionStatus | undefined;
    private sending: EmailSendStatus | undefined;
    private accounts: EmailAccount[] = [{ id: "acct_demo", email: "demo@example.test", name: "Demo Inbox", avatar: "", connected: false, kind: "demo" }];
    private readonly file: string;
    private saveQueue: Promise<void> = Promise.resolve();
    /** Cap on cached messages persisted to disk (a local mail cache, newest kept). */
    private static readonly CACHE_CAP = 250;

    constructor(dataDir: string) {
        this.file = path.join(dataDir, "email.json");
    }

    /** Load persisted agent config + categories + sort log + accounts + cached mail. */
    async load(): Promise<void> {
        let migrate = false;
        try {
            const loaded = await readProtectedJson<Partial<{
                categories: EmailCategory[];
                agent: EmailAgentConfig;
                sortLog: EmailSortDecision[];
                accounts: EmailAccount[];
                messages: EmailMessage[];
            }>>(this.file);
            const raw = loaded.value;
            migrate = loaded.needsMigration;
            if (Array.isArray(raw.categories) && raw.categories.length > 0) {
                // Backfill Untitled UI icons onto older stored categories that predate the icon field.
                this.categories = raw.categories.map((c) => (c.icon ? c : { ...c, icon: DEFAULT_CATEGORY_ICONS[c.id] }));
            }
            if (raw.agent) this.agent = { ...DEFAULT_AGENT, ...raw.agent };
            if (Array.isArray(raw.sortLog)) this.sortLog = raw.sortLog;
            if (Array.isArray(raw.accounts) && raw.accounts.length > 0) {
                // Never trust a persisted "syncing" flag across a restart.
                this.accounts = raw.accounts.map((a) => ({ ...a, kind: a.kind ?? "demo", syncing: false }));
            }
            // A real account must never inherit the demo inbox, including when its cache is empty.
            if (Array.isArray(raw.messages) && this.accounts.some((a) => a.kind === "imap")) {
                const realCached = raw.messages.filter((m) => m.accountId !== "acct_demo");
                this.messages = realCached;
            } else if (this.accounts.some((a) => a.kind === "imap")) {
                this.messages = [];
            }
        } catch {
            /* first run */
        }
        if (migrate) await this.save();
    }

    /** Whether at least one real (IMAP) mailbox is connected. */
    hasRealAccount(): boolean {
        return this.accounts.some((a) => a.kind === "imap");
    }

    getAccount(id: string): EmailAccount | undefined {
        return this.accounts.find((a) => a.id === id);
    }

    getMessage(id: string): EmailMessage | undefined {
        return this.messages.find((m) => m.id === id);
    }

    /** Add (or replace) a real IMAP account. The first real account retires the demo inbox. */
    async addImapAccount(account: EmailAccount): Promise<void> {
        // First real mailbox: drop the demo account + its seed mail.
        if (!this.hasRealAccount()) {
            this.accounts = this.accounts.filter((a) => a.kind !== "demo");
            this.messages = this.messages.filter((m) => m.accountId !== "acct_demo");
        }
        this.accounts = [...this.accounts.filter((a) => a.id !== account.id), { ...account, kind: "imap" }];
        await this.save();
    }

    /** Patch an account's live status (syncing / lastSync / error / connected). */
    async setAccountState(id: string, patch: Partial<EmailAccount>): Promise<void> {
        this.accounts = this.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a));
        await this.save();
    }

    /** Replace all cached messages for an account with a freshly-synced set (preserving local AI categories). */
    async setAccountMessages(accountId: string, incoming: EmailMessage[]): Promise<void> {
        // Keep local AI categories, but treat server read/star flags as authoritative.
        const prev = new Map(this.messages.filter((m) => m.accountId === accountId).map((m) => [m.id, m]));
        const merged = incoming.map((m) => {
            const old = prev.get(m.id);
            return old ? { ...m, aiCategory: old.aiCategory } : m;
        });
        // Keep sent/draft items we hold locally for this account, plus every other account's mail.
        const localSent = this.messages.filter((m) => m.accountId === accountId && m.folder !== "inbox");
        const locallyMovedIds = new Set(localSent.map((m) => m.id));
        const others = this.messages.filter((m) => m.accountId !== accountId);
        this.messages = [...others, ...localSent, ...merged.filter((m) => !locallyMovedIds.has(m.id))];
        await this.save();
    }

    /** Remove a connected mailbox account (and its cached mail). */
    async removeAccount(id: string): Promise<void> {
        this.accounts = this.accounts.filter((a) => a.id !== id);
        this.messages = this.messages.filter((m) => m.accountId !== id);
        // If nothing is left, restore the demo inbox so the module stays demonstrable.
        if (this.accounts.length === 0) {
            this.accounts = [{ id: "acct_demo", email: "demo@example.test", name: "Demo Inbox", avatar: "", connected: false, kind: "demo" }];
            this.messages = seedMessages();
        }
        await this.save();
    }

    state(): EmailState {
        return {
            accounts: this.accounts.slice(),
            messages: this.messages.slice().sort((a, b) => b.timestamp - a.timestamp),
            categories: this.categories.slice(),
            agent: { ...this.agent },
            sortLog: this.sortLog.slice(0, 100),
            sorting: this.sorting,
            sortProgress: this.sortProgress,
            connection: this.connection,
            sending: this.sending,
        };
    }

    setConnectionStatus(status: EmailConnectionStatus): void {
        this.connection = status;
    }

    setSendStatus(status: EmailSendStatus): void {
        this.sending = status;
    }

    /** Apply read/star flags locally; returns the affected message (so the caller can mirror to the server). */
    setFlags(id: string, patch: { isRead?: boolean; isStarred?: boolean }): EmailMessage | undefined {
        const m = this.messages.find((x) => x.id === id);
        if (!m) return undefined;
        if (patch.isRead !== undefined) m.isRead = patch.isRead;
        if (patch.isStarred !== undefined) m.isStarred = patch.isStarred;
        void this.save();
        return m;
    }

    async move(id: string, folder?: EmailFolder, category?: string | null): Promise<void> {
        const m = this.messages.find((x) => x.id === id);
        if (!m) return;
        if (folder) m.folder = folder;
        if (category !== undefined) m.aiCategory = category;
        await this.save();
    }

    /** Append a sent message to the local Sent folder. Attributed to the primary account. */
    async send(to: string, subject: string, body: string, accountId?: string): Promise<void> {
        const primary = this.accounts.find((a) => a.kind === "imap" && (!accountId || a.id === accountId)) ?? this.accounts[0];
        const id = `sent_${Date.now().toString(36)}`;
        this.messages.unshift({
            id,
            threadId: id,
            accountId: primary?.id ?? "acct_demo",
            from: { name: primary?.name || "You", email: primary?.email || "demo@example.test" },
            to: [{ name: to, email: to }],
            cc: [],
            bcc: [],
            subject,
            bodyHtml: `<p>${body.replace(/\n/g, "<br/>")}</p>`,
            bodyText: body,
            snippet: body.slice(0, 120),
            attachments: [],
            folder: "sent",
            labels: [],
            aiCategory: null,
            isRead: true,
            isStarred: false,
            timestamp: Date.now(),
            inReplyTo: null,
        } as EmailMessage);
        await this.save();
    }

    async setAgent(patch: Partial<EmailAgentConfig>): Promise<void> {
        this.agent = { ...this.agent, ...patch };
        await this.save();
    }

    async setCategories(categories: EmailCategory[]): Promise<void> {
        this.categories = categories;
        await this.save();
    }

    /** Run the AI categorizer over uncategorized inbox mail via the LLM hub. */
    async categorize(hub: LLMHub, onProgress: (state: EmailState) => void): Promise<void> {
        if (this.sorting) return;
        const targets = this.messages.filter((m) => m.folder === "inbox" && !m.aiCategory).slice(0, this.agent.sortBatch);
        this.sorting = true;
        this.sortProgress = { done: 0, total: targets.length };
        onProgress(this.state());

        const catList = this.categories.map((c) => c.name).join(", ");
        // Inject the user's recent corrections as few-shot guidance so the sorter "learns" what they want.
        const corr = (this.agent.corrections ?? []).slice(-8);
        const corrHint = corr.length
            ? "\n\nLearn from these user corrections — mail like these belongs in the stated category:\n" + corr.map((c) => `- From "${c.from}" / "${c.subject.slice(0, 60)}" → ${c.category}`).join("\n")
            : "";
        // Threshold is a percentage (0-100); mail the model is less sure about than this is
        // left uncategorized for manual review. A model that doesn't report a number is treated
        // as confident so behavior is unchanged for backends that ignore the format hint.
        const threshold = this.agent.confidenceThreshold ?? 0;
        for (const m of targets) {
            try {
                const res = await hub.complete(this.agent.backend, {
                    model: this.agent.model,
                    temperature: 0,
                    maxTokens: 24,
                    messages: [
                        { role: "system", content: `${this.agent.systemPrompt}\n\nCategories: ${catList}.${corrHint}\n\nReply with the single best category name, then a vertical bar and your confidence 0-100. Example: "Work | 90".` },
                        { role: "user", content: `From: ${m.from.name} <${m.from.email}>\nSubject: ${m.subject}\nPreview: ${m.snippet.slice(0, 500)}` },
                    ],
                });
                const [catPart, confPart] = res.content.split("|");
                const picked = this._match(catPart ?? res.content);
                const confNum = confPart ? parseInt(confPart.replace(/[^0-9]/g, ""), 10) : NaN;
                const confidence = Number.isFinite(confNum) ? Math.max(0, Math.min(100, confNum)) : null;
                // Below threshold → leave it in the inbox for the user to sort by hand.
                if (picked && (confidence === null || confidence >= threshold)) {
                    m.aiCategory = picked.id;
                    this.sortLog.unshift({
                        id: `sd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                        emailId: m.id,
                        subject: m.subject,
                        from: m.from.name,
                        category: picked.name,
                        timestamp: Date.now(),
                        backend: this.agent.backend,
                        model: this.agent.model,
                        ...(confidence !== null ? { confidence: confidence / 100 } : {}),
                    });
                }
            } catch {
                /* skip this one */
            }
            this.sortProgress = { done: (this.sortProgress?.done ?? 0) + 1, total: targets.length };
            onProgress(this.state());
        }

        this.sorting = false;
        this.sortProgress = undefined;
        this.sortLog = this.sortLog.slice(0, 100);
        await this.save();
        onProgress(this.state());
    }

    /** Record a manual correction: set the email's category + remember it as a few-shot example. */
    async correctSort(emailId: string, category: string): Promise<void> {
        const m = this.messages.find((x) => x.id === emailId);
        const cat = this.categories.find((c) => c.id === category || c.name === category);
        if (!m || !cat) return;
        m.aiCategory = cat.id;
        const corrections = this.agent.corrections ?? [];
        corrections.push({ from: m.from.email || m.from.name, subject: m.subject, category: cat.name, at: Date.now() });
        this.agent.corrections = corrections.slice(-50);
        this.sortLog.unshift({
            id: `sd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            emailId: m.id,
            subject: m.subject,
            from: m.from.name,
            category: cat.name,
            timestamp: Date.now(),
            corrected: true,
            backend: this.agent.backend,
            model: this.agent.model,
        });
        this.sortLog = this.sortLog.slice(0, 100);
        await this.save();
    }

    /** Match an LLM reply to one of our categories (tolerant of extra words). */
    private _match(reply: string): EmailCategory | undefined {
        const low = reply.toLowerCase();
        return (
            this.categories.find((c) => low === c.name.toLowerCase()) ??
            this.categories.find((c) => low.includes(c.name.toLowerCase()))
        );
    }

    private async save(): Promise<void> {
        // Cache the newest real messages so the inbox shows instantly on restart (a local mail cache).
        const cache = this.messages
            .filter((m) => m.accountId !== "acct_demo")
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, EmailStore.CACHE_CAP);
        const payload = structuredClone({ categories: this.categories, agent: this.agent, sortLog: this.sortLog, accounts: this.accounts, messages: cache });
        this.saveQueue = this.saveQueue.catch(() => undefined).then(() => writeProtectedJson(this.file, payload));
        await this.saveQueue;
    }
}
