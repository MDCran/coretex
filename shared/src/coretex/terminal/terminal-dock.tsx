// @ts-nocheck
"use client";

// Coretex — right-side terminal dock. Lists every open PTY session, opens new
// ones via a shell/profile picker, and renders them with xterm.js in a tabbed
// view or an N×M grid. Sessions stay mounted (visible cells flow into the grid;
// inactive ones overlay hidden) so switching never loses an xterm's buffer.
// Tabs can be renamed (double-click) and recolored (right-click) — persisted.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Grid01,
  Plus,
  Terminal,
  X,
  XClose,
  Maximize01,
  Minimize01,
  Edit01,
  LayoutAlt01,
  Download01,
} from "@untitledui/icons";
import type { BridgeClient } from "@repo/coretex/client";
import type {
  TerminalSessionMeta,
  ProviderType,
  CoretexConfig,
} from "@repo/coretex/types";
import { cx } from "@/utils/cx";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { useTheme } from "../theme";
import { XtermTerm } from "./xterm-term";
import { COLOR_SWATCHES } from "../ui/color-picker";
import { TerminalBuddyBar } from "./terminal-buddy-bar";
import {
  readTerminalLog,
  downloadTextFile,
  terminalLogFilename,
} from "./terminal-registry";
import { TerminalEnvTooltip } from "./terminal-env-tooltip";
import { CommandBlocksPanel } from "./command-blocks-panel";
import { speechOptsFor } from "../ui/speech-opts";

interface Props {
  state: CoretexState;
  actions: CoretexActions;
  client: BridgeClient;
  onClose: () => void;
  /** External request to focus a specific session (from the status cluster); cleared via onFocusHandled. */
  focusSessionId?: string | null;
  onFocusHandled?: () => void;
  /** External request to pop a session out as a floating widget; cleared via onPopoutHandled. */
  popoutSessionId?: string | null;
  onPopoutHandled?: () => void;
  /** Narrow-screen mode: float over the main content (fixed, capped width) instead of taking flex space. */
  overlay?: boolean;
  /**
   * Open the dock as a full-page overlay (not a side split). Defaults to true so
   * new terminals always take the whole window; the minimize control docks back.
   */
  defaultFullscreen?: boolean;
  /** Reports full-page transitions so the app shell can hide its other surfaces. */
  onFullscreenChange?: (fullscreen: boolean) => void;
  /** Keep the tab strip visible when there is only one terminal. */
  alwaysShowTabs?: boolean;
  /** Show the tab strip while the terminal owns the full app surface. */
  showTabsInFullscreen?: boolean;
  /** Controls how terminal tabs consume horizontal space. */
  tabWidthMode?: "equal" | "title" | "compact";
  /** Use a translucent, blurred surface behind the tab strip. */
  tabAcrylic?: boolean;
}

interface ShellOption {
  label: string;
  shell?: string;
  profileId?: string;
}

interface TermMeta {
  name?: string;
  color?: string;
  /** Per-terminal color scheme override (by ColorScheme.name); falls back to the global active scheme. */
  schemeName?: string;
}

const ORDER_KEY = "coretex-term-order";

const KNOWN_PROVIDERS = new Set<string>([
  "ollama",
  "lmstudio",
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "openclaw",
]);

/** Resolve the model a terminal's buddy should show (mirrors the Brain's resolver) — per-terminal override → buddy default → first ready provider. */
export function resolveBuddyModelClient(
  settings: CoretexConfig | null,
  sessionId: string,
): { provider: ProviderType; id: string } | null {
  const tb = settings?.terminalBuddy;
  if (!tb) return null;
  const ov = tb.perTerminal[sessionId] ?? {};
  const wantProvider = (ov.provider || tb.defaultProvider || "").trim();
  const wantModel = (ov.model || tb.defaultModel || "").trim();
  if (KNOWN_PROVIDERS.has(wantProvider)) {
    const pcfg = settings?.aiProviders.find((p) => p.provider === wantProvider);
    const model = wantModel || pcfg?.defaultModel || "";
    if (model) return { provider: wantProvider as ProviderType, id: model };
  }
  for (const p of settings?.aiProviders ?? []) {
    if (!KNOWN_PROVIDERS.has(p.provider)) continue;
    const ready = (() => {
      if (!p.enabled) return false;
      if (
        p.provider === "ollama" ||
        p.provider === "lmstudio" ||
        p.provider === "openclaw"
      )
        return !!p.baseUrl;
      if (p.provider === "anthropic" && p.authMode !== "api-key") return true;
      return p.keyConfigured;
    })();
    if (ready && p.defaultModel)
      return { provider: p.provider as ProviderType, id: p.defaultModel };
  }
  return null;
}

const LAYOUTS: { label: string; rows: number; cols: number }[] = [
  { label: "Single", rows: 1, cols: 1 },
  { label: "Side by side", rows: 1, cols: 2 },
  { label: "Stacked", rows: 2, cols: 1 },
  { label: "Quad", rows: 2, cols: 2 },
  { label: "Wide grid", rows: 2, cols: 3 },
  { label: "3×3 grid", rows: 3, cols: 3 },
];

/** Layout index helpers — keep snap drops pointed at the right grid shape. */
const LAYOUT_SIDE = 1;
const LAYOUT_STACK = 2;

type SnapZone = "left" | "right" | "top" | "bottom" | "center" | "float";

/** Pick a Windows-style snap region from pointer position inside the terminal pane. */
function snapZoneFromPoint(
  x: number,
  y: number,
  w: number,
  h: number,
): SnapZone {
  if (w <= 0 || h <= 0) return "center";
  const px = x / w;
  const py = y / h;
  // Thin strip toward the main app = pop out as a floating widget.
  if (px < 0.1) return "float";
  const edge = 0.28;
  const inMidY = py > edge && py < 1 - edge;
  const inMidX = px > edge && px < 1 - edge;
  if (px < edge && inMidY) return "left";
  if (px > 1 - edge && inMidY) return "right";
  if (py < edge && inMidX) return "top";
  if (py > 1 - edge && inMidX) return "bottom";
  // Prefer cardinal edges in corners (half split by closer axis).
  if (px < edge && py < edge) return px < py ? "left" : "top";
  if (px > 1 - edge && py < edge) return 1 - px < py ? "right" : "top";
  if (px < edge && py > 1 - edge) return px < 1 - py ? "left" : "bottom";
  if (px > 1 - edge && py > 1 - edge)
    return 1 - px < 1 - py ? "right" : "bottom";
  return "center";
}

/** Move `id` to `index` within the docked-session order (others keep relative order). */
function moveIdToIndex(ids: string[], id: string, index: number): string[] {
  const without = ids.filter((x) => x !== id);
  const i = Math.max(0, Math.min(index, without.length));
  without.splice(i, 0, id);
  return without;
}

