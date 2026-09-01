import { db } from "@/lib/db";
import { epley1RM } from "@/lib/workouts";

/**
 * Recomputes personal records for every exercise touched by a finished workout
 * and upserts the best 1RM / volume / reps into PersonalRecord.
 *
 * Strategy: for each affected exercise we scan ALL the user's completed,
 * non-warmup sets to find the all-time best per record type, then upsert a
 * single PersonalRecord row per (exercise, recordType).
 */
export async function recomputePersonalRecords(userId: string, workoutId: string): Promise<string[]> {
    const workout = await db.workout.findFirst({
        where: { id: workoutId, userId },
        include: { exercises: { select: { exerciseId: true } } },
    });
    if (!workout) return [];

    const exerciseIds = [...new Set(workout.exercises.map((we) => we.exerciseId))];
    const newPrNames: string[] = [];

    for (const exerciseId of exerciseIds) {
        const sets = await db.setEntry.findMany({
            where: {
                completed: true,
                isWarmup: false,
                workoutExercise: { exerciseId, workout: { userId, deletedAt: null } },
            },
            include: { workoutExercise: { include: { workout: { select: { date: true } } } } },
        });
        if (sets.length === 0) continue;

        let best1rm = { value: 0, date: workout.date };
        let bestVolume = { value: 0, date: workout.date };
        let bestReps = { value: 0, date: workout.date };
        let bestTime = { value: 0, date: workout.date };
        let bestDistance = { value: 0, date: workout.date };

        for (const s of sets) {
            const date = s.workoutExercise.workout.date;
            if (s.actualWeight != null && s.actualReps != null) {
                const est = epley1RM(s.actualWeight, s.actualReps);
                if (est > best1rm.value) best1rm = { value: est, date };
                const vol = s.actualWeight * s.actualReps;
                if (vol > bestVolume.value) bestVolume = { value: vol, date };
            }
            if (s.actualReps != null && s.actualReps > bestReps.value) bestReps = { value: s.actualReps, date };
            if (s.actualSeconds != null && s.actualSeconds > bestTime.value) bestTime = { value: s.actualSeconds, date };
            if (s.actualMeters != null && s.actualMeters > bestDistance.value) bestDistance = { value: s.actualMeters, date };
        }

        const exercise = await db.exercise.findUnique({ where: { id: exerciseId }, select: { name: true } });
        const records: Array<{ recordType: string; value: number; unit: string; date: Date }> = [];
        if (best1rm.value > 0) records.push({ recordType: "1RM", value: best1rm.value, unit: "kg", date: best1rm.date });
        if (bestVolume.value > 0) records.push({ recordType: "volume", value: bestVolume.value, unit: "kg", date: bestVolume.date });
        if (bestReps.value > 0) records.push({ recordType: "reps", value: bestReps.value, unit: "reps", date: bestReps.date });
        if (bestTime.value > 0) records.push({ recordType: "time", value: bestTime.value, unit: "s", date: bestTime.date });
        if (bestDistance.value > 0) records.push({ recordType: "distance", value: bestDistance.value, unit: "m", date: bestDistance.date });

        for (const r of records) {
            const existing = await db.personalRecord.findFirst({
                where: { userId, exerciseId, recordType: r.recordType },
            });
            if (!existing) {
                await db.personalRecord.create({
                    data: { userId, exerciseId, recordType: r.recordType, value: r.value, unit: r.unit, achievedOn: r.date },
                });
                if (r.recordType === "1RM" && exercise) newPrNames.push(exercise.name);
            } else if (r.value > existing.value + 0.001) {
                await db.personalRecord.update({
                    where: { id: existing.id },
                    data: { value: r.value, unit: r.unit, achievedOn: r.date },
                });
                if (r.recordType === "1RM" && exercise) newPrNames.push(exercise.name);
            }
        }
    }

    return newPrNames;
}

