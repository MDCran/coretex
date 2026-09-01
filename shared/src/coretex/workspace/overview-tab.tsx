// @ts-nocheck
"use client";

// Coretex Relay — project Overview tab.
// Project health at a glance: active agents, a task-status summary, today's spend
// (per-project billing), the code index status, recent log activity, and a
// global agent control row (start/pause all).

import { useEffect } from "react";
import type { LogLevel, Task, TaskStatus } from "@repo/coretex/types";
import { Badge } from "@/components/base/badges/badges";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/utils/cx";
import { Activity, Database01, Signal01, Wallet02 } from "@untitledui/icons";
import { statusLabel, titleCase } from "../labels";
import { agentsForProject, isAgentActive, formatUSD, priorityColor, type CoretexActions, type CoretexLogLine, type CoretexState } from "../use-coretex";
import type { NavTarget } from "../nav";
import type { Project } from "@repo/coretex/types";
import { ProjectActiveAgents } from "./project-active-agents";

const CARD_STYLE = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;

const LEVEL_CLASS: Record<LogLevel, string> = {
    info: "text-secondary",
    warn: "text-warning-primary",
    error: "text-error-primary",
};

// Each tracked task status mapped to a Badge color for the mini summary.
const STATUS_BADGE: { status: TaskStatus; color: "gray" | "blue" | "brand" | "success" | "error" }[] = [
    { status: "pending", color: "gray" },
    { status: "assigned", color: "blue" },
    { status: "in_progress", color: "brand" },
    { status: "completed", color: "success" },
    { status: "failed", color: "error" },
];

