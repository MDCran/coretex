// @ts-nocheck
"use client";

// Coretex Relay — Agents panel.
// Renders a responsive grid of live agent cards bound to the orchestrator state.

import { useState } from "react";
import { Maximize02, PauseCircle, Play, Terminal, Trash01, Users01, ShieldTick, CpuChip01 } from "@untitledui/icons";
import type { AgentState, ClaudeExecutionMode, PermissionMode } from "@repo/coretex/types";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { Button } from "@/components/base/buttons/button";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import type { NavTarget } from "../nav";
import { providerLabel, roleLabel, statusLabel } from "../labels";
import { ClaudeTierBadge } from "../ui/claude-tier-badge";
import { useContextMenu, type MenuItem } from "../ui/context-menu";
import { PERMISSION_MODES } from "../ui/permission-mode-select";
import { CLAUDE_TIERS, CLAUDE_TIER_ORDER } from "../claude-tiers";
import { AgentActivitySlideout } from "./agent-activity-slideout";
import { AgentOutputConsole } from "./agent-output-console";
import {
    AGENT_STATUS_COLOR,
    modelAvailability,
    formatTokens,
    formatUSD,
    roleColor,
    type AgentActivity,
    type AiAvailability,
    type CoretexActions,
    type CoretexState,
} from "../use-coretex";

interface PanelProps {
    state: CoretexState;
    actions: CoretexActions;
    onNavigate?: (t: NavTarget) => void;
}

