// Coretex — Social canvas. Figma-style relationship whiteboard (same interaction
// model as Agents canvas): contacts are draggable nodes, friend-of-friend wires
// come from SocialConnection, and selecting someone shows degree-of-separation
// depth mapping. Handles (Instagram, Snapchat, Discord, TikTok, …) and "how we
// met" live on each profile inspector.

import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type FormEvent, type Ref } from "react";
import {
    Cursor04, Hand, ZoomIn, ZoomOut, Maximize01, Minimize01, RefreshCcw01, Grid01, HelpCircle,
    Share07, XClose, Plus, Link01, Trash01, User01, Route, Calendar,
    Check, Clock, Gift01, Mail01, MessageChatCircle, Phone,
} from "@untitledui/icons";
import { RichSelect } from "@/components/base/select/rich-select";
import { cx } from "@/utils/cx";
import { useContextMenu, type MenuItem } from "../ui/context-menu";
import {
    CanvasCommandBar,
    CanvasGuideItem,
    CanvasGuidePanel,
    CanvasInspectorPanel,
    CanvasToolButton,
    CanvasToolRail,
    CanvasUtilityButton,
    CanvasZoomControls,
} from "./shared-canvas";

// ─── Types (match social:getCanvas payload) ───────────────────────────────────

export interface SocialCanvasHandle {
    id: string;
    platform: string;
    handle: string;
}

export interface SocialCanvasContact {
    id: string;
    displayName: string;
    avatarKey?: string | null;
    avatarUrl?: string | null;
    relationshipType: string | null;
    tier: string;
    howWeMet: string | null;
    companyOrSchool: string | null;
    birthday?: string | null;
    occupation?: string | null;
    hometown?: string | null;
    timezone?: string | null;
    interests?: string | null;
    innerCircle: boolean;
    healthScore: number;
    healthStatus: "healthy" | "due" | "overdue" | string;
    daysSince: number | null;
    cadenceDays?: number;
    nextDueAt?: string | null;
    handles: SocialCanvasHandle[];
    preferredContactMethod: string | null;
    notes: string | null;
    emails?: Array<{ id: string; email: string; isPrimary: boolean }>;
    phones?: Array<{ id: string; phone: string; isPrimary: boolean }>;
    addresses?: Array<{ id: string; addressType: string | null; city: string | null; state: string | null; country: string | null }>;
    tags?: Array<{ id: string; name: string; color?: string | null }>;
    reminders?: Array<{ id: string; reminderType: string | null; scheduledFor: string }>;
    timeline?: Array<{ id: string; kind: string; type: string | null; date: string; notes: string | null; sentiment?: string | null }>;
    gifts?: Array<{ id: string; description: string; occasion: string | null; givenDate: string | null; stage: string }>;
    memories?: Array<{ id: string; title: string | null; description: string; memoryDate: string | null; location: string | null }>;
    milestones?: Array<{ id: string; kind: string; date: string; days: number }>;
}

export interface SocialCanvasConnection {
    id: string;
    contact1Id: string;
    contact2Id: string;
    relationshipType: string | null;
    notes: string | null;
    strength?: number;
}

export interface SocialCanvasData {
    contacts: SocialCanvasContact[];
    connections: SocialCanvasConnection[];
    metrics?: {
        healthScore: number;
        healthy: number;
        due: number;
        overdue: number;
    };
}

export type SocialCanvasRun = (type: string, payload: Record<string, unknown>) => Promise<boolean>;

interface XY { x: number; y: number }
interface Transform { x: number; y: number; k: number }

const NODE_W = 232;
const NODE_H = 148;
const POS_KEY = "coretex-social-canvas-pos";
const MIN_K = 0.25;
const MAX_K = 2.5;
const GRID = 24; // matches the background dot spacing
const ALIGN_THRESHOLD = 8; // screen px within which node edges/centers snap to neighbors

const PLATFORM_PRESETS = [
    "Instagram",
    "Snapchat",
    "Discord",
    "TikTok",
    "YouTube",
    "LinkedIn",
    "X",
    "Facebook",
    "Reddit",
    "GitHub",
    "Twitch",
    "Threads",
    "Telegram",
    "WhatsApp",
    "Signal",
    "Other",
] as const;

const HEALTH_COLOR: Record<string, string> = {
    healthy: "#22c55e",
    due: "#f59e0b",
    overdue: "#ef4444",
};

const DEPTH_COLORS = ["var(--brand)", "#8b5cf6", "#06b6d4", "#f59e0b", "#94a3b8"];

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

function loadPositions(): Record<string, XY> {
    if (typeof window === "undefined") return {};
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(POS_KEY) ?? "{}");
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return Object.fromEntries(
            Object.entries(parsed).filter(([, point]) => point != null && typeof point === "object" && Number.isFinite((point as XY).x) && Number.isFinite((point as XY).y)),
        );
    } catch {
        return {};
    }
}

