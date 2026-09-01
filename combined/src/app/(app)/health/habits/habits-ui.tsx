"use client";

/**
 * Habit color palette + small shared helpers.
 *
 * The Habit.color field stores a free color-NAME string (e.g. "emerald").
 * Existing habits may hold legacy values like "brand" / "success" / "warning" /
 * "error" — these are mapped through so old data renders gracefully.
 */
export const HABIT_COLORS: Record<string, { dot: string; chip: string; tile: string; solid: string; ring: string }> = {
    red: { dot: "bg-utility-red-500", chip: "bg-utility-red-50 text-utility-red-700", tile: "bg-utility-red-50 text-utility-red-700", solid: "bg-utility-red-500", ring: "ring-utility-red-500" },
    orange: { dot: "bg-utility-orange-500", chip: "bg-utility-orange-50 text-utility-orange-700", tile: "bg-utility-orange-50 text-utility-orange-700", solid: "bg-utility-orange-500", ring: "ring-utility-orange-500" },
    amber: { dot: "bg-utility-amber-500", chip: "bg-utility-amber-50 text-utility-amber-700", tile: "bg-utility-amber-50 text-utility-amber-700", solid: "bg-utility-amber-500", ring: "ring-utility-amber-500" },
    yellow: { dot: "bg-utility-yellow-500", chip: "bg-utility-yellow-50 text-utility-yellow-700", tile: "bg-utility-yellow-50 text-utility-yellow-700", solid: "bg-utility-yellow-500", ring: "ring-utility-yellow-500" },
    green: { dot: "bg-utility-green-500", chip: "bg-utility-green-50 text-utility-green-700", tile: "bg-utility-green-50 text-utility-green-700", solid: "bg-utility-green-500", ring: "ring-utility-green-500" },
    emerald: { dot: "bg-utility-emerald-500", chip: "bg-utility-emerald-50 text-utility-emerald-700", tile: "bg-utility-emerald-50 text-utility-emerald-700", solid: "bg-utility-emerald-500", ring: "ring-utility-emerald-500" },
    sky: { dot: "bg-utility-sky-500", chip: "bg-utility-sky-50 text-utility-sky-700", tile: "bg-utility-sky-50 text-utility-sky-700", solid: "bg-utility-sky-500", ring: "ring-utility-sky-500" },
    blue: { dot: "bg-utility-blue-500", chip: "bg-utility-blue-50 text-utility-blue-700", tile: "bg-utility-blue-50 text-utility-blue-700", solid: "bg-utility-blue-500", ring: "ring-utility-blue-500" },
    indigo: { dot: "bg-utility-indigo-500", chip: "bg-utility-indigo-50 text-utility-indigo-700", tile: "bg-utility-indigo-50 text-utility-indigo-700", solid: "bg-utility-indigo-500", ring: "ring-utility-indigo-500" },
    violet: { dot: "bg-utility-purple-500", chip: "bg-utility-purple-50 text-utility-purple-700", tile: "bg-utility-purple-50 text-utility-purple-700", solid: "bg-utility-purple-500", ring: "ring-utility-purple-500" },
    purple: { dot: "bg-utility-purple-500", chip: "bg-utility-purple-50 text-utility-purple-700", tile: "bg-utility-purple-50 text-utility-purple-700", solid: "bg-utility-purple-500", ring: "ring-utility-purple-500" },
    fuchsia: { dot: "bg-utility-fuchsia-500", chip: "bg-utility-fuchsia-50 text-utility-fuchsia-700", tile: "bg-utility-fuchsia-50 text-utility-fuchsia-700", solid: "bg-utility-fuchsia-500", ring: "ring-utility-fuchsia-500" },
    pink: { dot: "bg-utility-pink-500", chip: "bg-utility-pink-50 text-utility-pink-700", tile: "bg-utility-pink-50 text-utility-pink-700", solid: "bg-utility-pink-500", ring: "ring-utility-pink-500" },
    brand: { dot: "bg-brand-solid", chip: "bg-brand-primary text-brand-secondary", tile: "bg-brand-primary text-brand-secondary", solid: "bg-brand-solid", ring: "ring-brand" },
    // legacy aliases (old data)
    success: { dot: "bg-utility-green-500", chip: "bg-utility-green-50 text-utility-green-700", tile: "bg-utility-green-50 text-utility-green-700", solid: "bg-utility-green-500", ring: "ring-utility-green-500" },
    warning: { dot: "bg-utility-amber-500", chip: "bg-utility-amber-50 text-utility-amber-700", tile: "bg-utility-amber-50 text-utility-amber-700", solid: "bg-utility-amber-500", ring: "ring-utility-amber-500" },
    error: { dot: "bg-utility-red-500", chip: "bg-utility-red-50 text-utility-red-700", tile: "bg-utility-red-50 text-utility-red-700", solid: "bg-utility-red-500", ring: "ring-utility-red-500" },
    neutral: { dot: "bg-fg-quaternary", chip: "bg-secondary text-secondary", tile: "bg-secondary text-secondary", solid: "bg-quaternary", ring: "ring-secondary" },
};

