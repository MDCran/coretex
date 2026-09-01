// @ts-nocheck
"use client";

// Coretex Relay — Council: multi-agent collaboration on one question
// (pipeline / debate / lead+specialists), with a live turn transcript.

import { useEffect, useRef, useState } from "react";
import { GitBranch01, MessageChatCircle, Play, SlashCircle01, Cube01, Users01, Lightbulb01, ArrowRight } from "@untitledui/icons";
import type { AgentState, TopologyKind } from "@repo/coretex/types";






import { agentAvailability, type CoretexActions, type CoretexState } from "../use-coretex";
import type { NavTarget } from "../nav";
import { providerLabel } from "../labels";
import { IdentityAvatar } from "../ui/identity-avatar";
import { RoleBadge } from "../ui/role-badge";
import { HelpTooltip } from "../ui/help-tooltip";
import { chipSelectClass, chipSelectStyle } from "../ui/pill-select";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { cx } from "@/utils/cx";

const cardStyle = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;

const KINDS: { value: TopologyKind; label: string; icon: typeof MessageChatCircle; desc: string; bestFor: string; example: string }[] = [
    {
        value: "sequential",
        label: "Pipeline",
        icon: GitBranch01,
        desc: "Agent A hands work to B, then C — each step builds on the last.",
        bestFor: "Use when: research → draft → review, or any staged workflow.",
        example: "Researcher summarizes docs → Writer drafts a plan → Reviewer critiques it.",
    },
    {
        value: "debate",
        label: "Debate",
        icon: MessageChatCircle,
        desc: "Agents argue the same question for several rounds, then you get a synthesized answer.",
        bestFor: "Use when: you need trade-offs challenged, not a single confident take.",
        example: "Two specialists argue API design choices; Coretex merges the final recommendation.",
    },
    {
        value: "orchestrator",
        label: "Lead + specialists",
        icon: Cube01,
        desc: "A lead agent plans, delegates to the others, then reviews and combines their output.",
        bestFor: "Use when: a big question splits into sub-tasks for different roles.",
        example: "Orchestrator splits a migration; Dev + DevOps each handle a slice; lead merges.",
    },
];

const PHASE_COLOR: Record<string, "brand" | "gray" | "success" | "warning"> = {
    plan: "brand",
    respond: "gray",
    synthesize: "success",
    turn: "gray",
};

const STEPS = [
    { n: "1", title: "Pick a mode", body: "Pipeline, Debate, or Lead + specialists — how the agents collaborate." },
    { n: "2", title: "Choose participants", body: "Select 2+ of your deployed agents (roles matter — mix specialists)." },
    { n: "3", title: "Ask one question", body: "Run the council and watch every turn stream live, then a final result." },
] as const;

