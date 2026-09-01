// @ts-nocheck
"use client";

// Shared selected-state for clickable priority / role badge pills and agent
// chips. Uses a quiet neutral ring instead of the brand (red) outline so
// selection reads as polished UI chrome rather than an error/alert affordance.

import type { CSSProperties } from "react";
import { cx } from "@/utils/cx";

/** Classes for a clickable badge pill (priority, role). */
export function pillSelectClass(on: boolean): string {
  return cx(
    "rounded-lg outline-none transition",
    on
      ? "opacity-100 ring-2 ring-[color-mix(in_srgb,var(--c-text-primary)_18%,transparent)] ring-offset-2 ring-offset-[var(--surface)]"
      : "opacity-45 hover:opacity-80",
  );
}

/** Inline styles for a selectable agent / option chip (avatar + name). */
export function chipSelectStyle(on: boolean): CSSProperties {
  return {
    border: "1px solid var(--c-border)",
    background: on ? "var(--surface-2)" : "var(--surface)",
    boxShadow: on
      ? "inset 0 0 0 1px color-mix(in srgb, var(--c-text-primary) 10%, transparent)"
      : undefined,
  };
}

export function chipSelectClass(on: boolean): string {
  return cx(
    "flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm transition",
    on ? "opacity-100" : "opacity-60 hover:opacity-100",
  );
}
