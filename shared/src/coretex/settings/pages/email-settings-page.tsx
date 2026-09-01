// @ts-nocheck
"use client";

// Coretex — Email settings page. The AI sorter lives here (enable, backend/model,
// auto-sort, confidence threshold) alongside full CRUD over the categories it
// classifies into, plus a recent-decisions log. Categories + agent persist through
// the existing email:* commands; nothing is hardcoded.
import { useState } from "react";
import { Edit05, LinkBroken01, Mail01, Play, Plus, RefreshCcw05, Stars01 } from "@untitledui/icons";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RichSelect } from "@/components/base/select/rich-select";
import { Toggle } from "@/components/base/toggle/toggle";
import { ConnectMailboxModal } from "../../email/connect-mailbox-modal";
import { EmailCategoriesManager } from "../../email/email-categories-manager";
import { providerLabel } from "../../labels";
import { BrandLogo } from "../../ui/brand-logo";
import { SettingsSection } from "../controls";
import { emailBackendOptions } from "../rich-select-options";
import { SettingsModelPicker } from "../rich-selects";
import { SettingsPageHeader, SettingsStatusBadge } from "../settings-shell";
import type { SettingsPageProps } from "../settings-window";

/** Best-guess brand domain per email provider for the account logo. */
const PROVIDER_DOMAIN: Record<string, string> = {
    gmail: "google.com",
    outlook: "outlook.com",
    yahoo: "yahoo.com",
    icloud: "icloud.com",
    fastmail: "fastmail.com",
    custom: "mail.com",
};

