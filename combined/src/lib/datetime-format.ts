/**
 * Date/time *format preset* library for LifeOS.
 *
 * This is the data layer behind a future global "Date & time format" setting
 * (mirroring the existing imperial/metric unit preference). It exposes a small
 * set of presets plus pure formatters that take a chosen format id.
 *
 * It is intentionally dependency-light: pure functions + date-fns only. No React,
 * no server-only APIs — safe to import anywhere (client, server, edge).
 *
 * Relationship to `@/lib/dates`:
 *   - `dates.ts` holds the *current* hardcoded app-wide display format (US-style).
 *   - This module holds the *selectable* presets a user can switch between. Once
 *     the global setting is wired up, the helpers in `dates.ts` can read the
 *     stored DateFormatId / TimeFormatId and delegate to `formatDateWith` etc.
 *
 * date-fns pattern reference (matches the style used in dates.ts):
 *   MMM = "Jun", MMMM = "June", EEEE = "Sunday", d = day, yyyy = year,
 *   h = 12-hour, HH = 24-hour, mm = minutes, a = AM/PM.
 */

import { format, isValid } from "date-fns";

export type DateInput = Date | string | number | null | undefined;

/** Identifiers for the selectable date format presets. */
export type DateFormatId = "us" | "iso" | "euro" | "long";

/** Identifiers for the selectable time format presets. */
export type TimeFormatId = "12h" | "24h";

export interface DateFormatOption {
    id: DateFormatId;
    /** Human-readable label for the settings UI. */
    label: string;
    /** Rendered example string for the preview (uses {@link PREVIEW_DATE}). */
    example: string;
    /** date-fns pattern for date-only rendering. */
    datePattern: string;
    /**
     * date-fns date+time patterns, keyed by time format. The time portion swaps
     * between 12-hour (`h:mm a`) and 24-hour (`HH:mm`) without changing the date
     * portion of the preset.
     */
    dateTimePattern: Record<TimeFormatId, string>;
}

export interface TimeFormatOption {
    id: TimeFormatId;
    label: string;
    /** date-fns pattern for time-only rendering. */
    timePattern: string;
}

/** The default preset, matching the current US-style output in `dates.ts`. */
export const DEFAULT_DATE_FORMAT: DateFormatId = "us";
export const DEFAULT_TIME_FORMAT: TimeFormatId = "12h";

/** Time-of-day patterns, shared by the date+time presets below. */
const TIME_PATTERN: Record<TimeFormatId, string> = {
    "12h": "h:mm a",
    "24h": "HH:mm",
};

/** A fixed reference instant used only to build the `example` preview strings. */
const PREVIEW_DATE = new Date(2026, 5, 7, 13, 30, 0); // Sun, 7 Jun 2026, 13:30

export const TIME_FORMAT_OPTIONS: TimeFormatOption[] = [
    { id: "12h", label: "12-hour (1:30 PM)", timePattern: TIME_PATTERN["12h"] },
    { id: "24h", label: "24-hour (13:30)", timePattern: TIME_PATTERN["24h"] },
];

export const DATE_FORMAT_OPTIONS: DateFormatOption[] = [
    {
        id: "us",
        label: "US (Jun 7, 2026)",
        example: format(PREVIEW_DATE, "MMM d, yyyy"),
        datePattern: "MMM d, yyyy",
        dateTimePattern: {
            "12h": "MMM d, yyyy · h:mm a",
            "24h": "MMM d, yyyy · HH:mm",
        },
    },
    {
        id: "iso",
        label: "ISO (2026-06-07)",
        example: format(PREVIEW_DATE, "yyyy-MM-dd"),
        datePattern: "yyyy-MM-dd",
        dateTimePattern: {
            "12h": "yyyy-MM-dd · h:mm a",
            "24h": "yyyy-MM-dd · HH:mm",
        },
    },
    {
        id: "euro",
        label: "European (7 Jun 2026)",
        example: format(PREVIEW_DATE, "d MMM yyyy"),
        datePattern: "d MMM yyyy",
        dateTimePattern: {
            "12h": "d MMM yyyy · h:mm a",
            "24h": "d MMM yyyy · HH:mm",
        },
    },
    {
        id: "long",
        label: "Long (Sunday, June 7, 2026)",
        example: format(PREVIEW_DATE, "EEEE, MMMM d, yyyy"),
        datePattern: "EEEE, MMMM d, yyyy",
        dateTimePattern: {
            "12h": "EEEE, MMMM d, yyyy · h:mm a",
            "24h": "EEEE, MMMM d, yyyy · HH:mm",
        },
    },
];

const DATE_FORMAT_BY_ID: Record<DateFormatId, DateFormatOption> = Object.fromEntries(
    DATE_FORMAT_OPTIONS.map((option) => [option.id, option]),
) as Record<DateFormatId, DateFormatOption>;

const TIME_FORMAT_BY_ID: Record<TimeFormatId, TimeFormatOption> = Object.fromEntries(
    TIME_FORMAT_OPTIONS.map((option) => [option.id, option]),
) as Record<TimeFormatId, TimeFormatOption>;

/** Resolve a preset by id, falling back to the default when unknown. */
export function getDateFormatOption(dateId: DateFormatId): DateFormatOption {
    return DATE_FORMAT_BY_ID[dateId] ?? DATE_FORMAT_BY_ID[DEFAULT_DATE_FORMAT];
}

export function getTimeFormatOption(timeId: TimeFormatId): TimeFormatOption {
    return TIME_FORMAT_BY_ID[timeId] ?? TIME_FORMAT_BY_ID[DEFAULT_TIME_FORMAT];
}

/** Coerce a Date | ISO string | epoch ms into a valid Date, or null. */
function toDate(value: DateInput): Date | null {
    if (value == null || value === "") return null;
    const d = value instanceof Date ? value : new Date(value);
    return isValid(d) ? d : null;
}

/**
 * Format a date using the chosen preset. Returns "" for invalid/empty input.
 * e.g. formatDateWith("2026-06-07T13:30:00", "euro") → "7 Jun 2026"
 */
export function formatDateWith(value: DateInput, dateId: DateFormatId): string {
    const d = toDate(value);
    if (!d) return "";
    return format(d, getDateFormatOption(dateId).datePattern);
}

/**
 * Format a date + time using the chosen date and time presets.
 * Returns "" for invalid/empty input.
 * e.g. formatDateTimeWith(Date.now(), "us", "24h") → "Jun 7, 2026 · 13:30"
 */
export function formatDateTimeWith(value: DateInput, dateId: DateFormatId, timeId: TimeFormatId): string {
    const d = toDate(value);
    if (!d) return "";
    const option = getDateFormatOption(dateId);
    const pattern = option.dateTimePattern[timeId] ?? option.dateTimePattern[DEFAULT_TIME_FORMAT];
    return format(d, pattern);
}

/**
 * Format the time-of-day using the chosen time preset.
 * Returns "" for invalid/empty input.
 * e.g. formatTimeWith(Date.now(), "24h") → "13:30"
 */
export function formatTimeWith(value: DateInput, timeId: TimeFormatId): string {
    const d = toDate(value);
    if (!d) return "";
    return format(d, getTimeFormatOption(timeId).timePattern);
}
