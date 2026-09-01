// @ts-nocheck
"use client";

// Coretex Relay — Agents: a dedicated top-level surface to manage ALL agents.
// Deploy one or many at once, stop all / start (resume) all, and per-agent
// stop / pause / resume / remove + permission mode. Reuses the live pool state.

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, PauseCircle, Plus, Trash01, Users01, Rocket01, Edit01, Terminal, ChevronDown, ChevronRight, ShieldTick, CpuChip01, Grid01, Share07, Send01, CheckSquare, XClose, FilterFunnel01, Maximize01 } from "@untitledui/icons";
import type { AgentRole, AgentSkill, AgentState, ClaudeExecutionMode, PermissionMode, ProviderType, TaskPriority } from "@repo/coretex/types";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { Button } from "@/components/base/buttons/button";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { Toggle } from "@/components/base/toggle/toggle";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import { Slider } from "@/components/base/slider/slider";
import { cx } from "@/utils/cx";









import { AGENT_STATUS_COLOR, liveModels, modelAvailability, formatTokens, formatUSD, roleColor, priorityColor, type CoretexActions, type CoretexState } from "../use-coretex";
import { providerLabel, roleLabel, statusLabel } from "../labels";
import { IdentityAvatar } from "../ui/identity-avatar";
import { HaltButton } from "../ui/halt-button";
import { PermissionModeSelect } from "../ui/permission-mode-select";
import { ModelPicker } from "../ui/model-picker";
import { ClaudeTierBadge, ClaudeTierSelect } from "../ui/claude-tier-badge";
import { HelpTooltip } from "../ui/help-tooltip";
import { AgentAccessPanel, type AgentAccessSelection } from "../ui/agent-access-panel";
import { AgentConnectionStrip } from "../panels/agent-connection-strip";
import { useContextMenu, type MenuItem } from "../ui/context-menu";
import type { NavTarget } from "../nav";
import { AgentsCanvas, type AgentsCanvasControls } from "./agents-canvas";
import { CanvasActionDock } from "./canvas-action-dock";
import { PERMISSION_MODES } from "../ui/permission-mode-select";
import { CLAUDE_TIERS, CLAUDE_TIER_ORDER } from "../claude-tiers";
import { pillSelectClass } from "../ui/pill-select";
import { STRENGTHS, STRENGTH_ORDER, topStrengths, agentStrengths, type StrengthKey } from "../ui/model-strengths";

const cardStyle = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;
const ROLES: AgentRole[] = ["orchestrator", "planner", "researcher", "developer", "reviewer", "writer", "analyst", "devops", "qa", "custom"];

const AGENTS_VIEW_KEY = "coretex-agents-view-mode";

/** Compact "good at" strength chips derived from an agent's role + model. */
const StrengthChips = ({ agent, max = 3 }: { agent: AgentState; max?: number }) => {
    const keys = topStrengths({ role: agent.config.role, provider: agent.config.provider, model: agent.config.model }, max);
    if (keys.length === 0) return null;
    return (
        <div className="flex flex-wrap items-center gap-1">
            {keys.map((k) => {
                const s = STRENGTHS[k];
                const Icon = s.icon;
                return (
                    <span
                        key={k}
                        title={s.hint}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-secondary"
                        style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                    >
                        <Icon className="size-3 text-quaternary" /> {s.label}
                    </span>
                );
            })}
        </div>
    );
};

/** Online / offline connection pill for a single agent (green = provider reachable + model live). */
const ConnPill = ({ online }: { online: boolean }) => (
    <span
        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
        style={{
            background: online ? "color-mix(in srgb, var(--c-success, #22c55e) 15%, transparent)" : "var(--surface-2)",
            color: online ? "var(--c-success, #16a34a)" : "var(--c-text-muted)",
        }}
        title={online ? "Online — provider reachable and model is live" : "Offline — provider or model unavailable"}
    >
        <span className="size-1.5 rounded-full" style={{ background: online ? "var(--c-success, #22c55e)" : "var(--c-text-muted)" }} />
        {online ? "Online" : "Offline"}
    </span>
);

