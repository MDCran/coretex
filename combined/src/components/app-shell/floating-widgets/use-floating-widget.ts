"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WidgetDefinition } from "@/components/app-shell/floating-widgets/widget-config";

export const VIEWPORT_MARGIN = 12;
const DOCK_CLEARANCE = 72;

export type WidgetPosition = { x: number; y: number };
export type WidgetSize = { width: number; height: number };
/** Which bottom corner a resize handle drags from. */
export type ResizeCorner = "se" | "sw";

function storageKeys(id: string) {
    return {
        open: `lifeos.widget.${id}.open`,
        position: `lifeos.widget.${id}.position`,
        size: `lifeos.widget.${id}.size`,
    };
}

function defaultPosition(width: number, height: number, placementIndex: number): WidgetPosition {
    if (typeof window === "undefined") return { x: VIEWPORT_MARGIN, y: VIEWPORT_MARGIN };
    const mobile = window.innerWidth < 1024;
    const stagger = placementIndex * 28;
    const maxY = window.innerHeight - height - VIEWPORT_MARGIN - DOCK_CLEARANCE;
    return {
        x: Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN - (placementIndex % 3) * 16),
        y: mobile
            ? Math.max(VIEWPORT_MARGIN, Math.min(maxY, window.innerHeight - height - DOCK_CLEARANCE - stagger))
            : Math.min(maxY, VIEWPORT_MARGIN + stagger),
    };
}

function clampPosition(x: number, y: number, width: number, height: number): WidgetPosition {
    if (typeof window === "undefined") return { x, y };
    const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN - DOCK_CLEARANCE);
    return {
        x: Math.min(Math.max(VIEWPORT_MARGIN, x), maxX),
        y: Math.min(Math.max(VIEWPORT_MARGIN, y), maxY),
    };
}

