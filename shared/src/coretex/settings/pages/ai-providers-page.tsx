// @ts-nocheck
"use client";

// Coretex Relay — AI providers settings (§10.1). Master-detail layout: compact
// provider rail + a single configuration panel (no nested accordions).
import { type ReactNode, useEffect, useState } from "react";
import type { CoretexConfig } from "@repo/coretex/types";
import type { ProviderConfigState, ProviderHealth } from "@repo/coretex/types";
import { AlertCircle, CheckCircle, CurrencyDollarCircle, Download01, InfoCircle, Loading02, RefreshCcw01, Server01, Stars01, Trash01 } from "@untitledui/icons";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RichSelect } from "@/components/base/select/rich-select";
import { Toggle } from "@/components/base/toggle/toggle";
import { cx } from "@/utils/cx";
import { healthErrorLabel, modelLabel, providerLabel } from "../../labels";
import type { NavTarget } from "../../nav";
import { ClaudeTiersRow } from "../../panels/provider-health";
import { ProviderSessionHub } from "../../panels/provider-session-hub";
import { EXECUTABLE_CODING_ASSISTANT_IDS, LOCAL_PROVIDER_IDS, isCodingAssistantEnabled, isProviderReady, providerLogoDomain, providerShortBlurb } from "../../provider-meta";
import { BrandLogo } from "../../ui/brand-logo";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { AiSettingsLinkCard } from "../ai-settings-link";
import { SettingsSection } from "../controls";
import { buildModelSelectOptions } from "../rich-select-options";
import { SettingsPageHeader, SettingsStatusBadge } from "../settings-shell";

const LOCAL_PROVIDERS = LOCAL_PROVIDER_IDS;

type ProviderStatusKind = "connected" | "not_configured" | "disabled" | "unavailable" | "testing";

interface ProviderStatus {
    kind: ProviderStatusKind;
    label: string;
    color: "success" | "warning" | "error" | "gray" | "brand";
    detail: string;
}

function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return "—";
    const gb = bytes / 1e9;
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function titleSafe(input: string): string {
    if (!input) return "";
    return input.charAt(0).toUpperCase() + input.slice(1);
}

/** Human copy for a provider's plan/subscription auth — mirrors each provider's real CLI login flow. */
function planAuthCopy(provider: ProviderConfigState["provider"]): {
    ready: string;
    pending: string;
} {
    switch (provider) {
        case "anthropic":
            return {
                ready: "Claude Pro/Max — agents use subscription, not API $",
                pending: "Run claude login once, then Test. Agents bill to your plan.",
            };
        case "openai":
            return {
                ready: "ChatGPT Plus/Pro — agents run via Codex CLI, not API $",
                pending: 'Run "codex login" once, then Test. Agents bill to your plan.',
            };
        case "gemini":
            return {
                ready: "Google AI Pro/Ultra — agents run via Gemini CLI, not API $",
                pending: 'Run "gemini" once and sign in with Google, then Test. Agents bill to your plan.',
            };
        default:
            return {
                ready: "Plan ready — not billed as API $",
                pending: "Sign in once, then Test.",
            };
    }
}

function resolveProviderStatus(config: ProviderConfigState, health: ProviderHealth | undefined, testing: boolean): ProviderStatus {
    const isLocal = LOCAL_PROVIDERS.has(config.provider);
    const isPlanAuth = (config.provider === "anthropic" && config.authMode !== "api-key") || ((config.provider === "openai" || config.provider === "gemini") && config.authMode === "subscription");
    const configured = isLocal ? Boolean(config.baseUrl?.trim()) || config.enabled : isPlanAuth ? true : Boolean(config.keyConfigured);

    if (testing)
        return {
            kind: "testing",
            label: "Testing…",
            color: "gray",
            detail: "Checking connection",
        };
    if (!config.enabled) {
        return {
            kind: "disabled",
            label: "Disabled",
            color: "gray",
            detail: configured ? "Turn on to use" : "Enable and configure",
        };
    }
    if (isPlanAuth && config.enabled) {
        const copy = planAuthCopy(config.provider);
        if (health?.healthy && health.channel === "subscription") {
            return {
                kind: "connected",
                label: "Plan ready",
                color: "success",
                detail: copy.ready,
            };
        }
        if (health)
            return {
                kind: "unavailable",
                label: "Unavailable",
                color: "error",
                detail: healthErrorLabel(health.error),
            };
        return {
            kind: "unavailable",
            label: "Not verified",
            color: "gray",
            detail: copy.pending,
        };
    }
    const expectedChannel = isLocal ? "local" : "api";
    if (health?.healthy && health.channel === expectedChannel) {
        const ms = Math.round(health.latencyMs);
        const n = health.models.length;
        return {
            kind: "connected",
            label: "Connected",
            color: "success",
            detail: `${ms}ms · ${n} ${n === 1 ? "model" : "models"}`,
        };
    }
    if (!configured) {
        return {
            kind: "not_configured",
            label: "Setup needed",
            color: "warning",
            detail: isLocal ? "Add base URL" : "Add API key",
        };
    }
    if (!health) {
        return {
            kind: "unavailable",
            label: "Unknown",
            color: "gray",
            detail: "Run a connection test",
        };
    }
    return {
        kind: "unavailable",
        label: "Unavailable",
        color: "error",
        detail: healthErrorLabel(health.error),
    };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <label className="break-words text-xs font-medium text-secondary [overflow-wrap:anywhere]">{label}</label>
            {children}
            {hint && <p className="break-words text-xs text-quaternary [overflow-wrap:anywhere]">{hint}</p>}
        </div>
    );
}

