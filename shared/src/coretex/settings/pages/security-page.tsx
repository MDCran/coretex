"use client";

// Every control on this page is backed by live Brain behavior: settings persist
// through ConfigStore, status is reported at runtime, and the policy preview
// uses the same evaluator as execution without ever running the command.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CoretexConfig } from "@repo/coretex/types";
import {
    AlertCircle,
    CheckCircle,
    Key01,
    Lightning01,
    Lock01,
    SearchLg,
    ShieldTick,
    SlashCircle01,
    Trash01,
} from "@untitledui/icons";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RadioButton, RadioGroup } from "@/components/base/radio-buttons/radio-buttons";
import { TextArea } from "@/components/base/textarea/textarea";
import { cx } from "@/utils/cx";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import type { NavTarget } from "../../nav";
import { SettingNumber, SettingToggle, SettingsSection } from "../controls";
import {
    SettingsPageHeader,
    SettingsStatCard,
    SettingsStatusBadge,
    SettingsTwoColumn,
} from "../settings-shell";

interface SecurityPageProps {
    settings: CoretexConfig;
    state: CoretexState;
    actions: CoretexActions;
    onNavigate?: (target: NavTarget) => void;
}

type TerminalPolicy = CoretexConfig["security"]["autonomousTerminal"];

const POLICY_META: Record<TerminalPolicy, { label: string; color: "gray" | "warning" | "success" }> = {
    off: { label: "Automation blocked", color: "gray" },
    approval: { label: "Approval required", color: "warning" },
    auto: { label: "Automatic", color: "success" },
};

const POLICY_ITEMS = [
    {
        value: "off",
        title: "Off",
        secondaryTitle: "Block managed automation",
        description: "Coretex-managed automated terminal commands are rejected. Commands you type directly are unaffected.",
        icon: SlashCircle01,
    },
    {
        value: "approval",
        title: "Require approval",
        secondaryTitle: "Recommended",
        description: "Every eligible managed command waits for your approval, and edited commands are checked again.",
        icon: ShieldTick,
    },
    {
        value: "auto",
        title: "Auto",
        secondaryTitle: "Use configured guardrails",
        description: "Eligible supported commands may run without a prompt. Hard blocks, your rules, and the length cap still apply where Coretex can intercept them.",
        icon: Lightning01,
    },
];

function parseRules(value: string): string[] {
    return value
        .split(/\r?\n/)
        .map((rule) => rule.trim())
        .filter(Boolean);
}

function rulesToDraft(rules: string[]): string {
    return rules.join("\n");
}

function formatTimestamp(value?: number): string {
    if (!value) return "Never";
    try {
        return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
    } catch {
        return new Date(value).toLocaleString();
    }
}

function InlineNotice({
    tone,
    title,
    children,
}: {
    tone: "info" | "success" | "warning" | "error";
    title: string;
    children?: ReactNode;
}) {
    const meta = {
        info: { Icon: ShieldTick, color: "var(--brand)", background: "color-mix(in srgb, var(--brand) 8%, var(--surface-2))" },
        success: { Icon: CheckCircle, color: "var(--c-success, #22c55e)", background: "color-mix(in srgb, var(--c-success, #22c55e) 8%, var(--surface-2))" },
        warning: { Icon: AlertCircle, color: "var(--c-warning, #f59e0b)", background: "color-mix(in srgb, var(--c-warning, #f59e0b) 8%, var(--surface-2))" },
        error: { Icon: SlashCircle01, color: "var(--c-error, #ef4444)", background: "color-mix(in srgb, var(--c-error, #ef4444) 8%, var(--surface-2))" },
    }[tone];
    const Icon = meta.Icon;

    return (
        <div className="flex items-start gap-3 rounded-xl p-3.5" style={{ background: meta.background, border: "1px solid var(--c-border)" }} role="status">
            <Icon className="mt-0.5 size-4 shrink-0" style={{ color: meta.color }} />
            <div className="min-w-0">
                <p className="text-sm font-medium text-primary">{title}</p>
                {children && <div className="mt-0.5 text-xs leading-5 text-tertiary">{children}</div>}
            </div>
        </div>
    );
}

