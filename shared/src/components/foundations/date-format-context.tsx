// @ts-nocheck
import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_DATETIME_PREFS, type DateTimePrefs } from "@/lib/datetime-prefs";

/**
 * Server-seeded date/time format preference. The (app) layout reads the cookie
 * server-side and provides it here, so server HTML and the first client render use
 * the SAME value — no hydration mismatch, no format flash. `FormattedDate` reads this
 * for its initial render, then live-updates from the cookie after mount.
 */
const DateFormatContext = createContext<DateTimePrefs>(DEFAULT_DATETIME_PREFS);

export function DateFormatProvider({ value, children }: { value: DateTimePrefs; children: ReactNode }) {
    return <DateFormatContext.Provider value={value}>{children}</DateFormatContext.Provider>;
}

export function useDateFormatPrefs(): DateTimePrefs {
    return useContext(DateFormatContext);
}
