// @ts-nocheck
"use client";

// Coretex Relay — Agents studio (§10.2). Build your own agents: name, role, model,
// an uploaded logo, and a skill.md (a markdown system prompt). Everything is sent
// to createAgent, so the skill genuinely drives the agent (it becomes the system
// message in the agent's memory) and is persisted to ~/.coretex/agents/<id>/skill.md.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AgentRole, CoretexConfig, PermissionMode, ProviderType, VisualIdentity } from "@repo/coretex/types";
import { Edit01, Plus, Stars01, Terminal, Trash01, UploadCloud02, Users01, XClose } from "@untitledui/icons";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RichSelect } from "@/components/base/select/rich-select";
import { Toggle } from "@/components/base/toggle/toggle";
import { cx } from "@/utils/cx";
import { CoretexMonaco } from "../../files/monaco-editor";
import { providerLabel, roleLabel, statusLabel } from "../../labels";
import type { NavTarget } from "../../nav";
import {
    EXECUTABLE_CODING_ASSISTANT_IDS,
    codingAssistantCompatibilityDetail,
    codingAssistantReadyDetail,
    isCodingAssistantEnabled,
    isCodingAssistantReady,
    isProviderReady,
    providerLogoDomain,
} from "../../provider-meta";
import { AgentAccessPanel, type AgentAccessSelection } from "../../ui/agent-access-panel";
import { BrandLogo } from "../../ui/brand-logo";
import { ColorPicker } from "../../ui/color-picker";
import { HaltButton } from "../../ui/halt-button";
import { HelpTooltip } from "../../ui/help-tooltip";
import { IconPicker } from "../../ui/icon-picker";
import { IdentityAvatar } from "../../ui/identity-avatar";
import { ModelPicker } from "../../ui/model-picker";
import { PERMISSION_MODES, PermissionModeSelect } from "../../ui/permission-mode-select";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { formatTokens } from "../../use-coretex";
import { AiSettingsLinkCard } from "../ai-settings-link";
import { SettingsSection } from "../controls";
import { AGENT_ROLE_OPTIONS } from "../rich-select-options";
import { SettingsPageHeader, SettingsStatusBadge } from "../settings-shell";

/** Fitting default icon + color per role (used to seed new agents). */
const ROLE_IDENTITY: Record<string, { icon: string; color: string }> = {
    orchestrator: { icon: "Cube01", color: "#8b5cf6" },
    planner: { icon: "ClipboardCheck", color: "#ef4444" },
    researcher: { icon: "SearchLg", color: "#14b8a6" },
    developer: { icon: "Code02", color: "#3b82f6" },
    reviewer: { icon: "CheckCircle", color: "#22c55e" },
    writer: { icon: "Feather", color: "#f59e0b" },
    analyst: { icon: "BarChart01", color: "#6366f1" },
    devops: { icon: "Server01", color: "#667085" },
    qa: { icon: "ShieldTick", color: "#ec4899" },
    custom: { icon: "Stars01", color: "#3b82f6" },
};

const STATUS_COLOR: Record<string, "gray" | "brand" | "success" | "warning" | "error"> = {
    working: "success",
    thinking: "brand",
    paused: "warning",
    idle: "gray",
    error: "error",
};

function encodeModel(provider: string, model: string): string {
    return `${provider}|${model}`;
}
function decodeModel(value: string): { provider: string; model: string } {
    const idx = value.indexOf("|");
    return idx === -1 ? { provider: "", model: value } : { provider: value.slice(0, idx), model: value.slice(idx + 1) };
}
function skillTemplate(role: AgentRole): string {
    return `# ${roleLabel(role)} agent

You are a focused **${roleLabel(role)}** on the Coretex team.

## Responsibilities
- Describe what this agent should do.

## Working style
- Be concise, precise, and cite files when relevant.

When you have finished a task, end your final message with [DONE].
`;
}

