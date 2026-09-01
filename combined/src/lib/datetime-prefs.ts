/**
 * Persistence helpers for the global "Date & time format" preference.
 *
 * The preference is stored in BOTH a cookie and localStorage:
 *   - Cookie ("lifeos.dtfmt") so SERVER components / actions can read it (see
 *     {@link file://./datetime-prefs-server.ts} for the server reader).
 *   - localStorage as a fast, synchronous client mirror that survives even if the
 *     cookie is cleared by privacy tooling.
 *
 * IMPORTANT: this module must stay **client-safe** — it never imports
 * `next/headers` or `server-only`. The server-side reader lives in the separate
 * `datetime-prefs-server.ts` file so importing this one from a Client Component
 * never drags in server-only code.
 *
 * Stored value shape (JSON): { "date": DateFormatId, "time": TimeFormatId }
 */

import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, type DateFormatId, type TimeFormatId } from "@/lib/datetime-format";

export interface DateTimePrefs {
    date: DateFormatId;
    time: TimeFormatId;
}

/** Cookie / localStorage key. Shared with the server reader. */
export const DT_PREFS_COOKIE = "lifeos.dtfmt";

/** ~1 year, in seconds. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** The fallback used whenever nothing is stored or the stored value is invalid. */
export const DEFAULT_DATETIME_PREFS: DateTimePrefs = {
    date: DEFAULT_DATE_FORMAT,
    time: DEFAULT_TIME_FORMAT,
};

const VALID_DATE_IDS: ReadonlySet<string> = new Set<DateFormatId>(["us", "iso", "euro", "long"]);
const VALID_TIME_IDS: ReadonlySet<string> = new Set<TimeFormatId>(["12h", "24h"]);

/**
 * Coerce an arbitrary parsed value into a valid {@link DateTimePrefs}, falling
 * back per-field to the defaults. Exported so the server reader can reuse the
 * exact same validation/parsing logic.
 */
export function parseDateTimePrefs(raw: unknown): DateTimePrefs {
    if (!raw || typeof raw !== "object") return { ...DEFAULT_DATETIME_PREFS };
    const value = raw as { date?: unknown; time?: unknown };
    const date = typeof value.date === "string" && VALID_DATE_IDS.has(value.date) ? (value.date as DateFormatId) : DEFAULT_DATE_FORMAT;
    const time = typeof value.time === "string" && VALID_TIME_IDS.has(value.time) ? (value.time as TimeFormatId) : DEFAULT_TIME_FORMAT;
    return { date, time };
}

/** Parse a raw cookie/storage JSON string into prefs (defaults on any failure). */
export function parseDateTimePrefsString(value: string | null | undefined): DateTimePrefs {
    if (!value) return { ...DEFAULT_DATETIME_PREFS };
    try {
        return parseDateTimePrefs(JSON.parse(value));
    } catch {
        return { ...DEFAULT_DATETIME_PREFS };
    }
}

/** Read a single cookie value by name from `document.cookie`. */
function readCookie(name: string): string | null {
    if (typeof document === "undefined") return null;
    const prefix = `${name}=`;
    const parts = document.cookie ? document.cookie.split("; ") : [];
    for (const part of parts) {
        if (part.startsWith(prefix)) {
            try {
                return decodeURIComponent(part.slice(prefix.length));
            } catch {
                return part.slice(prefix.length);
            }
        }
    }
    return null;
}

/**
 * Persist the preference on the client. Writes BOTH the cookie (so the server can
 * read it on the next request) and localStorage (fast synchronous client mirror).
 * No-op in non-browser environments.
 */
export function writeDateTimePrefs(prefs: DateTimePrefs): void {
    const normalized = parseDateTimePrefs(prefs);
    const json = JSON.stringify(normalized);

    if (typeof document !== "undefined") {
        const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
        document.cookie = `${DT_PREFS_COOKIE}=${encodeURIComponent(json)}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
    }

    try {
        if (typeof localStorage !== "undefined") {
            localStorage.setItem(DT_PREFS_COOKIE, json);
        }
    } catch {
        // localStorage may be unavailable (private mode / blocked) — cookie still set.
    }
}

/**
 * Read the preference synchronously on the client. Prefers the cookie (the source
 * of truth shared with the server), then localStorage, then the defaults.
 * Safe to call during render; returns defaults when no browser APIs exist.
 */
export function readClientDateTimePrefs(): DateTimePrefs {
    const fromCookie = readCookie(DT_PREFS_COOKIE);
    if (fromCookie) return parseDateTimePrefsString(fromCookie);

    try {
        if (typeof localStorage !== "undefined") {
            const fromStorage = localStorage.getItem(DT_PREFS_COOKIE);
            if (fromStorage) return parseDateTimePrefsString(fromStorage);
        }
    } catch {
        // ignore
    }

    return { ...DEFAULT_DATETIME_PREFS };
}