function getInitials(name: string): string {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

function AgentCard({ agent, activity, availability, actions, settings, onOpen, onNavigate }: { agent: AgentState; activity?: AgentActivity; availability: AiAvailability; actions: CoretexActions; settings: CoretexState["settings"]; onOpen: () => void; onNavigate?: () => void }) {
    const isPaused = agent.status === "paused";
    const active = agent.status === "working" || agent.status === "thinking";
    const stream = activity?.stream;
    const step = activity?.step;
    const ctxMenu = useContextMenu();

    // Right-click menu — mirrors the card's footer buttons (Pause/Resume, Activity)
    // plus quick access to halt, console, permission mode, execution tier, and remove.
    const buildMenu = (): MenuItem[] => {
        const curPermission: PermissionMode = agent.config.permissionMode ?? "ask";
        const curTier: ClaudeExecutionMode = agent.config.executionMode ?? "autonomous";
        return [
            { header: agent.config.name },
            isPaused
                ? { key: "resume", label: "Resume", icon: Play, disabled: !availability.available, onClick: () => actions.resumeAgent(agent.id) }
                : { key: "pause", label: "Pause", icon: PauseCircle, disabled: active, onClick: () => actions.pauseAgent(agent.id) },
            { key: "halt", label: "Halt", danger: true, disabled: !active, onClick: () => actions.haltAgent(agent.id) },
            { separator: true },
            { key: "console", label: "Open console", icon: Terminal, onClick: () => actions.terminalCreate({ agentId: agent.id, projectId: agent.config.tags?.[0] }) },
            { key: "activity", label: "Activity", icon: Maximize02, onClick: onOpen },
            { separator: true },
            {
                key: "permission",
                label: "Permission mode",
                icon: ShieldTick,
                submenu: PERMISSION_MODES.map<MenuItem>((m) => ({
                    key: `perm-${m.value}`,
                    label: m.label,
                    checked: curPermission === m.value,
                    onClick: () => actions.setAgentPermissionMode(agent.id, m.value),
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
                    onClick: () => actions.updateAgent(agent.config.id, { executionMode: mode }),
                })),
            },
            { separator: true },
            { key: "remove", label: "Remove", icon: Trash01, danger: true, onClick: () => { actions.haltAgent(agent.id); actions.removeAgent(agent.id); } },
        ];
    };

    return (
        <>
        <div
            className="group min-w-0 cursor-pointer overflow-hidden rounded-xl border border-secondary bg-primary p-4 transition hover:border-primary hover:shadow-xs"
            onContextMenu={(e) => ctxMenu.open(e, buildMenu())}
            onClick={(e) => { if ((e.target as HTMLElement).closest("button,a,input,[role='menuitem']")) return; onNavigate?.(); }}
            title="Open in Agents — add, edit or remove"
        >
            <div className="flex min-w-0 items-start gap-4">
                {/* Avatar */}
                {agent.config.avatarUrl ? (
                    <img src={agent.config.avatarUrl} alt={agent.config.name} className="size-10 shrink-0 rounded-full object-cover" />
                ) : (
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-secondary">
                        <span className="text-sm font-semibold text-brand-secondary">{getInitials(agent.config.name)}</span>
                    </div>
                )}

                {/* Body */}
                <div className="min-w-0 flex-1">
                    {/* Name row */}
                    <div className="mb-1 flex min-w-0 items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 break-words text-sm font-semibold leading-5 text-primary [overflow-wrap:anywhere]" title={agent.config.name}>
                            {agent.config.name}
                        </span>
                        {availability.available ? (
                            <BadgeWithDot type="color" size="sm" color={AGENT_STATUS_COLOR[agent.status]} className="shrink-0">
                                {statusLabel(agent.status)}
                            </BadgeWithDot>
                        ) : (
                            <Tooltip title="Unavailable" description={availability.reason} placement="top">
                                <TooltipTrigger className="shrink-0 cursor-help">
                                    <BadgeWithDot type="color" size="sm" color="error">Unavailable</BadgeWithDot>
                                </TooltipTrigger>
                            </Tooltip>
                        )}
                    </div>

                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <Badge type="color" size="sm" color={roleColor(agent.config.role, settings)}>
                            {roleLabel(agent.config.role)}
                        </Badge>
                        <ClaudeTierBadge mode={agent.config.executionMode ?? "autonomous"} />
                    </div>

                    {/* Model line */}
                    <p className="mb-2 break-words text-xs text-tertiary [overflow-wrap:anywhere]" title={`${providerLabel(agent.config.provider)} · ${agent.config.model}`}>
                        {providerLabel(agent.config.provider)} · {agent.config.model}
                    </p>

                    {/* Stats row */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-quaternary">
                        <span>{agent.stepCount} steps</span>
                        <span>{formatTokens(agent.tokensUsedToday)} tokens today</span>
                        <span>{formatUSD(agent.costToday)} today</span>
                    </div>

                    {/* Live console — standby panel when idle, stream when active */}
                    <AgentOutputConsole
                        className="mt-3"
                        stream={stream}
                        step={typeof step === "number" ? step : undefined}
                        active={active}
                        size="card"
                    />

                    {/* Footer */}
                    <div className="mt-3 flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            {isPaused ? (
                                <Button size="sm" color="secondary" iconLeading={Play} isDisabled={!availability.available} onClick={() => actions.resumeAgent(agent.id)}>
                                    Resume
                                </Button>
                            ) : (
                                <Button size="sm" color="secondary" iconLeading={PauseCircle} onClick={() => actions.pauseAgent(agent.id)}>
                                    Pause
                                </Button>
                            )}
                            <Button size="sm" color="tertiary" iconLeading={Maximize02} onClick={onOpen}>
                                Activity
                            </Button>
                        </div>
                        {agent.status === "error" && agent.errorMessage ? (
                            <p className="text-xs text-error-primary">{agent.errorMessage}</p>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
        {ctxMenu.node}
        </>
    );
}

export const AgentsPanel = ({ state, actions, onNavigate }: PanelProps) => {
    const agents = state.agents;
    const [openId, setOpenId] = useState<string | null>(null);
    const openAgent = openId ? agents.find((a) => a.id === openId) ?? null : null;

    return (
        <section className="flex flex-col gap-4">
            <div className="mb-4 flex items-center gap-2">
                <h2 className="text-md font-semibold text-primary">Agents</h2>
                <Badge type="color" size="sm" color="gray">
                    {agents.length}
                </Badge>
            </div>

            {agents.length === 0 ? (
                <div className="relative min-h-48 overflow-hidden rounded-xl border border-dashed border-secondary bg-primary p-8">
                    <EmptyState size="sm">
                        <EmptyState.Header>
                            <EmptyState.FeaturedIcon icon={Users01} color="brand" theme="light" />
                        </EmptyState.Header>
                        <EmptyState.Content className="mb-0">
                            <EmptyState.Title>No agents registered yet</EmptyState.Title>
                            <EmptyState.Description>Deploy an agent to run tasks and monitor its work here.</EmptyState.Description>
                        </EmptyState.Content>
                        {onNavigate && (
                            <EmptyState.Footer>
                                <Button size="sm" color="primary" onClick={() => onNavigate({ kind: "agents" })}>Go to Agents</Button>
                            </EmptyState.Footer>
                        )}
                    </EmptyState>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {agents.map((agent: AgentState) => (
                        <AgentCard
                            key={agent.id}
                            agent={agent}
                            activity={state.activity[agent.id]}
                            availability={modelAvailability(state, agent.config.provider, agent.config.model)}
                            actions={actions}
                            settings={state.settings}
                            onOpen={() => setOpenId(agent.id)}
                            onNavigate={() => onNavigate?.({ kind: "agents" })}
                        />
                    ))}
                </div>
            )}

            <AgentActivitySlideout
                agent={openAgent}
                activity={openId ? state.activity[openId] : undefined}
                actions={actions}
                isOpen={openId !== null}
                onClose={() => setOpenId(null)}
            />
        </section>
    );
};
