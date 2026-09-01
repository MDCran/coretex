// @ts-nocheck
"use client";

// Shared live-output console for agent cards and the activity slideout.
// Idle state is a composed standby panel (not raw placeholder text in a code block).

import type { ReactNode } from "react";
import { Terminal, Activity } from "@untitledui/icons";
import { BadgeWithDot } from "@/components/base/badges/badges";
import { CodeSnippet } from "@/components/application/code-snippet/code-snippet";
import { cx } from "@/utils/cx";

interface AgentOutputConsoleProps {
    stream?: string;
    step?: number;
    /** Agent is actively producing output (working / thinking). */
    active?: boolean;
    /** Compact height for grid cards; roomier for the activity slideout. */
    size?: "card" | "panel";
    className?: string;
    /** Optional header actions (e.g. open console). */
    actions?: ReactNode;
}

export function AgentOutputConsole({
    stream,
    step,
    active = false,
    size = "card",
    className,
    actions,
}: AgentOutputConsoleProps) {
    const hasStream = typeof stream === "string" && stream.trim().length > 0;
    const stepLabel = typeof step === "number" && step > 0 ? `Step ${step}` : null;
    const title = stepLabel ? `Console · ${stepLabel}` : "Console";

    if (hasStream) {
        return (
            <CodeSnippet
                className={className}
                bodyClassName={size === "card" ? "h-24 overflow-y-auto" : "max-h-72 overflow-y-auto"}
                title={title}
                language={active ? "live" : undefined}
                code={stream!}
                actions={actions}
            />
        );
    }

    const tall = size === "panel";

    return (
        <div
            className={cx("overflow-hidden rounded-xl", className)}
            style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
        >
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: "var(--c-border)" }}>
                <div className="flex min-w-0 items-center gap-2">
                    <Terminal className="size-3.5 shrink-0 text-quaternary" />
                    <span className="truncate text-xs font-medium text-secondary">{title}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {actions}
                    <BadgeWithDot size="sm" color="gray" type="pill-color">
                        Standby
                    </BadgeWithDot>
                </div>
            </div>

            <div
                className={cx(
                    "relative flex flex-col items-center justify-center gap-2.5 px-4 text-center",
                    tall ? "min-h-[11rem] py-8" : "h-24 py-3",
                )}
            >
                {/* Subtle grid / terminal atmosphere */}
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 opacity-[0.35]"
                    style={{
                        backgroundImage:
                            "linear-gradient(var(--c-border) 1px, transparent 1px), linear-gradient(90deg, var(--c-border) 1px, transparent 1px)",
                        backgroundSize: "16px 16px",
                        maskImage: "radial-gradient(ellipse at center, black 20%, transparent 72%)",
                        WebkitMaskImage: "radial-gradient(ellipse at center, black 20%, transparent 72%)",
                    }}
                />

                <span
                    className="relative grid size-8 place-items-center rounded-lg"
                    style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                >
                    <Activity className="size-3.5 text-quaternary" />
                </span>

                <div className="relative flex flex-col gap-0.5">
                    <p className="text-xs font-medium text-secondary">Awaiting assignment</p>
                    {tall ? (
                        <p className="max-w-[16rem] text-[11px] leading-relaxed text-quaternary">
                            No live stream yet. Output from the next assigned task will appear here.
                        </p>
                    ) : (
                        <p className="font-mono text-[10px] text-quaternary">ready · no active job</p>
                    )}
                </div>
            </div>
        </div>
    );
}