/**
 * Authoritative rebuild of personal records across ALL of the user's exercises
 * from their entire history of completed, non-warmup sets in non-deleted
 * workouts. Used by the "Recompute PRs" button on /workouts/body, the
 * auto-backfill (sets but zero PR rows), and after a workout is deleted.
 *
 * This DELETES the user's existing PersonalRecord rows first, then recreates
 * them — so stale records (e.g. left behind when the workout that set them was
 * deleted, or values that dropped after an edit) are pruned. Returns the number
 * of PersonalRecord rows written.
 */
export async function recomputeAllPersonalRecords(userId: string): Promise<number> {
    // Pull every completed working set the user has ever logged, grouped by exercise.
    const sets = await db.setEntry.findMany({
        where: {
            completed: true,
            isWarmup: false,
            workoutExercise: { workout: { userId, deletedAt: null } },
        },
        select: {
            actualWeight: true,
            actualReps: true,
            actualSeconds: true,
            actualMeters: true,
            workoutExercise: { select: { exerciseId: true, workout: { select: { date: true } } } },
        },
    });
    // Authoritative rebuild: clear existing records, then recreate from scratch.
    await db.personalRecord.deleteMany({ where: { userId } });
    if (sets.length === 0) return 0;

    type Best = { value: number; date: Date };
    const byExercise = new Map<string, { best1rm: Best; bestVolume: Best; bestReps: Best; bestTime: Best; bestDistance: Best }>();

    for (const s of sets) {
        const exerciseId = s.workoutExercise.exerciseId;
        const date = s.workoutExercise.workout.date;
        let agg = byExercise.get(exerciseId);
        if (!agg) {
            agg = {
                best1rm: { value: 0, date },
                bestVolume: { value: 0, date },
                bestReps: { value: 0, date },
                bestTime: { value: 0, date },
                bestDistance: { value: 0, date },
            };
            byExercise.set(exerciseId, agg);
        }
        if (s.actualWeight != null && s.actualReps != null) {
            const est = epley1RM(s.actualWeight, s.actualReps);
            if (est > agg.best1rm.value) agg.best1rm = { value: est, date };
            const vol = s.actualWeight * s.actualReps;
            if (vol > agg.bestVolume.value) agg.bestVolume = { value: vol, date };
        }
        if (s.actualReps != null && s.actualReps > agg.bestReps.value) agg.bestReps = { value: s.actualReps, date };
        if (s.actualSeconds != null && s.actualSeconds > agg.bestTime.value) agg.bestTime = { value: s.actualSeconds, date };
        if (s.actualMeters != null && s.actualMeters > agg.bestDistance.value) agg.bestDistance = { value: s.actualMeters, date };
    }

    let touched = 0;
    for (const [exerciseId, agg] of byExercise) {
        const records: Array<{ recordType: string; value: number; unit: string; date: Date }> = [];
        if (agg.best1rm.value > 0) records.push({ recordType: "1RM", value: agg.best1rm.value, unit: "kg", date: agg.best1rm.date });
        if (agg.bestVolume.value > 0) records.push({ recordType: "volume", value: agg.bestVolume.value, unit: "kg", date: agg.bestVolume.date });
        if (agg.bestReps.value > 0) records.push({ recordType: "reps", value: agg.bestReps.value, unit: "reps", date: agg.bestReps.date });
        if (agg.bestTime.value > 0) records.push({ recordType: "time", value: agg.bestTime.value, unit: "s", date: agg.bestTime.date });
        if (agg.bestDistance.value > 0) records.push({ recordType: "distance", value: agg.bestDistance.value, unit: "m", date: agg.bestDistance.date });

        if (records.length > 0) {
            await db.personalRecord.createMany({
                data: records.map((r) => ({ userId, exerciseId, recordType: r.recordType, value: r.value, unit: r.unit, achievedOn: r.date })),
            });
            touched += records.length;
        }
    }

    return touched;
}
