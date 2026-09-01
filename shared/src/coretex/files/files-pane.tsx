// @ts-nocheck
"use client";

// Coretex — multi-pane Files. Like the terminal dock: a layout picker hosts the Files area
// as one rich pane (the full FilesView) or splits it into independent folder panes you can
// drag files between. Each split pane keeps its own cwd, listing via the fs:listDir cache
// (so panes never fight over the single global Files cwd). Cross-pane drag uses the shared
// drag payload; cross-window moves still go through the relay clipboard.

import { useEffect, useMemo, useState } from "react";
import {
    ArrowUp,
    Clipboard,
    Columns03,
    Copy01,
    Edit01,
    File02,
    FolderPlus,
    Grid01,
    HardDrive,
    Home01,
    LinkExternal01,
    Maximize01,
    Package,
    PackageMinus,
    RefreshCcw01,
    Rows01,
    Scissors02,
    Share07,
    Trash01,
} from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import type { CoretexActions, CoretexState } from "../use-coretex";
import type { NavTarget } from "../nav";
import { ThumbOrIcon, FilesView, RenameItemModal } from "./files-view";
import { writeDragPayload, readDragPayload, DRAG_MIME } from "./drag-payload";

const LAYOUT_KEY = "coretex-files-layout";
const PANES_KEY = "coretex-files-panes";

interface Layout { key: string; label: string; cols: number; rows: number; icon: typeof Grid01 }
const LAYOUTS: Layout[] = [
    { key: "1", label: "Single", cols: 1, rows: 1, icon: Maximize01 },
    { key: "2c", label: "Side by side", cols: 2, rows: 1, icon: Columns03 },
    { key: "2r", label: "Stacked", cols: 1, rows: 2, icon: Rows01 },
    { key: "4", label: "Grid", cols: 2, rows: 2, icon: Grid01 },
];

interface PaneState { id: string; cwd: string }