export const OverviewTab = ({ project, state, actions, onNavigate }: { project: Project; state: CoretexState; actions: CoretexActions; onNavigate?: (t: NavTarget) => void }) => {
    // Pull this project's per-project billing on mount (and when project changes).
    useEffect(() => {
        actions.getProjectBilling(project.id);
    }, [actions, project.id]);

    const projectTasks: Task[] = state.tasks.filter((t: Task) => t.projectId === project.id);

    const counts: Record<TaskStatus, number> = {
        pending: 0,
        assigned: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
    };
    for (const t of projectTasks) counts[t.status] += 1;

    const projectAgents = agentsForProject(state.agents, state.tasks, project.id);
    const activeAgents = projectAgents.filter(isAgentActive).length;

    const todaySpend = state.projectBilling[project.id]?.totalCostToday ?? 0;

    // Servers the Brain attributed to this project (by process command line / path).
    const projectServers = state.servers.filter((s) => s.projectId === project.id).sort((a, b) => a.port - b.port);

    const index = state.codeIndex[project.id];
    const indexStatus = index?.status;
    const indexChunks = index?.chunks ?? 0;

    // Project activity feed = this project's task transitions, most recent first.
    const transitions: Task[] = [...projectTasks].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 12);
    const agentName = (id?: string): string => (id ? state.agents.find((a) => a.id === id)?.config.name ?? "agent" : "");

    return (
        <div className="flex flex-col gap-5">
            {/* Stat cards row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {/* Active agents */}
                <div className="rounded-xl p-4" style={CARD_STYLE}>
                    <div className="flex items-center gap-3">
                        <FeaturedIcon icon={Activity} size="md" color="brand" theme="light" />
                        <span className="text-xs font-medium text-tertiary">Active agents</span>
                    </div>
                    <p className="mt-3 text-display-xs font-semibold text-primary">{activeAgents}</p>
                    <p className="mt-1 text-xs text-tertiary">working in this project now</p>
                </div>

                {/* Task summary */}
                <div className="rounded-xl p-4" style={CARD_STYLE}>
                    <div className="flex items-center gap-2 text-tertiary">
                        <span className="text-xs font-medium">Tasks</span>
                        <span className="text-xs text-quaternary">({projectTasks.length})</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {STATUS_BADGE.map(({ status, color }) => (
                            <Badge key={status} type="pill-color" size="sm" color={color}>
                                {statusLabel(status)} {counts[status]}
                            </Badge>
                        ))}
                    </div>
                </div>

                {/* Today's spend */}
                <div className="rounded-xl p-4" style={CARD_STYLE}>
                    <div className="flex items-center gap-3">
                        <FeaturedIcon icon={Wallet02} size="md" color="success" theme="light" />
                        <span className="text-xs font-medium text-tertiary">Today&apos;s spend</span>
                    </div>
                    <p className="mt-3 text-display-xs font-semibold text-primary">{formatUSD(todaySpend)}</p>
                    <p className="mt-1 text-xs text-tertiary">this project, since midnight</p>
                </div>

                {/* Index status */}
                <div className="rounded-xl p-4" style={CARD_STYLE}>
                    <div className="flex items-center gap-3">
                        <FeaturedIcon icon={Database01} size="md" color="gray" theme="light" />
                        <span className="text-xs font-medium text-tertiary">Code index</span>
                    </div>
                    <p className="mt-3 text-lg font-semibold text-primary">
                        {indexStatus ? statusLabel(indexStatus) : "Not indexed"}
                    </p>
                    <p className="mt-1 text-xs text-tertiary">
                        {indexChunks.toLocaleString()} chunk{indexChunks === 1 ? "" : "s"}
                    </p>
                </div>
            </div>

            {/* Live active-agents panel (scoped controls live here) */}
            <ProjectActiveAgents project={project} state={state} actions={actions} />

            {/* Running servers attributed to this project */}
            {projectServers.length > 0 && (
                <div className="rounded-xl p-5" style={CARD_STYLE}>
                    <div className="flex items-center gap-2">
                        <Signal01 className="size-4 text-success-primary" />
                        <h2 className="text-sm font-semibold text-primary">Running servers</h2>
                        <Badge type="pill-color" size="sm" color="success">{projectServers.length}</Badge>
                        {onNavigate && (
                            <button type="button" onClick={() => onNavigate({ kind: "servers" })} className="ml-auto text-xs font-medium text-brand-secondary hover:underline">
                                View all
                            </button>
                        )}
                    </div>
                    <div className="mt-3 flex flex-col">
                        {projectServers.map((s) => (
                            <div key={`${s.port}:${s.pid ?? 0}`} className="flex items-center gap-3 border-b py-2 last:border-0" style={{ borderColor: "var(--c-border)" }}>
                                <span className="size-1.5 shrink-0 rounded-full" style={{ background: s.statusOk ? "#22c55e" : "var(--c-text-muted)" }} title={s.statusOk ? "Responding" : "Listening"} />
                                <span className="shrink-0 font-mono text-xs text-secondary tabular-nums">:{s.port}</span>
                                <span className="min-w-0 flex-1 truncate text-sm text-secondary">{s.tech || s.process || s.type}</span>
                                {s.url && (
                                    <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0 truncate text-xs text-brand-secondary hover:underline" title={s.url}>
                                        {s.url.replace(/^https?:\/\//, "")}
                                    </a>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Project activity feed — task transitions, most recent first */}
            <div className="rounded-xl p-5" style={CARD_STYLE}>
                <h2 className="text-sm font-semibold text-primary">Project activity</h2>
                {transitions.length === 0 ? (
                    <p className="mt-3 text-xs text-quaternary">No task activity yet.</p>
                ) : (
                    <div className="mt-3 flex flex-col">
                        {transitions.map((t) => (
                            <div key={t.id} className="flex items-center gap-3 border-b py-2 last:border-0" style={{ borderColor: "var(--c-border)" }}>
                                <span className="shrink-0 font-mono text-[11px] text-quaternary">{t.updatedAt.slice(11, 19)}</span>
                                <Badge type="color" size="sm" color={priorityColor(t.priority, state.settings)}>{titleCase(t.priority)}</Badge>
                                <span className="min-w-0 flex-1 truncate text-sm text-secondary">{t.title}</span>
                                {t.assignedAgentId && <span className="shrink-0 text-[11px] text-quaternary">{agentName(t.assignedAgentId)}</span>}
                                <Badge type="color" size="sm" color={STATUS_BADGE.find((s) => s.status === t.status)?.color ?? "gray"}>{statusLabel(t.status)}</Badge>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Recent system log */}
            <div className="rounded-xl p-5" style={CARD_STYLE}>
                <h2 className="text-sm font-semibold text-primary">Recent log</h2>
                <div className="mt-3 flex flex-col gap-1 font-mono text-xs">
                    {state.logs.length === 0 ? (
                        <span className="text-quaternary">No activity yet</span>
                    ) : (
                        state.logs.slice(-6).reverse().map((line: CoretexLogLine, index: number) => (
                            <div key={index} className="flex gap-2">
                                <span className="shrink-0 text-quaternary">{line.timestamp.slice(11, 19)}</span>
                                <span className={cx("break-words", LEVEL_CLASS[line.level])}>{line.message}</span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
