"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const OPEN_STORAGE_KEY = "lifeos.spotify.widget.open";
export const POSITION_STORAGE_KEY = "lifeos.spotify.widget.position";
export const SIZE_STORAGE_KEY = "lifeos.spotify.widget.size";
export const PLAYLIST_VIEW_STORAGE_KEY = "lifeos.spotify.widget.playlistView";
export const GRID_COLUMNS_STORAGE_KEY = "lifeos.spotify.widget.gridColumns";

export const GRID_COLUMNS_MIN = 2;
export const GRID_COLUMNS_MAX = 6;
export const GRID_COLUMNS_DEFAULT = 3;

export const MIN_WIDGET_WIDTH = 260;
export const MAX_WIDGET_WIDTH = 720;
export const MIN_WIDGET_HEIGHT = 280;
export const DEFAULT_WIDGET_WIDTH = 360;
export const DEFAULT_WIDGET_HEIGHT = 520;
export const VIEWPORT_MARGIN = 12;

export type WidgetPosition = { x: number; y: number };
export type WidgetSize = { width: number; height: number };
export type PlaylistViewMode = "list" | "grid";

function defaultPosition(width: number): WidgetPosition {
    if (typeof window === "undefined") return { x: VIEWPORT_MARGIN, y: VIEWPORT_MARGIN };
    const mobile = window.innerWidth < 1024;
    return {
        x: Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
        y: mobile
            ? Math.max(VIEWPORT_MARGIN, window.innerHeight - 120 - VIEWPORT_MARGIN)
            : VIEWPORT_MARGIN,
    };
}

function defaultSize(): WidgetSize {
    return { width: DEFAULT_WIDGET_WIDTH, height: DEFAULT_WIDGET_HEIGHT };
}

function clampPosition(x: number, y: number, width: number, height: number): WidgetPosition {
    if (typeof window === "undefined") return { x, y };
    const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    return {
        x: Math.min(Math.max(VIEWPORT_MARGIN, x), maxX),
        y: Math.min(Math.max(VIEWPORT_MARGIN, y), maxY),
    };
}

