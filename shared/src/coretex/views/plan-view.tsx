// @ts-nocheck
"use client";

// Coretex Relay — Plan mode. A dedicated planner agent produces a long Markdown
// plan document for a goal (optionally attached to a task), streaming live. Pick
// any agent as the planner — agents with the "planner" role are highlighted, and
// you can run different planners for the same goal.

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ClipboardCheck, Copy01, Play, SlashCircle01, Stars01, Users01 } from "@untitledui/icons";







import { agentAvailability, type CoretexActions, type CoretexState } from "../use-coretex";
import type { NavTarget } from "../nav";
import { roleLabel, providerLabel } from "../labels";
import { IdentityAvatar } from "../ui/identity-avatar";
import { useContextMenu, type MenuItem } from "../ui/context-menu";
import { CodeSnippet } from "@/components/application/code-snippet/code-snippet";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { NativeSelect } from "@/components/base/select/select-native";
import { TextArea } from "@/components/base/textarea/textarea";
import { cx } from "@/utils/cx";

const cardStyle = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;

export const PlanView = ({ state, actions, onNavigate }: { state: CoretexState; actions: CoretexActions; onNavigate?: (target: NavTarget) => void }) => {
    const agents = state.agents ?? [];
    const plan = state.planning;
    const tasks = (state.tasks ?? []).filter((t) => t.status !== "completed" && t.status !== "cancelled");

    const [plannerId, setPlannerId] = useState<string>("");
    const [prompt, setPrompt] = useState("");
    const [taskId, setTaskId] = useState<string>("");
    const docRef = useRef<HTMLDivElement>(null);

    // Default the planner to a planner-role agent, else the first agent.
    useEffect(() => {
        if (agents.length === 0) {
            if (plannerId) setPlannerId("");
            return;
        }
        if (agents.some((agent) => agent.id === plannerId)) return;
        const planner = agents.find((a) => a.config.role === "planner") ?? agents[0];
        setPlannerId(planner.id);
    }, [agents, plannerId]);

    useEffect(() => {
        docRef.current?.scrollTo({ top: docRef.current.scrollHeight });
    }, [plan.markdown]);

    const { open: openMenu, node: menuNode } = useContextMenu();

    const planner = agents.find((a) => a.id === plannerId);
    const plannerRuntime = planner ? agentAvailability(state, planner, true) : { available: false, reason: "Select a planner agent first." };
    const dailyLimitReached = Boolean(state.cost && state.cost.dailyLimit > 0 && state.cost.totalCostToday >= state.cost.dailyLimit);
    const planReason = dailyLimitReached
        ? "The daily AI spend limit has been reached. Raise it in Usage & Analytics to generate another plan."
        : plannerRuntime.reason;
    const canRun = prompt.trim().length > 0 && plannerId.length > 0 && plannerRuntime.available && !dailyLimitReached && !plan.running;
    const run = () => {
        if (!canRun) return;
        actions.runPlan(plannerId, prompt.trim(), taskId || undefined);
    };

    // Run a plan with a specific planner agent (right-click on its card). Mirrors
    // the "Generate plan" button but targets the agent under the cursor.
    const hasPrompt = prompt.trim().length > 0;
    const runWith = (agentId: string) => {
        if (!hasPrompt || plan.running) return;
        setPlannerId(agentId);
        actions.runPlan(agentId, prompt.trim(), taskId || undefined);
    };

    const copyPlan = () => {
        if (!plan.markdown) return;
        try { void navigator.clipboard?.writeText(plan.markdown); } catch { /* clipboard unavailable */ }
    };

    // Menu for a planner agent card — mirrors the Generate plan / Stop buttons.
    const agentMenuItems = (agentId: string): MenuItem[] => {
        const target = agents.find((agent) => agent.id === agentId);
        const targetAvailable = target ? agentAvailability(state, target, true).available : false;
        const items: MenuItem[] = [
            {
                key: "run",
                label: "Run plan with this planner",
                icon: Play,
                disabled: !hasPrompt || plan.running || !targetAvailable || dailyLimitReached,
                onClick: () => runWith(agentId),
            },
        ];
        if (plan.running) {
            items.push({ key: "stop", label: "Stop planning", icon: SlashCircle01, danger: true, onClick: () => actions.stopPlan() });
        }
        return items;
    };

    // Menu for the streamed plan document — copy plus run/stop controls.
    const docMenuItems = (): MenuItem[] => {
        const items: MenuItem[] = [
            { key: "copy", label: "Copy plan", icon: Copy01, disabled: !plan.markdown, onClick: copyPlan },
            { separator: true },
            { key: "run", label: "Run plan", icon: Play, disabled: !canRun, onClick: run },
        ];
        if (plan.running) {
            items.push({ key: "stop", label: "Stop planning", icon: SlashCircle01, danger: true, onClick: () => actions.stopPlan() });
        }
        return items;
    };

    return (
        <div className="flex h-full w-full flex-col gap-5">
            <div>
                <h1 className="text-display-sm font-semibold text-primary">Plan mode</h1>
                <p className="mt-1 text-sm text-tertiary">A dedicated planner agent writes a complete, step-by-step plan document for your goal — pick the planner and watch it think.</p>
            </div>

            {/* Setup */}
            <div className="rounded-xl p-5" style={cardStyle}>
                <p className="mb-2 text-xs font-medium text-secondary">Planner agent</p>
                {agents.length === 0 ? (
                    <div className="relative min-h-64 overflow-hidden rounded-xl border border-dashed border-secondary bg-secondary px-6 py-10">
                        <EmptyState size="sm">
                            <EmptyState.Header>
                                <EmptyState.FeaturedIcon color="brand" theme="light" icon={Users01} />
                            </EmptyState.Header>
                            <EmptyState.Content>
                                <EmptyState.Title>No planner available</EmptyState.Title>
                                <EmptyState.Description>Create a Planner agent, then choose it here to turn a goal into an executable plan.</EmptyState.Description>
                            </EmptyState.Content>
                            {onNavigate && (
                                <EmptyState.Footer>
                                    <Button size="md" color="primary" iconTrailing={ArrowRight} onClick={() => onNavigate({ kind: "agents" })}>
                                        Go to Agents
                                    </Button>
                                </EmptyState.Footer>
                            )}
                        </EmptyState>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {agents.map((a) => {
                            const on = plannerId === a.id;
                            const isPlanner = a.config.role === "planner";
                            const runtime = agentAvailability(state, a, true);
                            return (
                                <button
                                    key={a.id}
                                    type="button"
                                    disabled={!runtime.available}
                                    title={runtime.reason}
                                    onClick={() => setPlannerId(a.id)}
                                    onContextMenu={(e) => openMenu(e, agentMenuItems(a.id))}
                                    className={cx("flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition", on ? "" : "opacity-70 hover:opacity-100", !runtime.available && "cursor-not-allowed opacity-45")}
                                    style={{ border: on ? "1px solid var(--brand)" : "1px solid var(--c-border)", background: on ? "var(--surface-2)" : "var(--surface)" }}
                                >
                                    <IdentityAvatar identity={a.config.identity} name={a.config.name} avatarUrl={a.config.avatarUrl} size={22} />
                                    <span className="font-medium text-primary">{a.config.name}</span>
                                    {isPlanner ? <Badge type="color" size="sm" color="brand">Planner</Badge> : <span className="text-xs text-quaternary">{roleLabel(a.config.role)}</span>}
                                </button>
                            );
                        })}
                    </div>
                )}

                <div className="mt-4 flex flex-col gap-3">
                    <TextArea
                        value={prompt}
                        onChange={(v) => setPrompt(v)}
                        rows={3}
                        placeholder="What should be planned? e.g. Add multi-tenant org support with row-level security across the API and dashboard."
                    />
                    <div className="flex flex-wrap items-center gap-3">
                        {tasks.length > 0 && (
                            <label className="flex items-center gap-2 text-xs text-tertiary">
                                Attach to task
                                <NativeSelect
                                    aria-label="Attach to task"
                                    value={taskId}
                                    onChange={(e) => setTaskId(e.target.value)}
                                    className="max-w-56"
                                    size="sm"
                                    options={[{ label: "None", value: "" }, ...tasks.map((t) => ({ label: t.title, value: t.id }))]}
                                />
                            </label>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                            {plan.running && (
                                <Button size="md" color="secondary-destructive" iconLeading={SlashCircle01} onClick={() => actions.stopPlan()}>Stop</Button>
                            )}
                            <Button size="md" color="primary" iconLeading={Play} onClick={run} isDisabled={!canRun}>Generate plan</Button>
                        </div>
                    </div>
                    {!plan.running && (planReason || !prompt.trim()) && (
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs text-quaternary">{planReason ?? "Describe what you want planned to continue."}</p>
                            {dailyLimitReached && onNavigate && (
                                <Button size="sm" color="link-color" iconTrailing={ArrowRight} onClick={() => onNavigate({ kind: "usage" })}>
                                    Open usage
                                </Button>
                            )}
                            {!dailyLimitReached && planReason && planner && onNavigate && (
                                <Button size="sm" color="link-color" iconTrailing={ArrowRight} onClick={() => onNavigate({ kind: "settings", page: "ai-providers" })}>
                                    Manage providers
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Plan document */}
            {(plan.markdown || plan.running || plan.error) && (
                <div className="flex min-h-0 flex-1 flex-col rounded-xl" style={cardStyle} onContextMenu={(e) => openMenu(e, docMenuItems())}>
                    <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--c-border)" }}>
                        <span className="flex items-center gap-2 text-sm font-semibold text-primary">
                            <ClipboardCheck className="size-4 text-[var(--brand)]" /> Plan document
                            {planner && <span className="text-xs font-normal text-tertiary">by {planner.config.name} · {providerLabel(planner.config.provider)}</span>}
                            {plan.running && <span className="text-xs font-normal text-brand-secondary">writing…</span>}
                        </span>
                    </div>
                    <div ref={docRef} className="min-h-0 flex-1 overflow-y-auto p-5">
                        {plan.error ? (
                            <p className="text-sm text-error-primary">{plan.error}</p>
                        ) : plan.markdown ? (
                            <CodeSnippet code={plan.markdown} title="plan.md" language="markdown" />
                        ) : (
                            <div className="flex items-center gap-2 text-sm text-tertiary"><Stars01 className="size-4" /> The planner is thinking…</div>
                        )}
                    </div>
                </div>
            )}
            {menuNode}
        </div>
    );
};