export const EmailSettingsPage = ({ state, actions }: SettingsPageProps) => {
    const email = state.email;
    const [connectOpen, setConnectOpen] = useState(false);
    const disconnectConfirmation = useConfirm();
    if (!email) {
        return (
            <div className="flex flex-col gap-6">
                <SettingsPageHeader
                    icon={Mail01}
                    title="Email"
                    subtitle="The AI sorter classifies incoming mail into your categories."
                    badges={<SettingsStatusBadge label="Loading" color="gray" />}
                />
                <SettingsSection title="Mailboxes" description="Loading connected mailboxes and sorter preferences.">
                    <div className="flex items-center gap-2 py-3.5 text-sm text-tertiary" role="status">
                        <RefreshCcw05 className="size-4 animate-spin" />
                        Loading email settings…
                    </div>
                </SettingsSection>
            </div>
        );
    }
    const agent = email.agent;
    const providerModels = state.models.filter((m) => m.provider === agent.backend);
    const realAccounts = email.accounts.filter((a) => a.kind === "imap");

    return (
        <div className="flex flex-col gap-6">
            {disconnectConfirmation.dialog}
            <SettingsPageHeader
                icon={Mail01}
                title="Email"
                subtitle="The AI sorter classifies incoming mail into your categories."
                badges={agent.enabled ? <SettingsStatusBadge label="Sorter on" color="success" /> : <SettingsStatusBadge label="Sorter off" color="gray" />}
            />

            <SettingsSection
                title="Mailboxes"
                description="Connect a real inbox over IMAP/SMTP — Gmail, iCloud, Yahoo, Fastmail, or any custom server. Outlook requires OAuth and is not offered as a password login."
            >
                <div className="flex flex-col gap-3 py-1">
                    {realAccounts.length > 0 && (
                        <ul className="flex flex-col gap-2">
                            {realAccounts.map((a) => (
                                <li
                                    key={a.id}
                                    className="flex flex-col gap-3 rounded-xl px-3.5 py-3 sm:flex-row sm:items-center"
                                    style={{
                                        background: "var(--surface-2)",
                                        border: "1px solid var(--c-border)",
                                    }}
                                >
                                    <BrandLogo domain={PROVIDER_DOMAIN[a.provider ?? "custom"] ?? "mail.com"} name={a.provider ?? "Mailbox"} size={26} />
                                    <div className="min-w-0 flex-1">
                                        <p className="break-all text-sm font-medium text-primary" title={a.email || a.name}>{a.email || a.name}</p>
                                        <p className="break-words text-xs text-tertiary">
                                            {a.syncing
                                                ? "Syncing…"
                                                : a.lastError
                                                  ? a.lastError
                                                  : a.lastSync
                                                    ? `Last synced ${new Date(a.lastSync).toLocaleString()}`
                                                    : a.imapHost}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto">
                                        {a.lastError ? (
                                            <Badge size="sm" color="error">
                                                Error
                                            </Badge>
                                        ) : a.connected ? (
                                            <BadgeWithDot size="sm" color="success">
                                                Connected
                                            </BadgeWithDot>
                                        ) : (
                                            <Badge size="sm" color="gray">
                                                Idle
                                            </Badge>
                                        )}
                                        <Button
                                            size="sm"
                                            color="tertiary"
                                            iconLeading={RefreshCcw05}
                                            isLoading={a.syncing}
                                            onClick={() => actions.emailSyncAccount(a.id)}
                                            aria-label="Sync now"
                                        />
                                        <Button
                                            size="sm"
                                            color="tertiary-destructive"
                                            iconLeading={LinkBroken01}
                                            onClick={() =>
                                                disconnectConfirmation.confirm({
                                                    title: `Disconnect ${a.email || a.name}?`,
                                                    description:
                                                        "This removes the mailbox connection and its protected local credentials from Coretex. Mail on the server is not changed.",
                                                    confirmLabel: "Disconnect mailbox",
                                                    onConfirm: () => actions.emailDisconnectAccount(a.id),
                                                })
                                            }
                                        >
                                            Disconnect
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div
                        className="flex flex-col items-start gap-3 rounded-xl p-4 sm:flex-row sm:items-center"
                        style={{ border: "1px dashed var(--c-border)" }}
                    >
                        <Mail01 className="size-7 text-brand-secondary" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-primary">Connect a mailbox</p>
                            <p className="text-xs text-tertiary">
                                Pull your real inbox into Coretex to read, search, send, and AI-categorize. Uses an app password — no Google Cloud setup needed.
                            </p>
                        </div>
                        <Button className="shrink-0" size="sm" color="primary" iconLeading={Plus} onClick={() => setConnectOpen(true)}>
                            Connect mailbox
                        </Button>
                    </div>
                    <p className="text-xs text-quaternary">
                        Coretex verifies IMAP (incoming) and SMTP (outgoing) before saving an account. Gmail, Yahoo, and iCloud require an app-specific
                        password; Fastmail requires a plan with IMAP access. On Windows the credential is encrypted to your Windows user with DPAPI. Until a
                        mailbox is connected, Coretex runs on demo mail so the sorter stays testable.
                    </p>
                </div>
            </SettingsSection>

            {connectOpen && <ConnectMailboxModal actions={actions} emailState={email} onClose={() => setConnectOpen(false)} />}

            <SettingsSection title="AI sorter" description="Route mail through a model into your categories. Runs on demand or as mail arrives.">
                <div className="flex flex-col gap-4 py-1">
                    <p className="text-xs text-quaternary">
                        The sorter sends each message's sender, subject, and preview to the selected model. Use Ollama for a free, local-only sorter.
                    </p>
                    <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                        <div>
                            <p className="text-sm font-medium text-primary">Auto-categorize new mail</p>
                            <p className="text-xs text-tertiary">
                                When a mailbox is connected, Coretex checks it every five minutes and sorts newly synced mail. You can always use “Run sorter
                                now” to sort on demand.
                            </p>
                        </div>
                        <Toggle
                            aria-label="Auto-categorize new mail"
                            isSelected={agent.enabled && agent.autoSortOnReceive}
                            onChange={(v) => actions.emailSetAgent({ enabled: v, autoSortOnReceive: v })}
                        />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-secondary">AI provider</span>
                            <p className="text-[11px] text-quaternary">Carrier that runs classification — local or cloud.</p>
                            <RichSelect
                                aria-label="AI provider"
                                rich
                                options={emailBackendOptions()}
                                value={agent.backend}
                                onChange={(e) =>
                                    actions.emailSetAgent({
                                        backend: e.target.value as typeof agent.backend,
                                    })
                                }
                            />
                        </label>
                        <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-secondary">Model</span>
                            <p className="text-[11px] text-quaternary">Which model sorts mail into your categories.</p>
                            {providerModels.length > 0 ? (
                                <SettingsModelPicker
                                    models={providerModels}
                                    provider={agent.backend}
                                    model={agent.model}
                                    onChange={(_p, id) => actions.emailSetAgent({ model: id })}
                                />
                            ) : (
                                <Input aria-label="Email sorting model" value={agent.model} onChange={(v) => actions.emailSetAgent({ model: v })} placeholder="model id" />
                            )}
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-secondary">Confidence threshold (%)</span>
                            <Input
                                aria-label="Confidence threshold percentage"
                                type="number"
                                value={String(agent.confidenceThreshold)}
                                hint="Mail the AI is less sure about than this is left in your inbox to sort by hand."
                                onChange={(v) => {
                                    const n = Number(v);
                                    if (!Number.isNaN(n))
                                        actions.emailSetAgent({
                                            confidenceThreshold: Math.max(0, Math.min(100, Math.trunc(n))),
                                        });
                                }}
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-secondary">Batch size</span>
                            <Input
                                aria-label="Email sorting batch size"
                                type="number"
                                value={String(agent.sortBatch)}
                                onChange={(v) => {
                                    const n = Number(v);
                                    if (!Number.isNaN(n))
                                        actions.emailSetAgent({
                                            sortBatch: Math.max(1, Math.trunc(n)),
                                        });
                                }}
                            />
                        </label>
                    </div>
                    <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                        <p className="text-xs text-tertiary">Sort the inbox now using the current settings.</p>
                        <Button
                            size="sm"
                            color="primary"
                            iconLeading={email.sorting ? undefined : Play}
                            isLoading={email.sorting}
                            onClick={() => actions.emailCategorize()}
                        >
                            {email.sorting ? `Sorting ${email.sortProgress?.done ?? 0}/${email.sortProgress?.total ?? 0}` : "Run sorter now"}
                        </Button>
                    </div>
                </div>
            </SettingsSection>

            <SettingsSection title="Categories" description="The exact set the sorter classifies into. Add, edit, recolor, or icon them — your set, not ours.">
                <EmailCategoriesManager categories={email.categories} actions={actions} />
            </SettingsSection>

            <SettingsSection title="Recent sorting activity" description="The latest decisions the AI sorter made.">
                {email.sortLog.length === 0 ? (
                    <p className="py-2 text-sm text-tertiary">No sorting activity yet.</p>
                ) : (
                    <ul className="flex flex-col divide-y divide-[var(--c-border)]">
                        {email.sortLog.slice(0, 20).map((d) => (
                            <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
                                {d.corrected ? (
                                    <Edit05 className="size-3.5 shrink-0 text-warning-primary" />
                                ) : (
                                    <Stars01 className="size-3.5 shrink-0 text-brand-secondary" />
                                )}
                                <div className="min-w-0 flex-1">
                                    <span className="block break-words text-sm text-secondary" title={d.subject}>{d.subject}</span>
                                    {(d.backend || d.model) && (
                                        <span className="block break-all text-[11px] text-quaternary">
                                            {d.corrected ? "You corrected this" : "Sorted by"} {d.backend ? providerLabel(d.backend) : ""}
                                            {d.model ? ` · ${d.model}` : ""}
                                        </span>
                                    )}
                                </div>
                                {typeof d.confidence === "number" && (
                                    <span className="shrink-0 text-xs text-quaternary tabular-nums">{Math.round(d.confidence * 100)}%</span>
                                )}
                                <Badge size="sm" color={d.corrected ? "warning" : "gray"}>
                                    {d.corrected ? "Corrected" : d.category}
                                </Badge>
                            </li>
                        ))}
                    </ul>
                )}
            </SettingsSection>
        </div>
    );
};
