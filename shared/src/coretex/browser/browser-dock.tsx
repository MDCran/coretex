// @ts-nocheck
"use client";

// Coretex — right-side Browser dock. Multiple embedded browser sessions as tabs (each
// keeps its own history; all stay mounted so switching never reloads), plus pop-out to a
// floating window — mirroring the Terminal dock so the in-app browser "opens like a
// terminal window". Resizable from the left edge; fullscreen + close.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, X, Globe01, XClose, Maximize01, Minimize01, Edit01, LinkExternal01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { BadgeWithDot } from "@/components/base/badges/badges";
import { BrowserView } from "./browser-pane";
import type { BrowserControlResult, BrowserHostCommand } from "@repo/coretex/types";

export interface BrowserSession {
    id: string;
    url: string;
}

interface Props {
    sessions: BrowserSession[];
    onClose: () => void;
    onNewTab: (url?: string) => void;
    onCloseTab: (id: string) => void;
    /** Per-session URL the agent/host wants loaded (#16) — drives BrowserView via controlledUrl. */
    controlledUrls?: Record<string, string>;
    /** Sessions an agent currently owns → show an "AI controlled" badge on the tab. */
    aiControlledIds?: ReadonlySet<string>;
    controllerLabels?: Record<string, string>;
    /** Human takeover: halt the controlling agent operation and release the tab. */
    onTakeOver?: (id: string) => void;
    /** Local navigation in the view → report the new URL upward (keeps the Brain session model in sync). */
    onUrlChange?: (id: string, url: string) => void;
    /** Per-session DOM/click/eval instruction from the Brain for a scripting-capable host (Electron). */
    commands?: Record<string, BrowserHostCommand>;
    /** Report a host-run command's outcome back to the Brain (browser:resultReport). */
    onResult?: (result: BrowserControlResult) => void;
    /** A view declares it can script the page (Electron <webview>) → flips hostCanScript on the Brain. */
    onHostCaps?: (canScript: boolean) => void;
    /** Narrow-screen mode: float over the main content (fixed, capped width) instead of taking flex space. */
    overlay?: boolean;
}

const MIN_W = 420;
const MAX_W = 1280;

