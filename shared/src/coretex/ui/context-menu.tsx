// @ts-nocheck
"use client";

// Coretex — reusable right-click context-menu primitive. Generalizes the ad-hoc
// ctxMenu pattern from terminal-dock.tsx (and the swatch menu in color-picker)
// into one accessible, themed, cursor-anchored menu.
//
// Two ways to use it:
//   1. useContextMenu() hook → { open, close, node }. Call open(e, items) from an
//      onContextMenu handler, render {node} once near the root of your component.
//   2. <ContextMenu items={...}>{children}</ContextMenu> wrapper — attaches the
//      handler for you; items may be an array or a function evaluated at open time.
//
// Behavior: anchors at the cursor, flips when it would overflow the viewport
// right/bottom, closes on Esc / outside mousedown / scroll / window blur / after
// an item runs, supports ArrowUp/Down/Enter/Esc keyboard nav. Content stops
// mousedown propagation so a global outside-click closer doesn't swallow it.

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type FC,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/utils/cx";

export type MenuItem =
    | {
          key: string;
          label: string;
          icon?: FC<{ className?: string }>;
          onClick: () => void;
          danger?: boolean;
          disabled?: boolean;
          shortcut?: string;
          checked?: boolean;
      }
    | {
          /** A submenu: hovering/right-arrow opens a nested flyout of `submenu` items. */
          key: string;
          label: string;
          icon?: FC<{ className?: string }>;
          submenu: MenuItem[];
          disabled?: boolean;
          danger?: boolean;
      }
    | { separator: true }
    | { header: string };

/** An actionable entry (not a separator/header) — either a click item or a submenu parent. */
type ActionItem = Extract<MenuItem, { key: string }>;
/** A submenu parent entry. */
type SubmenuItem = Extract<MenuItem, { submenu: MenuItem[] }>;

function isAction(item: MenuItem): item is ActionItem {
    return "key" in item;
}

function isSubmenu(item: MenuItem): item is SubmenuItem {
    return "submenu" in item;
}

interface MenuState {
    x: number;
    y: number;
    items: MenuItem[];
}

export interface UseContextMenu {
    /** Open the menu at the cursor with the given items (prevents the native menu). */
    open: (e: React.MouseEvent, items: MenuItem[]) => void;
    /** Close the menu if open. */
    close: () => void;
    /** Render this once in your tree; it draws the menu when open. */
    node: ReactNode;
}

export function useContextMenu(): UseContextMenu {
    const [menu, setMenu] = useState<MenuState | null>(null);

    const open = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY, items });
    }, []);

    const close = useCallback(() => setMenu(null), []);

    const node = menu ? <ContextMenuView menu={menu} onClose={close} /> : null;

    return { open, close, node };
}

// ---- The rendered menu ----------------------------------------------------

const PAD = 8; // viewport padding kept around any panel

// Entrance keyframes (opacity + small translateY), gated by prefers-reduced-motion
// via a CSS @media block so we don't need a JS media query. Injected once.
const ANIM_STYLE_ID = "coretex-context-menu-anim";
function ensureAnimStyle() {
    if (typeof document === "undefined") return;
    if (document.getElementById(ANIM_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = ANIM_STYLE_ID;
    el.textContent = `
@keyframes coretex-ctxmenu-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: no-preference) {
  .coretex-ctxmenu-panel { animation: coretex-ctxmenu-in 150ms ease-out; }
}`;
    document.head.appendChild(el);
}

/**
 * Top-level menu opened at the cursor. Owns the global close listeners and renders
 * the root MenuPanel anchored at the click point.
 */
const ContextMenuView = ({ menu, onClose }: { menu: MenuState; onClose: () => void }) => {
    const rootRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        ensureAnimStyle();
    }, []);

    // Close on outside mousedown / scroll / window blur. The root wrapper contains
    // every panel (submenu flyouts are nested inside it), so contains() works for all.
    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return;
            onClose();
        };
        const onScroll = () => onClose();
        const onBlur = () => onClose();
        window.addEventListener("mousedown", onDown);
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("mousedown", onDown);
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("blur", onBlur);
        };
    }, [onClose]);

    const panel = (
        <div
            ref={rootRef}
            // Stop mousedown propagation so a global outside-click closer doesn't swallow clicks.
            onMouseDown={(e) => e.stopPropagation()}
        >
            <MenuPanel items={menu.items} anchor={{ x: menu.x, y: menu.y }} onClose={onClose} autoFocus isRoot />
        </div>
    );
    // Portaling to body keeps fixed cursor coordinates correct even when the
    // canvas lives inside a transformed page-transition or zoom container.
    return typeof document === "undefined" ? null : createPortal(panel, document.body);
};

