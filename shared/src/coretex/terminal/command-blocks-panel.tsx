// @ts-nocheck
"use client";

// Coretex — Command Blocks panel. Surfaces the shell-integration block model for
// a terminal: the detected shell + live cwd (tracked via OSC 7), plus a scrollable
// list of completed command blocks (command + collapsible output + exit-code badge
// + duration + cwd). This is the "rich block-based terminal" view layered over the
// raw xterm — fed by terminal:shellInfo / terminal:block events (no extra protocol).

import { useEffect, useRef, useState } from "react";
import { Terminal, CheckCircle, ChevronDown, ChevronUp, Copy01, FolderClosed, XClose, LayoutAlt01 } from "@untitledui/icons";
import type { CommandBlock, CommandBlockState } from "@repo/coretex/types";
import { cx } from "@/utils/cx";
import { Badge } from "@/components/base/badges/badges";

interface Props {
    blocks?: CommandBlockState;
    onClose: () => void;
    className?: string;
}

function shortCwd(cwd: string): string {
    if (!cwd) return "";
    const norm = cwd.replace(/\\/g, "/");
    const parts = norm.split("/").filter(Boolean);
    return parts.length <= 3 ? norm : "…/" + parts.slice(-2).join("/");
}

function duration(b: CommandBlock): string | null {
    if (!b.endedAt) return null;
    const ms = Math.max(0, b.endedAt - b.startedAt);
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms / 60000)}m`;
}

const BlockRow = ({ block, showCwd }: { block: CommandBlock; showCwd: boolean }) => {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const failed = block.exitCode !== undefined && block.exitCode !== 0;
    const dur = duration(block);

    const copy = (): void => {
        void navigator.clipboard?.writeText(block.command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        });
    };

    return (
        <div
            className="flex flex-col gap-1 rounded-lg p-2"
            style={{
                background: "var(--surface)",
                border: "1px solid var(--c-border)",
                borderLeft: `2px solid ${failed ? "var(--c-error)" : block.exitCode === 0 ? "var(--c-success)" : "var(--c-border)"}`,
            }}
        >
            <div className="group flex items-start gap-2">
                <span className="min-w-0 flex-1 font-mono text-[11px] leading-snug break-all text-primary">
                    <span className="select-none text-quaternary">$ </span>
                    {block.command}
                </span>
                <button
                    type="button"
                    onClick={copy}
                    aria-label={copied ? "Command copied" : "Copy command"}
                    title={copied ? "Copied" : "Copy command"}
                    className="shrink-0 rounded p-0.5 text-quaternary opacity-0 transition hover:bg-[var(--surface-2)] hover:text-secondary group-hover:opacity-100 focus-visible:opacity-100"
                >
                    {copied ? <CheckCircle className="size-3.5" style={{ color: "var(--c-success)" }} /> : <Copy01 className="size-3.5" />}
                </button>
                {block.exitCode === undefined ? (
                    <Badge size="sm" color="gray" className="shrink-0">running</Badge>
                ) : failed ? (
                    <span title={`exit ${block.exitCode}`}>
                        <Badge size="sm" color="error" className="shrink-0">exit {block.exitCode}</Badge>
                    </span>
                ) : (
                    <Badge size="sm" color="success" className="shrink-0">ok</Badge>
                )}
            </div>

            <div className="flex items-center gap-2 text-[10px] text-quaternary">
                {dur && <span>{dur}</span>}
                {showCwd && block.cwd && (
                    <span className="inline-flex items-center gap-1" title={block.cwd}>
                        <FolderClosed className="size-2.5" />
                        {shortCwd(block.cwd)}
                    </span>
                )}
                {block.output && (
                    <button
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        aria-expanded={open}
                        aria-label={open ? "Hide output" : "Show output"}
                        className="inline-flex items-center gap-0.5 transition hover:text-secondary"
                    >
                        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                        output
                    </button>
                )}
            </div>

            {open && block.output && (
                <pre
                    className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-tertiary"
                    style={{ background: "var(--app-bg)", border: "1px solid var(--c-border)" }}
                >
                    {block.output}
                </pre>
            )}
        </div>
    );
};

export const CommandBlocksPanel = ({ blocks, onClose, className }: Props) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const info = blocks?.info ?? null;
    const list = blocks?.blocks ?? [];

    // Auto-scroll to the newest block.
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [list.length]);

    return (
        <div
            className={cx("flex h-full w-full flex-col", className)}
            style={{ background: "var(--sidebar-bg)", borderLeft: "1px solid var(--c-border)" }}
        >
            {/* Header: shell + version + live cwd */}
            <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--c-border)" }}>
                <LayoutAlt01 className="size-4 shrink-0 text-brand-secondary" />
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                        Command blocks
                        {info && !info.integrated && <Badge size="sm" color="warning">heuristic</Badge>}
                    </span>
                    {info && (
                        <span className="truncate text-[10px] text-quaternary" title={info.cwd}>
                            {info.shell}{info.version ? ` ${info.version}` : ""}{info.cwd ? ` · ${shortCwd(info.cwd)}` : ""}
                        </span>
                    )}
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close command blocks"
                    title="Close"
                    className="shrink-0 rounded-md p-1 text-quaternary transition hover:bg-[var(--surface-2)] hover:text-secondary"
                >
                    <XClose className="size-4" />
                </button>
            </div>

            {/* Block list */}
            {list.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
                    <Terminal className="size-6 text-quaternary" />
                    <p className="text-xs text-tertiary">No commands captured yet.</p>
                    <p className="text-[11px] text-quaternary">
                        {info?.integrated === false
                            ? "Shell integration isn't active for this shell — only typed commands are tracked."
                            : "Run a command in this terminal and it'll appear here as a block with its output and exit code."}
                    </p>
                </div>
            ) : (
                <div ref={scrollRef} className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2">
                    {list.map((b, i) => (
                        <BlockRow key={`${b.startedAt}-${i}`} block={b} showCwd={i === 0 || b.cwd !== list[i - 1].cwd} />
                    ))}
                </div>
            )}
        </div>
    );
};
