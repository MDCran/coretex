// @ts-nocheck
"use client";

// Coretex — bottom-right status cluster. Always-available chips: Terminals, Agents,
// Alerts. Agents panel lists every agent with tokens/cost and Pause / Resume / Halt /
// Remove — clear Running vs Ready vs Paused state.

import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
    Terminal,
    Users01,
    Maximize01,
    X,
    Bell01,
    ChevronUp,
    PauseCircle,
    Play,
    Trash01,
    Trash03,
    SlashCircle01,
    Loading01,
    Stars01,
} from "@untitledui/icons";
import type { AgentState, AgentStatus, TerminalSessionMeta } from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import { BadgeWithDot } from "@/components/base/badges/badges";
import {
    AGENT_STATUS_COLOR,
    formatTokens,
    formatUSD,
    isAgentActive,
    type CoretexActions,
    type CoretexState,
} from "../use-coretex";
import { roleLabel, statusLabel } from "../labels";
import { useAlertHistory, AlertList } from "../ui/alert-center";
import { ClusterChip } from "../ui/cluster-chip";
import { cx } from "@/utils/cx";

type Notice = { level: "info" | "success" | "warning" | "error"; message: string; at: number } | null;

const STATUS_DOT: Record<string, string> = {
    gray: "var(--c-text-muted)",
    brand: "var(--brand)",
    success: "var(--c-success, #22c55e)",
    warning: "#f59e0b",
    error: "#ef4444",
};

/** User-facing run state — clearer than raw enum for the cluster. */
function runState(status: AgentStatus): { label: string; hint: string; color: "gray" | "brand" | "success" | "warning" | "error" } {
    switch (status) {
        case "working":
            return { label: "Running", hint: "Actively working a task", color: "success" };
        case "thinking":
            return { label: "Running", hint: "Thinking through the next step", color: "brand" };
        case "paused":
            return { label: "Paused", hint: "Held — resume to make available, or remove", color: "warning" };
        case "error":
            return { label: "Error", hint: "Stopped with an error — remove or redeploy", color: "error" };
        case "idle":
        default:
            return { label: "Ready", hint: "Available — free to take the next task", color: "gray" };
    }
}

/** Resolve the project an agent belongs to: a project id in its tags, or its current task's project. */
function agentProject(a: AgentState, state: CoretexState): { id?: string; cwd?: string } {
    const tagged = a.config.tags?.find((t) => state.projects.some((p) => p.id === t));
    const viaTask = a.currentTaskId ? state.tasks.find((t) => t.id === a.currentTaskId)?.projectId : undefined;
    const projectId = tagged ?? viaTask;
    const project = projectId ? state.projects.find((p) => p.id === projectId) : undefined;
    return { id: projectId, cwd: project?.sourcePath };
}

function sortAgents(list: AgentState[]): AgentState[] {
    const rank: Record<AgentStatus, number> = { working: 0, thinking: 1, paused: 2, error: 3, idle: 4 };
    return [...list].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.config.name.localeCompare(b.config.name));
}

