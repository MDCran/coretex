// @ts-nocheck
"use client";

// Coretex — full per-agent page. Click an agent (from the Agents grid) to open a
// dedicated surface: identity + lifecycle controls, live stats, capabilities, the
// tasks it's working, the projects it belongs to, how it connects to teammate
// agents, and its live console. Reuses the shared agent primitives.

import { useEffect, useState } from "react";
import { ArrowLeft, Play, PauseCircle, Trash01, Terminal, Cube01, Users01, LayersTwo01, ChevronRight, CpuChip01, Activity } from "@untitledui/icons";
import type { AgentState, Task } from "@repo/coretex/types";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { AGENT_STATUS_COLOR, modelAvailability, formatTokens, formatUSD, roleColor, priorityColor, type CoretexActions, type CoretexState } from "../use-coretex";
import { providerLabel, roleLabel, statusLabel, titleCase } from "../labels";
import { IdentityAvatar } from "../ui/identity-avatar";
import { HaltButton } from "../ui/halt-button";
import { PermissionModeSelect } from "../ui/permission-mode-select";
import { ClaudeTierBadge } from "../ui/claude-tier-badge";
import { AgentOutputConsole } from "../panels/agent-output-console";
import type { NavTarget } from "../nav";

const cardStyle = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;

function liveUptime(from?: string): string {
    if (!from) return "—";
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(from)) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Project ids an agent is tied to: any project-id tag, plus the project of any task it owns. */
function projectIdsOf(agent: AgentState, tasks: Task[], projectIds: Set<string>): string[] {
    const out = new Set<string>();
    agent.config.tags?.forEach((t) => { if (projectIds.has(t)) out.add(t); });
    tasks.forEach((t) => { if (t.projectId && (t.assignedAgentId === agent.id || t.assignedAgentIds?.includes(agent.id) || t.id === agent.currentTaskId)) out.add(t.projectId); });
    return [...out];
}

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="rounded-xl px-4 py-3" style={cardStyle}>
        <p className="text-xs text-quaternary">{label}</p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums text-primary">{value}</p>
        {sub && <p className="text-[11px] text-tertiary">{sub}</p>}
    </div>
);

const SectionCard = ({ icon: Icon, title, count, children }: { icon: typeof Users01; title: string; count?: number; children: React.ReactNode }) => (
    <div className="overflow-hidden rounded-xl" style={cardStyle}>
        <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--c-border)" }}>
            <Icon className="size-4 text-brand-secondary" />
            <h3 className="text-sm font-semibold text-primary">{title}</h3>
            {count !== undefined && <span className="text-xs tabular-nums text-quaternary">{count}</span>}
        </div>
        <div className="p-2">{children}</div>
    </div>
);

