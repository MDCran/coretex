/**
 * Centralized, app-wide date/time *display* formatting helpers.
 *
 * Every user-visible date or time render should go through one of these so the
 * whole app reads the same format:
 *   - formatDate(d)      → "Jun 7, 2026"
 *   - formatDateTime(d)  → "Jun 7, 2026, 1:30 PM"
 *   - formatTime(d)      → "1:30 PM"
 *   - formatDateShort(d) → "Jun 7"      (space-tight: table cells, chart axes, chips)
 *   - formatRelative(d)  → "3 days ago" (re-exported convenience)
 *
 * NOTE: these are for *display only*. Internal value formats (ISO strings used
 * in <input> values, URLs, object keys, server actions) must NOT use these —
 * keep using ISO (yyyy-MM-dd / yyyy-MM-ddTHH:mm) for those.
 */

import { format, formatDistanceToNow, isValid } from "date-fns";

type DateInput = Date | string | number | null | undefined;

/** Coerce a Date | ISO string | epoch into a valid Date, or null. */
function toDate(value: DateInput): Date | null {
    if (value == null || value === "") return null;
    const d = value instanceof Date ? value : new Date(value);
    return isValid(d) ? d : null;
}

/** "Jun 7, 2026" */
export function formatDate(value: DateInput, fallback = "—"): string {
    const d = toDate(value);
    return d ? format(d, "MMM d, yyyy") : fallback;
}

/** "Jun 7, 2026, 1:30 PM" */
export function formatDateTime(value: DateInput, fallback = "—"): string {
    const d = toDate(value);
    return d ? format(d, "MMM d, yyyy, h:mm a") : fallback;
}

/** "1:30 PM" */
export function formatTime(value: DateInput, fallback = "—"): string {
    const d = toDate(value);
    return d ? format(d, "h:mm a") : fallback;
}

/** "Jun 7" — space-tight contexts (tables, chart axes, chips). */
export function formatDateShort(value: DateInput, fallback = "—"): string {
    const d = toDate(value);
    return d ? format(d, "MMM d") : fallback;
}

/**
 * "Jun 7, 2026" for a bare calendar date — parses a "YYYY-MM-DD" string as LOCAL
 * midnight so it never shifts across timezones.
 *
 * Use this (NOT formatDate) for date-only values emitted as "YYYY-MM-DD" strings
 * (e.g. @db.Date columns). formatDate runs `new Date("YYYY-MM-DD")`, which parses
 * to UTC midnight and then renders in local time — users west of UTC see the
 * PREVIOUS day. This splits the string and constructs local midnight instead.
 */
export function formatDateOnly(value: string | null | undefined, fallback = "—"): string {
    const s = (value ?? "").trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return formatDate(s, fallback);
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isValid(d) ? format(d, "MMM d, yyyy") : fallback;
}

/** "Jun 2026" — month + year only. */
export function formatMonthYear(value: DateInput, fallback = "—"): string {
    const d = toDate(value);
    return d ? format(d, "MMM yyyy") : fallback;
}

/** "3 days ago" / "in 2 months" — relative to now. */
export function formatRelative(value: DateInput, fallback = "—"): string {
    const d = toDate(value);
    return d ? formatDistanceToNow(d, { addSuffix: true }) : fallback;
}