function clampSize(width: number, height: number, def: WidgetDefinition): WidgetSize {
    if (typeof window === "undefined") {
        return {
            width: Math.min(Math.max(def.minWidth, width), def.maxWidth),
            height: Math.max(def.minHeight, height),
        };
    }
    const maxW = Math.min(def.maxWidth, window.innerWidth - VIEWPORT_MARGIN * 2);
    const maxH = Math.min(window.innerHeight - VIEWPORT_MARGIN * 2 - DOCK_CLEARANCE, window.innerHeight * 0.85);
    return {
        width: Math.min(Math.max(def.minWidth, width), maxW),
        height: Math.min(Math.max(def.minHeight, height), maxH),
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

/** One-time migration from legacy Spotify-only widget keys. */
function migrateLegacyMusicStorage(keys: ReturnType<typeof storageKeys>) {
    try {
        const legacyOpen = localStorage.getItem("lifeos.spotify.widget.open");
        if (legacyOpen === "1" && !localStorage.getItem(keys.open)) {
            localStorage.setItem(keys.open, "1");
        }
        const legacyPos = localStorage.getItem("lifeos.spotify.widget.position");
        if (legacyPos && !localStorage.getItem(keys.position)) {
            localStorage.setItem(keys.position, legacyPos);
        }
        const legacySize = localStorage.getItem("lifeos.spotify.widget.size");
        if (legacySize && !localStorage.getItem(keys.size)) {
            localStorage.setItem(keys.size, legacySize);
        }
        const legacyWorkouts = localStorage.getItem("lifeos.workouts.playerPanelOpen");
        if (legacyWorkouts === "1" && !localStorage.getItem(keys.open)) {
            localStorage.setItem(keys.open, "1");
        }
    } catch {
        /* ignore */
    }
}

export function useFloatingWidget(def: WidgetDefinition) {
    const keys = storageKeys(def.id);
    const [position, setPosition] = useState<WidgetPosition>({ x: 0, y: 0 });
    const [size, setSize] = useState<WidgetSize>(def.defaultSize);
    const [ready, setReady] = useState(false);
    const shellRef = useRef<HTMLDivElement>(null);
    const positionRef = useRef(position);
    const sizeRef = useRef(size);
    const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
    const resizeRef = useRef<{ startX: number; startY: number; origX: number; origW: number; origH: number; corner: ResizeCorner } | null>(null);

    positionRef.current = position;
    sizeRef.current = size;

    const persistPosition = useCallback(
        (next: WidgetPosition) => {
            try {
                localStorage.setItem(keys.position, JSON.stringify(next));
            } catch {
                /* ignore */
            }
        },
        [keys.position],
    );

    const persistSize = useCallback(
        (next: WidgetSize) => {
            try {
                localStorage.setItem(keys.size, JSON.stringify(next));
            } catch {
                /* ignore */
            }
        },
        [keys.size],
    );

    const clampToShell = useCallback((x: number, y: number, w: number, h: number) => clampPosition(x, y, w, h), []);

    useEffect(() => {
        if (def.id === "music") migrateLegacyMusicStorage(keys);
        const storedSize = loadJson(keys.size, isSize) ?? def.defaultSize;
        const nextSize = clampSize(storedSize.width, storedSize.height, def);
        const storedPos = loadJson(keys.position, isPosition);
        const fallbackPos = defaultPosition(nextSize.width, nextSize.height, def.placementIndex);
        const nextPos = clampToShell(
            (storedPos ?? fallbackPos).x,
            (storedPos ?? fallbackPos).y,
            nextSize.width,
            nextSize.height,
        );
        setSize(nextSize);
        sizeRef.current = nextSize;
        setPosition(nextPos);
        positionRef.current = nextPos;
        setReady(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- init once per widget id
    }, [def.id]);

    useEffect(() => {
        if (!ready) return;
        const onResize = () => {
            const nextSize = clampSize(sizeRef.current.width, sizeRef.current.height, def);
            const nextPos = clampToShell(positionRef.current.x, positionRef.current.y, nextSize.width, nextSize.height);
            setSize(nextSize);
            sizeRef.current = nextSize;
            setPosition(nextPos);
            positionRef.current = nextPos;
            persistSize(nextSize);
            persistPosition(nextPos);
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [clampToShell, def, persistPosition, persistSize, ready]);

    const endInteraction = useCallback(() => {
        const wasDrag = Boolean(dragRef.current);
        const wasResize = Boolean(resizeRef.current);
        dragRef.current = null;
        resizeRef.current = null;
        if (wasDrag || wasResize) {
            persistPosition(positionRef.current);
            if (wasResize) persistSize(sizeRef.current);
        }
    }, [persistPosition, persistSize]);

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            if (dragRef.current) {
                const dx = e.clientX - dragRef.current.startX;
                const dy = e.clientY - dragRef.current.startY;
                const next = clampToShell(
                    dragRef.current.origX + dx,
                    dragRef.current.origY + dy,
                    sizeRef.current.width,
                    sizeRef.current.height,
                );
                setPosition(next);
                positionRef.current = next;
                return;
            }
            if (resizeRef.current) {
                const r = resizeRef.current;
                const dx = e.clientX - r.startX;
                const dy = e.clientY - r.startY;
                if (r.corner === "sw") {
                    // Bottom-left: grow leftward, keeping the right edge anchored.
                    const nextSize = clampSize(r.origW - dx, r.origH + dy, def);
                    const rightEdge = r.origX + r.origW;
                    const nextPos = clampToShell(rightEdge - nextSize.width, positionRef.current.y, nextSize.width, nextSize.height);
                    setSize(nextSize);
                    sizeRef.current = nextSize;
                    setPosition(nextPos);
                    positionRef.current = nextPos;
                } else {
                    // Bottom-right: grow rightward / downward from the fixed top-left.
                    const nextSize = clampSize(r.origW + dx, r.origH + dy, def);
                    const nextPos = clampToShell(positionRef.current.x, positionRef.current.y, nextSize.width, nextSize.height);
                    setSize(nextSize);
                    sizeRef.current = nextSize;
                    setPosition(nextPos);
                    positionRef.current = nextPos;
                }
            }
        };

        const onUp = () => endInteraction();

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
        };
    }, [clampToShell, def, endInteraction]);

    const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            origX: positionRef.current.x,
            origY: positionRef.current.y,
        };
    }, []);

    const onResizePointerDown = useCallback((e: React.PointerEvent, corner: ResizeCorner = "se") => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        resizeRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            origX: positionRef.current.x,
            origW: sizeRef.current.width,
            origH: sizeRef.current.height,
            corner,
        };
    }, []);

    return {
        ready,
        position,
        size,
        shellRef,
        onHeaderPointerDown,
        onResizePointerDown,
    };
}

export function loadWidgetOpen(id: string): boolean {
    try {
        const keys = storageKeys(id);
        if (id === "music") migrateLegacyMusicStorage(keys);
        return localStorage.getItem(keys.open) === "1";
    } catch {
        return false;
    }
}

export function saveWidgetOpen(id: string, open: boolean) {
    try {
        localStorage.setItem(storageKeys(id).open, open ? "1" : "0");
    } catch {
        /* ignore */
    }
}
