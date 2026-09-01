/**
 * Adherence + scheduling helpers for the Workouts module.
 * A WorkoutSchedule is a planned workout on a date; adherence compares plans
 * against actually-logged workouts.
 */
import { db } from "@/lib/db";
import { formatDateShort } from "@/lib/dates";
import { toDateKey } from "@/lib/workouts";

export type AdherenceStatus = "done" | "missed" | "skipped" | "upcoming";

export type PlanLike = {
    date: Date | string;
    skipped: boolean;
    /** explicit link to the fulfilling session */
    workoutId: string | null;
    /** true when a non-deleted workout exists on the plan's date (implicit fulfillment) */
    hasWorkoutOnDate?: boolean;
};

/** Local midnight for "today", used as the past/future boundary. */
export function startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function asDate(d: Date | string): Date {
    return typeof d === "string" ? new Date(d) : d;
}

/** Classify a single plan into its adherence status. */
export function planStatus(plan: PlanLike, today = startOfToday()): AdherenceStatus {
    if (plan.workoutId || plan.hasWorkoutOnDate) return "done";
    if (plan.skipped) return "skipped";
    const planDate = asDate(plan.date);
    const planKey = toDateKey(planDate);
    const todayKey = toDateKey(today);
    if (planKey < todayKey) return "missed";
    return "upcoming";
}

export const STATUS_LABEL: Record<AdherenceStatus, string> = {
    done: "Completed",
    missed: "Missed",
    skipped: "Skipped",
    upcoming: "Upcoming",
};

export const STATUS_COLOR: Record<AdherenceStatus, "success" | "error" | "gray" | "brand"> = {
    done: "success",
    missed: "error",
    skipped: "gray",
    upcoming: "brand",
};

/** Completion % over plans whose date is on/before today (i.e. countable). */
export function completionRate(plans: PlanLike[], today = startOfToday()): { done: number; countable: number; pct: number } {
    let done = 0;
    let countable = 0;
    for (const p of plans) {
        const s = planStatus(p, today);
        if (s === "upcoming") continue; // future plans don't count yet
        if (s === "skipped") continue; // skipped is neutral, excluded from rate
        countable++;
        if (s === "done") done++;
    }
    const pct = countable > 0 ? Math.round((done / countable) * 100) : 0;
    return { done, countable, pct };
}

/**
 * Current streak of consecutive completed plans, walking backwards from the most
 * recent countable plan. Skipped plans are neutral (don't break, don't count);
 * a missed plan breaks the streak.
 */
export function completedStreak(plans: PlanLike[], today = startOfToday()): number {
    const past = plans
        .filter((p) => {
            const s = planStatus(p, today);
            return s === "done" || s === "missed" || s === "skipped";
        })
        .sort((a, b) => asDate(b.date).getTime() - asDate(a.date).getTime());

    let streak = 0;
    for (const p of past) {
        const s = planStatus(p, today);
        if (s === "skipped") continue;
        if (s === "done") streak++;
        else break;
    }
    return streak;
}

/** Weekly buckets (planned vs completed) for the last N weeks, oldest → newest. */
export function weeklyAdherence(plans: PlanLike[], weeks: number, today = startOfToday()): Array<{ label: string; planned: number; completed: number }> {
    // Monday-anchored week start for the current week.
    const thisMonday = new Date(today);
    thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7));

    const buckets: Array<{ start: Date; label: string; planned: number; completed: number }> = [];
    for (let i = weeks - 1; i >= 0; i--) {
        const start = new Date(thisMonday);
        start.setDate(start.getDate() - i * 7);
        buckets.push({
            start,
            label: formatDateShort(start),
            planned: 0,
            completed: 0,
        });
    }

    for (const p of plans) {
        const d = asDate(p.date);
        for (let b = 0; b < buckets.length; b++) {
            const start = buckets[b].start;
            const end = new Date(start);
            end.setDate(end.getDate() + 7);
            if (d >= start && d < end) {
                buckets[b].planned++;
                if (planStatus(p, today) === "done") buckets[b].completed++;
                break;
            }
        }
    }

    return buckets.map((b) => ({ label: b.label, planned: b.planned, completed: b.completed }));
}

export const ADHERENCE_RANGES = [
    { id: "7d", label: "7 days", days: 7 },
    { id: "30d", label: "30 days", days: 30 },
    { id: "90d", label: "90 days", days: 90 },
    { id: "1y", label: "1 year", days: 365 },
] as const;

export type AdherenceRangeId = (typeof ADHERENCE_RANGES)[number]["id"];

/**
 * Link a freshly-created workout to an unfulfilled plan on the same date, if any.
 * Prefers a plan whose templateId matches the workout's; otherwise links when
 * there is exactly one candidate plan that day. Safe to call after any create.
 */
export async function autoMatchScheduleForWorkout(userId: string, workoutId: string, dateUtc: Date, templateId: string | null): Promise<void> {
    const candidates = await db.workoutSchedule.findMany({
        where: { userId, date: dateUtc, workoutId: null, skipped: false },
    });
    if (candidates.length === 0) return;

    let match = templateId ? candidates.find((c) => c.templateId === templateId) : undefined;
    if (!match && candidates.length === 1) match = candidates[0];
    if (!match) return;

    await db.workoutSchedule.update({ where: { id: match.id }, data: { workoutId } });
}