function hostLabel(url: string): string {
    try {
        const u = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`);
        return u.host || url;
    } catch {
        return url || "New tab";
    }
}

export const BrowserDock = ({ sessions, onClose, onNewTab, onCloseTab, controlledUrls, aiControlledIds, controllerLabels, onTakeOver, onUrlChange, commands, onResult, onHostCaps, overlay = false }: Props) => {
    const [activeId, setActiveId] = useState<string | null>(null);
    const [floatingIds, setFloatingIds] = useState<Set<string>>(new Set());
    // Per-session custom names (rename via the floating widget's context menu).
    const [names, setNames] = useState<Record<string, string>>({});
    // Click-to-focus z-order for floating widgets.
    const [zOrder, setZOrder] = useState<Record<string, number>>({});
    const zCounter = useRef(60);
    const bringToFront = (id: string) => { zCounter.current += 1; const z = zCounter.current; setZOrder((prev) => ({ ...prev, [id]: z })); };
    // Drag-back-to-tabs: armed while a floating widget is dragged near the tab strip.
    const [tabDropActive, setTabDropActive] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [width, setWidth] = useState<number>(() => {
        if (typeof window === "undefined") return 720;
        return Number(window.localStorage.getItem("coretex-browser-dock-w")) || 720;
    });
    const draggingRef = useRef<false | "normal" | "overlay">(false);
    const prevCount = useRef(sessions.length);

    // Keep a valid active session; focus the newest when a tab is added.
    useEffect(() => {
        if (sessions.length === 0) { setActiveId(null); }
        else if (sessions.length > prevCount.current || !activeId || !sessions.some((s) => s.id === activeId)) {
            setActiveId(sessions[sessions.length - 1].id);
        }
        prevCount.current = sessions.length;
    }, [sessions, activeId]);

    useEffect(() => {
        if (typeof window !== "undefined") window.localStorage.setItem("coretex-browser-dock-w", String(width));
    }, [width]);

    useEffect(() => {
        const onMove = (e: MouseEvent): void => {
            if (!draggingRef.current) return;
            // Desktop: cap so the sidebar + main content keep a usable minimum (no wonky squeeze).
            // Overlay (narrow screens): the dock floats over main, so let it span most of the
            // viewport — clamp to innerWidth minus a small gutter so it never runs off-screen.
            const cap = draggingRef.current === "overlay"
                ? Math.max(MIN_W, window.innerWidth - 48)
                : Math.min(MAX_W, window.innerWidth - 600);
            setWidth(Math.max(MIN_W, Math.min(cap, window.innerWidth - e.clientX)));
        };
        const onUp = (): void => { draggingRef.current = false; document.body.style.userSelect = ""; };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    }, []);

    const docked = sessions.filter((s) => !floatingIds.has(s.id));
    const labelOf = (s: BrowserSession) => names[s.id]?.trim() || hostLabel(s.url);

    return (
        <aside
            className={cx(
                "relative flex h-dvh flex-col",
                fullscreen && "fixed inset-0 z-50",
                // Overlay: float over the main content (fixed to the right edge) instead of taking flex space.
                !fullscreen && overlay && "fixed inset-y-0 right-0 z-50 max-w-[100vw] shadow-2xl motion-safe:animate-[slideInRight_150ms_ease-out]",
                !overlay && "shrink-0",
            )}
            style={{ width: fullscreen ? "100vw" : overlay ? `min(${width}px, calc(100vw - 48px))` : width, background: "var(--app-bg)", borderLeft: "1px solid var(--c-border)" }}
        >
            <div
                onMouseDown={(e) => { e.preventDefault(); draggingRef.current = overlay ? "overlay" : "normal"; document.body.style.userSelect = "none"; }}
                className="absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize"
                title="Drag to resize"
            />

            {/* Header / tab strip */}
            <div className="relative z-30 flex items-center gap-2 px-2 py-2" style={{ borderBottom: "1px solid var(--c-border)", background: "var(--sidebar-bg)" }}>
                <Globe01 className="ml-1 size-4 shrink-0" style={{ color: "var(--c-text-secondary)" }} />
                <div
                    className={cx("flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-md", tabDropActive && "outline outline-2 outline-dashed")}
                    style={tabDropActive ? { outlineColor: "var(--brand)", background: "color-mix(in srgb, var(--brand) 10%, transparent)" } : undefined}
                >
                    {tabDropActive && (
                        <span className="pointer-events-none flex shrink-0 items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs" style={{ borderColor: "var(--brand)", color: "var(--brand)" }}>
                            <Plus className="size-3" /> drop here
                        </span>
                    )}
                    {/* Floated sessions live only as widgets — exclude them from the dock tab strip. */}
                    {sessions.filter((s) => !floatingIds.has(s.id)).map((s) => {
                        const active = s.id === activeId;
                        return (
                            <div
                                key={s.id}
                                onClick={() => setActiveId(s.id)}
                                className={cx("group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-xs transition", active ? "" : "hover:bg-[var(--surface-2)]")}
                                style={{
                                    background: active ? "var(--surface)" : undefined,
                                    color: active ? "var(--c-text-primary)" : "var(--c-text-secondary)",
                                    border: active ? "1px solid var(--c-border)" : "1px solid transparent",
                                    boxShadow: active ? "inset 0 0 0 1px color-mix(in srgb, var(--brand) 26%, transparent)" : undefined,
                                }}
                            >
                                <Globe01 className="size-3 shrink-0 opacity-60" />
                                <span className="max-w-36 truncate">{labelOf(s)}</span>
                                {aiControlledIds?.has(s.id) && (
                                    <span className="shrink-0" title="An agent is controlling this tab">
                                        <BadgeWithDot type="color" size="sm" color="brand">AI</BadgeWithDot>
                                    </span>
                                )}
                                <span
                                    role="button"
                                    tabIndex={-1}
                                    title="Pop out as widget"
                                    onClick={(e) => { e.stopPropagation(); setFloatingIds((p) => { const n = new Set(p); n.add(s.id); return n; }); bringToFront(s.id); }}
                                    className="rounded p-0.5 opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
                                >
                                    <Maximize01 className="size-3" />
                                </span>
                                <span
                                    role="button"
                                    tabIndex={-1}
                                    onClick={(e) => { e.stopPropagation(); onCloseTab(s.id); }}
                                    className="rounded p-0.5 opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
                                >
                                    <XClose className="size-3" />
                                </span>
                            </div>
                        );
                    })}
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                    <button type="button" onClick={() => onNewTab()} title="New tab" className="rounded-md p-1.5 transition hover:bg-[var(--surface-2)]" style={{ color: "var(--c-text-secondary)" }}>
                        <Plus className="size-4" />
                    </button>
                    <button type="button" onClick={() => setFullscreen((v) => !v)} title={fullscreen ? "Exit fullscreen" : "Fullscreen"} className="rounded-md p-1.5 transition hover:bg-[var(--surface-2)]" style={{ color: fullscreen ? "var(--c-text-primary)" : "var(--c-text-secondary)" }}>
                        {fullscreen ? <Minimize01 className="size-4" /> : <Maximize01 className="size-4" />}
                    </button>
                    <button type="button" onClick={onClose} title="Close browser" className="rounded-md p-1.5 transition hover:bg-[var(--surface-2)]" style={{ color: "var(--c-text-secondary)" }}>
                        <X className="size-4" />
                    </button>
                </div>
            </div>

            {activeId && aiControlledIds?.has(activeId) && (
                <div role="alert" className="flex items-center gap-2 px-3 py-2" style={{ background: "color-mix(in srgb, var(--brand) 10%, var(--surface))", borderBottom: "1px solid var(--c-border)" }}>
                    <BadgeWithDot type="color" size="sm" color="brand">AI controlled</BadgeWithDot>
                    <span className="min-w-0 flex-1 truncate text-xs text-secondary">
                        {controllerLabels?.[activeId] ?? "An agent"} is controlling this tab.
                    </span>
                    <button type="button" onClick={() => onTakeOver?.(activeId)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white transition hover:brightness-110" style={{ background: "var(--brand)" }}>
                        Take over
                    </button>
                </div>
            )}

            {/* Viewport — docked sessions stay mounted (absolute stack); active is visible. */}
            <div className="relative min-h-0 flex-1" style={{ background: "var(--surface)" }}>
                {sessions.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                        <Globe01 className="size-7 text-quaternary" />
                        <p className="text-sm text-tertiary">No browser tabs open.</p>
                        <button type="button" onClick={() => onNewTab()} className="rounded-lg px-3 py-1.5 text-sm font-medium text-white" style={{ background: "var(--brand)" }}>
                            New tab
                        </button>
                    </div>
                ) : (
                    docked.map((s) => {
                        const visible = s.id === activeId;
                        return (
                            <div key={s.id} className="absolute inset-0" style={visible ? {} : { visibility: "hidden", zIndex: -1 }}>
                                <BrowserView
                                    initialUrl={s.url}
                                    controlledUrl={controlledUrls?.[s.id]}
                                    onUrlChange={(u) => onUrlChange?.(s.id, u)}
                                    command={commands?.[s.id]}
                                    onResult={onResult}
                                    onHostCaps={onHostCaps}
                                />
                            </div>
                        );
                    })
                )}
            </div>

            {/* Popped-out browser sessions as floating windows. */}
            {sessions.filter((s) => floatingIds.has(s.id)).map((s, i) => (
                <FloatingBrowser
                    key={s.id}
                    title={labelOf(s)}
                    url={s.url}
                    index={i}
                    z={zOrder[s.id] ?? 60}
                    onFocus={() => bringToFront(s.id)}
                    onNearTabs={setTabDropActive}
                    onDock={() => { setTabDropActive(false); setFloatingIds((p) => { const n = new Set(p); n.delete(s.id); return n; }); }}
                    onClose={() => { onCloseTab(s.id); setFloatingIds((p) => { const n = new Set(p); n.delete(s.id); return n; }); }}
                    onRename={(value) => setNames((prev) => ({ ...prev, [s.id]: value }))}
                >
                    <BrowserView
                        initialUrl={s.url}
                        controlledUrl={controlledUrls?.[s.id]}
                        onUrlChange={(u) => onUrlChange?.(s.id, u)}
                        command={commands?.[s.id]}
                        onResult={onResult}
                        onHostCaps={onHostCaps}
                    />
                </FloatingBrowser>
            ))}
        </aside>
    );
};

const FloatingBrowser = ({ title, url, index, z, onDock, onClose, onFocus, onRename, onNearTabs, children }: { title: string; url: string; index: number; z: number; onDock: () => void; onClose: () => void; onFocus: () => void; onRename: (value: string) => void; onNearTabs: (near: boolean) => void; children: ReactNode }) => {
    const [pos, setPos] = useState({ x: 160 + index * 36, y: 110 + index * 36 });
    const [size, setSize] = useState({ w: 680, h: 460 });
    const drag = useRef<{ dx: number; dy: number } | null>(null);
    // Left-edge resize: anchor the right edge while the left edge follows the cursor.
    const resizeBL = useRef<{ startX: number; startW: number; anchorRight: number } | null>(null);
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(title);
    const [windowComingSoon, setWindowComingSoon] = useState(false);
    const MINW = 360, MINH = 240;

    useEffect(() => {
        const move = (e: MouseEvent): void => {
            if (drag.current) {
                setPos({ x: Math.max(0, e.clientX - drag.current.dx), y: Math.max(0, e.clientY - drag.current.dy) });
                onNearTabs(e.clientY < 120);
            } else if (resizeBL.current) {
                const r = resizeBL.current;
                const w = Math.max(MINW, r.startW + (r.startX - e.clientX));
                setSize((s) => ({ ...s, w }));
                setPos((p) => ({ ...p, x: r.anchorRight - w }));
            }
        };
        const up = (e: MouseEvent): void => {
            if (drag.current && e.clientY < 120) onDock();
            drag.current = null;
            resizeBL.current = null;
            onNearTabs(false);
            document.body.style.userSelect = "";
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Pop out as a real browser window — best effort; for a browser session we can actually navigate it.
    const popOutAsWindow = (): boolean => {
        if (typeof window === "undefined") return false;
        try {
            const target = /^https?:\/\//i.test(url) ? url : `http://${url}`;
            const w = window.open(target, `coretex-browser-${index}`, `width=${Math.round(size.w)},height=${Math.round(size.h)}`);
            return !!w;
        } catch {
            return false;
        }
    };

    const commitRename = () => { onRename(renameValue.trim() || title); setRenaming(false); };

    return (
        <div
            className="fixed flex flex-col overflow-hidden rounded-xl shadow-2xl"
            style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, minWidth: MINW, minHeight: MINH, resize: "both", zIndex: z, background: "var(--app-bg)", border: "1px solid var(--c-border)" }}
            onMouseDownCapture={onFocus}
        >
            <div
                onMouseDown={(e) => { if (renaming) return; drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; document.body.style.userSelect = "none"; }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); }}
                className="flex shrink-0 cursor-move items-center gap-2 px-2.5 py-1.5"
                style={{ background: "var(--sidebar-bg)", borderBottom: "1px solid var(--c-border)" }}
            >
                <Globe01 className="size-3.5 shrink-0" style={{ color: "var(--c-text-secondary)" }} />
                {renaming ? (
                    <input
                        autoFocus
                        value={renameValue}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onMouseDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRename(); else if (e.key === "Escape") setRenaming(false); }}
                        onBlur={commitRename}
                        className="min-w-0 flex-1 rounded bg-transparent px-1 text-xs outline-none"
                        style={{ color: "var(--c-text-primary)", border: "1px solid var(--brand)" }}
                    />
                ) : (
                    <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: "var(--c-text-secondary)" }}>{title}</span>
                )}
                <button type="button" title="Dock back" onClick={onDock} className="rounded p-1 text-quaternary hover:bg-[var(--surface-2)]"><Minimize01 className="size-3.5" /></button>
                <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-quaternary hover:bg-[var(--surface-2)]"><X className="size-3.5" /></button>
            </div>
            <div className="min-h-0 flex-1">{children}</div>

            {/* Resize grippers — bottom-left (custom left-edge drag) + bottom-right (native resize:both). */}
            <span
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onFocus(); resizeBL.current = { startX: e.clientX, startW: size.w, anchorRight: pos.x + size.w }; document.body.style.userSelect = "none"; }}
                title="Resize"
                className="absolute bottom-0 left-0 z-10 size-4 cursor-nesw-resize"
                style={{ backgroundImage: "linear-gradient(45deg, transparent 55%, var(--c-text-muted) 55%, var(--c-text-muted) 62%, transparent 62%, transparent 72%, var(--c-text-muted) 72%, var(--c-text-muted) 79%, transparent 79%)" }}
            />
            <span
                title="Resize"
                className="pointer-events-none absolute bottom-0 right-0 z-10 size-4 cursor-nwse-resize"
                style={{ backgroundImage: "linear-gradient(-45deg, transparent 55%, var(--c-text-muted) 55%, var(--c-text-muted) 62%, transparent 62%, transparent 72%, var(--c-text-muted) 72%, var(--c-text-muted) 79%, transparent 79%)" }}
            />

            {/* Right-click titlebar context menu */}
            {menu && (
                <>
                    <div className="fixed inset-0 z-[1]" onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
                    <div className="fixed z-[2] w-52 rounded-lg p-1.5 shadow-xl" style={{ left: menu.x, top: menu.y, background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
                        <button type="button" disabled className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm" style={{ color: "var(--c-text-muted)" }}>
                            <Maximize01 className="size-3.5" /> Pop out as widget
                            <span className="ml-auto text-[10px] uppercase">current</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => { const ok = popOutAsWindow(); if (!ok) setWindowComingSoon(true); else setMenu(null); }}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-secondary transition hover:bg-[var(--surface-2)]"
                        >
                            <LinkExternal01 className="size-3.5" /> Pop out as window
                            {windowComingSoon && <span className="ml-auto text-[10px] uppercase" style={{ color: "var(--c-warning)" }}>Coming soon</span>}
                        </button>
                        <button
                            type="button"
                            onClick={() => { setRenameValue(title); setRenaming(true); setMenu(null); }}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-secondary transition hover:bg-[var(--surface-2)]"
                        >
                            <Edit01 className="size-3.5" /> Rename
                        </button>
                        <button
                            type="button"
                            onClick={() => { setMenu(null); onDock(); }}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-secondary transition hover:bg-[var(--surface-2)]"
                        >
                            <Minimize01 className="size-3.5" /> Dock back
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};
