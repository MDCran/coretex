// @ts-nocheck
"use client";

// Coretex — shared cluster chip. The single source of truth for the softly squared chip
// used by both the bottom-right status cluster (Agents / Terminals / Alerts) and the
// bottom-center command bar (Ask AI / Search). A chip is: icon + label + optional count
// badge + a ChevronUp that rotates 180° when active. bg --surface (or --brand when active);
// a 1px --c-border; shadow-lg; and a soft brand-glow halo when lit.

import { useState } from "react";
import type { FC } from "react";
import { ChevronUp } from "@untitledui/icons";
import { motion, useReducedMotion } from "motion/react";
import { cx } from "@/utils/cx";

type IconCmp = FC<{ className?: string; style?: React.CSSProperties }>;

export interface ClusterChipProps {
  icon: IconCmp;
  label: string;
  /** Optional count badge — only rendered when > 0. */
  count?: number;
  /** Whether this chip's panel is open (drives brand fill + chevron flip + halo). */
  active: boolean;
  onClick: () => void;
  title?: string;
  /**
   * Visual tone. "default" reads as a neutral surface chip; "accent" reads as the brand
   * "Ask AI" chip (brand-tinted even when not active) so a chip can stand out as the
   * primary AI affordance.
   */
  tone?: "default" | "accent";
  /**
   * When true, the chip suppresses its own hover/tap scaling so it doesn't fight a parent
   * open/grow transition (e.g. the command palette growing out of the chip row).
   */
  suppressMotion?: boolean;
}

export const ClusterChip = ({
  icon: Icon,
  label,
  count = 0,
  active,
  onClick,
  title,
  tone = "default",
  suppressMotion = false,
}: ClusterChipProps) => {
  const accent = tone === "accent";
  const reduceMotion = useReducedMotion();
  const [hovered, setHovered] = useState(false);

  const idleBg = accent
    ? "color-mix(in srgb, var(--brand) 16%, var(--surface))"
    : "var(--surface)";
  const idleColor = accent ? "var(--brand)" : "var(--c-text-secondary)";
  const idleBorder = accent
    ? "color-mix(in srgb, var(--brand) 40%, var(--c-border))"
    : "var(--c-border)";

  // Hover lightens the surface a touch via tokens (not a brightness() filter, which snaps harshly).
  const hoverBg = accent
    ? "color-mix(in srgb, var(--brand) 26%, var(--surface))"
    : "color-mix(in srgb, var(--c-text-primary) 8%, var(--surface))";
  const hoverBorder = accent
    ? "color-mix(in srgb, var(--brand) 60%, var(--c-border))"
    : "color-mix(in srgb, var(--brand) 30%, var(--c-border))";

  const lit = hovered && !active;
  const background = active ? "var(--brand)" : lit ? hoverBg : idleBg;
  const borderColor = active ? "var(--brand)" : lit ? hoverBorder : idleBorder;

  // Box shadow: brand glow when active; on hover a soft brand glow lifts in; accent stays faintly lit.
  const boxShadow = active
    ? "0 8px 28px -6px var(--brand-glow, rgba(239,66,66,0.5))"
    : lit
      ? "0 8px 26px -8px var(--brand-glow, rgba(239,66,66,0.45))"
      : accent
        ? "0 6px 20px -8px var(--brand-glow, rgba(239,66,66,0.4))"
        : undefined;

  // Spring-driven micro-interaction; gated off under reduced motion or when a parent owns the transition.
  const motionOn = !reduceMotion && !suppressMotion && !active;
  const spring = { type: "spring" as const, stiffness: 400, damping: 26 };

  return (
    <motion.button
      type="button"
      tabIndex={0}
      onClick={onClick}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      whileHover={motionOn ? { scale: 1.04, y: -1 } : undefined}
      whileTap={!reduceMotion && !suppressMotion ? { scale: 0.97 } : undefined}
      transition={spring}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-lg transition-[background-color,box-shadow,color,border-color] duration-200 ease-out"
      style={{
        background,
        color: active
          ? "#fff"
          : lit && !accent
            ? "var(--c-text-primary)"
            : idleColor,
        border: `1px solid ${borderColor}`,
        boxShadow,
      }}
      title={title ?? (count > 0 ? `${label} (${count} active)` : label)}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
      {count > 0 && (
        <span
          className="flex h-4 min-w-4 items-center justify-center rounded-md px-1 text-[10px] font-bold tabular-nums"
          style={{
            background: active ? "rgba(255,255,255,0.25)" : "var(--brand)",
            color: "#fff",
          }}
        >
          {count}
        </span>
      )}
      <ChevronUp
        className={cx("size-3 transition-transform", active && "rotate-180")}
      />
    </motion.button>
  );
};
