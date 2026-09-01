"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateKeyToUtc } from "@/lib/workouts";
import { advanceTemplateAfterWorkout, planExerciseSets } from "@/lib/workouts-progression";
import { recomputePersonalRecords, recomputeAllPersonalRecords } from "@/lib/workouts-prs";
import { autoMatchScheduleForWorkout } from "@/lib/workouts-schedule";

/** Create a blank workout for a given date (yyyy-mm-dd) and return its id. */
export async function createBlankWorkout(dateKey: string, name?: string): Promise<string> {
    const user = await requireUser();
    const workout = await db.workout.create({
        data: {
            userId: user.id,
            date: dateKeyToUtc(dateKey),
            name: name?.trim() || null,
            startedAt: new Date(),
        },
    });
    await autoMatchScheduleForWorkout(user.id, workout.id, dateKeyToUtc(dateKey), null);
    revalidatePath("/workouts");
    revalidatePath("/workouts/log");
    revalidatePath("/workouts/schedule");
    return workout.id;
}

/**
 * Instantiate a workout from a template: copies exercises + planned sets,
 * applying the template's progression scheme. Returns the new workout id.
 */
export async function createWorkoutFromTemplate(templateId: string, dateKey: string): Promise<string> {
    const user = await requireUser();
    const template = await db.template.findFirst({
        where: { id: templateId, userId: user.id },
        include: { exercises: { include: { sets: true }, orderBy: { order: "asc" } } },
    });
    if (!template) throw new Error("Template not found");

    const workout = await db.workout.create({
        data: {
            userId: user.id,
            date: dateKeyToUtc(dateKey),
            name: template.name,
            templateId: template.id,
            startedAt: new Date(),
        },
    });

    for (const te of template.exercises) {
        const planned = planExerciseSets(template, te, te.sets);
        await db.workoutExercise.create({
            data: {
                workoutId: workout.id,
                exerciseId: te.exerciseId,
                order: te.order,
                note: te.note,
                groupKey: te.groupKey,
                restSec: te.restSec,
                tempo: te.tempo,
                sets: {
                    create: planned.map((p) => ({
                        order: p.order,
                        targetReps: p.targetReps,
                        targetWeight: p.targetWeight,
                        targetRpe: p.targetRpe ?? null,
                        isWarmup: p.isWarmup ?? false,
                        isAmrap: p.isAmrap ?? false,
                    })),
                },
            },
        });
    }

    await autoMatchScheduleForWorkout(user.id, workout.id, dateKeyToUtc(dateKey), template.id);
    revalidatePath("/workouts");
    revalidatePath("/workouts/log");
    revalidatePath("/workouts/schedule");
    return workout.id;
}

async function assertOwnWorkout(workoutId: string, userId: string) {
    const w = await db.workout.findFirst({ where: { id: workoutId, userId }, select: { id: true } });
    if (!w) throw new Error("Workout not found");
}

/** Add an exercise (from library/catalog) to a workout. */
export async function addWorkoutExercise(workoutId: string, exerciseId: string) {
    const user = await requireUser();
    await assertOwnWorkout(workoutId, user.id);
    const count = await db.workoutExercise.count({ where: { workoutId } });
    await db.workoutExercise.create({
        data: { workoutId, exerciseId, order: count },
    });
    revalidatePath(`/workouts/session/${workoutId}`);
}

export async function removeWorkoutExercise(workoutId: string, workoutExerciseId: string) {
    const user = await requireUser();
    await assertOwnWorkout(workoutId, user.id);
    await db.workoutExercise.delete({ where: { id: workoutExerciseId } });
    revalidatePath(`/workouts/session/${workoutId}`);
}

/** Move an exercise up or down within the workout. */
export async function reorderWorkoutExercise(workoutId: string, workoutExerciseId: string, direction: "up" | "down") {
    const user = await requireUser();
    await assertOwnWorkout(workoutId, user.id);
    const items = await db.workoutExercise.findMany({ where: { workoutId }, orderBy: { order: "asc" } });
    const idx = items.findIndex((i) => i.id === workoutExerciseId);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const a = items[idx];
    const b = items[swapIdx];
    await db.$transaction([
        db.workoutExercise.update({ where: { id: a.id }, data: { order: b.order } }),
        db.workoutExercise.update({ where: { id: b.id }, data: { order: a.order } }),
    ]);
    revalidatePath(`/workouts/session/${workoutId}`);
}

export async function updateWorkoutExercise(
    workoutId: string,
    workoutExerciseId: string,
    data: { note?: string | null; restSec?: number | null; tempo?: string | null; groupKey?: string | null },
) {
    const user = await requireUser();
    await assertOwnWorkout(workoutId, user.id);
    await db.workoutExercise.update({ where: { id: workoutExerciseId }, data });
    revalidatePath(`/workouts/session/${workoutId}`);
}

/** Append a new set row to an exercise. */
export async function addSet(workoutId: string, workoutExerciseId: string, isWarmup = false) {
    const user = await requireUser();
    await assertOwnWorkout(workoutId, user.id);
    const count = await db.setEntry.count({ where: { workoutExerciseId } });
    await db.setEntry.create({
        data: { workoutExerciseId, order: count, isWarmup },
    });
    revalidatePath(`/workouts/session/${workoutId}`);
}

