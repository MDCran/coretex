// @ts-nocheck
export type CanvasTool = "select" | "hand" | "note" | "frame" | "connector";

export interface CanvasViewport {
    x: number;
    y: number;
    zoom: number;
}

export interface CanvasPoint {
    x: number;
    y: number;
}

export interface CanvasPosition extends CanvasPoint {
    width?: number;
    height?: number;
}

export type CanvasTone = "amber" | "blue" | "green" | "purple" | "gray";

export interface CanvasNote extends CanvasPoint {
    id: string;
    width: number;
    height: number;
    title: string;
    body: string;
    tone: CanvasTone;
}

export interface CanvasFrame extends CanvasPoint {
    id: string;
    width: number;
    height: number;
    title: string;
    tone: CanvasTone;
}

export interface CanvasManualEdge {
    id: string;
    sourceId: string;
    targetId: string;
    label: string;
}

export interface ProjectCanvasLayout {
    version: 1;
    viewport: CanvasViewport;
    positions: Record<string, CanvasPosition>;
    notes: CanvasNote[];
    frames: CanvasFrame[];
    edges: CanvasManualEdge[];
    gridVisible: boolean;
    snapToGrid: boolean;
}

export type CanvasSelection =
    | { kind: "node"; id: string }
    | { kind: "note"; id: string }
    | { kind: "frame"; id: string }
    | { kind: "edge"; id: string }
    | { kind: "wire"; id: string } // a derived pipeline wire (assignment/dependency), inspectable but not editable
    | null;

export const GRID_SIZE = 20;
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2;

export const EMPTY_CANVAS_LAYOUT: ProjectCanvasLayout = {
    version: 1,
    viewport: { x: 64, y: 64, zoom: 1 },
    positions: {},
    notes: [],
    frames: [],
    edges: [],
    gridVisible: true,
    snapToGrid: true,
};

export function freshCanvasLayout(): ProjectCanvasLayout {
    return {
        ...EMPTY_CANVAS_LAYOUT,
        viewport: { ...EMPTY_CANVAS_LAYOUT.viewport },
        positions: {},
        notes: [],
        frames: [],
        edges: [],
    };
}

function finite(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isTone(value: unknown): value is CanvasTone {
    return value === "amber" || value === "blue" || value === "green" || value === "purple" || value === "gray";
}

function normalizeNote(value: unknown): CanvasNote | null {
    if (!value || typeof value !== "object") return null;
    const note = value as Partial<CanvasNote>;
    if (typeof note.id !== "string") return null;
    return {
        id: note.id,
        x: finite(note.x, 0),
        y: finite(note.y, 0),
        width: Math.max(180, finite(note.width, 240)),
        height: Math.max(130, finite(note.height, 180)),
        title: typeof note.title === "string" ? note.title : "Note",
        body: typeof note.body === "string" ? note.body : "",
        tone: isTone(note.tone) ? note.tone : "amber",
    };
}

function normalizeFrame(value: unknown): CanvasFrame | null {
    if (!value || typeof value !== "object") return null;
    const frame = value as Partial<CanvasFrame>;
    if (typeof frame.id !== "string") return null;
    return {
        id: frame.id,
        x: finite(frame.x, 0),
        y: finite(frame.y, 0),
        width: Math.max(300, finite(frame.width, 560)),
        height: Math.max(220, finite(frame.height, 360)),
        title: typeof frame.title === "string" ? frame.title : "Frame",
        tone: isTone(frame.tone) ? frame.tone : "blue",
    };
}

function normalizeEdge(value: unknown): CanvasManualEdge | null {
    if (!value || typeof value !== "object") return null;
    const edge = value as Partial<CanvasManualEdge>;
    if (typeof edge.id !== "string" || typeof edge.sourceId !== "string" || typeof edge.targetId !== "string") return null;
    return {
        id: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        label: typeof edge.label === "string" ? edge.label : "",
    };
}

export function loadCanvasLayout(projectId: string): ProjectCanvasLayout {
    if (typeof window === "undefined") return freshCanvasLayout();
    try {
        const raw = window.localStorage.getItem(`coretex:project-canvas:v1:${projectId}`);
        if (!raw) return freshCanvasLayout();
        const parsed = JSON.parse(raw) as Partial<ProjectCanvasLayout>;
        const positions: Record<string, CanvasPosition> = {};
        if (parsed.positions && typeof parsed.positions === "object") {
            for (const [id, value] of Object.entries(parsed.positions)) {
                if (!value || typeof value !== "object") continue;
                const position = value as Partial<CanvasPosition>;
                positions[id] = {
                    x: finite(position.x, 0),
                    y: finite(position.y, 0),
                    ...(typeof position.width === "number" ? { width: Math.max(120, position.width) } : {}),
                    ...(typeof position.height === "number" ? { height: Math.max(80, position.height) } : {}),
                };
            }
        }
        return {
            version: 1,
            viewport: {
                x: finite(parsed.viewport?.x, EMPTY_CANVAS_LAYOUT.viewport.x),
                y: finite(parsed.viewport?.y, EMPTY_CANVAS_LAYOUT.viewport.y),
                zoom: clampZoom(finite(parsed.viewport?.zoom, EMPTY_CANVAS_LAYOUT.viewport.zoom)),
            },
            positions,
            notes: Array.isArray(parsed.notes) ? parsed.notes.map(normalizeNote).filter((note): note is CanvasNote => note !== null) : [],
            frames: Array.isArray(parsed.frames) ? parsed.frames.map(normalizeFrame).filter((frame): frame is CanvasFrame => frame !== null) : [],
            edges: Array.isArray(parsed.edges) ? parsed.edges.map(normalizeEdge).filter((edge): edge is CanvasManualEdge => edge !== null) : [],
            gridVisible: parsed.gridVisible !== false,
            snapToGrid: parsed.snapToGrid !== false,
        };
    } catch {
        return freshCanvasLayout();
    }
}

export function saveCanvasLayout(projectId: string, layout: ProjectCanvasLayout): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(`coretex:project-canvas:v1:${projectId}`, JSON.stringify(layout));
    } catch {
        // Storage can be disabled or full. The live canvas remains usable for this session.
    }
}

export function clampZoom(zoom: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function snapValue(value: number, enabled: boolean): number {
    return enabled ? Math.round(value / GRID_SIZE) * GRID_SIZE : Math.round(value);
}

export function canvasObjectId(prefix: "note" | "frame" | "edge"): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
