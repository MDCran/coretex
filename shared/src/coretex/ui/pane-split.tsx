// @ts-nocheck
"use client";

// Coretex — a draggable vertical divider for the Infrastructure split-pane view.
// Sits between two horizontal panes and reports a clamped ratio (0.2–0.8) as the
// user drags (pointer/mouse) or steps it with the keyboard (←/→). Purely a hit
// area + handle; the parent owns the ratio state and the actual pane layout.
//
// No animation needed (a resize handle should track the pointer 1:1), so this is
// reduced-motion-safe by construction.

import { useCallback, useEffect, useRef } from "react";
import { cx } from "@/utils/cx";

export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.8;

export const clampRatio = (r: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, r));

interface PaneSplitProps {
    /** Current split ratio (left pane fraction), 0.2–0.8. */
    ratio: number;
    /** Called with a new clamped ratio as the user drags / steps the divider. */
    onRatio: (r: number) => void;
    /** The container the panes live in — used to translate pointer X into a ratio. */
    containerRef: React.RefObject<HTMLElement | null>;
}

/**
 * A 6px-wide draggable divider with a brand hover highlight. Drag with the mouse
 * to resize; focus it and press ←/→ (or Home/End) for accessible stepping.
 */
export const PaneSplit = ({ ratio, onRatio, containerRef }: PaneSplitProps) => {
    const draggingRef = useRef(false);

    const ratioFromClientX = useCallback(
        (clientX: number) => {
            const el = containerRef.current;
            if (!el) return ratio;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0) return ratio;
            return clampRatio((clientX - rect.left) / rect.width);
        },
        [containerRef, ratio],
    );

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            if (!draggingRef.current) return;
            e.preventDefault();
            onRatio(ratioFromClientX(e.clientX));
        };
        const onUp = () => {
            if (!draggingRef.current) return;
            draggingRef.current = false;
            document.body.style.removeProperty("cursor");
            document.body.style.removeProperty("user-select");
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
    }, [onRatio, ratioFromClientX]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        const step = e.shiftKey ? 0.1 : 0.02;
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            onRatio(clampRatio(ratio - step));
        } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onRatio(clampRatio(ratio + step));
        } else if (e.key === "Home") {
            e.preventDefault();
            onRatio(SPLIT_MIN);
        } else if (e.key === "End") {
            e.preventDefault();
            onRatio(SPLIT_MAX);
        }
    };

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panes"
            aria-valuemin={Math.round(SPLIT_MIN * 100)}
            aria-valuemax={Math.round(SPLIT_MAX * 100)}
            aria-valuenow={Math.round(ratio * 100)}
            tabIndex={0}
            onPointerDown={(e) => {
                e.preventDefault();
                draggingRef.current = true;
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
            }}
            onKeyDown={onKeyDown}
            className={cx(
                "group relative z-10 flex w-1.5 shrink-0 cursor-col-resize items-stretch justify-center",
                "outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
            )}
            style={{ background: "var(--c-border)" }}
        >
            {/* Wider invisible hit area so the 6px line is easy to grab. */}
            <span aria-hidden className="absolute inset-y-0 -left-1 -right-1" />
            {/* Brand highlight on hover / drag. */}
            <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                style={{ background: "var(--brand)" }}
            />
        </div>
    );
};
