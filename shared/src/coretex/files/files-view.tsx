// @ts-nocheck
"use client";

// Coretex — the Files pane: a full file explorer over the Brain's filesystem.
// Left rail of starting locations (quick access + drives + user-pinned), a rich
// entry list in the middle, and the Monaco editor opening as a panel on the right
// when a file is clicked. Untitled UI chrome; Monaco is the only borrowed surface.

import { useEffect, useMemo, useRef, useState } from "react";
import {
    AlertTriangle,
    ArrowUp,
    ChevronRight,
    Columns03,
    Database01,
    Download01,
    Edit03,
    File02,
    HardDrive,
    Home01,
    Image01,
    LayersTwo01,
    LayoutGrid01,
    Lock01,
    PlayCircle,
    SearchLg,
    Monitor01,
    Plus,
    FolderPlus,
    FilePlus02,
    RefreshCcw01,
    Rows01,
    Save01,
    Star01,
    Trash01,
    XClose,
    ZoomIn,
    ZoomOut,
    Copy01,
    Scissors02,
    Clipboard,
    Edit01,
    InfoCircle,
    Table,
    ChevronUp,
    ChevronDown,
    Settings01,
    Sliders02,
    LinkExternal01,
    Share07,
    Package,
    PackageMinus,
    Tag01,
    Folder,
    Eye,
    EyeOff,
    Loading01,
    Link01,
} from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Toggle } from "@/components/base/toggle/toggle";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { cx } from "@/utils/cx";
import type { DriveInfo, DriveMeta, FileProperties, FilePin, FsEntry, IndexedEntry } from "@repo/coretex/types";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { ColorPicker } from "../ui/color-picker";
import { IconPicker } from "../ui/icon-picker";
import { useContextMenu, type MenuItem } from "../ui/context-menu";
import { CoretexMonaco } from "./monaco-editor";
import { MetaEntryIcon, TagDots, CustomizeSlideout, TagManager } from "./meta-ui";
import { FilesOptionsPanel } from "./files-options-panel";
import type { NavTarget } from "../nav";
import { FolderPicker } from "./folder-picker";
import { writeDragPayload, readDragPayload, DRAG_MIME } from "./drag-payload";

interface Pin {
    name: string;
    path: string;
}

const PIN_KEY = "coretex-fs-pins";
const VIEW_KEY = "coretex-files-views";
const VIEW_GLOBAL_KEY = "coretex-files-view-global";
const SECTION_KEY = "coretex-fs-sections";

type FileView = "list" | "grid" | "media" | "columns" | "table";
interface ViewPref { view: FileView; size: number }
const DEFAULT_PREF: ViewPref = { view: "list", size: 104 };

type TableColKey = "size" | "modified" | "type";
type TableSortKey = "name" | "size" | "modified" | "type";
const TABLE_COLS_KEY = "coretex-files-table-cols";
const SYSTEM_FOLDER_NAMES = new Set([
    "node_modules", ".git", ".svn", ".hg", "__pycache__", "dist", "build", ".next", "out", "coverage", "vendor", ".cache", ".turbo",
]);

function parseHidePatterns(raw: string): string[] {
    return raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

function matchesHidePattern(name: string, pattern: string): boolean {
    if (pattern.includes("*") || pattern.includes("?")) {
        const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
        return re.test(name);
    }
    return name.toLowerCase() === pattern.toLowerCase();
}

function shouldHideEntry(name: string, isDir: boolean, fv: { hideSystemFolders: boolean; hidePatterns: string }): boolean {
    if (fv.hideSystemFolders && isDir && SYSTEM_FOLDER_NAMES.has(name.toLowerCase())) return true;
    for (const p of parseHidePatterns(fv.hidePatterns)) {
        if (matchesHidePattern(name, p)) return true;
    }
    return false;
}

function fileExt(name: string, isDir: boolean): string {
    if (isDir) return "Folder";
    const i = name.lastIndexOf(".");
    return i > 0 ? name.slice(i + 1).toUpperCase() : "File";
}

/** Collision-resistant id suffix (crypto.randomUUID where available, else time+long random). */
function genUid(): string {
    try {
        if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    } catch {
        /* fall through */
    }
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

// Git status emblem styling, keyed by the normalized status code.
const GIT_EMBLEM: Record<import("@repo/coretex/types").GitStatusCode, { c: string; t: string; label: string }> = {
    modified: { c: "#f59e0b", t: "M", label: "Modified" },
    added: { c: "#22c55e", t: "A", label: "Added" },
    untracked: { c: "#22c55e", t: "U", label: "Untracked" },
    deleted: { c: "#ef4444", t: "D", label: "Deleted" },
    renamed: { c: "#3b82f6", t: "R", label: "Renamed" },
    conflict: { c: "#ef4444", t: "!", label: "Conflict" },
    ignored: { c: "var(--c-text-muted)", t: "", label: "Ignored" },
};
const GitBadge = ({ code }: { code: import("@repo/coretex/types").GitStatusCode }) => {
    if (code === "ignored") return null; // ignored is conveyed by dimming the row
    const g = GIT_EMBLEM[code];
    return (
        <span title={`Git: ${g.label}`} className="flex size-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none text-white" style={{ background: g.c }}>
            {g.t}
        </span>
    );
};

const IMG_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv", "mpg", "mpeg", "3gp", "ogv"]);
// Windows executables/shortcuts whose real shell icon the Brain extracts (games, .lnk, .url, …).
const ASSOC_EXTS = new Set(["lnk", "exe", "msi", "scr", "com", "bat", "cmd", "appref-ms", "url"]);
// Archives the Brain can extract (zip + tar family); drives the type-aware context menu.
const ARCHIVE_EXTS = new Set(["zip", "tar", "gz", "tgz", "bz2", "xz"]);
function extOf(name: string): string {
    return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}
function isArchive(name: string): boolean {
    return ARCHIVE_EXTS.has(extOf(name)) || name.toLowerCase().endsWith(".tar.gz");
}
/** Strip the archive extension to suggest an "extract to" folder name. */
function archiveBaseName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith(".tar.gz")) return name.slice(0, -7);
    const i = name.lastIndexOf(".");
    return i > 0 ? name.slice(0, i) : name;
}
function isImage(name: string): boolean {
    return IMG_EXTS.has(extOf(name));
}
function isVideo(name: string): boolean {
    return VIDEO_EXTS.has(extOf(name));
}
/** Image, video, PDF, or a Windows exe/shortcut — files the Brain can render a visual icon/preview for. */
function hasVisualThumb(name: string): boolean {
    const e = extOf(name);
    return IMG_EXTS.has(e) || VIDEO_EXTS.has(e) || e === "pdf" || ASSOC_EXTS.has(e);
}

/** Shows a visual thumbnail (image / video frame / PDF page — requested lazily, cached) or the type-icon. */
export const ThumbOrIcon = ({ path, name, isDir, px, meta, thumbs, request }: { path: string; name: string; isDir: boolean; px: number; meta?: import("@repo/coretex/types").FilePathMeta; thumbs: Record<string, string | null>; request: (p: string) => void }) => {
    const wantsThumb = !isDir && hasVisualThumb(name) && !meta?.icon?.value;
    useEffect(() => {
        if (wantsThumb && thumbs[path] === undefined) request(path);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path, wantsThumb]);
    const url = wantsThumb ? thumbs[path] : undefined;
    if (url) {
        return (
            <span className="relative inline-flex" style={{ width: px, height: px }}>
                <img src={url} alt="" loading="lazy" style={{ width: px, height: px, objectFit: "cover", borderRadius: 6 }} />
                {isVideo(name) && (
                    <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex items-center justify-center rounded-full bg-black/55" style={{ width: px * 0.36, height: px * 0.36 }}>
                            <PlayCircle className="text-white" style={{ width: px * 0.3, height: px * 0.3 }} />
                        </span>
                    </span>
                )}
            </span>
        );
    }
    return <MetaEntryIcon name={name} isDir={isDir} px={px} meta={meta} />;
};

