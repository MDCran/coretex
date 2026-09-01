/**
 * Pure, framework-agnostic helpers for todo scheduling metadata.
 *
 * Lives outside `lib/todos.ts` (which is `server-only`) so BOTH the server
 * actions/validation AND the client form + calendar grid can share the same
 * time-of-day zones, capacity math, and formatting. No imports with side
 * effects — safe in any runtime.
 */

// ── Status ───────────────────────────────────────────────────

/** The four statuses surfaced in the UI (DRIPPED is folded into PLANNED). */
export type TodoUiStatus = "PLANNED" | "IN_PROGRESS" | "DONE" | "SKIPPED";

export const TODO_STATUS_LABEL: Record<TodoUiStatus, string> = {
    PLANNED: "Planned",
    IN_PROGRESS: "In progress",
    DONE: "Done",
    SKIPPED: "Skipped",
};

// ── Priority ─────────────────────────────────────────────────

export type TodoPriorityValue = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";

/** Display order (highest first) + a numeric rank for sorting columns. */
export const TODO_PRIORITY_ORDER: readonly TodoPriorityValue[] = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"];
export const TODO_PRIORITY_RANK: Record<TodoPriorityValue, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 };
export const TODO_PRIORITY_LABEL: Record<TodoPriorityValue, string> = {
    NONE: "None",
    LOW: "Low",
    MEDIUM: "Medium",
    HIGH: "High",
    URGENT: "Urgent",
};

// ── Energy ───────────────────────────────────────────────────

export type TodoEnergyValue = "DEEP_WORK" | "QUICK" | "COLLABORATIVE";
export const TODO_ENERGY_ORDER: readonly TodoEnergyValue[] = ["DEEP_WORK", "QUICK", "COLLABORATIVE"];
export const TODO_ENERGY_LABEL: Record<TodoEnergyValue, string> = {
    DEEP_WORK: "Deep work",
    QUICK: "Quick",
    COLLABORATIVE: "Collaborative",
};
/** Emoji glyph used in the energy tag. */
export const TODO_ENERGY_ICON: Record<TodoEnergyValue, string> = {
    DEEP_WORK: "🧠",
    QUICK: "⚡",
    COLLABORATIVE: "🤝",
};

// ── Category + tags ──────────────────────────────────────────

export const TODO_CATEGORY_PRESETS = ["Personal", "Work", "Finance", "Health"] as const;

/** Max valid day for a 1-based month (Feb allows 29 to permit leap-year routines). */
export function maxDayOfMonth(month: number): number {
    if (month === 2) return 29;
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Normalize a comma string / array into clean, de-duped, capped tags. */
export function cleanTags(raw: string | string[] | null | undefined): string[] {
    const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of arr) {
        const t = String(item).trim().replace(/^#+/, "").trim();
        if (!t) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t.slice(0, 40));
        if (out.length >= 20) break;
    }
    return out;
}

/** Split a newline/comma string into trimmed, non-empty, capped links. */
export function cleanLinks(raw: string | string[] | null | undefined): string[] {
    const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\n,]/) : [];
    const out: string[] = [];
    for (const item of arr) {
        const s = String(item).trim();
        if (!s) continue;
        out.push(s.slice(0, 2000));
        if (out.length >= 20) break;
    }
    return out;
}

// ── Time-of-day zones ────────────────────────────────────────

export type TimeOfDayValue = "MORNING" | "AFTERNOON" | "EVENING" | "NIGHT";

export interface TimeZoneDef {
    value: TimeOfDayValue;
    label: string;
    /** Inclusive start hour (0–24). */
    startHour: number;
    /** Exclusive end hour (0–24). */
    endHour: number;
}

/**
 * Soft zone bands used to place untimed todos on the calendar and to render the
 * part-of-day tag. Ranges match the product spec exactly:
 *   Morning 6–12 · Afternoon 12–17 · Evening 17–21 · Night 21–24.
 */
export const TIME_ZONES: readonly TimeZoneDef[] = [
    { value: "MORNING", label: "Morning", startHour: 6, endHour: 12 },
    { value: "AFTERNOON", label: "Afternoon", startHour: 12, endHour: 17 },
    { value: "EVENING", label: "Evening", startHour: 17, endHour: 21 },
    { value: "NIGHT", label: "Night", startHour: 21, endHour: 24 },
] as const;

export const TIME_OF_DAY_ORDER: readonly TimeOfDayValue[] = TIME_ZONES.map((z) => z.value);

