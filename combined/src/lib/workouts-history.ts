/**
 * Server-side lookups for "last time" performance and current PR values,
 * surfaced in the session UI.
 */
import { db } from "@/lib/db";
import { epley1RM } from "@/lib/workouts";

export type LastTimeSet = {
    reps: number | null;
    weight: number | null;
    seconds: number | null;
    meters: number | null;
};

export type LastTimePerf = {
    date: string; // ISO date (yyyy-mm-dd)
    sets: LastTimeSet[];
};

/**
 * For each exercise id, find the most recent previous (non-deleted) workout that
 * logged completed working sets, excluding the current workout.
 */
export async function getLastTimePerformance(userId: string, exerciseIds: string[], excludeWorkoutId: string): Promise<Record<string, LastTimePerf>> {
    const unique = [...new Set(exerciseIds)];
    const result: Record<string, LastTimePerf> = {};

    for (const exerciseId of unique) {
        const we = await db.workoutExercise.findFirst({
            where: {
                exerciseId,
                workoutId: { not: excludeWorkoutId },
                workout: { userId, deletedAt: null },
                sets: { some: { completed: true, isWarmup: false } },
            },
            orderBy: { workout: { date: "desc" } },
            include: {
                workout: { select: { date: true } },
                sets: { where: { completed: true, isWarmup: false }, orderBy: { order: "asc" } },
            },
        });
        if (!we || we.sets.length === 0) continue;
        result[exerciseId] = {
            date: we.workout.date.toISOString().slice(0, 10),
            sets: we.sets.map((s) => ({
                reps: s.actualReps,
                weight: s.actualWeight,
                seconds: s.actualSeconds,
                meters: s.actualMeters,
            })),
        };
    }

    return result;
}

export type LibraryLastDone = {
    /** ISO date of the most recent workout that trained this exercise */
    date: string;
    /** compact best-set summary, e.g. "100×5" or "12 reps" */
    topSet: string | null;
};

/**
 * A compact "last done" summary per exercise the user has ever logged, for the
 * add-exercise picker. One query over completed working sets, reduced in memory.
 */
export async function getLibraryLastDone(userId: string): Promise<Record<string, LibraryLastDone>> {
    const sets = await db.setEntry.findMany({
        where: { completed: true, isWarmup: false, workoutExercise: { workout: { userId, deletedAt: null } } },
        select: {
            actualReps: true,
            actualWeight: true,
            actualSeconds: true,
            actualMeters: true,
            workoutExercise: { select: { exerciseId: true, workout: { select: { date: true } } } },
        },
    });

    const map: Record<string, { date: Date; best: number; topSet: string | null }> = {};
    for (const s of sets) {
        const exId = s.workoutExercise.exerciseId;
        const date = s.workoutExercise.workout.date;
        const cur = map[exId];
        if (!cur || date > cur.date) {
            map[exId] = { date, best: 0, topSet: null };
        }
        const entry = map[exId];
        if (date.getTime() === entry.date.getTime()) {
            // track the heaviest/most-reps set on the most-recent date
            let score = 0;
            let label: string | null = null;
            if (s.actualWeight != null && s.actualReps != null) {
                score = s.actualWeight * s.actualReps;
                label = `${s.actualReps}×${s.actualWeight}`;
            } else if (s.actualReps != null) {
                score = s.actualReps;
                label = `${s.actualReps} reps`;
            } else if (s.actualSeconds != null) {
                score = s.actualSeconds;
                label = `${s.actualSeconds}s`;
            } else if (s.actualMeters != null) {
                score = s.actualMeters;
                label = s.actualMeters >= 1000 ? `${+(s.actualMeters / 1000).toFixed(2)}km` : `${s.actualMeters}m`;
            }
            if (label && score >= entry.best) {
                entry.best = score;
                entry.topSet = label;
            }
        }
    }

    const out: Record<string, LibraryLastDone> = {};
    for (const [exId, v] of Object.entries(map)) {
        out[exId] = { date: v.date.toISOString().slice(0, 10), topSet: v.topSet };
    }
    return out;
}

export type WorkoutOption = {
    id: string;
    /** Display label, e.g. "Jun 6 — Push day" or "Jun 6 — Workout". */
    label: string;
    /** ISO date (yyyy-mm-dd). */
    date: string;
};

