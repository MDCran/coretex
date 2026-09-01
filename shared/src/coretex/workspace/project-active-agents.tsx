// @ts-nocheck
"use client";

// Coretex Relay — per-project live active-agents panel. Lists the agents working
// in THIS project right now (status ∈ working/thinking, owned-by or running one of
// its tasks), each with current task, step, live action, accruing tokens/cost, and
// elapsed time — updating live from the AgentPool + ActivityTracker. Bulk Start /
// Pause / Stop are scoped to this project by default (toggle to all projects),
// fixing the old "affects every agent" behavior. Idle project agents are separated.

import { useEffect, useState } from "react";
import { Play, PauseCircle, Users01, Cube01, Terminal } from "@untitledui/icons";
import type { Project, Task } from "@repo/coretex/types";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { AGENT_STATUS_COLOR, agentsForProject, formatTokens, formatUSD, isAgentActive, modelAvailability, roleColor, type CoretexActions, type CoretexState } from "../use-coretex";
import { roleLabel, statusLabel } from "../labels";
import { IdentityAvatar } from "../ui/identity-avatar";
import { HaltButton } from "../ui/halt-button";

const cardStyle = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;

function elapsed(fromIso?: string, now = Date.now()): string {
    if (!fromIso) return "—";
    const ms = now - Date.parse(fromIso);
    if (!Number.isFinite(ms) || ms < 0) return "—";
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The last non-empty line of the live stream = what the agent is doing right now. */
function liveAction(stream?: string): string {
    if (!stream) return "";
    const lines = stream.trimEnd().split("\n");
    return (lines[lines.length - 1] ?? "").slice(-160);
}

export const ProjectActiveAgents = ({ project, state, actions }: { project: Project; state: CoretexState; actions: CoretexActions }) => {
    const [scopeAll, setScopeAll] = useState(false);
    const [, tick] = useState(0);

    const projectAgents = agentsForProject(state.agents, state.tasks, project.id);
    const active = projectAgents.filter(isAgentActive);
    const idle = projectAgents.filter((a) => !isAgentActive(a));
    const taskById = new Map<string, Task>(state.tasks.map((t) => [t.id, t]));

    // Keep elapsed times live while anything is running.
    useEffect(() => {
        if (active.length === 0) return;
        const id = window.setInterval(() => tick((n) => n + 1), 1000);
        return () => window.clearInterval(id);
    }, [active.length]);

    const scopeId = scopeAll ? undefined : project.id;
    const pausedInProject = projectAgents.filter((a) => a.status === "paused").length;
    const resumableInProject = projectAgents.filter((agent) => agent.status === "paused" && modelAvailability(state, agent.config.provider, agent.config.model).available).length;

    return (
        <div className="flex min-w-0 flex-col gap-3 rounded-xl p-4" style={cardStyle}>
            {/* Header + scoped controls */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Users01 className="size-4 text-[var(--brand)]" />
                    <h2 className="text-sm font-semibold text-primary">Active agents</h2>
                    <Badge type="color" size="sm" color={active.length > 0 ? "success" : "gray"}>{active.length} working</Badge>
                    {idle.length > 0 && <Badge size="sm" color="gray">{idle.length} idle</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {/* Scope toggle */}
                    <div className="flex overflow-hidden rounded-lg" style={{ border: "1px solid var(--c-border)" }}>
                        <button type="button" onClick={() => setScopeAll(false)} className={cx("px-2.5 py-1 text-[11px] font-medium transition", !scopeAll ? "text-primary" : "text-tertiary")} style={{ background: !scopeAll ? "var(--surface-2)" : "transparent" }}>This project</button>
                        <button type="button" onClick={() => setScopeAll(true)} className={cx("px-2.5 py-1 text-[11px] font-medium transition", scopeAll ? "text-primary" : "text-tertiary")} style={{ background: scopeAll ? "var(--surface-2)" : "transparent" }}>All projects</button>
                    </div>
                    <Button size="sm" color="secondary" iconLeading={Play} onClick={() => actions.resumeAllAgents(scopeId)} isDisabled={!scopeAll && (pausedInProject === 0 || resumableInProject === 0)}>Start</Button>
                    <Button size="sm" color="secondary" iconLeading={PauseCircle} onClick={() => actions.pauseAllAgents(scopeId)}>Pause</Button>
                    <HaltButton confirm label="Stop" onHalt={() => actions.haltAllAgents(scopeId)} />
                </div>
            </div>
            <p className="-mt-1 text-[11px] text-quaternary">
                {scopeAll ? "Controls act on every agent across all projects." : "Controls act on this project's agents only."}
            </p>

            {/* Active list */}
            {active.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg px-3 py-4 text-sm text-tertiary" style={{ background: "var(--surface-2)" }}>
                    <Cube01 className="size-4 text-quaternary" /> No agents are working in this project right now.
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {active.map((a) => {
                        const act = state.activity[a.id];
                        const task = a.currentTaskId ? taskById.get(a.currentTaskId) : undefined;
                        const action = liveAction(act?.stream);
                        return (
                            <div key={a.id} className="flex flex-col gap-2 rounded-lg p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                                <div className="flex min-w-0 flex-wrap items-start gap-3">
                                    <IdentityAvatar identity={a.config.identity} name={a.config.name} avatarUrl={a.config.avatarUrl} size={32} />
                                    <div className="min-w-0 flex-1 basis-48">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="min-w-0 break-words text-sm font-semibold text-primary [overflow-wrap:anywhere]" title={a.config.name}>{a.config.name}</span>
                                            <Badge type="color" size="sm" color={roleColor(a.config.role, state.settings)}>{roleLabel(a.config.role)}</Badge>
                                            <BadgeWithDot type="color" size="sm" color={AGENT_STATUS_COLOR[a.status]}>{statusLabel(a.status)}</BadgeWithDot>
                                        </div>
                                        <p className="mt-0.5 break-words text-xs text-tertiary [overflow-wrap:anywhere]" title={task?.title}>
                                            {task ? <>on <span className="font-medium text-secondary">{task.title}</span></> : "no task"}
                                            {typeof act?.step === "number" && act.step > 0 ? ` · step ${act.step}` : ""}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                                        <Button
                                            size="sm"
                                            color="tertiary"
                                            iconLeading={Terminal}
                                            onClick={() => actions.terminalCreate({ agentId: a.id, projectId: project.id, cwd: project.sourcePath })}
                                            aria-label="New terminal here for this agent"
                                        />
                                        <HaltButton label="Stop" onHalt={() => actions.haltAgent(a.id)} />
                                        <Button size="sm" color="tertiary" iconLeading={PauseCircle} onClick={() => actions.pauseAgent(a.id)}>Pause</Button>
                                    </div>
                                </div>

                                {/* Live action line */}
                                {action && (
                                    <div className="truncate rounded-md px-2 py-1 font-mono text-[11px] text-secondary" style={{ background: "var(--surface)" }} title={action}>
                                        <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full align-middle" style={{ background: "var(--brand)" }} />
                                        {action}
                                    </div>
                                )}

                                {/* Counters */}
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-quaternary">
                                    <span>{formatTokens(a.tokensUsedToday)} tokens</span>
                                    <span>{formatUSD(a.costToday)}</span>
                                    <span>{a.stepCount} steps total</span>
                                    {task && <span>⏱ {elapsed(task.updatedAt)}</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Idle project agents */}
            {idle.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t pt-2.5" style={{ borderColor: "var(--c-border)" }}>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-quaternary">Idle in this project</span>
                    <div className="flex flex-wrap gap-2">
                        {idle.map((a) => {
                            const runtime = modelAvailability(state, a.config.provider, a.config.model);
                            return <div key={a.id} title={`${a.config.name}${runtime.reason ? ` — ${runtime.reason}` : ""}`} className="flex max-w-full flex-wrap items-center gap-2 rounded-lg px-2 py-1 text-sm" style={{ background: "var(--surface-2)" }}>
                                <IdentityAvatar identity={a.config.identity} name={a.config.name} avatarUrl={a.config.avatarUrl} size={18} />
                                <span className="min-w-0 break-words font-medium text-secondary [overflow-wrap:anywhere]">{a.config.name}</span>
                                <BadgeWithDot type="color" size="sm" color={runtime.available ? AGENT_STATUS_COLOR[a.status] : "error"}>{runtime.available ? statusLabel(a.status) : "Unavailable"}</BadgeWithDot>
                                {a.status === "paused" && <Button size="sm" color="link-color" iconLeading={Play} isDisabled={!runtime.available} onClick={() => actions.resumeAgent(a.id)}>Resume</Button>}
                            </div>;
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};