export const TIME_OF_DAY_LABEL: Record<TimeOfDayValue, string> = {
    MORNING: "Morning",
    AFTERNOON: "Afternoon",
    EVENING: "Evening",
    NIGHT: "Night",
};

export function zoneFor(value: TimeOfDayValue): TimeZoneDef {
    return TIME_ZONES.find((z) => z.value === value) ?? TIME_ZONES[0];
}

/**
 * Infer the part-of-day bucket from a wall-clock "HH:MM", matching the TIME_ZONES
 * boundaries: Night 21–6 · Morning 6–12 · Afternoon 12–17 · Evening 17–21.
 * Returns null for an unparseable value.
 */
export function bandForTime(hhmm: string | null | undefined): TimeOfDayValue | null {
    const mins = hhmmToMinutes(hhmm);
    if (mins == null) return null;
    const hour = mins / 60;
    if (hour < 6) return "NIGHT"; // 0–6 is late night, not morning
    if (hour < 12) return "MORNING";
    if (hour < 17) return "AFTERNOON";
    if (hour < 21) return "EVENING";
    return "NIGHT";
}

// ── HH:MM parsing / formatting ───────────────────────────────

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** True when `value` is a valid 24h "HH:MM" / "H:MM" string. */
export function isValidHHMM(value: string | null | undefined): boolean {
    return typeof value === "string" && HHMM_RE.test(value.trim());
}

/** "HH:MM" → minutes since midnight (0–1439), or null when invalid. */
export function hhmmToMinutes(value: string | null | undefined): number | null {
    if (typeof value !== "string") return null;
    const m = value.trim().match(HHMM_RE);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
}

/** minutes since midnight → zero-padded "HH:MM" (clamped to 0–1439). */
export function minutesToHHMM(minutes: number): string {
    const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "14:30" → "2:30 PM" for display. Returns "" for an invalid value. */
export function formatHHMM(value: string | null | undefined): string {
    const mins = hhmmToMinutes(value);
    if (mins == null) return "";
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const period = h < 12 ? "AM" : "PM";
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")} ${period}`;
}

/** 90 → "1h 30m", 60 → "1h", 45 → "45m", 0/invalid → "". */
export function formatDuration(minutes: number | null | undefined): string {
    if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "";
    const total = Math.round(minutes);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

// ── Daily capacity ───────────────────────────────────────────

/** Default planning capacity for a single day (8 hours). */
export const DEFAULT_CAPACITY_MINUTES = 8 * 60;

export interface CapacityInput {
    status: string;
    durationMinutes: number | null;
}

export interface CapacitySummary {
    /** Sum of durations for non-skipped todos with an estimate. */
    scheduledMinutes: number;
    capacityMinutes: number;
    /** scheduledMinutes / capacityMinutes (0 when capacity is 0). */
    ratio: number;
    /** True once scheduled load exceeds capacity. */
    over: boolean;
    /** Count of todos that contributed a duration estimate. */
    estimatedCount: number;
}

/**
 * Sum the estimated load for a day. SKIPPED todos don't count (they won't be
 * done); everything else the user committed to (planned / in progress / done)
 * occupies the day.
 */
export function summarizeCapacity(
    todos: CapacityInput[],
    capacityMinutes: number = DEFAULT_CAPACITY_MINUTES,
): CapacitySummary {
    let scheduledMinutes = 0;
    let estimatedCount = 0;
    for (const t of todos) {
        if (t.status === "SKIPPED") continue;
        const d = t.durationMinutes;
        if (d != null && Number.isFinite(d) && d > 0) {
            scheduledMinutes += d;
            estimatedCount += 1;
        }
    }
    const cap = capacityMinutes > 0 ? capacityMinutes : DEFAULT_CAPACITY_MINUTES;
    return {
        scheduledMinutes,
        capacityMinutes: cap,
        ratio: cap > 0 ? scheduledMinutes / cap : 0,
        over: scheduledMinutes > cap,
        estimatedCount,
    };
}

// ── Calendar placement ───────────────────────────────────────

/**
 * Whether a todo can be drawn on the time grid as a positioned block
 * (it has a specific start time) vs. floated into a zone band (time-of-day
 * tag only) vs. not shown on the grid at all.
 */
export function todoGridPlacement(todo: {
    startTime: string | null;
    timeOfDay: TimeOfDayValue | null;
}): "block" | "zone" | "none" {
    if (isValidHHMM(todo.startTime)) return "block";
    if (todo.timeOfDay) return "zone";
    return "none";
}
