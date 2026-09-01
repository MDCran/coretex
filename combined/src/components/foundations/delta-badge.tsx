"use client";

import { ArrowDown, ArrowUp, Minus } from "@untitledui/icons";
import { Badge, BadgeWithIcon } from "@/components/base/badges/badges";

/**
 * Shared "change marker" chip — the little up/down badge used across the app to
 * show movement in a stat (credit pts, money, weight, vitals, volume, …).
 *
 * Tone controls the good/bad coloring:
 *   - "directional" (default): up = green, down = red  (net worth, credit, income)
 *   - "inverse":               up = red,  down = green  (spending, weight, body-fat — lower is better)
 *   - "neutral":               gray either way          (ambiguous metrics: BP, custom readings)
 *
 * The arrow always reflects the literal direction of change; only the color encodes judgement.
 */
export type DeltaTone = "directional" | "inverse" | "neutral";

export function DeltaBadge({
    delta,
    unit = "",
    precision = 0,
    format,
    tone = "directional",
    evenLabel = "Even",
    hideWhenEven = false,
    size = "sm",
}: {
    /** Signed change. `null`/`undefined` → no prior value to compare against. */
    delta: number | null | undefined;
    /** Trailing unit, e.g. "pts", "kg", "%". Ignored when `format` is provided. */
    unit?: string;
    /** Decimal places used for rounding + the "even" threshold. */
    precision?: number;
    /** Custom formatter for the absolute magnitude (e.g. currency). */
    format?: (value: number) => string;
    tone?: DeltaTone;
    /** Label shown when the change rounds to ~0. */
    evenLabel?: string;
    /** When true, render nothing (instead of an "even"/"—" chip) for no-change / no-data. */
    hideWhenEven?: boolean;
    size?: "sm" | "md" | "lg";
}) {
    if (delta == null) {
        if (hideWhenEven) return null;
        return (
            <Badge color="gray" size={size} type="modern">
                —
            </Badge>
        );
    }

    const rounded = +delta.toFixed(precision);
    const threshold = precision > 0 ? 0.5 * 10 ** -precision : 1;
    if (Math.abs(rounded) < threshold) {
        if (hideWhenEven) return null;
        return (
            <BadgeWithIcon iconLeading={Minus} color="gray" size={size} type="modern">
                {evenLabel}
            </BadgeWithIcon>
        );
    }

    const up = rounded > 0;
    const color = tone === "neutral" ? "gray" : tone === "inverse" ? (up ? "error" : "success") : up ? "success" : "error";
    const magnitude = format ? format(Math.abs(rounded)) : `${Math.abs(rounded)}${unit ? ` ${unit}` : ""}`;
    const label = `${up ? "+" : "−"}${magnitude}`;

    return (
        <BadgeWithIcon iconLeading={up ? ArrowUp : ArrowDown} color={color} size={size} type="modern">
            {label}
        </BadgeWithIcon>
    );
}