/** Where a panel anchors. Root uses a point; submenus anchor to a parent item's rect. */
type Anchor =
    | { x: number; y: number } // cursor point (root)
    | { rect: DOMRect }; // parent item bounds (submenu opens to its right/left)

interface MenuPanelProps {
    items: MenuItem[];
    anchor: Anchor;
    onClose: () => void;
    /** Called when this panel wants focus to return to its parent (left-arrow / leave). */
    onCloseSelf?: () => void;
    autoFocus?: boolean;
    isRoot?: boolean;
}

/** One level of the menu. Recurses for submenus, rendering a flyout to the side. */
const MenuPanel = ({ items, anchor, onClose, onCloseSelf, autoFocus, isRoot }: MenuPanelProps) => {
    const ref = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ left: number; top: number }>(() =>
        "x" in anchor ? { left: anchor.x, top: anchor.y } : { left: -9999, top: -9999 },
    );
    // Index of the keyboard-focused actionable item (-1 = none).
    const [active, setActive] = useState(-1);
    // Index of the open submenu's parent item (-1 = none).
    const [openSub, setOpenSub] = useState(-1);
    const [subRect, setSubRect] = useState<DOMRect | null>(null);
    const itemRefs = useRef<Record<number, HTMLButtonElement | null>>({});

    // Indices of actionable (focusable) items, in DOM order.
    const actionIndexes = items.reduce<number[]>((acc, item, i) => {
        if (isAction(item) && !item.disabled) acc.push(i);
        return acc;
    }, []);

    // Position the panel. Root anchors at the cursor and flips when overflowing.
    // Submenus open to the right of the parent rect, flipping to the left edge if
    // they'd overflow the right. Both clamp fully inside the viewport.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || typeof window === "undefined") return;
        const { offsetWidth: w, offsetHeight: h } = el;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left: number;
        let top: number;
        if ("x" in anchor) {
            left = anchor.x;
            top = anchor.y;
            if (left + w > vw - PAD) left = anchor.x - w;
            if (top + h > vh - PAD) top = anchor.y - h;
        } else {
            const r = anchor.rect;
            // Prefer opening to the right of the parent item; flip left on overflow.
            left = r.right - 2;
            if (left + w > vw - PAD) left = r.left - w + 2;
            top = r.top - 6; // align roughly with parent row, accounting for panel padding
            if (top + h > vh - PAD) top = vh - PAD - h;
        }
        // Final clamp so top/left are never negative and never overflow bottom/right.
        left = Math.min(Math.max(PAD, left), Math.max(PAD, vw - w - PAD));
        top = Math.min(Math.max(PAD, top), Math.max(PAD, vh - h - PAD));
        setPos({ left, top });
    }, [anchor, items]);

    const runItem = useCallback(
        (item: ActionItem) => {
            if (item.disabled) return;
            if (isSubmenu(item)) return; // submenu parents don't "run"
            onClose();
            item.onClick();
        },
        [onClose],
    );

    const openSubmenu = useCallback((i: number) => {
        const el = itemRefs.current[i];
        if (!el) return;
        setSubRect(el.getBoundingClientRect());
        setOpenSub(i);
    }, []);

    const closeSubmenu = useCallback(() => {
        setOpenSub(-1);
        setSubRect(null);
        ref.current?.focus();
    }, []);

    // Keyboard navigation. When a submenu is open the child panel owns the keys;
    // this handler is gated on `openSub < 0` so only the deepest panel responds.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (openSub >= 0) return; // child panel handles keys while open
            if (e.key === "Escape") {
                e.preventDefault();
                if (isRoot) onClose();
                else onCloseSelf?.();
                return;
            }
            if (e.key === "ArrowLeft" && !isRoot) {
                e.preventDefault();
                onCloseSelf?.();
                return;
            }
            if (actionIndexes.length === 0) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive((prev) => {
                    const cur = actionIndexes.indexOf(prev);
                    const dir = e.key === "ArrowDown" ? 1 : -1;
                    const next =
                        cur < 0 ? (dir > 0 ? 0 : actionIndexes.length - 1) : (cur + dir + actionIndexes.length) % actionIndexes.length;
                    return actionIndexes[next];
                });
            } else if (e.key === "ArrowRight") {
                const item = active >= 0 ? items[active] : undefined;
                if (item && isSubmenu(item) && !item.disabled) {
                    e.preventDefault();
                    openSubmenu(active);
                }
            } else if (e.key === "Enter") {
                e.preventDefault();
                const item = active >= 0 ? items[active] : undefined;
                if (!item || !isAction(item)) return;
                if (isSubmenu(item)) {
                    if (!item.disabled) openSubmenu(active);
                } else {
                    runItem(item);
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [actionIndexes, active, items, isRoot, onClose, onCloseSelf, openSub, openSubmenu, runItem]);

    // Focus the container so it receives key events without stealing app focus oddly.
    useEffect(() => {
        if (autoFocus) ref.current?.focus();
    }, [autoFocus]);

    const hasIcons = items.some((it) => isAction(it) && it.icon);
    const submenuParent = openSub >= 0 ? items[openSub] : undefined;

    return (
        <div
            ref={ref}
            role="menu"
            tabIndex={-1}
            aria-orientation="vertical"
            onContextMenu={(e) => {
                e.preventDefault();
                onClose();
            }}
            className="coretex-ctxmenu-panel fixed z-[70] min-w-44 max-w-72 rounded-lg p-1.5 shadow-xl outline-none backdrop-blur-md"
            style={{
                left: pos.left,
                top: pos.top,
                background: "color-mix(in srgb, var(--surface) 92%, transparent)",
                border: "1px solid var(--c-border)",
            }}
        >
            {items.map((item, i) => {
                if ("separator" in item) {
                    return <div key={`sep-${i}`} role="separator" className="my-1 h-px" style={{ background: "var(--c-border)" }} />;
                }
                if ("header" in item) {
                    return (
                        <p key={`hdr-${i}`} className="px-2 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--c-text-muted)" }}>
                            {item.header}
                        </p>
                    );
                }
                const Icon = item.icon;
                const isActive = i === active;
                const sub = isSubmenu(item);
                const checked = !sub ? item.checked : undefined;
                const shortcut = !sub ? item.shortcut : undefined;
                return (
                    <button
                        key={item.key}
                        ref={(el) => {
                            itemRefs.current[i] = el;
                        }}
                        type="button"
                        role="menuitem"
                        aria-haspopup={sub ? "menu" : undefined}
                        aria-expanded={sub ? openSub === i : undefined}
                        disabled={item.disabled}
                        aria-disabled={item.disabled}
                        aria-checked={checked}
                        onClick={() => {
                            if (sub) {
                                if (!item.disabled) openSubmenu(i);
                            } else {
                                runItem(item);
                            }
                        }}
                        onMouseEnter={() => {
                            setActive(i);
                            if (sub && !item.disabled) openSubmenu(i);
                            else if (openSub >= 0 && openSub !== i) {
                                // Moving onto a non-submenu item closes any open flyout.
                                setOpenSub(-1);
                                setSubRect(null);
                            }
                        }}
                        className={cx(
                            "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-[background-color,color,box-shadow] duration-150 ease-out",
                            item.disabled ? "cursor-not-allowed opacity-50" : "hover:bg-[var(--surface-2)]",
                            isActive && !item.disabled && "bg-[var(--surface-2)]",
                        )}
                        style={{
                            color: item.danger ? "var(--c-error)" : "var(--c-text-secondary)",
                        }}
                    >
                        {Icon ? (
                            <Icon className="size-3.5 shrink-0" />
                        ) : (
                            // Keep alignment when some items have icons and others don't.
                            hasIcons ? <span className="size-3.5 shrink-0" /> : null
                        )}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {checked && <span className="shrink-0 text-xs" style={{ color: "var(--brand)" }}>✓</span>}
                        {shortcut && (
                            <span className="ml-auto shrink-0 pl-3 text-xs" style={{ color: "var(--c-text-muted)" }}>
                                {shortcut}
                            </span>
                        )}
                        {sub && (
                            <span className="ml-auto shrink-0 pl-3 text-xs leading-none" aria-hidden style={{ color: "var(--c-text-muted)" }}>
                                ›
                            </span>
                        )}
                    </button>
                );
            })}

            {submenuParent && isSubmenu(submenuParent) && subRect && (
                <MenuPanel
                    items={submenuParent.submenu}
                    anchor={{ rect: subRect }}
                    onClose={onClose}
                    onCloseSelf={closeSubmenu}
                    autoFocus
                />
            )}
        </div>
    );
};

// ---- Convenience wrapper --------------------------------------------------

interface ContextMenuProps {
    /** Items, or a function evaluated when the menu opens (for live state). */
    items: MenuItem[] | (() => MenuItem[]);
    children: ReactNode;
    /** Render as a block-level <div> instead of an inline <span>. */
    asBlock?: boolean;
    className?: string;
    disabled?: boolean;
}

/** Wraps children and opens the context menu on right-click. */
export const ContextMenu = ({ items, children, asBlock, className, disabled }: ContextMenuProps) => {
    const { open, node } = useContextMenu();
    const onContextMenu = (e: React.MouseEvent) => {
        if (disabled) return;
        const resolved = typeof items === "function" ? items() : items;
        if (resolved.length === 0) return;
        open(e, resolved);
    };
    const Tag = asBlock ? "div" : "span";
    return (
        <>
            <Tag className={className} onContextMenu={onContextMenu}>
                {children}
            </Tag>
            {node}
        </>
    );
};