type SetPatch = {
    actualReps?: number | null;
    actualWeight?: number | null;
    actualSeconds?: number | null;
    actualMeters?: number | null;
    targetReps?: number | null;
    targetWeight?: number | null;
    rpe?: number | null;
    isWarmup?: boolean;
    isAmrap?: boolean;
    completed?: boolean;
    restTakenSec?: number | null;
};

export async function updateSet(workoutId: string, setId: string, patch: SetPatch) {
    const user = await requireUser();
    await assertOwnWorkout(workoutId, user.id);
    await db.setEntry.update({ where: { id: setId }, data: patch });
    revalidatePath(`/workouts/session/${workoutId}`);
}

export async function toggleSetComplete(workoutId: string, setId: string, completed: boolean) {
    const user = await requireUser();
    await assertOwnWorkout(workoutId, user.id);
    await db.setEntry.update({ where: { id: setId }, data: { completed } });
    // Keep PRs live: completing a set may set/raise a record for its exercise.
    if (completed) await recomputePersonalRecords(user.id, workoutId);
    revalidatePath(`/workouts/session/${workoutId}`);
    revalidatePath("/workouts/body");
}

export async function deleteSet(workoutId: string, setId: string) {
    const user = await requireUser();
    await assertOwnWorkout(workoutId, user.id);
    await db.setEntry.delete({ where: { id: setId } });
    revalidatePath(`/workouts/session/${workoutId}`);
}

export async function updateWorkoutMeta(workoutId: string, data: { name?: string | null; note?: string | null; rpe?: number | null }) {
    const user = await requireUser();
    await assertOwnWorkout(workoutId, user.id);
    await db.workout.update({ where: { id: workoutId }, data });
    revalidatePath(`/workouts/session/${workoutId}`);
}

/**
 * Pause/resume the session timer durably. Pause stamps `pausedAt`; resume folds
 * the elapsed pause window into `pausedMs` and clears `pausedAt`. This survives
 * the router.refresh() that every set mutation triggers (which client-only pause
 * state did not).
 */
export async function setWorkoutPaused(workoutId: string, paused: boolean) {
    const user = await requireUser();
    await assertOwnWorkout(workoutId, user.id);
    const w = await db.workout.findUnique({ where: { id: workoutId }, select: { pausedAt: true, pausedMs: true } });
    if (!w) throw new Error("Workout not found");
    // The where-guards on pausedAt make a second concurrent toggle (other tab/device)
    // match zero rows, so the pause window can't be double-counted.
    if (paused) {
        if (w.pausedAt == null) {
            await db.workout.updateMany({ where: { id: workoutId, pausedAt: null }, data: { pausedAt: new Date() } });
        }
    } else if (w.pausedAt != null) {
        const add = Math.max(0, Date.now() - w.pausedAt.getTime());
        await db.workout.updateMany({ where: { id: workoutId, pausedAt: { not: null } }, data: { pausedAt: null, pausedMs: w.pausedMs + add } });
    }
    revalidatePath(`/workouts/session/${workoutId}`);
}

/** Finish a workout: set endedAt, run progression + PR detection. */
export async function finishWorkout(workoutId: string, data?: { note?: string | null; rpe?: number | null }): Promise<{ prs: string[] }> {
    const user = await requireUser();
    await assertOwnWorkout(workoutId, user.id);
    const workout = await db.workout.findUnique({ where: { id: workoutId }, select: { startedAt: true, pausedAt: true, pausedMs: true } });
    const endedAt = new Date();
    // If finishing while paused, fold the final pause window into pausedMs and clear
    // pausedAt so the workout is never left in a paused state (which would otherwise
    // make a later Reopen+Resume count the entire closed period as pause time).
    const foldedPausedMs = workout?.pausedAt
        ? (workout.pausedMs ?? 0) + Math.max(0, endedAt.getTime() - workout.pausedAt.getTime())
        : workout?.pausedMs ?? 0;
    await db.workout.update({
        where: { id: workoutId },
        data: {
            endedAt,
            startedAt: workout?.startedAt ?? endedAt,
            pausedAt: null,
            pausedMs: foldedPausedMs,
            note: data?.note ?? undefined,
            rpe: data?.rpe ?? undefined,
        },
    });
    await advanceTemplateAfterWorkout(workoutId);
    const prs = await recomputePersonalRecords(user.id, workoutId);
    revalidatePath("/workouts");
    revalidatePath("/workouts/body");
    revalidatePath(`/workouts/session/${workoutId}`);
    return { prs };
}

export async function reopenWorkout(workoutId: string) {
    const user = await requireUser();
    await assertOwnWorkout(workoutId, user.id);
    // Resume cleanly: clear any stale pausedAt so the closed period isn't counted as pause.
    await db.workout.update({ where: { id: workoutId }, data: { endedAt: null, pausedAt: null } });
    revalidatePath(`/workouts/session/${workoutId}`);
}

export async function deleteWorkout(workoutId: string) {
    const user = await requireUser();
    await assertOwnWorkout(workoutId, user.id);
    await db.workout.update({ where: { id: workoutId }, data: { deletedAt: new Date() } });
    // Rebuild PRs so records set by the deleted workout don't linger as phantoms.
    await recomputeAllPersonalRecords(user.id);
    revalidatePath("/workouts");
    revalidatePath("/workouts/log");
    revalidatePath("/workouts/schedule");
    revalidatePath("/workouts/body");
}
