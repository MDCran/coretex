"use client";

// Coretex — Agents canvas. A Figma-style whiteboard of the agent fleet: agents are
// draggable nodes, wired to teammates they share a project with. Pan (Hand tool /
// Space-drag / middle-drag / wheel), zoom (Ctrl/Cmd+wheel to cursor, or the +/- tools),
// fit, auto-arrange, marquee-free selection, right-click menus, and a Learn panel that
// documents every tool + navigation gesture. Card positions persist through the
// Agent Canvas presentation-state contract; runtime actions remain explicit.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
    Activity, Clock, Coins01, Cursor04, Edit01, Grid01, Hand, HelpCircle, Maximize01,
    Minimize01, PauseCircle, Play, RefreshCcw01, Settings01, Share07, Terminal, Trash01, UploadCloud02,
} from "@untitledui/icons";
import type { AgentCanvasCardSettings, AgentRole, AgentState, ClaudeExecutionMode, PermissionMode, Task, VisualIdentity } from "@repo/coretex/types";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RichSelect } from "@/components/base/select/rich-select";
import { Toggle } from "@/components/base/toggle/toggle";
import { cx } from "@/utils/cx";
import { AGENT_STATUS_COLOR, formatTokens, formatUSD, modelAvailability, roleColor, type CoretexActions, type CoretexState } from "../use-coretex";
import { providerLabel, roleLabel, statusLabel } from "../labels";
import { IdentityAvatar } from "../ui/identity-avatar";
import { useContextMenu, type MenuItem } from "../ui/context-menu";
import { PermissionModeSelect, PERMISSION_MODES } from "../ui/permission-mode-select";
import { ClaudeTierBadge, ClaudeTierSelect } from "../ui/claude-tier-badge";
import { CLAUDE_TIERS, CLAUDE_TIER_ORDER } from "../claude-tiers";
import { IconPicker } from "../ui/icon-picker";
import { ColorPicker } from "../ui/color-picker";
import type { NavTarget } from "../nav";
import {
    CANVAS_PANEL_STYLE,
    CanvasCommandBar,
    CanvasGuideItem,
    CanvasGuidePanel,
    CanvasInspectorPanel,
    CanvasToolButton,
    CanvasToolRail,
    CanvasUtilityButton,
    CanvasZoomControls,
} from "./shared-canvas";

interface XY { x: number; y: number }
interface Transform { x: number; y: number; k: number }

const NODE_W = 224;
const NODE_H = 148;
const POS_KEY = "coretex-agents-canvas-pos";
const MIN_K = 0.25;
const MAX_K = 2.5;
const GRID = 24; // matches the background dot spacing
const ALIGN_THRESHOLD = 8; // screen px within which node edges/centers snap to neighbors
const AGENT_ROLES: AgentRole[] = ["orchestrator", "planner", "researcher", "developer", "reviewer", "writer", "analyst", "devops", "qa", "custom"];

const STATUS_DOT: Record<string, string> = {
    gray: "var(--c-text-muted)", brand: "var(--brand)", success: "#22c55e", warning: "#f59e0b", error: "#ef4444",
};
const DEFAULT_CARD_SETTINGS: AgentCanvasCardSettings = { density: "detailed", accentSource: "identity", showModel: true, showMetrics: true, pinned: false };
const BADGE_TONE_COLOR: Record<string, string> = {
    gray: "#667085", brand: "var(--brand)", blue: "#2970ff", sky: "#0ba5ec", indigo: "#6172f3", purple: "#7a5af8",
    pink: "#ee46bc", orange: "#ef6820", warning: "#f79009", success: "#17b26a", error: "#f04438", slate: "#475467",
};

function canvasCardSettings(state: CoretexState, agentId: string): AgentCanvasCardSettings {
    return { ...DEFAULT_CARD_SETTINGS, ...(state.agentCanvas?.cards?.[agentId] ?? {}) };
}

function canvasCardAccent(agent: AgentState, settings: AgentCanvasCardSettings, statusColor: string, state: CoretexState): string {
    if (settings.accentSource === "custom" && settings.customColor) return settings.customColor;
    if (settings.accentSource === "status") return statusColor;
    if (settings.accentSource === "role") return BADGE_TONE_COLOR[roleColor(agent.config.role, state.settings)] ?? "var(--brand)";
    return agent.config.identity?.themeColor || "var(--brand)";
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

/** Project ids an agent is tied to (project-id tags + the project of any task it owns). */
function agentProjectIds(agent: AgentState, tasks: Task[], projectIds: Set<string>): string[] {
    const out = new Set<string>();
    agent.config.tags?.forEach((t) => { if (projectIds.has(t)) out.add(t); });
    tasks.forEach((t) => { if (t.projectId && (t.assignedAgentId === agent.id || t.assignedAgentIds?.includes(agent.id) || t.id === agent.currentTaskId)) out.add(t.projectId); });
    return [...out];
}

function loadLegacyPositions(): Record<string, XY> {
    if (typeof window === "undefined") return {};
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(POS_KEY) ?? "{}");
        return parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, XY>
            : {};
    } catch {
        return {};
    }
}

export function deriveAgentCanvasLayout(agentIds: string[], stored: Record<string, XY>): Record<string, XY> {
    const liveIds = new Set(agentIds);
    const positions: Record<string, XY> = Object.fromEntries(
        Object.entries(stored).filter(([id, point]) => liveIds.has(id) && point != null && typeof point === "object" && Number.isFinite(point.x) && Number.isFinite(point.y)),
    );
    const columns = Math.max(1, Math.ceil(Math.sqrt(agentIds.length)));
    const occupied = () => Object.values(positions);
    let candidateIndex = 0;

    for (const id of agentIds) {
        if (positions[id]) continue;
        let candidate: XY;
        do {
            candidate = {
                x: (candidateIndex % columns) * (NODE_W + 72),
                y: Math.floor(candidateIndex / columns) * (NODE_H + 64),
            };
            candidateIndex += 1;
        } while (occupied().some((point) => Math.abs(point.x - candidate.x) < NODE_W + 36 && Math.abs(point.y - candidate.y) < NODE_H + 32));
        positions[id] = candidate;
    }
    return positions;
}

