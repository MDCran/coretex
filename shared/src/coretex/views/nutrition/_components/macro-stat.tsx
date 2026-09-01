// @ts-nocheck
import { cx } from "@/utils/cx";

/**
 * Single source of truth for how nutrition numbers render across the module:
 * daily totals banner, per-meal subtotals, per-entry chips, goals banner and
 * month-view cells all go through these.
 *
 * Format contract:
 *   - value bold + unit muted ("1,840 kcal", "142 g", "64 oz", "1,900 ml")
 *   - locale separators via toLocaleString
 *   - grams: max 1 decimal; kcal / ml / oz / mg: whole numbers
 *
 * Water: convert stored ml with `volumeToDisplay(ml, unitSystem)` from
 * `@/lib/units` and pass `volumeUnit(unitSystem)` as the unit.
 */

export type MacroUnit = "kcal" | "g" | "mg" | "oz" | "fl oz" | "ml";

/** Locale-format a macro value for its unit (grams ≤1 dp, everything else 0 dp). */
export function formatMacroValue(value: number | null | undefined, unit: MacroUnit): string {
    const n = value != null && Number.isFinite(value) ? value : 0;
    return n.toLocaleString("en-US", { maximumFractionDigits: unit === "g" ? 1 : 0 });
}

const SIZES = {
    /** Month cells / dense chips. */
    xs: "text-xs",
    /** Default: list rows, card headers. */
    sm: "text-sm",
    /** Banner emphasis. */
    md: "text-md",
} as const;

/**
 * Inline stat: bold value, optional muted "/ goal", muted unit.
 * e.g. <MacroStat value={1840} goal={2200} unit="kcal" /> → **1,840** / 2,200 kcal
 */
export function MacroStat({
    value,
    unit,
    goal,
    size = "sm",
    className,
}: {
    value: number | null | undefined;
    unit: MacroUnit;
    /** Optional target — renders as a muted "/ goal" after the value. */
    goal?: number | null;
    size?: keyof typeof SIZES;
    className?: string;
}) {
    return (
        <span className={cx("inline-flex items-baseline gap-1 tabular-nums whitespace-nowrap", SIZES[size], className)}>
            <span className="font-semibold text-primary">{formatMacroValue(value, unit)}</span>
            {goal != null && <span className="text-tertiary">/ {formatMacroValue(goal, unit)}</span>}
            <span className="text-tertiary">{unit}</span>
        </span>
    );
}

/**
 * Compact pill chip for entry rows / meal subtotals: optional label
 * ("P" / "C" / "F"), then the same bold-value + muted-unit format.
 */
export function MacroChip({
    label,
    value,
    unit,
    className,
}: {
    label?: string;
    value: number | null | undefined;
    unit: MacroUnit;
    className?: string;
}) {
    return (
        <span className={cx("inline-flex items-baseline gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-xs tabular-nums whitespace-nowrap", className)}>
            {label && <span className="font-medium text-quaternary">{label}</span>}
            <span className="font-semibold text-secondary">{formatMacroValue(value, unit)}</span>
            <span className="text-tertiary">{unit}</span>
        </span>
    );
}