function sep(path: string): string {
    return path.includes("\\") ? "\\" : "/";
}
/** Case-fold a path for git-status matching on case-insensitive filesystems (Windows). */
function normPath(p: string): string {
    return p.includes("\\") ? p.toLowerCase() : p;
}
function fileName(path: string): string {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || path;
}
function join(dir: string, name: string): string {
    return dir + sep(dir) + name;
}
function formatSize(n: number): string {
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
    return n + " B";
}
/** Human bytes up to TB — for drive capacities. */
function formatBytes(n: number): string {
    const TB = 1024 ** 4, GB = 1024 ** 3, MB = 1024 ** 2;
    if (n >= TB) return (n / TB).toFixed(2) + " TB";
    if (n >= GB) return (n / GB).toFixed(1) + " GB";
    if (n >= MB) return (n / MB).toFixed(0) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
    return n + " B";
}
function formatDate(ms: number): string {
    if (!ms) return "—";
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const RailItem = ({ icon: Icon, iconNode, label, sub, usagePct, title, active, onClick, onRemove, onEdit, canDrop, onDropHere }: { icon: typeof Home01; iconNode?: React.ReactNode; label: string; sub?: React.ReactNode; usagePct?: number; title?: string; active?: boolean; onClick: () => void; onRemove?: () => void; onEdit?: () => void; canDrop?: boolean; onDropHere?: (copy: boolean) => void }) => {
    const [over, setOver] = useState(false);
    // Drive-usage bar tint: green with headroom, amber past 75%, red past 90%.
    const barColor = usagePct != null && usagePct >= 90 ? "#ef4444" : usagePct != null && usagePct >= 75 ? "#f59e0b" : "#17b26a";
    const hasMeta = usagePct != null || sub != null;
    return (
        <div
            title={title}
            className={cx("group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition", !active && !over && "hover:bg-[var(--surface-2)]")}
            style={{
                background: over ? "var(--brand)" : active ? "var(--sidebar-active-bg)" : undefined,
                color: over ? "#fff" : active ? "var(--sidebar-active-fg)" : "var(--c-text-secondary)",
                outline: over ? "1px dashed rgba(255,255,255,0.6)" : undefined,
                outlineOffset: over ? "-2px" : undefined,
            }}
            onDragOver={canDrop ? (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = ev.ctrlKey ? "copy" : "move"; setOver(true); } : undefined}
            onDragLeave={canDrop ? () => setOver(false) : undefined}
            onDrop={canDrop ? (ev) => { ev.preventDefault(); onDropHere?.(ev.ctrlKey || ev.metaKey); setOver(false); } : undefined}
        >
            <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                {iconNode ?? <Icon className="size-4 shrink-0" />}
                {hasMeta ? (
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate">{label}</span>
                        <span className="flex items-center gap-1.5">
                            {usagePct != null && (
                                <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: over ? "rgba(255,255,255,0.28)" : "var(--surface-2)" }}>
                                    <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(2, usagePct))}%`, background: over ? "#fff" : barColor }} />
                                </span>
                            )}
                            {sub != null && <span className="shrink-0 text-[10px] tabular-nums" style={{ color: over ? "rgba(255,255,255,0.85)" : "var(--c-text-muted)" }}>{sub}</span>}
                        </span>
                    </span>
                ) : (
                    <span className="truncate">{label}</span>
                )}
            </button>
            {onEdit && (
                <button type="button" onClick={onEdit} title="Customize" className="shrink-0 opacity-0 transition group-hover:opacity-60 hover:!opacity-100">
                    <Edit03 className="size-3.5" />
                </button>
            )}
            {onRemove && (
                <button type="button" onClick={onRemove} title="Remove" className="shrink-0 opacity-0 transition group-hover:opacity-60 hover:!opacity-100">
                    <XClose className="size-3.5" />
                </button>
            )}
        </div>
    );
};

const RailGroup = ({ label, action, children, collapsed, onToggle }: { label: string; action?: React.ReactNode; children: React.ReactNode; collapsed?: boolean; onToggle?: () => void }) => (
    <div className="mb-3">
        <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
            <button type="button" onClick={onToggle} className="group flex min-w-0 flex-1 items-center gap-1 text-left" disabled={!onToggle}>
                {onToggle && <ChevronRight className={cx("size-3 shrink-0 transition-transform", !collapsed && "rotate-90")} style={{ color: "var(--c-text-muted)" }} />}
                <span className="truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-muted)" }}>
                    {label}
                </span>
            </button>
            {action}
        </div>
        {!collapsed && children}
    </div>
);

export const FilesView = ({ state, actions, onNavigate }: { state: CoretexState; actions: CoretexActions; onNavigate?: (t: NavTarget) => void }) => {
    const { fs } = state;
    // File-manager defaults from Settings (filesView.*). These SEED the initial
    // view/sort/grid size and gate hidden-file + delete-confirm behavior; once the
    // user picks a view or sort in a folder, those local choices win (persisted).
    const fvSettings = state.settings?.filesView;
    const [edited, setEdited] = useState<string>("");
    const [active, setActive] = useState<{ path: string; content: string; truncated: boolean } | null>(null);
    /** Path the user explicitly closed; suppresses the auto-reopen effect until a new file is read. */
    const dismissedOpenRef = useRef<string | null>(null);
    /** Snapshot of the content sent on the last Save, applied when the write confirms (clears dirty). */
    const savedRef = useRef<{ path: string; content: string } | null>(null);
    /** Id of the pin being drag-reordered, or null. */
    const [pinDragId, setPinDragId] = useState<string | null>(null);
    /** The pin being edited (name/icon/color) in the modal, or null. */
    const [editPin, setEditPin] = useState<FilePin | null>(null);
    /** Collapsed state for each sidebar section, persisted to localStorage. */
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    /** When non-null, the address bar is in editable-path mode showing this value. */
    const [addressEdit, setAddressEdit] = useState<string | null>(null);
    /** Per-folder view preference (grid/list + tile size), persisted to localStorage. */
    const [viewPrefs, setViewPrefs] = useState<Record<string, ViewPref>>({});
    /** Global default view — remembered so the chosen style follows the user into every folder. */
    const [globalPref, setGlobalPref] = useState<ViewPref>(DEFAULT_PREF);
    /** True once a stored (localStorage) global pref has been loaded, so the Settings
        default doesn't clobber a view the user already chose. */
    const storedGlobalRef = useRef(false);
    /** The entry being customized (icon/color/tags), if any. */
    const [customize, setCustomize] = useState<{ path: string; name: string; isDir: boolean } | null>(null);
    /** The entry whose Properties dialog is open, if any. */
    const [properties, setProperties] = useState<{ path: string; name: string; isDir: boolean } | null>(null);
    const [tagManagerOpen, setTagManagerOpen] = useState(false);
    /** When set, the explorer browses everything carrying this tag id. */
    const [tagFilter, setTagFilter] = useState<string | null>(null);
    const [newMenu, setNewMenu] = useState(false);
    const [newItem, setNewItem] = useState<"folder" | "file" | null>(null);
    const [renameTarget, setRenameTarget] = useState<{ path: string; name: string; isDir: boolean } | null>(null);
    const [optionsOpen, setOptionsOpen] = useState(false);
    const deletion = useConfirm();

    const [collectionFilter, setCollectionFilter] = useState<string | null>(null);
    const [newCollection, setNewCollection] = useState(false);

    /** The entry currently being dragged (for move/copy/tag drops), or null. */
    const [drag, setDrag] = useState<{ path: string; name: string; isDir: boolean } | null>(null);
    /** Key of the drop target under the cursor — an entry path or `tag:<id>` — for highlighting. */
    const [dropKey, setDropKey] = useState<string | null>(null);
    /** Search box query + scope: "folder" = recursive from cwd inward, "index" = all indexed locations. */
    const [query, setQuery] = useState("");
    const [searchScope, setSearchScope] = useState<"folder" | "index">("folder");
    /** Indexed-locations manager modal. */
    const [indexMgr, setIndexMgr] = useState(false);
    /** Path of the keyboard-selected entry (Space previews it, arrows move it). */
    const [selected, setSelected] = useState<string | null>(null);
    /** Whether the Space-to-preview quick-look overlay is open (always shows `selected`). */
    const [previewOpen, setPreviewOpen] = useState(false);
    /** Columns (Miller) view: the chain of folder paths, column 0 = the base (cwd). */
    const [colChain, setColChain] = useState<string[]>([]);
    /** "This PC" storage overview (drive-by-drive usage) instead of a folder listing. */
    const [homeView, setHomeView] = useState(false);
    /** Root path of the drive being customized (nickname/icon/color), or null. */
    const [editDrive, setEditDrive] = useState<string | null>(null);
    // Table view: sort + which optional columns are visible (persisted).
    const [tableSort, setTableSort] = useState<{ key: TableSortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
    /** True once the user has clicked a column header to sort, so the Settings default sort
        doesn't override their in-session choice. */
    const userSortedRef = useRef(false);
    const [tableCols, setTableCols] = useState<Record<TableColKey, boolean>>({ size: true, modified: true, type: true });
    const [colMenuOpen, setColMenuOpen] = useState(false);
    /** True once the user toggles table columns in-session (localStorage wins over Settings). */
    const userColsRef = useRef(false);
    useEffect(() => {
        try {
            const raw = localStorage.getItem(TABLE_COLS_KEY);
            if (raw) {
                userColsRef.current = true;
                setTableCols((c) => ({ ...c, ...(JSON.parse(raw) as Partial<Record<TableColKey, boolean>>) }));
                return;
            }
        } catch {
            /* ignore */
        }
        if (fvSettings && !userColsRef.current) {
            setTableCols({
                size: fvSettings.showSizeColumn,
                modified: fvSettings.showModifiedColumn,
                type: fvSettings.showTypeColumn,
            });
        }
    }, []);
    useEffect(() => {
        if (userColsRef.current || !fvSettings) return;
        setTableCols({
            size: fvSettings.showSizeColumn,
            modified: fvSettings.showModifiedColumn,
            type: fvSettings.showTypeColumn,
        });
    }, [fvSettings?.showSizeColumn, fvSettings?.showModifiedColumn, fvSettings?.showTypeColumn]);
    useEffect(() => {
        if (!fvSettings) return;
        setSearchScope(fvSettings.defaultSearchScope);
    }, [fvSettings?.defaultSearchScope]);
    const toggleCol = (k: TableColKey): void =>
        setTableCols((c) => {
            userColsRef.current = true;
            const next = { ...c, [k]: !c[k] };
            const path = k === "size" ? "filesView.showSizeColumn" : k === "modified" ? "filesView.showModifiedColumn" : "filesView.showTypeColumn";
            actions.setSetting(path, next[k]);
            try {
                localStorage.setItem(TABLE_COLS_KEY, JSON.stringify(next));
            } catch {
                /* ignore */
            }
            return next;
        });
    const sortBy = (key: TableSortKey): void => {
        userSortedRef.current = true;
        setTableSort((s) => {
            const next: { key: TableSortKey; dir: "asc" | "desc" } = {
                key,
                dir: s.key === key && s.dir === "asc" ? "desc" : "asc",
            };
            actions.setSetting("filesView.sortBy", next.key);
            actions.setSetting("filesView.sortDir", next.dir);
            return next;
        });
    };
    // Seed the default table sort from Settings (filesView.sortBy/sortDir) until the user
    // clicks a column header to choose their own ordering this session.
    useEffect(() => {
        if (userSortedRef.current || !fvSettings) return;
        setTableSort({ key: fvSettings.sortBy, dir: fvSettings.sortDir });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fvSettings?.sortBy, fvSettings?.sortDir]);

    // Right-click context menu — uses the shared, themed ContextMenu primitive.
    const ctxMenu = useContextMenu();

    const fmeta = state.filesMeta;
    const tags = fmeta?.tags ?? [];
    const collections = fmeta?.collections ?? [];
    const pins = fmeta?.pins ?? [];
    const driveMeta = fmeta?.driveMeta ?? {};
    const pinFor = (p: string) => pins.find((x) => x.path === p);
    const genPinId = () => `pin_${genUid()}`;
    /** Move pin `draggedId` to sit where `targetId` is, then persist the new order. */
    const reorderPins = (draggedId: string, targetId: string) => {
        if (draggedId === targetId) return;
        const arr = pins.slice();
        const from = arr.findIndex((p) => p.id === draggedId);
        const to = arr.findIndex((p) => p.id === targetId);
        if (from < 0 || to < 0) return;
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        actions.filesMetaSetPins(arr);
    };
    const toggleSection = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));
    const metaFor = (p: string) => fmeta?.byPath[p];
    const tagCount = (id: string) => Object.values(fmeta?.byPath ?? {}).filter((m) => m.tagIds?.includes(id)).length;

    // ---- drag & drop: move/copy into a folder, or assign a tag ----
    /** Move (or copy, when `copy`) `src` into `destDir`. Guards self/descendant drops. */
    const moveInto = (destDir: string, copy: boolean, src: { path: string; name: string; isDir: boolean } | null = drag) => {
        if (!src) return;
        const s = sep(destDir);
        if (destDir === src.path) return; // onto itself
        if (src.isDir && destDir.startsWith(src.path + s)) return; // into its own descendant
        const dest = join(destDir, src.name);
        if (dest === src.path) return; // already lives there
        actions.fsMove(src.path, dest, copy);
    };
    /** Add `tagId` to the dragged entry's tags (no-op if already tagged). */
    const assignTag = (tagId: string, src: { path: string } | null = drag) => {
        if (!src) return;
        const existing = metaFor(src.path)?.tagIds ?? [];
        if (existing.includes(tagId)) return;
        actions.filesMetaSetPathTags([src.path], [...existing, tagId]);
    };
    const dragProps = (e: { path: string; name: string; isDir: boolean }) => ({
        draggable: true,
        onDragStart: (ev: React.DragEvent) => {
            ev.dataTransfer.effectAllowed = "copyMove";
            // Self-describing payload so a drop in another pane/instance can reconstruct the source.
            writeDragPayload(ev.dataTransfer, { path: e.path, name: e.name, isDir: e.isDir });
            setDrag({ path: e.path, name: e.name, isDir: e.isDir });
        },
        onDragEnd: () => { setDrag(null); setDropKey(null); },
    });
    /** Drop-target props for a folder entry (move/copy the dragged item into it). Accepts a local
        drag or a cross-pane payload carried on the DataTransfer. */
    const folderDropProps = (e: { path: string; isDir: boolean }) => {
        if (!e.isDir) return {};
        return {
            onDragOver: (ev: React.DragEvent) => {
                const localOk = drag && drag.path !== e.path;
                const payloadOk = ev.dataTransfer.types.includes(DRAG_MIME);
                if (!localOk && !payloadOk) return;
                ev.preventDefault();
                ev.dataTransfer.dropEffect = ev.ctrlKey ? "copy" : "move";
                setDropKey(e.path);
            },
            onDragLeave: () => setDropKey((d) => (d === e.path ? null : d)),
            onDrop: (ev: React.DragEvent) => {
                ev.preventDefault();
                const src = drag ?? readDragPayload(ev.dataTransfer);
                moveInto(e.path, ev.ctrlKey || ev.metaKey, src);
                setDropKey(null);
                setDrag(null);
            },
        };
    };

    // Browse mode: a single tag, or a smart collection's tag set (match ANY).
    const activeCollection = collectionFilter ? collections.find((c) => c.id === collectionFilter) : undefined;
    const browseTagIds: string[] | null = tagFilter ? [tagFilter] : activeCollection?.tagIds ?? null;
    const browseLabel = tagFilter ? tags.find((t) => t.id === tagFilter)?.name : activeCollection?.name;
    const browseColor = tagFilter ? tags.find((t) => t.id === tagFilter)?.color : activeCollection?.color;
    const browsing = browseTagIds !== null;

    /** What the explorer shows: a tag/collection's items (browse mode) or the current folder. */
    const shownEntries = browseTagIds
        ? Object.entries(fmeta?.byPath ?? {})
              .filter(([, m]) => m.tagIds?.some((id) => browseTagIds.includes(id)))
              // No real isDir bit in the sidecar meta — tagged paths are overwhelmingly files,
              // so default to file (fsRead) rather than misclassifying extensionless files as folders.
              .map(([p]) => ({ path: p, name: fileName(p), isDir: false, size: 0, modified: 0, readOnly: false }))
        : fs.entries;

    // Search is now backend (recursive folder / global index); the listing isn't flat-filtered.
    // Honor Settings → File manager → "Show hidden files": hide dotfiles in the folder
    // listing unless enabled. Browse mode (explicit tag/collection) is never filtered.
    const showHidden = fvSettings ? fvSettings.showHidden : true;
    const compact = fvSettings?.density === "compact";
    const openOnDouble = fvSettings?.openOn === "double-click";
    const showGit = fvSettings?.showGitStatus !== false;
    const quickLookEnabled = fvSettings?.enableQuickLook !== false;
    const sidebarW = fvSettings?.sidebarWidth ?? 208;
    const listingW = fvSettings?.listingWidthWhenEditorOpen ?? 340;
    /** Open a file into the editor, clearing any prior close-dismissal so re-opening the same file works. */
    const openFileForEdit = (path: string) => {
        dismissedOpenRef.current = null;
        actions.fsRead(path);
    };
    const activateEntry = (e: { path: string; isDir: boolean }) => {
        if (e.isDir) actions.fsList(e.path);
        else openFileForEdit(e.path);
    };
    const onEntryClick = (e: { path: string; isDir: boolean }) => {
        setSelected(e.path);
        if (!openOnDouble) activateEntry(e);
    };
    const onEntryDoubleClick = (e: { path: string; isDir: boolean }) => {
        setSelected(e.path);
        if (openOnDouble) activateEntry(e);
    };
    const patchFilesView = <K extends keyof NonNullable<typeof fvSettings>>(path: K, value: NonNullable<typeof fvSettings>[K]) => {
        actions.setSetting(`filesView.${path}`, value);
        if (path === "defaultView" && (value === "columns" || value === "table" || value === "grid")) {
            storedGlobalRef.current = true;
            setGlobalPref((g) => {
                const next: ViewPref = { ...DEFAULT_PREF, ...g, view: value as FileView };
                if (typeof window !== "undefined") window.localStorage.setItem(VIEW_GLOBAL_KEY, JSON.stringify(next));
                return next;
            });
        }
        if (path === "gridSize" && typeof value === "number") {
            storedGlobalRef.current = true;
            setGlobalPref((g) => {
                const next = { ...DEFAULT_PREF, ...g, size: value };
                if (typeof window !== "undefined") window.localStorage.setItem(VIEW_GLOBAL_KEY, JSON.stringify(next));
                return next;
            });
        }
        if (path === "sortBy" || path === "sortDir") {
            userSortedRef.current = false;
        }
        if (path === "showSizeColumn" || path === "showModifiedColumn" || path === "showTypeColumn") {
            userColsRef.current = false;
        }
    };
    const visibleEntries = useMemo(() => {
        let list = showHidden || browsing ? shownEntries : shownEntries.filter((ent) => !ent.name.startsWith("."));
        if (!browsing && fvSettings) list = list.filter((ent) => !shouldHideEntry(ent.name, ent.isDir, fvSettings));
        return list;
    }, [shownEntries, showHidden, browsing, fvSettings]);
    // Table view: dirs-first, then by the active sort key/direction.
    const tableEntries = useMemo(() => {
        const dir = tableSort.dir === "asc" ? 1 : -1;
        const cmp = (a: FsEntry, b: FsEntry): number => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            switch (tableSort.key) {
                case "size": return (a.size - b.size) * dir;
                case "modified": return (a.modified - b.modified) * dir;
                case "type": return fileExt(a.name, a.isDir).localeCompare(fileExt(b.name, b.isDir)) * dir || a.name.localeCompare(b.name);
                default: return a.name.localeCompare(b.name) * dir;
            }
        };
        return [...visibleEntries].sort(cmp);
    }, [visibleEntries, tableSort]);
    const searching = query.trim().length > 0;

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem(VIEW_KEY);
            if (raw) setViewPrefs(JSON.parse(raw) as Record<string, ViewPref>);
            const g = window.localStorage.getItem(VIEW_GLOBAL_KEY);
            if (g) {
                storedGlobalRef.current = true;
                setGlobalPref({ ...DEFAULT_PREF, ...(JSON.parse(g) as Partial<ViewPref>) });
            }
        } catch {
            /* ignore */
        }
    }, []);

    // Seed the global default view + grid tile size from Settings (filesView.*) when the
    // user hasn't already chosen one in this browser. A stored localStorage pref always wins.
    useEffect(() => {
        if (storedGlobalRef.current || !fvSettings) return;
        setGlobalPref((g) => ({ ...g, view: fvSettings.defaultView, size: fvSettings.gridSize }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fvSettings?.defaultView, fvSettings?.gridSize]);

    // The active view: a folder's own remembered pref, else the global default (so the
    // chosen style — table/grid/columns/media — follows the user into every folder + survives restart).
    const pref = viewPrefs[fs.cwd] ?? globalPref;
    const setPref = (patch: Partial<ViewPref>) => {
        setViewPrefs((prev) => {
            const base = prev[fs.cwd] ?? globalPref;
            const next = { ...prev, [fs.cwd]: { ...DEFAULT_PREF, ...base, ...patch } };
            if (typeof window !== "undefined") window.localStorage.setItem(VIEW_KEY, JSON.stringify(next));
            return next;
        });
        storedGlobalRef.current = true;
        setGlobalPref((g) => {
            const next = { ...DEFAULT_PREF, ...g, ...patch };
            if (typeof window !== "undefined") window.localStorage.setItem(VIEW_GLOBAL_KEY, JSON.stringify(next));
            return next;
        });
        if (patch.view === "columns" || patch.view === "table" || patch.view === "grid") {
            actions.setSetting("filesView.defaultView", patch.view);
        }
        if (patch.size != null) actions.setSetting("filesView.gridSize", patch.size);
    };

    // Load collapsed-section state.
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem(SECTION_KEY);
            if (raw) setCollapsed(JSON.parse(raw) as Record<string, boolean>);
        } catch {
            /* ignore */
        }
    }, []);
    useEffect(() => {
        if (typeof window !== "undefined") window.localStorage.setItem(SECTION_KEY, JSON.stringify(collapsed));
    }, [collapsed]);

    // One-time migration: lift legacy localStorage pins into the synced meta DB.
    useEffect(() => {
        if (typeof window === "undefined" || !fmeta) return;
        try {
            const raw = window.localStorage.getItem(PIN_KEY);
            if (!raw) return;
            const legacy = JSON.parse(raw) as Pin[];
            legacy.forEach((p, i) => { if (!pins.some((x) => x.path === p.path)) actions.filesMetaUpsertPin({ id: genPinId(), path: p.path, name: p.name, order: pins.length + i }); });
            window.localStorage.removeItem(PIN_KEY);
        } catch {
            /* ignore */
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fmeta !== null]);

    // First load -> home.
    useEffect(() => {
        if (fs.cwd === "" && fs.home !== "") actions.fsList(fs.home);
    }, [fs.cwd, fs.home, actions]);

    // Drive capacity for the "This PC" overview (load once + on entering the view).
    useEffect(() => {
        actions.fsDrives();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [homeView]);

    // Flag starred items whose path no longer exists.
    useEffect(() => {
        if (pins.length > 0) actions.fsCheckPaths(pins.map((p) => p.path));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pins.map((p) => p.path).join("|")]);

    // Debounced search — recursive from cwd ("folder") or across the global index ("index").
    useEffect(() => {
        const q = query.trim();
        if (!q) return;
        const t = setTimeout(() => actions.fsSearch(searchScope, fs.cwd, q), 300);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, searchScope, fs.cwd]);

    // After a successful fs mutation (rename/new/delete), refresh the current folder.
    // Columns view refetches via the dirs cache (cleared on opResult), so skip the redundant list there.
    useEffect(() => {
        if (pref.view === "columns") return;
        if (fs.lastOp?.ok && fs.cwd) actions.fsList(fs.cwd);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fs.lastOp?.at]);

    // When a newly-read file arrives, open it in the editor — unless the user just closed
    // that exact file (fs.open lingers in the store after close and would re-open it).
    useEffect(() => {
        if (fs.open && fs.open.path !== active?.path && fs.open.path !== dismissedOpenRef.current) {
            setActive(fs.open);
            setEdited(fs.open.content);
        }
    }, [fs.open, active?.path]);

    // After a successful save, advance the editor baseline so the "Unsaved" badge clears.
    useEffect(() => {
        const saved = savedRef.current;
        if (fs.lastWrite?.ok && active && saved && fs.lastWrite.path === active.path && saved.path === active.path) {
            setActive((a) => (a ? { ...a, content: saved.content } : a));
            savedRef.current = null;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fs.lastWrite]);

    const dirty = active !== null && edited !== active.content;
    const editorOpen = active !== null;

    const quick = useMemo(() => {
        if (!fs.home) return [] as { name: string; path: string; icon: typeof Home01 }[];
        return [
            { name: "Home", path: fs.home, icon: Home01 },
            { name: "Desktop", path: join(fs.home, "Desktop"), icon: Monitor01 },
            { name: "Documents", path: join(fs.home, "Documents"), icon: File02 },
            { name: "Downloads", path: join(fs.home, "Downloads"), icon: Download01 },
            { name: "Pictures", path: join(fs.home, "Pictures"), icon: Image01 },
        ];
    }, [fs.home]);

    const crumbs = useMemo(() => {
        if (!fs.cwd) return [] as { label: string; path: string }[];
        const s = sep(fs.cwd);
        const parts = fs.cwd.split(/[\\/]/).filter(Boolean);
        const out: { label: string; path: string }[] = [];
        const unix = fs.cwd.startsWith("/");
        let acc = "";
        parts.forEach((p, i) => {
            acc = i === 0 ? (unix ? "/" + p : p + s) : acc + (acc.endsWith(s) ? "" : s) + p;
            out.push({ label: p, path: acc });
        });
        return out;
    }, [fs.cwd]);

    const pinned = pins.some((p) => p.path === fs.cwd);

    // Git status emblems for the current folder; refresh after fs mutations + on leaving browse mode.
    useEffect(() => {
        if (fs.cwd && !browsing) actions.fsGitStatus(fs.cwd);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fs.cwd, fs.lastOp?.at, browsing]);

    const gitForCwd = fs.git[fs.cwd];
    /** fileGit: norm(path)→code (direct). dirGit: norm child-folder paths that contain a change. */
    const { fileGit, dirGit } = useMemo(() => {
        const fileGit: Record<string, import("@repo/coretex/types").GitStatusCode> = {};
        const dirGit = new Set<string>();
        if (gitForCwd?.repoRoot && fs.cwd) {
            const s = sep(fs.cwd);
            const base = normPath(fs.cwd.endsWith(s) ? fs.cwd : fs.cwd + s);
            for (const [p, code] of Object.entries(gitForCwd.statuses)) {
                const np = normPath(p);
                fileGit[np] = code;
                if (code === "ignored" || !np.startsWith(base)) continue;
                const rest = np.slice(base.length);
                if (rest.includes(s)) dirGit.add(base + rest.split(s)[0]); // change lives inside a subfolder
            }
        }
        return { fileGit, dirGit };
    }, [gitForCwd, fs.cwd]);
    /** Resolve the git emblem code for an entry (direct status, or "modified" for folders that contain changes). */
    const gitCode = (e: { path: string; isDir: boolean }): import("@repo/coretex/types").GitStatusCode | undefined => {
        if (!gitForCwd?.repoRoot) return undefined;
        const direct = fileGit[normPath(e.path)];
        if (direct) return direct;
        if (e.isDir && dirGit.has(normPath(e.path))) return "modified";
        return undefined;
    };

    // Editable address bar: Ctrl+L (or clicking the bar) edits the path; Enter
    // navigates, Esc cancels. Supports ~, %USERPROFILE%, and $HOME expansion.
    const normalizePath = (raw: string): string => {
        let p = raw.trim().replace(/^["']|["']$/g, "");
        if (!p) return p;
        if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) p = fs.home + p.slice(1);
        p = p.replace(/%USERPROFILE%/gi, fs.home).replace(/\$HOME\b/g, fs.home);
        return p;
    };
    const commitAddress = () => {
        if (addressEdit === null) return;
        const p = normalizePath(addressEdit);
        setAddressEdit(null);
        if (p) actions.fsList(p);
    };
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
                e.preventDefault();
                setAddressEdit(fs.cwd);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [fs.cwd]);

    // Reset the keyboard selection when the listing changes.
    useEffect(() => { setSelected(null); setPreviewOpen(false); }, [fs.cwd, tagFilter, collectionFilter]);

    // Space-to-preview + arrow-key selection (Finder/Spacedrive quick look).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (addressEdit !== null) return;
            // A modal/slideout owns the keyboard while open — don't leak quick-look/navigation into the background.
            if (customize || properties || tagManagerOpen || newItem || renameTarget || newCollection || editPin || indexMgr || optionsOpen) return;
            const list = visibleEntries;
            if (e.key === " " || e.code === "Space") {
                if (!quickLookEnabled) return;
                if (!selected && list.length === 0) return;
                e.preventDefault();
                if (!selected) { setSelected(list[0].path); setPreviewOpen(true); return; }
                setPreviewOpen((v) => !v);
            } else if (e.key === "Escape") {
                if (previewOpen) { e.preventDefault(); setPreviewOpen(false); }
            } else if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowLeft") {
                if (list.length === 0) return;
                e.preventDefault();
                const idx = list.findIndex((x) => x.path === selected);
                const fwd = e.key === "ArrowDown" || e.key === "ArrowRight";
                const nextIdx = idx < 0 ? 0 : Math.min(list.length - 1, Math.max(0, idx + (fwd ? 1 : -1)));
                setSelected(list[nextIdx].path);
            } else if (e.key === "Enter") {
                // While the quick-look is open, Enter closes it rather than acting on the list behind it.
                if (previewOpen) { e.preventDefault(); setPreviewOpen(false); return; }
                const ent = list.find((x) => x.path === selected);
                if (ent) { e.preventDefault(); ent.isDir ? actions.fsList(ent.path) : openFileForEdit(ent.path); }
            } else if (e.key === "F2") {
                const ent = list.find((x) => x.path === selected);
                if (ent) { e.preventDefault(); setRenameTarget(ent); }
            } else if (e.key === "Delete") {
                const ent = list.find((x) => x.path === selected);
                if (!ent) return;
                e.preventDefault();
                const remove = () => actions.fsDelete(ent.path);
                if (fvSettings?.confirmDelete === false) remove();
                else deletion.confirm({
                    title: `Delete ${ent.name}?`,
                    description: ent.isDir
                        ? "This permanently deletes the folder and everything inside it."
                        : "This permanently deletes the file.",
                    confirmLabel: ent.isDir ? "Delete folder" : "Delete file",
                    onConfirm: remove,
                });
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected, previewOpen, addressEdit, visibleEntries, customize, properties, tagManagerOpen, newItem, renameTarget, newCollection, editPin, indexMgr, optionsOpen, quickLookEnabled, fvSettings?.confirmDelete]);

    // Columns (Miller) view: keep the base column anchored to the current folder.
    useEffect(() => {
        if (pref.view === "columns") setColChain((c) => (c[0] === fs.cwd ? c : [fs.cwd]));
    }, [fs.cwd, pref.view]);

    // Fetch each visible column's listing into the dir cache.
    const columnPaths = (colChain.length ? colChain : fs.cwd ? [fs.cwd] : []).filter(Boolean);
    // In-flight dedup so a cleared cache doesn't trigger an O(n²) request storm as responses trickle in.
    const colReqRef = useRef<Set<string>>(new Set());
    useEffect(() => { colReqRef.current.clear(); }, [fs.lastOp?.at, fs.cwd]);
    useEffect(() => {
        if (pref.view !== "columns") return;
        const req = colReqRef.current;
        for (const p of columnPaths) {
            const dk = "d:" + p, gk = "g:" + p;
            if (fs.dirs[p] === undefined) { if (!req.has(dk)) { req.add(dk); actions.fsListDir(p); } } else req.delete(dk);
            if (fs.git[p] === undefined) { if (!req.has(gk)) { req.add(gk); actions.fsGitStatus(p); } } else req.delete(gk);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pref.view, colChain, fs.cwd, fs.dirs, fs.git]);

    // Prune a dead tail off colChain when a drilled-in folder is renamed/moved/deleted,
    // so the columns view rebuilds from the surviving parent instead of showing stuck error columns.
    useEffect(() => {
        if (pref.view !== "columns" || colChain.length <= 1) return;
        let validLen = colChain.length;
        for (let i = 1; i < colChain.length; i++) {
            const d = fs.dirs[colChain[i]];
            const parent = fs.dirs[colChain[i - 1]];
            const missingInParent = parent && !parent.error && !parent.entries.some((e) => e.path === colChain[i]);
            if ((d && d.error) || missingInParent) { validLen = i; break; }
        }
        if (validLen < colChain.length) setColChain((c) => c.slice(0, validLen));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fs.dirs, colChain, pref.view]);

    /** Click an entry inside column `ci`: drill into folders, open files. */
    const openInColumn = (ci: number, e: { path: string; name: string; isDir: boolean }) => {
        setSelected(e.path);
        if (e.isDir) setColChain((c) => [...c.slice(0, ci + 1), e.path]);
        else openFileForEdit(e.path);
    };

    // ---- right-click menus (built from existing CoretexActions) ----
    const clipboardReady = !!state.fs.clipboard.source;
    /** Best-effort copy to the OS clipboard (used for "Copy path"). */
    const copyToClipboard = (text: string): void => {
        try {
            navigator.clipboard?.writeText(text);
        } catch {
            /* ignore */
        }
    };

    /** Full per-entry menu: Windows-parity file ops mirroring the toolbar/keyboard, plus Coretex meta. */
    const buildEntryMenu = (entry: { path: string; name: string; isDir: boolean }): MenuItem[] => {
        const s = sep(entry.path);
        const parent = entry.path.slice(0, entry.path.lastIndexOf(s)) || fs.cwd;
        const pasteInto = entry.isDir ? entry.path : parent;
        const archive = !entry.isDir && isArchive(entry.name);
        const base = archiveBaseName(entry.name);
        const items: MenuItem[] = [
            ...(!entry.isDir && quickLookEnabled
                ? [{ key: "preview", label: "Preview", icon: Eye, shortcut: "Space", onClick: () => { setSelected(entry.path); setPreviewOpen(true); } } as MenuItem]
                : []),
            {
                key: "open",
                label: "Open",
                icon: entry.isDir ? FolderPlus : File02,
                onClick: () => (entry.isDir ? actions.fsList(entry.path) : openFileForEdit(entry.path)),
            },
            { key: "open-external", label: "Open external", icon: LinkExternal01, onClick: () => actions.fsOpenExternal(entry.path) },
            { key: "open-with", label: "Open with…", icon: Share07, onClick: () => actions.fsOpenWith(entry.path) },
            { separator: true },
            { key: "cut", label: "Cut", icon: Scissors02, shortcut: "Ctrl+X", onClick: () => actions.fsCut(entry.path) },
            { key: "copy", label: "Copy", icon: Copy01, shortcut: "Ctrl+C", onClick: () => actions.fsCopy(entry.path) },
            { key: "paste", label: entry.isDir ? "Paste into folder" : "Paste", icon: Clipboard, shortcut: "Ctrl+V", disabled: !clipboardReady, onClick: () => actions.fsPaste(pasteInto) },
            { key: "copy-path", label: "Copy path", icon: Link01, onClick: () => copyToClipboard(entry.path) },
            { separator: true },
        ];
        // Type-aware: archives can be extracted; everything can be compressed.
        if (archive) {
            items.push(
                { key: "extract-here", label: "Extract here", icon: PackageMinus, onClick: () => actions.fsExtract(entry.path, parent) },
                { key: "extract-to", label: `Extract to ${base}${s}`, icon: PackageMinus, onClick: () => actions.fsExtract(entry.path, join(parent, base)) },
            );
        }
        items.push({ key: "compress", label: "Compress to .zip", icon: Package, onClick: () => actions.fsCompress([entry.path], join(parent, base + ".zip")) });
        // Dirs get New file / New folder targeting themselves.
        if (entry.isDir) {
            items.push(
                { separator: true },
                { key: "new-folder", label: "New folder", icon: FolderPlus, onClick: () => actions.fsMkdir(join(entry.path, "New folder")) },
                { key: "new-file", label: "New file", icon: FilePlus02, onClick: () => actions.fsNewFile(join(entry.path, "untitled.txt")) },
            );
        }
        items.push(
            { separator: true },
            {
                key: "rename",
                label: "Rename…",
                icon: Edit01,
                onClick: () => setRenameTarget(entry),
            },
            { key: "customize", label: "Set icon & tags…", icon: Tag01, onClick: () => setCustomize(entry) },
            {
                key: "delete",
                label: "Delete",
                icon: Trash01,
                danger: true,
                shortcut: "Del",
                onClick: () => {
                    // Confirm before delete unless Settings → File manager turns it off.
                    const needConfirm = fvSettings ? fvSettings.confirmDelete : true;
                    const remove = () => actions.fsDelete(entry.path);
                    if (!needConfirm) remove();
                    else deletion.confirm({
                        title: `Delete ${entry.name}?`,
                        description: entry.isDir
                            ? "This permanently deletes the folder and everything inside it."
                            : "This permanently deletes the file.",
                        confirmLabel: entry.isDir ? "Delete folder" : "Delete file",
                        onConfirm: remove,
                    });
                },
            },
            { separator: true },
            { key: "properties", label: "Properties", icon: InfoCircle, onClick: () => setProperties(entry) },
        );
        return items;
    };

    /** Open the per-entry menu and select the row first (parity with the old behavior). */
    const openEntryMenu = (ev: React.MouseEvent, entry: { path: string; name: string; isDir: boolean }): void => {
        setSelected(entry.path);
        ctxMenu.open(ev, buildEntryMenu(entry));
    };

    /** Empty-area menu: paste / new file / new folder in the current folder. */
    const openBackgroundMenu = (ev: React.MouseEvent): void => {
        if (!fs.cwd || browsing) return;
        ctxMenu.open(ev, [
            { key: "bg-paste", label: "Paste", icon: Clipboard, shortcut: "Ctrl+V", disabled: !clipboardReady, onClick: () => actions.fsPaste(fs.cwd) },
            { separator: true },
            { key: "bg-new-folder", label: "New folder", icon: FolderPlus, onClick: () => setNewItem("folder") },
            { key: "bg-new-file", label: "New file", icon: FilePlus02, onClick: () => setNewItem("file") },
            { separator: true },
            { key: "bg-refresh", label: "Refresh", icon: RefreshCcw01, onClick: () => actions.fsList(fs.cwd) },
        ]);
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex min-h-0 flex-1">
                {/* Locations rail */}
                <div className="hidden shrink-0 flex-col lg:flex" style={{ width: sidebarW, borderRight: "1px solid var(--c-border)" }}>
                    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                    <div className="mb-2">
                        <RailItem icon={Monitor01} label="This PC" active={homeView} onClick={() => setHomeView(true)} />
                    </div>

                    <RailGroup label="Quick access" collapsed={collapsed.quick} onToggle={() => toggleSection("quick")}>
                        {quick.map((q) => (
                            <RailItem key={q.path} icon={q.icon} label={q.name} active={!homeView && fs.cwd === q.path} onClick={() => { setHomeView(false); actions.fsList(q.path); }} canDrop={!!drag && drag.path !== q.path} onDropHere={(copy) => { moveInto(q.path, copy); setDrag(null); setDropKey(null); }} />
                        ))}
                    </RailGroup>

                    <RailGroup label="Drives" collapsed={collapsed.drives} onToggle={() => toggleSection("drives")}>
                        {fs.roots.map((r) => {
                            const dm = driveMeta[r];
                            // Match this root to its scanned capacity (DriveInfo.path may/may not carry a trailing slash).
                            const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
                            const di = fs.drives.find((d) => norm(d.path) === norm(r));
                            const hasCap = !!di && di.total > 0;
                            const usagePct = hasCap ? Math.round(((di!.total - di!.free) / di!.total) * 100) : undefined;
                            const sub = hasCap ? `${formatBytes(di!.free)} free` : undefined;
                            const capTitle = hasCap ? `${formatBytes(di!.total - di!.free)} used of ${formatBytes(di!.total)} · ${formatBytes(di!.free)} free` : undefined;
                            const node = dm?.icon && dm.icon.kind !== "auto" && dm.icon.value
                                ? <MetaEntryIcon name={r} isDir={false} px={16} meta={{ icon: dm.icon, color: dm.color }} />
                                : <HardDrive className="size-4 shrink-0" style={dm?.color ? { color: dm.color } : undefined} />;
                            return (
                                <RailItem key={r} icon={HardDrive} iconNode={node} label={dm?.nickname || r.replace(/\\$/, "")} sub={sub} usagePct={usagePct} title={capTitle} active={!homeView && fs.cwd === r} onClick={() => { setHomeView(false); actions.fsList(r); }} onEdit={() => setEditDrive(r)} canDrop={!!drag && drag.path !== r} onDropHere={(copy) => { moveInto(r, copy); setDrag(null); setDropKey(null); }} />
                            );
                        })}
                    </RailGroup>

                    <RailGroup label="Starred" collapsed={collapsed.pins} onToggle={() => toggleSection("pins")}>
                        {pins.length === 0 ? (
                            <p className="px-2.5 py-1 text-xs" style={{ color: "var(--c-text-muted)" }}>
                                Star a folder to keep it here.
                            </p>
                        ) : (
                            pins.map((p) => {
                                const over = dropKey === `pin:${p.id}`;
                                const isActive = !homeView && fs.cwd === p.path;
                                const canFileDrop = !!drag && drag.path !== p.path;
                                const missing = fs.pathExists[p.path] === false;
                                return (
                                    <div
                                        key={p.id}
                                        draggable
                                        onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", p.id); setPinDragId(p.id); }}
                                        onDragEnd={() => { setPinDragId(null); setDropKey(null); }}
                                        onDragOver={(ev) => {
                                            if (pinDragId && pinDragId !== p.id) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; setDropKey(`pin:${p.id}`); }
                                            else if (canFileDrop) { ev.preventDefault(); ev.dataTransfer.dropEffect = ev.ctrlKey ? "copy" : "move"; setDropKey(`pin:${p.id}`); }
                                        }}
                                        onDragLeave={() => setDropKey((d) => (d === `pin:${p.id}` ? null : d))}
                                        onDrop={(ev) => {
                                            ev.preventDefault();
                                            if (pinDragId) reorderPins(pinDragId, p.id);
                                            else if (drag) moveInto(p.path, ev.ctrlKey || ev.metaKey);
                                            setDropKey(null); setPinDragId(null); setDrag(null);
                                        }}
                                        className={cx("group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition", !isActive && !over && "hover:bg-[var(--surface-2)]")}
                                        style={{
                                            background: over ? (pinDragId ? "var(--surface-2)" : "var(--brand)") : isActive ? "var(--sidebar-active-bg)" : undefined,
                                            color: over && !pinDragId ? "#fff" : isActive ? "var(--sidebar-active-fg)" : "var(--c-text-secondary)",
                                            outline: over ? (pinDragId ? "1px dashed var(--brand)" : "1px dashed rgba(255,255,255,0.6)") : undefined,
                                            outlineOffset: over ? "-2px" : undefined,
                                            cursor: "grab",
                                        }}
                                    >
                                        <button type="button" onClick={() => { if (missing) return; setHomeView(false); actions.fsList(p.path); }} className={cx("flex min-w-0 flex-1 items-center gap-2 text-left", missing && "opacity-60")}>
                                            <PinIcon pin={p} />
                                            <span className={cx("truncate", missing && "line-through")}>{p.name}</span>
                                        </button>
                                        {missing ? (
                                            <>
                                                <Tooltip title="Folder no longer exists" description="This starred location was moved or deleted — remove the dead reference." placement="top" delay={120}>
                                                    <TooltipTrigger className="shrink-0 text-warning-primary"><AlertTriangle className="size-3.5" /></TooltipTrigger>
                                                </Tooltip>
                                                {/* Dead reference: surface an always-visible Remove instead of the hover-only affordance. */}
                                                <button type="button" onClick={() => actions.filesMetaDeletePin(p.id)} title="Remove dead reference" className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-error-primary transition hover:bg-[var(--surface-2)]">Remove</button>
                                            </>
                                        ) : (
                                            <>
                                                <button type="button" onClick={() => setEditPin(p)} title="Edit pin" className="shrink-0 opacity-0 transition group-hover:opacity-60 hover:!opacity-100"><Edit03 className="size-3.5" /></button>
                                                <button type="button" onClick={() => actions.filesMetaDeletePin(p.id)} title="Remove" className="shrink-0 opacity-0 transition group-hover:opacity-60 hover:!opacity-100"><XClose className="size-3.5" /></button>
                                            </>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </RailGroup>

                    {/* Tags — click to browse everything carrying a tag */}
                    <div className="mb-3">
                        <div className="flex items-center justify-between px-2.5 pb-1 pt-1">
                            <button type="button" onClick={() => toggleSection("tags")} className="flex min-w-0 flex-1 items-center gap-1 text-left">
                                <ChevronRight className={cx("size-3 shrink-0 transition-transform", !collapsed.tags && "rotate-90")} style={{ color: "var(--c-text-muted)" }} />
                                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-muted)" }}>Tags</span>
                            </button>
                            <button type="button" onClick={() => setTagManagerOpen(true)} title="Manage tags" className="flex size-5 items-center justify-center rounded text-tertiary transition hover:bg-secondary hover:text-primary">
                                <Plus className="size-3.5" />
                            </button>
                        </div>
                        {collapsed.tags ? null : tags.length === 0 ? (
                            <p className="px-2.5 py-1 text-xs" style={{ color: "var(--c-text-muted)" }}>No tags yet — add one with +.</p>
                        ) : (
                            tags.map((t) => {
                                const on = tagFilter === t.id;
                                const over = dropKey === `tag:${t.id}`;
                                const canDropTag = !!drag && !(metaFor(drag.path)?.tagIds?.includes(t.id));
                                return (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => { setCollectionFilter(null); setTagFilter(on ? null : t.id); }}
                                        onDragOver={canDropTag ? (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; setDropKey(`tag:${t.id}`); } : undefined}
                                        onDragLeave={canDropTag ? () => setDropKey((d) => (d === `tag:${t.id}` ? null : d)) : undefined}
                                        onDrop={canDropTag ? (ev) => { ev.preventDefault(); assignTag(t.id); setDropKey(null); setDrag(null); } : undefined}
                                        className={cx("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition", on || over ? "" : "hover:bg-secondary")}
                                        style={over ? { background: t.color, color: "#fff", outline: "1px dashed rgba(255,255,255,0.6)", outlineOffset: "-2px" } : on ? { background: "var(--sidebar-active-bg)", color: "var(--sidebar-active-fg)" } : { color: "var(--c-text-secondary)" }}
                                    >
                                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: over ? "#fff" : t.color }} />
                                        <span className="min-w-0 flex-1 truncate">{t.name}</span>
                                        <span className="text-xs text-quaternary">{tagCount(t.id)}</span>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    {/* Smart collections — saved tag filters */}
                    <div className="mb-3">
                        <div className="flex items-center justify-between px-2.5 pb-1 pt-1">
                            <button type="button" onClick={() => toggleSection("collections")} className="flex min-w-0 flex-1 items-center gap-1 text-left">
                                <ChevronRight className={cx("size-3 shrink-0 transition-transform", !collapsed.collections && "rotate-90")} style={{ color: "var(--c-text-muted)" }} />
                                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-muted)" }}>Collections</span>
                            </button>
                            <button type="button" onClick={() => setNewCollection(true)} title="New collection" disabled={tags.length === 0} className="flex size-5 items-center justify-center rounded text-tertiary transition hover:bg-secondary hover:text-primary disabled:opacity-40">
                                <Plus className="size-3.5" />
                            </button>
                        </div>
                        {collapsed.collections ? null : collections.length === 0 ? (
                            <p className="px-2.5 py-1 text-xs" style={{ color: "var(--c-text-muted)" }}>Save a tag filter as a collection.</p>
                        ) : (
                            collections.map((c) => {
                                const on = collectionFilter === c.id;
                                return (
                                    <div key={c.id} className="group flex items-center">
                                        <button type="button" onClick={() => { setTagFilter(null); setCollectionFilter(on ? null : c.id); }} className={cx("flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition", on ? "" : "hover:bg-secondary")} style={on ? { background: "var(--sidebar-active-bg)", color: "var(--sidebar-active-fg)" } : { color: "var(--c-text-secondary)" }}>
                                            <LayersTwo01 className="size-3.5 shrink-0" style={{ color: c.color || "var(--brand)" }} />
                                            <span className="min-w-0 flex-1 truncate">{c.name}</span>
                                        </button>
                                        <button type="button" onClick={() => actions.filesMetaDeleteCollection(c.id)} title="Delete collection" className="rounded p-1 text-quaternary opacity-0 transition hover:text-error-primary group-hover:opacity-100"><Trash01 className="size-3" /></button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                    </div>
                    {/* Manage indexing — pinned bottom-left of the Files sidebar */}
                    <div className="shrink-0 px-2 py-2" style={{ borderTop: "1px solid var(--c-border)" }}>
                        <button type="button" onClick={() => setIndexMgr(true)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition hover:bg-[var(--surface-2)]" style={{ color: "var(--c-text-secondary)" }}>
                            <Database01 className="size-4 shrink-0 text-tertiary" />
                            <span className="min-w-0 flex-1 truncate">Manage indexing</span>
                            <span className="shrink-0 text-quaternary">{state.index ? `${state.index.count.toLocaleString()}` : "—"}</span>
                        </button>
                    </div>
                </div>

                {/* Explorer */}
                <div className={cx("flex min-h-0 flex-col", editorOpen ? "shrink-0" : "min-w-0 flex-1")} style={editorOpen ? { width: listingW, borderRight: "1px solid var(--c-border)" } : undefined}>
                    {homeView ? (
                        <DrivesOverview
                            drives={fs.drives}
                            driveMeta={driveMeta}
                            onOpen={(p) => { setHomeView(false); actions.fsList(p); }}
                            onRename={(p, nickname) => actions.filesMetaSetDriveMeta(p, { nickname })}
                            onEdit={(p) => setEditDrive(p)}
                            onRefresh={() => actions.fsDrives()}
                        />
                    ) : (
                    <>
                    {/* Toolbar — two zones: navigation (flexes) + actions (never shrinks/wraps) */}
                    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2" style={{ borderBottom: "1px solid var(--c-border)" }}>
                        <div className="flex min-w-[180px] flex-1 items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setHomeView(true)}
                                title="This PC"
                                className="flex size-8 shrink-0 items-center justify-center rounded-md text-tertiary transition hover:bg-secondary hover:text-primary lg:hidden"
                            >
                                <Monitor01 className="size-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => fs.parent && actions.fsList(fs.parent)}
                                disabled={!fs.parent}
                                title="Up"
                                className="flex size-8 shrink-0 items-center justify-center rounded-md text-tertiary transition hover:bg-secondary hover:text-primary disabled:opacity-40"
                            >
                                <ArrowUp className="size-4" />
                            </button>
                            {addressEdit !== null ? (
                                <input
                                    autoFocus
                                    value={addressEdit}
                                    onChange={(e) => setAddressEdit(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") commitAddress();
                                        else if (e.key === "Escape") setAddressEdit(null);
                                    }}
                                    onFocus={(e) => e.target.select()}
                                    onBlur={() => setAddressEdit(null)}
                                    placeholder="Type a path — ~, %USERPROFILE%, C:\\…"
                                    className="min-w-0 flex-1 rounded-md px-2 py-1.5 font-mono text-xs text-primary outline-none focus:ring-2 focus:ring-brand"
                                    style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                                />
                            ) : (
                                <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-md px-1 py-0.5 text-xs text-tertiary">
                                    {crumbs.map((c, i) => (
                                        <span key={c.path + i} className="flex items-center">
                                            {i > 0 && <ChevronRight className="size-3 shrink-0 opacity-40" />}
                                            <button type="button" onClick={() => actions.fsList(c.path)} className="max-w-[140px] shrink-0 truncate rounded px-1 py-0.5 hover:bg-secondary hover:text-primary">
                                                {c.label}
                                            </button>
                                        </span>
                                    ))}
                                    <Tooltip title="Edit path" description="Type a path directly (Ctrl+L)" placement="bottom" delay={150}>
                                        <TooltipTrigger onPress={() => setAddressEdit(fs.cwd)} className="ml-0.5 flex size-6 shrink-0 items-center justify-center rounded text-quaternary transition hover:bg-secondary hover:text-primary">
                                            <Edit03 className="size-3.5" />
                                        </TooltipTrigger>
                                    </Tooltip>
                                </div>
                            )}
                        </div>

                        {/* Actions — fixed, never shrink, wrap as a unit on tight widths */}
                        <div className="flex shrink-0 items-center gap-1">
                            <div className="flex items-center gap-1.5">
                                <Input
                                    size="sm"
                                    icon={SearchLg}
                                    value={query}
                                    onChange={(v) => setQuery(v)}
                                    placeholder={searchScope === "folder" ? "Search this folder ↓" : "Search all indexed"}
                                    aria-label="Search files"
                                    wrapperClassName="w-28 lg:w-44"
                                />
                                {/* Scope: recursive folder vs global index */}
                                <ButtonGroup
                                    size="sm"
                                    selectedKeys={[searchScope]}
                                    onSelectionChange={(keys) => {
                                        const next = [...keys][0] as "folder" | "index" | undefined;
                                        if (next) {
                                            setSearchScope(next);
                                            actions.setSetting("filesView.defaultSearchScope", next);
                                        }
                                    }}
                                >
                                    <ButtonGroupItem id="folder">Folder</ButtonGroupItem>
                                    <ButtonGroupItem id="index">All</ButtonGroupItem>
                                </ButtonGroup>
                                {query && <button type="button" onClick={() => setQuery("")} title="Clear search" className="shrink-0 text-quaternary hover:text-primary"><XClose className="size-4" /></button>}
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!fs.cwd) return;
                                    const existing = pinFor(fs.cwd);
                                    if (existing) actions.filesMetaDeletePin(existing.id);
                                    else actions.filesMetaUpsertPin({ id: genPinId(), path: fs.cwd, name: fileName(fs.cwd) || fs.cwd, order: pins.length });
                                }}
                                title={pinned ? "Unstar this folder" : "Star this folder"}
                                className={cx("flex size-8 items-center justify-center rounded-md transition hover:bg-secondary", pinned ? "text-brand-secondary" : "text-tertiary hover:text-primary")}
                            >
                                <Star01 className="size-4" />
                            </button>
                            <button type="button" onClick={() => fs.cwd && actions.fsList(fs.cwd)} title="Refresh" className="flex size-8 items-center justify-center rounded-md text-tertiary transition hover:bg-secondary hover:text-primary">
                                <RefreshCcw01 className="size-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => actions.setSetting("filesView.showHidden", !showHidden)}
                                title={showHidden ? "Hide hidden files" : "Show hidden files"}
                                className={cx("flex size-8 items-center justify-center rounded-md transition hover:bg-secondary", showHidden ? "text-brand-secondary" : "text-tertiary hover:text-primary")}
                            >
                                {showHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                            </button>
                            <button
                                type="button"
                                onClick={() => actions.setSetting("filesView.density", compact ? "comfortable" : "compact")}
                                title={compact ? "Switch to comfortable spacing" : "Switch to compact spacing"}
                                className={cx("flex size-8 items-center justify-center rounded-md transition hover:bg-secondary", compact ? "text-brand-secondary" : "text-tertiary hover:text-primary")}
                            >
                                <Rows01 className="size-4" />
                            </button>
                            <div className="relative">
                                <button type="button" onClick={() => setNewMenu((v) => !v)} title="New…" disabled={!fs.cwd || browsing} className="flex size-8 items-center justify-center rounded-md text-tertiary transition hover:bg-secondary hover:text-primary disabled:opacity-40">
                                    <Plus className="size-4" />
                                </button>
                                {newMenu && (
                                    <>
                                        <div className="fixed inset-0 z-20" onClick={() => setNewMenu(false)} />
                                        <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-lg p-1 shadow-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                            <button type="button" onClick={() => { setNewItem("folder"); setNewMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-secondary hover:bg-[var(--surface-2)]"><FolderPlus className="size-3.5" /> New folder</button>
                                            <button type="button" onClick={() => { setNewItem("file"); setNewMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-secondary hover:bg-[var(--surface-2)]"><FilePlus02 className="size-3.5" /> New file</button>
                                        </div>
                                    </>
                                )}
                            </div>
                            {(pref.view === "grid" || pref.view === "media") && (
                                <div className="flex items-center overflow-hidden rounded-md" style={{ border: "1px solid var(--c-border)" }}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const size = Math.max(72, pref.size - 16);
                                            setPref({ size });
                                        }}
                                        disabled={pref.size <= 72}
                                        title="Smaller tiles"
                                        className="flex size-8 items-center justify-center text-tertiary transition hover:bg-secondary hover:text-primary disabled:opacity-40"
                                    >
                                        <ZoomOut className="size-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const size = Math.min(220, pref.size + 16);
                                            setPref({ size });
                                        }}
                                        disabled={pref.size >= 220}
                                        title="Larger tiles"
                                        className="flex size-8 items-center justify-center text-tertiary transition hover:bg-secondary hover:text-primary disabled:opacity-40"
                                    >
                                        <ZoomIn className="size-4" />
                                    </button>
                                </div>
                            )}
                            {/* Table column picker */}
                            {pref.view === "table" && (
                                <div className="relative">
                                    <button type="button" onClick={() => setColMenuOpen((v) => !v)} title="Columns" className="flex size-8 items-center justify-center rounded-md text-tertiary transition hover:bg-secondary hover:text-primary"><Settings01 className="size-4" /></button>
                                    {colMenuOpen && (
                                        <>
                                            <div className="fixed inset-0 z-20" onClick={() => setColMenuOpen(false)} />
                                            <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-lg p-1.5 shadow-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                                <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-quaternary">Columns</p>
                                                {(["size", "modified", "type"] as const).map((k) => (
                                                    <Checkbox
                                                        key={k}
                                                        label={k === "size" ? "Size" : k === "modified" ? "Modified" : "Type"}
                                                        isSelected={tableCols[k]}
                                                        onChange={() => toggleCol(k)}
                                                        className="cursor-pointer rounded-md px-2 py-1.5 hover:bg-[var(--surface-2)]"
                                                    />
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                            <div className="flex items-center overflow-hidden rounded-md" style={{ border: "1px solid var(--c-border)" }}>
                                {([["list", Rows01, "List"], ["table", Table, "Table"], ["grid", LayoutGrid01, "Grid"], ["media", Image01, "Media"], ["columns", Columns03, "Columns"]] as const).map(([v, Icon, label]) => (
                                    <button key={v} type="button" onClick={() => setPref(v === "media" ? { view: "media", size: Math.max(pref.size, 128) } : { view: v })} title={`${label} view`} className={cx("flex size-8 items-center justify-center transition", pref.view === v ? "text-primary" : "text-tertiary hover:text-secondary")} style={{ background: pref.view === v ? "var(--surface-2)" : "transparent" }}>
                                        <Icon className="size-4" />
                                    </button>
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={() => setOptionsOpen(true)}
                                title="Explorer options"
                                className={cx("flex size-8 items-center justify-center rounded-md transition hover:bg-secondary", optionsOpen ? "text-brand-secondary" : "text-tertiary hover:text-primary")}
                            >
                                <Sliders02 className="size-4" />
                            </button>
                        </div>
                    </div>

                    {/* Search results (recursive folder / global index) take over the entries area */}
                    {searching ? (
                        <SearchResultsView
                            query={query.trim()}
                            scope={searchScope}
                            search={fs.search}
                            tags={tags}
                            metaFor={metaFor}
                            thumbs={fs.thumbs}
                            request={actions.fsThumbnail}
                            onClear={() => setQuery("")}
                            onOpenDir={(p) => { setQuery(""); actions.fsList(p); }}
                            onOpenFile={(p) => openFileForEdit(p)}
                            onManageIndex={() => setIndexMgr(true)}
                        />
                    ) : pref.view === "columns" && !browsing ? (
                        <div className="flex min-h-0 flex-1 overflow-x-auto">
                            {columnPaths.length === 0 ? (
                                <p className="p-3 text-xs text-quaternary">Nothing to show.</p>
                            ) : (
                                columnPaths.map((colPath, ci) => {
                                    const d = fs.dirs[colPath];
                                    const openChild = colChain[ci + 1];
                                    // Per-column git emblems (this column is its own dir).
                                    const g = fs.git[colPath];
                                    const colFileGit: Record<string, import("@repo/coretex/types").GitStatusCode> = {};
                                    const colDirChanges = new Set<string>();
                                    if (g?.repoRoot) {
                                        const s = sep(colPath);
                                        const base = normPath(colPath.endsWith(s) ? colPath : colPath + s);
                                        for (const [p, code] of Object.entries(g.statuses)) {
                                            const np = normPath(p);
                                            colFileGit[np] = code;
                                            if (code === "ignored" || !np.startsWith(base)) continue;
                                            const rest = np.slice(base.length);
                                            if (rest.includes(s)) colDirChanges.add(base + rest.split(s)[0]);
                                        }
                                    }
                                    const colGit = (e: { path: string; isDir: boolean }): import("@repo/coretex/types").GitStatusCode | undefined => {
                                        if (!g?.repoRoot) return undefined;
                                        const dt = colFileGit[normPath(e.path)];
                                        if (dt) return dt;
                                        if (e.isDir && colDirChanges.has(normPath(e.path))) return "modified";
                                        return undefined;
                                    };
                                    return (
                                        <div key={colPath} className="flex h-full w-56 shrink-0 flex-col overflow-y-auto p-1" style={{ borderRight: "1px solid var(--c-border)" }}>
                                            {!d ? (
                                                <p className="p-3 text-xs text-quaternary">Loading…</p>
                                            ) : d.error ? (
                                                <p className="p-3 text-xs text-error-primary">{d.error}</p>
                                            ) : d.entries.length === 0 ? (
                                                <p className="p-3 text-xs text-quaternary">Empty</p>
                                            ) : (
                                                d.entries.map((e) => {
                                                    const m = metaFor(e.path);
                                                    const isOpen = openChild === e.path;
                                                    const isSel = selected === e.path && !isOpen;
                                                    const isDrop = dropKey === e.path;
                                                    const gc = colGit(e);
                                                    return (
                                                        <button
                                                            key={e.path}
                                                            type="button"
                                                            {...dragProps(e)}
                                                            {...folderDropProps(e)}
                                                            onClick={() => openInColumn(ci, e)}
                                                            onContextMenu={(ev) => openEntryMenu(ev, { path: e.path, name: e.name, isDir: e.isDir })}
                                                            title={e.name}
                                                            className={cx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition", !isOpen && !isSel && !isDrop && "hover:bg-secondary", gc === "ignored" && "opacity-50")}
                                                            style={isDrop ? { background: "color-mix(in srgb, var(--brand) 22%, transparent)", outline: "1.5px dashed var(--brand)", outlineOffset: "-2px" } : isOpen ? { background: "var(--sidebar-active-bg)", color: "var(--sidebar-active-fg)" } : isSel ? { background: "var(--surface-2)" } : { color: "var(--c-text-secondary)", ...(m?.color ? { boxShadow: `inset 3px 0 0 ${m.color}` } : {}) }}
                                                        >
                                                            <ThumbOrIcon path={e.path} name={e.name} isDir={e.isDir} px={16} meta={m} thumbs={fs.thumbs} request={actions.fsThumbnail} />
                                                            <span className="min-w-0 flex-1 truncate text-primary">{e.name}</span>
                                                            {e.readOnly && <Lock01 className="size-3 shrink-0 text-quaternary" />}
                                                            {showGit && gc && <GitBadge code={gc} />}
                                                            <TagDots tagIds={m?.tagIds} tags={tags} />
                                                            {e.isDir && <ChevronRight className="size-3.5 shrink-0 opacity-40" />}
                                                        </button>
                                                    );
                                                })
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto p-1.5" onContextMenu={(ev) => { if (ev.target === ev.currentTarget) openBackgroundMenu(ev); }}>
                        {fs.error && !browsing && <p className="px-3 py-2 text-xs text-error-primary">{fs.error}</p>}

                        {browsing && (
                            <div className="mb-2 flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-2)" }}>
                                <span className="flex items-center gap-2 text-xs text-secondary">
                                    <span className="size-2 rounded-full" style={{ background: browseColor }} />
                                    Browsing {tagFilter ? "tag" : "collection"} <span className="font-medium text-primary">{browseLabel}</span> · {shownEntries.length}
                                </span>
                                <button type="button" onClick={() => { setTagFilter(null); setCollectionFilter(null); }} className="text-xs text-tertiary hover:text-secondary">Clear</button>
                            </div>
                        )}

                        {pref.view === "table" ? (
                            <table className="w-full border-collapse text-sm">
                                <thead>
                                    <tr className="text-left" style={{ borderBottom: "1px solid var(--c-border)" }}>
                                        {(["name", "type", "size", "modified"] as const)
                                            .filter((k) => k === "name" || tableCols[k as TableColKey])
                                            .map((k) => (
                                                <th key={k} className={cx("px-3 py-2 font-medium text-quaternary", k === "name" ? "" : "w-32")}>
                                                    <button type="button" onClick={() => sortBy(k)} className="flex items-center gap-1 hover:text-secondary">
                                                        {k === "name" ? "Name" : k[0].toUpperCase() + k.slice(1)}
                                                        {tableSort.key === k && (tableSort.dir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
                                                    </button>
                                                </th>
                                            ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableEntries.map((e) => {
                                        const isSel = selected === e.path;
                                        const isActive = active?.path === e.path;
                                        const m = metaFor(e.path);
                                        const gc = gitCode(e);
                                        return (
                                            <tr
                                                key={e.path}
                                                {...dragProps(e)}
                                                {...folderDropProps(e)}
                                                onClick={() => onEntryClick(e)}
                                                onDoubleClick={() => onEntryDoubleClick(e)}
                                                onContextMenu={(ev) => openEntryMenu(ev, { path: e.path, name: e.name, isDir: e.isDir })}
                                                className={cx("cursor-pointer transition", dropKey === e.path ? "" : "hover:bg-secondary", gc === "ignored" && "opacity-50")}
                                                style={{ borderBottom: "1px solid var(--c-border)", background: isActive || isSel ? "var(--surface-2)" : undefined }}
                                            >
                                                <td className={cx("px-3", compact ? "py-1" : "py-1.5")}>
                                                    <span className="flex items-center gap-2">
                                                        <ThumbOrIcon path={e.path} name={e.name} isDir={e.isDir} px={18} meta={m} thumbs={fs.thumbs} request={actions.fsThumbnail} />
                                                        <span className="min-w-0 flex-1 truncate text-primary">{e.name}</span>
                                                        {e.readOnly && <Lock01 className="size-3 shrink-0 text-quaternary" />}
                                                        {showGit && gc && <GitBadge code={gc} />}
                                                    </span>
                                                </td>
                                                {tableCols.type && <td className={cx("px-3 text-xs text-quaternary", compact ? "py-1" : "py-1.5")}>{fileExt(e.name, e.isDir)}</td>}
                                                {tableCols.size && <td className={cx("px-3 text-xs text-quaternary tabular-nums", compact ? "py-1" : "py-1.5")}>{e.isDir ? "—" : formatSize(e.size)}</td>}
                                                {tableCols.modified && <td className={cx("px-3 text-xs text-quaternary tabular-nums", compact ? "py-1" : "py-1.5")}>{formatDate(e.modified)}</td>}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : pref.view !== "list" ? (
                            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${pref.size}px, 1fr))` }}>
                                {visibleEntries.map((e) => {
                                    const isActive = active?.path === e.path;
                                    const isPinned = pins.some((p) => p.path === e.path);
                                    const isDrop = dropKey === e.path;
                                    const isSel = selected === e.path;
                                    const m = metaFor(e.path);
                                    const gc = gitCode(e);
                                    return (
                                        <button
                                            key={e.path}
                                            type="button"
                                            {...dragProps(e)}
                                            {...folderDropProps(e)}
                                            onClick={() => onEntryClick(e)}
                                            onDoubleClick={() => onEntryDoubleClick(e)}
                                            onContextMenu={(ev) => openEntryMenu(ev, { path: e.path, name: e.name, isDir: e.isDir })}
                                            title={e.name}
                                            className={cx("group relative flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center transition", !isActive && !isDrop && "hover:bg-secondary", gc === "ignored" && "opacity-50")}
                                            style={isDrop ? { background: "color-mix(in srgb, var(--brand) 22%, transparent)", outline: "1.5px dashed var(--brand)", outlineOffset: "-2px" } : isActive ? { background: "var(--sidebar-active-bg)" } : isSel ? { background: "var(--surface-2)", outline: "1.5px solid var(--brand)", outlineOffset: "-2px" } : undefined}
                                        >
                                            {isPinned && <Star01 className="absolute left-1.5 top-1.5 size-3 text-brand-secondary" />}
                                            <span className="absolute right-1.5 top-1.5 flex items-center gap-1">
                                                {e.readOnly && <Lock01 className="size-3 text-quaternary" />}
                                                {showGit && gc && <GitBadge code={gc} />}
                                            </span>
                                            <ThumbOrIcon path={e.path} name={e.name} isDir={e.isDir} px={Math.round(pref.size * 0.42)} meta={m} thumbs={fs.thumbs} request={actions.fsThumbnail} />
                                            <span className="line-clamp-2 w-full break-words text-xs text-primary">{e.name}</span>
                                            <TagDots tagIds={m?.tagIds} tags={tags} />
                                            {!e.isDir && e.size > 0 && <span className="text-[10px] text-quaternary tabular-nums">{formatSize(e.size)}</span>}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            visibleEntries.map((e) => {
                                const isActive = active?.path === e.path;
                                const isPinned = pins.some((p) => p.path === e.path);
                                const isDrop = dropKey === e.path;
                                const isSel = selected === e.path;
                                const m = metaFor(e.path);
                                const gc = gitCode(e);
                                return (
                                    <button
                                        key={e.path}
                                        type="button"
                                        {...dragProps(e)}
                                        {...folderDropProps(e)}
                                        onClick={() => onEntryClick(e)}
                                        onDoubleClick={() => onEntryDoubleClick(e)}
                                        onContextMenu={(ev) => openEntryMenu(ev, { path: e.path, name: e.name, isDir: e.isDir })}
                                        className={cx("flex w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition", compact ? "py-1" : "py-2", !isActive && !isDrop && "hover:bg-secondary", gc === "ignored" && "opacity-50")}
                                        style={isDrop ? { background: "color-mix(in srgb, var(--brand) 22%, transparent)", outline: "1.5px dashed var(--brand)", outlineOffset: "-2px" } : isActive ? { background: "var(--sidebar-active-bg)", color: "var(--sidebar-active-fg)" } : isSel ? { background: "var(--surface-2)", outline: "1.5px solid var(--brand)", outlineOffset: "-2px", ...(m?.color ? { boxShadow: `inset 3px 0 0 ${m.color}` } : {}) } : { color: "var(--c-text-secondary)", ...(m?.color ? { boxShadow: `inset 3px 0 0 ${m.color}` } : {}) }}
                                    >
                                        <span className="relative shrink-0">
                                            <ThumbOrIcon path={e.path} name={e.name} isDir={e.isDir} px={18} meta={m} thumbs={fs.thumbs} request={actions.fsThumbnail} />
                                            {isPinned && <Star01 className="absolute -right-1 -top-1 size-2.5 text-brand-secondary" />}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-primary">{e.name}</span>
                                        {e.readOnly && <Lock01 className="size-3 shrink-0 text-quaternary" />}
                                        {showGit && gc && <GitBadge code={gc} />}
                                        <TagDots tagIds={m?.tagIds} tags={tags} />
                                        {!e.isDir && e.size > 0 && <span className="shrink-0 text-xs text-quaternary tabular-nums">{formatSize(e.size)}</span>}
                                        {!editorOpen && !browsing && <span className="hidden w-28 shrink-0 text-right text-xs text-quaternary tabular-nums lg:block">{formatDate(e.modified)}</span>}
                                    </button>
                                );
                            })
                        )}
                        {visibleEntries.length === 0 && !fs.error && <p className="px-3 py-3 text-xs text-quaternary">{query.trim() ? `No matches for "${query.trim()}".` : browsing ? "Nothing here yet." : "Empty folder."}</p>}
                    </div>
                    )}
                    </>
                    )}
                </div>

                {/* Editor */}
                {editorOpen && active && (
                    <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex shrink-0 items-center gap-3 px-4 py-2.5" style={{ borderBottom: "1px solid var(--c-border)" }}>
                            <File02 className="size-4 text-quaternary" />
                            <span className="truncate text-sm font-medium text-primary">{fileName(active.path)}</span>
                            {dirty && <Badge color="warning" size="sm">Unsaved</Badge>}
                            {active.truncated && <Badge color="gray" size="sm">Truncated</Badge>}
                            <span className="ml-auto" />
                            {fs.lastWrite && fs.lastWrite.path === active.path && (
                                <span className={cx("text-xs", fs.lastWrite.ok ? "text-success-primary" : "text-error-primary")}>{fs.lastWrite.ok ? "Saved" : fs.lastWrite.error}</span>
                            )}
                            <Button size="sm" color="primary" iconLeading={Save01} isDisabled={!dirty} onClick={() => { savedRef.current = { path: active.path, content: edited }; actions.fsWrite(active.path, edited); }}>
                                Save
                            </Button>
                            <button type="button" onClick={() => { dismissedOpenRef.current = active?.path ?? null; setActive(null); }} title="Close editor" className="flex size-7 items-center justify-center rounded-md text-tertiary transition hover:bg-secondary hover:text-primary">
                                <XClose className="size-4" />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1">
                            <CoretexMonaco
                                path={active.path}
                                value={edited}
                                onChange={setEdited}
                                wordWrap={fvSettings?.editorWordWrap}
                                fontSize={fvSettings?.editorFontSize}
                                minimap={fvSettings?.editorMinimap}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Customize (icon / color / tags) + Tag manager + New item */}
            <CustomizeSlideout target={customize} meta={customize ? metaFor(customize.path) : undefined} tags={tags} actions={actions} onClose={() => setCustomize(null)} />
            {fvSettings && (
                <FilesOptionsPanel
                    open={optionsOpen}
                    onClose={() => setOptionsOpen(false)}
                    fv={fvSettings}
                    set={patchFilesView}
                    onNavigate={onNavigate}
                />
            )}
            {ctxMenu.node}
            {tagManagerOpen && <TagManager tags={tags} actions={actions} onClose={() => setTagManagerOpen(false)} />}
            {newItem && (
                <NewItemModal
                    kind={newItem}
                    onCreate={(rawName) => {
                        const target = join(fs.cwd, rawName);
                        if (newItem === "folder") actions.fsMkdir(target);
                        else actions.fsNewFile(target);
                        setNewItem(null);
                    }}
                    onClose={() => setNewItem(null)}
                />
            )}

            {renameTarget && (
                <RenameItemModal
                    target={renameTarget}
                    onRename={(name) => {
                        const s = sep(renameTarget.path);
                        const parent = renameTarget.path.slice(0, renameTarget.path.lastIndexOf(s)) || fs.cwd;
                        if (name !== renameTarget.name) actions.fsMove(renameTarget.path, join(parent, name));
                        setRenameTarget(null);
                    }}
                    onClose={() => setRenameTarget(null)}
                />
            )}

            {newCollection && (
                <CollectionModal
                    tags={tags}
                    onCreate={(name, tagIds, color) => { actions.filesMetaUpsertCollection({ id: `col_${genUid()}`, name, tagIds, color }); setNewCollection(false); }}
                    onClose={() => setNewCollection(false)}
                />
            )}

            {editPin && (
                <PinEditModal
                    pin={editPin}
                    onSave={(patch) => { const live = pins.find((x) => x.id === editPin.id) ?? editPin; actions.filesMetaUpsertPin({ ...live, ...patch }); setEditPin(null); }}
                    onClose={() => setEditPin(null)}
                />
            )}

            {editDrive && (
                <DriveEditModal
                    path={editDrive}
                    meta={driveMeta[editDrive]}
                    onSave={(patch) => { actions.filesMetaSetDriveMeta(editDrive, patch); setEditDrive(null); }}
                    onClose={() => setEditDrive(null)}
                />
            )}

            {/* Last-op error toast */}
            {fs.lastOp && !fs.lastOp.ok && fs.lastOp.error && (
                <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-xl" style={{ background: "#ef4444" }}>
                    {fs.lastOp.op}: {fs.lastOp.error}
                </div>
            )}

            {indexMgr && <IndexManager state={state} actions={actions} onClose={() => setIndexMgr(false)} />}

            {/* File Properties dialog */}
            {properties && <PropertiesModal target={properties} fs={fs} actions={actions} onClose={() => setProperties(null)} />}
            {deletion.dialog}

            {/* Space-to-preview quick look */}
            {previewOpen && (() => {
                const ent = shownEntries.find((x) => x.path === selected);
                if (!ent) return null;
                return <PreviewOverlay entry={ent} fs={fs} actions={actions} tags={tags} meta={metaFor(ent.path)} onClose={() => setPreviewOpen(false)} />;
            })()}
        </div>
    );
};