function clampSize(width: number, height: number): WidgetSize {
    if (typeof window === "undefined") {
        return {
            width: Math.min(Math.max(MIN_WIDGET_WIDTH, width), MAX_WIDGET_WIDTH),
            height: Math.max(MIN_WIDGET_HEIGHT, height),
        };
    }
    const maxW = Math.min(MAX_WIDGET_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const maxH = Math.min(window.innerHeight - VIEWPORT_MARGIN * 2, window.innerHeight * 0.92);
    return {
        width: Math.min(Math.max(MIN_WIDGET_WIDTH, width), maxW),
        height: Math.min(Math.max(MIN_WIDGET_HEIGHT, height), maxH),
    };
}

function loadJson<T>(key: string, validate: (v: unknown) => v is T): T | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return validate(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function isPosition(v: unknown): v is WidgetPosition {
    return typeof v === "object" && v != null && typeof (v as WidgetPosition).x === "number" && typeof (v as WidgetPosition).y === "number";
}

function isSize(v: unknown): v is WidgetSize {
    return typeof v === "object" && v != null && typeof (v as WidgetSize).width === "number" && typeof (v as WidgetSize).height === "number";
}

export function loadPlaylistViewMode(): PlaylistViewMode {
    try {
        const v = localStorage.getItem(PLAYLIST_VIEW_STORAGE_KEY);
        return v === "grid" ? "grid" : "list";
    } catch {
        return "list";
    }
}

export function savePlaylistViewMode(mode: PlaylistViewMode) {
    try {
        localStorage.setItem(PLAYLIST_VIEW_STORAGE_KEY, mode);
    } catch {
        /* ignore */
    }
}

export function loadGridColumns(): number {
    try {
        const raw = localStorage.getItem(GRID_COLUMNS_STORAGE_KEY);
        const n = raw ? Number.parseInt(raw, 10) : GRID_COLUMNS_DEFAULT;
        if (Number.isNaN(n)) return GRID_COLUMNS_DEFAULT;
        return Math.min(GRID_COLUMNS_MAX, Math.max(GRID_COLUMNS_MIN, n));
    } catch {
        return GRID_COLUMNS_DEFAULT;
    }
}

export function saveGridColumns(columns: number) {
    try {
        const n = Math.min(GRID_COLUMNS_MAX, Math.max(GRID_COLUMNS_MIN, columns));
        localStorage.setItem(GRID_COLUMNS_STORAGE_KEY, String(n));
    } catch {
        /* ignore */
    }
}

export function useWidgetChrome(open: boolean) {
    const [position, setPosition] = useState<WidgetPosition>({ x: 0, y: 0 });
    const [size, setSize] = useState<WidgetSize>(defaultSize());
    const [ready, setReady] = useState(false);
    const shellRef = useRef<HTMLDivElement>(null);
    const positionRef = useRef(position);
    const sizeRef = useRef(size);
    const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
    const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

    positionRef.current = position;
    sizeRef.current = size;

    const persistPosition = useCallback((next: WidgetPosition) => {
        try {
            localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(next));
        } catch {
            /* ignore */
        }
    }, []);

    const persistSize = useCallback((next: WidgetSize) => {
        try {
            localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(next));
        } catch {
            /* ignore */
        }
    }, []);

    const clampToShell = useCallback((x: number, y: number, w: number, h: number) => {
        return clampPosition(x, y, w, h);
    }, []);

    useEffect(() => {
        const storedSize = loadJson(SIZE_STORAGE_KEY, isSize) ?? defaultSize();
        const nextSize = clampSize(storedSize.width, storedSize.height);
        const storedPos = loadJson(POSITION_STORAGE_KEY, isPosition);
        const nextPos = clampToShell((storedPos ?? defaultPosition(nextSize.width)).x, (storedPos ?? defaultPosition(nextSize.width)).y, nextSize.width, open ? nextSize.height : 40);
        setSize(nextSize);
        sizeRef.current = nextSize;
        setPosition(nextPos);
        positionRef.current = nextPos;
        setReady(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- init once
    }, []);

    useEffect(() => {
        if (!ready) return;
        const onResize = () => {
            const nextSize = clampSize(sizeRef.current.width, sizeRef.current.height);
            const nextPos = clampToShell(positionRef.current.x, positionRef.current.y, nextSize.width, open ? nextSize.height : 40);
            setSize(nextSize);
            sizeRef.current = nextSize;
            setPosition(nextPos);
            positionRef.current = nextPos;
            persistSize(nextSize);
            persistPosition(nextPos);
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [clampToShell, open, persistPosition, persistSize, ready]);

    useEffect(() => {
        if (!ready) return;
        const h = open ? sizeRef.current.height : 40;
        const nextPos = clampToShell(positionRef.current.x, positionRef.current.y, sizeRef.current.width, h);
        setPosition(nextPos);
        positionRef.current = nextPos;
    }, [clampToShell, open, ready, size.width, size.height]);

    const onDragPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            origX: positionRef.current.x,
            origY: positionRef.current.y,
        };
    }, []);

    const onDragPointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (dragRef.current) {
                const dx = e.clientX - dragRef.current.startX;
                const dy = e.clientY - dragRef.current.startY;
                const next = clampToShell(
                    dragRef.current.origX + dx,
                    dragRef.current.origY + dy,
                    sizeRef.current.width,
                    open ? sizeRef.current.height : 40,
                );
                setPosition(next);
                positionRef.current = next;
                return;
            }
            if (resizeRef.current) {
                const dx = e.clientX - resizeRef.current.startX;
                const dy = e.clientY - resizeRef.current.startY;
                const nextSize = clampSize(resizeRef.current.origW + dx, resizeRef.current.origH + dy);
                const nextPos = clampToShell(positionRef.current.x, positionRef.current.y, nextSize.width, nextSize.height);
                setSize(nextSize);
                sizeRef.current = nextSize;
                setPosition(nextPos);
                positionRef.current = nextPos;
            }
        },
        [clampToShell, open],
    );

    const onDragPointerUp = useCallback(
        (e: React.PointerEvent) => {
            const wasDrag = Boolean(dragRef.current);
            const wasResize = Boolean(resizeRef.current);
            dragRef.current = null;
            resizeRef.current = null;
            try {
                e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
                /* ignore */
            }
            if (wasDrag || wasResize) {
                persistPosition(positionRef.current);
                if (wasResize) persistSize(sizeRef.current);
            }
        },
        [persistPosition, persistSize],
    );

    const onResizePointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        resizeRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            origW: sizeRef.current.width,
            origH: sizeRef.current.height,
        };
    }, []);

    return {
        ready,
        position,
        size,
        shellRef,
        onDragPointerDown,
        onDragPointerMove,
        onDragPointerUp,
        onResizePointerDown,
    };
}