export const StatusCluster = ({
    state,
    actions,
    onOpenTerminal,
    onPopoutTerminal,
    onOpenFiles,
    notice,
    connected,
    askDockVisible,
    onToggleAskDock,
}: {
    state: CoretexState;
    actions: CoretexActions;
    onOpenTerminal: (id: string) => void;
    onPopoutTerminal: (id: string) => void;
    onOpenFiles?: () => void;
    notice: Notice;
    connected: boolean;
    askDockVisible: boolean;
    onToggleAskDock: () => void;
}) => {
    const [open, setOpen] = useState<"terminals" | "agents" | "alerts" | null>(null);
    const [removeArmed, setRemoveArmed] = useState<string | null>(null);
    const [agentQuery, setAgentQuery] = useState("");
    const reduceMotion = useReducedMotion();
    const alerts = useAlertHistory(notice, connected);
    const [revealed, setRevealed] = useState(false);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reveal = () => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        setRevealed(true);
    };
    const scheduleHide = () => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setRevealed(false), 600);
    };
    const visible = revealed || open !== null;

    // Live file-search indexing state → an always-visible progress card (real-time count + bar).
    const fileIndex = state.index;
    const idxProg = state.indexProgress;
    const isIndexing = !!fileIndex?.indexing || (!!idxProg && !idxProg.done);
    const idxCount = idxProg?.count ?? fileIndex?.count ?? 0;

    const terminals = state.terminals;
    const shellTerms = terminals.filter((t) => t.kind !== "agent");
    const runningShell = shellTerms.filter((t) => t.status === "running").length;
    const agents = sortAgents(state.agents ?? []);
    const runningAgents = agents.filter(isAgentActive);
    const pausedAgents = agents.filter((a) => a.status === "paused");
    const readyAgents = agents.filter((a) => a.status === "idle");
    const visibleAgents = agents.filter((agent) => `${agent.config.name} ${agent.config.role} ${agent.status}`.toLowerCase().includes(agentQuery.trim().toLowerCase()));

    const toggleAlerts = () => {
        if (open !== "alerts") alerts.markAllRead();
        setOpen((o) => (o === "alerts" ? null : "alerts"));
    };

    const armRemove = (id: string): void => {
        if (removeArmed === id) {
            actions.haltAgent(id);
            actions.removeAgent(id);
            setRemoveArmed(null);
            return;
        }
        setRemoveArmed(id);
        window.setTimeout(() => setRemoveArmed((cur) => (cur === id ? null : cur)), 3000);
    };

    const TermRow = ({ t }: { t: TerminalSessionMeta }) => (
        <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-[var(--surface-2)]">
            <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: t.status === "running" ? "var(--c-success, #22c55e)" : "var(--c-text-muted)" }}
            />
            <button
                type="button"
                onClick={() => onOpenTerminal(t.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-xs text-secondary hover:text-primary"
                title={t.title}
            >
                <span className="truncate">{t.title}</span>
                {t.kind === "agent" && (
                    <span
                        className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase"
                        style={{ background: "var(--surface-2)", color: "var(--c-text-muted)" }}
                    >
                        AI
                    </span>
                )}
            </button>
            <button
                type="button"
                title="Pop out as widget"
                onClick={() => onPopoutTerminal(t.id)}
                className="shrink-0 rounded p-1 text-quaternary opacity-0 transition hover:text-primary group-hover:opacity-100"
            >
                <Maximize01 className="size-3.5" />
            </button>
        </div>
    );

    const AgentRow = ({ a }: { a: AgentState }) => {
        const run = runState(a.status);
        const running = isAgentActive(a);
        const paused = a.status === "paused";
        const proj = agentProject(a, state);
        const linked = terminals.filter((t) => t.agentId === a.id);
        const confirmingRemove = removeArmed === a.id;

        return (
            <div className="mb-1.5 rounded-lg px-2 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                <div className="flex items-start gap-2">
                    <span
                        className={cx("mt-1.5 size-2 shrink-0 rounded-full", running && "animate-pulse")}
                        style={{ background: STATUS_DOT[AGENT_STATUS_COLOR[a.status]] ?? "var(--c-text-muted)" }}
                        title={statusLabel(a.status)}
                    />
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-start gap-1.5">
                            <span className="min-w-0 flex-1 break-words text-xs font-semibold leading-4 text-primary [overflow-wrap:anywhere]" title={a.config.name}>{a.config.name}</span>
                            <BadgeWithDot size="sm" color={run.color} type="pill-color">
                                {run.label}
                            </BadgeWithDot>
                        </div>
                        <p className="mt-0.5 break-words text-[10px] text-quaternary [overflow-wrap:anywhere]" title={`${roleLabel(a.config.role)} · ${run.hint}`}>
                            {roleLabel(a.config.role)} · {run.hint}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-tertiary">
                            <span title="Tokens today">{formatTokens(a.tokensUsedToday)} tok</span>
                            <span title="Cost today">{formatUSD(a.costToday)}</span>
                            <span>{a.stepCount} steps</span>
                        </div>
                    </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1">
                    {running && (
                        <>
                            <Button size="sm" color="secondary" iconLeading={PauseCircle} onClick={() => actions.pauseAgent(a.id)}>
                                Pause
                            </Button>
                            <Button
                                size="sm"
                                color="primary-destructive"
                                iconLeading={SlashCircle01}
                                onClick={() => actions.haltAgent(a.id)}
                                aria-label="Halt agent; the agent will remain paused and can be resumed"
                            >
                                Halt
                            </Button>
                        </>
                    )}
                    {paused && (
                        <Button size="sm" color="primary" iconLeading={Play} onClick={() => actions.resumeAgent(a.id)}>
                            Resume
                        </Button>
                    )}
                    {!running && !paused && a.status !== "error" && (
                        <Button
                            size="sm"
                            color="secondary"
                            iconLeading={PauseCircle}
                            onClick={() => actions.pauseAgent(a.id)}
                            aria-label="Pause agent so it will not pick up new work"
                        >
                            Pause
                        </Button>
                    )}
                    {(paused || a.status === "idle" || a.status === "error") && (
                        <Button
                            size="sm"
                            color={confirmingRemove ? "primary-destructive" : "tertiary"}
                            iconLeading={Trash01}
                            onClick={() => armRemove(a.id)}
                        >
                            {confirmingRemove ? "Confirm" : "Remove"}
                        </Button>
                    )}
                    <Button
                        size="sm"
                        color="tertiary"
                        iconLeading={Terminal}
                        onClick={() => actions.terminalCreate({ agentId: a.id, projectId: proj.id, cwd: proj.cwd })}
                        aria-label="Open console for this agent"
                        className="ml-auto"
                    />
                </div>

                {linked.length > 0 && (
                    <div className="mt-1.5 border-t pt-1" style={{ borderColor: "var(--c-border)" }}>
                        {linked.map((t) => (
                            <TermRow key={t.id} t={t} />
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const agentsSummary =
        agents.length === 0
            ? "Agents"
            : runningAgents.length > 0
              ? `Agents · ${runningAgents.length} running`
              : pausedAgents.length > 0
                ? `Agents · ${pausedAgents.length} paused`
                : `Agents · ${readyAgents.length} ready`;

    return (
        <>
            <div aria-hidden className="fixed bottom-0 right-0 z-30 h-24 w-72" onMouseEnter={reveal} />
            <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2" onMouseEnter={reveal} onMouseLeave={scheduleHide}>
                {/* Live indexing — stays visible independent of the auto-hide so background crawls are legible. */}
                <AnimatePresence>
                    {isIndexing && (
                        <motion.button
                            key="indexing"
                            type="button"
                            onClick={() => onOpenFiles?.()}
                            onMouseEnter={reveal}
                            title="Indexing files for search — click to manage indexing"
                            className={cx("w-72 overflow-hidden rounded-xl text-left shadow-2xl", onOpenFiles && "transition hover:brightness-105")}
                            style={{
                                background: "var(--glass-bg, var(--surface))",
                                border: "1px solid var(--glass-border, var(--c-border))",
                                backdropFilter: "blur(18px) saturate(140%)",
                                WebkitBackdropFilter: "blur(18px) saturate(140%)",
                                transformOrigin: "bottom right",
                                cursor: onOpenFiles ? "pointer" : "default",
                            }}
                            initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
                            transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 32, mass: 0.8 }}
                        >
                            <div className="flex items-center gap-2 px-3 pt-2.5">
                                <Loading01 className="size-3.5 shrink-0 animate-spin text-brand-secondary" />
                                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-primary">Indexing files</span>
                                <span className="shrink-0 text-[11px] tabular-nums text-tertiary">{idxCount.toLocaleString()} files</span>
                            </div>
                            {idxProg?.current && (
                                <p className="truncate px-3 pb-0.5 pt-1 font-mono text-[10px] text-quaternary" title={idxProg.current}>
                                    {idxProg.current}
                                </p>
                            )}
                            <div className="mt-1.5 h-1 w-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
                                <div className="h-full w-1/3 animate-pulse rounded-full" style={{ background: "var(--brand)" }} />
                            </div>
                        </motion.button>
                    )}
                </AnimatePresence>
                <AnimatePresence mode="wait">
                    {open === "terminals" && (
                        <Panel key="terminals" reduceMotion={reduceMotion} title={`Terminals · ${runningShell} active`} icon={Terminal} onClose={() => setOpen(null)}>
                            {shellTerms.length === 0 ? (
                                <p className="px-2 py-3 text-center text-xs text-quaternary">No terminals open.</p>
                            ) : (
                                shellTerms.map((t) => <TermRow key={t.id} t={t} />)
                            )}
                        </Panel>
                    )}
                    {open === "agents" && (
                        <Panel
                            key="agents"
                            reduceMotion={reduceMotion}
                            title={agentsSummary}
                            icon={Users01}
                            onClose={() => setOpen(null)}
                            wide
                        >
                            {agents.length === 0 ? (
                                <p className="px-2 py-3 text-center text-xs text-quaternary">No agents deployed yet.</p>
                            ) : (
                                <>
                                    <div className="mb-2 flex flex-wrap gap-1.5 px-1">
                                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums text-tertiary" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                            {runningAgents.length} running
                                        </span>
                                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums text-tertiary" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                            {pausedAgents.length} paused
                                        </span>
                                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums text-tertiary" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                            {readyAgents.length} ready
                                        </span>
                                    </div>
                                    {agents.length > 6 && <label className="mb-2 block px-1"><span className="sr-only">Find an agent</span><input value={agentQuery} onChange={(event) => setAgentQuery(event.target.value)} placeholder="Find an agent…" className="w-full rounded-lg border border-secondary bg-primary px-2.5 py-2 text-xs text-primary outline-none focus:border-brand" /></label>}
                                    <p className="mb-2 px-1 text-[10px] text-quaternary">{visibleAgents.length} shown · running agents first · controls stay with each agent</p>
                                    {visibleAgents.map((a) => (
                                        <AgentRow key={a.id} a={a} />
                                    ))}
                                </>
                            )}
                        </Panel>
                    )}

                    {open === "alerts" && (
                        <Panel
                            key="alerts"
                            reduceMotion={reduceMotion}
                            title={`Notifications${alerts.items.length ? ` · ${alerts.items.length}` : ""}`}
                            icon={Bell01}
                            onClose={() => setOpen(null)}
                            headerAction={alerts.items.length > 0 ? (
                                <button type="button" onClick={alerts.clearAll} title="Clear all" className="rounded p-0.5 text-quaternary hover:text-secondary">
                                    <Trash03 className="size-3.5" />
                                </button>
                            ) : undefined}
                        >
                            <AlertList items={alerts.items} onDismiss={alerts.dismiss} onClear={alerts.clearAll} />
                        </Panel>
                    )}
                </AnimatePresence>

                <div
                    data-tour="status-cluster"
                    className="flex items-center gap-2 transition-all duration-300 ease-out"
                    style={{ transform: visible ? "translateY(0)" : "translateY(160%)", opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }}
                >
                    <button
                        type="button"
                        onClick={onToggleAskDock}
                        aria-pressed={askDockVisible}
                        title={askDockVisible ? "Hide the Ask AI dock" : "Show the Ask AI dock"}
                        className="flex size-9 items-center justify-center rounded-lg shadow-lg transition-[background-color,box-shadow,color,border-color] duration-200 ease-out"
                        style={{
                            background: askDockVisible ? "var(--brand)" : "color-mix(in srgb, var(--brand) 16%, var(--surface))",
                            color: askDockVisible ? "#fff" : "var(--brand)",
                            border: `1px solid ${askDockVisible ? "var(--brand)" : "color-mix(in srgb, var(--brand) 40%, var(--c-border))"}`,
                            boxShadow: askDockVisible ? "0 8px 28px -6px var(--brand-glow, rgba(239,66,66,0.5))" : "0 6px 20px -8px var(--brand-glow, rgba(239,66,66,0.4))",
                        }}
                    >
                        <Stars01 className="size-4" />
                    </button>
                    <ClusterChip
                        icon={Users01}
                        label="Agents"
                        count={agents.length}
                        active={open === "agents"}
                        onClick={() => setOpen((o) => (o === "agents" ? null : "agents"))}
                        title={
                            runningAgents.length > 0
                                ? `${runningAgents.length} running · ${agents.length} total`
                                : agents.length > 0
                                  ? `${agents.length} agents · ${readyAgents.length} ready`
                                  : "Agents"
                        }
                    />
                    <ClusterChip
                        icon={Terminal}
                        label="Terminals"
                        count={runningShell}
                        active={open === "terminals"}
                        onClick={() => setOpen((o) => (o === "terminals" ? null : "terminals"))}
                    />
                    <ClusterChip icon={Bell01} label="Alerts" count={alerts.unread} active={open === "alerts"} onClick={toggleAlerts} />
                </div>

                {!visible && (
                    <button
                        type="button"
                        onMouseEnter={reveal}
                        onClick={reveal}
                        aria-label="Show activity (agents, terminals, alerts)"
                        title="Show activity"
                        className="absolute bottom-0 right-0 grid size-9 place-items-center rounded-full shadow-lg transition hover:scale-105"
                        style={{ background: "var(--surface)", border: "1px solid var(--c-border)", color: "var(--c-text-secondary)" }}
                    >
                        {runningAgents.length + runningShell + alerts.unread > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full" style={{ background: "var(--brand)" }} />
                        )}
                        <ChevronUp className="size-4" />
                    </button>
                )}
            </div>
        </>
    );
};

const Panel = ({
    title,
    icon: Icon,
    onClose,
    headerAction,
    children,
    reduceMotion,
    wide,
}: {
    title: string;
    icon: typeof Terminal;
    onClose: () => void;
    /** Optional extra control rendered in the header, immediately left of the close button. */
    headerAction?: React.ReactNode;
    children: React.ReactNode;
    reduceMotion?: boolean | null;
    wide?: boolean;
}) => (
    <motion.div
        className={cx("overflow-hidden rounded-xl shadow-2xl", wide ? "w-[22rem]" : "w-72")}
        style={{
            background: "var(--glass-bg, var(--surface))",
            border: "1px solid var(--glass-border, var(--c-border))",
            backdropFilter: "blur(18px) saturate(140%)",
            WebkitBackdropFilter: "blur(18px) saturate(140%)",
            transformOrigin: "bottom right",
        }}
        initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 32, mass: 0.8 }}
    >
        <div
            className="flex items-center gap-2 px-3 py-2"
            style={{ borderBottom: "1px solid var(--glass-border, var(--c-border))", background: "transparent" }}
        >
            <Icon className="size-3.5 text-brand-secondary" />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-primary">{title}</span>
            {headerAction}
            <button type="button" onClick={onClose} className="rounded p-0.5 text-quaternary hover:text-secondary">
                <X className="size-3.5" />
            </button>
        </div>
        <div className="max-h-[28rem] overflow-y-auto p-1.5">{children}</div>
    </motion.div>
);