/**
 * Recent (non-deleted) workouts for the user, newest first, for the optional
 * "Link to workout" select on the progress-photo upload forms. Shared by both
 * /workouts/progress and /health/photos so the option list is identical.
 */
export async function getRecentWorkoutOptions(userId: string, limit = 50): Promise<WorkoutOption[]> {
    const workouts = await db.workout.findMany({
        where: { userId, deletedAt: null, isQuickLog: false },
        orderBy: { date: "desc" },
        take: limit,
        select: { id: true, name: true, date: true },
    });
    return workouts.map((w) => {
        const d = w.date.toISOString().slice(0, 10);
        const pretty = w.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
        return { id: w.id, label: `${pretty} — ${w.name?.trim() || "Workout"}`, date: d };
    });
}

export type CurrentPRs = {
    /** best estimated 1RM (kg) */
    oneRm: number;
    /** best single-set volume (kg) */
    volume: number;
    /** best reps in a single set */
    reps: number;
    /** longest single-set duration (seconds) */
    time: number;
    /** longest single-set distance (meters) */
    distance: number;
};

/** Current stored PRs per exercise id (defaults to 0 when absent). */
export async function getCurrentPRs(userId: string, exerciseIds: string[]): Promise<Record<string, CurrentPRs>> {
    const unique = [...new Set(exerciseIds)];
    if (unique.length === 0) return {};
    const records = await db.personalRecord.findMany({
        where: { userId, exerciseId: { in: unique } },
    });
    const map: Record<string, CurrentPRs> = {};
    for (const id of unique) map[id] = { oneRm: 0, volume: 0, reps: 0, time: 0, distance: 0 };
    for (const r of records) {
        const cur = map[r.exerciseId];
        if (!cur) continue;
        if (r.recordType === "1RM") cur.oneRm = r.value;
        else if (r.recordType === "volume") cur.volume = r.value;
        else if (r.recordType === "reps") cur.reps = r.value;
        else if (r.recordType === "time") cur.time = r.value;
        else if (r.recordType === "distance") cur.distance = r.value;
    }
    return map;
}

/** Does a completed set beat any stored PR for its exercise? Pure, client-safe. */
export function isPrSet(
    set: { actualReps: number | null; actualWeight: number | null; actualSeconds?: number | null; actualMeters?: number | null },
    prs: CurrentPRs | undefined,
): boolean {
    if (!prs) return false;
    const reps = set.actualReps;
    if (reps != null) {
        if (reps > prs.reps + 0.001) return true;
        if (set.actualWeight != null) {
            const est = epley1RM(set.actualWeight, reps);
            if (est > prs.oneRm + 0.001) return true;
            const vol = set.actualWeight * reps;
            if (vol > prs.volume + 0.001) return true;
        }
    }
    // Timed / cardio records: longest duration & longest distance.
    if (set.actualSeconds != null && set.actualSeconds > prs.time + 0.001) return true;
    if (set.actualMeters != null && set.actualMeters > prs.distance + 0.001) return true;
    return false;
}

/**
 * Is this set the current PR (matches the stored best for any record type it
 * contributes)? Used for the persistent "PR" badge — unlike `isPrSet` (strictly
 * beats), this stays true after PRs are recomputed to include this set.
 */
export function isPrMatch(
    set: { actualReps: number | null; actualWeight: number | null; actualSeconds?: number | null; actualMeters?: number | null },
    prs: CurrentPRs | undefined,
): boolean {
    if (!prs) return false;
    const eq = (a: number, b: number) => b > 0 && Math.abs(a - b) < 0.01;
    const reps = set.actualReps;
    if (reps != null) {
        if (eq(reps, prs.reps)) return true;
        if (set.actualWeight != null) {
            if (eq(epley1RM(set.actualWeight, reps), prs.oneRm)) return true;
            if (eq(set.actualWeight * reps, prs.volume)) return true;
        }
    }
    if (set.actualSeconds != null && eq(set.actualSeconds, prs.time)) return true;
    if (set.actualMeters != null && eq(set.actualMeters, prs.distance)) return true;
    return false;
}
