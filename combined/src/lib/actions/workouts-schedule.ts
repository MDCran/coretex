"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateKeyToUtc } from "@/lib/workouts";
import { planExerciseSets } from "@/lib/workouts-progression";

/** Create a planned workout on a future (or any) date. */
export async function createSchedule(input: { dateKey: string; templateId?: string | null; name?: string | null; notes?: string | null }) {
    const user = await requireUser();
    if (input.templateId) {
        const t = await db.template.findFirst({ where: { id: input.templateId, userId: user.id }, select: { id: true } });
        if (!t) throw new Error("Template not found");
    }
    await db.workoutSchedule.create({
        data: {
            userId: user.id,
            date: dateKeyToUtc(input.dateKey),
            templateId: input.templateId || null,
            name: input.name?.trim() || null,
            notes: input.notes?.trim() || null,
        },
    });
    revalidatePath("/workouts/schedule");
    revalidatePath("/workouts/log");
    revalidatePath("/workouts");
}

export async function updateSchedule(id: string, input: { dateKey?: string; templateId?: string | null; name?: string | null; notes?: string | null }) {
    const user = await requireUser();
    const existing = await db.workoutSchedule.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Plan not found");
    await db.workoutSchedule.update({
        where: { id },
        data: {
            date: input.dateKey ? dateKeyToUtc(input.dateKey) : undefined,
            templateId: input.templateId === undefined ? undefined : input.templateId || null,
            name: input.name === undefined ? undefined : input.name?.trim() || null,
            notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
        },
    });
    revalidatePath("/workouts/schedule");
    revalidatePath("/workouts/log");
    revalidatePath("/workouts");
}

export async function setScheduleSkipped(id: string, skipped: boolean) {
    const user = await requireUser();
    const existing = await db.workoutSchedule.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Plan not found");
    await db.workoutSchedule.update({ where: { id }, data: { skipped } });
    revalidatePath("/workouts/schedule");
    revalidatePath("/workouts/log");
    revalidatePath("/workouts");
}

export async function deleteSchedule(id: string) {
    const user = await requireUser();
    const existing = await db.workoutSchedule.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Plan not found");
    await db.workoutSchedule.delete({ where: { id } });
    revalidatePath("/workouts/schedule");
    revalidatePath("/workouts/log");
    revalidatePath("/workouts");
}

/**
 * Start a planned workout: create a session (from its template if any, else blank),
 * link it to the schedule, and return the new workout id.
 */
export async function startScheduledWorkout(scheduleId: string): Promise<string> {
    const user = await requireUser();
    const plan = await db.workoutSchedule.findFirst({
        where: { id: scheduleId, userId: user.id },
        include: { template: { include: { exercises: { include: { sets: true }, orderBy: { order: "asc" } } } } },
    });
    if (!plan) throw new Error("Plan not found");
    if (plan.workoutId) return plan.workoutId; // already started

    const dateKey = plan.date.toISOString().slice(0, 10);
    let workoutId: string;

    if (plan.template) {
        const template = plan.template;
        const workout = await db.workout.create({
            data: {
                userId: user.id,
                date: dateKeyToUtc(dateKey),
                name: plan.name?.trim() || template.name,
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
        workoutId = workout.id;
    } else {
        const workout = await db.workout.create({
            data: {
                userId: user.id,
                date: dateKeyToUtc(dateKey),
                name: plan.name?.trim() || null,
                startedAt: new Date(),
            },
        });
        workoutId = workout.id;
    }

    await db.workoutSchedule.update({ where: { id: plan.id }, data: { workoutId, skipped: false } });

    revalidatePath("/workouts/schedule");
    revalidatePath("/workouts/log");
    revalidatePath("/workouts");
    return workoutId;
}
