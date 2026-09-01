// @ts-nocheck
"use client";

// Coretex — the Terminal Buddy bar. A collapsible strip docked at the bottom of a
// terminal pane: type what you want the buddy to do, pick Suggest vs Auto, see
// the assigned model, halt, and watch the plan run as step cards. It reads the
// per-session BuddySessionState (folded from buddy:* events) and drives the real
// engine via CoretexActions. Untitled UI components throughout.

import { useEffect, useRef, useState } from "react";
import { Send01, ChevronDown, ChevronUp, Stars02, RefreshCw02, CheckCircle, XCircle, StopCircle } from "@untitledui/icons";
import type { BuddyMode, BuddySessionState, BuddyStatus, ModelInfo, ProviderType } from "@repo/coretex/types";
import type { CoretexActions } from "../use-coretex";
import { cx } from "@/utils/cx";
import { Button } from "@/components/base/buttons/button";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { BadgeWithDot } from "@/components/base/badges/badges";
import type { BadgeColors } from "@/components/base/badges/badge-types";
import { HelpTooltip } from "../ui/help-tooltip";
import { HaltButton } from "../ui/halt-button";
import { BrandLogo, PROVIDER_DOMAIN } from "../ui/brand-logo";
import { ModelPicker } from "../ui/model-picker";
import { MicButton } from "../ui/mic-button";
import type { ComposerSpeechOptions } from "../ui/ai-composer";
import { TerminalEnvTooltip } from "./terminal-env-tooltip";
import { BuddyStepCard } from "./buddy-step-card";
import { BuddyHelpCard } from "./buddy-help-card";

interface Props {
    /** The PTY session this bar drives. */
    sessionId: string;
    /** Live buddy state for this session (env, plan, steps, help, status). */
    buddy?: BuddySessionState;
    actions: CoretexActions;

    /** Live model catalog for the picker; when omitted the badge is display-only. */
    models?: ModelInfo[];
    /** Resolved fallback model for display before a probe assigns one. */
    model?: { provider: ProviderType; id: string } | null;
    onModelChange?: (provider: ProviderType, id: string) => void;

    /** Default mode for a fresh session (from settings). */
    defaultMode?: BuddyMode;
    /** Auto-probe the environment when the bar first mounts (settings.probeOnStart). */
    autoProbe?: boolean;

    /** Controlled collapse state (else internal). */
    collapsed?: boolean;
    onCollapsedChange?: (collapsed: boolean) => void;

    /** Speech-to-text (Settings → Microphone). */
    speech?: ComposerSpeechOptions;
    /** Also type final transcripts into the terminal PTY. */
    injectIntoTerminal?: boolean;

    className?: string;
}

const ACTIVE_STATUSES = new Set(["planning", "running", "recovering", "awaiting", "confirm", "needs-help"]);

/** Status → at-a-glance badge (text + color, so it reads even when collapsed). */
const STATUS_BADGE: Partial<Record<BuddyStatus, { color: BadgeColors; label: string }>> = {
    probing: { color: "brand", label: "Probing" },
    planning: { color: "brand", label: "Planning" },
    running: { color: "brand", label: "Running" },
    recovering: { color: "warning", label: "Recovering" },
    awaiting: { color: "warning", label: "Review" },
    confirm: { color: "warning", label: "Confirm" },
    "needs-help": { color: "error", label: "Needs help" },
    done: { color: "success", label: "Done" },
    failed: { color: "error", label: "Failed" },
    halted: { color: "gray", label: "Stopped" },
};

