// @ts-nocheck
"use client";

// Coretex — the ⓘ "environment" eye affordance for a Terminal Buddy. Hovering or
// clicking the eye opens a popover that renders what the buddy knows about the
// shell it operates against (a probed TerminalEnvironment). When the env is
// undefined the popover honestly reports "Probing… / Not available" so a tab
// without a completed probe never lies about its surroundings.
//
// Pure presentational: it takes a TerminalEnvironment (optional) plus an onRefresh
// callback and renders. No probing, no network — the live shell probe lands with
// the shell-integration block-model.

import { useRef, useState } from "react";
import { Eye, RefreshCw01, Server01, Monitor01, Terminal, Package, Cube01, User01, ShieldTick, Send01 } from "@untitledui/icons";
import type { TerminalEnvironment, PackageManagerInfo } from "@repo/coretex/types";
import { cx } from "@/utils/cx";
import { BrandLogo, PROVIDER_DOMAIN } from "../ui/brand-logo";
import { AnchoredPopover } from "../ui/anchored-popover";

interface Props {
    /** The probed environment; undefined = not yet probed / unavailable. */
    env?: TerminalEnvironment;
    /** Fired when the user clicks "Refresh probe". */
    onRefresh?: () => void;
    /** When true, a probe is currently in flight (spinner + "Probing…"). */
    probing?: boolean;
    size?: number;
    className?: string;
}

const CONNECTION_LABEL: Record<string, string> = {
    local: "Local shell",
    ssh: "SSH",
    docker: "Docker",
    wsl: "WSL",
};

function relativeTime(ts?: number): string | null {
    if (!ts) return null;
    const diff = Date.now() - ts;
    if (diff < 0) return "just now";
    const s = Math.floor(diff / 1000);
    if (s < 5) return "just now";
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}

/** A labelled row in the env sheet (icon + label + value/children). */
const Row = ({ icon: Icon, label, children }: { icon: React.FC<{ className?: string }>; label: string; children: React.ReactNode }) => (
    <div className="flex items-start gap-2 py-1.5">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-quaternary" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-quaternary">{label}</span>
            <span className="min-w-0 text-xs text-secondary">{children}</span>
        </div>
    </div>
);

/** Render a package-manager / runtime list as inline chips (preferred = brand ring). */
const Chips = ({ items, emptyLabel }: { items?: PackageManagerInfo[]; emptyLabel: string }) => {
    if (!items || items.length === 0) return <span className="text-quaternary">{emptyLabel}</span>;
    return (
        <span className="flex flex-wrap gap-1">
            {items.map((p) => (
                <span
                    key={p.name}
                    title={[p.version ? `v${p.version}` : null, p.path].filter(Boolean).join(" · ") || undefined}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
                    style={
                        p.primary
                            ? { background: "color-mix(in srgb, var(--brand) 16%, transparent)", color: "var(--brand-secondary)", border: "1px solid color-mix(in srgb, var(--brand) 40%, transparent)" }
                            : { background: "var(--surface-2)", color: "var(--c-text-secondary)", border: "1px solid var(--c-border)" }
                    }
                >
                    {p.name}
                    {p.version && <span className="text-quaternary">{p.version}</span>}
                </span>
            ))}
        </span>
    );
};

