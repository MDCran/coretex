// @ts-nocheck
// Coretex — Untitled UI-style code snippet block: a framed code card with an
// optional header (filename + language + actions), a copy button, optional line
// numbers, and an optional collapse-with-"show more". Used to display code, file
// contents, terminal output, and generated plan documents consistently. Themed
// with the Coretex CSS tokens so it reads correctly in light + dark.

import { useState, type ReactNode } from "react";
import { Copy01, Check, ChevronDown } from "@untitledui/icons";
import { cx } from "@/utils/cx";

interface Props {
    /** The code/text to display. */
    code: string;
    /** Language label shown in the header (e.g. "ts", "markdown", "bash"). */
    language?: string;
    /** Filename/title shown on the left of the header. */
    title?: string;
    /** Show a gutter of line numbers. */
    showLineNumbers?: boolean;
    /** If set and the code exceeds this many lines, collapse with a "Show more" toggle. */
    collapsedLines?: number;
    className?: string;
    /** Extra classes for the scrollable code body (e.g. a fixed height "h-24 overflow-y-auto"). */
    bodyClassName?: string;
    /** Extra header actions (rendered before the copy button). */
    actions?: ReactNode;
}

export const CodeSnippet = ({ code, language, title, showLineNumbers = false, collapsedLines, className, bodyClassName, actions }: Props) => {
    const [copied, setCopied] = useState(false);
    const [expanded, setExpanded] = useState(false);

    const lines = code.split("\n");
    const collapsible = typeof collapsedLines === "number" && lines.length > collapsedLines;
    const shown = collapsible && !expanded ? lines.slice(0, collapsedLines) : lines;

    const copy = (): void => {
        void navigator.clipboard?.writeText(code);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    const showHeader = Boolean(title || language || actions);

    return (
        <div className={cx("overflow-hidden rounded-xl", className)} style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
            {showHeader && (
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: "var(--c-border)" }}>
                    <div className="flex min-w-0 items-center gap-2">
                        {title && <span className="truncate text-xs font-medium text-secondary">{title}</span>}
                        {language && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-quaternary" style={{ border: "1px solid var(--c-border)" }}>{language}</span>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        {actions}
                        <button type="button" onClick={copy} title="Copy" className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-tertiary transition hover:bg-[var(--surface)] hover:text-secondary">
                            {copied ? <Check className="size-3.5 text-success-primary" /> : <Copy01 className="size-3.5" />} {copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                </div>
            )}

            <div className="relative">
                <pre className={cx("overflow-x-auto p-3 font-mono text-xs leading-relaxed text-secondary", bodyClassName)}>
                    <code>
                        {showLineNumbers ? (
                            shown.map((ln, i) => (
                                <div key={i} className="flex">
                                    <span className="mr-3 inline-block w-8 shrink-0 select-none text-right text-quaternary">{i + 1}</span>
                                    <span className="whitespace-pre">{ln || " "}</span>
                                </div>
                            ))
                        ) : (
                            <span className="whitespace-pre-wrap">{shown.join("\n")}</span>
                        )}
                    </code>
                </pre>
                {collapsible && !expanded && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: "linear-gradient(transparent, var(--surface-2))" }} />
                )}
            </div>

            {collapsible && (
                <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-center gap-1 border-t py-1.5 text-[11px] font-medium text-tertiary transition hover:bg-[var(--surface)]" style={{ borderColor: "var(--c-border)" }}>
                    <ChevronDown className={cx("size-3.5 transition", expanded && "rotate-180")} /> {expanded ? "Show less" : `Show ${lines.length - (collapsedLines ?? 0)} more lines`}
                </button>
            )}
        </div>
    );
};
