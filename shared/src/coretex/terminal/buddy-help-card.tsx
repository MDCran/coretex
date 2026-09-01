// @ts-nocheck
"use client";

// Coretex — Terminal Buddy "needs help" card. Shown when automatic recovery is
// exhausted for a step. Surfaces the failing command, the error output, the
// buddy's classification, and the user's choices: retry with a different
// approach (free-text guidance), edit the command manually, skip the step, or
// stop the whole task.

import { useState } from "react";
import { LifeBuoy01, RefreshCw02, Edit03, ChevronDown, ChevronUp, Play } from "@untitledui/icons";
import type { BuddyHelp } from "@repo/coretex/types";
import { cx } from "@/utils/cx";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { TextArea } from "@/components/base/textarea/textarea";

interface Props {
    help: BuddyHelp;
    onRetry: (approach?: string) => void;
    onEdit: (command: string) => void;
    onSkip: () => void;
    onReject: () => void;
    className?: string;
}

export const BuddyHelpCard = ({ help, onRetry, onEdit, onSkip, onReject, className }: Props) => {
    const [approach, setApproach] = useState("");
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(help.command);
    const [errorOpen, setErrorOpen] = useState(true);

    return (
        <div
            className={cx("flex flex-col gap-2 rounded-lg p-2.5", className)}
            style={{ background: "color-mix(in srgb, var(--c-error) 7%, var(--surface))", border: "1px solid color-mix(in srgb, var(--c-error) 35%, var(--c-border))" }}
        >
            <div className="flex items-center gap-2">
                <LifeBuoy01 className="size-4 shrink-0" style={{ color: "var(--c-error)" }} />
                <span className="flex-1 text-xs font-semibold text-primary">Buddy needs your help</span>
                {help.classification && (
                    <Badge size="sm" color="error">
                        {help.classification}
                    </Badge>
                )}
            </div>

            <p className="text-[11px] leading-snug text-secondary">{help.diagnosis}</p>

            {/* Failing command */}
            <pre
                className="overflow-x-auto whitespace-pre-wrap break-all rounded-md px-2 py-1.5 font-mono text-[11px] text-primary"
                style={{ background: "var(--app-bg)", border: "1px solid var(--c-border)" }}
            >
                <span className="select-none text-quaternary">$ </span>
                {help.command}
            </pre>

            {/* Error output (collapsible) */}
            {help.error && (
                <div>
                    <button
                        type="button"
                        onClick={() => setErrorOpen((v) => !v)}
                        aria-expanded={errorOpen}
                        aria-label={errorOpen ? "Hide error output" : "Show error output"}
                        className="inline-flex items-center gap-1 text-[11px] text-quaternary transition hover:text-secondary"
                    >
                        {errorOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                        error output
                    </button>
                    {errorOpen && (
                        <pre
                            className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-tertiary"
                            style={{ background: "var(--app-bg)", border: "1px solid var(--c-border)" }}
                        >
                            {help.error}
                        </pre>
                    )}
                </div>
            )}

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
                        <Button size="sm" color="secondary" onClick={() => { setEditing(false); setDraft(help.command); }}>
                            Cancel
                        </Button>
                        <Button size="sm" color="primary" iconLeading={Play} onClick={() => { setEditing(false); onEdit(draft.trim()); }} isDisabled={!draft.trim()}>
                            Run edited
                        </Button>
                    </div>
                </div>
            ) : (
                <>
                    {/* Retry with guidance */}
                    <div className="flex items-center gap-1.5">
                        <input
                            value={approach}
                            onChange={(e) => setApproach(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    onRetry(approach.trim() || undefined);
                                    setApproach("");
                                }
                            }}
                            placeholder="Suggest a different approach (optional)…"
                            aria-label="Suggest a different approach for the buddy"
                            className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-[11px] text-primary outline-none transition focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand)_40%,transparent)] placeholder:text-placeholder"
                            style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                        />
                        <Button size="sm" color="primary" iconLeading={RefreshCw02} onClick={() => { onRetry(approach.trim() || undefined); setApproach(""); }}>
                            Retry
                        </Button>
                    </div>

                    {/* Secondary actions */}
                    <div className="flex items-center gap-1.5">
                        <Button size="sm" color="secondary" iconLeading={Edit03} onClick={() => { setDraft(help.command); setEditing(true); }}>
                            Edit command
                        </Button>
                        <Button size="sm" color="tertiary" onClick={onSkip}>
                            Skip step
                        </Button>
                        <div className="flex-1" />
                        <div className="h-5 w-px shrink-0" style={{ background: "color-mix(in srgb, var(--c-error) 30%, var(--c-border))" }} />
                        <Button size="sm" color="tertiary-destructive" onClick={onReject}>
                            Stop
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
};