function sep(p: string): string { return p.includes("\\") ? "\\" : "/"; }
function join(dir: string, name: string): string { return dir + sep(dir) + name; }
function fileName(path: string): string { const parts = path.split(/[\\/]/).filter(Boolean); return parts[parts.length - 1] || path; }
function extOf(name: string): string { return name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""; }
const ARCHIVE = new Set(["zip", "tar", "gz", "tgz", "bz2", "xz"]);
function isArchive(name: string): boolean { return ARCHIVE.has(extOf(name)) || name.toLowerCase().endsWith(".tar.gz"); }
function archiveBase(name: string): string { const l = name.toLowerCase(); if (l.endsWith(".tar.gz")) return name.slice(0, -7); const i = name.lastIndexOf("."); return i > 0 ? name.slice(0, i) : name; }
function fmtSize(n: number): string { if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB"; if (n >= 1024) return (n / 1024).toFixed(0) + " KB"; return n + " B"; }
function genId(): string { try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch { /* */ } return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

export const FilesPaneGrid = ({ state, actions, onNavigate }: { state: CoretexState; actions: CoretexActions; onNavigate?: (t: NavTarget) => void }) => {
    const [layout, setLayout] = useState<string>("1");
    const [panes, setPanes] = useState<PaneState[]>([]);

    // Load persisted layout + pane cwds.
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const l = window.localStorage.getItem(LAYOUT_KEY);
            if (l) setLayout(l);
            const p = window.localStorage.getItem(PANES_KEY);
            if (p) setPanes(JSON.parse(p) as PaneState[]);
        } catch { /* ignore */ }
    }, []);
    useEffect(() => { if (typeof window !== "undefined") window.localStorage.setItem(LAYOUT_KEY, layout); }, [layout]);
    useEffect(() => { if (typeof window !== "undefined" && panes.length) window.localStorage.setItem(PANES_KEY, JSON.stringify(panes)); }, [panes]);

    const lay = LAYOUTS.find((l) => l.key === layout) ?? LAYOUTS[0];
    const cells = lay.cols * lay.rows;
    const home = state.fs.home;

    // Ensure there are enough panes for the chosen layout (seed new ones at home).
    useEffect(() => {
        setPanes((prev) => {
            if (prev.length >= cells) return prev;
            const next = prev.slice();
            while (next.length < cells) next.push({ id: genId(), cwd: home || (state.fs.roots[0] ?? "") });
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cells, home]);

    const setPaneCwd = (id: string, cwd: string): void => setPanes((prev) => prev.map((p) => (p.id === id ? { ...p, cwd } : p)));

    return (
        <div className="flex h-full flex-col">
            {/* Layout picker header */}
            <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 px-4 py-2" style={{ borderBottom: "1px solid var(--c-border)" }}>
                <span className="text-xs font-medium text-tertiary">Layout</span>
                <div className="flex items-center overflow-hidden rounded-md" style={{ border: "1px solid var(--c-border)" }}>
                    {LAYOUTS.map((l) => (
                        <button key={l.key} type="button" onClick={() => setLayout(l.key)} title={l.label} className={cx("flex size-8 items-center justify-center transition", layout === l.key ? "text-primary" : "text-tertiary hover:text-secondary")} style={{ background: layout === l.key ? "var(--surface-2)" : "transparent" }}>
                            <l.icon className="size-4" />
                        </button>
                    ))}
                </div>
                {layout !== "1" && <span className="min-w-[14rem] flex-1 text-xs text-quaternary">Drag files between panes to move them · hold Ctrl to copy</span>}
            </div>

            {/* Body */}
            <div className="min-h-0 min-w-0 flex-1">
                {layout === "1" ? (
                    <FilesView state={state} actions={actions} onNavigate={onNavigate} />
                ) : (
                    <div className="grid h-full" style={{ gridTemplateColumns: `repeat(${lay.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${lay.rows}, minmax(0, 1fr))` }}>
                        {panes.slice(0, cells).map((p) => (
                            <FilesPane key={p.id} state={state} actions={actions} cwd={p.cwd || home} onCwd={(c) => setPaneCwd(p.id, c)} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// ---- A single independent folder pane (list view + drag/drop + context menu) ----
const FilesPane = ({ state, actions, cwd, onCwd }: { state: CoretexState; actions: CoretexActions; cwd: string; onCwd: (cwd: string) => void }) => {
    const { fs } = state;
    const [selected, setSelected] = useState<string | null>(null);
    const [dropOver, setDropOver] = useState(false);
    const [menu, setMenu] = useState<{ x: number; y: number; entry: { path: string; name: string; isDir: boolean } } | null>(null);
    const [renameTarget, setRenameTarget] = useState<{ path: string; name: string; isDir: boolean } | null>(null);
    const deletion = useConfirm();

    // Resolve a starting cwd, then keep this pane's listing in the shared dir cache.
    useEffect(() => { if (!cwd && fs.home) onCwd(fs.home); /* eslint-disable-line */ }, [fs.home]);
    useEffect(() => { if (cwd && fs.dirs[cwd] === undefined) actions.fsListDir(cwd); /* eslint-disable-line */ }, [cwd, fs.dirs]);
    // Refresh after any fs mutation (a drag-move may have landed in/out of this pane).
    useEffect(() => { if (cwd && fs.lastOp?.ok) actions.fsListDir(cwd); /* eslint-disable-line */ }, [fs.lastOp?.at]);

    const listing = cwd ? fs.dirs[cwd] : undefined;
    const entries = useMemo(() => (listing?.entries ?? []).slice().sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name))), [listing]);
    const parent = listing?.parent ?? null;
    const crumbLabel = cwd ? fileName(cwd) || cwd : "—";

    const open = (e: { path: string; name: string; isDir: boolean }): void => {
        setSelected(e.path);
        if (e.isDir) onCwd(e.path);
        else actions.fsOpenExternal(e.path); // open files with the OS default app from a manager pane
    };

    const dragProps = (e: { path: string; name: string; isDir: boolean }) => ({
        draggable: true,
        onDragStart: (ev: React.DragEvent) => { ev.dataTransfer.effectAllowed = "copyMove"; writeDragPayload(ev.dataTransfer, e); },
    });
    // The pane background is a drop target = move/copy into THIS pane's folder.
    const onPaneDrop = (ev: React.DragEvent): void => {
        ev.preventDefault();
        setDropOver(false);
        const src = readDragPayload(ev.dataTransfer);
        if (!src || !cwd) return;
        const s = sep(cwd);
        if (cwd === src.path || (src.isDir && cwd.startsWith(src.path + s))) return;
        const dest = join(cwd, src.name);
        if (dest === src.path) return; // already here
        actions.fsMove(src.path, dest, ev.ctrlKey || ev.metaKey);
    };

    return (
        <div
            className="flex min-h-0 min-w-0 flex-col"
            style={{ borderRight: "1px solid var(--c-border)", borderBottom: "1px solid var(--c-border)", outline: dropOver ? "2px dashed var(--brand)" : undefined, outlineOffset: "-2px" }}
            onDragOver={(ev) => { if (ev.dataTransfer.types.includes(DRAG_MIME)) { ev.preventDefault(); ev.dataTransfer.dropEffect = ev.ctrlKey ? "copy" : "move"; setDropOver(true); } }}
            onDragLeave={() => setDropOver(false)}
            onDrop={onPaneDrop}
        >
            {/* Pane toolbar */}
            <div className="flex shrink-0 items-center gap-1 px-2 py-1.5" style={{ borderBottom: "1px solid var(--c-border)", background: "var(--surface)" }}>
                <button type="button" onClick={() => parent && onCwd(parent)} disabled={!parent} title="Up" className="flex size-7 shrink-0 items-center justify-center rounded text-tertiary transition hover:bg-secondary hover:text-primary disabled:opacity-40"><ArrowUp className="size-3.5" /></button>
                <button type="button" onClick={() => fs.home && onCwd(fs.home)} title="Home" className="flex size-7 shrink-0 items-center justify-center rounded text-tertiary transition hover:bg-secondary hover:text-primary"><Home01 className="size-3.5" /></button>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary" title={cwd}>{crumbLabel}</span>
                <button type="button" onClick={() => cwd && actions.fsListDir(cwd)} title="Refresh" className="flex size-7 shrink-0 items-center justify-center rounded text-tertiary transition hover:bg-secondary hover:text-primary"><RefreshCcw01 className="size-3.5" /></button>
            </div>

            {/* Drives quick-jump */}
            {fs.roots.length > 1 && (
                <div className="flex shrink-0 flex-wrap gap-1 px-2 py-1" style={{ borderBottom: "1px solid var(--c-border)" }}>
                    {fs.roots.map((r) => (
                        <button key={r} type="button" onClick={() => onCwd(r)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-secondary transition hover:bg-secondary" style={{ background: "var(--surface-2)" }}><HardDrive className="size-3" /> {r.replace(/[\\/]+$/, "")}</button>
                    ))}
                </div>
            )}

            {/* Entry list */}
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {listing?.error ? (
                    <p className="px-2 py-2 text-xs text-error-primary">{listing.error}</p>
                ) : !listing ? (
                    <p className="px-2 py-2 text-xs text-quaternary">Loading…</p>
                ) : entries.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-quaternary">Empty folder.</p>
                ) : (
                    entries.map((e) => (
                        <button
                            key={e.path}
                            type="button"
                            {...dragProps(e)}
                            onClick={() => setSelected(e.path)}
                            onDoubleClick={() => open(e)}
                            onContextMenu={(ev) => { ev.preventDefault(); setSelected(e.path); setMenu({ x: ev.clientX, y: ev.clientY, entry: { path: e.path, name: e.name, isDir: e.isDir } }); }}
                            title={e.name}
                            className={cx("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition", selected === e.path ? "" : "hover:bg-secondary")}
                            style={selected === e.path ? { background: "var(--surface-2)" } : { color: "var(--c-text-secondary)" }}
                        >
                            <ThumbOrIcon path={e.path} name={e.name} isDir={e.isDir} px={16} thumbs={fs.thumbs} request={actions.fsThumbnail} />
                            <span className="min-w-0 flex-1 truncate text-primary">{e.name}</span>
                            {!e.isDir && e.size > 0 && <span className="shrink-0 text-[10px] text-quaternary tabular-nums">{fmtSize(e.size)}</span>}
                        </button>
                    ))
                )}
            </div>

            {menu && (
                <PaneMenu
                    menu={menu}
                    cwd={cwd}
                    clipboardReady={!!fs.clipboard.source}
                    actions={actions}
                    onRename={setRenameTarget}
                    onDelete={(entry) => deletion.confirm({
                        title: `Delete “${entry.name}”?`,
                        description: "This permanently removes the item. This action cannot be undone.",
                        confirmLabel: "Delete",
                        onConfirm: () => actions.fsDelete(entry.path),
                    })}
                    onClose={() => setMenu(null)}
                />
            )}
            {renameTarget && (
                <RenameItemModal
                    target={renameTarget}
                    onRename={(name) => {
                        const parentPath = renameTarget.path.slice(0, renameTarget.path.lastIndexOf(sep(renameTarget.path))) || cwd;
                        if (name !== renameTarget.name) actions.fsMove(renameTarget.path, join(parentPath, name));
                        setRenameTarget(null);
                    }}
                    onClose={() => setRenameTarget(null)}
                />
            )}
            {deletion.dialog}
        </div>
    );
};

// ---- Compact right-click menu for a split pane ----
const PaneMenu = ({ menu, cwd, clipboardReady, actions, onRename, onDelete, onClose }: { menu: { x: number; y: number; entry: { path: string; name: string; isDir: boolean } }; cwd: string; clipboardReady: boolean; actions: CoretexActions; onRename: (entry: { path: string; name: string; isDir: boolean }) => void; onDelete: (entry: { path: string; name: string; isDir: boolean }) => void; onClose: () => void }) => {
    const { x, y, entry } = menu;
    const run = (fn: () => void): void => { fn(); onClose(); };
    const vw = typeof window !== "undefined" ? window.innerWidth : 9999;
    const vh = typeof window !== "undefined" ? window.innerHeight : 9999;
    const left = Math.min(x, vw - 230);
    const top = Math.min(y, vh - 380);
    const parent = entry.path.slice(0, entry.path.lastIndexOf(sep(entry.path))) || cwd;
    const archive = !entry.isDir && isArchive(entry.name);
    const Item = ({ icon: Icon, label, onClick, disabled, danger }: { icon: typeof Copy01; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) => (
        <button type="button" disabled={disabled} onClick={() => run(onClick)} className={cx("flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition", disabled ? "cursor-default opacity-40" : "hover:bg-secondary")} style={{ color: danger ? "var(--c-error)" : "var(--c-text-secondary)" }}>
            <Icon className="size-4 shrink-0" /><span className="flex-1 truncate">{label}</span>
        </button>
    );
    const Divider = () => <div className="my-1 h-px" style={{ background: "var(--c-border)" }} />;
    return (
        <>
            <div className="fixed inset-0 z-[60]" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
            <div className="fixed z-[61] min-w-[210px] rounded-lg py-1 shadow-xl" style={{ left, top, background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                <Item icon={entry.isDir ? FolderPlus : File02} label={entry.isDir ? "Open" : "Open"} onClick={() => (entry.isDir ? actions.fsListDir(entry.path) : actions.fsOpenExternal(entry.path))} />
                <Item icon={Share07} label="Open with…" onClick={() => actions.fsOpenWith(entry.path)} />
                <Divider />
                <Item icon={Copy01} label="Copy" onClick={() => actions.fsCopy(entry.path)} />
                <Item icon={Scissors02} label="Cut" onClick={() => actions.fsCut(entry.path)} />
                <Item icon={Clipboard} label={entry.isDir ? "Paste into folder" : "Paste here"} disabled={!clipboardReady} onClick={() => actions.fsPaste(entry.isDir ? entry.path : cwd)} />
                <Divider />
                {archive && <Item icon={PackageMinus} label="Extract here" onClick={() => actions.fsExtract(entry.path, parent)} />}
                <Item icon={Package} label="Compress to .zip" onClick={() => actions.fsCompress([entry.path], join(parent, archiveBase(entry.name) + ".zip"))} />
                <Divider />
                <Item icon={Edit01} label="Rename…" onClick={() => onRename(entry)} />
                <Item icon={Trash01} label="Delete" danger onClick={() => onDelete(entry)} />
                <Divider />
                <Item icon={LinkExternal01} label="Open with default app" onClick={() => actions.fsOpenExternal(entry.path)} />
            </div>
        </>
    );
};
