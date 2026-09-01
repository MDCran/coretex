import { differenceInCalendarDays, format, subDays, startOfDay } from "date-fns";
import { formatDate as fmtDateShared, formatDateShort, formatDateTime, formatRelative } from "@/lib/dates";

export function fmtDate(d: Date | string | null | undefined) {
    return fmtDateShared(d);
}

export function fmtDateTime(d: Date | string | null | undefined) {
    return formatDateTime(d);
}

export function fmtRelative(d: Date | string | null | undefined) {
    return formatRelative(d, "Never");
}

/** Format a Date for an <input type="date"> (yyyy-MM-dd), or "" if null. */
export function toDateInput(d: Date | string | null | undefined) {
    if (!d) return "";
    return format(new Date(d), "yyyy-MM-dd");
}

/** Format a Date for an <input type="datetime-local"> (yyyy-MM-ddTHH:mm). */
export function toDateTimeInput(d: Date | string | null | undefined) {
    if (!d) return "";
    return format(new Date(d), "yyyy-MM-dd'T'HH:mm");
}

/** Initials for an avatar fallback (max two letters). */
export function initialsOf(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Format a contact's birthday/date as "MMM d" (year-agnostic). */
export function fmtMonthDay(d: Date | string | null | undefined) {
    return formatDateShort(d);
}

/**
 * Days until the next occurrence of a month/day (birthday/anniversary).
 * Returns a non-negative integer; 0 means today.
 */
export function daysUntilAnnual(d: Date | string): number {
    const date = new Date(d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let next = new Date(now.getFullYear(), date.getMonth(), date.getDate());
    if (next < today) next = new Date(now.getFullYear() + 1, date.getMonth(), date.getDate());
    return differenceInCalendarDays(next, today);
}

/**
 * Whether a stay-in-touch contact is overdue for a reach-out.
 * Overdue when lastContactAt is null or older than stayInTouchDays.
 */
export function isReachOutDue(lastContactAt: Date | null, stayInTouchDays: number | null | undefined): boolean {
    const days = stayInTouchDays ?? 30;
    if (!lastContactAt) return true;
    return differenceInCalendarDays(new Date(), new Date(lastContactAt)) >= days;
}

/**
 * Days a stay-in-touch contact is overdue for a reach-out (>= 0).
 * Returns null when never contacted (treat as "no count" / brand-new).
 */
export function reachOutOverdueDays(lastContactAt: Date | null, stayInTouchDays: number | null | undefined): number | null {
    const days = stayInTouchDays ?? 30;
    if (!lastContactAt) return null;
    const overdue = differenceInCalendarDays(new Date(), new Date(lastContactAt)) - days;
    return overdue > 0 ? overdue : 0;
}

/** Format a byte count compactly, e.g. "1.4 MB". */
export function fmtBytes(bytes: number | null | undefined): string {
    if (bytes == null || bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export type ConnectionHealth = {
    /** 0–100 score derived from real interaction signals. */
    score: number;
    /** Tier label for the badge. */
    label: "Thriving" | "Healthy" | "Cooling" | "Fading" | "Dormant";
    /** Untitled UI badge color name. */
    color: "success" | "brand" | "warning" | "error" | "gray";
    /** Interactions in the last 90 days. */
    recentCount: number;
    /** Days since last contact, or null if never. */
    daysSince: number | null;
};

/**
 * Compute a "connection health" indicator from REAL signals only — no invented
 * score table. Inputs are the contact's interaction/communication timestamps
 * plus lastContactAt and the desired cadence. The score blends:
 *   - recency vs. cadence (how overdue you are)
 *   - frequency over the last 90 days
 * This is purely derived (monitoring), distinct from the user-set closeness/trust.
 */
export function connectionHealth(
    activityDates: (Date | string)[],
    lastContactAt: Date | null,
    stayInTouchDays: number | null | undefined,
): ConnectionHealth {
    const now = new Date();
    const cadence = stayInTouchDays && stayInTouchDays > 0 ? stayInTouchDays : 30;
    const ninetyAgo = subDays(now, 90);
    const recentCount = activityDates.filter((d) => new Date(d) >= ninetyAgo).length;
    const daysSince = lastContactAt ? differenceInCalendarDays(now, new Date(lastContactAt)) : null;

    // Recency: 100 when fresh, decays to 0 at ~2× cadence overdue.
    let recency: number;
    if (daysSince == null) recency = 0;
    else if (daysSince <= cadence) recency = 100;
    else recency = Math.max(0, 100 - ((daysSince - cadence) / cadence) * 100);

    // Frequency: 4+ touches in 90d is full marks.
    const frequency = Math.min(100, (recentCount / 4) * 100);

    const score = Math.round(recency * 0.65 + frequency * 0.35);

    let label: ConnectionHealth["label"];
    let color: ConnectionHealth["color"];
    if (daysSince == null && recentCount === 0) {
        label = "Dormant";
        color = "gray";
    } else if (score >= 80) {
        label = "Thriving";
        color = "success";
    } else if (score >= 60) {
        label = "Healthy";
        color = "brand";
    } else if (score >= 40) {
        label = "Cooling";
        color = "warning";
    } else if (score >= 20) {
        label = "Fading";
        color = "error";
    } else {
        label = "Dormant";
        color = "gray";
    }

    return { score, label, color, recentCount, daysSince };
}

/**
 * Bucket activity timestamps into a weekly count series over the last `weeks`
 * weeks (oldest → newest) for a sparkline. Each bucket is 7 days wide.
 */
export function activitySparkline(activityDates: (Date | string)[], weeks = 12): number[] {
    const now = startOfDay(new Date());
    const buckets = new Array(weeks).fill(0);
    for (const raw of activityDates) {
        const d = startOfDay(new Date(raw));
        const diffDays = differenceInCalendarDays(now, d);
        if (diffDays < 0) continue;
        const weekIdx = Math.floor(diffDays / 7);
        if (weekIdx < weeks) buckets[weeks - 1 - weekIdx] += 1;
    }
    return buckets;
}
