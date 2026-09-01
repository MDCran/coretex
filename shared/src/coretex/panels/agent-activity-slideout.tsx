// @ts-nocheck
"use client";

// Coretex Relay — agent activity slideout. Click an agent to inspect its live
// background work: status, current task, permission mode, token/cost counters,
// and the streaming step output — in an Untitled UI Slideout Menu.

import { PauseCircle, Play } from "@untitledui/icons";
import type { AgentState } from "@repo/coretex/types";
import { BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import { providerLabel, roleLabel, statusLabel } from "../labels";
import { AGENT_STATUS_COLOR, formatTokens, formatUSD, type AgentActivity, type CoretexActions } from "../use-coretex";
import { IdentityAvatar } from "../ui/identity-avatar";
import { HaltButton } from "../ui/halt-button";
import { PERMISSION_MODES } from "../ui/permission-mode-select";
import { AgentOutputConsole } from "./agent-output-console";

interface Props {
    agent: AgentState | null;
    activity?: AgentActivity;
    actions: CoretexActions;
    isOpen: boolean;
    onClose: () => void;
}

const fmtDate = (iso?: string): string => {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch {
        return "—";
    }
};

export const AgentActivitySlideout = ({ agent, activity, actions, isOpen, onClose }: Props) => {
    if (!agent) {
        return <SlideoutMenu isOpen={isOpen} onOpenChange={(v) => !v && onClose()} isDismissable><div /></SlideoutMenu>;
    }

    const cfg = agent.config;
    const status = agent.status;
    const isPaused = status === "paused";
    const active = status === "working" || status === "thinking";
    const mode = cfg.permissionMode ?? "ask";
    const modeLabel = PERMISSION_MODES.find((m) => m.value === mode)?.label ?? "Ask";
    const stream = activity?.stream;

    const rows: { label: string; value: string }[] = [
        { label: "Current task", value: agent.currentTaskId ?? "—" },
        { label: "Permission mode", value: modeLabel },
        { label: "Steps taken", value: String(agent.stepCount) },
        { label: "Tokens today", value: formatTokens(agent.tokensUsedToday) },
        { label: "Tokens all-time", value: formatTokens(agent.tokensUsedTotal) },
        { label: "Cost today", value: formatUSD(agent.costToday) },
        { label: "Cost all-time", value: formatUSD(agent.costTotal) },
        { label: "Created", value: fmtDate(agent.createdAt) },
        { label: "Last active", value: fmtDate(agent.lastActiveAt) },
    ];

    return (
        <SlideoutMenu isOpen={isOpen} onOpenChange={(v) => !v && onClose()} isDismissable dialogClassName="gap-0">
            <SlideoutMenu.Header onClose={onClose} className="flex w-full items-start gap-3">
                <IdentityAvatar identity={cfg.identity} name={cfg.name} avatarUrl={cfg.avatarUrl} size={44} />
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-start gap-2">
                        <h1 className="min-w-0 flex-1 break-words text-md font-semibold leading-6 text-primary [overflow-wrap:anywhere] md:text-lg" title={cfg.name}>{cfg.name}</h1>
                        <BadgeWithDot size="sm" color={AGENT_STATUS_COLOR[status]} className="shrink-0">{statusLabel(status)}</BadgeWithDot>
                    </div>
                    <p className="mt-0.5 break-words text-sm text-tertiary [overflow-wrap:anywhere]" title={`${roleLabel(cfg.role)} · ${providerLabel(cfg.provider)} · ${cfg.model}`}>
                        {roleLabel(cfg.role)} · {providerLabel(cfg.provider)} · {cfg.model}
                    </p>
                </div>
            </SlideoutMenu.Header>

            <SlideoutMenu.Content className="py-6">
                <div className="flex flex-col gap-6">
                    {/* Details */}
                    <section>
                        <p className="mb-3 text-sm font-semibold text-primary">Details</p>
                        <dl className="flex flex-col divide-y divide-[var(--c-border)]">
                            {rows.map((r) => (
                                <div key={r.label} className="flex items-start justify-between gap-3 py-2">
                                    <dt className="shrink-0 text-xs text-tertiary">{r.label}</dt>
                                    <dd className="min-w-0 max-w-[64%] break-words text-right text-sm font-medium text-secondary tabular-nums [overflow-wrap:anywhere]" title={r.value}>{r.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </section>

                    {/* Live activity */}
                    <section>
                        <p className="mb-2 text-sm font-semibold text-primary">Live activity</p>
                        <AgentOutputConsole
                            stream={stream}
                            step={typeof activity?.step === "number" ? activity.step : undefined}
                            active={active}
                            size="panel"
                        />
                    </section>

                    {/* skill.md / system prompt preview */}
                    {cfg.systemPrompt && (
                        <section>
                            <p className="mb-2 text-sm font-semibold text-primary">Instructions</p>
                            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg p-3 font-mono text-xs text-tertiary" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                                {cfg.systemPrompt}
                            </div>
                        </section>
                    )}

                    {agent.status === "error" && agent.errorMessage && (
                        <p className="text-xs text-error-primary">{agent.errorMessage}</p>
                    )}
                </div>
            </SlideoutMenu.Content>

            <SlideoutMenu.Footer className="flex w-full items-center justify-end gap-2">
                {active && <HaltButton onHalt={() => actions.haltAgent(agent.id)} label="Halt" />}
                {isPaused ? (
                    <Button size="sm" color="secondary" iconLeading={Play} onClick={() => actions.resumeAgent(agent.id)}>
                        Resume
                    </Button>
                ) : (
                    <Button size="sm" color="secondary" iconLeading={PauseCircle} onClick={() => actions.pauseAgent(agent.id)}>
                        Pause
                    </Button>
                )}
            </SlideoutMenu.Footer>
        </SlideoutMenu>
    );
};
