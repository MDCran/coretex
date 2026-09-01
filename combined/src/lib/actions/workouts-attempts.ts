"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateKeyToUtc, toDateKey } from "@/lib/workouts";
import { getCurrentPRs, isPrSet } from "@/lib/workouts-history";
import { recomputePersonalRecords } from "@/lib/workouts-prs";

export type ExerciseAttemptInput = {
    exerciseId: string;
    dateKey?: string;
    actualReps?: number | null;
    actualWeight?: number | null;
    actualSeconds?: number | null;
    actualMeters?: number | null;
    rpe?: number | null;
    isWarmup?: boolean;
    note?: string | null;
};

function prTypesImproved(before: { oneRm: number; volume: number; reps: number; time: number; distance: number }, after: typeof before): string[] {
    const types: string[] = [];
    if (after.oneRm > before.oneRm + 0.001) types.push("1RM");
    if (after.volume > before.volume + 0.001) types.push("volume");
    if (after.reps > before.reps + 0.001) types.push("reps");
    if (after.time > before.time + 0.001) types.push("time");
    if (after.distance > before.distance + 0.001) types.push("distance");
    return types;
}

/** Log a single exercise attempt without creating a visible workout session. */
export async function logExerciseAttempt(input: ExerciseAttemptInput): Promise<{ setId: string; isPr: boolean; prTypes: string[] }> {
    const user = await requireUser();
    const dateKey = input.dateKey ?? toDateKey(new Date());
    const exercise = await db.exercise.findFirst({
        where: { id: input.exerciseId, OR: [{ userId: null }, { userId: user.id }] },
        select: { id: true, slug: true },
    });
    if (!exercise) throw new Error("Exercise not found");

    const beforeMap = await getCurrentPRs(user.id, [exercise.id]);
    const prior = beforeMap[exercise.id] ?? { oneRm: 0, volume: 0, reps: 0, time: 0, distance: 0 };

    const workout = await db.workout.create({
        data: {
            userId: user.id,
            date: dateKeyToUtc(dateKey),
            isQuickLog: true,
            startedAt: new Date(),
            endedAt: new Date(),
            note: input.note?.trim() || null,
        },
    });

    const we = await db.workoutExercise.create({
        data: { workoutId: workout.id, exerciseId: exercise.id, order: 0, note: input.note?.trim() || null },
    });

    const set = await db.setEntry.create({
        data: {
            workoutExerciseId: we.id,
            order: 0,
            actualReps: input.actualReps ?? null,
            actualWeight: input.actualWeight ?? null,
            actualSeconds: input.actualSeconds ?? null,
            actualMeters: input.actualMeters ?? null,
            rpe: input.rpe ?? null,
            isWarmup: input.isWarmup ?? false,
            completed: true,
        },
    });

    await recomputePersonalRecords(user.id, workout.id);

    const afterMap = await getCurrentPRs(user.id, [exercise.id]);
    const after = afterMap[exercise.id] ?? prior;
    const setPayload = {
        actualReps: input.actualReps ?? null,
        actualWeight: input.actualWeight ?? null,
        actualSeconds: input.actualSeconds ?? null,
        actualMeters: input.actualMeters ?? null,
    };
    const isPr = isPrSet(setPayload, prior) || prTypesImproved(prior, after).length > 0;
    const prTypes = prTypesImproved(prior, after);

    revalidatePath("/workouts/body");
    revalidatePath("/workouts/exercises");
    revalidatePath(`/workouts/exercises/${exercise.slug}`);

    return { setId: set.id, isPr, prTypes };
}