// ---- Ollama model manager ----
const OllamaModelManager = ({ state, actions }: { state: CoretexState; actions: CoretexActions }) => {
    const [pullInput, setPullInput] = useState("");
    const modelDeletion = useConfirm();
    const { models, modelsError, pulling, show } = state.ollama;
    const pullingList = Object.values(pulling);

    useEffect(() => {
        actions.ollamaList();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="mt-6 border-t border-secondary pt-6">
            {modelDeletion.dialog}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 basis-48">
                    <h3 className="text-sm font-semibold text-primary">Local models</h3>
                    <p className="mt-0.5 text-xs text-tertiary">Pull, inspect, or remove Ollama models.</p>
                </div>
                <Button size="sm" color="tertiary" iconLeading={RefreshCcw01} onClick={() => actions.ollamaList()}>
                    Refresh
                </Button>
            </div>

            {modelsError ? (
                <p className="text-sm text-error-primary">{healthErrorLabel(modelsError)}</p>
            ) : models.length === 0 ? (
                <p className="rounded-lg px-3 py-4 text-center text-sm text-tertiary" style={{ background: "var(--surface-2)" }}>
                    No models installed — pull one below.
                </p>
            ) : (
                <div className="overflow-hidden rounded-xl" style={{ border: "1px solid var(--c-border)" }}>
                    {models.map((m, i) => (
                        <div key={m.name} className={cx("flex flex-wrap items-center justify-between gap-3 bg-[var(--surface-2)] px-3.5 py-2.5", i > 0 && "border-t border-secondary")}>
                            <div className="min-w-0 flex-1 basis-40">
                                <p className="break-all text-sm font-medium text-primary" title={m.name}>
                                    {m.name}
                                </p>
                                <p className="text-xs text-tertiary">
                                    {formatBytes(m.size)}
                                    {m.parameterSize ? ` · ${m.parameterSize}` : ""}
                                    {m.quantization ? ` · ${m.quantization}` : ""}
                                </p>
                            </div>
                            <div className="flex shrink-0 gap-1">
                                <Button size="sm" color="tertiary" iconLeading={InfoCircle} onClick={() => actions.ollamaShow(m.name)} />
                                <Button
                                    size="sm"
                                    color="tertiary-destructive"
                                    iconLeading={Trash01}
                                    aria-label={`Delete ${m.name}`}
                                    onClick={() =>
                                        modelDeletion.confirm({
                                            title: `Delete ${m.name}?`,
                                            description: "This removes the model files from Ollama on this machine. You will need to pull the model again to use it.",
                                            confirmLabel: "Delete model",
                                            onConfirm: () => actions.ollamaDelete(m.name),
                                        })
                                    }
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {pullingList.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                    {pullingList.map((p) => (
                        <div key={p.model} className="rounded-lg bg-[var(--surface-2)] px-3.5 py-2.5" style={{ border: "1px solid var(--c-border)" }}>
                            <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-2 text-sm font-medium text-primary">
                                    <Loading02 className="size-4 animate-spin text-brand-secondary" />
                                    {p.model}
                                </span>
                                <Badge size="sm" color={p.error ? "error" : "brand"}>
                                    {p.error ? "Failed" : p.percent >= 0 ? `${p.percent}%` : titleSafe(p.status)}
                                </Badge>
                            </div>
                            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--c-border)]">
                                <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                        width: p.percent >= 0 ? `${p.percent}%` : "40%",
                                        background: p.error ? "var(--c-error, #ef4444)" : "var(--brand)",
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-4 flex flex-col gap-2 @xl/settings-page:flex-row @xl/settings-page:items-end">
                <div className="min-w-0 flex-1">
                    <Field label="Pull model">
                        <Input aria-label="Model to pull" value={pullInput} placeholder="llama3.3:70b, qwen2.5-coder…" onChange={setPullInput} />
                    </Field>
                </div>
                <Button
                    size="md"
                    color="primary"
                    iconLeading={Download01}
                    onClick={() => {
                        if (pullInput.trim()) {
                            actions.ollamaPull(pullInput.trim());
                            setPullInput("");
                        }
                    }}
                    isDisabled={!pullInput.trim()}
                >
                    Pull
                </Button>
            </div>

            {show && (
                <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3.5" style={{ border: "1px solid var(--c-border)" }}>
                    <p className="mb-2 text-xs font-semibold text-primary">{show.model}</p>
                    {show.error ? (
                        <p className="text-xs text-error-primary">{healthErrorLabel(show.error)}</p>
                    ) : (
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                            {Object.entries(show.details ?? {})
                                .filter(([k]) => !["template", "license", "parameters"].includes(k))
                                .map(([k, v]) => (
                                    <div key={k} className="contents">
                                        <dt className="text-xs text-tertiary">{titleSafe(k)}</dt>
                                        <dd className="break-all text-xs font-medium text-secondary">{v}</dd>
                                    </div>
                                ))}
                        </dl>
                    )}
                </div>
            )}
        </div>
    );
};

// ---- Provider detail panel ----
const ProviderDetail = ({ config, settings, state, actions }: { config: ProviderConfigState; settings: CoretexConfig; state: CoretexState; actions: CoretexActions }) => {
    const provider = config.provider;
    const isLocal = LOCAL_PROVIDERS.has(provider);
    const isAnthropic = provider === "anthropic";
    // OpenRouter has no subscription/plan tier of its own — it's always pay-per-token, even
    // with an OAuth-style login, so it doesn't get a billing-mode toggle here.
    const supportsPlanBilling = isAnthropic || provider === "openai" || provider === "gemini";
    const authMode = isAnthropic ? (config.authMode === "api-key" ? "api-key" : "claude-plan") : config.authMode === "subscription" ? "subscription" : "api-key";
    const useClaudePlan = authMode === "claude-plan";
    const useSubscriptionPlan = authMode === "subscription" || useClaudePlan;
    const health = state.health.find((h) => h.provider === provider);
    const [keyValue, setKeyValue] = useState("");
    const [note, setNote] = useState("");
    const [testing, setTesting] = useState(false);
    const status = resolveProviderStatus(config, health, testing);
    const blurb = providerShortBlurb(provider);
    const canTest = isLocal || useSubscriptionPlan || config.keyConfigured;
    const linkedHarnesses = (settings.codingAgents ?? []).filter((h) => EXECUTABLE_CODING_ASSISTANT_IDS.has(h.id) && h.provider === provider && isCodingAssistantEnabled(settings, h));

    const updateProvider = (patch: Partial<ProviderConfigState>): void => {
        const next = settings.aiProviders.map((p) => (p.provider === provider ? { ...p, ...patch } : p));
        actions.updateSettings({ aiProviders: next });
    };

    const providerModels = state.models.filter((m) => m.provider === provider);
    const modelOptions = buildModelSelectOptions(providerModels, {
        pinnedId: config.defaultModel ?? undefined,
    });

    const handleSaveKey = (): void => {
        const trimmed = keyValue.trim();
        if (!trimmed) {
            setNote("Paste an API key first.");
            return;
        }
        actions.setSecret(`provider.${provider}.apiKey`, trimmed);
        setKeyValue("");
        setNote("Key saved.");
        updateProvider({ keyConfigured: true });
        setTesting(true);
        actions.testProvider(provider);
        window.setTimeout(() => setTesting(false), 2500);
    };

    const handleTest = (): void => {
        setTesting(true);
        setNote("");
        actions.testProvider(provider);
        window.setTimeout(() => setTesting(false), 2500);
    };

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Panel header */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-secondary px-5 py-4 sm:px-6">
                <div className="flex min-w-0 flex-1 basis-72 items-start gap-3.5">
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)]" style={{ border: "1px solid var(--c-border)" }}>
                        <BrandLogo domain={providerLogoDomain(provider)} name={providerLabel(provider)} size={28} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="break-words text-md font-semibold text-primary [overflow-wrap:anywhere]">{providerLabel(provider)}</h2>
                            <BadgeWithDot type="pill-color" size="sm" color={status.color}>
                                {status.label}
                            </BadgeWithDot>
                            <Badge size="sm" color="gray" type="pill-color">
                                {isLocal ? "Local" : "Cloud"}
                            </Badge>
                        </div>
                        <p className="mt-0.5 break-words text-sm text-tertiary [overflow-wrap:anywhere]">
                            {blurb} · {status.detail}
                        </p>
                        {linkedHarnesses.length > 0 && <p className="mt-1 break-words text-xs text-quaternary [overflow-wrap:anywhere]">Powers coding assistants: {linkedHarnesses.map((h) => h.name).join(", ")}</p>}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-tertiary">Enabled</span>
                    <Toggle aria-label={`Enable ${providerLabel(provider)}`} isSelected={config.enabled} onChange={(v) => updateProvider({ enabled: v })} />
                </div>
            </div>

            <div className="min-w-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                {status.kind === "connected" && (
                    <div
                        className="mb-5 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm"
                        style={{
                            background: "color-mix(in srgb, var(--c-success, #22c55e) 10%, transparent)",
                            border: "1px solid var(--c-border)",
                        }}
                    >
                        <CheckCircle className="size-4 shrink-0 text-success-primary" />
                        <span className="text-secondary">
                            <span className="font-medium text-primary">Ready.</span> {status.detail}
                        </span>
                    </div>
                )}
                {(status.kind === "not_configured" || status.kind === "unavailable") && (
                    <div
                        className="mb-5 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm"
                        style={{
                            background: status.kind === "unavailable" ? "color-mix(in srgb, var(--c-error, #ef4444) 8%, transparent)" : "var(--surface-2)",
                            border: "1px solid var(--c-border)",
                        }}
                    >
                        <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning-primary" />
                        <span className="text-tertiary">
                            <span className="font-medium text-primary">{status.label}.</span> {status.detail}
                        </span>
                    </div>
                )}

                <div className="grid min-w-0 grid-cols-1 gap-5 @4xl/settings-page:grid-cols-2">
                    {supportsPlanBilling && (
                        <div className="flex min-w-0 flex-col gap-3 @4xl/settings-page:col-span-2">
                            <span className="text-xs font-medium text-secondary">Billing mode</span>
                            <div className="flex flex-wrap gap-2">
                                {isAnthropic ? (
                                    <>
                                        <Button
                                            size="sm"
                                            color={useClaudePlan ? "primary" : "secondary"}
                                            onClick={() =>
                                                updateProvider({
                                                    authMode: "claude-plan",
                                                    planLabel: "Claude Pro / Max",
                                                })
                                            }
                                        >
                                            Claude Pro / Max plan
                                        </Button>
                                        <Button
                                            size="sm"
                                            color={!useClaudePlan ? "primary" : "secondary"}
                                            onClick={() =>
                                                updateProvider({
                                                    authMode: "api-key",
                                                    planLabel: undefined,
                                                })
                                            }
                                        >
                                            API key (pay-per-token)
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Button
                                            size="sm"
                                            color={useSubscriptionPlan ? "primary" : "secondary"}
                                            onClick={() =>
                                                updateProvider({
                                                    authMode: "subscription",
                                                    planLabel: provider === "openai" ? "ChatGPT Plus / Pro" : provider === "gemini" ? "Google AI Pro / Ultra" : "Provider plan",
                                                })
                                            }
                                        >
                                            {provider === "openai" ? "ChatGPT Plus / Pro plan" : provider === "gemini" ? "Google AI Pro / Ultra plan" : "Subscription plan"}
                                        </Button>
                                        <Button
                                            size="sm"
                                            color={!useSubscriptionPlan ? "primary" : "secondary"}
                                            onClick={() =>
                                                updateProvider({
                                                    authMode: "api-key",
                                                    planLabel: undefined,
                                                })
                                            }
                                        >
                                            API key (pay-per-token)
                                        </Button>
                                    </>
                                )}
                            </div>
                            <p className="break-words text-xs text-quaternary [overflow-wrap:anywhere]">
                                {useClaudePlan
                                    ? "Agents and Claude Code use your Claude subscription (no API $). Run claude login once if needed. Chat via the hub still needs an API key."
                                    : useSubscriptionPlan
                                      ? provider === "openai"
                                          ? 'Agents run through Codex CLI under your ChatGPT plan (no API $). Run "codex login" once if needed — no API key required. Chat via the hub still needs an API key.'
                                          : 'Agents run through Gemini CLI under your Google AI plan (no API $). Run "gemini" once and sign in with Google if needed — no API key required. Chat via the hub still needs an API key.'
                                      : "Uses pay-per-token API billing. Switch to plan mode if you pay for a consumer subscription instead of API credits."}
                            </p>
                        </div>
                    )}

                    {isLocal ? (
                        <Field label="Base URL" hint={provider === "openclaw" ? "OpenClaw gateway (OpenAI-compatible)." : "Endpoint for your local server."}>
                            <Input
                                aria-label={`${providerLabel(provider)} base URL`}
                                value={config.baseUrl ?? ""}
                                placeholder={provider === "ollama" ? "http://localhost:11434" : provider === "openclaw" ? "http://127.0.0.1:18789" : "http://localhost:1234/v1"}
                                onChange={(v: string) => updateProvider({ baseUrl: v })}
                            />
                        </Field>
                    ) : null}

                    {!useSubscriptionPlan && !isLocal ? (
                        <div className="flex min-w-0 flex-col gap-3 @4xl/settings-page:col-span-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-secondary">API key</span>
                                <BadgeWithDot type="pill-color" size="sm" color={config.keyConfigured ? "success" : "warning"}>
                                    {config.keyConfigured ? "Configured" : "Required"}
                                </BadgeWithDot>
                            </div>
                            <div className="flex flex-col gap-2 @xl/settings-page:flex-row">
                                <div className="min-w-0 flex-1">
                                    <Input
                                        aria-label={`${providerLabel(provider)} API key`}
                                        type="password"
                                        value={keyValue}
                                        placeholder={config.keyConfigured ? "Replace key…" : "Paste API key…"}
                                        onChange={setKeyValue}
                                    />
                                </div>
                                <Button size="md" color={config.keyConfigured ? "secondary" : "primary"} onClick={handleSaveKey} isDisabled={!keyValue.trim()}>
                                    {config.keyConfigured ? "Update" : "Save key"}
                                </Button>
                            </div>
                            <p className="text-xs text-quaternary">Stored in the secret vault — never in settings.</p>
                        </div>
                    ) : null}

                    {provider === "openrouter" && (
                        <Field label="Base URL" hint="OpenRouter OpenAI-compatible endpoint.">
                            <Input
                                aria-label="OpenRouter base URL"
                                value={config.baseUrl ?? "https://openrouter.ai/api"}
                                placeholder="https://openrouter.ai/api"
                                onChange={(v: string) => updateProvider({ baseUrl: v })}
                            />
                        </Field>
                    )}

                    {provider === "openclaw" && (
                        <div className="flex min-w-0 flex-col gap-3 @4xl/settings-page:col-span-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-secondary">API key (optional)</span>
                                <BadgeWithDot type="pill-color" size="sm" color={config.keyConfigured ? "success" : "gray"}>
                                    {config.keyConfigured ? "Configured" : "Optional"}
                                </BadgeWithDot>
                            </div>
                            <div className="flex flex-col gap-2 @xl/settings-page:flex-row">
                                <div className="min-w-0 flex-1">
                                    <Input
                                        aria-label="OpenClaw API key"
                                        type="password"
                                        value={keyValue}
                                        placeholder={config.keyConfigured ? "Replace key…" : "If your gateway requires auth…"}
                                        onChange={setKeyValue}
                                    />
                                </div>
                                <Button size="md" color="secondary" onClick={handleSaveKey} isDisabled={!keyValue.trim()}>
                                    {config.keyConfigured ? "Update" : "Save key"}
                                </Button>
                            </div>
                        </div>
                    )}

                    <Field label="Default model" hint="Primary model for this provider — used when agents don't specify one.">
                        {modelOptions.length > 0 ? (
                            <RichSelect
                                aria-label="Default model"
                                rich
                                options={modelOptions}
                                value={config.defaultModel ?? modelOptions[0]?.value ?? ""}
                                onChange={(e) => updateProvider({ defaultModel: e.target.value })}
                            />
                        ) : (
                            <Input
                                aria-label="Default model"
                                value={config.defaultModel ?? ""}
                                placeholder="Enter the model id used by this connection"
                                onChange={(value) => updateProvider({ defaultModel: value })}
                            />
                        )}
                    </Field>

                    <div className="flex min-w-0 flex-wrap items-end gap-3">
                        <Button size="md" color="secondary" iconLeading={testing ? Loading02 : RefreshCcw01} onClick={handleTest} isDisabled={testing || !canTest}>
                            {testing ? "Testing…" : "Test connection"}
                        </Button>
                        {note && <span className="min-w-0 break-words pb-2 text-xs text-tertiary [overflow-wrap:anywhere]">{note}</span>}
                    </div>
                </div>

                {provider === "ollama" && config.enabled && <OllamaModelManager state={state} actions={actions} />}
            </div>
        </div>
    );
};

export const AiProvidersPage = ({ settings, state, actions, onNavigate }: { settings: CoretexConfig; state: CoretexState; actions: CoretexActions; onNavigate?: (t: NavTarget) => void }) => {
    const providers = settings.aiProviders;
    const claudeConnected = state.health.some((h) => h.provider === "anthropic" && h.healthy);

    const [selectedId, setSelectedId] = useState<string | null>(providers[0]?.provider ?? null);
    const selected = providers.find((p) => p.provider === selectedId) ?? providers[0];

    const refreshAll = (): void => {
        actions.requestHealthCheck();
        for (const provider of providers) {
            const planAuth =
                (provider.provider === "anthropic" && provider.authMode !== "api-key") || ((provider.provider === "openai" || provider.provider === "gemini") && provider.authMode === "subscription");
            if (provider.enabled && planAuth) actions.testProvider(provider.provider);
        }
    };

    useEffect(() => {
        if (selectedId && providers.some((p) => p.provider === selectedId)) return;
        setSelectedId(providers[0]?.provider ?? null);
    }, [providers, selectedId]);

    useEffect(() => {
        refreshAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const readyCount = providers.filter((p) => {
        const h = state.health.find((item) => item.provider === p.provider);
        return isProviderReady(p, h);
    }).length;

    return (
        <div className="flex flex-col gap-6">
            <SettingsPageHeader
                icon={Stars01}
                title="AI providers"
                subtitle="Connect models once — agents and coding assistants use the same providers, logos, and names."
                badges={<SettingsStatusBadge label={`${readyCount}/${providers.length} ready`} color={readyCount > 0 ? "success" : "gray"} />}
                actions={
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" color="secondary" iconLeading={RefreshCcw01} onClick={refreshAll}>
                            Refresh all
                        </Button>
                        {onNavigate && (
                            <Button size="sm" color="secondary" iconLeading={CurrencyDollarCircle} onClick={() => onNavigate({ kind: "settings", page: "model-pricing" })}>
                                Model pricing
                            </Button>
                        )}
                    </div>
                }
            />

            <AiSettingsLinkCard settings={settings} health={state.health} variant="to-agents" onNavigate={onNavigate} agentCount={state.agents?.length ?? 0} />

            <ProviderSessionHub
                settings={settings}
                state={state}
                actions={actions}
                onManageOpenAi={() => {
                    setSelectedId("openai");
                    window.requestAnimationFrame(() => document.getElementById("provider-connections")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                }}
            />

            <SettingsSection title="Usage policy" description="Set a shared cost guardrail and review any connected plan allowance.">
                <div className="grid min-w-0 grid-cols-1 gap-3 py-1 @4xl/settings-page:grid-cols-2">
                    <div
                        className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3.5 sm:px-5"
                        style={{
                            background: "var(--surface-2)",
                            border: "1px solid var(--c-border)",
                        }}
                    >
                        <div className="min-w-0 flex-1 basis-48">
                            <p className="text-sm font-semibold text-primary">Daily spend cap</p>
                            <p className="text-xs text-tertiary">USD per day · 0 disables</p>
                        </div>
                        <div className="w-full min-w-28 flex-1 basis-28 @xl/settings-page:max-w-28">
                            <Input
                                aria-label="Daily spend cap in US dollars"
                                type="number"
                                value={String(settings.security.dailyCostLimitUSD ?? 0)}
                                placeholder="0"
                                icon={CurrencyDollarCircle}
                                onChange={(v: string) => {
                                    const n = Number.parseFloat(v);
                                    actions.setSetting("security.dailyCostLimitUSD", Number.isFinite(n) && n >= 0 ? n : 0);
                                }}
                            />
                        </div>
                    </div>
                    {claudeConnected && (
                        <div
                            className="rounded-xl px-4 py-3.5 sm:px-5"
                            style={{
                                background: "var(--surface-2)",
                                border: "1px solid var(--c-border)",
                            }}
                        >
                            <ClaudeTiersRow state={state} onNavigate={onNavigate} />
                        </div>
                    )}
                </div>
            </SettingsSection>

            <div id="provider-connections" className="scroll-mt-6">
                <SettingsSection title="Provider connections" description="Select a provider to configure authentication, its default model, and local runtime details.">
                    {providers.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 rounded-xl py-16 text-center" style={{ border: "1px dashed var(--c-border)" }}>
                            <Server01 className="size-8 text-quaternary" />
                            <p className="text-sm font-semibold text-primary">No providers yet</p>
                            <p className="text-sm text-tertiary">Providers load when the Brain connects.</p>
                        </div>
                    ) : (
                        <div
                            className="flex min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-xl @5xl/settings-page:flex-row"
                            style={{
                                background: "var(--surface-2)",
                                border: "1px solid var(--c-border)",
                            }}
                        >
                            {/* Provider rail */}
                            <nav className="flex min-w-0 shrink-0 flex-col border-b border-secondary @5xl/settings-page:w-56 @5xl/settings-page:border-r @5xl/settings-page:border-b-0" aria-label="Providers">
                                <p className="hidden px-4 pt-4 pb-2 text-[11px] font-semibold tracking-wider text-quaternary uppercase @5xl/settings-page:block">Providers</p>
                                <div className="flex min-w-0 gap-1 overflow-x-auto p-2 @5xl/settings-page:flex-col @5xl/settings-page:overflow-x-visible @5xl/settings-page:px-2 @5xl/settings-page:pb-3">
                                    {providers.map((config) => {
                                        const health = state.health.find((h) => h.provider === config.provider);
                                        const status = resolveProviderStatus(config, health, false);
                                        const active = selected?.provider === config.provider;
                                        return (
                                            <button
                                                key={config.provider}
                                                type="button"
                                                onClick={() => setSelectedId(config.provider)}
                                                className={cx(
                                                    "flex min-w-[10rem] shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition @5xl/settings-page:w-full @5xl/settings-page:min-w-0",
                                                    active ? "font-medium" : "hover:bg-[var(--surface-2)]",
                                                )}
                                                style={{
                                                    background: active ? "var(--sidebar-active-bg)" : undefined,
                                                    color: active ? "var(--sidebar-active-fg)" : "var(--c-text-secondary)",
                                                    boxShadow: active ? "inset 0 0 0 1px color-mix(in srgb, var(--brand) 30%, transparent)" : undefined,
                                                }}
                                            >
                                                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-2)]" style={{ border: "1px solid var(--c-border)" }}>
                                                    <BrandLogo domain={providerLogoDomain(config.provider)} name={providerLabel(config.provider)} size={18} />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block break-words text-sm">{providerLabel(config.provider)}</span>
                                                    <span className="block break-words text-[11px] text-quaternary">{status.label}</span>
                                                </span>
                                                <span
                                                    className="size-2 shrink-0 rounded-full"
                                                    style={{
                                                        background:
                                                            status.color === "success"
                                                                ? "var(--c-success, #22c55e)"
                                                                : status.color === "warning"
                                                                  ? "var(--c-warning, #f59e0b)"
                                                                  : status.color === "error"
                                                                    ? "var(--c-error, #ef4444)"
                                                                    : "var(--c-text-muted)",
                                                    }}
                                                />
                                            </button>
                                        );
                                    })}
                                </div>
                            </nav>

                            {/* Detail panel */}
                            {selected ? (
                                <ProviderDetail config={selected} settings={settings} state={state} actions={actions} />
                            ) : (
                                <div className="flex flex-1 items-center justify-center p-8 text-sm text-tertiary">Select a provider to configure.</div>
                            )}
                        </div>
                    )}
                </SettingsSection>
            </div>
        </div>
    );
};