// ---- Search results (recursive folder / global index) ----
const SearchResultsView = ({ query, scope, search, tags, metaFor, thumbs, request, onClear, onOpenDir, onOpenFile, onManageIndex }: {
    query: string;
    scope: "folder" | "index";
    search: { scope: "folder" | "index"; query: string; hits: IndexedEntry[] } | null;
    tags: { id: string; name: string; color: string }[];
    metaFor: (p: string) => import("@repo/coretex/types").FilePathMeta | undefined;
    thumbs: Record<string, string | null>;
    request: (p: string) => void;
    onClear: () => void;
    onOpenDir: (p: string) => void;
    onOpenFile: (p: string) => void;
    onManageIndex: () => void;
}) => {
    const ready = search && search.query === query && search.scope === scope;
    const hits = ready ? search.hits : [];
    const dirOf = (p: string) => { const parts = p.split(/[\\/]/); parts.pop(); return parts.join(sep(p)); };
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between px-3 py-2" style={{ borderBottom: "1px solid var(--c-border)" }}>
                <span className="text-xs text-secondary">
                    {!ready ? "Searching…" : `${hits.length}${hits.length >= 500 ? "+" : ""} result${hits.length === 1 ? "" : "s"}`} for <span className="font-medium text-primary">“{query}”</span> · {scope === "folder" ? "this folder ↓" : "all indexed"}
                </span>
                <button type="button" onClick={onClear} className="text-xs text-tertiary hover:text-secondary">Clear</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {ready && hits.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                        <SearchLg className="size-7 text-quaternary" />
                        <p className="text-sm text-tertiary">No matches for “{query}”.</p>
                        {scope === "index" && <button type="button" onClick={onManageIndex} className="text-xs font-medium text-brand-secondary hover:underline">Manage indexed locations</button>}
                    </div>
                ) : (
                    hits.map((h) => {
                        const m = metaFor(h.path);
                        return (
                            <button key={h.path} type="button" onClick={() => (h.isDir ? onOpenDir(h.path) : onOpenFile(h.path))} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition hover:bg-secondary">
                                <ThumbOrIcon path={h.path} name={h.name} isDir={h.isDir} px={18} meta={m} thumbs={thumbs} request={request} />
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-primary">{h.name}</span>
                                    <span className="truncate text-[11px] text-quaternary">{dirOf(h.path)}</span>
                                </span>
                                <TagDots tagIds={m?.tagIds} tags={tags} />
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
};

// ---- Indexed-locations manager (add a folder/drive, reindex w/ progress, live-watch; powers "All" search) ----
const IndexManager = ({ state, actions, onClose }: { state: CoretexState; actions: CoretexActions; onClose: () => void }) => {
    const index = state.index;
    const progress = state.indexProgress;
    const { fs } = state;
    const [path, setPath] = useState("");
    const [picking, setPicking] = useState(false);
    const locations = index?.locations ?? [];
    const indexing = !!index?.indexing;
    const add = (p: string) => { const t = p.trim(); if (t) { actions.indexAddLocation(t); setPath(""); } };
    const when = index?.indexedAt ? new Date(index.indexedAt).toLocaleString() : "never";
    // Drives not already indexed → quick "index this whole drive" buttons.
    const unindexedDrives = fs.roots.filter((r) => !locations.some((l) => l === r || l === r.replace(/[\\/]+$/, "")));
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
                <div className="shrink-0 p-5 pb-3">
                    <div className="mb-1 flex items-center gap-2">
                        <Database01 className="size-5 text-brand-secondary" />
                        <h2 className="text-md font-semibold text-primary">Indexing</h2>
                    </div>
                    <p className="text-xs text-tertiary">Indexed folders/drives are crawled so the “All” search finds files across them instantly. {index ? `${index.count.toLocaleString()} entries · last indexed ${when}.` : ""}</p>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5">
                    {/* Live progress / status */}
                    {indexing ? (
                        <div className="mb-3 rounded-lg px-3 py-3" style={{ background: "var(--surface-2)" }}>
                            <div className="flex items-center gap-2 text-xs text-secondary">
                                <Loading01 className="size-4 shrink-0 animate-spin text-brand-secondary" />
                                <span className="font-medium text-primary">Indexing…</span>
                                <span className="tabular-nums">{(progress?.count ?? 0).toLocaleString()} files</span>
                            </div>
                            {progress?.current && <p className="mt-1 truncate font-mono text-[11px] text-quaternary" title={progress.current}>{progress.current}</p>}
                            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface)" }}>
                                <div className="h-full w-1/3 animate-pulse rounded-full" style={{ background: "var(--brand)" }} />
                            </div>
                        </div>
                    ) : (
                        <div className="mb-3 flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: "var(--surface-2)" }}>
                            <span className="flex items-center gap-2 text-xs text-secondary">
                                <Eye className="size-4 shrink-0 text-tertiary" /> Live watch — keep the index fresh as files change
                            </span>
                            <Toggle
                                size="sm"
                                aria-label="Live watch — keep the index fresh as files change"
                                isSelected={!!index?.watching}
                                onChange={(v) => actions.indexSetWatch(v)}
                                className="shrink-0"
                            />
                        </div>
                    )}

                    {/* Index a whole drive */}
                    {unindexedDrives.length > 0 && (
                        <div className="mb-3">
                            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-quaternary">Index a whole drive</p>
                            <div className="flex flex-wrap gap-1.5">
                                {unindexedDrives.map((r) => (
                                    <button key={r} type="button" onClick={() => actions.indexAddLocation(r)} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-secondary transition hover:bg-secondary" style={{ background: "var(--surface-2)" }}>
                                        <HardDrive className="size-3.5" /> {r.replace(/[\\/]+$/, "")}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Indexed locations */}
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-quaternary">Indexed locations</p>
                    <div className="mb-3 flex flex-col gap-1">
                        {locations.length === 0 ? (
                            <p className="rounded-lg px-3 py-4 text-center text-xs text-quaternary" style={{ background: "var(--surface-2)" }}>No indexed locations yet. Add a folder or drive.</p>
                        ) : (
                            locations.map((loc) => (
                                <div key={loc} className="group flex items-center gap-2 rounded-md px-2.5 py-1.5" style={{ background: "var(--surface-2)" }}>
                                    <HardDrive className="size-3.5 shrink-0 text-tertiary" />
                                    <button type="button" onClick={() => { actions.fsList(loc); onClose(); }} title="Browse this location in Files" className="min-w-0 flex-1 truncate text-left font-mono text-xs text-secondary transition hover:text-primary">{loc}</button>
                                    <button type="button" onClick={() => { actions.fsList(loc); onClose(); }} title="Open in Files" className="shrink-0 text-quaternary opacity-0 transition group-hover:opacity-100 hover:text-primary"><LinkExternal01 className="size-3.5" /></button>
                                    <button type="button" onClick={() => actions.indexRemoveLocation(loc)} title="Remove from index" className="shrink-0 text-quaternary hover:text-error-primary"><XClose className="size-3.5" /></button>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="mb-4 flex items-center gap-1.5">
                        <Input
                            size="sm"
                            icon={Folder}
                            value={path}
                            onChange={(v) => setPath(v)}
                            onKeyDown={(e) => { if (e.key === "Enter") add(path); }}
                            placeholder="Folder path to index…"
                            aria-label="Folder path to index"
                            className="min-w-0 flex-1"
                            inputClassName="font-mono"
                        />
                        <Button size="sm" color="secondary" iconLeading={Folder} onClick={() => setPicking(true)}>Browse</Button>
                        <Button size="sm" color="primary" iconLeading={Plus} onClick={() => add(path)} isDisabled={!path.trim()}>Add</Button>
                    </div>
                </div>

                <div className="flex shrink-0 items-center justify-between border-t px-5 py-3" style={{ borderColor: "var(--c-border)" }}>
                    <Button size="sm" color="secondary" iconLeading={RefreshCcw01} onClick={() => actions.indexReindex()} isDisabled={indexing || locations.length === 0}>
                        {indexing ? "Indexing…" : "Reindex now"}
                    </Button>
                    <Button size="sm" color="primary" onClick={onClose}>Done</Button>
                </div>
            </div>
            {picking && <FolderPicker state={state} actions={actions} title="Choose a folder to index" onPick={(p) => { actions.indexAddLocation(p); setPicking(false); }} onClose={() => setPicking(false)} />}
        </div>
    );
};

// ---- "This PC" storage overview: combined totals + drive-by-drive capacity + customization ----
const DrivesOverview = ({ drives, driveMeta, onOpen, onRename, onEdit, onRefresh }: { drives: DriveInfo[]; driveMeta: Record<string, DriveMeta>; onOpen: (p: string) => void; onRename: (p: string, nickname: string) => void; onEdit: (p: string) => void; onRefresh: () => void }) => {
    // Combined capacity across all drives that report a size.
    const sized = drives.filter((d) => d.total > 0);
    const totalAll = sized.reduce((s, d) => s + d.total, 0);
    const freeAll = sized.reduce((s, d) => s + d.free, 0);
    const usedAll = Math.max(0, totalAll - freeAll);
    const pctAll = totalAll > 0 ? Math.min(100, Math.round((usedAll / totalAll) * 100)) : 0;
    const barAll = pctAll >= 90 ? "#ef4444" : pctAll >= 75 ? "#f59e0b" : "#17b26a";
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid var(--c-border)" }}>
                <div className="flex items-center gap-2">
                    <Monitor01 className="size-5 text-brand-secondary" />
                    <h2 className="text-sm font-semibold text-primary">This PC</h2>
                    <span className="text-xs text-quaternary">· {drives.length} {drives.length === 1 ? "drive" : "drives"}</span>
                </div>
                <button type="button" onClick={onRefresh} title="Rescan drives" className="flex size-8 items-center justify-center rounded-md text-tertiary transition hover:bg-secondary hover:text-primary"><RefreshCcw01 className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {drives.length === 0 ? (
                    <p className="text-sm text-quaternary">Scanning drives…</p>
                ) : (
                    <>
                        {/* Combined total + usage across all drives */}
                        {sized.length > 0 && (
                            <div className="mb-5 rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="flex items-center gap-2 text-sm font-semibold text-primary"><Database01 className="size-4 text-brand-secondary" /> Total storage</span>
                                    <span className="text-xs text-quaternary">{sized.length} of {drives.length} {drives.length === 1 ? "drive" : "drives"} reporting</span>
                                </div>
                                <div className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
                                    <div className="h-full rounded-full transition-all" style={{ width: `${pctAll}%`, background: barAll }} />
                                </div>
                                <div className="mt-2 flex items-center justify-between text-xs">
                                    <span className="text-secondary">{formatBytes(usedAll)} used · {formatBytes(freeAll)} free</span>
                                    <span className="font-medium text-primary">{formatBytes(totalAll)} total</span>
                                </div>
                            </div>
                        )}
                        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
                            {drives.map((d) => (
                                <DriveCard key={d.path} drive={d} meta={driveMeta[d.path]} onOpen={() => onOpen(d.path)} onRename={(n) => onRename(d.path, n)} onEdit={() => onEdit(d.path)} />
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const DriveCard = ({ drive, meta, onOpen, onRename, onEdit }: { drive: DriveInfo; meta?: DriveMeta; onOpen: () => void; onRename: (nickname: string) => void; onEdit: () => void }) => {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(meta?.nickname ?? "");
    const used = Math.max(0, drive.total - drive.free);
    const pct = drive.total > 0 ? Math.min(100, Math.round((used / drive.total) * 100)) : 0;
    const barColor = pct >= 90 ? "#ef4444" : pct >= 75 ? "#f59e0b" : "#17b26a";
    const letter = drive.path.replace(/[\\/]+$/, "");
    const display = meta?.nickname || drive.label || letter;
    const save = () => { onRename(name.trim()); setEditing(false); };
    const customIcon = meta?.icon && meta.icon.kind !== "auto" && meta.icon.value;
    return (
        <div className="group flex flex-col gap-3 rounded-xl p-4 text-left transition" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
            <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--surface-2)" }}>
                    {customIcon ? <MetaEntryIcon name={letter} isDir={false} px={22} meta={{ icon: meta!.icon, color: meta?.color }} /> : <HardDrive className="size-5" style={{ color: meta?.color || "var(--brand-secondary)" }} />}
                </span>
                <div className="min-w-0 flex-1">
                    {editing ? (
                        <input
                            autoFocus
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") save(); else if (e.key === "Escape") setEditing(false); }}
                            onBlur={save}
                            placeholder={letter}
                            className="w-full rounded-md px-2 py-1 text-sm text-primary outline-none focus:ring-2 focus:ring-brand"
                            style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                        />
                    ) : (
                        <div className="flex items-center gap-1.5">
                            <button type="button" onClick={onOpen} className="truncate text-sm font-semibold text-primary hover:text-brand-secondary">{display}</button>
                            <button type="button" onClick={() => { setName(meta?.nickname ?? ""); setEditing(true); }} title="Rename drive" className="shrink-0 text-quaternary opacity-0 transition hover:text-primary group-hover:opacity-100"><Edit03 className="size-3" /></button>
                            <button type="button" onClick={onEdit} title="Customize icon & color" className="shrink-0 text-quaternary opacity-0 transition hover:text-primary group-hover:opacity-100"><Settings01 className="size-3" /></button>
                        </div>
                    )}
                    <p className="truncate text-xs text-quaternary">{meta?.nickname && drive.label ? `${drive.label} · ` : ""}{letter}</p>
                </div>
            </div>
            <button type="button" onClick={onOpen} className="flex flex-col gap-1.5 text-left">
                <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                </div>
                <div className="flex items-center justify-between text-xs">
                    <span className="text-secondary">{drive.total > 0 ? `${formatBytes(drive.free)} free` : "Capacity unknown"}</span>
                    <span className="text-quaternary">{drive.total > 0 ? `${formatBytes(used)} / ${formatBytes(drive.total)}` : ""}</span>
                </div>
            </button>
        </div>
    );
};

// ---- Space-to-preview quick-look overlay ----
const PreviewOverlay = ({ entry, fs, actions, tags, meta, onClose }: { entry: { path: string; name: string; isDir: boolean; size: number; modified: number }; fs: CoretexState["fs"]; actions: CoretexActions; tags: { id: string; name: string; color: string }[]; meta?: import("@repo/coretex/types").FilePathMeta; onClose: () => void }) => {
    const visual = !entry.isDir && hasVisualThumb(entry.name);
    const thumb = visual ? fs.thumbs[entry.path] : undefined;
    const peek = fs.peek?.path === entry.path ? fs.peek : undefined;

    // Lazily fetch the right preview payload for this entry.
    useEffect(() => {
        if (entry.isDir) return;
        if (visual) { if (fs.thumbs[entry.path] === undefined) actions.fsThumbnail(entry.path); }
        else if (fs.peek?.path !== entry.path) actions.fsPeek(entry.path);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entry.path]);

    const tagChips = (meta?.tagIds ?? []).map((id) => tags.find((t) => t.id === id)).filter(Boolean) as { id: string; name: string; color: string }[];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.6)" }} onMouseDown={onClose}>
            <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-2xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex shrink-0 items-center gap-2.5 px-4 py-3" style={{ borderBottom: "1px solid var(--c-border)" }}>
                    <MetaEntryIcon name={entry.name} isDir={entry.isDir} px={18} meta={meta} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">{entry.name}</span>
                    <span className="shrink-0 text-xs text-quaternary">Press Space or Esc to close</span>
                    <button type="button" onClick={onClose} className="flex size-7 items-center justify-center rounded-md text-tertiary transition hover:bg-secondary hover:text-primary"><XClose className="size-4" /></button>
                </div>

                {/* Body */}
                <div className="min-h-0 flex-1 overflow-auto" style={{ background: "var(--surface-2)" }}>
                    {entry.isDir ? (
                        <div className="flex h-48 flex-col items-center justify-center gap-2 text-quaternary">
                            <MetaEntryIcon name={entry.name} isDir px={48} meta={meta} />
                            <span className="text-sm">Folder</span>
                        </div>
                    ) : visual ? (
                        thumb ? (
                            <div className="flex items-center justify-center p-4"><img src={thumb} alt={entry.name} className="max-h-[60vh] max-w-full rounded-lg object-contain" /></div>
                        ) : thumb === null ? (
                            <div className="flex h-48 flex-col items-center justify-center gap-2 text-quaternary"><Image01 className="size-10" /><span className="text-sm">{isImage(entry.name) ? "Image too large to preview (over 2 MB)" : "Preview unavailable"}</span></div>
                        ) : (
                            <div className="flex h-48 items-center justify-center text-sm text-quaternary">{isVideo(entry.name) ? "Extracting frame…" : extOf(entry.name) === "pdf" ? "Rendering page…" : "Loading preview…"}</div>
                        )
                    ) : peek ? (
                        peek.error ? (
                            <div className="flex h-48 flex-col items-center justify-center gap-2 text-quaternary"><File02 className="size-10" /><span className="text-sm">{peek.error}</span></div>
                        ) : (
                            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-secondary">{peek.content}{peek.truncated && <span className="text-quaternary">{"\n\n… (truncated preview)"}</span>}</pre>
                        )
                    ) : (
                        <div className="flex h-48 items-center justify-center text-sm text-quaternary">Loading preview…</div>
                    )}
                </div>

                {/* Footer metadata */}
                <div className="shrink-0 px-4 py-2.5 text-xs" style={{ borderTop: "1px solid var(--c-border)" }}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-quaternary">
                        {!entry.isDir && entry.size > 0 && <span>{formatSize(entry.size)}</span>}
                        {entry.modified > 0 && <span>{formatDate(entry.modified)}</span>}
                        <span className="min-w-0 flex-1 truncate font-mono" title={entry.path}>{entry.path}</span>
                    </div>
                    {tagChips.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {tagChips.map((t) => (
                                <span key={t.id} className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: t.color + "26", color: t.color, border: `1px solid ${t.color}` }}>
                                    <span className="size-1.5 rounded-full" style={{ background: t.color }} /> {t.name}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ---- pin icon (custom icon/color or a tinted star) ----
const PinIcon = ({ pin }: { pin: FilePin }) => {
    if (pin.icon && pin.icon.kind !== "auto" && pin.icon.value) {
        return <MetaEntryIcon name={pin.name} isDir={false} px={16} meta={{ icon: pin.icon, color: pin.color }} />;
    }
    return <Star01 className="size-4 shrink-0" style={{ color: pin.color || "var(--brand-secondary)" }} />;
};

// ---- edit pin (name / icon / color) ----
const PinEditModal = ({ pin, onSave, onClose }: { pin: FilePin; onSave: (patch: Partial<FilePin>) => void; onClose: () => void }) => {
    const [name, setName] = useState(pin.name);
    const [color, setColor] = useState<string | undefined>(pin.color);
    const [iconName, setIconName] = useState<string | undefined>(pin.icon?.kind === "library" ? pin.icon.value : undefined);
    const save = () => {
        if (!name.trim()) return;
        // Preserve a non-library (emoji/upload) icon when the user only renamed/recolored.
        const icon: FilePin["icon"] = iconName
            ? { kind: "library", value: iconName }
            : pin.icon && pin.icon.kind !== "library"
                ? pin.icon
                : { kind: "auto" };
        onSave({ name: name.trim(), color, icon });
    };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
                <h2 className="mb-1 text-md font-semibold text-primary">Edit pin</h2>
                <p className="mb-3 truncate text-xs text-quaternary" title={pin.path}>{pin.path}</p>
                <label className="mb-1 block text-xs font-medium text-secondary">Name</label>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); else if (e.key === "Escape") onClose(); }} className="mb-3 w-full rounded-lg px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-brand" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }} />
                <label className="mb-1.5 block text-xs font-medium text-secondary">Color</label>
                <div className="mb-3"><ColorPicker value={color ?? ""} onChange={setColor} /></div>
                <label className="mb-1.5 block text-xs font-medium text-secondary">Icon</label>
                <IconPicker value={iconName} onChange={(n) => setIconName(n === iconName ? undefined : n)} color={color} />
                <div className="mt-4 flex justify-end gap-2">
                    <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                    <Button size="sm" color="primary" onClick={save} isDisabled={!name.trim()}>Save</Button>
                </div>
            </div>
        </div>
    );
};

// ---- edit drive (nickname / icon / color) ----
const DriveEditModal = ({ path, meta, onSave, onClose }: { path: string; meta?: DriveMeta; onSave: (patch: DriveMeta) => void; onClose: () => void }) => {
    const [nickname, setNickname] = useState(meta?.nickname ?? "");
    const [color, setColor] = useState<string | undefined>(meta?.color);
    const [iconName, setIconName] = useState<string | undefined>(meta?.icon?.kind === "library" ? meta.icon.value : undefined);
    const letter = path.replace(/[\\/]+$/, "");
    const save = () => {
        const icon: DriveMeta["icon"] = iconName
            ? { kind: "library", value: iconName }
            : meta?.icon && meta.icon.kind !== "library"
                ? meta.icon
                : { kind: "auto" };
        onSave({ nickname: nickname.trim() || undefined, color, icon });
    };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
                <h2 className="mb-1 text-md font-semibold text-primary">Customize drive</h2>
                <p className="mb-3 truncate text-xs text-quaternary">{letter}</p>
                <label className="mb-1 block text-xs font-medium text-secondary">Nickname</label>
                <input autoFocus value={nickname} onChange={(e) => setNickname(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); else if (e.key === "Escape") onClose(); }} placeholder={letter} className="mb-3 w-full rounded-lg px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-brand" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }} />
                <label className="mb-1.5 block text-xs font-medium text-secondary">Color</label>
                <div className="mb-3"><ColorPicker value={color ?? ""} onChange={setColor} /></div>
                <label className="mb-1.5 block text-xs font-medium text-secondary">Icon</label>
                <IconPicker value={iconName} onChange={(n) => setIconName(n === iconName ? undefined : n)} color={color} />
                <div className="mt-4 flex justify-end gap-2">
                    <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                    <Button size="sm" color="primary" onClick={save}>Save</Button>
                </div>
            </div>
        </div>
    );
};

// ---- new smart collection modal ----
const CollectionModal = ({ tags, onCreate, onClose }: { tags: { id: string; name: string; color: string }[]; onCreate: (name: string, tagIds: string[], color?: string) => void; onClose: () => void }) => {
    const [name, setName] = useState("");
    const [selected, setSelected] = useState<string[]>([]);
    const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    const color = selected.length ? tags.find((t) => t.id === selected[0])?.color : undefined;
    const create = () => { if (name.trim() && selected.length) onCreate(name.trim(), selected, color); };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
                <h2 className="mb-3 text-md font-semibold text-primary">New smart collection</h2>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Screenshots, Work" className="mb-3 w-full rounded-lg px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-brand" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }} />
                <p className="mb-1.5 text-xs font-medium text-secondary">Include these tags (any match)</p>
                <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => {
                        const on = selected.includes(t.id);
                        return (
                            <button key={t.id} type="button" onClick={() => toggle(t.id)} className={cx("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition", on ? "" : "opacity-60 hover:opacity-100")} style={on ? { background: t.color + "26", color: t.color, border: `1px solid ${t.color}` } : { border: "1px solid var(--c-border)", color: "var(--c-text-secondary)" }}>
                                <span className="size-2 rounded-full" style={{ background: t.color }} /> {t.name}
                            </button>
                        );
                    })}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                    <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                    <Button size="sm" color="primary" onClick={create} isDisabled={!name.trim() || selected.length === 0}>Create</Button>
                </div>
            </div>
        </div>
    );
};

// ---- new folder / file modal ----
const NewItemModal = ({ kind, onCreate, onClose }: { kind: "folder" | "file"; onCreate: (name: string) => void; onClose: () => void }) => {
    const [name, setName] = useState(kind === "folder" ? "New folder" : "untitled.txt");
    const trimmed = name.trim();
    const valid = Boolean(trimmed) && trimmed !== "." && trimmed !== ".." && !/[\\/\0]/.test(trimmed);
    const create = () => { if (valid) onCreate(trimmed); };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
                <h2 className="mb-3 text-md font-semibold text-primary">New {kind}</h2>
                <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => { if (e.key === "Enter") create(); else if (e.key === "Escape") onClose(); }}
                    className="w-full rounded-lg px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-brand"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                />
                {!valid && trimmed && <p className="mt-1.5 text-xs text-error-primary">Use a single file or folder name without slashes.</p>}
                <div className="mt-4 flex justify-end gap-2">
                    <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                    <Button size="sm" color="primary" onClick={create} isDisabled={!valid}>Create</Button>
                </div>
            </div>
        </div>
    );
};

// ---- rename file / folder modal ----
export const RenameItemModal = ({ target, onRename, onClose }: { target: { name: string; isDir: boolean }; onRename: (name: string) => void; onClose: () => void }) => {
    const [name, setName] = useState(target.name);
    const trimmed = name.trim();
    const valid = Boolean(trimmed) && trimmed !== "." && trimmed !== ".." && !/[\\/\0]/.test(trimmed);
    const rename = () => { if (valid) onRename(trimmed); };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div role="dialog" aria-modal="true" aria-label={`Rename ${target.name}`} className="w-full max-w-sm rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(event) => event.stopPropagation()}>
                <h2 className="mb-3 text-md font-semibold text-primary">Rename {target.isDir ? "folder" : "file"}</h2>
                <Input
                    autoFocus
                    value={name}
                    onChange={setName}
                    onKeyDown={(event) => { if (event.key === "Enter") rename(); else if (event.key === "Escape") onClose(); }}
                    isInvalid={Boolean(trimmed) && !valid}
                    hint={!valid && trimmed ? "Use a single file or folder name without slashes." : undefined}
                />
                <div className="mt-4 flex justify-end gap-2">
                    <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                    <Button size="sm" color="primary" onClick={rename} isDisabled={!valid || trimmed === target.name}>Rename</Button>
                </div>
            </div>
        </div>
    );
};


// ---- File Properties dialog (size / dates / type / permissions / archive) ----
const PropertiesModal = ({ target, fs, actions, onClose }: { target: { path: string; name: string; isDir: boolean }; fs: CoretexState["fs"]; actions: CoretexActions; onClose: () => void }) => {
    useEffect(() => {
        actions.fsProperties(target.path);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target.path]);
    const res = fs.properties?.path === target.path ? fs.properties : undefined;
    const info: FileProperties | undefined = res?.ok ? res.info : undefined;
    const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
        <div className="flex gap-3 py-1.5" style={{ borderBottom: "1px solid var(--c-border)" }}>
            <span className="w-28 shrink-0 text-xs text-quaternary">{label}</span>
            <span className="min-w-0 flex-1 break-words text-xs text-secondary">{value}</span>
        </div>
    );
    return (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center gap-2.5">
                    <MetaEntryIcon name={target.name} isDir={target.isDir} px={22} />
                    <h2 className="min-w-0 flex-1 truncate text-md font-semibold text-primary">{target.name}</h2>
                    <button type="button" onClick={onClose} className="rounded p-1 text-quaternary hover:text-secondary"><XClose className="size-4" /></button>
                </div>
                {!res ? (
                    <p className="py-6 text-center text-xs text-quaternary">Reading properties…</p>
                ) : res.error || !info ? (
                    <p className="py-6 text-center text-xs text-error-primary">{res.error ?? "Could not read properties."}</p>
                ) : (
                    <div className="flex flex-col">
                        <Row label="Type" value={info.type} />
                        <Row label="Location" value={<span className="font-mono">{info.path.slice(0, info.path.lastIndexOf(sep(info.path))) || info.path}</span>} />
                        <Row label="Size" value={info.isDir ? `${(info.itemCount ?? 0).toLocaleString()} item${info.itemCount === 1 ? "" : "s"}` : `${formatBytes(info.size)} (${info.size.toLocaleString()} bytes)`} />
                        <Row label="Created" value={formatDate(info.created)} />
                        <Row label="Modified" value={formatDate(info.modified)} />
                        <Row label="Accessed" value={formatDate(info.accessed)} />
                        <Row label="Read-only" value={info.readOnly ? "Yes" : "No"} />
                        <Row label="Permissions" value={<span className="font-mono">{(info.mode & 0o777).toString(8).padStart(3, "0")}</span>} />
                        {!info.isDir && <Row label="Encoding" value={info.encoding ?? "Unknown"} />}
                        {!info.isDir && info.checksumSha256 && <Row label="SHA-256" value={<span className="select-all break-all font-mono text-[10px]">{info.checksumSha256}</span>} />}
                        {info.archive && <Row label="Archive" value="Extractable archive" />}
                    </div>
                )}
                <div className="mt-4 flex justify-end gap-2">
                    {info && !target.isDir && <Button size="sm" color="secondary" iconLeading={LinkExternal01} onClick={() => actions.fsOpenExternal(target.path)}>Open</Button>}
                    <Button size="sm" color="primary" onClick={onClose}>Close</Button>
                </div>
            </div>
        </div>
    );
};