export function arrangeAgentCanvas(agentIds: string[], pinnedIds: ReadonlySet<string>, current: Record<string, XY>): Record<string, XY> {
    const pinned = Object.fromEntries(agentIds.filter((id) => pinnedIds.has(id) && current[id]).map((id) => [id, current[id]]));
    return deriveAgentCanvasLayout(agentIds, pinned);
}

export interface AgentsCanvasControls {
    autoArrange: () => void;
    fit: () => void;
    toggleConnections: () => void;
}

interface AgentsCanvasProps {
    state: CoretexState;
    actions: CoretexActions;
    onNavigate?: (target: NavTarget) => void;
    onEditAgent?: (agent: AgentState) => void;
    onInspectorOpenChange?: (open: boolean) => void;
}

export const AgentsCanvas = forwardRef<AgentsCanvasControls, AgentsCanvasProps>(function AgentsCanvas(
    { state, actions, onNavigate, onEditAgent, onInspectorOpenChange },
    controlsRef,
) {
    const agents = state.agents ?? [];
    const [transform, setTransform] = useState<Transform>({ x: 40, y: 40, k: 1 });
    const [stored, setStored] = useState<Record<string, XY>>(() => state.agentCanvas?.positions ?? {});
    const [selected, setSelected] = useState<string | null>(null);
    const [tool, setTool] = useState<"select" | "hand">("select");
    const [showHelp, setShowHelp] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [spaceDown, setSpaceDown] = useState(false);
    const [panning, setPanning] = useState(false);
    // Live alignment guide lines (world coordinates) while a node is dragged near a neighbor.
    const [guides, setGuides] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });
    const containerRef = useRef<HTMLDivElement>(null);
    const ctx = useContextMenu();
    const migratedLegacy = useRef(false);
    const migrationRevision = useRef<number | null>(null);
    const serverCanvasRef = useRef(state.agentCanvas);
    serverCanvasRef.current = state.agentCanvas;
    const showConns = state.agentCanvas?.showConnections ?? true;

    // The drag gesture in flight: panning the canvas, or moving a node.
    const drag = useRef<{ mode: "pan" | "node"; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; last?: XY } | null>(null);

    useEffect(() => {
        if (state.connected) actions.requestAgentCanvas();
    }, [actions, state.connected]);

    useEffect(() => {
        if (drag.current?.mode !== "node") setStored(state.agentCanvas?.positions ?? {});
    }, [state.agentCanvas, state.agentCanvasLoaded]);

    useEffect(() => {
        if (migratedLegacy.current || !state.connected || !state.agentCanvasLoaded || agents.length === 0) return;
        migratedLegacy.current = true;
        const legacy = loadLegacyPositions();
        if (Object.keys(state.agentCanvas?.positions ?? {}).length === 0 && Object.keys(legacy).length > 0) {
            const liveIds = new Set(agents.map((agent) => agent.id));
            const validLegacy = Object.fromEntries(Object.entries(legacy).filter(([id, point]) => liveIds.has(id) && point != null && typeof point === "object" && Number.isFinite(point.x) && Number.isFinite(point.y)));
            if (Object.keys(validLegacy).length > 0) {
                setStored(validLegacy);
                migrationRevision.current = state.agentCanvas?.revision ?? 0;
                actions.setAgentCanvasLayout(validLegacy);
                return;
            }
        }
        try { window.localStorage.removeItem(POS_KEY); } catch { /* Legacy cleanup is best effort. */ }
    }, [actions, agents, state.agentCanvas?.positions, state.agentCanvas?.revision, state.agentCanvasLoaded, state.connected]);

    useEffect(() => {
        if (migrationRevision.current == null || (state.agentCanvas?.revision ?? 0) <= migrationRevision.current) return;
        if (Object.keys(state.agentCanvas?.positions ?? {}).length === 0) return;
        migrationRevision.current = null;
        try { window.localStorage.removeItem(POS_KEY); } catch { /* Legacy cleanup is best effort. */ }
    }, [state.agentCanvas?.positions, state.agentCanvas?.revision]);

    useEffect(() => {
        if (selected && !agents.some((agent) => agent.id === selected)) setSelected(null);
    }, [agents, selected]);

    // Auto-place missing agents into collision-free cells. Existing durable cards stay put.
    const layout = useMemo(() => deriveAgentCanvasLayout(agents.map((agent) => agent.id), stored), [agents, stored]);

    const projectIdSet = useMemo(() => new Set(state.projects.map((p) => p.id)), [state.projects]);
    const connections = useMemo(() => {
        const pids = new Map(agents.map((a) => [a.id, agentProjectIds(a, state.tasks, projectIdSet)]));
        const out: { a: string; b: string }[] = [];
        for (let i = 0; i < agents.length; i++) {
            for (let j = i + 1; j < agents.length; j++) {
                const A = pids.get(agents[i].id)!;
                const B = pids.get(agents[j].id)!;
                if (A.length && A.some((p) => B.includes(p))) out.push({ a: agents[i].id, b: agents[j].id });
            }
        }
        return out;
    }, [agents, state.tasks, projectIdSet]);

    // ---- zoom helpers ----
    const zoomAt = (cx0: number, cy0: number, factor: number) => {
        setTransform((t) => {
            const k = clamp(t.k * factor, MIN_K, MAX_K);
            const wx = (cx0 - t.x) / t.k;
            const wy = (cy0 - t.y) / t.k;
            return { k, x: cx0 - wx * k, y: cy0 - wy * k };
        });
    };
    const zoomButton = (dir: 1 | -1) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const cx0 = rect ? rect.width / 2 : 400;
        const cy0 = rect ? rect.height / 2 : 300;
        zoomAt(cx0, cy0, dir > 0 ? 1.2 : 1 / 1.2);
    };

    const fit = (positions: Record<string, XY> = layout) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || agents.length === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const a of agents) {
            const p = positions[a.id];
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x + NODE_W); maxY = Math.max(maxY, p.y + NODE_H);
        }
        const pad = 60;
        const w = maxX - minX + pad * 2;
        const h = maxY - minY + pad * 2;
        const k = clamp(Math.min(rect.width / w, rect.height / h), MIN_K, 1.4);
        setTransform({ k, x: rect.width / 2 - (minX + (maxX - minX) / 2) * k, y: rect.height / 2 - (minY + (maxY - minY) / 2) * k });
    };
    const resetView = () => setTransform({ x: 40, y: 40, k: 1 });
    const autoArrange = () => {
        const pinnedIds = new Set(Object.entries(state.agentCanvas?.cards ?? {}).filter(([, card]) => card.pinned).map(([id]) => id));
        const next = arrangeAgentCanvas(agents.map((agent) => agent.id), pinnedIds, layout);
        setStored(next);
        actions.setAgentCanvasLayout(next);
        window.requestAnimationFrame(() => fit(next));
    };
    const setPinned = (agentId: string, pinned: boolean) => {
        // Newly rendered cards can still be using an auto-derived coordinate.
        // Save that coordinate first so pinning survives reorders and reloads.
        if (pinned && layout[agentId]) actions.setAgentCanvasPosition(agentId, layout[agentId]);
        actions.setAgentCanvasCardSettings(agentId, { pinned });
    };

    useImperativeHandle(controlsRef, () => ({
        autoArrange,
        fit: () => fit(),
        toggleConnections: () => actions.setAgentCanvasPreferences({ showConnections: !showConns }),
    }));

    // ---- native wheel (non-passive so we can preventDefault) ----
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            // Ctrl/Cmd = zoom to cursor · Alt = fine zoom · Shift = pan sideways · plain = pan up/down.
            if (e.ctrlKey || e.metaKey) {
                zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
            } else if (e.altKey) {
                zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.05 : 1 / 1.05);
            } else {
                const dx = e.shiftKey ? e.deltaY : e.deltaX;
                const dy = e.shiftKey ? 0 : e.deltaY;
                setTransform((t) => ({ ...t, x: t.x - dx, y: t.y - dy }));
            }
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    // ---- keyboard: tools, zoom, fit, space-to-pan ----
    useEffect(() => {
        const isInteractive = (t: EventTarget | null) => {
            const el = t as HTMLElement | null;
            return !!el && Boolean(el.closest("input, textarea, select, button, a, [role='button'], [role='option'], [role='combobox'], [contenteditable='true']"));
        };
        const down = (e: KeyboardEvent) => {
            if (isInteractive(e.target)) return;
            if (e.code === "Space") { e.preventDefault(); setSpaceDown(true); return; }
            if (e.key === "v" || e.key === "V") setTool("select");
            else if (e.key === "h" || e.key === "H") setTool("hand");
            else if (e.key === "=" || e.key === "+") zoomButton(1);
            else if (e.key === "-" || e.key === "_") zoomButton(-1);
            else if (e.key === "1" && e.shiftKey) fit();
            else if (e.key === "0" && e.shiftKey) resetView();
            else if (e.key === "Escape") setSelected(null);
        };
        const up = (e: KeyboardEvent) => {
            if (e.code !== "Space") return;
            if (!isInteractive(e.target)) e.preventDefault();
            setSpaceDown(false);
        };
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layout, agents]);

    // Refs the once-bound pointer handlers read for live zoom + latest positions.
    const kRef = useRef(transform.k); kRef.current = transform.k;
    const transformK = () => kRef.current;
    const layoutRef = useRef(layout); layoutRef.current = layout;

    // ---- pointer drag (pan or node move) ----
    useEffect(() => {
        const move = (e: PointerEvent) => {
            const d = drag.current;
            if (!d) return;
            const ddx = e.clientX - d.sx;
            const ddy = e.clientY - d.sy;
            if (!d.moved && Math.abs(ddx) <= 3 && Math.abs(ddy) <= 3) return;
            d.moved = true;
            if (d.mode === "pan") {
                setTransform((t) => ({ ...t, x: d.ox + ddx, y: d.oy + ddy }));
            } else if (d.id) {
                const id = d.id;
                const rawX = d.ox + ddx / transformK();
                const rawY = d.oy + ddy / transformK();
                // Snap to grid by default; alignment with a neighbor's edge/center wins when in range.
                let x = Math.round(rawX / GRID) * GRID;
                let y = Math.round(rawY / GRID) * GRID;
                const threshold = ALIGN_THRESHOLD / transformK();
                let bestV = threshold;
                let bestH = threshold;
                let gv: number | null = null;
                let gh: number | null = null;
                for (const [oid, p] of Object.entries(layoutRef.current)) {
                    if (oid === id) continue;
                    for (const ox of [p.x, p.x + NODE_W / 2, p.x + NODE_W]) {
                        for (const off of [0, NODE_W / 2, NODE_W]) {
                            const delta = Math.abs(rawX + off - ox);
                            if (delta < bestV) { bestV = delta; x = ox - off; gv = ox; }
                        }
                    }
                    for (const oy of [p.y, p.y + NODE_H / 2, p.y + NODE_H]) {
                        for (const off of [0, NODE_H / 2, NODE_H]) {
                            const delta = Math.abs(rawY + off - oy);
                            if (delta < bestH) { bestH = delta; y = oy - off; gh = oy; }
                        }
                    }
                }
                setGuides((cur) => (cur.v === gv && cur.h === gh ? cur : { v: gv, h: gh }));
                d.last = { x, y };
                setStored((prev) => ({ ...prev, [id]: { x, y } }));
            }
        };
        const finish = (cancelled = false) => {
            const d = drag.current;
            if (d?.mode === "node" && d.moved) {
                if (cancelled) setStored(serverCanvasRef.current?.positions ?? {});
                else if (d.id && d.last) {
                    setStored({ ...(serverCanvasRef.current?.positions ?? {}), [d.id]: d.last });
                    actions.setAgentCanvasPosition(d.id, d.last);
                }
            }
            drag.current = null;
            setPanning(false);
            setGuides({ v: null, h: null });
        };
        const up = () => finish(false);
        const cancel = () => finish(true);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", cancel);
        return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); };
    }, [actions]);

    const startPan = (e: React.PointerEvent) => {
        setSelected(null);
        setPanning(true);
        drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: transform.x, oy: transform.y, moved: false };
    };
    const onBackgroundPointerDown = (e: React.PointerEvent) => {
        // Middle button, hand tool, or Space held → pan; left button in select tool → pan the empty canvas too.
        if (e.button === 0 || e.button === 1) {
            if (e.button === 1 || tool === "hand" || spaceDown || e.button === 0) startPan(e);
        }
    };
    const onNodePointerDown = (e: React.PointerEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.button !== 0 && e.button !== 1) return;
        if (tool === "hand" || spaceDown || e.button === 1) { startPan(e); return; }
        setSelected(id);
        if (state.agentCanvas?.cards?.[id]?.pinned) return;
        const p = layout[id];
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { mode: "node", id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
    };

    const nodeMenu = (a: AgentState): MenuItem[] => {
        const active = a.status === "working" || a.status === "thinking";
        const paused = a.status === "paused";
        const runtime = modelAvailability(state, a.config.provider, a.config.model);
        const permission = a.config.permissionMode ?? "ask";
        const executionMode = a.config.executionMode ?? "autonomous";
        const pinned = state.agentCanvas?.cards?.[a.id]?.pinned ?? false;
        const items: MenuItem[] = [
            { header: a.config.name },
            ...(onNavigate ? [{ key: "open", label: "Open agent", icon: Share07, onClick: () => onNavigate({ kind: "agent", id: a.id }) } as MenuItem] : []),
            paused
                ? { key: "resume", label: "Resume", icon: Play, disabled: !runtime.available, onClick: () => actions.resumeAgent(a.id) }
                : { key: "pause", label: "Pause", icon: PauseCircle, disabled: active, onClick: () => actions.pauseAgent(a.id) },
            { key: "halt", label: "Halt", icon: Trash01, danger: true, disabled: !active, onClick: () => { if (window.confirm(`Stop ${a.config.name}? Its current run will end.`)) actions.haltAgent(a.id); } },
            { separator: true },
            { key: "console", label: "Open console", icon: Terminal, onClick: () => actions.terminalCreate({ agentId: a.id, projectId: a.config.tags?.[0] }) },
            ...(onEditAgent ? [{ key: "edit", label: "Edit all settings", icon: Edit01, onClick: () => onEditAgent(a) } as MenuItem] : []),
            {
                key: "permission",
                label: "Permission mode",
                icon: Settings01,
                submenu: PERMISSION_MODES.map<MenuItem>((mode) => ({
                    key: `permission-${mode.value}`,
                    label: mode.label,
                    checked: permission === mode.value,
                    onClick: () => actions.setAgentPermissionMode(a.id, mode.value),
                })),
            },
            {
                key: "execution",
                label: "Execution mode",
                icon: Activity,
                submenu: CLAUDE_TIER_ORDER.map<MenuItem>((mode) => ({
                    key: `execution-${mode}`,
                    label: CLAUDE_TIERS[mode].label,
                    checked: executionMode === mode,
                    onClick: () => actions.updateAgent(a.id, { executionMode: mode }),
                })),
            },
            { separator: true },
            { key: "pin", label: pinned ? "Unpin card" : "Pin card", icon: Grid01, checked: pinned, onClick: () => setPinned(a.id, !pinned) },
        ];
        return items;
    };

    // Right-click on empty canvas — view controls that mirror the toolbar.
    const bgMenu = (): MenuItem[] => [
        { header: "Canvas" },
        { key: "fit", label: "Zoom to fit", icon: Maximize01, onClick: fit },
        { key: "reset", label: "Reset view", icon: RefreshCcw01, onClick: resetView },
        { key: "arrange", label: "Auto-arrange", icon: Grid01, onClick: autoArrange },
        { key: "reset-layout", label: "Reset card layout", icon: Trash01, onClick: () => actions.resetAgentCanvasLayout() },
        { separator: true },
        { key: "conns", label: showConns ? "Hide connections" : "Show connections", icon: Share07, checked: showConns, onClick: () => actions.setAgentCanvasPreferences({ showConnections: !showConns }) },
    ];

    const cursor = panning ? "grabbing" : (tool === "hand" || spaceDown) ? "grab" : "default";
    const selectedAgent = agents.find((agent) => agent.id === selected) ?? null;
    const activeCount = agents.filter((agent) => agent.status === "working" || agent.status === "thinking").length;
    const pausedCount = agents.filter((agent) => agent.status === "paused").length;
    const pinnedCount = agents.filter((agent) => canvasCardSettings(state, agent.id).pinned).length;

    useEffect(() => {
        // The empty inspector rail is still rendered at xl, so reserve its width
        // even before a card is selected.
        onInspectorOpenChange?.(!expanded);
        return () => onInspectorOpenChange?.(false);
    }, [expanded, onInspectorOpenChange]);

    return (
        <div className={cx("flex size-full min-h-[34rem] min-w-0 flex-1 flex-col gap-3", expanded && "min-h-[calc(100dvh-2rem)]")}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-tertiary" aria-label="Agent canvas summary">
                <span className="rounded-full border border-secondary bg-primary px-2.5 py-1 font-medium text-secondary">{agents.length} agents</span>
                <span className="rounded-full border border-secondary px-2.5 py-1">{activeCount} active</span>
                <span className="rounded-full border border-secondary px-2.5 py-1">{pausedCount} paused</span>
                <span className="rounded-full border border-secondary px-2.5 py-1">{connections.length} project links</span>
                {pinnedCount > 0 && <span className="rounded-full border border-secondary px-2.5 py-1">{pinnedCount} pinned</span>}
            </div>

            <div className="relative flex min-h-0 min-w-0 flex-1 gap-3">
                <div
                    ref={containerRef}
                    role="application"
                    aria-label="Agent fleet canvas"
                    tabIndex={0}
                    onPointerDown={onBackgroundPointerDown}
                    onContextMenu={(event) => { event.preventDefault(); ctx.open(event, bgMenu()); }}
                    className="relative min-h-0 min-w-0 flex-1 select-none overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                    style={{
                        cursor,
                        touchAction: "none",
                        background: "var(--surface)",
                        border: "1px solid var(--c-border)",
                        backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--c-text-muted) 34%, transparent) 1px, transparent 1.2px)",
                        backgroundSize: `${GRID * transform.k}px ${GRID * transform.k}px`,
                        backgroundPosition: `${transform.x}px ${transform.y}px`,
                    }}
                >
                    <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.k})`, willChange: "transform" }}>
                        {showConns && (
                            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} aria-hidden="true">
                                {connections.map(({ a, b }) => {
                                    const pa = layout[a];
                                    const pb = layout[b];
                                    if (!pa || !pb) return null;
                                    const ax = pa.x + NODE_W / 2, ay = pa.y + NODE_H / 2;
                                    const bx = pb.x + NODE_W / 2, by = pb.y + NODE_H / 2;
                                    const mx = (ax + bx) / 2;
                                    return <path key={`${a}-${b}`} d={`M ${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`} fill="none" stroke={selected === a || selected === b ? "var(--brand)" : "var(--c-border)"} strokeWidth={2} />;
                                })}
                            </svg>
                        )}

                        {agents.map((agent) => {
                            const point = layout[agent.id];
                            const runtime = modelAvailability(state, agent.config.provider, agent.config.model);
                            const isSelected = selected === agent.id;
                            const active = agent.status === "working" || agent.status === "thinking";
                            const statusColor = runtime.available ? (STATUS_DOT[AGENT_STATUS_COLOR[agent.status]] ?? "var(--c-text-muted)") : "var(--c-error)";
                            const card = canvasCardSettings(state, agent.id);
                            const accent = canvasCardAccent(agent, card, statusColor, state);
                            const compact = card.density === "compact";
                            return (
                                <div
                                    key={agent.id}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={isSelected}
                                    aria-label={`${agent.config.name}, ${roleLabel(agent.config.role)}, ${runtime.available ? statusLabel(agent.status) : "unavailable"}${card.pinned ? ", pinned" : ""}`}
                                    title={`${agent.config.name} · ${roleLabel(agent.config.role)} · ${providerLabel(agent.config.provider)} · ${agent.config.model}`}
                                    data-canvas-node="agent"
                                    onPointerDown={(event) => onNodePointerDown(event, agent.id)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setSelected(agent.id);
                                        }
                                    }}
                                    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setSelected(agent.id); ctx.open(event, nodeMenu(agent)); }}
                                    className={cx("absolute flex flex-col rounded-xl shadow-sm outline-none transition-[box-shadow,border-color,opacity] focus-visible:ring-2 focus-visible:ring-[var(--brand)]", compact ? "gap-1.5 p-2.5" : "gap-2.5 p-3")}
                                    style={{
                                        left: point.x,
                                        top: point.y,
                                        width: NODE_W,
                                        minHeight: compact ? 104 : NODE_H,
                                        background: "var(--surface)",
                                        border: `1px solid ${isSelected ? accent : "var(--c-border)"}`,
                                        borderTopWidth: 3,
                                        borderTopColor: accent,
                                        boxShadow: isSelected ? `0 0 0 3px color-mix(in srgb, ${accent} 24%, transparent)` : undefined,
                                        cursor: card.pinned ? "pointer" : tool === "hand" || spaceDown ? "grab" : "grab",
                                    }}
                                >
                                    <div className="flex items-start gap-2.5">
                                        <span className="relative shrink-0">
                                            <IdentityAvatar identity={agent.config.identity} name={agent.config.name} avatarUrl={agent.config.avatarUrl} size={compact ? 30 : 36} />
                                            <span className={cx("absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-[var(--surface)]", active && "animate-pulse")} style={{ background: statusColor }} aria-hidden="true" />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="line-clamp-2 break-words text-sm font-semibold leading-4 text-primary [overflow-wrap:anywhere]" title={agent.config.name}>{agent.config.name}</p>
                                            <p className="break-words text-[11px] text-tertiary [overflow-wrap:anywhere]">{roleLabel(agent.config.role)}</p>
                                        </div>
                                        {card.pinned && <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-tertiary">Pinned</span>}
                                    </div>
                                    {card.showModel && <p className="truncate text-[11px] text-quaternary" title={`${providerLabel(agent.config.provider)} · ${agent.config.model}`}>{providerLabel(agent.config.provider)} · {agent.config.model}</p>}
                                    {card.showMetrics && (
                                        <div className="flex items-center justify-between gap-2 text-[10px] text-quaternary">
                                            <span className="truncate">{runtime.available ? statusLabel(agent.status) : "Unavailable"}</span>
                                            <span className="shrink-0 tabular-nums">{agent.stepCount} steps · {formatTokens(agent.tokensUsedToday)}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {guides.v != null && <div className="pointer-events-none absolute" style={{ left: guides.v, top: -10000, width: 1, height: 20000, background: "var(--brand)", opacity: 0.6 }} aria-hidden="true" />}
                        {guides.h != null && <div className="pointer-events-none absolute" style={{ top: guides.h, left: -10000, height: 1, width: 20000, background: "var(--brand)", opacity: 0.6 }} aria-hidden="true" />}
                    </div>

                    <CanvasToolRail label="Agent canvas tools">
                        <CanvasToolButton icon={Cursor04} label="Select" description="Select an agent or drag an unpinned card" shortcut="V" active={tool === "select"} onClick={() => setTool("select")} />
                        <CanvasToolButton icon={Hand} label="Pan" description="Drag the canvas, or hold Space" shortcut="H" active={tool === "hand"} onClick={() => setTool("hand")} />
                    </CanvasToolRail>

                    <CanvasCommandBar label="Agent canvas view controls" inspectorOpen={!expanded && Boolean(selectedAgent)}>
                        <span className="whitespace-nowrap px-1.5 text-[11px] font-medium text-tertiary">{agents.length} agents</span>
                        <CanvasUtilityButton icon={RefreshCcw01} label="Reset card layout" onClick={() => actions.resetAgentCanvasLayout()} />
                        <CanvasUtilityButton icon={expanded ? Minimize01 : Maximize01} label={expanded ? "Exit expanded canvas" : "Expand canvas"} active={expanded} onClick={() => setExpanded((value) => !value)} />
                        <CanvasUtilityButton icon={HelpCircle} label="Canvas guide" active={showHelp} onClick={() => setShowHelp((value) => !value)} />
                    </CanvasCommandBar>

                    <CanvasZoomControls zoom={transform.k} onZoomOut={() => zoomButton(-1)} onZoomIn={() => zoomButton(1)} onReset={resetView} />

                    <div className="absolute bottom-3 left-1/2 z-30 hidden -translate-x-1/2 rounded-md px-2.5 py-1.5 text-[11px] text-tertiary shadow-sm sm:block" style={CANVAS_PANEL_STYLE}>
                        {tool === "hand" ? "Drag to pan · H" : "Click to inspect · Drag cards · Space to pan · Shift 1 to fit"}
                    </div>

                    {showHelp && (
                        <CanvasGuidePanel icon={HelpCircle} onClose={() => setShowHelp(false)}>
                            <CanvasGuideItem title="Select / inspect">Click or focus an agent to open its settings drawer. Dragging never starts a runtime action.</CanvasGuideItem>
                            <CanvasGuideItem title="Move / pin">Drag an unpinned card to reposition it. Pin important cards from the inspector.</CanvasGuideItem>
                            <CanvasGuideItem title="Pan / zoom">Use the Hand tool, Space-drag, middle-drag, scroll, or the labeled zoom controls.</CanvasGuideItem>
                            <CanvasGuideItem title="Fit / reset">Shift 1 frames every card; Shift 0 resets only zoom and pan. Card layout has a separate reset.</CanvasGuideItem>
                            <CanvasGuideItem title="Connections">Wires link agents sharing projects. The toolbar preference is saved.</CanvasGuideItem>
                            <CanvasGuideItem title="Runtime safety">Pause, resume, stop, console, and configuration changes require explicit inspector or menu actions.</CanvasGuideItem>
                        </CanvasGuidePanel>
                    )}
                </div>

                {!expanded && selectedAgent && (
                    <AgentCanvasInspector agent={selectedAgent} state={state} actions={actions} onClose={() => setSelected(null)} onNavigate={onNavigate} onEditAgent={onEditAgent} onPinChange={(pinned) => setPinned(selectedAgent.id, pinned)} />
                )}
                {!expanded && !selectedAgent && (
                    <aside className="hidden w-80 shrink-0 flex-col items-center justify-center rounded-xl border border-secondary bg-primary p-6 text-center shadow-xs xl:flex" aria-label="Agent canvas inspector">
                        <Settings01 className="size-7 text-quaternary" />
                        <p className="mt-2 text-sm font-semibold text-primary">Select an agent</p>
                        <p className="mt-1 text-xs leading-5 text-tertiary">Inspect runtime health, edit agent settings, and customize what its canvas card shows.</p>
                    </aside>
                )}
            </div>
            {ctx.node}
        </div>
    );
});

function AgentCanvasInspector({ agent, state, actions, onClose, onNavigate, onEditAgent, onPinChange }: { agent: AgentState; state: CoretexState; actions: CoretexActions; onClose: () => void; onNavigate?: (target: NavTarget) => void; onEditAgent?: (agent: AgentState) => void; onPinChange: (pinned: boolean) => void }) {
    const runtime = modelAvailability(state, agent.config.provider, agent.config.model);
    const active = agent.status === "working" || agent.status === "thinking";
    const paused = agent.status === "paused";
    const card = canvasCardSettings(state, agent.id);
    const task = state.tasks.find((item) => item.id === agent.currentTaskId);
    const project = task?.projectId ? state.projects.find((item) => item.id === task.projectId) : undefined;
    const uploadInput = useRef<HTMLInputElement>(null);
    const [nameDraft, setNameDraft] = useState(agent.config.name);
    const [iconName, setIconName] = useState(agent.config.identity?.icon?.kind === "untitled-ui" ? agent.config.identity.icon.name : "CpuChip01");
    const [identityError, setIdentityError] = useState<string | null>(null);
    const themeColor = agent.config.identity?.themeColor || "#ef4242";
    const statusColor = runtime.available ? (STATUS_DOT[AGENT_STATUS_COLOR[agent.status]] ?? "var(--c-text-muted)") : "var(--c-error)";
    const accent = canvasCardAccent(agent, card, statusColor, state);

    useEffect(() => {
        setNameDraft(agent.config.name);
        if (agent.config.identity?.icon?.kind === "untitled-ui") setIconName(agent.config.identity.icon.name);
        setIdentityError(null);
    }, [agent.id, agent.config.identity, agent.config.name]);

    const updateIdentity = (nextIcon: VisualIdentity["icon"], nextColor = themeColor, avatarUrl?: string) => {
        actions.updateAgent(agent.id, { identity: { icon: nextIcon, themeColor: nextColor }, ...(avatarUrl !== undefined ? { avatarUrl } : {}) });
    };
    const chooseIcon = (name: string) => {
        setIconName(name);
        updateIdentity({ kind: "untitled-ui", name }, themeColor, "");
    };
    const chooseColor = (color: string) => {
        const icon = agent.config.identity?.icon ?? { kind: "untitled-ui" as const, name: iconName };
        updateIdentity(icon, color || "#ef4242");
    };
    const uploadAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (!file.type.startsWith("image/")) { setIdentityError("Choose an image file."); return; }
        if (file.size > 2 * 1024 * 1024) { setIdentityError("Keep card avatars under 2 MB."); return; }
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result !== "string") return;
            setIdentityError(null);
            updateIdentity({ kind: "upload", url: reader.result }, themeColor, reader.result);
        };
        reader.onerror = () => setIdentityError("That image could not be read.");
        reader.readAsDataURL(file);
    };

    return (
        <CanvasInspectorPanel
            eyebrow="Agent card"
            title={agent.config.name}
            subtitle={`${roleLabel(agent.config.role)} · ${providerLabel(agent.config.provider)}`}
            onClose={onClose}
            footer={onEditAgent ? <Button size="sm" color="primary" iconLeading={Edit01} className="w-full" onClick={() => onEditAgent(agent)}>Edit all agent settings</Button> : undefined}
        >
            <div className="flex flex-col gap-4">
                <div className="flex items-start gap-3 rounded-xl border border-secondary bg-secondary p-3">
                    <span className="relative shrink-0">
                        <IdentityAvatar identity={agent.config.identity} name={agent.config.name} avatarUrl={agent.config.avatarUrl} size={44} />
                        <span className={cx("absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full ring-2 ring-secondary", active && "animate-pulse")} style={{ background: statusColor }} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <BadgeWithDot type="color" size="sm" color={runtime.available ? AGENT_STATUS_COLOR[agent.status] : "error"}>{runtime.available ? statusLabel(agent.status) : "Unavailable"}</BadgeWithDot>
                            <ClaudeTierBadge mode={agent.config.executionMode ?? "autonomous"} />
                        </div>
                        <p className="mt-1.5 break-words text-xs text-secondary [overflow-wrap:anywhere]" title={agent.config.model}>{agent.config.model}</p>
                        {!runtime.available && <p className="mt-1 text-[11px] leading-4 text-error-primary">{runtime.reason}</p>}
                        {paused && <p className="mt-1 text-[11px] leading-4 text-warning-primary">Paused—resume when ready. Restored agents stay paused for safety.</p>}
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                    <InspectorMetric icon={Activity} label="Steps" value={String(agent.stepCount)} />
                    <InspectorMetric icon={Clock} label="Today" value={formatTokens(agent.tokensUsedToday)} />
                    <InspectorMetric icon={Coins01} label="Cost" value={formatUSD(agent.costToday)} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                    {paused ? (
                        <Button size="sm" color="secondary" iconLeading={Play} isDisabled={!runtime.available} onClick={() => actions.resumeAgent(agent.id)}>Resume</Button>
                    ) : active ? (
                        <Button size="sm" color="secondary-destructive" iconLeading={Trash01} onClick={() => { if (window.confirm(`Stop ${agent.config.name}? Its current run will end.`)) actions.haltAgent(agent.id); }}>Stop</Button>
                    ) : (
                        <Button size="sm" color="secondary" iconLeading={PauseCircle} onClick={() => actions.pauseAgent(agent.id)}>Pause</Button>
                    )}
                    <Button size="sm" color="secondary" iconLeading={Terminal} onClick={() => actions.terminalCreate({ agentId: agent.id, projectId: agent.config.tags?.[0] })}>Console</Button>
                    {onNavigate && <Button size="sm" color="secondary" iconLeading={Share07} className="col-span-2" onClick={() => onNavigate({ kind: "agent", id: agent.id })}>Open agent workspace</Button>}
                </div>

                {task && (
                    <InspectorSection title="Current work">
                        <div className="rounded-lg border border-secondary bg-secondary p-3">
                            <p className="break-words text-xs font-semibold text-primary [overflow-wrap:anywhere]" title={task.title}>{task.title}</p>
                            <p className="mt-1 break-words text-[11px] text-tertiary [overflow-wrap:anywhere]" title={project?.name}>{project?.name ?? "No project"} · {task.status.replaceAll("_", " ")} · {task.priority}</p>
                        </div>
                    </InspectorSection>
                )}

                <InspectorSection title="Agent settings" description="These settings affect the agent's next run; selection and dragging do not.">
                    <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">
                        Name
                        <div className="flex gap-2">
                            <div className="min-w-0 flex-1"><Input value={nameDraft} onChange={setNameDraft} size="sm" aria-label="Agent name" /></div>
                            <Button size="sm" color="secondary" isDisabled={!nameDraft.trim() || nameDraft.trim() === agent.config.name} onClick={() => actions.updateAgent(agent.id, { name: nameDraft.trim() })}>Save</Button>
                        </div>
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">
                        Role
                        <RichSelect aria-label="Agent role" value={agent.config.role} onChange={(event) => actions.updateAgent(agent.id, { role: event.target.value as AgentRole })} options={AGENT_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))} />
                    </label>
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-secondary">Permission mode</span>
                        <PermissionModeSelect value={agent.config.permissionMode ?? "ask"} onChange={(mode: PermissionMode) => actions.setAgentPermissionMode(agent.id, mode)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-secondary">Execution mode</span>
                        <ClaudeTierSelect value={agent.config.executionMode ?? "autonomous"} onChange={(mode: ClaudeExecutionMode) => actions.updateAgent(agent.id, { executionMode: mode })} />
                    </div>
                    <InspectorToggle label="Terminal access" description="Allow shell and terminal tools on future runs." selected={agent.config.terminalAccess !== false} onChange={(terminalAccess) => actions.updateAgent(agent.id, { terminalAccess })} />
                    <div className="flex flex-wrap gap-1.5">
                        <Badge size="sm" color="gray">{agent.config.skills?.filter((skill) => skill.enabled).length ?? 0} skills</Badge>
                        <Badge size="sm" color="gray">{agent.config.connectorIds?.length ?? 0} connectors</Badge>
                        <Badge size="sm" color="gray">{agent.config.mcpServerIds?.length ?? 0} MCP servers</Badge>
                        <Badge size="sm" color="gray">{agent.config.maxSteps} max steps</Badge>
                        <Badge size="sm" color="gray">{agent.config.dailyTokenBudget || "No"} daily token cap</Badge>
                    </div>
                    {agent.config.systemPrompt && <p className="line-clamp-3 rounded-lg border border-secondary bg-secondary p-2.5 text-[11px] leading-4 text-tertiary">{agent.config.systemPrompt}</p>}
                </InspectorSection>

                <InspectorSection title="Card identity" description="Customize this card's avatar and agent-wide identity color.">
                    <div className="flex flex-wrap items-center gap-2">
                        <IdentityAvatar identity={agent.config.identity} name={agent.config.name} avatarUrl={agent.config.avatarUrl} size={48} />
                        <input ref={uploadInput} hidden type="file" accept="image/*" onChange={uploadAvatar} />
                        <Button size="sm" color="secondary" iconLeading={UploadCloud02} onClick={() => uploadInput.current?.click()}>Upload avatar</Button>
                        {agent.config.identity?.icon?.kind === "upload" && <Button size="sm" color="secondary" onClick={() => chooseIcon(iconName)}>Use icon</Button>}
                    </div>
                    {identityError && <p role="alert" className="text-xs text-error-primary">{identityError}</p>}
                    {agent.config.identity?.icon?.kind !== "upload" && <IconPicker value={iconName} onChange={chooseIcon} color={themeColor} />}
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-secondary">Theme color</span>
                        <ColorPicker value={themeColor} onChange={chooseColor} allowNone={false} variant="compact" />
                    </div>
                </InspectorSection>

                <InspectorSection title="Card settings" description="Presentation only—these never change how the agent runs.">
                    <SegmentedSetting label="Density" value={card.density} options={[{ value: "compact", label: "Compact" }, { value: "detailed", label: "Detailed" }]} onChange={(density) => actions.setAgentCanvasCardSettings(agent.id, { density: density as AgentCanvasCardSettings["density"] })} />
                    <SegmentedSetting label="Accent" value={card.accentSource} options={[{ value: "identity", label: "Identity" }, { value: "role", label: "Role" }, { value: "status", label: "Status" }, { value: "custom", label: "Custom" }]} onChange={(accentSource) => actions.setAgentCanvasCardSettings(agent.id, { accentSource: accentSource as AgentCanvasCardSettings["accentSource"] })} />
                    {card.accentSource === "custom" && (
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-secondary">Custom accent</span>
                            <ColorPicker value={card.customColor ?? accent} onChange={(customColor) => actions.setAgentCanvasCardSettings(agent.id, { customColor })} allowNone={false} variant="compact" />
                        </div>
                    )}
                    <InspectorToggle label="Show model" description="Provider and model name on the card." selected={card.showModel} onChange={(showModel) => actions.setAgentCanvasCardSettings(agent.id, { showModel })} />
                    <InspectorToggle label="Show metrics" description="Status, steps, and today's token use." selected={card.showMetrics} onChange={(showMetrics) => actions.setAgentCanvasCardSettings(agent.id, { showMetrics })} />
                    <InspectorToggle label="Pin position" description="Prevent accidental dragging and auto-arrange moves." selected={card.pinned} onChange={onPinChange} />
                </InspectorSection>
            </div>
        </CanvasInspectorPanel>
    );
}

function InspectorSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
    return (
        <section className="flex min-w-0 flex-col gap-3 border-t border-secondary pt-4 first:border-0 first:pt-0">
            <div><h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-quaternary">{title}</h3>{description && <p className="mt-1 text-[11px] leading-4 text-tertiary">{description}</p>}</div>
            {children}
        </section>
    );
}

function InspectorMetric({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
    return (
        <div className="rounded-lg border border-secondary bg-primary p-2">
            <Icon className="size-3.5 text-quaternary" />
            <p className="mt-1 break-words text-xs font-semibold tabular-nums text-primary [overflow-wrap:anywhere]" title={value}>{value}</p>
            <p className="text-[10px] text-quaternary">{label}</p>
        </div>
    );
}

function InspectorToggle({ label, description, selected, onChange }: { label: string; description: string; selected: boolean; onChange: (selected: boolean) => void }) {
    return (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-secondary bg-primary p-2.5">
            <div className="min-w-0"><p className="text-xs font-medium text-primary">{label}</p><p className="mt-0.5 text-[11px] leading-4 text-tertiary">{description}</p></div>
            <Toggle size="sm" isSelected={selected} onChange={onChange} aria-label={label} />
        </div>
    );
}

function SegmentedSetting({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-secondary">{label}</span>
            <div role="radiogroup" aria-label={label} className="grid overflow-hidden rounded-lg border border-secondary bg-primary" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
                {options.map((option, index) => (
                    <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)} className={cx("min-w-0 px-1.5 py-2 text-[11px] font-semibold transition hover:bg-secondary", index > 0 && "border-l border-secondary", value === option.value ? "bg-secondary text-primary shadow-[inset_0_0_0_1px_var(--brand)]" : "text-tertiary")}>{option.label}</button>
                ))}
            </div>
        </div>
    );
}
