import "server-only";

/**
 * Server-side reader for the global "Date & time format" preference.
 *
 * Kept in a SEPARATE file (with `import "server-only"`) from `datetime-prefs.ts`
 * so the client-safe persistence helpers never pull in `next/headers`. Use this
 * in Server Components / Server Actions to read the user's chosen format and pass
 * it down (e.g. to `formatDateWith` / `formatDateTimeWith`).
 */

import { cookies } from "next/headers";
import { DEFAULT_DATETIME_PREFS, DT_PREFS_COOKIE, parseDateTimePrefsString, type DateTimePrefs } from "@/lib/datetime-prefs";

/**
 * Read the date/time format preference from the request cookie on the server.
 * Falls back to {@link DEFAULT_DATETIME_PREFS} when absent or invalid.
 *
 * `cookies()` is async in recent Next.js, hence the Promise return type.
 */
export async function readServerDateTimePrefs(): Promise<DateTimePrefs> {
    try {
        const store = await cookies();
        return parseDateTimePrefsString(store.get(DT_PREFS_COOKIE)?.value);
    } catch {
        return { ...DEFAULT_DATETIME_PREFS };
    }
}