/** Ordered swatches offered in the color picker (~12). */
export const HABIT_COLOR_NAMES: string[] = [
    "brand",
    "emerald",
    "green",
    "sky",
    "blue",
    "indigo",
    "violet",
    "fuchsia",
    "pink",
    "red",
    "orange",
    "amber",
];

export function habitColor(color: string | null | undefined) {
    return HABIT_COLORS[color ?? "brand"] ?? HABIT_COLORS.brand;
}

/** Preset categories offered in the create/edit form (plus a custom option). */
export const HABIT_CATEGORIES = ["Health", "Fitness", "Mindfulness", "Productivity", "Learning", "Finance", "Social", "Sleep"];

/**
 * Streak for a BUILD habit: consecutive days (ending today, or yesterday if
 * today not yet logged) that DO have a log.
 */
export function buildStreak(logDates: Set<string>): number {
    let streak = 0;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (!logDates.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
    while (logDates.has(d.toISOString().slice(0, 10))) {
        streak++;
        d.setDate(d.getDate() - 1);
    }
    return streak;
}

/**
 * Streak for a BREAK habit: consecutive days WITHOUT a log (a "clean" streak),
 * counting backwards from today. The moment a relapse is logged the streak is 0.
 * Today always counts toward the clean streak unless a relapse was logged today.
 */
export function breakStreak(logDates: Set<string>): number {
    let streak = 0;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    while (!logDates.has(d.toISOString().slice(0, 10))) {
        streak++;
        d.setDate(d.getDate() - 1);
        // safety bound (~10 years) to avoid infinite loop on empty sets
        if (streak > 3700) break;
    }
    return streak;
}

/** Best (longest) clean streak ever for a break habit. */
export function bestBreakStreak(logDates: Set<string>): number {
    if (logDates.size === 0) return breakStreak(logDates);
    const sorted = [...logDates].sort();
    const first = new Date(sorted[0] + "T00:00:00Z");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let best = 0;
    let run = 0;
    const cur = new Date(first);
    while (cur <= today) {
        const key = cur.toISOString().slice(0, 10);
        if (logDates.has(key)) {
            run = 0;
        } else {
            run++;
            if (run > best) best = run;
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    // account for an ongoing clean run that extends to today
    return Math.max(best, breakStreak(logDates));
}

/** Best (longest) completed streak ever for a build habit. */
export function bestBuildStreak(logDates: Set<string>): number {
    if (logDates.size === 0) return 0;
    const sorted = [...logDates].sort();
    let best = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(sorted[i - 1] + "T00:00:00Z");
        const curr = new Date(sorted[i] + "T00:00:00Z");
        const diff = (curr.getTime() - prev.getTime()) / 86400000;
        if (diff === 1) {
            run++;
            if (run > best) best = run;
        } else {
            run = 1;
        }
    }
    return best;
}

export const MILESTONE_DAYS = [7, 30, 90, 180, 365];

/** Returns a milestone number if `streak` exactly equals one, else null. */
export function reachedMilestone(streak: number): number | null {
    return MILESTONE_DAYS.includes(streak) ? streak : null;
}