export const AgentDetailView = ({ agentId, state, actions, onNavigate }: { agentId: string; state: CoretexState; actions: CoretexActions; onNavigate: (t: NavTarget) => void }) => {
    const [removeArmed, setRemoveArmed] = useState(false);
    const agent = state.agents.find((a) => a.id === agentId);
    const active = agent?.status === "working" || agent?.status === "thinking";
    const [, tickUptime] = useState(0);
    useEffect(() => {
        if (!active) return;
        const timer = window.setInterval(() => tickUptime((value) => value + 1), 1000);
        return () => window.clearInterval(timer);
    }, [active]);

    if (!agent) {
        return (
            <div className="flex flex-col gap-4">
                <Button size="sm" color="link-gray" iconLeading={ArrowLeft} onClick={() => onNavigate({ kind: "agents" })}>Back to Agents</Button>
                <p className="text-sm text-tertiary">Agent not found — it may have been removed.</p>
            </div>
        );
    }

    const runtime = modelAvailability(state, agent.config.provider, agent.config.model);
    const isPaused = agent.status === "paused";
    const projectIdSet = new Set(state.projects.map((p) => p.id));
    const tasks = state.tasks.filter((t) => t.assignedAgentId === agentId || t.assignedAgentIds?.includes(agentId) || t.id === agent.currentTaskId);
    const currentTask = agent.currentTaskId ? state.tasks.find((t) => t.id === agent.currentTaskId) : undefined;
    const myProjectIds = projectIdsOf(agent, state.tasks, projectIdSet);
    const projects = myProjectIds.map((id) => state.projects.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
    // Teammates: other agents that share at least one project with this one.
    const teammates = state.agents.filter((a) => a.id !== agentId && projectIdsOf(a, state.tasks, projectIdSet).some((id) => myProjectIds.includes(id)));
    const activity = state.activity[agentId];
    const executionTrace = tasks
        .flatMap((task) => state.taskLogs[task.id] ?? [])
        .filter((log) => log.agentId === agentId)
        .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
        .slice(0, 80);

    const armRemove = () => {
        if (removeArmed) { actions.haltAgent(agentId); actions.removeAgent(agentId); onNavigate({ kind: "agents" }); return; }
        setRemoveArmed(true);
        window.setTimeout(() => setRemoveArmed(false), 3000);
    };
    const projName = (id?: string) => state.projects.find((p) => p.id === id)?.name;

    return (
        <div className="flex min-w-0 flex-col gap-5">
            <button type="button" onClick={() => onNavigate({ kind: "agents" })} className="flex w-fit items-center gap-1.5 text-sm text-tertiary transition hover:text-primary">
                <ArrowLeft className="size-4" /> Agents
            </button>

            {/* Header */}
            <div className="flex flex-col gap-4 rounded-xl p-5" style={cardStyle}>
                <div className="flex flex-wrap items-start gap-4">
                    <IdentityAvatar identity={agent.config.identity} name={agent.config.name} avatarUrl={agent.config.avatarUrl} size={56} />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="min-w-0 break-words text-display-xs font-semibold leading-tight text-primary [overflow-wrap:anywhere]" title={agent.config.name}>{agent.config.name}</h1>
                            <Badge type="color" size="sm" color={roleColor(agent.config.role, state.settings)}>{roleLabel(agent.config.role)}</Badge>
                            <ClaudeTierBadge mode={agent.config.executionMode ?? "autonomous"} />
                            {runtime.available ? (
                                <BadgeWithDot type="color" size="sm" color={AGENT_STATUS_COLOR[agent.status]}>{statusLabel(agent.status)}</BadgeWithDot>
                            ) : (
                                <Tooltip title="Unavailable" description={runtime.reason} placement="top">
                                    <TooltipTrigger className="cursor-help"><BadgeWithDot type="color" size="sm" color="error">Unavailable</BadgeWithDot></TooltipTrigger>
                                </Tooltip>
                            )}
                        </div>
                        <p className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 break-words text-sm text-tertiary [overflow-wrap:anywhere]" title={`${providerLabel(agent.config.provider)} · ${agent.config.model}`}><CpuChip01 className="size-4 shrink-0 text-quaternary" />{providerLabel(agent.config.provider)} · {agent.config.model}</p>
                        {currentTask && (
                            <p className="mt-1 break-words text-sm text-brand-secondary [overflow-wrap:anywhere]" title={`Working: ${currentTask.title}`}>Working: {currentTask.title}</p>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {active && <HaltButton label="Stop" onHalt={() => actions.haltAgent(agentId)} />}
                        {isPaused ? (
                            <Button size="sm" color="primary" iconLeading={Play} isDisabled={!runtime.available} onClick={() => actions.resumeAgent(agentId)}>Resume</Button>
                        ) : (
                            agent.status !== "error" && <Button size="sm" color="secondary" iconLeading={PauseCircle} onClick={() => actions.pauseAgent(agentId)}>Pause</Button>
                        )}
                        <Button size="sm" color="secondary" iconLeading={Terminal} onClick={() => actions.terminalCreate({ agentId, projectId: myProjectIds[0] })}>Console</Button>
                        {(isPaused || agent.status === "idle" || agent.status === "error") && (
                            <Button size="sm" color={removeArmed ? "primary-destructive" : "tertiary-destructive"} iconLeading={Trash01} onClick={armRemove}>{removeArmed ? "Confirm" : "Remove"}</Button>
                        )}
                    </div>
                </div>
                <div className="max-w-md"><PermissionModeSelect value={agent.config.permissionMode ?? "ask"} onChange={(mode) => actions.setAgentPermissionMode(agentId, mode)} /></div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Steps" value={String(agent.stepCount)} />
                <Stat label="Tokens today" value={formatTokens(agent.tokensUsedToday)} sub={`${formatTokens(agent.tokensUsedTotal)} total`} />
                <Stat label="Cost today" value={formatUSD(agent.costToday)} sub={`${formatUSD(agent.costTotal)} total`} />
                <Stat label="Created" value={new Date(agent.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
                <Stat label="Last active" value={new Date(agent.lastActiveAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} />
                <Stat label={active ? "Live uptime" : "Last run"} value={active ? liveUptime(currentTask?.updatedAt) : "Idle"} />
            </div>

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                {/* Tasks */}
                <SectionCard icon={LayersTwo01} title="Tasks" count={tasks.length}>
                    {tasks.length === 0 ? (
                        <p className="px-2 py-4 text-center text-xs text-quaternary">No tasks assigned to this agent.</p>
                    ) : (
                        <ul className="flex flex-col gap-1">
                            {tasks.map((t) => (
                                <li key={t.id}>
                                    <button
                                        type="button"
                                        onClick={() => t.projectId && onNavigate({ kind: "project", id: t.projectId, tab: "kanban" })}
                                        disabled={!t.projectId}
                                        className={cx("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition", t.projectId && "hover:bg-[var(--surface-2)]")}
                                    >
                                        <span className="mt-0.5 size-2 shrink-0 rounded-full" style={{ background: t.id === agent.currentTaskId ? "var(--brand)" : "var(--c-text-muted)" }} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block break-words text-sm text-primary [overflow-wrap:anywhere]" title={t.title}>{t.title}</span>
                                            <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                                <Badge type="color" size="sm" color={priorityColor(t.priority, state.settings)}>{titleCase(t.priority)}</Badge>
                                                <span className="text-[11px] text-quaternary">{titleCase(t.status)}</span>
                                                {t.projectId && <span className="min-w-0 break-words text-[11px] text-tertiary [overflow-wrap:anywhere]" title={projName(t.projectId)}>· {projName(t.projectId)}</span>}
                                            </span>
                                        </span>
                                        {t.projectId && <ChevronRight className="size-4 shrink-0 text-quaternary" />}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </SectionCard>

                <div className="flex flex-col gap-4">
                    {/* Capabilities */}
                    <SectionCard icon={CpuChip01} title="Access & capabilities">
                        <div className="flex flex-wrap gap-1.5 px-1 py-1">
                            <Badge size="sm" color={agent.config.terminalAccess !== false ? "success" : "gray"} type="color">{agent.config.terminalAccess !== false ? "Terminal enabled" : "No terminal"}</Badge>
                            {(agent.config.mcpServerIds?.length ?? 0) > 0 && <Badge size="sm" color="brand" type="color">{agent.config.mcpServerIds!.length} MCP servers</Badge>}
                            {(agent.config.connectorIds?.length ?? 0) > 0 && <Badge size="sm" color="brand" type="color">{agent.config.connectorIds!.length} connectors</Badge>}
                            {(agent.config.skills?.filter((s) => s.enabled).length ?? 0) > 0 && <Badge size="sm" color="gray" type="color">{agent.config.skills!.filter((s) => s.enabled).length} skills</Badge>}
                            <Badge size="sm" color="gray" type="color">Perm: {titleCase(agent.config.permissionMode ?? "ask")}</Badge>
                        </div>
                    </SectionCard>

                    {/* Projects */}
                    <SectionCard icon={Cube01} title="Projects" count={projects.length}>
                        {projects.length === 0 ? (
                            <p className="px-2 py-4 text-center text-xs text-quaternary">Not tied to a project yet.</p>
                        ) : (
                            <ul className="flex flex-col gap-1">
                                {projects.map((p) => (
                                    <li key={p.id}>
                                        <button type="button" onClick={() => onNavigate({ kind: "project", id: p.id, tab: "overview" })} title={p.name} className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-[var(--surface-2)]">
                                            <Cube01 className="size-4 shrink-0" style={{ color: p.color || "var(--brand-secondary)" }} />
                                            <span className="min-w-0 flex-1 break-words text-sm text-primary [overflow-wrap:anywhere]">{p.name}</span>
                                            <ChevronRight className="size-4 shrink-0 text-quaternary" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </SectionCard>

                    {/* Connections */}
                    <SectionCard icon={Users01} title="Connected agents" count={teammates.length}>
                        {teammates.length === 0 ? (
                            <p className="px-2 py-4 text-center text-xs text-quaternary">No teammates share this agent's projects.</p>
                        ) : (
                            <ul className="flex flex-col gap-1">
                                {teammates.map((a) => (
                                    <li key={a.id}>
                                        <button type="button" onClick={() => onNavigate({ kind: "agent", id: a.id })} title={a.config.name} className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-[var(--surface-2)]">
                                            <IdentityAvatar identity={a.config.identity} name={a.config.name} avatarUrl={a.config.avatarUrl} size={22} />
                                            <span className="min-w-0 flex-1 break-words text-sm text-primary [overflow-wrap:anywhere]">{a.config.name}</span>
                                            <Badge type="color" size="sm" color={roleColor(a.config.role, state.settings)}>{roleLabel(a.config.role)}</Badge>
                                            <ChevronRight className="size-4 shrink-0 text-quaternary" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </SectionCard>
                </div>
            </div>

            {/* Live console */}
            <SectionCard icon={Activity} title="Execution trace" count={executionTrace.length}>
                <p className="px-2 pb-3 text-xs text-tertiary">Safe runtime summaries of active subtasks, reasoning steps, decisions, and tool calls. Private hidden chain-of-thought is not exposed.</p>
                {executionTrace.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-quaternary">No execution events in this session yet.</p>
                ) : (
                    <ol className="max-h-96 space-y-2 overflow-auto px-1">
                        {executionTrace.map((log, index) => (
                            <li key={`${log.taskId}-${log.step}-${log.timestamp}-${index}`} className="rounded-lg p-2.5" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                                <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-quaternary"><span>Step {log.step}</span><span>{new Date(log.timestamp).toLocaleTimeString()}</span></div>
                                <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-secondary">{log.message}</p>
                            </li>
                        ))}
                    </ol>
                )}
            </SectionCard>

            <SectionCard icon={Terminal} title="Live console">
                <AgentOutputConsole className="m-1" stream={activity?.stream} step={typeof activity?.step === "number" ? activity.step : undefined} active={active} size="card" />
            </SectionCard>
        </div>
    );
};