/** Tiny schematic of a dock layout — filled cells so the picker shows the shape, not math. */
const LayoutPreview = ({
  rows,
  cols,
  active,
}: {
  rows: number;
  cols: number;
  active: boolean;
}) => (
  <span
    className="grid size-9 gap-0.5 rounded-sm p-0.5"
    style={{
      gridTemplateRows: `repeat(${rows}, 1fr)`,
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      background: active ? "rgba(255,255,255,0.18)" : "var(--surface-2)",
      border: active
        ? "1px solid rgba(255,255,255,0.35)"
        : "1px solid var(--c-border)",
    }}
    aria-hidden
  >
    {Array.from({ length: rows * cols }, (_, i) => (
      <span
        key={i}
        className="min-h-0 min-w-0 rounded-[2px]"
        style={{
          background: active ? "rgba(255,255,255,0.92)" : "var(--c-text-muted)",
        }}
      />
    ))}
  </span>
);

/** Windows-like translucent preview of where a dragged tab will land. */
const SnapOverlay = ({ zone }: { zone: SnapZone }) => {
  const base =
    "pointer-events-none absolute z-20 rounded-md transition-all duration-100";
  const fill = {
    background: "color-mix(in srgb, var(--brand) 28%, transparent)",
    border: "2px solid var(--brand)",
    boxShadow:
      "inset 0 0 0 1px color-mix(in srgb, var(--brand) 40%, transparent)",
  } as const;
  if (zone === "float") {
    return (
      <div className={`${base} inset-y-3 left-2 w-[38%]`} style={fill}>
        <span
          className="absolute inset-x-0 top-2 text-center text-[11px] font-semibold"
          style={{ color: "var(--brand-secondary)" }}
        >
          Pop out
        </span>
      </div>
    );
  }
  if (zone === "left")
    return (
      <div
        className={`${base} inset-y-2 left-2 w-[calc(50%-6px)]`}
        style={fill}
      />
    );
  if (zone === "right")
    return (
      <div
        className={`${base} inset-y-2 right-2 w-[calc(50%-6px)]`}
        style={fill}
      />
    );
  if (zone === "top")
    return (
      <div
        className={`${base} inset-x-2 top-2 h-[calc(50%-6px)]`}
        style={fill}
      />
    );
  if (zone === "bottom")
    return (
      <div
        className={`${base} inset-x-2 bottom-2 h-[calc(50%-6px)]`}
        style={fill}
      />
    );
  return <div className={`${base} inset-4`} style={fill} />;
};

const MIN_W = 360;
const MAX_W = 1200;
const META_KEY = "coretex-term-meta";

function loadMeta(): Record<string, TermMeta> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(META_KEY) ?? "{}") as Record<
      string,
      TermMeta
    >;
  } catch {
    return {};
  }
}