export const TerminalEnvTooltip = ({ env, onRefresh, probing = false, size = 16, className }: Props) => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);

    const probed = relativeTime(env?.probeCompletedAt);

    return (
        <div className={cx("inline-flex", className)}>
            <button
                ref={triggerRef}
                type="button"
                aria-label="Show terminal environment"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((v) => !v);
                }}
                className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-1 text-quaternary transition-[background-color,color,box-shadow] duration-150 ease-out hover:bg-[var(--surface-2)] hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
                style={open ? { color: "var(--c-text-primary)" } : undefined}
            >
                <Eye style={{ width: size, height: size }} />
            </button>

            {open && (
                <AnchoredPopover
                    anchorRef={triggerRef}
                    onClose={() => setOpen(false)}
                    align="right"
                    aria-label="Terminal environment"
                    className="w-80 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl shadow-xl"
                    style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                >
                    {/* Header */}
                    <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: "1px solid var(--c-border)" }}>
                        <Eye className="size-4 shrink-0 text-tertiary" />
                        <span className="flex-1 text-sm font-semibold text-primary">Environment</span>
                        {probed && <span className="text-[11px] text-quaternary">probed {probed}</span>}
                    </div>

                    {!env ? (
                        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
                            {probing ? (
                                <>
                                    <RefreshCw01 className="size-5 animate-spin text-quaternary" />
                                    <p className="text-xs text-tertiary">Probing…</p>
                                </>
                            ) : (
                                <>
                                    <Server01 className="size-5 text-quaternary" />
                                    <p className="text-xs text-tertiary">Environment not available.</p>
                                    <p className="text-[11px] text-quaternary">Run a probe to inspect this shell.</p>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="max-h-[60vh] divide-y divide-[var(--c-border)] overflow-y-auto px-3">
                            {/* Connection */}
                            <Row icon={Server01} label="Connection">
                                {CONNECTION_LABEL[env.connectionKind] ?? env.connectionKind}
                                {env.connectionKind === "ssh" && env.sshHost && (
                                    <span className="text-quaternary"> · {env.sshUser ? `${env.sshUser}@` : ""}{env.sshHost}{env.sshPort ? `:${env.sshPort}` : ""}</span>
                                )}
                                {env.connectionKind === "docker" && env.dockerContainer && <span className="text-quaternary"> · {env.dockerContainer}</span>}
                                {env.isWSL && env.wslDistro && <span className="text-quaternary"> · WSL {env.wslDistro}</span>}
                            </Row>

                            {/* OS */}
                            <Row icon={Monitor01} label="Operating system">
                                {env.osName ?? env.os ?? "Unknown"}
                                {env.osVersion && <span className="text-quaternary"> {env.osVersion}</span>}
                                {(env.arch || env.kernelVersion) && (
                                    <span className="text-quaternary">
                                        {env.arch ? ` · ${env.arch}` : ""}
                                        {env.kernelVersion ? ` · kernel ${env.kernelVersion}` : ""}
                                    </span>
                                )}
                                {env.distro && (
                                    <span className="block text-quaternary">{env.distro}{env.distroVersion ? ` ${env.distroVersion}` : ""}{env.initSystem ? ` · ${env.initSystem}` : ""}</span>
                                )}
                            </Row>

                            {/* Shell */}
                            <Row icon={Terminal} label="Shell">
                                {env.shell ?? "Unknown"}
                                {env.shellVersion && <span className="text-quaternary"> {env.shellVersion}</span>}
                                {env.shellPath && <span className="block truncate text-[11px] text-quaternary">{env.shellPath}</span>}
                            </Row>

                            {/* Package managers (preferred highlighted) */}
                            <Row icon={Package} label="Package managers">
                                <Chips items={env.packageManagers} emptyLabel="None detected" />
                            </Row>

                            {/* Runtimes */}
                            <Row icon={Cube01} label="Runtimes">
                                <Chips items={env.runtimes} emptyLabel="None detected" />
                            </Row>

                            {/* User / sudo */}
                            <Row icon={User01} label="User">
                                {env.username ?? "unknown"}
                                {env.isRoot && <span className="text-quaternary"> · root</span>}
                                {env.homeDir && <span className="block truncate text-[11px] text-quaternary">{env.homeDir}</span>}
                                <span className="mt-0.5 inline-flex items-center gap-1 text-[11px]">
                                    <ShieldTick className="size-3 text-quaternary" />
                                    {env.isRoot
                                        ? "Root access"
                                        : env.hasSudo
                                          ? env.sudoPasswordless
                                              ? "sudo (passwordless)"
                                              : "sudo available"
                                          : "No sudo"}
                                </span>
                            </Row>

                            {/* Buddy assignment */}
                            <Row icon={Send01} label="Buddy">
                                {env.assignedModel ? (
                                    <span className="inline-flex items-center gap-1.5">
                                        {env.assignedProvider && (
                                            <BrandLogo domain={PROVIDER_DOMAIN[env.assignedProvider] ?? env.assignedProvider} name={env.assignedProvider} size={14} chip={false} />
                                        )}
                                        <span className="truncate">{env.assignedModel}</span>
                                    </span>
                                ) : (
                                    <span className="text-quaternary">No model assigned</span>
                                )}
                                {env.mode && (
                                    <span className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ background: "var(--surface-2)", color: "var(--c-text-secondary)", border: "1px solid var(--c-border)" }}>
                                        {env.mode}
                                    </span>
                                )}
                            </Row>
                        </div>
                    )}

                    {/* Footer — refresh probe */}
                    {onRefresh && (
                        <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: "1px solid var(--c-border)" }}>
                            <span className="text-[11px] text-quaternary">{probed ? `Last probed ${probed}` : "Never probed"}</span>
                            <button
                                type="button"
                                onClick={() => onRefresh()}
                                disabled={probing}
                                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-brand-secondary transition hover:bg-[var(--surface-2)] disabled:opacity-50"
                            >
                                <RefreshCw01 className={cx("size-3.5", probing && "animate-spin")} />
                                Refresh probe
                            </button>
                        </div>
                    )}
                </AnchoredPopover>
            )}
        </div>
    );
};
