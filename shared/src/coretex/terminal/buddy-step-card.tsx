// @ts-nocheck
"use client";

// Coretex — Terminal Buddy step card. One card per planned command: shows the
// command (mono block + copy), a plain-language description, a color-coded risk
// badge, and status-appropriate controls. In Suggest mode (or for a destructive
// step needing confirmation) it surfaces Accept / Edit / Skip / Reject; while
// running it shows a spinner; on success/failure it shows the captured output.

import { useState } from "react";
import {
    CheckCircle,
    XCircle,
    AlertTriangle,
    RefreshCw02,
    Play,
    Edit03,
    Copy01,
    ChevronDown,
    ChevronUp,
    Clock,
} from "@untitledui/icons";
import type { BuddyStepRuntime } from "@repo/coretex/types";
import { cx } from "@/utils/cx";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { TextArea } from "@/components/base/textarea/textarea";
import type { BadgeColors } from "@/components/base/badges/badge-types";

interface Props {
    step: BuddyStepRuntime;
    index: number;
    /** Suggest = approval expected for every step; Auto = only for confirm gates. */
    onAccept: (command?: string) => void;
    onSkip: () => void;
    onReject: () => void;
}

const RISK_BADGE: Record<BuddyStepRuntime["riskLevel"], { color: BadgeColors; label: string }> = {
    safe: { color: "success", label: "Safe" },
    caution: { color: "warning", label: "Caution" },
    destructive: { color: "error", label: "Destructive" },
};

const RISK_BAR: Record<BuddyStepRuntime["riskLevel"], string> = {
    safe: "var(--c-success)",
    caution: "var(--c-warning)",
    destructive: "var(--c-error)",
};

function StatusGlyph({ status }: { status: BuddyStepRuntime["status"] }) {
    switch (status) {
        case "running":
            return <RefreshCw02 className="size-3.5 animate-spin" style={{ color: "var(--brand)" }} />;
        case "success":
            return <CheckCircle className="size-3.5" style={{ color: "var(--c-success)" }} />;
        case "failed":
            return <XCircle className="size-3.5" style={{ color: "var(--c-error)" }} />;
        case "awaiting":
            return <AlertTriangle className="size-3.5" style={{ color: "var(--c-warning)" }} />;
        case "skipped":
            return <ChevronDown className="size-3.5 text-quaternary" />;
        default:
            return <Clock className="size-3.5 text-quaternary" />;
    }
}

export const BuddyStepCard = ({ step, index, onAccept, onSkip, onReject }: Props) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(step.command);
    const [copied, setCopied] = useState(false);
    const [outputOpen, setOutputOpen] = useState(false);

    const risk = RISK_BADGE[step.riskLevel];
    const awaiting = step.status === "awaiting";
    const muted = step.status === "skipped" || step.status === "pending";

    const copy = (): void => {
        void navigator.clipboard?.writeText(step.command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        });
    };

    return (
        <div
            className={cx("flex flex-col gap-1.5 rounded-lg p-2 transition", muted && "opacity-55")}
            style={{ background: "var(--surface)", border: "1px solid var(--c-border)", borderLeft: `2px solid ${RISK_BAR[step.riskLevel]}` }}
        >
            {/* Header: index · status · description · risk */}
            <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold tabular-nums text-quaternary">{index + 1}</span>
                    <StatusGlyph status={step.status} />
                </span>
                <p className="min-w-0 flex-1 text-xs leading-snug text-secondary">{step.description}</p>
                <Badge size="sm" color={risk.color} className="shrink-0">
                    {risk.label}
                </Badge>
            </div>

            {/* Command */}
            {editing ? (
                <div className="flex flex-col gap-1.5">
                    <TextArea
                        value={draft}
                        onChange={setDraft}
                        rows={2}
                        aria-label="Edit command"
                        textAreaClassName="resize-y font-mono text-[11px] ring-brand bg-[var(--app-bg)]"
                    />
                    <div className="flex justify-end gap-1.5">
                        <Button size="sm" color="secondary" onClick={() => { setEditing(false); setDraft(step.command); }}>
                            Cancel
                        </Button>
                        <Button size="sm" color="primary" iconLeading={Play} onClick={() => { setEditing(false); onAccept(draft.trim()); }} isDisabled={!draft.trim()}>
                            Run edited
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="group relative">
                    <pre
                        className="overflow-x-auto whitespace-pre-wrap break-all rounded-md px-2 py-1.5 font-mono text-[11px] leading-relaxed text-primary"
                        style={{ background: "var(--app-bg)", border: "1px solid var(--c-border)" }}
                    >
                        <span className="select-none text-quaternary">$ </span>
                        {step.command}
                    </pre>
                    <button
                        type="button"
                        onClick={copy}
                        aria-label={copied ? "Command copied" : "Copy command"}
                        title={copied ? "Copied" : "Copy command"}
                        className="absolute right-1 top-1 rounded p-1 text-quaternary opacity-0 transition hover:bg-[var(--surface-2)] hover:text-secondary group-hover:opacity-100 focus-visible:opacity-100"
                    >
                        {copied ? <CheckCircle className="size-3.5" style={{ color: "var(--c-success)" }} /> : <Copy01 className="size-3.5" />}
                    </button>
                </div>
            )}

            {/* Diagnosis (when failing / recovering) */}
            {step.diagnosis && step.status !== "success" && (
                <p className="flex items-start gap-1.5 text-[11px]" style={{ color: "var(--c-warning)" }}>
                    <AlertTriangle className="mt-px size-3 shrink-0" />
                    <span>{step.diagnosis}</span>
                </p>
            )}

            {/* Attempt indicator while running a retry */}
            {step.status === "running" && step.attempt > 1 && (
                <p className="text-[11px] text-quaternary">Recovery attempt {step.attempt}</p>
            )}

            {/* Captured output (collapsible) */}
            {step.output && (step.status === "success" || step.status === "failed") && (
                <div>
                    <button
                        type="button"
                        onClick={() => setOutputOpen((v) => !v)}
                        aria-expanded={outputOpen}
                        aria-label={outputOpen ? "Hide command output" : "Show command output"}
                        className="inline-flex items-center gap-1 text-[11px] text-quaternary transition hover:text-secondary"
                    >
                        {outputOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                        {step.exitCode !== undefined ? `exit ${step.exitCode}` : "output"}
                    </button>
                    {outputOpen && (
                        <pre
                            className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-tertiary"
                            style={{ background: "var(--app-bg)", border: "1px solid var(--c-border)" }}
                        >
                            {step.output}
                        </pre>
                    )}
                </div>
            )}

            {/* Approval controls */}
            {awaiting && !editing && (
                <div className="flex items-center gap-1.5 pt-0.5">
                    <Button size="sm" color="primary" iconLeading={Play} onClick={() => onAccept()}>
                        Accept
                    </Button>
                    <Button size="sm" color="secondary" iconLeading={Edit03} onClick={() => { setDraft(step.command); setEditing(true); }}>
                        Edit
                    </Button>
                    <Button size="sm" color="tertiary" onClick={onSkip}>
                        Skip
                    </Button>
                    <div className="flex-1" />
                    <div className="h-5 w-px shrink-0" style={{ background: "var(--c-border)" }} />
                    <Button size="sm" color="tertiary-destructive" onClick={onReject}>
                        Reject all
                    </Button>
                </div>
            )}
        </div>
    );
};