export const TerminalBuddyBar = ({
    sessionId,
    buddy,
    actions,
    models,
    model,
    onModelChange,
    defaultMode = "suggest",
    autoProbe = true,
    collapsed,
    onCollapsedChange,
    className,
    speech,
    injectIntoTerminal,
}: Props) => {
    const [text, setText] = useState("");
    const [internalCollapsed, setInternalCollapsed] = useState(false);
    const [mode, setMode] = useState<BuddyMode>(buddy?.mode ?? defaultMode);
    const probedRef = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const env = buddy?.env ?? undefined;
    const probing = buddy?.probing ?? false;
    const probeError = buddy?.probeError ?? null;
    const status = buddy?.status ?? "idle";
    const steps = buddy?.steps ?? [];
    const help = buddy?.help ?? null;
    const isActive = ACTIVE_STATUSES.has(status);
    const hasTask = steps.length > 0 || isActive || status === "done" || status === "failed" || status === "halted";

    const isCollapsed = collapsed ?? internalCollapsed;
    const setCollapsed = (v: boolean): void => {
        setInternalCollapsed(v);
        onCollapsedChange?.(v);
    };

    // Keep the local mode in sync when the server reports a different one (e.g. on probe).
    useEffect(() => {
        if (buddy?.mode && buddy.mode !== mode) setMode(buddy.mode);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [buddy?.mode]);

    // Auto-probe once when the bar mounts for an un-probed session. The Brain
    // normally starts this after shell integration; the short delay here is a
    // reconnect fallback and avoids racing that startup transaction.
    useEffect(() => {
        if (!autoProbe || probedRef.current) return;
        if (!env && !probing) {
            const timer = window.setTimeout(() => {
                probedRef.current = true;
                actions.buddyProbe(sessionId);
            }, 2_000);
            return () => window.clearTimeout(timer);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, env, probing, autoProbe]);

    // Keep the newest step in view.
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [steps.length, status, help]);

    const submit = (): void => {
        const t = text.trim();
        if (!t) return;
        actions.buddyRun(sessionId, t, mode);
        setText("");
    };

    const changeMode = (m: BuddyMode): void => {
        setMode(m);
        actions.buddySetMode(sessionId, m);
    };

    const displayModel = env?.assignedModel && env.assignedProvider ? { provider: env.assignedProvider, id: env.assignedModel } : model ?? null;
    const canPick = Boolean(models && models.length > 0 && onModelChange);

    return (
        <div
            className={cx("flex shrink-0 flex-col", className)}
            style={{ borderTop: "1px solid var(--c-border)", background: "var(--sidebar-bg)" }}
        >
            {/* Title row — collapse toggle + mode + env eye + model + halt. */}
            <div className="flex items-center gap-2 px-2.5 py-1.5">
                <button
                    type="button"
                    onClick={() => setCollapsed(!isCollapsed)}
                    aria-expanded={!isCollapsed}
                    aria-label={isCollapsed ? "Expand Terminal Buddy" : "Collapse Terminal Buddy"}
                    title={isCollapsed ? "Expand buddy" : "Collapse buddy"}
                    className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-semibold text-secondary transition hover:bg-[var(--surface-2)]"
                >
                    <Stars02 className="size-3.5" style={{ color: "var(--brand)" }} />
                    Buddy
                    {isActive && <RefreshCw02 className="size-3 animate-spin" style={{ color: "var(--brand)" }} />}
                    {isCollapsed ? <ChevronUp className="size-3.5 text-quaternary" /> : <ChevronDown className="size-3.5 text-quaternary" />}
                </button>

                {/* At-a-glance status (text + color; visible even when collapsed) */}
                {STATUS_BADGE[status] && (
                    <BadgeWithDot size="sm" color={STATUS_BADGE[status]!.color}>
                        {STATUS_BADGE[status]!.label}
                    </BadgeWithDot>
                )}

                {/* Mode toggle + help */}
                <div className="flex items-center gap-1">
                    <ButtonGroup
                        size="sm"
                        selectedKeys={[mode]}
                        onSelectionChange={(keys) => {
                            const next = [...keys][0] as BuddyMode | undefined;
                            if (next) changeMode(next);
                        }}
                    >
                        <ButtonGroupItem id="suggest">Suggest</ButtonGroupItem>
                        <ButtonGroupItem id="auto">Auto</ButtonGroupItem>
                    </ButtonGroup>
                    <HelpTooltip
                        title="Buddy mode"
                        text="Suggest proposes each command for your approval. Auto runs them autonomously, still confirming destructive steps."
                    />
                </div>

                <div className="flex-1" />

                {/* ⓘ environment eye */}
                <TerminalEnvTooltip env={env} probing={probing} onRefresh={() => actions.buddyProbe(sessionId)} />

                {/* Assigned model badge / picker — the dropdown is portaled + flips up,
                    so it's never clipped by the dock's overflow at the bottom of the rail. */}
                {canPick ? (
                    <ModelPicker
                        models={models!}
                        value={displayModel}
                        onChange={(provider, id) => onModelChange?.(provider, id)}
                        align="right"
                        renderTrigger={({ open, toggle }) => (
                            <button
                                type="button"
                                onClick={toggle}
                                aria-haspopup="listbox"
                                aria-expanded={open}
                                aria-label={displayModel ? `Buddy model: ${displayModel.id} (change)` : "Select a buddy model"}
                                title={displayModel ? displayModel.id : "Select a model"}
                                className="inline-flex max-w-[180px] cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-[background-color,color,box-shadow] duration-150 ease-out hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
                                style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                            >
                                {displayModel ? (
                                    <>
                                        <BrandLogo domain={PROVIDER_DOMAIN[displayModel.provider] ?? displayModel.provider} name={displayModel.provider} size={14} chip={false} />
                                        <span className="truncate text-secondary">{displayModel.id}</span>
                                    </>
                                ) : (
                                    <span className="text-quaternary">Auto model</span>
                                )}
                                <ChevronDown className={cx("size-3 shrink-0 text-quaternary transition-transform duration-150 ease-out", open && "rotate-180")} />
                            </button>
                        )}
                    />
                ) : (
                    <span
                        aria-label={displayModel ? `Buddy model: ${displayModel.id}` : "No model assigned"}
                        title={displayModel ? displayModel.id : "No model assigned"}
                        className="inline-flex max-w-[180px] cursor-default items-center gap-1.5 rounded-lg px-2 py-1 text-xs"
                        style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                    >
                        {displayModel ? (
                            <>
                                <BrandLogo domain={PROVIDER_DOMAIN[displayModel.provider] ?? displayModel.provider} name={displayModel.provider} size={14} chip={false} />
                                <span className="truncate text-secondary">{displayModel.id}</span>
                            </>
                        ) : (
                            <span className="text-quaternary">Auto model</span>
                        )}
                    </span>
                )}

                {/* Halt */}
                <HaltButton onHalt={() => actions.buddyHalt(sessionId)} size="sm" />
            </div>

            {/* Body — plan panel + task input + status (hidden when collapsed). */}
            {!isCollapsed && (
                <div className="flex flex-col gap-1.5 px-2.5 pb-2">
                    {hasTask && (
                        <div ref={scrollRef} className="flex max-h-[300px] flex-col gap-1.5 overflow-y-auto pr-0.5">
                            {buddy?.request && (
                                <p className="px-0.5 text-[11px] text-tertiary">
                                    <span className="font-medium text-secondary">Task:</span> {buddy.request}
                                </p>
                            )}
                            {status === "planning" && (
                                <div className="flex items-center gap-2 px-0.5 py-1 text-xs text-tertiary">
                                    <RefreshCw02 className="size-3.5 animate-spin" style={{ color: "var(--brand)" }} />
                                    Planning the steps for your environment…
                                </div>
                            )}
                            {steps.map((step, i) => (
                                <BuddyStepCard
                                    key={step.id}
                                    step={step}
                                    index={i}
                                    onAccept={(command) => actions.buddyAccept(sessionId, step.id, command)}
                                    onSkip={() => actions.buddySkip(sessionId, step.id)}
                                    onReject={() => actions.buddyReject(sessionId)}
                                />
                            ))}
                            {help && (
                                <BuddyHelpCard
                                    help={help}
                                    onRetry={(approach) => actions.buddyRetry(sessionId, help.stepId, approach)}
                                    onEdit={(command) => actions.buddyAccept(sessionId, help.stepId, command)}
                                    onSkip={() => actions.buddySkip(sessionId, help.stepId)}
                                    onReject={() => actions.buddyReject(sessionId)}
                                />
                            )}
                            {(status === "done" || status === "failed" || status === "halted") && buddy?.summary && (
                                <div
                                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs"
                                    style={{
                                        background: "var(--surface)",
                                        border: "1px solid var(--c-border)",
                                        color: status === "done" ? "var(--c-success)" : status === "halted" ? "var(--c-text-secondary)" : "var(--c-error)",
                                    }}
                                >
                                    {status === "done" ? <CheckCircle className="size-3.5" /> : status === "halted" ? <StopCircle className="size-3.5" /> : <XCircle className="size-3.5" />}
                                    {buddy.summary}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Idle hint — gives the empty bar an intentional, self-explanatory state. */}
                    {!hasTask && !probing && (
                        <div className="flex items-start gap-2 px-0.5 py-0.5 text-[11px] text-quaternary">
                            <Stars02 className="mt-0.5 size-3.5 shrink-0" style={{ color: "var(--brand)" }} />
                            <span>
                                Ask the buddy to set up, debug, or run something in this shell — it plans the steps and{" "}
                                {mode === "auto" ? "runs them within your guardrails." : "asks before each one."}
                            </span>
                        </div>
                    )}

                    {/* Task input */}
                    <div className="flex items-center gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 transition focus-within:ring-2 focus-within:ring-[color-mix(in_srgb,var(--brand)_40%,transparent)]" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                            <input
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        submit();
                                    }
                                }}
                                placeholder={isActive ? "Buddy is working — send a new task to restart…" : "Tell the buddy what to do…"}
                                aria-label="Buddy task"
                                className="min-w-0 flex-1 bg-transparent py-2 text-sm text-primary outline-none placeholder:text-placeholder"
                            />
                            {speech?.enabled && (
                                <MicButton
                                    size="sm"
                                    value={text}
                                    onChange={setText}
                                    onTranscript={(piece) => {
                                        if (injectIntoTerminal && piece.trim()) {
                                            actions.terminalInput(sessionId, piece.endsWith(" ") ? piece : `${piece} `);
                                        }
                                    }}
                                    language={speech.language}
                                    pushToTalk={speech.pushToTalk}
                                    autoSpace={speech.autoSpace !== false}
                                />
                            )}
                        </div>
                        <Button size="sm" color="primary" iconLeading={Send01} onClick={submit} isDisabled={!text.trim()}>
                            Send
                        </Button>
                    </div>

                    {/* Status line */}
                    <div className="flex min-h-[20px] items-center gap-2 px-0.5">
                        <p
                            className={cx("min-w-0 flex-1 truncate text-[11px]", probeError ? "text-error-primary" : "text-quaternary")}
                            title={probeError ?? buddy?.activity ?? undefined}
                        >
                            {probeError ?? buddy?.activity ?? (probing ? "Probing environment…" : `Ready · ${mode === "auto" ? "Auto" : "Suggest"} mode${env ? ` · ${env.osName ?? env.os ?? ""}` : ""}`)}
                        </p>
                        {probeError && (
                            <button
                                type="button"
                                onClick={() => actions.buddyProbe(sessionId)}
                                className="shrink-0 text-[11px] font-medium text-secondary underline-offset-2 hover:underline"
                            >
                                Retry
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