export const TerminalDock = ({
  state,
  actions,
  client,
  onClose,
  focusSessionId,
  onFocusHandled,
  popoutSessionId,
  onPopoutHandled,
  overlay = false,
  defaultFullscreen = true,
  onFullscreenChange,
  alwaysShowTabs = true,
  showTabsInFullscreen = false,
  tabWidthMode = "equal",
  tabAcrylic = false,
}: Props) => {
  const theme = useTheme();
  const sessions = state.terminals;
  const schemes = state.settings?.colorSchemes ?? [];
  // Active color scheme drives the xterm palette (colors-from-settings).
  const activeSchemeName =
    state.settings?.appearance.application.activeColorScheme ?? null;
  const activeScheme = activeSchemeName
    ? (schemes.find((s) => s.name === activeSchemeName) ?? null)
    : null;

  const [activeId, setActiveId] = useState<string | null>(null);
  // Full-page by default so launching a terminal never lands as a narrow side split.
  // Preference is remembered while the dock stays mounted; remount always starts full-page.
  const [fullscreen, setFullscreen] = useState<boolean>(defaultFullscreen);

  // Full-page Terminal owns the whole app surface. Keep the shell informed so it
  // can remove the sidebar, page, and their portaled hover overlays while active.
  useEffect(() => {
    onFullscreenChange?.(fullscreen);
  }, [fullscreen, onFullscreenChange]);
  // Command Blocks side panel (shell-integration block model) for the active shell.
  const [blocksOpen, setBlocksOpen] = useState(false);
  // Popped-out sessions float as draggable sticky windows over the app.
  const [floatingIds, setFloatingIds] = useState<Set<string>>(new Set());
  // Click-to-focus z-order: each floated session gets a z-index; clicking one bumps it to front.
  const [zOrder, setZOrder] = useState<Record<string, number>>({});
  const zCounter = useRef(60);
  const bringToFront = (id: string) => {
    zCounter.current += 1;
    const z = zCounter.current;
    setZOrder((prev) => ({ ...prev, [id]: z }));
  };
  // Drag-back-to-tabs: true while a floating widget is being dragged near the tab strip.
  const [tabDropActive, setTabDropActive] = useState(false);
  // Always start on Single (full pane). Multi-pane only after an explicit layout pick / snap.
  const [layoutIdx, setLayoutIdx] = useState(0);
  /** Live snap target while a tab is dragged over the terminal pane (Windows-style). */
  const [snapHover, setSnapHover] = useState<SnapZone | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [showShells, setShowShells] = useState(false);
  const [showLayouts, setShowLayouts] = useState(false);
  // Inline "new terminal" picker shown inside a clicked empty grid cell (not the top-right).
  const [addingCellIdx, setAddingCellIdx] = useState<number | null>(null);
  const [meta, setMeta] = useState<Record<string, TermMeta>>(loadMeta);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const shellsMenuRef = useRef<HTMLDivElement | null>(null);
  const layoutsMenuRef = useRef<HTMLDivElement | null>(null);
  // Buddy bar collapse state (persisted) — the bottom-of-pane assistant strip.
  const [buddyCollapsed, setBuddyCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("coretex-buddy-collapsed") === "1";
  });
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 620;
    return Number(window.localStorage.getItem("coretex-dock-w")) || 620;
  });
  const draggingRef = useRef<false | "normal" | "overlay">(false);
  // Persisted tab order (drag-to-reorder) + the id of the tab currently being dragged.
  const [tabOrder, setTabOrder] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(
        window.localStorage.getItem(ORDER_KEY) ?? "[]",
      ) as string[];
    } catch {
      return [];
    }
  });
  const dragTab = useRef<string | null>(null);

  const layout = LAYOUTS[layoutIdx];
  const activeMeta = activeId
    ? sessions.find((s) => s.id === activeId)
    : undefined;
  const activeIsShell =
    !!activeMeta && activeMeta.kind !== "agent" && !activeMeta.readOnly;
  const isGrid = layout.rows * layout.cols > 1;
  const cellCount = layout.rows * layout.cols;

  const setTermMeta = (id: string, patch: TermMeta) => {
    setMeta((prev) => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } };
      if (typeof window !== "undefined")
        window.localStorage.setItem(META_KEY, JSON.stringify(next));
      return next;
    });
  };

  const nameOf = (s: TerminalSessionMeta) =>
    meta[s.id]?.name?.trim() || s.title;
  const colorOf = (s: TerminalSessionMeta) =>
    meta[s.id]?.color ||
    (s.status === "running" ? "var(--c-success)" : "var(--c-text-muted)");
  // Per-terminal scheme: a session's own override (set via the tab menu), else the global active scheme.
  const schemeFor = (s: TerminalSessionMeta) => {
    const name = meta[s.id]?.schemeName;
    if (name) return schemes.find((x) => x.name === name) ?? activeScheme;
    return activeScheme;
  };
  /** Tab order (persisted) → sessions, with unknown ids appended in arrival order. */
  const orderedSessions = useMemo(() => {
    const idx = new Map(tabOrder.map((id, i) => [id, i]));
    return [...sessions].sort(
      (a, b) => (idx.get(a.id) ?? 1e9) - (idx.get(b.id) ?? 1e9),
    );
  }, [sessions, tabOrder]);
  const dockedSessionCount = orderedSessions.filter(
    (session) => !floatingIds.has(session.id),
  ).length;
  const showTabStrip =
    (!fullscreen || showTabsInFullscreen) &&
    (alwaysShowTabs || dockedSessionCount > 1);
  const reorderTab = (dragId: string, targetId: string): void => {
    if (dragId === targetId) return;
    const ids = orderedSessions.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    persistTabOrder(ids);
  };

  const persistTabOrder = (ids: string[]): void => {
    setTabOrder(ids);
    if (typeof window !== "undefined")
      window.localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  };

  /** Apply a Windows-style snap drop: split layout + place tab, or float out. */
  const applySnap = (id: string, zone: SnapZone): void => {
    if (zone === "float") {
      setFloatingIds((prev) => {
        const n = new Set(prev);
        n.add(id);
        return n;
      });
      bringToFront(id);
      setActiveId((cur) => (cur === id ? null : cur));
      return;
    }
    // Ensure the session is docked (not floating).
    setFloatingIds((prev) => {
      if (!prev.has(id)) return prev;
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    const docked = orderedSessions
      .filter((s) => !floatingIds.has(s.id) || s.id === id)
      .map((s) => s.id);
    const others = docked.filter((x) => x !== id);
    let nextIds: string[];
    if (zone === "left" || zone === "top") {
      setLayoutIdx(zone === "left" ? LAYOUT_SIDE : LAYOUT_STACK);
      nextIds = [id, ...others];
    } else if (zone === "right" || zone === "bottom") {
      setLayoutIdx(zone === "right" ? LAYOUT_SIDE : LAYOUT_STACK);
      if (others.length === 0) nextIds = [id];
      else nextIds = [others[0]!, id, ...others.slice(1)];
    } else {
      // Center — keep single-pane focus; do NOT auto-split (user opts into multi-pane via layout picker / edge snap).
      nextIds = docked.includes(id) ? docked : [id, ...others];
      if (!isGrid) setLayoutIdx(0);
    }
    persistTabOrder(nextIds);
    setActiveId(id);
  };

  /** Drop onto a specific grid cell index (swap that pane's occupant). */
  const applyCellDrop = (id: string, cellIndex: number): void => {
    setFloatingIds((prev) => {
      if (!prev.has(id)) return prev;
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    if (!isGrid && cellIndex > 0) setLayoutIdx(LAYOUT_SIDE);
    const docked = orderedSessions
      .filter((s) => !floatingIds.has(s.id) || s.id === id)
      .map((s) => s.id);
    persistTabOrder(moveIdToIndex(docked, id, cellIndex));
    setActiveId(id);
    // Grow grid if dropping past current cell count.
    if (cellIndex >= cellCount) {
      if (cellIndex === 1) setLayoutIdx(LAYOUT_SIDE);
      else if (cellIndex >= 2) setLayoutIdx(3); // quad
    }
  };

  const clearDrag = (): void => {
    dragTab.current = null;
    setDraggingTabId(null);
    setSnapHover(null);
  };

  // Keep a valid active session.
  useEffect(() => {
    if (sessions.length === 0) setActiveId(null);
    else if (!activeId || !sessions.some((s) => s.id === activeId))
      setActiveId(sessions[sessions.length - 1].id);
  }, [sessions, activeId]);

  // External focus request (from the status cluster): activate + un-float that session.
  useEffect(() => {
    if (focusSessionId && sessions.some((s) => s.id === focusSessionId)) {
      setActiveId(focusSessionId);
      setFloatingIds((p) => {
        if (!p.has(focusSessionId)) return p;
        const n = new Set(p);
        n.delete(focusSessionId);
        return n;
      });
      onFocusHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSessionId]);
  // External popout request: float that session as a widget.
  useEffect(() => {
    if (popoutSessionId && sessions.some((s) => s.id === popoutSessionId)) {
      setFloatingIds((p) => {
        const n = new Set(p);
        n.add(popoutSessionId);
        return n;
      });
      bringToFront(popoutSessionId);
      onPopoutHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popoutSessionId]);

  useEffect(() => {
    if (typeof window !== "undefined")
      window.localStorage.setItem("coretex-dock-w", String(width));
  }, [width]);

  // New terminal sessions always open full-page + single layout (never a half-dock split).
  const prevSessionCount = useRef(sessions.length);
  useEffect(() => {
    const prev = prevSessionCount.current;
    prevSessionCount.current = sessions.length;
    if (sessions.length > prev && sessions.length > 0) {
      setFullscreen(true);
      setLayoutIdx(0);
      // Keep existing floats; only clear float for brand-new sessions via focus path.
    }
  }, [sessions.length]);

  // Drag-to-resize from the left edge.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      // Desktop: cap so the sidebar + main content keep a usable minimum (no wonky squeeze).
      // Overlay (narrow screens): the dock floats over main, so let it span most of the
      // viewport — clamp to innerWidth minus a small gutter so it never runs off-screen.
      const cap =
        draggingRef.current === "overlay"
          ? Math.max(MIN_W, window.innerWidth - 48)
          : Math.min(MAX_W, window.innerWidth - 600);
      setWidth(Math.max(MIN_W, Math.min(cap, window.innerWidth - e.clientX)));
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Close popovers / context menu on outside click. Ignore mousedowns inside the
  // menus themselves — a bare window listener unmounts the menu before the button's
  // click fires, so Close / shell / layout choices silently do nothing.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (ctxMenuRef.current?.contains(t)) return;
      if (shellsMenuRef.current?.contains(t)) return;
      if (layoutsMenuRef.current?.contains(t)) return;
      setShowShells(false);
      setShowLayouts(false);
      setCtxMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  /** Kill a session and drop it from local float / tab bookkeeping. */
  const killTerminal = (id: string) => {
    actions.terminalKill(id);
    setFloatingIds((prev) => {
      if (!prev.has(id)) return prev;
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    if (activeId === id) setActiveId(null);
    setCtxMenu((m) => (m?.id === id ? null : m));
  };

  /** Save a terminal's current scrollback to a .log file. */
  const exportLog = (id: string) => {
    const s = sessions.find((x) => x.id === id);
    const text = readTerminalLog(id) ?? "";
    downloadTextFile(terminalLogFilename(s ? nameOf(s) : "terminal"), text);
    setCtxMenu(null);
  };

  const shellOptions: ShellOption[] = useMemo(() => {
    const opts: ShellOption[] = [{ label: "Default shell" }];
    const isWin =
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("Windows");
    if (isWin) {
      opts.push({ label: "PowerShell", shell: "powershell.exe" });
      opts.push({ label: "Command Prompt", shell: "cmd.exe" });
      opts.push({ label: "WSL", shell: "wsl.exe" });
      opts.push({
        label: "Git Bash",
        shell: "C:\\Program Files\\Git\\bin\\bash.exe",
      });
    } else {
      opts.push({ label: "bash", shell: "/bin/bash" });
      opts.push({ label: "zsh", shell: "/bin/zsh" });
    }
    for (const p of state.settings?.profiles ?? [])
      opts.push({ label: p.name, profileId: p.id });
    return opts;
  }, [state.settings]);

  const newTerminal = (opt: ShellOption) => {
    actions.terminalCreate({ shell: opt.shell, profileId: opt.profileId });
    setShowShells(false);
  };

  const commitRename = () => {
    if (renamingId) setTermMeta(renamingId, { name: renameValue });
    setRenamingId(null);
  };

  // Sessions shown in the dock grid = ordered sessions minus the popped-out (floating) ones.
  const gridSessions = useMemo(
    () => orderedSessions.filter((s) => !floatingIds.has(s.id)),
    [orderedSessions, floatingIds],
  );

  // Which sessions are shown. DOM order stays stable (sessions order) so cells
  // never jump on focus; we only toggle visibility. In a grid the first N are
  // shown; if the active one is beyond N it's swapped into view.
  const visibleIds = useMemo(() => {
    if (!isGrid)
      return new Set(
        activeId && !floatingIds.has(activeId)
          ? [activeId]
          : gridSessions.slice(0, 1).map((s) => s.id),
      );
    let vis = gridSessions.slice(0, cellCount);
    if (
      activeId &&
      !floatingIds.has(activeId) &&
      !vis.some((s) => s.id === activeId)
    ) {
      const act = gridSessions.find((s) => s.id === activeId);
      if (act) vis = [...vis.slice(0, cellCount - 1), act];
    }
    return new Set(vis.map((s) => s.id));
  }, [gridSessions, activeId, isGrid, cellCount, floatingIds]);
  const emptyCells = isGrid ? Math.max(0, cellCount - visibleIds.size) : 0;

  // Buddy bar placement: 'bottom' (default) docks it under the active pane; 'side'
  // renders it as a vertical strip on the right of the terminal area. Reading this
  // setting makes the option a real layout choice rather than a no-op.
  const buddyBarPosition =
    state.settings?.terminalBuddy?.buddyBarPosition ?? "bottom";
  const buddySide = buddyBarPosition === "side";

  // The Terminal Buddy bar element (or null when it shouldn't render). Built once so it
  // can be placed at the bottom of the dock or beside the active pane depending on the setting.
  const buddyBar = (() => {
    if (!activeId || floatingIds.has(activeId)) return null;
    const m = sessions.find((s) => s.id === activeId);
    if (!m || m.kind === "agent" || m.readOnly) return null;
    const tb = state.settings?.terminalBuddy;
    const perTerm = tb?.perTerminal?.[activeId];
    if (
      tb &&
      (perTerm?.enabled === false ||
        (perTerm?.enabled === undefined && tb.enabled === false))
    )
      return null;
    return (
      <TerminalBuddyBar
        key={activeId}
        sessionId={activeId}
        buddy={state.buddy[activeId]}
        actions={actions}
        models={state.models}
        model={resolveBuddyModelClient(state.settings, activeId)}
        onModelChange={(provider, id) =>
          actions.setSetting(`terminalBuddy.perTerminal.${activeId}`, {
            provider,
            model: id,
          })
        }
        defaultMode={tb?.defaultMode ?? "suggest"}
        autoProbe={tb?.probeOnStart !== false}
        speech={speechOptsFor(state.settings?.speech, "terminalBuddy")}
        injectIntoTerminal={state.settings?.speech?.injectIntoTerminal === true}
        collapsed={buddyCollapsed}
        onCollapsedChange={(c) => {
          setBuddyCollapsed(c);
          if (typeof window !== "undefined")
            window.localStorage.setItem(
              "coretex-buddy-collapsed",
              c ? "1" : "0",
            );
        }}
      />
    );
  })();

  return (
    <aside
      className={cx(
        "relative flex h-dvh flex-col",
        fullscreen && "fixed inset-0 z-[90]",
        // Overlay: float over the main content (fixed to the right edge) instead of taking flex space.
        !fullscreen &&
          overlay &&
          "fixed inset-y-0 right-0 z-50 max-w-[100vw] shadow-2xl motion-safe:animate-[slideInRight_150ms_ease-out]",
        !overlay && "shrink-0",
      )}
      style={{
        width: fullscreen
          ? "100vw"
          : overlay
            ? `min(${width}px, calc(100vw - 48px))`
            : width,
        background: "var(--app-bg)",
        borderLeft: "1px solid var(--c-border)",
      }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          draggingRef.current = overlay ? "overlay" : "normal";
          document.body.style.userSelect = "none";
        }}
        className="absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize"
        title="Drag to resize"
      />

      {/* Header */}
      <div
        className="relative z-30 flex items-center gap-2 px-2 py-2"
        style={{
          borderBottom: "1px solid var(--c-border)",
          background: "var(--sidebar-bg)",
        }}
      >
        <Terminal
          className="ml-1 size-4 shrink-0"
          style={{ color: "var(--c-text-secondary)" }}
        />

        {/* Session tabs */}
        {showTabStrip && <div
          className={cx(
            "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-md",
            tabDropActive && "outline outline-2 outline-dashed",
          )}
          style={
            tabDropActive
              ? {
                  outlineColor: "var(--brand)",
                  background:
                    "color-mix(in srgb, var(--brand) 10%, transparent)",
                }
              : tabAcrylic
                ? {
                    background: "color-mix(in srgb, var(--surface) 68%, transparent)",
                    backdropFilter: "blur(14px)",
                  }
                : undefined
          }
        >
          {tabDropActive && (
            <span
              className="pointer-events-none flex shrink-0 items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs"
              style={{ borderColor: "var(--brand)", color: "var(--brand)" }}
            >
              <Plus className="size-3" /> drop here
            </span>
          )}
          {/* Floated sessions live only as widgets — exclude them from the dock tab strip. */}
          {orderedSessions
            .filter((s) => !floatingIds.has(s.id))
            .map((s) => {
              const active = s.id === activeId;
              const renaming = renamingId === s.id;
              const isAgent = s.kind === "agent";
              return (
                <div
                  key={s.id}
                  draggable={!renaming}
                  onDragStart={(e) => {
                    // Close / pop-out / env on the tab must not start a drag (that cancels click).
                    if (
                      (e.target as HTMLElement | null)?.closest?.(
                        "[data-no-drag]",
                      )
                    ) {
                      e.preventDefault();
                      return;
                    }
                    dragTab.current = s.id;
                    setDraggingTabId(s.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", s.id);
                    try {
                      e.dataTransfer.setData(
                        "application/x-coretex-term",
                        s.id,
                      );
                    } catch {
                      /* IE */
                    }
                  }}
                  onDragEnd={() => {
                    clearDrag();
                  }}
                  onDragOver={(e) => {
                    if (dragTab.current && dragTab.current !== s.id)
                      e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragTab.current) reorderTab(dragTab.current, s.id);
                    clearDrag();
                  }}
                  onClick={() => setActiveId(s.id)}
                  onDoubleClick={() => {
                    setRenamingId(s.id);
                    setRenameValue(nameOf(s));
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCtxMenu({ id: s.id, x: e.clientX, y: e.clientY });
                  }}
                  className={cx(
                    "group flex min-w-0 cursor-grab items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-xs transition active:cursor-grabbing",
                    tabWidthMode === "equal" && "basis-28 flex-1",
                    tabWidthMode === "title" && "shrink-0",
                    tabWidthMode === "compact" && "w-24 shrink-0",
                    active ? "" : "hover:bg-[var(--surface-2)]",
                  )}
                  style={{
                    background: active ? "var(--surface)" : undefined,
                    color: active
                      ? "var(--c-text-primary)"
                      : "var(--c-text-secondary)",
                    // Selected = a clean "badge" tab (filled surface + soft brand ring); the
                    // colored dot carries the per-terminal color. No leading color line.
                    border: active
                      ? "1px solid var(--c-border)"
                      : "1px solid transparent",
                    boxShadow: active
                      ? "inset 0 0 0 1px color-mix(in srgb, var(--brand) 26%, transparent)"
                      : undefined,
                  }}
                >
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: colorOf(s) }}
                  />
                  {isAgent && (
                    <span
                      className="shrink-0 rounded px-1 text-[9px] font-bold uppercase"
                      style={{
                        background:
                          "color-mix(in srgb, var(--brand) 22%, transparent)",
                        color: "var(--brand-secondary)",
                      }}
                      title="Agent console (read-only)"
                    >
                      AI
                    </span>
                  )}
                  {renaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        else if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={commitRename}
                      className="w-24 rounded bg-transparent px-1 text-xs outline-none"
                      style={{
                        color: "var(--c-text-primary)",
                        border: "1px solid var(--brand)",
                      }}
                    />
                  ) : (
                    <span
                      className={cx(
                        "min-w-0 truncate",
                        tabWidthMode === "title" && "max-w-32",
                      )}
                    >
                      {nameOf(s)}
                    </span>
                  )}
                  {/* ⓘ environment eye — buddy's probed view of this shell. */}
                  {s.kind !== "agent" && !s.readOnly && (
                    <span
                      data-no-drag
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="shrink-0 opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
                    >
                      <TerminalEnvTooltip
                        env={state.buddy[s.id]?.env ?? undefined}
                        probing={state.buddy[s.id]?.probing}
                        onRefresh={() => actions.buddyProbe(s.id)}
                        size={13}
                      />
                    </span>
                  )}
                  <span
                    data-no-drag
                    role="button"
                    tabIndex={-1}
                    title="Pop out as widget"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFloatingIds((prev) => {
                        const n = new Set(prev);
                        n.add(s.id);
                        return n;
                      });
                      bringToFront(s.id);
                    }}
                    className="rounded p-0.5 opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
                  >
                    <Maximize01 className="size-3" />
                  </span>
                  <span
                    data-no-drag
                    role="button"
                    tabIndex={-1}
                    title="Close terminal"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      killTerminal(s.id);
                    }}
                    className="rounded p-0.5 opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
                  >
                    <XClose className="size-3" />
                  </span>
                </div>
              );
            })}
        </div>}

        {!showTabStrip && <div className="min-w-0 flex-1" />}

        {/* Controls */}
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Layout */}
          <div className="relative">
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setShowLayouts((v) => !v);
                setShowShells(false);
              }}
              title={`Layout: ${layout.label}`}
              className="rounded-md p-1.5 transition hover:bg-[var(--surface-2)]"
              style={{
                color: showLayouts
                  ? "var(--c-text-primary)"
                  : "var(--c-text-secondary)",
              }}
            >
              <Grid01 className="size-4" />
            </button>
            {showLayouts && (
              <div
                ref={layoutsMenuRef}
                className="absolute right-0 top-full z-40 mt-1 w-52 rounded-lg p-2 shadow-xl"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--c-border)",
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <p
                  className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: "var(--c-text-muted)" }}
                >
                  Layout
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {LAYOUTS.map((l, i) => {
                    const active = i === layoutIdx;
                    return (
                      <button
                        key={l.label}
                        type="button"
                        title={l.label}
                        onClick={() => {
                          setLayoutIdx(i);
                          setShowLayouts(false);
                        }}
                        className={cx(
                          "flex flex-col items-center gap-1.5 rounded-lg px-1.5 py-2 transition",
                          active ? "" : "hover:bg-[var(--surface-2)]",
                        )}
                        style={
                          active
                            ? { background: "var(--brand)", color: "#fff" }
                            : { color: "var(--c-text-secondary)" }
                        }
                      >
                        <LayoutPreview
                          rows={l.rows}
                          cols={l.cols}
                          active={active}
                        />
                        <span
                          className={cx(
                            "text-center text-[10px] font-medium leading-tight",
                            active ? "text-white" : "text-tertiary",
                          )}
                        >
                          {l.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* New terminal */}
          <div className="relative">
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setShowShells((v) => !v);
                setShowLayouts(false);
              }}
              title="New terminal"
              className="rounded-md p-1.5 transition hover:bg-[var(--surface-2)]"
              style={{ color: "var(--c-text-secondary)" }}
            >
              <Plus className="size-4" />
            </button>
            {showShells && (
              <div
                ref={shellsMenuRef}
                className="absolute right-0 top-full z-40 mt-1 w-48 rounded-lg p-1 shadow-xl"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--c-border)",
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {shellOptions.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => newTerminal(o)}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-secondary transition hover:bg-[var(--surface-2)]"
                  >
                    <Terminal className="size-3.5 text-quaternary" />
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeIsShell && (
            <button
              type="button"
              onClick={() => setBlocksOpen((v) => !v)}
              aria-pressed={blocksOpen}
              title={blocksOpen ? "Hide command blocks" : "Show command blocks"}
              className="rounded-md p-1.5 transition hover:bg-[var(--surface-2)]"
              style={{
                color: blocksOpen ? "var(--brand)" : "var(--c-text-secondary)",
              }}
            >
              <LayoutAlt01 className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? "Dock to side" : "Full page"}
            className="rounded-md p-1.5 transition hover:bg-[var(--surface-2)]"
            style={{
              color: fullscreen
                ? "var(--c-text-primary)"
                : "var(--c-text-secondary)",
            }}
          >
            {fullscreen ? (
              <Minimize01 className="size-4" />
            ) : (
              <Maximize01 className="size-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Hide terminal dock"
            aria-label="Hide terminal dock"
            className="rounded-md p-1.5 transition hover:bg-[var(--surface-2)]"
            style={{ color: "var(--c-text-secondary)" }}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Terminal area + optional Command Blocks side panel. */}
      <div className="flex min-h-0 flex-1">
        {/* Terminal area — drag tabs here for Windows-style snap (left / right / top / bottom / float). */}
        <div
          ref={paneRef}
          className="relative min-h-0 flex-1"
          style={{ background: "var(--surface)" }}
          onDragOver={(e) => {
            if (!dragTab.current && !draggingTabId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const rect = paneRef.current?.getBoundingClientRect();
            if (!rect) return;
            setSnapHover(
              snapZoneFromPoint(
                e.clientX - rect.left,
                e.clientY - rect.top,
                rect.width,
                rect.height,
              ),
            );
          }}
          onDragLeave={(e) => {
            // Only clear when leaving the pane itself (not entering a child).
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setSnapHover(null);
          }}
          onDrop={(e) => {
            const id =
              dragTab.current ||
              draggingTabId ||
              e.dataTransfer.getData("application/x-coretex-term") ||
              e.dataTransfer.getData("text/plain");
            if (!id) return;
            e.preventDefault();
            e.stopPropagation();
            const zone =
              snapHover ??
              (() => {
                const rect = paneRef.current?.getBoundingClientRect();
                if (!rect) return "center" as SnapZone;
                return snapZoneFromPoint(
                  e.clientX - rect.left,
                  e.clientY - rect.top,
                  rect.width,
                  rect.height,
                );
              })();
            applySnap(id, zone);
            clearDrag();
          }}
        >
          {draggingTabId && snapHover && <SnapOverlay zone={snapHover} />}
          {draggingTabId && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center pt-2">
              <span
                className="rounded-md px-3 py-1 text-[11px] font-medium shadow-md"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--c-border)",
                  color: "var(--c-text-secondary)",
                }}
              >
                {snapHover === "float"
                  ? "Release to pop out as widget"
                  : snapHover === "left"
                    ? "Snap left"
                    : snapHover === "right"
                      ? "Snap right"
                      : snapHover === "top"
                        ? "Snap above"
                        : snapHover === "bottom"
                          ? "Snap below"
                          : "Drop to place · drag tab strip to reorder"}
              </span>
            </div>
          )}
          {sessions.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Terminal className="size-7 text-quaternary" />
              <p className="text-sm text-tertiary">No terminals open.</p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowShells(true);
                }}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
                style={{ background: "var(--brand)" }}
              >
                New terminal
              </button>
            </div>
          ) : (
            <div
              className="absolute inset-0 grid gap-px"
              style={{
                gridTemplateRows: `repeat(${isGrid ? layout.rows : 1}, minmax(0, 1fr))`,
                gridTemplateColumns: `repeat(${isGrid ? layout.cols : 1}, minmax(0, 1fr))`,
                background: "var(--c-border)",
              }}
            >
              {gridSessions.map((s) => {
                const visible = visibleIds.has(s.id);
                const isActive = s.id === activeId;
                const visibleList = gridSessions.filter((x) =>
                  visibleIds.has(x.id),
                );
                const paneSlot = visibleList.findIndex((x) => x.id === s.id);
                const updateHoverFromPane = (
                  clientX: number,
                  clientY: number,
                ) => {
                  const rect = paneRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setSnapHover(
                    snapZoneFromPoint(
                      clientX - rect.left,
                      clientY - rect.top,
                      rect.width,
                      rect.height,
                    ),
                  );
                };
                return (
                  <div
                    key={s.id}
                    onMouseDown={() => setActiveId(s.id)}
                    onDragOver={(e) => {
                      if (!draggingTabId || !visible || paneSlot < 0) return;
                      e.preventDefault();
                      e.stopPropagation();
                      updateHoverFromPane(e.clientX, e.clientY);
                    }}
                    onDrop={(e) => {
                      if (!draggingTabId || !visible || paneSlot < 0) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const id = dragTab.current || draggingTabId;
                      if (!id) return;
                      const rect = paneRef.current?.getBoundingClientRect();
                      const zone = rect
                        ? snapZoneFromPoint(
                            e.clientX - rect.left,
                            e.clientY - rect.top,
                            rect.width,
                            rect.height,
                          )
                        : "center";
                      // Edge of the dock → Windows snap; center of a pane → swap into that slot.
                      if (zone === "center") applyCellDrop(id, paneSlot);
                      else applySnap(id, zone);
                      clearDrag();
                    }}
                    className="relative overflow-hidden"
                    style={{
                      background: "var(--surface)",
                      ...(visible
                        ? {}
                        : {
                            position: "absolute",
                            inset: 0,
                            visibility: "hidden",
                            zIndex: -1,
                          }),
                      ...(visible && isGrid && isActive
                        ? {
                            outline: `2px solid ${colorOf(s)}`,
                            outlineOffset: "-2px",
                          }
                        : {}),
                      ...(visible && draggingTabId && draggingTabId !== s.id
                        ? {
                            outline:
                              "1px dashed color-mix(in srgb, var(--brand) 50%, transparent)",
                            outlineOffset: "-1px",
                          }
                        : {}),
                    }}
                  >
                    <XtermTerm
                      sessionId={s.id}
                      client={client}
                      actions={actions}
                      dark={theme.resolved === "dark"}
                      scheme={schemeFor(s)}
                      readOnly={s.readOnly}
                      className="size-full p-1"
                      onFocus={() => setActiveId(s.id)}
                    />
                  </div>
                );
              })}
              {/* Empty grid cells → quick new-terminal affordance + drop target. */}
              {Array.from({ length: emptyCells }).map((_, i) => {
                const paneSlot =
                  gridSessions.filter((x) => visibleIds.has(x.id)).length + i;
                return (
                  <div
                    key={`empty-${i}`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onDragOver={(e) => {
                      if (!draggingTabId) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = paneRef.current?.getBoundingClientRect();
                      if (rect)
                        setSnapHover(
                          snapZoneFromPoint(
                            e.clientX - rect.left,
                            e.clientY - rect.top,
                            rect.width,
                            rect.height,
                          ),
                        );
                    }}
                    onDrop={(e) => {
                      if (!draggingTabId) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const id = dragTab.current || draggingTabId;
                      if (!id) return;
                      const rect = paneRef.current?.getBoundingClientRect();
                      const zone = rect
                        ? snapZoneFromPoint(
                            e.clientX - rect.left,
                            e.clientY - rect.top,
                            rect.width,
                            rect.height,
                          )
                        : "center";
                      if (zone === "center") applyCellDrop(id, paneSlot);
                      else applySnap(id, zone);
                      clearDrag();
                    }}
                    className="flex flex-col items-center justify-center gap-2 p-3"
                    style={{
                      background: "var(--surface)",
                      ...(draggingTabId
                        ? {
                            outline:
                              "1px dashed color-mix(in srgb, var(--brand) 50%, transparent)",
                            outlineOffset: "-1px",
                          }
                        : {}),
                    }}
                  >
                    {addingCellIdx === i ? (
                      // Inline shell picker — appears IN the clicked cell, not the top-right toolbar.
                      <div
                        className="w-full max-w-[220px] overflow-hidden rounded-lg p-1 shadow-lg"
                        style={{
                          background: "var(--surface)",
                          border: "1px solid var(--c-border)",
                        }}
                      >
                        <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-quaternary">
                          New terminal
                        </p>
                        {shellOptions.map((o) => (
                          <button
                            key={o.label}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              newTerminal(o);
                              setAddingCellIdx(null);
                            }}
                            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-secondary transition hover:bg-[var(--surface-2)]"
                          >
                            <Terminal className="size-3.5 text-quaternary" />
                            {o.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddingCellIdx(null);
                          }}
                          className="mt-0.5 w-full rounded-md px-2.5 py-1 text-left text-xs text-quaternary transition hover:bg-[var(--surface-2)]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowShells(false);
                          setAddingCellIdx(i);
                        }}
                        className="flex flex-col items-center gap-1 text-xs text-quaternary transition hover:text-tertiary"
                      >
                        <Plus className="size-5" />
                        {draggingTabId ? "Drop tab here" : "New terminal"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Command Blocks side panel — shell-integration block model for the active shell. */}
        {blocksOpen && activeIsShell && activeId && (
          <div className="w-[340px] shrink-0">
            <CommandBlocksPanel
              blocks={state.blocks[activeId]}
              onClose={() => setBlocksOpen(false)}
            />
          </div>
        )}

        {/* Terminal Buddy bar (side placement) — a vertical strip on the right of the
                active pane when buddyBarPosition === 'side'. Same wiring as the bottom bar. */}
        {buddySide && buddyBar && (
          <div
            className="flex w-[360px] shrink-0 flex-col"
            style={{
              borderLeft: "1px solid var(--c-border)",
              background: "var(--app-bg)",
            }}
          >
            {buddyBar}
          </div>
        )}
      </div>

      {/* Terminal Buddy bar (bottom placement, default) — docked at the bottom of the
                active pane. Drives the live probe + engine for the active shell session.
                Hidden for read-only agent consoles and when the buddy is disabled in settings. */}
      {!buddySide && buddyBar}

      {/* Per-tab context menu (rename / color / close) */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 w-44 rounded-lg p-2 shadow-xl"
          style={{
            left: ctxMenu.x,
            top: ctxMenu.y,
            background: "var(--surface)",
            border: "1px solid var(--c-border)",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              const s = sessions.find((x) => x.id === ctxMenu.id);
              if (s) {
                setRenamingId(ctxMenu.id);
                setRenameValue(nameOf(s));
              }
              setCtxMenu(null);
            }}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-secondary transition hover:bg-[var(--surface-2)]"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              setFloatingIds((prev) => {
                const n = new Set(prev);
                if (n.has(ctxMenu.id)) n.delete(ctxMenu.id);
                else n.add(ctxMenu.id);
                return n;
              });
              setCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-secondary transition hover:bg-[var(--surface-2)]"
          >
            {floatingIds.has(ctxMenu.id) ? (
              <Minimize01 className="size-3.5" />
            ) : (
              <Maximize01 className="size-3.5" />
            )}
            {floatingIds.has(ctxMenu.id) ? "Dock back" : "Pop out"}
          </button>
          <button
            type="button"
            onClick={() => exportLog(ctxMenu.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-secondary transition hover:bg-[var(--surface-2)]"
          >
            <Download01 className="size-3.5" />
            Export log…
          </button>

          <p
            className="mt-1.5 mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--c-text-muted)" }}
          >
            Color
          </p>
          <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5">
            <button
              type="button"
              title="None"
              onClick={() => {
                setTermMeta(ctxMenu.id, { color: undefined });
                setCtxMenu(null);
              }}
              className="flex size-5 items-center justify-center rounded-full border"
              style={{ borderColor: "var(--c-border)" }}
            >
              <XClose className="size-3 text-quaternary" />
            </button>
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.name}
                onClick={() => {
                  setTermMeta(ctxMenu.id, { color: c.value });
                  setCtxMenu(null);
                }}
                className="size-5 rounded-full transition hover:scale-110"
                style={{ background: c.value }}
              />
            ))}
          </div>

          {/* Per-terminal color scheme (overrides the global theme for this one terminal) */}
          {schemes.length > 0 && (
            <>
              <p
                className="mt-1 mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: "var(--c-text-muted)" }}
              >
                Color scheme
              </p>
              <div className="max-h-40 overflow-y-auto px-1">
                <button
                  type="button"
                  onClick={() => {
                    setTermMeta(ctxMenu.id, { schemeName: undefined });
                    setCtxMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition hover:bg-[var(--surface-2)]"
                  style={{
                    color: !meta[ctxMenu.id]?.schemeName
                      ? "var(--c-text-primary)"
                      : "var(--c-text-secondary)",
                  }}
                >
                  <span
                    className="size-3 shrink-0 rounded-full border"
                    style={{ borderColor: "var(--c-border)" }}
                  />
                  Default (theme)
                </button>
                {schemes.map((cs) => (
                  <button
                    key={cs.name}
                    type="button"
                    onClick={() => {
                      setTermMeta(ctxMenu.id, { schemeName: cs.name });
                      setCtxMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition hover:bg-[var(--surface-2)]"
                    style={{
                      color:
                        meta[ctxMenu.id]?.schemeName === cs.name
                          ? "var(--c-text-primary)"
                          : "var(--c-text-secondary)",
                    }}
                  >
                    <span
                      className="flex size-3 shrink-0 overflow-hidden rounded-full"
                      style={{
                        background: cs.background,
                        border: "1px solid var(--c-border)",
                      }}
                    >
                      <span
                        className="h-full w-1/2"
                        style={{ background: cs.blue }}
                      />
                    </span>
                    <span className="truncate">{cs.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              killTerminal(ctxMenu.id);
            }}
            className="mt-1 flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-[var(--surface-2)]"
            style={{ color: "var(--c-error, #ef4444)" }}
          >
            Close terminal
          </button>
        </div>
      )}

      {/* Popped-out terminals: draggable sticky windows hosting the live session. */}
      {sessions
        .filter((s) => floatingIds.has(s.id))
        .map((s, i) => (
          <FloatingTerminal
            key={s.id}
            name={nameOf(s)}
            color={colorOf(s)}
            index={i}
            z={zOrder[s.id] ?? 60}
            onFocus={() => bringToFront(s.id)}
            onNearTabs={setTabDropActive}
            onDock={() => {
              setTabDropActive(false);
              setFloatingIds((prev) => {
                const n = new Set(prev);
                n.delete(s.id);
                return n;
              });
            }}
            onKill={() => {
              killTerminal(s.id);
            }}
            onRename={(value) => setTermMeta(s.id, { name: value })}
            dragId={s.id}
          >
            <XtermTerm
              sessionId={s.id}
              client={client}
              actions={actions}
              dark={theme.resolved === "dark"}
              scheme={schemeFor(s)}
              readOnly={s.readOnly}
              className="size-full p-1"
              onFocus={() => setActiveId(s.id)}
            />
          </FloatingTerminal>
        ))}
    </aside>
  );
};

// ---- A popped-out terminal: a draggable, sticky window hosting a live session ----
const FloatingTerminal = ({
  name,
  color,
  index,
  z,
  dragId,
  onDock,
  onKill,
  onFocus,
  onRename,
  onNearTabs,
  children,
}: {
  name: string;
  color: string;
  index: number;
  z: number;
  dragId: string;
  onDock: () => void;
  onKill: () => void;
  onFocus: () => void;
  onRename: (value: string) => void;
  onNearTabs: (near: boolean) => void;
  children: ReactNode;
}) => {
  const [pos, setPos] = useState({ x: 140 + index * 36, y: 120 + index * 36 });
  const [size, setSize] = useState({ w: 520, h: 340 });
  const posRef = useRef(pos);
  const sizeRef = useRef(size);
  posRef.current = pos;
  sizeRef.current = size;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);
  const MINW = 320,
    MINH = 200;

  /**
   * Attach move/up listeners only for the active gesture on THIS window.
   * Avoids the shared permanent window listeners that made one floater drive another
   * (every instance heard every mousemove while a sibling was resizing).
   */
  const bindGesture = (
    onMove: (e: MouseEvent) => void,
    onUp: (e: MouseEvent) => void,
  ): void => {
    const move = (e: MouseEvent): void => onMove(e);
    const up = (e: MouseEvent): void => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      onUp(e);
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const startMove = (e: React.MouseEvent): void => {
    if (renaming) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    const dx = e.clientX - posRef.current.x;
    const dy = e.clientY - posRef.current.y;
    bindGesture(
      (ev) => {
        setPos({
          x: Math.max(0, ev.clientX - dx),
          y: Math.max(0, ev.clientY - dy),
        });
        onNearTabs(ev.clientY < 120);
      },
      (ev) => {
        if (ev.clientY < 120) onDock();
        onNearTabs(false);
      },
    );
  };

  /** Bottom-right: grow/shrink while keeping top-left fixed. */
  const startResizeBR = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    const ox = e.clientX;
    const oy = e.clientY;
    const { w: sw, h: sh } = sizeRef.current;
    bindGesture(
      (ev) => {
        setSize({
          w: Math.max(MINW, sw + (ev.clientX - ox)),
          h: Math.max(MINH, sh + (ev.clientY - oy)),
        });
      },
      () => undefined,
    );
  };

  /** Bottom-left: grow/shrink while keeping top-right fixed (so only this corner moves). */
  const startResizeBL = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    const ox = e.clientX;
    const oy = e.clientY;
    const { x: sx, y: sy } = posRef.current;
    const { w: sw, h: sh } = sizeRef.current;
    const anchorRight = sx + sw;
    bindGesture(
      (ev) => {
        const w = Math.max(MINW, sw + (ox - ev.clientX));
        const h = Math.max(MINH, sh + (ev.clientY - oy));
        setSize({ w, h });
        setPos({ x: anchorRight - w, y: sy });
      },
      () => undefined,
    );
  };

  const commitRename = () => {
    onRename(renameValue.trim() || name);
    setRenaming(false);
  };

  return (
    <div
      className="fixed flex flex-col overflow-hidden rounded-xl shadow-2xl"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        minWidth: MINW,
        minHeight: MINH,
        zIndex: z,
        background: "var(--app-bg)",
        border: "1px solid var(--c-border)",
      }}
      onMouseDownCapture={onFocus}
    >
      <div
        onMouseDown={startMove}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className="flex shrink-0 cursor-move items-center gap-2 px-2.5 py-1.5"
        style={{
          background: "var(--sidebar-bg)",
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: color }}
        />
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setRenameValue(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={commitRename}
            className="min-w-0 flex-1 rounded bg-transparent px-1 text-xs outline-none"
            style={{
              color: "var(--c-text-primary)",
              border: "1px solid var(--brand)",
            }}
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-xs font-medium"
            style={{ color: "var(--c-text-secondary)" }}
          >
            {name}
          </span>
        )}
        <button
          type="button"
          title="Dock back"
          onClick={onDock}
          onMouseDown={(e) => e.stopPropagation()}
          className="rounded p-1 text-quaternary hover:bg-[var(--surface-2)]"
        >
          <Minimize01 className="size-3.5" />
        </button>
        <button
          type="button"
          title="Close terminal"
          onClick={onKill}
          onMouseDown={(e) => e.stopPropagation()}
          className="rounded p-1 text-quaternary hover:bg-[var(--surface-2)]"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1" style={{ background: "var(--surface)" }}>
        {children}
      </div>

      {/* Explicit corner grips — CSS resize:both only handled SE and fought the BL handle / sibling windows. */}
      <span
        onMouseDown={startResizeBL}
        title="Resize"
        className="absolute bottom-0 left-0 z-10 size-4 cursor-nesw-resize"
        style={{
          backgroundImage:
            "linear-gradient(45deg, transparent 55%, var(--c-text-muted) 55%, var(--c-text-muted) 62%, transparent 62%, transparent 72%, var(--c-text-muted) 72%, var(--c-text-muted) 79%, transparent 79%)",
        }}
      />
      <span
        onMouseDown={startResizeBR}
        title="Resize"
        className="absolute bottom-0 right-0 z-10 size-4 cursor-nwse-resize"
        style={{
          backgroundImage:
            "linear-gradient(-45deg, transparent 55%, var(--c-text-muted) 55%, var(--c-text-muted) 62%, transparent 62%, transparent 72%, var(--c-text-muted) 72%, var(--c-text-muted) 79%, transparent 79%)",
        }}
      />

      {/* Right-click titlebar context menu */}
      {menu && (
        <>
          <div
            className="fixed inset-0 z-[1]"
            onMouseDown={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-[2] w-52 rounded-lg p-1.5 shadow-xl"
            style={{
              left: menu.x,
              top: menu.y,
              background: "var(--surface)",
              border: "1px solid var(--c-border)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
              style={{ color: "var(--c-text-muted)" }}
            >
              <Maximize01 className="size-3.5" /> Pop out as widget
              <span className="ml-auto text-[10px] uppercase">current</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setRenameValue(name);
                setRenaming(true);
                setMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-secondary transition hover:bg-[var(--surface-2)]"
            >
              <Edit01 className="size-3.5" /> Rename
            </button>
            <button
              type="button"
              onClick={() => {
                setMenu(null);
                onDock();
              }}
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