export const AgentsView = ({ state, actions, onNavigate }: { state: CoretexState; actions: CoretexActions; onNavigate?: (t: NavTarget) => void }) => {
    const agents = state.agents ?? [];
    const models = liveModels(state);
    // Grid roster vs. Figma-style canvas whiteboard (persisted).
    const [view, setView] = useState<"grid" | "canvas">(() => {
        if (typeof window === "undefined") return "grid";
        return window.localStorage.getItem(AGENTS_VIEW_KEY) === "canvas" ? "canvas" : "grid";
    });
    const canvasControls = useRef<AgentsCanvasControls>(null);
    const [canvasInspectorOpen, setCanvasInspectorOpen] = useState(false);
    const chooseView = (v: "grid" | "canvas") => {
        setView(v);
        if (v === "grid") setCanvasInspectorOpen(false);
        try { window.localStorage.setItem(AGENTS_VIEW_KEY, v); } catch { /* ignore */ }
    };

    const counts = useMemo(() => {
        const by = (s: AgentState["status"]) => agents.filter((a) => a.status === s).length;
        return { total: agents.length, working: by("working") + by("thinking"), paused: by("paused"), idle: by("idle") };
    }, [agents]);

    const pausedCount = counts.paused;
    const resumableCount = agents.filter((agent) => agent.status === "paused" && modelAvailability(state, agent.config.provider, agent.config.model).available).length;
    const canvasConnectionsVisible = state.agentCanvas?.showConnections ?? true;

    // ---- Roster: capability filter + multi-select + task dispatch ----
    const [capFilter, setCapFilter] = useState<StrengthKey | null>(null);
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [assignOpen, setAssignOpen] = useState(false);

    // Which strengths actually appear in the fleet — only offer those as filters.
    const availableStrengths = useMemo(() => {
        const seen = new Set<StrengthKey>();
        for (const a of agents) for (const k of agentStrengths({ role: a.config.role, provider: a.config.provider, model: a.config.model })) seen.add(k);
        return STRENGTH_ORDER.filter((k) => seen.has(k));
    }, [agents]);

    const rosterAgents = useMemo(() => {
        if (!capFilter) return agents;
        return agents.filter((a) => agentStrengths({ role: a.config.role, provider: a.config.provider, model: a.config.model }).includes(capFilter));
    }, [agents, capFilter]);

    const toggleSelected = (id: string) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const clearSelection = () => setSelected(new Set());
    const selectAllVisible = () => setSelected(new Set(rosterAgents.map((a) => a.id)));
    const selectedAgents = agents.filter((a) => selected.has(a.id));

    // Live pool updates can remove agents from underneath selection mode. Prune
    // stale ids so the bulk bar never advertises actions for missing agents.
    useEffect(() => {
        const liveIds = new Set(agents.map((agent) => agent.id));
        setSelected((previous) => {
            const next = new Set([...previous].filter((id) => liveIds.has(id)));
            return next.size === previous.size ? previous : next;
        });
    }, [agents]);

    // ---- Deploy form ----
    const [showDeploy, setShowDeploy] = useState(false);
    const [name, setName] = useState("");
    const [role, setRole] = useState<AgentRole>("developer");
    const [modelValue, setModelValue] = useState("");
    const [count, setCount] = useState(1);
    const [terminalAccess, setTerminalAccess] = useState(true);
    const [executionMode, setExecutionMode] = useState<ClaudeExecutionMode>("autonomous");
    const [advanced, setAdvanced] = useState(false);
    const [systemPrompt, setSystemPrompt] = useState("");
    const [temperature, setTemperature] = useState(0.7);
    const [connectorIds, setConnectorIds] = useState<string[]>([]);
    const [mcpServerIds, setMcpServerIds] = useState<string[]>([]);

    const modelOptions = models.map((m) => ({ label: `${providerLabel(m.provider)} · ${m.name}`, value: `${m.provider}::${m.id}` }));
    const effectiveModel = modelValue || modelOptions[0]?.value || "";
    const [provider, model] = effectiveModel.split("::");
    const selectedModel = models.find((m) => m.provider === provider && m.id === model) ?? null;
    const deploymentAvailability = modelAvailability(state, provider as ProviderType | undefined, model);
    const canDeploy = name.trim().length > 0 && !!provider && !!model && deploymentAvailability.available;

    const accessSelection: AgentAccessSelection = { connectorIds, mcpServerIds, terminalAccess };
    const setAccess = (next: AgentAccessSelection): void => {
        setTerminalAccess(next.terminalAccess);
        setConnectorIds(next.connectorIds);
        setMcpServerIds(next.mcpServerIds);
    };

    const deploy = () => {
        if (!canDeploy) return;
        const config = {
            name: name.trim(),
            role,
            provider: provider as ProviderType,
            model,
            terminalAccess,
            executionMode,
            temperature,
            connectorIds: connectorIds.length > 0 ? connectorIds : undefined,
            mcpServerIds: mcpServerIds.length > 0 ? mcpServerIds : undefined,
            ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
        };
        if (count > 1) actions.createAgents(config, count);
        else actions.createAgent(config);
        setName("");
        setSystemPrompt("");
    };

    const [editing, setEditing] = useState<AgentState | null>(null);
    const ctxMenu = useContextMenu();
    const [removeArmed, setRemoveArmed] = useState<string | null>(null);
    const remove = (id: string) => {
        if (removeArmed === id) {
            actions.haltAgent(id);
            actions.removeAgent(id);
            setRemoveArmed(null);
        } else {
            setRemoveArmed(id);
            window.setTimeout(() => setRemoveArmed((cur) => (cur === id ? null : cur)), 3000);
        }
    };

    // Right-click menu for an agent card — mirrors the card's own buttons + the
    // inline permission-mode / execution-tier selectors, built from CoretexActions.
    const buildAgentMenu = (a: AgentState): MenuItem[] => {
        const active = a.status === "working" || a.status === "thinking";
        const isPaused = a.status === "paused";
        const runtime = modelAvailability(state, a.config.provider, a.config.model);
        const curPermission: PermissionMode = a.config.permissionMode ?? "ask";
        const curTier: ClaudeExecutionMode = a.config.executionMode ?? "autonomous";
        return [
            { header: a.config.name },
            ...(onNavigate ? [{ key: "open", label: "Open agent", icon: ChevronRight, onClick: () => onNavigate({ kind: "agent", id: a.id }) } as MenuItem, { separator: true } as MenuItem] : []),
            isPaused
                ? { key: "resume", label: "Resume", icon: Play, disabled: !runtime.available, onClick: () => actions.resumeAgent(a.id) }
                : { key: "pause", label: "Pause", icon: PauseCircle, disabled: a.status === "error", onClick: () => actions.pauseAgent(a.id) },
            { key: "halt", label: "Halt", danger: true, disabled: !active, onClick: () => actions.haltAgent(a.id) },
            { separator: true },
            { key: "console", label: "Open console", icon: Terminal, onClick: () => actions.terminalCreate({ agentId: a.id, projectId: a.config.tags?.[0] }) },
            { key: "edit", label: "Edit…", icon: Edit01, onClick: () => setEditing(a) },
            { separator: true },
            {
                key: "permission",
                label: "Permission mode",
                icon: ShieldTick,
                submenu: PERMISSION_MODES.map<MenuItem>((m) => ({
                    key: `perm-${m.value}`,
                    label: m.label,
                    checked: curPermission === m.value,
                    onClick: () => actions.setAgentPermissionMode(a.id, m.value),
                })),
            },
            {
                key: "tier",
                label: "Execution tier",
                icon: CpuChip01,
                submenu: CLAUDE_TIER_ORDER.map<MenuItem>((mode) => ({
                    key: `tier-${mode}`,
                    label: CLAUDE_TIERS[mode].label,
                    icon: CLAUDE_TIERS[mode].icon,
                    checked: curTier === mode,
                    onClick: () => actions.updateAgent(a.config.id, { executionMode: mode }),
                })),
            },
            { separator: true },
            { key: "remove", label: removeArmed === a.id ? "Confirm remove" : "Remove", icon: Trash01, danger: true, onClick: () => remove(a.id) },
        ];
    };

    return (
        <div className="relative flex h-full min-h-0 w-full flex-col gap-5 overflow-hidden pb-28 min-w-0">
            {/* Header + global controls */}
            <div className="flex flex-col items-stretch gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 w-full items-center gap-2.5 xl:w-auto xl:flex-1">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg" style={cardStyle}>
                        <Users01 className="size-5 text-secondary" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-lg font-semibold text-primary">Agents</h1>
                        <p className="mt-0.5 text-sm text-tertiary">Deploy and manage your whole agent fleet — stop, start, and resume in bulk or one at a time.</p>
                    </div>
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
                    <span className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs" style={cardStyle}>
                        <span className="font-semibold text-success-primary">{counts.working}</span><span className="text-tertiary">active</span>
                        <span className="text-quaternary">·</span>
                        <span className="font-semibold text-warning-primary">{counts.paused}</span><span className="text-tertiary">paused</span>
                        <span className="text-quaternary">·</span>
                        <span className="font-semibold text-primary">{counts.total}</span><span className="text-tertiary">total</span>
                    </span>
                    <Button size="sm" color="secondary" iconLeading={Play} onClick={() => actions.resumeAllAgents()} isDisabled={pausedCount === 0 || resumableCount === 0}>
                        Resume all
                    </Button>
                    <Button size="sm" color="secondary" iconLeading={PauseCircle} onClick={() => actions.pauseAllAgents()} isDisabled={counts.working === 0 && counts.idle === 0}>
                        Pause all
                    </Button>
                    <HaltButton confirm label="Stop all" onHalt={() => actions.haltAllAgents()} />
                </div>
            </div>

            {/* Assistant connections — which AI backends are online/offline right now. */}
            <AgentConnectionStrip state={state} actions={actions} onNavigate={onNavigate} />

            <div className={cx("flex min-h-0 flex-1 flex-col gap-5 pr-1", view === "canvas" && !showDeploy ? "overflow-hidden" : "overflow-y-auto")}>

            {/* Roster controls: filter by what agents are good at + enter selection mode
                to deploy or dispatch a task to several agents at once. */}
            {agents.length > 0 && view === "grid" && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-tertiary">
                        <FilterFunnel01 className="size-3.5" /> Good at
                    </span>
                    <button
                        type="button"
                        onClick={() => setCapFilter(null)}
                        className={pillSelectClass(capFilter === null)}
                    >
                        <Badge size="md" color="gray" type="color">All</Badge>
                    </button>
                    {availableStrengths.map((k) => {
                        const s = STRENGTHS[k];
                        const Icon = s.icon;
                        return (
                            <button key={k} type="button" onClick={() => setCapFilter((cur) => (cur === k ? null : k))} title={s.hint} className={pillSelectClass(capFilter === k)}>
                                <Badge size="md" color={s.color} type="color"><Icon className="mr-1 inline size-3" />{s.label}</Badge>
                            </button>
                        );
                    })}
                    <div className="ml-auto flex items-center gap-2">
                        {selectMode && (
                            <>
                                <button type="button" onClick={selectAllVisible} className="text-xs font-medium text-tertiary transition hover:text-secondary">Select all</button>
                                <span className="text-quaternary">·</span>
                            </>
                        )}
                        <Button size="sm" color={selectMode ? "primary" : "secondary"} iconLeading={CheckSquare} onClick={() => { setSelectMode((v) => !v); if (selectMode) clearSelection(); }}>
                            {selectMode ? "Done selecting" : "Select"}
                        </Button>
                    </div>
                </div>
            )}

            {/* Deploy panel */}
            {showDeploy && (
                <div className="rounded-xl p-4" style={cardStyle}>
                    <div className="mb-3 flex items-center gap-2">
                        <Rocket01 className="size-4 text-[var(--brand)]" />
                        <span className="text-sm font-semibold text-primary">Deploy agents</span>
                    </div>
                    {models.length === 0 ? (
                        <p role="alert" className="text-sm text-warning-primary">{deploymentAvailability.reason ?? "No live models are available. Connect a provider in Settings."}</p>
                    ) : (
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-wrap items-end gap-3">
                                <Field label="Name">
                                    <div className="w-44">
                                        <Input value={name} onChange={(v) => setName(v)} placeholder="Backend Dev" size="sm" />
                                    </div>
                                </Field>
                                <Field label="Model">
                                    {/* Provider-grouped picker with brand logos: pick Ollama→its models, Claude→Claude models, etc. */}
                                    <ModelPicker
                                        models={models}
                                        value={provider && model ? { provider: provider as ProviderType, id: model } : null}
                                        onChange={(p, id) => setModelValue(`${p}::${id}`)}
                                        capability="chat"
                                        placeholder="Select a model"
                                        isDisabled={!state.connected || models.length === 0}
                                        unavailableReason={deploymentAvailability.reason}
                                    />
                                </Field>
                                <Field label="How many">
                                    <div className="w-20">
                                        <Input type="number" value={String(count)} onChange={(v) => setCount(Math.max(1, Math.min(20, Number(v) || 1)))} size="sm" />
                                    </div>
                                </Field>
                                <Button size="md" color="primary" iconLeading={Rocket01} onClick={deploy} isDisabled={!canDeploy}>
                                    Deploy {count > 1 ? `${count} agents` : "agent"}
                                </Button>
                            </div>
                            {/* Role — colored pills (uniform with role tags elsewhere) */}
                            <Field label="Role">
                                <div className="flex flex-wrap gap-2">
                                    {ROLES.map((r) => {
                                        const on = role === r;
                                        return (
                                            <button key={r} type="button" onClick={() => setRole(r)} title={`${roleLabel(r)} role`} className={pillSelectClass(on)}>
                                                <Badge size="md" color={roleColor(r, state.settings)} type="color">{roleLabel(r)}</Badge>
                                            </button>
                                        );
                                    })}
                                </div>
                            </Field>

                            {/* Model + role abilities, connectors, MCP */}
                            {state.settings && (
                                <AgentAccessPanel
                                    settings={state.settings}
                                    state={state}
                                    model={selectedModel}
                                    provider={provider as ProviderType}
                                    selection={accessSelection}
                                    onChange={setAccess}
                                    density="compact"
                                />
                            )}

                            {/* Execution tier — which Claude mechanism backs this agent. */}
                            <Field label="Execution mode">
                                <div className="flex items-center gap-2">
                                    <ClaudeTierSelect value={executionMode} onChange={setExecutionMode} />
                                    <HelpTooltip text="Conversational = LLM hub chat. Assisted = Claude Code in a terminal. Autonomous = Agent SDK runs to completion headlessly (default)." />
                                </div>
                            </Field>

                            {/* Advanced — optional tuning + starting instructions */}
                            <button type="button" onClick={() => setAdvanced((v) => !v)} className="flex w-fit items-center gap-1 text-xs font-medium text-tertiary transition hover:text-secondary">
                                {advanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                                Advanced
                            </button>
                            {advanced && (
                                <div className="flex flex-col gap-4 rounded-lg p-3" style={{ background: "var(--surface-2)" }}>
                                    <Field label={`Temperature · ${temperature.toFixed(2)}`}>
                                        <Slider minValue={0} maxValue={2} step={0.05} value={temperature} onChange={(v) => setTemperature(typeof v === "number" ? v : v[0])} />
                                    </Field>
                                    <Field label="Instructions (optional)">
                                        <TextArea value={systemPrompt} onChange={(v) => setSystemPrompt(v)} rows={5} placeholder="Describe how this agent should work. Leave blank to use a sensible default for the role." textAreaClassName="resize-y font-mono text-xs" />
                                    </Field>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Roster */}
            {agents.length === 0 ? (
                <div className="relative min-h-72 overflow-hidden rounded-xl border border-dashed border-secondary bg-primary px-6 py-10">
                    <EmptyState size="sm">
                        <EmptyState.Header>
                            <EmptyState.FeaturedIcon icon={Users01} color="brand" theme="gradient" />
                        </EmptyState.Header>
                        <EmptyState.Content>
                            <EmptyState.Title>No agents deployed</EmptyState.Title>
                            <EmptyState.Description>
                                Deploy your first agent to start working tasks. Pick a role, model, and how many to spin up.
                            </EmptyState.Description>
                        </EmptyState.Content>
                        <EmptyState.Footer>
                            <Button size="md" color="primary" iconLeading={Rocket01} onClick={() => setShowDeploy(true)}>
                                Deploy an agent
                            </Button>
                        </EmptyState.Footer>
                    </EmptyState>
                </div>
            ) : view === "canvas" ? (
                <AgentsCanvas ref={canvasControls} state={state} actions={actions} onNavigate={onNavigate} onEditAgent={setEditing} onInspectorOpenChange={setCanvasInspectorOpen} />
            ) : rosterAgents.length === 0 ? (
                <div className="rounded-xl p-8 text-center" style={cardStyle}>
                    <p className="text-sm text-tertiary">No agents are good at <span className="font-medium text-secondary">{capFilter ? STRENGTHS[capFilter].label : ""}</span> yet.</p>
                    <Button className="mt-3" size="sm" color="secondary" onClick={() => setCapFilter(null)}>Clear filter</Button>
                </div>
            ) : (
                <div className="grid min-w-0 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-2 2xl:grid-cols-3">
                    {rosterAgents.map((a) => {
                        const active = a.status === "working" || a.status === "thinking";
                        const isPaused = a.status === "paused";
                        const runtime = modelAvailability(state, a.config.provider, a.config.model);
                        const isSel = selected.has(a.id);
                        return (
                            <div
                                key={a.id}
                                className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl p-4 transition"
                                style={{ ...cardStyle, ...(isSel ? { borderColor: "var(--brand)", boxShadow: "0 0 0 2px color-mix(in srgb, var(--brand) 22%, transparent)" } : null) }}
                                onContextMenu={(e) => ctxMenu.open(e, buildAgentMenu(a))}
                                onClick={selectMode ? (e) => { if ((e.target as HTMLElement).closest("button,a,input,[role='menuitem']")) return; toggleSelected(a.id); } : undefined}
                            >
                                <div className="flex min-w-0 items-start gap-3">
                                    {selectMode && (
                                        <Checkbox isSelected={isSel} onChange={() => toggleSelected(a.id)} aria-label={`Select ${a.config.name}`} className="mt-1" />
                                    )}
                                    <span className="relative shrink-0">
                                        <IdentityAvatar identity={a.config.identity} name={a.config.name} avatarUrl={a.config.avatarUrl} size={38} />
                                        <span
                                            aria-hidden
                                            className={cx("absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-[var(--surface)]", active && "animate-pulse")}
                                            style={{ background: runtime.available ? "var(--c-success, #22c55e)" : "var(--c-text-muted)" }}
                                            title={runtime.available ? "Online" : "Offline"}
                                        />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-start gap-2">
                                            {onNavigate ? (
                                                <button type="button" onClick={() => onNavigate({ kind: "agent", id: a.id })} title={a.config.name} aria-label={`Open ${a.config.name}`} className="min-w-0 flex-1 break-words text-left text-sm font-semibold leading-5 text-primary transition [overflow-wrap:anywhere] hover:text-brand-secondary">{a.config.name}</button>
                                            ) : (
                                                <span className="min-w-0 flex-1 break-words text-sm font-semibold leading-5 text-primary [overflow-wrap:anywhere]" title={a.config.name}>{a.config.name}</span>
                                            )}
                                        </div>
                                        <p className="mt-0.5 break-words text-xs text-tertiary [overflow-wrap:anywhere]" title={`${providerLabel(a.config.provider)} · ${a.config.model}`}>{providerLabel(a.config.provider)} · {a.config.model}</p>
                                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                            <Badge type="color" size="sm" color={roleColor(a.config.role, state.settings)}>{roleLabel(a.config.role)}</Badge>
                                            <ClaudeTierBadge mode={a.config.executionMode ?? "autonomous"} />
                                            {runtime.available ? (
                                                <BadgeWithDot type="color" size="sm" color={AGENT_STATUS_COLOR[a.status]}>{statusLabel(a.status)}</BadgeWithDot>
                                            ) : (
                                                <Tooltip title="Unavailable" description={runtime.reason} placement="top">
                                                    <TooltipTrigger className="cursor-help">
                                                        <BadgeWithDot type="color" size="sm" color="error">Unavailable</BadgeWithDot>
                                                    </TooltipTrigger>
                                                </Tooltip>
                                            )}
                                        </div>
                                        <div className="mt-1.5"><StrengthChips agent={a} /></div>
                                        {(a.config.terminalAccess !== false || (a.config.connectorIds?.length ?? 0) > 0 || (a.config.mcpServerIds?.length ?? 0) > 0) && (
                                            <p className="mt-1 flex flex-wrap gap-1">
                                                {a.config.terminalAccess !== false && <Badge size="sm" color="gray" type="color">Terminal</Badge>}
                                                {(a.config.mcpServerIds?.length ?? 0) > 0 && <Badge size="sm" color="brand" type="color">{a.config.mcpServerIds!.length} MCP</Badge>}
                                                {(a.config.connectorIds?.length ?? 0) > 0 && <Badge size="sm" color="brand" type="color">{a.config.connectorIds!.length} connectors</Badge>}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-quaternary">
                                    <span>{a.stepCount} steps</span>
                                    <span>{formatTokens(a.tokensUsedToday)} today</span>
                                    <span>{formatUSD(a.costToday)}</span>
                                    {a.currentTaskId && <span className="truncate text-brand-secondary">on a task</span>}
                                </div>

                                <PermissionModeSelect value={a.config.permissionMode ?? "ask"} onChange={(mode) => actions.setAgentPermissionMode(a.id, mode)} />

                                <div className="flex flex-wrap items-center gap-1.5 border-t pt-2.5" style={{ borderColor: "var(--c-border)" }}>
                                    <Button size="sm" color="secondary" iconLeading={Edit01} onClick={() => setEditing(a)}>Edit</Button>
                                    {active && <HaltButton label="Stop" onHalt={() => actions.haltAgent(a.id)} />}
                                    {isPaused ? (
                                        <Button size="sm" color="secondary" iconLeading={Play} isDisabled={!runtime.available} onClick={() => actions.resumeAgent(a.id)}>Resume</Button>
                                    ) : (
                                        a.status !== "error" && <Button size="sm" color="secondary" iconLeading={PauseCircle} onClick={() => actions.pauseAgent(a.id)}>Pause</Button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => remove(a.id)}
                                        className={cx("ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition", removeArmed === a.id ? "text-white" : "text-error-primary hover:bg-[var(--surface-2)]")}
                                        style={removeArmed === a.id ? { background: "#ef4444" } : undefined}
                                    >
                                        <Trash01 className="size-3.5" /> {removeArmed === a.id ? "Confirm" : "Remove"}
                                    </button>
                                </div>
                                {a.status === "error" && a.errorMessage && <p className="text-xs text-error-primary">{a.errorMessage}</p>}
                                {!runtime.available && <p className="text-xs text-error-primary">{runtime.reason}</p>}
                            </div>
                        );
                    })}
                </div>
            )}
            </div>

            {/* Bulk action bar — deploy/resume, pause, stop, or dispatch one task to the
                whole selection so specialists can collaborate on the same work. */}
            {selectMode && selected.size > 0 && (
                <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4">
                    <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2 shadow-2xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                        <span className="px-1 text-sm font-semibold text-primary">{selected.size} selected</span>
                        <span className="mx-0.5 h-5 w-px" style={{ background: "var(--c-border)" }} />
                        <Button size="sm" color="primary" iconLeading={Send01} onClick={() => setAssignOpen(true)}>Assign task</Button>
                        <Button size="sm" color="secondary" iconLeading={Play} onClick={() => selectedAgents.forEach((a) => { if (a.status === "paused" && modelAvailability(state, a.config.provider, a.config.model).available) actions.resumeAgent(a.id); })}>Resume</Button>
                        <Button size="sm" color="secondary" iconLeading={PauseCircle} onClick={() => selectedAgents.forEach((a) => { if (a.status !== "paused" && a.status !== "error") actions.pauseAgent(a.id); })}>Pause</Button>
                        <HaltButton label="Stop" onHalt={() => selectedAgents.forEach((a) => { if (a.status === "working" || a.status === "thinking") actions.haltAgent(a.id); })} />
                        <button type="button" onClick={clearSelection} className="ml-1 rounded-md p-1.5 text-quaternary transition hover:text-secondary" title="Clear selection"><XClose className="size-4" /></button>
                    </div>
                </div>
            )}

            {/* The contextual bulk bar replaces the dock while a selection is active,
                so the two fixed bottom surfaces never obscure each other. */}
            {selected.size === 0 && (
                <CanvasActionDock
                    label="Agent views and canvas actions"
                    viewModes={[
                        { id: "grid", label: "Grid", icon: Grid01, description: "Browse agent cards and bulk-select the fleet" },
                        { id: "canvas", label: "Graph", icon: Share07, description: "Arrange agents and inspect project connections", disabled: agents.length === 0 },
                    ] as const}
                    activeView={agents.length === 0 ? "grid" : view}
                    onViewChange={chooseView}
                    inspectorOpen={view === "canvas" && canvasInspectorOpen}
                    actions={view === "canvas" ? [
                        { id: "arrange", label: "Arrange agents", icon: Grid01, description: "Arrange unpinned cards without changing agent runtime", disabled: agents.length === 0, onClick: () => canvasControls.current?.autoArrange() },
                        { id: "connections", label: canvasConnectionsVisible ? "Hide connections" : "Show connections", icon: Share07, description: "Toggle saved project connection wires", active: canvasConnectionsVisible, disabled: agents.length === 0, onClick: () => canvasControls.current?.toggleConnections() },
                        { id: "fit", label: "Fit graph", icon: Maximize01, description: "Frame every agent card", disabled: agents.length === 0, onClick: () => canvasControls.current?.fit() },
                    ] : []}
                    primaryAction={{
                        id: "deploy-agent",
                        label: showDeploy ? "Close deploy" : "Deploy agent",
                        icon: showDeploy ? XClose : Rocket01,
                        description: showDeploy ? "Close the agent deployment form" : "Open the existing agent deployment form",
                        tone: showDeploy ? "default" : "brand",
                        onClick: () => setShowDeploy((open) => !open),
                    }}
                />
            )}

            {assignOpen && (
                <AssignTaskModal
                    agents={selectedAgents}
                    state={state}
                    onClose={() => setAssignOpen(false)}
                    onDispatch={(input) => { actions.createTask(input); setAssignOpen(false); setSelectMode(false); clearSelection(); }}
                />
            )}

            {editing && state.settings && (
                <AgentEditModal
                    agent={editing}
                    models={models}
                    settings={state.settings}
                    state={state}
                    onClose={() => setEditing(null)}
                    onSave={(patch) => { actions.updateAgent(editing.config.id, patch); setEditing(null); }}
                />
            )}
            {ctxMenu.node}
        </div>
    );
};

// ---- Dispatch one task to the selected agents (collaborators on the same work) ----
const ASSIGN_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];
const AssignTaskModal = ({ agents, state, onClose, onDispatch }: {
    agents: AgentState[];
    state: CoretexState;
    onClose: () => void;
    onDispatch: (input: import("@repo/coretex/types").CreateTaskInput) => void;
}) => {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [priority, setPriority] = useState<TaskPriority>("medium");
    // Suggest strengths represented by the selection, so it's clear who's on the job.
    const strengthSet = new Set<StrengthKey>();
    for (const a of agents) for (const k of agentStrengths({ role: a.config.role, provider: a.config.provider, model: a.config.model })) strengthSet.add(k);
    const strengths = STRENGTH_ORDER.filter((k) => strengthSet.has(k));
    const canDispatch = title.trim().length > 0 && agents.length > 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl" style={cardStyle} onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "var(--c-border)" }}>
                    <h2 className="text-sm font-semibold text-primary">Assign a task to {agents.length} {agents.length === 1 ? "agent" : "agents"}</h2>
                    <button type="button" onClick={onClose} className="rounded p-1 text-quaternary hover:text-secondary"><XClose className="size-4" /></button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
                    {/* Who's on the job */}
                    <div className="flex flex-col gap-2 rounded-lg p-3" style={{ background: "var(--surface-2)" }}>
                        <div className="flex flex-wrap items-center gap-2">
                            {agents.map((a) => (
                                <span key={a.id} className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-xl px-2 py-0.5 text-xs" title={a.config.name} style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                    <IdentityAvatar identity={a.config.identity} name={a.config.name} avatarUrl={a.config.avatarUrl} size={16} />
                                    <span className="min-w-0 break-words text-secondary [overflow-wrap:anywhere]">{a.config.name}</span>
                                    <Badge size="sm" color={roleColor(a.config.role, state.settings)} type="color">{roleLabel(a.config.role)}</Badge>
                                </span>
                            ))}
                        </div>
                        {strengths.length > 0 && (
                            <p className="text-[11px] text-tertiary">Combined strengths: {strengths.map((k) => STRENGTHS[k].label).join(" · ")}</p>
                        )}
                    </div>
                    <Field label="Task">
                        <Input value={title} onChange={(v) => setTitle(v)} placeholder="e.g. Refactor the auth module and write tests" />
                    </Field>
                    <Field label="Details">
                        <TextArea value={description} onChange={(v) => setDescription(v)} rows={5} placeholder="Describe what needs doing. All selected agents are dispatched as collaborators." textAreaClassName="resize-y" />
                    </Field>
                    <Field label="Priority">
                        <div className="flex flex-wrap gap-2">
                            {ASSIGN_PRIORITIES.map((p) => (
                                <button key={p} type="button" onClick={() => setPriority(p)} className={pillSelectClass(priority === p)}>
                                    <Badge size="md" color={priorityColor(p, state.settings)} type="color">{p}</Badge>
                                </button>
                            ))}
                        </div>
                    </Field>
                </div>
                <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--c-border)" }}>
                    <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                    <Button size="sm" color="primary" iconLeading={Send01} isDisabled={!canDispatch} onClick={() => onDispatch({ title: title.trim(), description: description.trim(), priority, assignedAgentIds: agents.map((a) => a.id) })}>
                        Dispatch task
                    </Button>
                </div>
            </div>
        </div>
    );
};

// ---- a reusable multiple-skills editor (named markdown blocks, each toggleable) ----
const SkillsEditor = ({ skills, onChange }: { skills: AgentSkill[]; onChange: (next: AgentSkill[]) => void }) => {
    const [openIdx, setOpenIdx] = useState<number | null>(null);
    const update = (i: number, patch: Partial<AgentSkill>) => onChange(skills.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    const add = () => { onChange([...skills, { name: `Skill ${skills.length + 1}`, content: "", enabled: true }]); setOpenIdx(skills.length); };
    const removeAt = (i: number) => { onChange(skills.filter((_, idx) => idx !== i)); setOpenIdx(null); };

    return (
        <div className="flex flex-col gap-2">
            {skills.length === 0 && <p className="text-xs text-quaternary">No extra skills. The base instructions above are used as-is.</p>}
            {skills.map((s, i) => {
                const open = openIdx === i;
                return (
                    <div key={i} className="rounded-lg" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                        <div className="flex items-center gap-2 px-2.5 py-2">
                            <Toggle size="sm" isSelected={s.enabled} onChange={(v) => update(i, { enabled: v })} />
                            <div className="min-w-0 flex-1">
                                <Input value={s.name} onChange={(v) => update(i, { name: v })} placeholder="Skill name" size="sm" />
                            </div>
                            <button type="button" onClick={() => setOpenIdx(open ? null : i)} className="rounded p-1 text-quaternary hover:text-secondary">{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button>
                            <button type="button" onClick={() => removeAt(i)} className="rounded p-1 text-error-primary hover:bg-[var(--surface)]"><Trash01 className="size-3.5" /></button>
                        </div>
                        {open && (
                            <div className="px-2.5 pb-2.5">
                                <TextArea value={s.content} onChange={(v) => update(i, { content: v })} rows={5} placeholder="Markdown instructions for this skill. Enabled skills are appended to the base instructions." textAreaClassName="resize-y font-mono text-xs" />
                            </div>
                        )}
                    </div>
                );
            })}
            <Button size="sm" color="secondary" iconLeading={Plus} onClick={add}>Add skill</Button>
        </div>
    );
};

// ---- edit an existing agent's config (prompt/skill + params) — no Settings round-trip.
// Changes apply to the agent's NEXT session; a task already running keeps its snapshot. ----
const AgentEditModal = ({ agent, models, settings, state, onClose, onSave }: {
    agent: AgentState;
    models: CoretexState["models"];
    settings: NonNullable<CoretexState["settings"]>;
    state: CoretexState;
    onClose: () => void;
    onSave: (patch: Partial<import("@repo/coretex/types").AgentConfig>) => void;
}) => {
    const c = agent.config;
    const [name, setName] = useState(c.name);
    const [role, setRole] = useState<AgentRole>(c.role);
    const [modelValue, setModelValue] = useState(`${c.provider}::${c.model}`);
    const [permission, setPermission] = useState(c.permissionMode ?? "ask");
    const [temperature, setTemperature] = useState(c.temperature);
    const [prompt, setPrompt] = useState(c.systemPrompt ?? "");
    const [terminalAccess, setTerminalAccess] = useState(c.terminalAccess !== false);
    const [executionMode, setExecutionMode] = useState<ClaudeExecutionMode>(c.executionMode ?? "autonomous");
    const [skills, setSkills] = useState<AgentSkill[]>(c.skills ?? []);
    const [maxSteps, setMaxSteps] = useState(c.maxSteps);
    const [dailyTokenBudget, setDailyTokenBudget] = useState(c.dailyTokenBudget ?? 0);
    const [connectorIds, setConnectorIds] = useState<string[]>(c.connectorIds ?? []);
    const [mcpServerIds, setMcpServerIds] = useState<string[]>(c.mcpServerIds ?? []);
    const [advanced, setAdvanced] = useState(false);
    const [provider, model] = modelValue.split("::");
    const selectedModel = models.find((m) => m.provider === provider && m.id === model) ?? null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl" style={cardStyle} onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3 border-b px-5 py-3" style={{ borderColor: "var(--c-border)" }}>
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                        <h2 className="min-w-0 break-words text-sm font-semibold text-primary [overflow-wrap:anywhere]" title={`Edit ${c.name}`}>Edit {c.name}</h2>
                        <HelpTooltip text="Changes apply to this agent's next session. A task already running keeps the settings it started with." />
                    </div>
                    <button type="button" onClick={onClose} className="shrink-0 rounded p-1 text-quaternary hover:text-secondary">✕</button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
                    <Field label="Name">
                        <Input value={name} onChange={(v) => setName(v)} />
                    </Field>
                    <Field label="Role">
                        <div className="flex flex-wrap gap-2">
                            {ROLES.map((r) => {
                                const on = role === r;
                                return (
                                    <button key={r} type="button" onClick={() => setRole(r)} className={pillSelectClass(on)}>
                                        <Badge size="md" color={roleColor(r, settings)} type="color">{roleLabel(r)}</Badge>
                                    </button>
                                );
                            })}
                        </div>
                    </Field>
                    <Field label="Model">
                        <ModelPicker models={models} value={provider && model ? { provider: provider as ProviderType, id: model } : null} onChange={(p, id) => setModelValue(`${p}::${id}`)} capability="chat" />
                    </Field>
                    <Field label="Permission mode">
                        <PermissionModeSelect value={permission} onChange={setPermission} density="comfortable" />
                    </Field>
                    <Field label="Execution mode">
                        <div className="flex items-center gap-2">
                            <ClaudeTierSelect value={executionMode} onChange={setExecutionMode} />
                            <HelpTooltip text="Conversational = LLM hub chat. Assisted = Claude Code in a terminal. Autonomous = Agent SDK runs to completion headlessly (default)." />
                        </div>
                    </Field>

                    <AgentAccessPanel
                        settings={settings}
                        state={state}
                        model={selectedModel}
                        provider={provider as ProviderType}
                        selection={{ connectorIds, mcpServerIds, terminalAccess }}
                        onChange={(next) => {
                            setTerminalAccess(next.terminalAccess);
                            setConnectorIds(next.connectorIds);
                            setMcpServerIds(next.mcpServerIds);
                        }}
                    />

                    <Field label="Base instructions">
                        <TextArea value={prompt} onChange={(v) => setPrompt(v)} rows={7} textAreaClassName="resize-y font-mono text-xs" />
                    </Field>

                    <div className="flex flex-col gap-1.5">
                        <span className="flex items-center gap-1.5 text-[11px] font-medium text-secondary">
                            Skills
                            <HelpTooltip text="Reusable instruction blocks. Each enabled skill is appended to the base instructions, so you can toggle capabilities on and off per agent." />
                        </span>
                        <SkillsEditor skills={skills} onChange={setSkills} />
                    </div>

                    {/* Advanced tuning */}
                    <button type="button" onClick={() => setAdvanced((v) => !v)} className="flex w-fit items-center gap-1 text-xs font-medium text-tertiary transition hover:text-secondary">
                        {advanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                        Advanced
                    </button>
                    {advanced && (
                        <div className="flex flex-col gap-4 rounded-lg p-3" style={{ background: "var(--surface-2)" }}>
                            <Field label={`Temperature · ${temperature.toFixed(2)}`}>
                                <div className="flex items-center gap-2">
                                    <Slider minValue={0} maxValue={2} step={0.05} value={temperature} onChange={(v) => setTemperature(typeof v === "number" ? v : v[0])} />
                                    <HelpTooltip text="Higher is more creative/varied; lower is more focused and deterministic. 0.7 is a good default." />
                                </div>
                            </Field>
                            <Field label="Max steps per task">
                                <div className="flex items-center gap-2">
                                    <div className="w-28">
                                        <Input type="number" value={String(maxSteps)} onChange={(v) => setMaxSteps(Math.max(1, Number(v) || 1))} size="sm" />
                                    </div>
                                    <HelpTooltip text="How many reasoning/tool steps the agent may take before it must finish a task. Caps runaway loops." />
                                </div>
                            </Field>
                            <Field label="Daily token budget (0 = unlimited)">
                                <div className="flex items-center gap-2">
                                    <div className="w-36">
                                        <Input type="number" value={String(dailyTokenBudget)} onChange={(v) => setDailyTokenBudget(Math.max(0, Number(v) || 0))} size="sm" />
                                    </div>
                                    <HelpTooltip text="Pauses the agent once it has spent this many tokens today. 0 means no daily cap." />
                                </div>
                            </Field>
                        </div>
                    )}
                </div>
                <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--c-border)" }}>
                    <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                    <Button
                        size="sm"
                        color="primary"
                        isDisabled={!name.trim() || !provider || !model}
                        onClick={() =>
                            onSave({
                                name: name.trim(),
                                role,
                                provider: provider as ProviderType,
                                model,
                                permissionMode: permission,
                                temperature,
                                systemPrompt: prompt,
                                terminalAccess,
                                executionMode,
                                skills,
                                maxSteps,
                                dailyTokenBudget,
                                connectorIds,
                                mcpServerIds,
                            })
                        }
                    >
                        Save changes
                    </Button>
                </div>
            </div>
        </div>
    );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-secondary">{label}</span>
        {children}
    </div>
);
