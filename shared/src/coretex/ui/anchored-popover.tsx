// @ts-nocheck
"use client";

// Coretex — a reusable anchored popover that NEVER clips off-screen. Mirrors the
// flip + clamp behavior of ui/context-menu.tsx but anchors to a trigger element
// (instead of a cursor point) and portals to <body> so it escapes any overflow
// clipping / stacking context of its dock or scroll container.
//
// Use it for dropdowns/menus that live inside an overflow-hidden region (e.g. the
// terminal-dock buddy bar at the bottom of the right rail) where a plain
// `absolute` panel would render below the fold and get clipped.
//
// Behavior:
//   - Portaled to document.body, position: fixed (viewport-relative).
//   - Prefers opening downward from the trigger; FLIPS UP when it would overflow
//     the viewport bottom, and clamps fully on-screen on every edge.
//   - Horizontally aligns to the trigger's left or right edge (per `align`),
//     flipping/clamping so it's never cut off at the right/left.
//   - Recomputes on scroll/resize (capture) so it tracks the trigger.
//   - Closes on outside mousedown / Esc / scroll-of-an-unrelated-region is the
//     caller's concern — this primitive only positions + portals + animates.
//   - 150ms ease-out entrance (opacity + small translateY), gated by
//     prefers-reduced-motion.

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/utils/cx";

const PAD = 8; // viewport padding kept around the panel
const GAP = 6; // gap between the trigger and the panel

const ANIM_STYLE_ID = "coretex-anchored-popover-anim";
function ensureAnimStyle() {
    if (typeof document === "undefined") return;
    if (document.getElementById(ANIM_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = ANIM_STYLE_ID;
    el.textContent = `
@keyframes coretex-pop-in-down { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes coretex-pop-in-up { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: no-preference) {
  .coretex-pop-panel[data-placement="down"] { animation: coretex-pop-in-down 150ms ease-out; }
  .coretex-pop-panel[data-placement="up"] { animation: coretex-pop-in-up 150ms ease-out; }
}`;
    document.head.appendChild(el);
}

interface AnchoredPopoverProps {
    /** The trigger element the panel anchors to. */
    anchorRef: RefObject<HTMLElement | null>;
    /** Close handler — fired on outside mousedown / Esc / window blur. */
    onClose: () => void;
    children: ReactNode;
    /** Horizontal edge of the trigger to align the panel to (default "left"). */
    align?: "left" | "right";
    className?: string;
    /** Inline style merged onto the panel (e.g. background/border tokens). */
    style?: React.CSSProperties;
    /** ARIA role for the panel (default "dialog"; pass "menu"/"listbox" as needed). */
    role?: string;
    "aria-label"?: string;
}

/**
 * Portaled, viewport-clamped popover. The panel measures itself after mount and on
 * every scroll/resize, choosing down vs up placement and clamping to the viewport.
 */
export const AnchoredPopover = ({
    anchorRef,
    onClose,
    children,
    align = "left",
    className,
    style,
    role = "dialog",
    "aria-label": ariaLabel,
}: AnchoredPopoverProps) => {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ left: number; top: number; placement: "up" | "down" } | null>(null);

    useLayoutEffect(() => {
        ensureAnimStyle();
    }, []);

    const reposition = useCallback(() => {
        const anchor = anchorRef.current;
        const panel = panelRef.current;
        if (!anchor || !panel || typeof window === "undefined") return;
        const a = anchor.getBoundingClientRect();
        const w = panel.offsetWidth;
        const h = panel.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Vertical: prefer below; flip above when it would overflow the bottom and
        // there's more room above.
        const spaceBelow = vh - a.bottom - GAP - PAD;
        const spaceAbove = a.top - GAP - PAD;
        let placement: "up" | "down" = "down";
        let top = a.bottom + GAP;
        if (h > spaceBelow && spaceAbove > spaceBelow) {
            placement = "up";
            top = a.top - GAP - h;
        }

        // Horizontal: align to the requested edge, then flip/clamp on overflow.
        let left = align === "right" ? a.right - w : a.left;
        if (left + w > vw - PAD) left = vw - PAD - w;
        if (left < PAD) left = PAD;

        // Final vertical clamp so the panel is always fully visible.
        top = Math.min(Math.max(PAD, top), Math.max(PAD, vh - h - PAD));

        setPos({ left, top, placement });
    }, [anchorRef, align]);

    // Measure after mount (and whenever children change size) + track scroll/resize.
    useLayoutEffect(() => {
        reposition();
        const onScroll = () => reposition();
        const onResize = () => reposition();
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", onResize);
        };
    }, [reposition]);

    // Close on Esc / outside mousedown / window blur. Clicks on the anchor itself
    // are ignored here so the trigger's own toggle handler can run.
    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node | null;
            if (panelRef.current && t && panelRef.current.contains(t)) return;
            if (anchorRef.current && t && anchorRef.current.contains(t)) return;
            onClose();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
            }
        };
        const onBlur = () => onClose();
        window.addEventListener("mousedown", onDown);
        window.addEventListener("keydown", onKey);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("mousedown", onDown);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("blur", onBlur);
        };
    }, [anchorRef, onClose]);

    if (typeof document === "undefined") return null;

    return createPortal(
        <div
            ref={panelRef}
            role={role}
            aria-label={ariaLabel}
            data-placement={pos?.placement ?? "down"}
            onMouseDown={(e) => e.stopPropagation()}
            className={cx("coretex-pop-panel fixed z-[70] outline-none", className)}
            style={{
                left: pos?.left ?? -9999,
                top: pos?.top ?? -9999,
                // Hide until first measure so it never flashes at the wrong spot.
                visibility: pos ? "visible" : "hidden",
                ...style,
            }}
        >
            {children}
        </div>,
        document.body,
    );
};
