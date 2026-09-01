/** Currency + number formatting helpers for the Financial module. Client-safe. */

/**
 * Cached Intl.NumberFormat instances keyed by `currency|variant` so we don't rebuild a
 * formatter on every call (Intl construction is comparatively expensive). All helpers take
 * an optional `currency` (ISO 4217) and default to "USD" for backwards compatibility.
 */
const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(currency: string, variant: "full" | "whole" | "compact"): Intl.NumberFormat {
    const key = `${currency}|${variant}`;
    let fmt = formatterCache.get(key);
    if (!fmt) {
        const base: Intl.NumberFormatOptions = { style: "currency", currency };
        if (variant === "full") {
            base.minimumFractionDigits = 2;
            base.maximumFractionDigits = 2;
        } else if (variant === "whole") {
            base.maximumFractionDigits = 0;
        } else {
            base.notation = "compact";
            base.maximumFractionDigits = 1;
        }
        fmt = new Intl.NumberFormat("en-US", base);
        formatterCache.set(key, fmt);
    }
    return fmt;
}

/** Format a number as currency, e.g. $1,234.56. Pass `currency` (ISO 4217) to override; defaults to USD. */
export function formatCurrency(value: number | null | undefined, currency = "USD"): string {
    return getFormatter(currency, "full").format(Number(value ?? 0));
}

/** Format as whole-unit currency, e.g. $1,234. Pass `currency` to override; defaults to USD. */
export function formatCurrency0(value: number | null | undefined, currency = "USD"): string {
    return getFormatter(currency, "whole").format(Number(value ?? 0));
}

/** Compact currency for chart axis ticks, e.g. $12.3K. Pass `currency` to override; defaults to USD. */
export function formatCompact(value: number | null | undefined, currency = "USD"): string {
    return getFormatter(currency, "compact").format(Number(value ?? 0));
}

/** Format a fraction (0..1) as a percentage, e.g. 0.42 → 42%. */
export function formatPercent(value: number | null | undefined, fractionDigits = 0): string {
    const n = Number(value ?? 0);
    return `${(n * 100).toFixed(fractionDigits)}%`;
}

/** Format an ISO/Date as a short date, e.g. Jun 6, 2026. Re-exported from the app-wide date helpers. */
export { formatDate } from "@/lib/dates";

/** Normalize a subscription amount to a monthly cost given its cadence. */
export function monthlyFromCadence(amount: number, cadence: string): number {
    switch (cadence) {
        case "YEARLY":
            return amount / 12;
        case "WEEKLY":
            return (amount * 52) / 12;
        case "MONTHLY":
        default:
            return amount;
    }
}
