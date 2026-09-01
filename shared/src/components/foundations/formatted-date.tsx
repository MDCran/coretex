// @ts-nocheck
/**
 * Client components that render a date / date+time using the user's globally
 * chosen format preference (see `@/lib/datetime-prefs`).
 *
 * Hydration safety: on the very first paint we render with the DEFAULT format so
 * the server-rendered HTML and the first client render match. After mount we read
 * the stored preference and re-render with the user's chosen format. This mirrors
 * the mounted-guard pattern used for the theme (see `src/providers/theme.tsx`).
 *
 * For Server Components that need the user's format on first paint, read
 * `readServerDateTimePrefs()` and call `formatDateWith` / `formatDateTimeWith`
 * directly instead of using these components.
 */

import { useEffect, useState } from "react";
import {
    formatDateTimeWith,
    formatDateWith,
    type DateFormatId,
    type DateInput,
    type TimeFormatId,
} from "@/lib/datetime-format";
import { readClientDateTimePrefs } from "@/lib/datetime-prefs";
import { useDateFormatPrefs } from "@/components/foundations/date-format-context";

interface FormattedDateProps {
    /** Date | ISO string | epoch ms to render. */
    value: DateInput;
    /** Explicit override — when set, ignores the global preference entirely. */
    dateId?: DateFormatId;
    /** Rendered when the value is empty / invalid. */
    fallback?: string;
    className?: string;
}

interface FormattedDateTimeProps extends FormattedDateProps {
    /** Explicit time-format override — when set, ignores the global preference. */
    timeId?: TimeFormatId;
}

/** Renders a date-only value in the user's chosen date format (server-seeded, flash-free). */
export function FormattedDate({ value, dateId, fallback = "—", className }: FormattedDateProps) {
    const seeded = useDateFormatPrefs();
    const [prefs, setPrefs] = useState(seeded);
    // After mount, pick up any change the user made this session without a reload.
    useEffect(() => setPrefs(readClientDateTimePrefs()), []);

    const resolvedDateId: DateFormatId = dateId ?? prefs.date;
    const text = formatDateWith(value, resolvedDateId);

    return (
        <time className={className} dateTime={toIsoAttr(value)}>
            {text || fallback}
        </time>
    );
}

/** Renders a date + time value in the user's chosen date and time formats (server-seeded, flash-free). */
export function FormattedDateTime({ value, dateId, timeId, fallback = "—", className }: FormattedDateTimeProps) {
    const seeded = useDateFormatPrefs();
    const [prefs, setPrefs] = useState(seeded);
    useEffect(() => setPrefs(readClientDateTimePrefs()), []);

    const resolvedDateId: DateFormatId = dateId ?? prefs.date;
    const resolvedTimeId: TimeFormatId = timeId ?? prefs.time;
    const text = formatDateTimeWith(value, resolvedDateId, resolvedTimeId);

    return (
        <time className={className} dateTime={toIsoAttr(value)}>
            {text || fallback}
        </time>
    );
}

/** Build a machine-readable `dateTime` attribute, or undefined for bad input. */
function toIsoAttr(value: DateInput): string | undefined {
    if (value == null || value === "") return undefined;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