// ---- Coding assistants: CLIs that bind to the same AI providers ----
const HarnessRegistry = ({
    settings,
    state,
    actions,
    onNavigate,
}: {
    settings: CoretexConfig;
    state: CoretexState;
    actions: CoretexActions;
    onNavigate?: (t: NavTarget) => void;
}) => {
    const harnesses = (settings.codingAgents ?? []).filter((h) => EXECUTABLE_CODING_ASSISTANT_IDS.has(h.id));

    const providerFor = (provider: string) => settings.aiProviders.find((x) => x.provider === provider);

    const setEnabled = (id: string, enabled: boolean): void => {
        const runtimePatch =
            id === "claude"
                ? { useClaudeSdkForClaude: enabled }
                : id === "codex"
                  ? { useCodexCliForOpenAI: enabled }
                  : id === "gemini"
                    ? { useGeminiCliForGemini: enabled }
                    : {};
        actions.updateSettings({
            codingAgents: (settings.codingAgents ?? []).map((h) => (h.id === id ? { ...h, enabled } : h)),
            agentRuntime: { ...settings.agentRuntime, ...runtimePatch },
        });
    };

    return (
        <SettingsSection
            title="Coding assistants"
            description="Executable Claude, Codex, and Gemini runtimes. Readiness comes from a live login or provider check."
        >
            <div className="flex flex-col gap-4 py-1">
                {onNavigate && (
                    <div className="flex justify-end">
                        <Button size="sm" color="secondary" onClick={() => onNavigate({ kind: "settings", page: "ai-providers" })}>
                            Configure providers
                        </Button>
                    </div>
                )}

                <div className="flex flex-col gap-2">
                    {harnesses.map((h) => {
                        const pcfg = providerFor(h.provider);
                        const health = state.health.find((item) => item.provider === h.provider);
                        const enabled = isCodingAssistantEnabled(settings, h);
                        const compatible = !codingAssistantCompatibilityDetail(settings, h);
                        const ready = isCodingAssistantReady(settings, h, health);
                        // Prefer LogoKit mark for the provider; keep harness logo when it differs (e.g. OpenCode).
                        const logo = h.logoDomain && h.logoDomain !== providerLogoDomain(h.provider) ? h.logoDomain : providerLogoDomain(h.provider);
                        return (
                            <div
                                key={h.id}
                                className="flex flex-col gap-3 rounded-xl px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between"
                                style={{
                                    background: "var(--surface-2)",
                                    border: "1px solid var(--c-border)",
                                }}
                            >
                                <div className="flex min-w-0 items-center gap-3">
                                    <BrandLogo domain={logo} name={h.name} size={28} />
                                    <div className="min-w-0">
                                        <p className="break-words text-sm font-medium text-primary" title={h.name}>{h.name}</p>
                                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-tertiary">
                                            <span className="inline-flex items-center gap-1">
                                                via
                                                <BrandLogo domain={providerLogoDomain(h.provider)} name={providerLabel(h.provider)} size={12} chip={false} />
                                                <span className="font-medium text-secondary">{providerLabel(h.provider)}</span>
                                            </span>
                                            <span>·</span>
                                            <span>{codingAssistantReadyDetail(settings, h, health)}</span>
                                        </p>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center justify-end gap-2">
                                    <BadgeWithDot type="pill-color" size="sm" color={ready ? "success" : enabled ? "warning" : "gray"}>
                                        {ready ? "Ready" : enabled ? "Unavailable" : "Off"}
                                    </BadgeWithDot>
                                    {!ready && onNavigate && (
                                        <Button size="sm" color="link-gray" onClick={() => onNavigate({ kind: "settings", page: "ai-providers" })}>
                                            Set up
                                        </Button>
                                    )}
                                    <div title={ready ? undefined : codingAssistantReadyDetail(settings, h, health)}>
                                        <Toggle
                                            aria-label={`Enable ${h.name}`}
                                            isSelected={enabled}
                                            isDisabled={!enabled && (!compatible || !isProviderReady(pcfg, health))}
                                            onChange={(v: boolean) => setEnabled(h.id, v)}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <p className="flex items-center gap-1.5 text-xs text-quaternary">
                    <Terminal className="size-3.5" />
                    Enabled runtimes are used automatically by matching agents; Claude Code also powers assisted terminals.
                </p>
            </div>
        </SettingsSection>
    );
};

export const AgentsSettingsPage = ({
    settings,
    state,
    actions,
    onNavigate,
}: {
    settings: CoretexConfig;
    state: CoretexState;
    actions: CoretexActions;
    onNavigate?: (t: NavTarget) => void;
}) => {
    useEffect(() => {
        actions.requestHealthCheck();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const liveProviders = new Set(
        settings.aiProviders
            .filter((provider) =>
                isProviderReady(
                    provider,
                    state.health.find((health) => health.provider === provider.provider),
                ),
            )
            .map((provider) => provider.provider),
    );
    const models = (state.models ?? []).filter((model) => liveProviders.has(model.provider));
    const firstModel = models[0];
    const aiEnabled = settings.ai?.enabled ?? true;

    const [name, setName] = useState("");
    const [role, setRole] = useState<AgentRole>("developer");
    const [modelValue, setModelValue] = useState(firstModel ? encodeModel(firstModel.provider, firstModel.id) : "");
    const [skill, setSkill] = useState(skillTemplate("developer"));
    const [avatarUrl, setAvatarUrl] = useState<string>("");
    const [iconName, setIconName] = useState<string>(ROLE_IDENTITY.developer.icon);
    const [themeColor, setThemeColor] = useState<string>(ROLE_IDENTITY.developer.color);
    const [permissionMode, setPermissionMode] = useState<PermissionMode>("ask");
    const [temperature, setTemperature] = useState("0.7");
    const [maxSteps, setMaxSteps] = useState("12");
    const [dailyTokenBudget, setDailyTokenBudget] = useState("0");
    const [canUseTerminal, setCanUseTerminal] = useState(true);
    const [connectorIds, setConnectorIds] = useState<string[]>([]);
    const [mcpServerIds, setMcpServerIds] = useState<string[]>([]);
    const [note, setNote] = useState("");
    const [showBuilder, setShowBuilder] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const agentDeletion = useConfirm();

    // Live preview of the identity being built.
    const previewIdentity: VisualIdentity = avatarUrl
        ? { icon: { kind: "upload", url: avatarUrl }, themeColor }
        : { icon: { kind: "untitled-ui", name: iconName }, themeColor };

    const { provider, model } = decodeModel(modelValue);
    const selectedModel = models.find((m) => m.provider === provider && m.id === model) ?? null;
    const temperatureValue = Number(temperature);
    const maxStepsValue = Number(maxSteps);
    const dailyTokenBudgetValue = Number(dailyTokenBudget);
    const tuningValid =
        Number.isFinite(temperatureValue) && temperatureValue >= 0 && temperatureValue <= 2 &&
        Number.isInteger(maxStepsValue) && maxStepsValue >= 1 && maxStepsValue <= 10_000 &&
        Number.isInteger(dailyTokenBudgetValue) && dailyTokenBudgetValue >= 0;
    const canCreate = aiEnabled && name.trim().length > 0 && provider.length > 0 && model.length > 0 && liveProviders.has(provider as ProviderType) && tuningValid;
    const accessSelection: AgentAccessSelection = {
        connectorIds,
        mcpServerIds,
        terminalAccess: canUseTerminal,
    };

    useEffect(() => {
        if (models.length === 0) {
            if (modelValue) setModelValue("");
            return;
        }
        if (!models.some((item) => encodeModel(item.provider, item.id) === modelValue)) {
            setModelValue(encodeModel(models[0].provider, models[0].id));
        }
    }, [models, modelValue]);

    const onLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setAvatarUrl(typeof reader.result === "string" ? reader.result : "");
        reader.readAsDataURL(file);
    };

    const onRoleChange = (next: AgentRole) => {
        setRole(next);
        // Refresh the template only if the user hasn't customised it.
        if (skill === skillTemplate(role)) setSkill(skillTemplate(next));
        // Seed a fitting icon + color when the user hasn't uploaded a logo.
        const ident = ROLE_IDENTITY[next] ?? ROLE_IDENTITY.custom;
        if (iconName === (ROLE_IDENTITY[role] ?? ROLE_IDENTITY.custom).icon) setIconName(ident.icon);
        if (themeColor === (ROLE_IDENTITY[role] ?? ROLE_IDENTITY.custom).color) setThemeColor(ident.color);
    };

    const handleCreate = () => {
        if (!canCreate) {
            setNote(
                models.length === 0
                    ? "No models available — connect a provider in AI providers first."
                    : !tuningValid
                      ? "Use a temperature from 0 to 2, 1–10,000 max steps, and a non-negative whole-number token budget."
                      : "Enter a name and pick a model.",
            );
            return;
        }
        actions.createAgent({
            name: name.trim(),
            role,
            provider: provider as ProviderType,
            model,
            systemPrompt: skill.trim() || undefined,
            temperature: temperatureValue,
            maxSteps: maxStepsValue,
            dailyTokenBudget: dailyTokenBudgetValue,
            ...(avatarUrl ? { avatarUrl } : {}),
            identity: previewIdentity,
            permissionMode,
            terminalAccess: canUseTerminal,
            connectorIds: connectorIds.length > 0 ? connectorIds : undefined,
            mcpServerIds: mcpServerIds.length > 0 ? mcpServerIds : undefined,
        });
        setName("");
        setAvatarUrl("");
        setNote("Agent created — its skill.md is now its system prompt and was saved to ~/.coretex/agents/<id>/skill.md.");
    };

    const agents = state.agents ?? [];

    return (
        <div className="flex flex-col gap-6">
            {agentDeletion.dialog}
            <SettingsPageHeader
                icon={Users01}
                title="Agents & assistants"
                subtitle="Create agents on ready AI providers. Coding assistants share the same logos, names, and connections."
                badges={
                    aiEnabled ? (
                        <SettingsStatusBadge label={`${agents.length} agents`} color="success" />
                    ) : (
                        <SettingsStatusBadge label="AI paused" color="warning" />
                    )
                }
            />

            <AiSettingsLinkCard settings={settings} health={state.health} variant="to-providers" onNavigate={onNavigate} agentCount={agents.length} />

            <SettingsSection title="Workspace controls" description="Control AI availability here, then manage deployed agents in the Agents workspace.">
                {/* Master AI kill-switch (§10.2): when off, all AI/agent execution is disabled Brain-side. */}
                <div className="flex flex-col items-start justify-between gap-3 py-4 first:pt-0 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--surface-2)" }}>
                            <Stars01 className="size-4.5 text-brand-secondary" />
                        </div>
                        <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
                                AI features
                                <HelpTooltip text="Master kill-switch for all AI and agent execution. Turn this off to halt every agent and disable model calls." />
                            </p>
                            <p className="text-xs text-tertiary">
                                {(settings.ai?.enabled ?? true)
                                    ? "Enabled — agents and model calls can run."
                                    : "Disabled — all AI and agent execution is paused."}
                            </p>
                        </div>
                    </div>
                    <Toggle
                        aria-label="Enable AI features"
                        isSelected={settings.ai?.enabled ?? true}
                        onChange={(v: boolean) => actions.setSetting("ai.enabled", v)}
                    />
                </div>

                {/* Primary builder lives in the Agents area now; this page keeps harnesses + a quick builder. */}
                <div className="flex flex-col items-start justify-between gap-3 py-4 last:pb-0 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--surface-2)" }}>
                            <Users01 className="size-4.5 text-brand-secondary" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-primary">Full agent roster</p>
                            <p className="text-xs text-tertiary">Deploy, edit skills, terminal access, and live controls in the Agents workspace.</p>
                        </div>
                    </div>
                    {onNavigate && (
                        <Button className="shrink-0" size="sm" color="primary" onClick={() => onNavigate({ kind: "agents" })}>
                            Open Agents
                        </Button>
                    )}
                </div>
            </SettingsSection>

            {/* Coding assistants */}
            <HarnessRegistry settings={settings} state={state} actions={actions} onNavigate={onNavigate} />

            {/* Quick builder (secondary; the Agents area is primary) */}
            <Button className="self-start" size="sm" color="secondary" iconLeading={showBuilder ? XClose : Plus} onClick={() => setShowBuilder((v) => !v)}>
                {showBuilder ? "Hide quick builder" : "Quick builder"}
            </Button>

            {showBuilder && (
                <SettingsSection title="New agent" description="These instructions become the agent's system prompt and are sent on every step.">
                    <div className="py-1">
                        {/* Identity row: logo + name + role */}
                        <div className="flex flex-col items-start gap-4 sm:flex-row">
                            <div className="flex flex-col items-center gap-2">
                                <IdentityAvatar identity={previewIdentity} name={name} avatarUrl={avatarUrl} size={64} />
                                <input ref={fileRef} type="file" accept="image/*" hidden onChange={onLogo} />
                                <div className="flex items-center gap-1">
                                    <Button size="sm" color="secondary" iconLeading={UploadCloud02} onClick={() => fileRef.current?.click()}>
                                        Logo
                                    </Button>
                                    {avatarUrl && (
                                        <button
                                            type="button"
                                            onClick={() => setAvatarUrl("")}
                                            title="Use an icon instead"
                                            className="rounded-md p-1 text-quaternary hover:text-secondary"
                                        >
                                            <XClose className="size-4" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field label="Name">
                                    <Input aria-label="Agent name" value={name} placeholder="e.g. Backend Dev" onChange={setName} />
                                </Field>
                                <Field label="Role">
                                    <RichSelect aria-label="Agent role" rich options={AGENT_ROLE_OPTIONS} value={role} onChange={(e) => onRoleChange(e.target.value as AgentRole)} />
                                </Field>
                                <Field label="Model" full>
                                    {models.length > 0 ? (
                                        <ModelPicker
                                            models={models}
                                            value={provider && model ? { provider: provider as ProviderType, id: model } : null}
                                            onChange={(p, id) => setModelValue(encodeModel(p, id))}
                                            capability="chat"
                                            placeholder="Select a model"
                                            onComparePricing={
                                                onNavigate
                                                    ? () =>
                                                          onNavigate({
                                                              kind: "settings",
                                                              page: "model-pricing",
                                                          })
                                                    : undefined
                                            }
                                        />
                                    ) : (
                                        <p className="text-xs text-quaternary">
                                            No models yet —{" "}
                                            {onNavigate ? (
                                                <button
                                                    type="button"
                                                    className="font-medium text-brand-secondary underline-offset-2 hover:underline"
                                                    onClick={() =>
                                                        onNavigate({
                                                            kind: "settings",
                                                            page: "ai-providers",
                                                        })
                                                    }
                                                >
                                                    connect an AI provider
                                                </button>
                                            ) : (
                                                "connect an AI provider"
                                            )}{" "}
                                            first.
                                        </p>
                                    )}
                                </Field>
                            </div>
                        </div>

                        {/* Identity — icon + theme color (hidden when a logo is uploaded). */}
                        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                            {!avatarUrl && (
                                <div className="flex flex-col gap-1.5">
                                    <span className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                                        Icon
                                        <HelpTooltip text="Pick an Untitled UI icon for this agent, or upload your own logo above." />
                                    </span>
                                    <IconPicker value={iconName} onChange={setIconName} color={themeColor} />
                                </div>
                            )}
                            <div className="flex flex-col gap-1.5">
                                <span className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                                    Theme color
                                    <HelpTooltip text="Tints the agent's avatar ring, badge, and terminal accent." />
                                </span>
                                <ColorPicker value={themeColor} onChange={setThemeColor} />
                            </div>
                        </div>

                        {/* Permission mode */}
                        <div className="mt-4 flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-secondary">Permission mode</span>
                            <PermissionModeSelect value={permissionMode} onChange={setPermissionMode} density="comfortable" />
                        </div>

                        <div className="mt-4">
                            <AgentAccessPanel
                                settings={settings}
                                state={state}
                                model={selectedModel}
                                provider={provider as ProviderType}
                                selection={accessSelection}
                                onChange={(next) => {
                                    setCanUseTerminal(next.terminalAccess);
                                    setConnectorIds(next.connectorIds);
                                    setMcpServerIds(next.mcpServerIds);
                                }}
                            />
                        </div>

                        {/* skill.md editor */}
                        <div className="mt-4">
                            <div className="mb-1.5 flex items-center gap-2">
                                <span className="text-xs font-medium text-secondary">
                                    Instructions <span className="text-quaternary">(skill.md)</span>
                                </span>
                                <span className="text-xs text-quaternary">— the markdown system prompt that drives this agent</span>
                            </div>
                            <div className="h-64 overflow-hidden rounded-lg" style={{ border: "1px solid var(--c-border)" }}>
                                <CoretexMonaco path="skill.md" value={skill} onChange={setSkill} />
                            </div>
                        </div>

                        {/* Tuning */}
                        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <Field label="Temperature">
                                <Input aria-label="Temperature" type="number" min={0} max={2} step={0.1} value={temperature} onChange={setTemperature} />
                            </Field>
                            <Field label="Max steps">
                                <Input aria-label="Maximum steps" type="number" min={1} max={10_000} step={1} value={maxSteps} onChange={setMaxSteps} />
                            </Field>
                            <Field label="Daily token budget (0 = unlimited)">
                                <Input aria-label="Daily token budget" type="number" min={0} step={1} value={dailyTokenBudget} onChange={setDailyTokenBudget} />
                            </Field>
                        </div>

                        <div className="mt-4 flex items-center justify-end gap-3 border-t pt-4" style={{ borderColor: "var(--c-border)" }}>
                            <Button size="md" color="primary" iconLeading={Plus} onClick={handleCreate} isDisabled={!canCreate}>
                                Create agent
                            </Button>
                        </div>
                        {note && <p className="mt-3 text-xs text-success-primary">{note}</p>}
                    </div>
                </SettingsSection>
            )}

            {/* Live agents */}
            <SettingsSection title="Live agents" description="Agents currently loaded in the local pool.">
                <div className="flex items-center justify-end gap-3">
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-quaternary">{agents.length} in pool</span>
                        {agents.length > 0 && <HaltButton onHalt={() => actions.haltAllAgents()} confirm label="Halt all" />}
                    </div>
                </div>

                {agents.length === 0 ? (
                    <p className="mt-4 text-sm text-tertiary">No agents in the pool yet. Create one above to get started.</p>
                ) : (
                    <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {agents.map((a) => {
                            const status = a.status ?? "idle";
                            const paused = status === "paused";
                            const active = status === "working" || status === "thinking";
                            const mode = a.config.permissionMode ?? "ask";
                            const modeLabel = PERMISSION_MODES.find((m) => m.value === mode)?.label ?? "Ask";
                            const providerHealth = state.health.find((item) => item.provider === a.config.provider);
                            const providerReady = isProviderReady(
                                settings.aiProviders.find((item) => item.provider === a.config.provider),
                                providerHealth,
                            );
                            return (
                                <div
                                    key={a.id}
                                    className="flex items-start gap-3 rounded-xl p-4"
                                    style={{
                                        background: "var(--surface-2)",
                                        border: "1px solid var(--c-border)",
                                    }}
                                >
                                    <IdentityAvatar identity={a.config.identity} name={a.config.name} avatarUrl={a.config.avatarUrl} size={36} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="break-words text-sm font-semibold text-primary" title={a.config.name}>{a.config.name}</p>
                                                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-tertiary">
                                                    <span>{roleLabel(a.config.role)}</span>
                                                    <span>·</span>
                                                    <span className="inline-flex items-center gap-1">
                                                        <BrandLogo
                                                            domain={providerLogoDomain(a.config.provider)}
                                                            name={providerLabel(a.config.provider)}
                                                            size={12}
                                                            chip={false}
                                                        />
                                                        {providerLabel(a.config.provider)}
                                                    </span>
                                                    <span>·</span>
                                                    <span className="break-all" title={a.config.model}>{a.config.model}</span>
                                                </p>
                                            </div>
                                            <BadgeWithDot size="sm" color={STATUS_COLOR[status] ?? "gray"}>
                                                {statusLabel(status)}
                                            </BadgeWithDot>
                                        </div>
                                        <div className="mt-2 flex items-center gap-2">
                                            <Badge size="sm" color={mode === "bypass" ? "error" : "gray"}>
                                                {modeLabel}
                                            </Badge>
                                            <Badge size="sm" color={providerReady ? "success" : "error"}>
                                                {providerReady ? "Provider live" : "Provider unavailable"}
                                            </Badge>
                                        </div>
                                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                            <span className="text-xs text-quaternary tabular-nums">{formatTokens(a.tokensUsedToday ?? 0)} tokens today</span>
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                {active && <HaltButton onHalt={() => actions.haltAgent(a.id)} label="Halt" />}
                                                {paused ? (
                                                    <Button size="sm" color="secondary" onClick={() => actions.resumeAgent(a.id)}>
                                                        Resume
                                                    </Button>
                                                ) : (
                                                    <Button size="sm" color="secondary" onClick={() => actions.pauseAgent(a.id)}>
                                                        Pause
                                                    </Button>
                                                )}
                                                {onNavigate && (
                                                    <Button size="sm" color="secondary" iconLeading={Edit01} onClick={() => onNavigate({ kind: "agents" })}>
                                                        Edit
                                                    </Button>
                                                )}
                                                <Button
                                                    size="sm"
                                                    color="link-destructive"
                                                    iconLeading={Trash01}
                                                    onClick={() =>
                                                        agentDeletion.confirm({
                                                            title: `Remove ${a.config.name}?`,
                                                            description:
                                                                "This removes the agent from the local pool and deletes its saved agent configuration. This cannot be undone.",
                                                            confirmLabel: "Remove agent",
                                                            onConfirm: () => actions.removeAgent(a.id),
                                                        })
                                                    }
                                                >
                                                    Remove
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </SettingsSection>
        </div>
    );
};

const Field = ({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) => (
    <div className={cx("flex flex-col gap-1.5", full && "sm:col-span-2")}>
        <span className="text-xs font-medium text-secondary">{label}</span>
        {children}
    </div>
);