export const SecurityPage = ({ settings, state, actions, onNavigate }: SecurityPageProps) => {
    const policy = settings.security.autonomousTerminal;
    const policyMeta = POLICY_META[policy];
    const status = state.securityStatus;
    const latestCheck = state.securityCommandCheck;
    const latestOperation = state.securityOperation;
    const destructiveConfirmation = useConfirm();

    const [denyDraft, setDenyDraft] = useState(() => rulesToDraft(settings.security.denylist));
    const [allowDraft, setAllowDraft] = useState(() => rulesToDraft(settings.security.allowlist));
    const [rulesSaved, setRulesSaved] = useState(false);
    const [testCommand, setTestCommand] = useState("");
    const [pendingCheckId, setPendingCheckId] = useState<string | null>(null);
    const [secretsBusy, setSecretsBusy] = useState(false);
    const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
    const savedDenyDraft = rulesToDraft(settings.security.denylist);
    const savedAllowDraft = rulesToDraft(settings.security.allowlist);

    useEffect(() => {
        actions.securityGet();
    }, [actions]);

    useEffect(() => {
        setDenyDraft(savedDenyDraft);
        setAllowDraft(savedAllowDraft);
    }, [savedDenyDraft, savedAllowDraft]);

    useEffect(() => {
        if (!latestOperation) return;
        if (latestOperation.action === "clearSecrets") setSecretsBusy(false);
        if (latestOperation.action === "clearDiagnostics") setDiagnosticsBusy(false);
    }, [latestOperation]);

    const denyRules = useMemo(() => parseRules(denyDraft), [denyDraft]);
    const allowRules = useMemo(() => parseRules(allowDraft), [allowDraft]);
    const rulesDirty =
        JSON.stringify(denyRules) !== JSON.stringify(settings.security.denylist) ||
        JSON.stringify(allowRules) !== JSON.stringify(settings.security.allowlist);
    const checkResult = pendingCheckId && latestCheck?.requestId === pendingCheckId ? latestCheck : null;
    const checkPending = Boolean(pendingCheckId && latestCheck?.requestId !== pendingCheckId);

    const saveRules = () => {
        const sent = actions.updateSettings({ security: { denylist: denyRules, allowlist: allowRules } });
        setRulesSaved(sent);
        if (sent) window.setTimeout(() => setRulesSaved(false), 2200);
    };

    const discardRules = () => {
        setDenyDraft(rulesToDraft(settings.security.denylist));
        setAllowDraft(rulesToDraft(settings.security.allowlist));
        setRulesSaved(false);
    };

    const testPolicy = () => {
        const command = testCommand.trim();
        if (!command) return;
        setPendingCheckId(actions.securityCheckCommand(command));
    };

    const requestClearSecrets = () => {
        destructiveConfirmation.confirm({
            title: "Clear every Coretex secret?",
            description:
                "This removes provider credentials, mailbox passwords, database and registry credentials, API-key values, and environment-variable values from Coretex's stores. External CLI sign-ins are not changed.",
            confirmLabel: "Clear all secrets",
            onConfirm: () => {
                setSecretsBusy(true);
                if (!actions.securityClearSecrets()) setSecretsBusy(false);
            },
        });
    };

    const requestClearDiagnostics = () => {
        destructiveConfirmation.confirm({
            title: "Clear local diagnostics?",
            description: "This deletes Coretex's local usage counters and stored redacted crash summaries. Settings and credentials are not affected.",
            confirmLabel: "Clear diagnostics",
            onConfirm: () => {
                setDiagnosticsBusy(true);
                if (!actions.securityClearDiagnostics()) setDiagnosticsBusy(false);
            },
        });
    };

    const operationNotice = latestOperation ? (
        <InlineNotice tone={latestOperation.ok ? "success" : "error"} title={latestOperation.ok ? "Security operation completed" : "Security operation failed"}>
            {latestOperation.ok
                ? `${latestOperation.cleared} ${latestOperation.action === "clearSecrets" ? "stored secret value" : "diagnostic record"}${latestOperation.cleared === 1 ? "" : "s"} cleared.`
                : latestOperation.error || "The Brain could not complete the operation."}
        </InlineNotice>
    ) : null;

    const policySection = (
        <SettingsSection
            title="Automated terminal policy"
            description="Controls commands executed by Terminal Buddy and other Coretex-managed terminal actions."
        >
            <div className="py-4 first:pt-0 last:pb-0">
                <RadioGroup
                    aria-label="Automated terminal policy"
                    value={policy}
                    onChange={(value) => actions.setSetting("security.autonomousTerminal", value)}
                    className="gap-3"
                    size="md"
                >
                    {POLICY_ITEMS.map((item) => {
                        const Icon = item.icon;
                        return (
                            <RadioButton
                                key={item.value}
                                value={item.value}
                                className={({ isSelected }) =>
                                    cx(
                                        "rounded-xl bg-primary p-4 outline-focus-ring ring-inset transition-shadow",
                                        isSelected ? "ring-2 ring-brand" : "ring-1 ring-secondary",
                                    )
                                }
                                label={
                                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <Icon className="size-4 text-brand-secondary" aria-hidden="true" />
                                        <span>{item.title}</span>
                                        <span className="font-normal text-tertiary">{item.secondaryTitle}</span>
                                    </span>
                                }
                                hint={item.description}
                            />
                        );
                    })}
                </RadioGroup>
            </div>
            <div className="py-4 first:pt-0 last:pb-0">
                <InlineNotice tone="info" title="Enforcement scope">
                    Coretex rechecks generated and edited Terminal Buddy commands before each run, retry, and recovery; Claude Agent SDK Bash uses the same evaluator. Codex and Gemini headless CLIs can start only in global Auto and own their internal shell execution, so their child commands cannot be list- or cap-checked here.
                </InlineNotice>
            </div>
        </SettingsSection>
    );

    const rulesSection = (
        <SettingsSection title="Command guardrails" description="Hard safety blocks always apply and cannot be removed or approved around.">
            <div className="grid grid-cols-1 gap-4 py-4 first:pt-0 last:pb-0 xl:grid-cols-2">
                <TextArea
                    aria-label="Command denylist"
                    label="Denylist"
                    hint={`${denyRules.length} rule${denyRules.length === 1 ? "" : "s"} · one case-insensitive substring per line`}
                    value={denyDraft}
                    onChange={(value) => { setDenyDraft(value); setRulesSaved(false); }}
                    rows={7}
                    placeholder={"curl | sh\n--force\nproduction"}
                    textAreaClassName="resize-y font-mono text-xs"
                />
                <TextArea
                    aria-label="Command allowlist"
                    label="Allowlist"
                    hint={`${allowRules.length} rule${allowRules.length === 1 ? "" : "s"} · exact command after whitespace normalization`}
                    value={allowDraft}
                    onChange={(value) => { setAllowDraft(value); setRulesSaved(false); }}
                    rows={7}
                    placeholder={"git status\nnpm test"}
                    textAreaClassName="resize-y font-mono text-xs"
                />
            </div>
            <SettingNumber
                settings={settings}
                actions={actions}
                path="security.maxCommandLength"
                label="Maximum generated command length"
                description="Commands above this character count are blocked before execution."
                min={256}
                max={65_536}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                <p className="text-xs text-tertiary">
                    {rulesDirty ? "Unsaved rule changes are not enforced yet." : rulesSaved ? "Rules saved and active." : "Saved rules are active in the Brain."}
                </p>
                <div className="flex gap-2">
                    <Button size="sm" color="secondary" onClick={discardRules} isDisabled={!rulesDirty}>Discard</Button>
                    <Button size="sm" color="primary" onClick={saveRules} isDisabled={!rulesDirty}>Save rules</Button>
                </div>
            </div>
        </SettingsSection>
    );

    const testerSection = (
        <SettingsSection title="Test the live policy" description="Preview a decision with the Brain's exact evaluator. The command is never executed.">
            <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                    <Input
                        aria-label="Command to test"
                        label="Command"
                        icon={SearchLg}
                        value={testCommand}
                        onChange={(value) => { setTestCommand(value); setPendingCheckId(null); }}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                testPolicy();
                            }
                        }}
                        placeholder="git status"
                    />
                </div>
                <Button
                    size="sm"
                    color="secondary"
                    iconLeading={ShieldTick}
                    onClick={testPolicy}
                    isLoading={checkPending}
                    isDisabled={!state.connected || !testCommand.trim()}
                >
                    Check policy
                </Button>
            </div>
            {checkResult && (
                <div className="py-4 first:pt-0 last:pb-0">
                    <InlineNotice
                        tone={checkResult.requiresApproval ? "warning" : checkResult.allowed ? "success" : "error"}
                        title={checkResult.requiresApproval ? "Approval required" : checkResult.allowed ? "Allowed" : "Blocked"}
                    >
                        {checkResult.reason || "The command satisfies the current policy."}
                        {checkResult.matchedRule && <span className="mt-1 block font-mono">Matched: {checkResult.matchedRule}</span>}
                    </InlineNotice>
                </div>
            )}
            {!state.connected && (
                <div className="py-4 first:pt-0 last:pb-0">
                    <InlineNotice tone="warning" title="Brain disconnected">Reconnect to evaluate against the active runtime policy.</InlineNotice>
                </div>
            )}
        </SettingsSection>
    );

    const privacySection = (
        <SettingsSection title="Privacy & local diagnostics" description="Diagnostics stay on this device. Coretex does not upload these records.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="security.telemetry"
                label="Local usage counters"
                description="Count command names locally to help diagnose feature use; arguments and content are not recorded."
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="security.crashReports"
                label="Local crash summaries"
                description="Keep bounded, redacted Brain crash summaries in the protected local diagnostics file."
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="security.redactSecrets"
                label="Redact protected values"
                description="Remove known credentials and common credential-shaped text from logs, events, and console output."
            />
            <div className="grid grid-cols-2 gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-3">
                <SettingsStatCard label="usage events" value={status?.diagnostics.telemetryEventCount ?? "—"} color="brand" />
                <SettingsStatCard label="crash summaries" value={status?.diagnostics.storedCrashCount ?? "—"} color="gray" />
                <SettingsStatCard label="protected values" value={status?.redaction.protectedValueCount ?? "—"} color="success" />
            </div>
            <div className="flex flex-col items-start justify-between gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                <div>
                    <p className="text-sm font-medium text-primary">Local diagnostic history</p>
                    <p className="mt-0.5 text-xs text-tertiary">Last stored crash: {formatTimestamp(status?.diagnostics.lastCrashAt)}</p>
                </div>
                <Button size="sm" color="secondary-destructive" iconLeading={Trash01} onClick={requestClearDiagnostics} isLoading={diagnosticsBusy}>
                    Clear diagnostics
                </Button>
            </div>
            {latestOperation?.action === "clearDiagnostics" && operationNotice && <div className="py-4 first:pt-0 last:pb-0">{operationNotice}</div>}
        </SettingsSection>
    );

    const secretsSection = (
        <SettingsSection title="Protected secret storage" description="Review the active storage backend and manage Coretex-owned credentials.">
            <div className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-2)]">
                        <Lock01 className="size-4 text-quaternary" />
                    </span>
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-primary">
                            {status?.secretStore.backend === "win32-dpapi-current-user" ? "Windows DPAPI · current user" : status ? "User-only file permissions" : "Reading storage status…"}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-tertiary">
                            {status?.secretStore.encryptedAtRest
                                ? "Secret files are encrypted at rest for the signed-in Windows account."
                                : status
                                  ? "Access is restricted to the current OS user; file contents are not additionally encrypted by Coretex."
                                  : "The Brain reports the actual backend after it connects."}
                        </p>
                    </div>
                </div>
                {status && (
                    <SettingsStatusBadge
                        label={status.secretStore.encryptedAtRest ? "Encrypted" : "Permissions protected"}
                        color={status.secretStore.encryptedAtRest ? "success" : "warning"}
                    />
                )}
            </div>
            <div className="grid grid-cols-2 gap-3 py-4 first:pt-0 last:pb-0">
                <SettingsStatCard label="stored values" value={status?.secretStore.itemCount ?? "—"} color="brand" />
                <SettingsStatCard label="redaction enabled" value={status?.redaction.enabled ? "Yes" : status ? "No" : "—"} color={status?.redaction.enabled ? "success" : "gray"} />
            </div>
            {onNavigate && (
                <div className="flex flex-wrap gap-2 py-4 first:pt-0 last:pb-0">
                    <Button size="sm" color="secondary" iconLeading={Key01} onClick={() => onNavigate({ kind: "env" })}>Environment variables</Button>
                    <Button size="sm" color="secondary" iconLeading={Key01} onClick={() => onNavigate({ kind: "keyvault" })}>API keys & integrations</Button>
                </div>
            )}
            <div className="flex flex-col items-start justify-between gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                <div>
                    <p className="text-sm font-medium text-primary">Clear Coretex-owned secret values</p>
                    <p className="mt-0.5 max-w-xl text-xs leading-5 text-tertiary">Keeps environment definitions and non-secret connection metadata where possible, but removes environment values and API-key entries and disconnects configured integrations.</p>
                </div>
                <Button size="sm" color="secondary-destructive" iconLeading={Trash01} onClick={requestClearSecrets} isLoading={secretsBusy}>
                    Clear all secrets
                </Button>
            </div>
            {latestOperation?.action === "clearSecrets" && operationNotice && <div className="py-4 first:pt-0 last:pb-0">{operationNotice}</div>}
        </SettingsSection>
    );

    return (
        <div className="flex flex-col gap-6">
            <SettingsPageHeader
                icon={Lock01}
                title="Security"
                subtitle="Enforce managed terminal guardrails, protect credentials, and control strictly local diagnostics."
                badges={
                    <>
                        <SettingsStatusBadge label={policyMeta.label} color={policyMeta.color} />
                        <SettingsStatusBadge label={settings.security.redactSecrets ? "Redaction on" : "Redaction off"} color={settings.security.redactSecrets ? "success" : "warning"} />
                    </>
                }
            />
            <SettingsTwoColumn
                left={<>{policySection}{rulesSection}{testerSection}</>}
                right={<>{privacySection}{secretsSection}</>}
            />
            {destructiveConfirmation.dialog}
        </div>
    );
};