function platformUrl(platform: string | null | undefined, handle: string): string | null {
    const h = handle.trim();
    if (!h) return null;
    if (/^https?:\/\//i.test(h)) return h;
    const clean = h.replace(/^@+/, "");
    const bases: Record<string, string> = {
        Instagram: "https://instagram.com/",
        TikTok: "https://tiktok.com/@",
        Snapchat: "https://snapchat.com/add/",
        YouTube: "https://youtube.com/@",
        LinkedIn: "https://linkedin.com/in/",
        X: "https://x.com/",
        Twitter: "https://x.com/",
        Facebook: "https://facebook.com/",
        Reddit: "https://reddit.com/user/",
        GitHub: "https://github.com/",
        Twitch: "https://twitch.tv/",
        Threads: "https://threads.net/@",
        Telegram: "https://t.me/",
        Pinterest: "https://pinterest.com/",
    };
    const base = platform ? bases[platform] : undefined;
    if (!base) return null;
    return base + encodeURIComponent(clean).replace(/%2F/gi, "/");
}

/** BFS degrees of separation through the undirected friend graph. */
function depthMap(rootId: string | null, connections: SocialCanvasConnection[]): Map<string, number> {
    const depths = new Map<string, number>();
    if (!rootId) return depths;
    const adj = new Map<string, string[]>();
    for (const edge of connections) {
        if (!adj.has(edge.contact1Id)) adj.set(edge.contact1Id, []);
        if (!adj.has(edge.contact2Id)) adj.set(edge.contact2Id, []);
        adj.get(edge.contact1Id)!.push(edge.contact2Id);
        adj.get(edge.contact2Id)!.push(edge.contact1Id);
    }
    depths.set(rootId, 0);
    const queue = [rootId];
    while (queue.length) {
        const id = queue.shift()!;
        const d = depths.get(id)!;
        for (const next of adj.get(id) ?? []) {
            if (depths.has(next)) continue;
            depths.set(next, d + 1);
            queue.push(next);
        }
    }
    return depths;
}

const INPUT = "w-full rounded-lg border border-secondary bg-primary px-2.5 py-1.5 text-xs text-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";
const LABEL = "flex flex-col gap-1 text-[11px] font-medium text-secondary";
const BTN = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-solid px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-solid_hover disabled:opacity-50";
const BTN_GHOST = "inline-flex items-center justify-center gap-1 rounded-lg border border-secondary bg-primary px-2 py-1 text-[11px] font-semibold text-secondary transition hover:bg-primary_hover disabled:opacity-50";

export interface SocialCanvasControls {
    autoArrange: () => void;
    fit: () => void;
    toggleConnectMode: () => void;
    toggleDepth: () => void;
    toggleWires: () => void;
}

export interface SocialCanvasPresentationState {
    inspectorOpen: boolean;
    connectActive: boolean;
    depthVisible: boolean;
    wiresVisible: boolean;
}

export interface SocialCanvasDockBridge {
    controlsRef?: Ref<SocialCanvasControls>;
    onPresentationStateChange?: (state: SocialCanvasPresentationState) => void;
}

export const SocialCanvasDockContext = createContext<SocialCanvasDockBridge>({});

interface SocialCanvasProps {
    data: SocialCanvasData;
    run: SocialCanvasRun;
    pending: string | null;
    onAddContact?: () => void;
    onPresentationStateChange?: (state: SocialCanvasPresentationState) => void;
}

export const SocialCanvas = forwardRef<SocialCanvasControls, SocialCanvasProps>(function SocialCanvas({
    data,
    run,
    pending,
    onAddContact,
    onPresentationStateChange,
}, controlsRef) {
    const dockBridge = useContext(SocialCanvasDockContext);
    const contacts = data.contacts ?? [];
    const connections = data.connections ?? [];

    const [transform, setTransform] = useState<Transform>({ x: 40, y: 40, k: 1 });
    const [stored, setStored] = useState<Record<string, XY>>(loadPositions);
    const [selected, setSelected] = useState<string | null>(null);
    const [tool, setTool] = useState<"select" | "hand" | "connect">("select");
    const [wireSource, setWireSource] = useState<string | null>(null);
    const [showConns, setShowConns] = useState(true);
    const [showDepth, setShowDepth] = useState(true);
    const [showHelp, setShowHelp] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [spaceDown, setSpaceDown] = useState(false);
    const [panning, setPanning] = useState(false);
    // Live alignment guide lines (world coordinates) while a node is dragged near a neighbor.
    const [guides, setGuides] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });
    const [linkTarget, setLinkTarget] = useState("");
    const [linkLabel, setLinkLabel] = useState("friend");
    const [howWeMetDraft, setHowWeMetDraft] = useState("");
    const [handlePlatform, setHandlePlatform] = useState<string>("Instagram");
    const [handleValue, setHandleValue] = useState("");

    const containerRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ mode: "pan" | "node"; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; last?: XY } | null>(null);
    const connectPendingRef = useRef(false);
    const ctx = useContextMenu();

    const layout = useMemo(() => {
        const liveIds = new Set(contacts.map((contact) => contact.id));
        const pos: Record<string, XY> = Object.fromEntries(
            Object.entries(stored).filter(([id, point]) => liveIds.has(id) && point != null && Number.isFinite(point.x) && Number.isFinite(point.y)),
        );
        const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, contacts.length))));
        let auto = 0;
        for (const c of contacts) {
            if (!pos[c.id]) {
                let candidate: XY;
                do {
                    candidate = {
                        x: (auto % cols) * (NODE_W + 80),
                        y: Math.floor(auto / cols) * (NODE_H + 96),
                    };
                    auto += 1;
                } while (Object.values(pos).some((point) => Math.abs(point.x - candidate.x) < NODE_W + 40 && Math.abs(point.y - candidate.y) < NODE_H + 48));
                pos[c.id] = candidate;
            }
        }
        return pos;
    }, [contacts, stored]);

    const depths = useMemo(() => depthMap(selected, connections), [selected, connections]);
    const selectedContact = contacts.find((c) => c.id === selected) ?? null;

    useEffect(() => {
        if (selected && !contacts.some((contact) => contact.id === selected)) setSelected(null);
    }, [contacts, selected]);

    useEffect(() => {
        setHowWeMetDraft(selectedContact?.howWeMet ?? "");
        setLinkTarget("");
        setHandleValue("");
        setHandlePlatform("Instagram");
    }, [selectedContact?.id]);

    const persist = (next: Record<string, XY>) => {
        setStored(next);
        try {
            window.localStorage.setItem(POS_KEY, JSON.stringify(next));
        } catch {
            /* ignore */
        }
    };

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
        if (!rect || contacts.length === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of contacts) {
            const p = positions[c.id] ?? layout[c.id];
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x + NODE_W);
            maxY = Math.max(maxY, p.y + NODE_H);
        }
        const pad = 60;
        const w = maxX - minX + pad * 2;
        const h = maxY - minY + pad * 2;
        const k = clamp(Math.min(rect.width / w, rect.height / h), MIN_K, 1.4);
        setTransform({
            k,
            x: rect.width / 2 - (minX + (maxX - minX) / 2) * k,
            y: rect.height / 2 - (minY + (maxY - minY) / 2) * k,
        });
    };
    const resetView = () => setTransform({ x: 40, y: 40, k: 1 });
    const autoArrange = () => {
        const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, contacts.length))));
        const next: Record<string, XY> = {};
        contacts.forEach((c, i) => {
            next[c.id] = { x: (i % cols) * (NODE_W + 80), y: Math.floor(i / cols) * (NODE_H + 96) };
        });
        persist(next);
        fit(next);
    };
    const toggleConnectMode = () => {
        if (tool === "connect") {
            setTool("select");
            setWireSource(null);
        } else {
            setTool("connect");
        }
    };

    useImperativeHandle(controlsRef, () => ({
        autoArrange,
        fit: () => fit(),
        toggleConnectMode,
        toggleDepth: () => setShowDepth((visible) => !visible),
        toggleWires: () => setShowConns((visible) => !visible),
    }));
    useImperativeHandle(dockBridge.controlsRef, () => ({
        autoArrange,
        fit: () => fit(),
        toggleConnectMode,
        toggleDepth: () => setShowDepth((visible) => !visible),
        toggleWires: () => setShowConns((visible) => !visible),
    }));

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

    useEffect(() => {
        const isInteractive = (t: EventTarget | null) => {
            const el = t as HTMLElement | null;
            return !!el && Boolean(el.closest("input, textarea, select, button, a, [role='button'], [role='option'], [role='combobox'], [contenteditable='true']"));
        };
        const down = (e: KeyboardEvent) => {
            if (isInteractive(e.target)) return;
            if (e.code === "Space") {
                e.preventDefault();
                setSpaceDown(true);
                return;
            }
            if (e.key === "v" || e.key === "V") setTool("select");
            else if (e.key === "h" || e.key === "H") setTool("hand");
            else if (e.key === "c" || e.key === "C") setTool("connect");
            else if (e.key === "=" || e.key === "+") zoomButton(1);
            else if (e.key === "-" || e.key === "_") zoomButton(-1);
            else if (e.key === "1" && e.shiftKey) fit();
            else if (e.key === "0" && e.shiftKey) resetView();
            else if (e.key === "Escape") {
                setSelected(null);
                setWireSource(null);
                if (tool === "connect") setTool("select");
            }
        };
        const up = (e: KeyboardEvent) => {
            if (e.code !== "Space") return;
            if (!isInteractive(e.target)) e.preventDefault();
            setSpaceDown(false);
        };
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layout, contacts, tool]);

    const kRef = useRef(transform.k);
    kRef.current = transform.k;
    const latestStored = useRef(stored);
    latestStored.current = stored;
    const layoutRef = useRef(layout);
    layoutRef.current = layout;

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
                const rawX = d.ox + ddx / kRef.current;
                const rawY = d.oy + ddy / kRef.current;
                // Snap to grid by default; alignment with a neighbor's edge/center wins when in range.
                let x = Math.round(rawX / GRID) * GRID;
                let y = Math.round(rawY / GRID) * GRID;
                const threshold = ALIGN_THRESHOLD / kRef.current;
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
        const finish = (cancelled: boolean) => {
            const d = drag.current;
            if (d?.mode === "node" && d.id && cancelled) {
                setStored((prev) => {
                    const next = { ...prev, [d.id!]: { x: d.ox, y: d.oy } };
                    latestStored.current = next;
                    return next;
                });
            } else if (d?.mode === "node" && d.id && d.moved && d.last) {
                const next = { ...latestStored.current, [d.id]: d.last };
                latestStored.current = next;
                setStored(next);
                try {
                    window.localStorage.setItem(POS_KEY, JSON.stringify(next));
                } catch {
                    /* ignore */
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
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", cancel);
        };
    }, []);

    const startPan = (e: React.PointerEvent) => {
        setPanning(true);
        drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: transform.x, oy: transform.y, moved: false };
    };

    const onBackgroundPointerDown = (e: React.PointerEvent) => {
        if (e.button === 1 || tool === "hand" || spaceDown || e.button === 0) {
            if (tool === "select" || tool === "hand") setSelected(null);
            startPan(e);
        }
    };

    const linkFriends = async (a: string, b: string, relationshipType?: string) => {
        if (a === b || pending !== null || connectPendingRef.current) return;
        const alreadyLinked = connections.some((edge) =>
            (edge.contact1Id === a && edge.contact2Id === b)
            || (edge.contact1Id === b && edge.contact2Id === a),
        );
        if (alreadyLinked) {
            setWireSource(null);
            return;
        }
        connectPendingRef.current = true;
        try {
            await run("social:createConnection", {
                contact1Id: a,
                contact2Id: b,
                relationshipType: relationshipType || "friend",
            });
            setWireSource(null);
        } finally {
            connectPendingRef.current = false;
        }
    };

    const activateNode = (id: string) => {
        if (tool !== "connect") {
            setSelected(id);
            return;
        }
        if (!wireSource) {
            setWireSource(id);
            setSelected(id);
        } else if (wireSource === id) {
            setWireSource(null);
        } else {
            void linkFriends(wireSource, id, "friend");
            setSelected(id);
        }
    };

    const onNodePointerDown = (e: React.PointerEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (tool === "hand" || spaceDown || e.button === 1) {
            startPan(e);
            return;
        }
        if (tool === "connect") {
            activateNode(id);
            return;
        }
        setSelected(id);
        const p = layout[id];
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { mode: "node", id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
    };

    const neighborIds = useMemo(() => {
        if (!selected) return new Set<string>();
        const set = new Set<string>();
        for (const edge of connections) {
            if (edge.contact1Id === selected) set.add(edge.contact2Id);
            if (edge.contact2Id === selected) set.add(edge.contact1Id);
        }
        return set;
    }, [selected, connections]);

    const selectedEdges = useMemo(
        () => connections.filter((e) => e.contact1Id === selected || e.contact2Id === selected),
        [connections, selected],
    );

    const saveHowWeMet = async () => {
        if (!selected) return;
        await run("social:updateContactMeta", { id: selected, howWeMet: howWeMetDraft });
    };

    const addHandle = async (event: FormEvent) => {
        event.preventDefault();
        if (!selected || !handleValue.trim()) return;
        const ok = await run("social:createHandle", {
            contactId: selected,
            platform: handlePlatform,
            handle: handleValue.trim(),
        });
        if (ok) setHandleValue("");
    };

    const removeHandle = async (id: string) => {
        await run("social:deleteHandle", { id });
    };

    const removeConnection = async (id: string) => {
        await run("social:deleteConnection", { id });
    };

    const linkFromPanel = async () => {
        if (!selected || !linkTarget) return;
        await linkFriends(selected, linkTarget, linkLabel || "friend");
        setLinkTarget("");
    };

    const submitInteraction = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selected) return;
        const form = event.currentTarget;
        const values = new FormData(form);
        const ok = await run("social:logInteraction", {
            contactId: selected,
            interactionType: String(values.get("interactionType") ?? "catch-up"),
            date: String(values.get("date") ?? ""),
            notes: String(values.get("notes") ?? ""),
        });
        if (ok) form.reset();
    };

    const submitReminder = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selected) return;
        const form = event.currentTarget;
        const values = new FormData(form);
        const ok = await run("social:createReminder", {
            contactId: selected,
            reminderType: String(values.get("reminderType") ?? "Reach out"),
            scheduledFor: String(values.get("scheduledFor") ?? ""),
        });
        if (ok) form.reset();
    };

    const submitGift = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selected) return;
        const form = event.currentTarget;
        const values = new FormData(form);
        const ok = await run("social:createGift", {
            contactId: selected,
            description: String(values.get("description") ?? ""),
            occasion: String(values.get("occasion") ?? ""),
            stage: "idea",
        });
        if (ok) form.reset();
    };

    const submitMemory = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selected) return;
        const form = event.currentTarget;
        const values = new FormData(form);
        const ok = await run("social:createMemory", {
            contactId: selected,
            title: String(values.get("title") ?? ""),
            description: String(values.get("description") ?? ""),
            memoryDate: String(values.get("memoryDate") ?? ""),
        });
        if (ok) form.reset();
    };

    // Right-click a person → quick actions (wire, open socials, focus, unlink).
    const nodeMenu = (c: SocialCanvasContact): MenuItem[] => {
        const firstHandle = c.handles[0];
        const href = firstHandle ? platformUrl(firstHandle.platform, firstHandle.handle) : null;
        const edges = connections.filter((e) => e.contact1Id === c.id || e.contact2Id === c.id);
        return [
            { header: c.displayName },
            { key: "select", label: "Open inspector", icon: User01, onClick: () => setSelected(c.id) },
            { key: "wire", label: "Wire from here", icon: Link01, onClick: () => { setTool("connect"); setWireSource(c.id); setSelected(c.id); } },
            ...(href ? [{ key: "open", label: `Open ${firstHandle!.platform}`, icon: Share07, onClick: () => window.open(href, "_blank", "noreferrer") } as MenuItem] : []),
            { separator: true },
            { key: "focus", label: "Map connections", icon: Route, onClick: () => { setSelected(c.id); setShowDepth(true); } },
            ...(edges.length > 0
                ? [{
                    key: "unlink",
                    label: `Remove ${edges.length} link${edges.length === 1 ? "" : "s"}`,
                    icon: Trash01,
                    danger: true,
                    onClick: () => {
                        if (!window.confirm(`Remove ${edges.length} saved relationship link${edges.length === 1 ? "" : "s"} from ${c.displayName}?`)) return;
                        void (async () => {
                            for (const edge of edges) await run("social:deleteConnection", { id: edge.id });
                        })();
                    },
                } as MenuItem]
                : []),
        ];
    };

    // Right-click empty canvas → view controls that mirror the toolbar.
    const bgMenu = (): MenuItem[] => [
        { header: "Canvas" },
        { key: "fit", label: "Zoom to fit", icon: Maximize01, onClick: fit },
        { key: "reset", label: "Reset view", icon: RefreshCcw01, onClick: resetView },
        { key: "arrange", label: "Auto-arrange", icon: Grid01, onClick: autoArrange },
        { separator: true },
        { key: "wires", label: showConns ? "Hide wires" : "Show wires", icon: Share07, checked: showConns, onClick: () => setShowConns((v) => !v) },
        { key: "depth", label: showDepth ? "Hide depth" : "Show depth", icon: Route, checked: showDepth, onClick: () => setShowDepth((v) => !v) },
    ];

    const cursor = panning ? "grabbing" : tool === "hand" || spaceDown ? "grab" : tool === "connect" ? "crosshair" : "default";
    const metrics = data.metrics;

    useEffect(() => {
        const notify = onPresentationStateChange ?? dockBridge.onPresentationStateChange;
        notify?.({
            // The empty inspector rail is still rendered at xl, so the dock must
            // reserve its width even before a person is selected.
            inspectorOpen: !expanded,
            connectActive: tool === "connect",
            depthVisible: showDepth,
            wiresVisible: showConns,
        });
        return () => notify?.({ inspectorOpen: false, connectActive: false, depthVisible: true, wiresVisible: true });
    }, [dockBridge.onPresentationStateChange, expanded, onPresentationStateChange, showConns, showDepth, tool]);

    return (
        <div className={cx("flex size-full min-h-0 flex-col gap-3", expanded && "min-h-[calc(100dvh-2rem)]")}>
            {metrics && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-tertiary">
                    <span className="rounded-full border border-secondary bg-primary px-2.5 py-1 font-medium text-secondary">
                        Health {metrics.healthScore}
                    </span>
                    <span className="rounded-full border border-secondary px-2.5 py-1">{metrics.healthy} healthy</span>
                    <span className="rounded-full border border-secondary px-2.5 py-1">{metrics.due} due</span>
                    <span className="rounded-full border border-secondary px-2.5 py-1">{metrics.overdue} overdue</span>
                    <span className="rounded-full border border-secondary px-2.5 py-1">{contacts.length} people · {connections.length} links</span>
                    {tool === "connect" && (
                        <span className="rounded-full px-2.5 py-1 font-medium text-white" style={{ background: "var(--brand)" }}>
                            {wireSource ? "Click another person to wire them" : "Click a person to start a wire"}
                        </span>
                    )}
                </div>
            )}

            <div className="flex min-h-0 flex-1 gap-3">
                <div
                    ref={containerRef}
                    onPointerDown={onBackgroundPointerDown}
                    onContextMenu={(e) => { e.preventDefault(); ctx.open(e, bgMenu()); }}
                    className="relative min-h-0 min-w-0 flex-1 select-none overflow-hidden rounded-xl"
                    style={{
                        cursor,
                        background: "var(--surface)",
                        border: "1px solid var(--c-border)",
                        backgroundImage: "radial-gradient(circle, var(--c-border) 1px, transparent 1px)",
                        backgroundSize: `${24 * transform.k}px ${24 * transform.k}px`,
                        backgroundPosition: `${transform.x}px ${transform.y}px`,
                    }}
                >
                    <div
                        className="absolute left-0 top-0 origin-top-left"
                        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})` }}
                    >
                        {showConns && (
                            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
                                {connections.map((edge) => {
                                    const pa = layout[edge.contact1Id];
                                    const pb = layout[edge.contact2Id];
                                    if (!pa || !pb) return null;
                                    const ax = pa.x + NODE_W / 2;
                                    const ay = pa.y + NODE_H / 2;
                                    const bx = pb.x + NODE_W / 2;
                                    const by = pb.y + NODE_H / 2;
                                    const mx = (ax + bx) / 2;
                                    const active =
                                        selected === edge.contact1Id ||
                                        selected === edge.contact2Id ||
                                        wireSource === edge.contact1Id ||
                                        wireSource === edge.contact2Id;
                                    const d1 = depths.get(edge.contact1Id);
                                    const d2 = depths.get(edge.contact2Id);
                                    const onDepthPath =
                                        showDepth &&
                                        selected &&
                                        d1 != null &&
                                        d2 != null &&
                                        Math.abs(d1 - d2) === 1;
                                    return (
                                        <g key={edge.id}>
                                            <path
                                                d={`M ${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`}
                                                fill="none"
                                                stroke={active || onDepthPath ? "var(--brand)" : "var(--c-border)"}
                                                strokeWidth={active || onDepthPath ? 2.5 : 2}
                                                opacity={selected && !active && !onDepthPath ? 0.25 : 1}
                                            />
                                            {edge.relationshipType && (active || onDepthPath) && (
                                                <text
                                                    x={mx}
                                                    y={(ay + by) / 2 - 6}
                                                    textAnchor="middle"
                                                    fill="var(--c-text-tertiary)"
                                                    fontSize={10}
                                                    style={{ pointerEvents: "none" }}
                                                >
                                                    {edge.relationshipType}
                                                </text>
                                            )}
                                        </g>
                                    );
                                })}
                                {tool === "connect" && wireSource && layout[wireSource] && (
                                    <circle
                                        cx={layout[wireSource].x + NODE_W / 2}
                                        cy={layout[wireSource].y + NODE_H / 2}
                                        r={8}
                                        fill="var(--brand)"
                                        opacity={0.35}
                                    />
                                )}
                            </svg>
                        )}

                        {contacts.map((contact) => {
                            const p = layout[contact.id];
                            const isSel = selected === contact.id;
                            const isWire = wireSource === contact.id;
                            const isNeighbor = neighborIds.has(contact.id);
                            const depth = depths.get(contact.id);
                            const dimmed = selected && depth === undefined && contact.id !== selected;
                            const health = HEALTH_COLOR[contact.healthStatus] ?? "var(--c-text-muted)";
                            const depthColor =
                                depth != null && depth > 0 ? DEPTH_COLORS[Math.min(depth - 1, DEPTH_COLORS.length - 1)] : undefined;
                            const topHandles = contact.handles.slice(0, 4);

                            return (
                                <div
                                    key={contact.id}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={Boolean(isSel || isWire)}
                                    aria-label={`${contact.displayName}, ${contact.tier}, ${contact.healthStatus}${depth != null && depth > 0 ? `, ${depth} degrees of separation` : ""}`}
                                    onPointerDown={(e) => onNodePointerDown(e, contact.id)}
                                    onKeyDown={(event) => {
                                        if (event.key !== "Enter" && event.key !== " ") return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        activateNode(contact.id);
                                    }}
                                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelected(contact.id); ctx.open(e, nodeMenu(contact)); }}
                                    className="absolute flex flex-col gap-2 rounded-xl p-3 shadow-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
                                    style={{
                                        left: p.x,
                                        top: p.y,
                                        width: NODE_W,
                                        minHeight: NODE_H,
                                        background: "var(--surface)",
                                        border: `1px solid ${isSel || isWire ? "var(--brand)" : isNeighbor ? "color-mix(in srgb, var(--brand) 50%, var(--c-border))" : "var(--c-border)"}`,
                                        boxShadow:
                                            isSel || isWire
                                                ? "0 0 0 3px color-mix(in srgb, var(--brand) 24%, transparent)"
                                                : undefined,
                                        opacity: dimmed ? 0.35 : 1,
                                        cursor: tool === "connect" ? "crosshair" : "grab",
                                    }}
                                >
                                    <div className="flex items-start gap-2">
                                        <span
                                            className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white"
                                            style={{ background: contact.innerCircle ? "var(--brand)" : "var(--c-text-muted)" }}
                                        >
                                            {(contact.displayName.trim()[0] || "?").toUpperCase()}
                                            {contact.avatarUrl && (
                                                <img
                                                    src={contact.avatarUrl}
                                                    alt=""
                                                    loading="lazy"
                                                    className="absolute inset-0 size-full rounded-full object-cover"
                                                    onError={(event) => { event.currentTarget.style.display = "none"; }}
                                                />
                                            )}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-semibold text-primary">{contact.displayName}</p>
                                            <p className="truncate text-[11px] text-tertiary">{contact.tier}</p>
                                        </div>
                                        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: health }} title={contact.healthStatus} />
                                    </div>

                                    <p className="truncate text-[11px] text-quaternary">
                                        {contact.howWeMet
                                            ? `Met: ${contact.howWeMet}`
                                            : contact.companyOrSchool || contact.relationshipType || "No origin yet"}
                                    </p>

                                    <div className="flex flex-wrap items-center gap-1">
                                        {topHandles.length === 0 ? (
                                            <span className="text-[10px] text-quaternary">No socials</span>
                                        ) : (
                                            topHandles.map((h) => (
                                                <span
                                                    key={h.id}
                                                    className="max-w-[100px] truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium text-secondary"
                                                    style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                                                    title={`${h.platform}: ${h.handle}`}
                                                >
                                                    {h.platform.slice(0, 2)} · {h.handle.replace(/^@/, "")}
                                                </span>
                                            ))
                                        )}
                                        {showDepth && depth != null && depth > 0 && (
                                            <span
                                                className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
                                                style={{ background: depthColor }}
                                                title={`${depth}° of separation`}
                                            >
                                                {depth}°
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {guides.v != null && <div className="pointer-events-none absolute" style={{ left: guides.v, top: -10000, width: 1, height: 20000, background: "var(--brand)", opacity: 0.6 }} aria-hidden="true" />}
                        {guides.h != null && <div className="pointer-events-none absolute" style={{ top: guides.h, left: -10000, height: 1, width: 20000, background: "var(--brand)", opacity: 0.6 }} aria-hidden="true" />}
                    </div>

                    <CanvasToolRail label="Social canvas tools">
                        <CanvasToolButton icon={Cursor04} label="Select" description="Click to select, drag to move a person" shortcut="V" active={tool === "select"} onClick={() => { setTool("select"); setWireSource(null); }} />
                        <CanvasToolButton icon={Hand} label="Pan" description="Drag to move the canvas (or hold Space)" shortcut="H" active={tool === "hand"} onClick={() => { setTool("hand"); setWireSource(null); }} />
                        <CanvasToolButton icon={Link01} label="Wire friends" description="Click two people to link them as friends" shortcut="C" active={tool === "connect"} onClick={() => setTool("connect")} />
                    </CanvasToolRail>

                    <CanvasCommandBar label="Social canvas view controls">
                        <span className="px-1.5 text-[11px] font-medium text-tertiary">{contacts.length} people</span>
                        <CanvasUtilityButton icon={expanded ? Minimize01 : Maximize01} label={expanded ? "Exit full canvas" : "Expand canvas"} active={expanded} onClick={() => setExpanded((value) => !value)} />
                        <CanvasUtilityButton icon={HelpCircle} label="Canvas guide" active={showHelp} onClick={() => setShowHelp((v) => !v)} />
                    </CanvasCommandBar>

                    <CanvasZoomControls zoom={transform.k} onZoomOut={() => zoomButton(-1)} onZoomIn={() => zoomButton(1)} onReset={resetView} />

                    {showHelp && (
                        <CanvasGuidePanel icon={HelpCircle} onClose={() => setShowHelp(false)}>
                            <CanvasGuideItem title="Select / move">Click a person to open their inspector; drag to reposition. Positions stick in this browser.</CanvasGuideItem>
                            <CanvasGuideItem title="Wire friends">Press C (or the link tool), click person A, then person B. That stores a SocialConnection you can see forever.</CanvasGuideItem>
                            <CanvasGuideItem title="Depth mapping">Select anyone to highlight 1°, 2°, 3°… friends-of-friends and dim the rest of the graph.</CanvasGuideItem>
                            <CanvasGuideItem title="Socials">Use the inspector to attach Instagram, Snapchat, Discord, TikTok, and other handles.</CanvasGuideItem>
                            <CanvasGuideItem title="How you met">Capture the origin story on each person so the map doubles as a relationship journal.</CanvasGuideItem>
                            <CanvasGuideItem title="Pan / zoom">Hand tool, Space-drag, scroll, Ctrl/Cmd+scroll. Shift 1 fits; Shift 0 resets.</CanvasGuideItem>
                        </CanvasGuidePanel>
                    )}

                    {contacts.length === 0 && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
                            <div className="max-w-sm rounded-2xl border border-secondary bg-primary/90 p-5 text-center shadow-lg backdrop-blur">
                                <User01 className="mx-auto size-8 text-brand-secondary" />
                                <p className="mt-3 text-sm font-semibold text-primary">No people on the canvas yet</p>
                                <p className="mt-1 text-xs text-tertiary">Add contacts, then wire friends and map how you met them.</p>
                                {onAddContact && <button type="button" onClick={onAddContact} className="pointer-events-auto mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white hover:bg-brand-solid_hover"><Plus className="size-4" /> Add your first person</button>}
                            </div>
                        </div>
                    )}
                </div>

                {/* Inspector */}
                {!expanded && selectedContact && (
                    <CanvasInspectorPanel
                        eyebrow="Contact"
                        title={selectedContact.displayName}
                        subtitle={`${selectedContact.tier}${selectedContact.daysSince != null ? ` · last contact ${selectedContact.daysSince}d ago` : " · never contacted"}`}
                        onClose={() => setSelected(null)}
                    >
                        <div className="-m-4 flex min-h-0 flex-col">
                            <div className="border-b border-secondary p-4">
                                <div className="flex flex-wrap gap-1.5 text-[11px]">
                                    <span className="rounded-full px-2 py-0.5 font-medium text-white" style={{ background: HEALTH_COLOR[selectedContact.healthStatus] ?? "#64748b" }}>
                                        {selectedContact.healthStatus} · {selectedContact.healthScore}
                                    </span>
                                    {selectedContact.innerCircle && (
                                        <span className="rounded-full border border-secondary px-2 py-0.5 text-secondary">Inner circle</span>
                                    )}
                                </div>
                                <div className="mt-3 grid grid-cols-3 gap-1.5">
                                    <a
                                        href={selectedContact.phones?.[0]?.phone ? `tel:${selectedContact.phones[0].phone}` : undefined}
                                        aria-disabled={!selectedContact.phones?.[0]?.phone}
                                        className={cx(BTN_GHOST, !selectedContact.phones?.[0]?.phone && "pointer-events-none opacity-40")}
                                    >
                                        <Phone className="size-3.5" />Call
                                    </a>
                                    <a
                                        href={selectedContact.phones?.[0]?.phone ? `sms:${selectedContact.phones[0].phone}` : undefined}
                                        aria-disabled={!selectedContact.phones?.[0]?.phone}
                                        className={cx(BTN_GHOST, !selectedContact.phones?.[0]?.phone && "pointer-events-none opacity-40")}
                                    >
                                        <MessageChatCircle className="size-3.5" />Text
                                    </a>
                                    <a
                                        href={selectedContact.emails?.[0]?.email ? `mailto:${selectedContact.emails[0].email}` : undefined}
                                        aria-disabled={!selectedContact.emails?.[0]?.email}
                                        className={cx(BTN_GHOST, !selectedContact.emails?.[0]?.email && "pointer-events-none opacity-40")}
                                    >
                                        <Mail01 className="size-3.5" />Email
                                    </a>
                                </div>
                            </div>

                            <section className="space-y-3 border-b border-secondary p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-quaternary">Relationship profile</h3>
                                    <span className="text-[10px] text-quaternary">Cadence {selectedContact.cadenceDays ?? "—"}d</span>
                                </div>
                                {(selectedContact.occupation || selectedContact.companyOrSchool || selectedContact.timezone) && (
                                    <div className="grid gap-1.5 rounded-lg bg-secondary p-2.5 text-xs text-secondary">
                                        {(selectedContact.occupation || selectedContact.companyOrSchool) && <p>{[selectedContact.occupation, selectedContact.companyOrSchool].filter(Boolean).join(" · ")}</p>}
                                        {(selectedContact.addresses?.[0]?.city || selectedContact.timezone) && <p className="text-tertiary">Local context · {[selectedContact.addresses?.[0]?.city, selectedContact.timezone].filter(Boolean).join(" · ")}</p>}
                                    </div>
                                )}
                                {selectedContact.tags && selectedContact.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">{selectedContact.tags.map((tag) => <span key={tag.id} className="rounded-full border border-secondary bg-primary px-2 py-0.5 text-[10px] text-secondary">{tag.name}</span>)}</div>
                                )}
                                {selectedContact.interests && <p className="text-xs leading-relaxed text-tertiary"><span className="font-semibold text-secondary">Interests:</span> {selectedContact.interests}</p>}
                                {selectedContact.notes && <p className="rounded-lg border border-secondary px-2.5 py-2 text-xs leading-relaxed text-tertiary">{selectedContact.notes}</p>}
                                {selectedContact.milestones?.[0] && (
                                    <div className="flex items-center gap-2 rounded-lg border border-warning_subtle bg-warning-primary px-2.5 py-2 text-xs text-warning-primary">
                                        <Calendar className="size-3.5" />
                                        <span className="min-w-0 flex-1 truncate">{selectedContact.milestones[0].kind} in {selectedContact.milestones[0].days} days</span>
                                    </div>
                                )}
                            </section>

                            <section className="space-y-3 border-b border-secondary p-4">
                                <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-quaternary">Interaction timeline</h3><span className="text-[10px] text-quaternary">Latest first</span></div>
                                {selectedContact.timeline && selectedContact.timeline.length > 0 ? (
                                    <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border-secondary">
                                        {selectedContact.timeline.slice(0, 6).map((entry) => (
                                            <li key={entry.id} className="relative flex gap-3 pl-0">
                                                <span className="relative z-10 mt-1 size-[11px] shrink-0 rounded-full border-2 border-primary bg-brand-solid" />
                                                <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="text-xs font-semibold text-primary">{entry.type || entry.kind}</p><time className="shrink-0 text-[10px] text-quaternary">{new Date(entry.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></div>{entry.notes && <p className="mt-0.5 text-xs leading-relaxed text-tertiary">{entry.notes}</p>}</div>
                                            </li>
                                        ))}
                                    </ol>
                                ) : <p className="text-xs text-tertiary">No interactions logged yet.</p>}
                                <details className="group rounded-lg border border-secondary bg-secondary">
                                    <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-secondary"><span className="inline-flex items-center gap-1.5"><Plus className="size-3.5" />Log interaction</span><span className="text-quaternary group-open:rotate-45"><Plus className="size-3.5" /></span></summary>
                                    <form onSubmit={submitInteraction} className="space-y-2 border-t border-secondary p-3">
                                        <div className="grid grid-cols-2 gap-2"><label className={LABEL}>Type<RichSelect name="interactionType" defaultValue="catch-up" options={[{ value: "catch-up", label: "Catch-up" }, { value: "call", label: "Call" }, { value: "text", label: "Text" }, { value: "email", label: "Email" }, { value: "dinner", label: "Dinner" }, { value: "gift", label: "Gift" }]} /></label><label className={LABEL}>When<input className={INPUT} name="date" type="datetime-local" /></label></div>
                                        <label className={LABEL}>What mattered?<textarea className={`${INPUT} min-h-16 resize-y`} name="notes" placeholder="Topics, changes, follow-up…" /></label>
                                        <button className={BTN} disabled={pending !== null}><Check className="size-3.5" />Save touch</button>
                                    </form>
                                </details>
                            </section>

                            <section className="space-y-3 border-b border-secondary p-4">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-quaternary">Nudges & next moves</h3>
                                {selectedContact.reminders && selectedContact.reminders.length > 0 && (
                                    <ul className="space-y-1.5">{selectedContact.reminders.map((reminder) => <li key={reminder.id} className="flex items-center gap-2 rounded-lg border border-secondary px-2.5 py-2"><Clock className="size-3.5 shrink-0 text-warning-primary" /><span className="min-w-0 flex-1 text-xs text-secondary"><span className="block truncate font-medium text-primary">{reminder.reminderType || "Reach out"}</span>{new Date(reminder.scheduledFor).toLocaleDateString()}</span><button type="button" className="rounded p-1 text-quaternary hover:text-success-primary" title="Complete" disabled={pending !== null} onClick={() => void run("social:completeReminder", { id: reminder.id })}><Check className="size-3.5" /></button></li>)}</ul>
                                )}
                                <details className="group rounded-lg border border-secondary bg-secondary">
                                    <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-secondary"><span className="inline-flex items-center gap-1.5"><Clock className="size-3.5" />Add reminder</span><Plus className="size-3.5 text-quaternary group-open:rotate-45" /></summary>
                                    <form onSubmit={submitReminder} className="space-y-2 border-t border-secondary p-3"><label className={LABEL}>Reason<input className={INPUT} name="reminderType" placeholder="Ask about the new job" /></label><label className={LABEL}>When<input className={INPUT} name="scheduledFor" type="datetime-local" required /></label><button className={BTN} disabled={pending !== null}>Set nudge</button></form>
                                </details>
                            </section>

                            <section className="space-y-3 border-b border-secondary p-4">
                                <div className="flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wide text-quaternary">Gifts & memories</h3><span className="text-[10px] text-quaternary">{(selectedContact.gifts?.length ?? 0) + (selectedContact.memories?.length ?? 0)} saved</span></div>
                                {selectedContact.gifts?.slice(0, 3).map((gift) => <div key={gift.id} className="flex gap-2 rounded-lg border border-secondary p-2.5"><Gift01 className="mt-0.5 size-3.5 shrink-0 text-brand-secondary" /><div className="min-w-0"><p className="text-xs font-medium text-primary">{gift.description}</p><p className="mt-0.5 text-[10px] text-quaternary">{gift.stage}{gift.occasion ? ` · ${gift.occasion}` : ""}</p></div></div>)}
                                {selectedContact.memories?.slice(0, 2).map((memory) => <div key={memory.id} className="rounded-lg border border-secondary p-2.5"><p className="text-xs font-medium text-primary">{memory.title || "Shared memory"}</p><p className="mt-0.5 line-clamp-2 text-xs text-tertiary">{memory.description}</p></div>)}
                                <div className="grid gap-2">
                                    <details className="group rounded-lg border border-secondary bg-secondary"><summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-secondary"><span className="inline-flex items-center gap-1.5"><Gift01 className="size-3.5" />Capture gift idea</span><Plus className="size-3.5 text-quaternary group-open:rotate-45" /></summary><form onSubmit={submitGift} className="space-y-2 border-t border-secondary p-3"><label className={LABEL}>Idea<input className={INPUT} name="description" required placeholder="Something they mentioned…" /></label><label className={LABEL}>Occasion<RichSelect name="occasion" placeholder="Choose an occasion" options={[{ value: "Birthday", label: "Birthday" }, { value: "Holiday", label: "Holiday" }, { value: "Anniversary", label: "Anniversary" }, { value: "Housewarming", label: "Housewarming" }, { value: "Just because", label: "Just because" }]} /></label><button className={BTN} disabled={pending !== null}>Save idea</button></form></details>
                                    <details className="group rounded-lg border border-secondary bg-secondary"><summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-secondary"><span className="inline-flex items-center gap-1.5"><MessageChatCircle className="size-3.5" />Save memory</span><Plus className="size-3.5 text-quaternary group-open:rotate-45" /></summary><form onSubmit={submitMemory} className="space-y-2 border-t border-secondary p-3"><label className={LABEL}>Title<input className={INPUT} name="title" placeholder="Sunday at the lake" /></label><label className={LABEL}>Memory<textarea className={`${INPUT} min-h-16 resize-y`} name="description" required /></label><label className={LABEL}>Date<input className={INPUT} name="memoryDate" type="date" /></label><button className={BTN} disabled={pending !== null}>Save memory</button></form></details>
                                </div>
                            </section>

                            <section className="space-y-2 border-b border-secondary p-4">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-quaternary">How we met</h3>
                                <textarea
                                    className={`${INPUT} min-h-16 resize-y`}
                                    value={howWeMetDraft}
                                    onChange={(e) => setHowWeMetDraft(e.target.value)}
                                    placeholder="College, through Sam, climbing gym…"
                                    maxLength={1000}
                                />
                                <button type="button" className={BTN} disabled={pending !== null} onClick={() => void saveHowWeMet()}>
                                    Save origin
                                </button>
                            </section>

                            <section className="space-y-2 border-b border-secondary p-4">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-quaternary">Social handles</h3>
                                {selectedContact.handles.length === 0 ? (
                                    <p className="text-xs text-tertiary">No Instagram, Snapchat, Discord, TikTok… yet.</p>
                                ) : (
                                    <ul className="space-y-1.5">
                                        {selectedContact.handles.map((h) => {
                                            const href = platformUrl(h.platform, h.handle);
                                            return (
                                                <li key={h.id} className="flex items-center gap-2 rounded-lg border border-secondary px-2 py-1.5">
                                                    <span className="min-w-0 flex-1 truncate text-xs text-secondary">
                                                        <span className="font-semibold text-primary">{h.platform}</span>{" "}
                                                        {href ? (
                                                            <a href={href} target="_blank" rel="noreferrer" className="text-brand-secondary hover:underline">
                                                                {h.handle}
                                                            </a>
                                                        ) : (
                                                            h.handle
                                                        )}
                                                    </span>
                                                    <button type="button" className="rounded p-1 text-quaternary hover:text-error-primary" disabled={pending !== null} onClick={() => void removeHandle(h.id)} aria-label={`Remove ${h.platform}`}>
                                                        <Trash01 className="size-3.5" />
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                                <form onSubmit={addHandle} className="space-y-2 pt-1">
                                    <label className={LABEL}>
                                        Platform
                                        <RichSelect value={handlePlatform} onChange={(event) => setHandlePlatform(event.target.value)} options={PLATFORM_PRESETS.map((platform) => ({ value: platform, label: platform }))} />
                                    </label>
                                    <label className={LABEL}>
                                        Handle
                                        <input className={INPUT} value={handleValue} onChange={(e) => setHandleValue(e.target.value)} placeholder="@username or URL" required maxLength={320} />
                                    </label>
                                    <button type="submit" className={BTN} disabled={pending !== null || !handleValue.trim()}>
                                        <Plus className="size-3.5" /> Add social
                                    </button>
                                </form>
                            </section>

                            <section className="space-y-2 p-4">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-quaternary">Friend links</h3>
                                {selectedEdges.length === 0 ? (
                                    <p className="text-xs text-tertiary">No wires yet. Use the link tool on the canvas or pick someone below.</p>
                                ) : (
                                    <ul className="space-y-1.5">
                                        {selectedEdges.map((edge) => {
                                            const otherId = edge.contact1Id === selected ? edge.contact2Id : edge.contact1Id;
                                            const other = contacts.find((c) => c.id === otherId);
                                            const depth = depths.get(otherId);
                                            return (
                                                <li key={edge.id} className="flex items-center gap-2 rounded-lg border border-secondary px-2 py-1.5">
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate text-xs font-medium text-primary">{other?.displayName ?? "Unknown"}</p>
                                                        <p className="truncate text-[10px] text-quaternary">
                                                            {edge.relationshipType || "linked"}
                                                            {depth != null && depth > 0 ? ` · ${depth}°` : ""}
                                                            {edge.notes ? ` · ${edge.notes}` : ""}
                                                        </p>
                                                    </div>
                                                    <button type="button" className="rounded p-1 text-quaternary hover:text-error-primary" disabled={pending !== null} onClick={() => void removeConnection(edge.id)} aria-label="Remove link">
                                                        <Trash01 className="size-3.5" />
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                                <div className="space-y-2 pt-1">
                                    <label className={LABEL}>
                                        Link to
                                        <RichSelect value={linkTarget} onChange={(event) => setLinkTarget(event.target.value)} placeholder="Choose a person…" options={contacts.filter((contact) => contact.id !== selected && !neighborIds.has(contact.id)).map((contact) => ({ value: contact.id, label: contact.displayName }))} />
                                    </label>
                                    <label className={LABEL}>
                                        Relationship
                                        <input className={INPUT} value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="friend, coworker, introduced by…" maxLength={200} />
                                    </label>
                                    <button type="button" className={BTN_GHOST} disabled={pending !== null || !linkTarget} onClick={() => void linkFromPanel()}>
                                        <Link01 className="size-3.5" /> Wire friends
                                    </button>
                                </div>
                            </section>
                        </div>
                    </CanvasInspectorPanel>
                )}
                {!expanded && !selectedContact && (
                    <aside className="hidden w-80 shrink-0 flex-col items-center justify-center rounded-xl border border-secondary bg-primary p-6 text-center shadow-xs xl:flex" aria-label="Social canvas inspector">
                        <Share07 className="size-7 text-quaternary" />
                        <p className="mt-2 text-sm font-semibold text-primary">Select a person</p>
                        <p className="mt-1 text-xs leading-5 text-tertiary">Inspect socials, how you met, and friend links. Use the wire tool to connect people on the map.</p>
                    </aside>
                )}
            </div>
            {ctx.node}
        </div>
    );
});

export default SocialCanvas;