export const CouncilView = ({
    state,
    actions,
    onNavigate,
}: {
    state: CoretexState;
    actions: CoretexActions;
    onNavigate?: (t: NavTarget) => void;
}) => {
    const agents = state.agents ?? [];
    const top = state.topology;

    const [kind, setKind] = useState<TopologyKind>("debate");
    const [prompt, setPrompt] = useState("");
    const [rounds, setRounds] = useState(2);
    const [selected, setSelected] = useState<string[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const available = agents.filter((agent) => agentAvailability(state, agent, true).available);
        setSelected((current) => {
            const valid = current.filter((id) => available.some((agent) => agent.id === id));
            return valid.length > 0 ? valid : available.slice(0, 2).map((agent) => agent.id);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agents, state.connected, state.health, state.models, state.settings?.ai.enabled]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, [top.turns.length, top.streaming?.content, top.result]);

    const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

    const minAgents = kind === "sequential" ? 1 : 2;
    const selectedUnavailable = selected.map((id) => agents.find((agent) => agent.id === id)).filter((agent): agent is AgentState => !!agent).map((agent) => agentAvailability(state, agent, true)).find((availability) => !availability.available);
    const dailyLimitReached = Boolean(state.cost && state.cost.dailyLimit > 0 && state.cost.totalCostToday >= state.cost.dailyLimit);
    const councilReason = !state.connected
        ? "Brain is disconnected. Reconnect before convening Council."
        : state.settings && !state.settings.ai.enabled
          ? "AI is disabled in Settings."
          : dailyLimitReached
            ? "The daily AI spend limit has been reached. Raise it in Usage & Analytics before convening Council."
          : selectedUnavailable?.reason;
    const canRun = prompt.trim().length > 0 && selected.length >= minAgents && !top.running && !councilReason;

    const run = () => {
        if (!canRun) return;
        actions.runTopology(kind, prompt.trim(), selected, rounds);
    };

    const agentById = (id: string): AgentState | undefined => agents.find((a) => a.id === id);
    const streamingAgent = top.streaming ? agentById(top.streaming.agentId) : undefined;
    const activeKind = KINDS.find((k) => k.value === kind)!;

    return (
        <div className="flex h-full w-full min-w-0 flex-col gap-5">
            <header className="flex flex-col gap-3">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-display-sm font-semibold text-primary">Council</h1>
                        <Badge size="sm" color="gray" type="color">
                            Multi-agent
                        </Badge>
                    </div>
                    <p className="mt-1 max-w-3xl text-sm leading-relaxed text-tertiary">
                        Bring multiple agents together to challenge a question, hand work through a pipeline, or divide it among specialists.
                    </p>
                </div>

                <details className="rounded-xl px-4 py-3" style={cardStyle}>
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-secondary">
                        <Lightbulb01 className="size-4 text-brand-secondary" /> When to use Council and how it works
                    </summary>
                    <div className="mt-4 grid gap-5 border-t pt-4 sm:grid-cols-2" style={{ borderColor: "var(--c-border)" }}>
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-quaternary">Best for</p>
                            <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm text-tertiary">
                                <li>Comparing more than one point of view before deciding.</li>
                                <li>Passing work through specialists in sequence.</li>
                                <li>Pressure-testing a recommendation before acting.</li>
                            </ul>
                        </div>
                        <ol className="flex flex-col gap-3">
                            {STEPS.map((step) => (
                                <li key={step.n} className="flex gap-3">
                                    <span className="grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-secondary" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>{step.n}</span>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-primary">{step.title}</p>
                                        <p className="text-xs text-tertiary">{step.body}</p>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </div>
                </details>
            </header>

            <div className="rounded-xl p-5" style={cardStyle}>
                <div className="mb-3">
                    <h2 className="text-sm font-semibold text-primary">Set up this session</h2>
                    <p className="text-xs text-tertiary">Choose how agents collaborate, who sits in, then ask your question.</p>
                </div>

                <p className="mb-2 text-xs font-medium text-secondary">Collaboration mode</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {KINDS.map((k) => {
                        const Icon = k.icon;
                        const active = kind === k.value;
                        return (
                            <button
                                key={k.value}
                                type="button"
                                onClick={() => setKind(k.value)}
                                className={cx("flex flex-col gap-1.5 rounded-xl p-3.5 text-left transition", active ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]")}
                                style={{
                                    border: "1px solid var(--c-border)",
                                    boxShadow: active ? "inset 0 0 0 1px color-mix(in srgb, var(--c-text-primary) 12%, transparent)" : undefined,
                                }}
                            >
                                <span className="flex items-center gap-2 text-sm font-semibold text-primary">
                                    <Icon className="size-4 text-secondary" />
                                    {k.label}
                                    {active && (
                                        <Badge size="sm" color="success" type="color">
                                            Selected
                                        </Badge>
                                    )}
                                </span>
                                <span className="text-xs leading-relaxed text-tertiary">{k.desc}</span>
                                <span className="mt-1 text-[11px] font-medium text-quaternary">{k.bestFor}</span>
                            </button>
                        );
                    })}
                </div>
                <p className="mt-2 text-[11px] text-quaternary">
                    Example for {activeKind.label}: <span className="text-tertiary">{activeKind.example}</span>
                </p>

                <div className="mt-5">
                    <p className="mb-2 text-xs font-medium text-secondary">
                        Participants{" "}
                        {kind === "orchestrator" && <span className="font-normal text-quaternary">(first selected = lead)</span>}
                        <span className="ml-1 font-normal text-quaternary">· pick at least {minAgents}</span>
                    </p>
                    {agents.length === 0 ? (
                        <div className="relative flex min-h-64 flex-col items-start gap-3 overflow-hidden rounded-xl px-4 py-5" style={{ background: "var(--surface-2)", border: "1px dashed var(--c-border)" }}>
                            <EmptyState size="sm" className="max-w-none items-start">
                                <EmptyState.Header className="self-start">
                                    <EmptyState.FeaturedIcon color="gray" theme="light" icon={Users01} />
                                </EmptyState.Header>
                                <EmptyState.Content className="items-start">
                                    <EmptyState.Title>Deploy agents first</EmptyState.Title>
                                    <EmptyState.Description className="text-left">
                                        Council seats the agents you already have. Create at least two on the Agents page, then come back.
                                    </EmptyState.Description>
                                </EmptyState.Content>
                            </EmptyState>
                            {onNavigate && (
                                <Button size="sm" color="primary" iconTrailing={ArrowRight} onClick={() => onNavigate({ kind: "agents" })}>
                                    Go to Agents
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {agents.map((a) => {
                                const on = selected.includes(a.id);
                                const availability = agentAvailability(state, a, true);
                                return (
                                    <button key={a.id} type="button" disabled={!availability.available} title={availability.reason} onClick={() => toggle(a.id)} className={cx(chipSelectClass(on), !availability.available && "cursor-not-allowed opacity-55")} style={chipSelectStyle(on)}>
                                        <IdentityAvatar identity={a.config.identity} name={a.config.name} avatarUrl={a.config.avatarUrl} size={22} />
                                        <span className="font-medium text-primary">{a.config.name}</span>
                                        <RoleBadge role={a.config.role} settings={state.settings} />
                                        {!availability.available && <Badge size="sm" color="error" type="color">Unavailable</Badge>}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="mt-5 flex flex-col gap-3">
                    <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-secondary">Question for the council</span>
                        <TextArea
                            value={prompt}
                            onChange={(v) => setPrompt(v)}
                            rows={5}
                            placeholder="e.g. Should we cache API responses at the edge or in Redis? Argue the trade-offs and recommend one."
                            textAreaClassName="min-h-[120px] leading-relaxed"
                        />
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                        {kind === "debate" && (
                            <label className="flex items-center gap-2 text-xs text-tertiary">
                                Debate rounds
                                <Input
                                    aria-label="Rounds"
                                    type="number"
                                    size="sm"
                                    value={String(rounds)}
                                    onChange={(v) => setRounds(Math.max(1, Math.min(6, Number(v) || 1)))}
                                    wrapperClassName="w-16"
                                />
                                <HelpTooltip title="Rounds" text="How many back-and-forth passes before a final synthesis. More rounds = deeper debate, more tokens. 2–3 is usually enough." />
                            </label>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                            {top.running && (
                                <Button size="md" color="secondary-destructive" iconLeading={SlashCircle01} onClick={() => actions.stopTopology()}>
                                    Stop
                                </Button>
                            )}
                            <Button size="md" color="primary" iconLeading={Play} onClick={run} isDisabled={!canRun}>
                                Convene council
                            </Button>
                        </div>
                    </div>
                    {!canRun && !top.running && (
                        <p className="text-[11px] text-quaternary">
                            {councilReason
                                ? councilReason
                                : agents.length < minAgents
                                ? `Need at least ${minAgents} agent${minAgents === 1 ? "" : "s"} deployed.`
                                : selected.length < minAgents
                                  ? `Select at least ${minAgents} participant${minAgents === 1 ? "" : "s"}.`
                                  : !prompt.trim()
                                    ? "Enter a question above to run."
                                    : null}
                        </p>
                    )}
                </div>
            </div>

            {(top.turns.length > 0 || top.streaming || top.error) && (
                <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl p-4" style={cardStyle}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-quaternary">Live transcript</p>
                        {top.running && (
                            <Badge size="sm" color="brand" type="color">
                                In session
                            </Badge>
                        )}
                    </div>
                    {top.turns.map((t, i) => {
                        const a = agentById(t.agentId);
                        return (
                            <TurnBubble
                                key={`${t.runId}-${i}`}
                                avatar={<IdentityAvatar identity={a?.config.identity} name={t.agentName} avatarUrl={a?.config.avatarUrl} size={30} />}
                                name={t.agentName}
                                role={<RoleBadge role={t.role} settings={state.settings} />}
                                provider={a ? providerLabel(a.config.provider) : undefined}
                                phase={t.phase}
                                round={t.round}
                                content={t.content}
                            />
                        );
                    })}
                    {top.streaming && top.streaming.content && (
                        <TurnBubble
                            avatar={<IdentityAvatar identity={streamingAgent?.config.identity} name={streamingAgent?.config.name ?? "Agent"} avatarUrl={streamingAgent?.config.avatarUrl} size={30} />}
                            name={streamingAgent?.config.name ?? "Agent"}
                            role={streamingAgent ? <RoleBadge role={streamingAgent.config.role} settings={state.settings} /> : undefined}
                            phase={top.streaming.phase}
                            round={top.streaming.round}
                            content={top.streaming.content}
                            live
                        />
                    )}
                    {top.error && <p className="text-sm text-error-primary">{top.error}</p>}
                    {top.result && !top.running && (
                        <div className="rounded-lg p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                            <Badge size="sm" color="success">
                                Final council result
                            </Badge>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-primary">{top.result}</p>
                        </div>
                    )}
                </div>
            )}

            {!top.running && top.turns.length === 0 && !top.error && (
                <div className="rounded-xl px-4 py-8 text-center" style={{ border: "1px dashed var(--c-border)" }}>
                    <Users01 className="mx-auto size-6 text-quaternary" />
                    <p className="mt-2 text-sm font-medium text-secondary">No session yet</p>
                    <p className="mx-auto mt-1 max-w-md text-xs text-quaternary">
                        After you convene a council, every agent turn appears here — like minutes from a meeting — ending with a combined result.
                    </p>
                </div>
            )}
        </div>
    );
};

const TurnBubble = ({
    avatar,
    name,
    role,
    provider,
    phase,
    round,
    content,
    live,
}: {
    avatar: React.ReactNode;
    name: string;
    role?: React.ReactNode;
    provider?: string;
    phase: string;
    round: number;
    content: string;
    live?: boolean;
}) => (
    <div className="flex gap-3">
        <div className="shrink-0">{avatar}</div>
        <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-primary">{name}</span>
                {role}
                {provider && <span className="text-xs text-quaternary">{provider}</span>}
                <Badge type="color" size="sm" color={PHASE_COLOR[phase] ?? "gray"}>
                    {phase === "turn" ? `round ${round}` : phase}
                </Badge>
                {live && <span className="text-xs text-tertiary">typing…</span>}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-secondary">{content}</p>
        </div>
    </div>
);
