"use server";

import { revalidatePath } from "next/cache";
import type { ProgressionScheme } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export type TemplateSetInput = {
    targetReps?: number | null;
    targetRepsMin?: number | null;
    targetRepsMax?: number | null;
    targetWeight?: number | null;
    targetRpe?: number | null;
    isAmrap?: boolean;
    isWarmup?: boolean;
};

export type TemplateExerciseInput = {
    exerciseId: string;
    targetSets?: number | null;
    targetReps?: number | null;
    targetRepsMin?: number | null;
    targetRepsMax?: number | null;
    targetWeight?: number | null;
    trainingMaxKg?: number | null;
    targetTimeSec?: number | null;
    targetDistanceM?: number | null;
    note?: string | null;
    restSec?: number | null;
    warmupSets?: Array<{ pct: number; reps: number }> | null;
    groupKey?: string | null;
    targetRpe?: number | null;
    tempo?: string | null;
    perSetMode?: boolean;
    sets?: TemplateSetInput[];
};

export type TemplateInput = {
    name: string;
    note?: string | null;
    progression: ProgressionScheme;
    progressionStepKg?: number | null;
    cycleWeek?: number | null;
    exercises: TemplateExerciseInput[];
};

async function writeExercises(templateId: string, exercises: TemplateExerciseInput[]) {
    for (let i = 0; i < exercises.length; i++) {
        const te = exercises[i];
        await db.templateExercise.create({
            data: {
                templateId,
                exerciseId: te.exerciseId,
                order: i,
                targetSets: te.targetSets ?? null,
                targetReps: te.targetReps ?? null,
                targetRepsMin: te.targetRepsMin ?? null,
                targetRepsMax: te.targetRepsMax ?? null,
                targetWeight: te.targetWeight ?? null,
                trainingMaxKg: te.trainingMaxKg ?? null,
                targetTimeSec: te.targetTimeSec ?? null,
                targetDistanceM: te.targetDistanceM ?? null,
                note: te.note ?? null,
                restSec: te.restSec ?? null,
                warmupSets: te.warmupSets && te.warmupSets.length > 0 ? te.warmupSets : undefined,
                groupKey: te.groupKey ?? null,
                targetRpe: te.targetRpe ?? null,
                tempo: te.tempo ?? null,
                perSetMode: te.perSetMode ?? false,
                sets:
                    te.perSetMode && te.sets && te.sets.length > 0
                        ? {
                              create: te.sets.map((s, si) => ({
                                  order: si,
                                  targetReps: s.targetReps ?? null,
                                  targetRepsMin: s.targetRepsMin ?? null,
                                  targetRepsMax: s.targetRepsMax ?? null,
                                  targetWeight: s.targetWeight ?? null,
                                  targetRpe: s.targetRpe ?? null,
                                  isAmrap: s.isAmrap ?? false,
                                  isWarmup: s.isWarmup ?? false,
                              })),
                          }
                        : undefined,
            },
        });
    }
}

export async function createTemplate(input: TemplateInput): Promise<string> {
    const user = await requireUser();
    if (!input.name?.trim()) throw new Error("Name is required");
    const template = await db.template.create({
        data: {
            userId: user.id,
            name: input.name.trim(),
            note: input.note ?? null,
            progression: input.progression,
            progressionStepKg: input.progressionStepKg ?? null,
            cycleWeek: input.progression === "FIVETHREEONE" ? input.cycleWeek ?? 1 : null,
        },
    });
    await writeExercises(template.id, input.exercises);
    revalidatePath("/workouts/templates");
    return template.id;
}

export async function updateTemplate(templateId: string, input: TemplateInput) {
    const user = await requireUser();
    const existing = await db.template.findFirst({ where: { id: templateId, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Template not found");

    await db.template.update({
        where: { id: templateId },
        data: {
            name: input.name.trim(),
            note: input.note ?? null,
            progression: input.progression,
            progressionStepKg: input.progressionStepKg ?? null,
            cycleWeek: input.progression === "FIVETHREEONE" ? input.cycleWeek ?? 1 : null,
        },
    });
    // Replace all exercises (simplest correct strategy for the editor).
    await db.templateExercise.deleteMany({ where: { templateId } });
    await writeExercises(templateId, input.exercises);
    revalidatePath("/workouts/templates");
    revalidatePath(`/workouts/templates/${templateId}`);
}

export async function archiveTemplate(templateId: string, archived: boolean) {
    const user = await requireUser();
    const existing = await db.template.findFirst({ where: { id: templateId, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Template not found");
    await db.template.update({ where: { id: templateId }, data: { archived } });
    revalidatePath("/workouts/templates");
}

/** Deep-copy a template (its exercises and per-set definitions) into a new one. */
export async function duplicateTemplate(templateId: string): Promise<string> {
    const user = await requireUser();
    const src = await db.template.findFirst({
        where: { id: templateId, userId: user.id },
        include: { exercises: { orderBy: { order: "asc" }, include: { sets: { orderBy: { order: "asc" } } } } },
    });
    if (!src) throw new Error("Template not found");

    const copy = await db.template.create({
        data: {
            userId: user.id,
            name: `${src.name} (copy)`,
            note: src.note,
            progression: src.progression,
            progressionStepKg: src.progressionStepKg,
            cycleWeek: src.cycleWeek,
        },
    });

    for (const te of src.exercises) {
        await db.templateExercise.create({
            data: {
                templateId: copy.id,
                exerciseId: te.exerciseId,
                order: te.order,
                targetSets: te.targetSets,
                targetReps: te.targetReps,
                targetRepsMin: te.targetRepsMin,
                targetRepsMax: te.targetRepsMax,
                targetWeight: te.targetWeight,
                trainingMaxKg: te.trainingMaxKg,
                targetTimeSec: te.targetTimeSec,
                targetDistanceM: te.targetDistanceM,
                note: te.note,
                restSec: te.restSec,
                warmupSets: te.warmupSets ?? undefined,
                groupKey: te.groupKey,
                targetRpe: te.targetRpe,
                tempo: te.tempo,
                perSetMode: te.perSetMode,
                sets:
                    te.sets.length > 0
                        ? {
                              create: te.sets.map((s) => ({
                                  order: s.order,
                                  targetReps: s.targetReps,
                                  targetRepsMin: s.targetRepsMin,
                                  targetRepsMax: s.targetRepsMax,
                                  targetWeight: s.targetWeight,
                                  targetRpe: s.targetRpe,
                                  isAmrap: s.isAmrap,
                                  isWarmup: s.isWarmup,
                              })),
                          }
                        : undefined,
            },
        });
    }

    revalidatePath("/workouts/templates");
    return copy.id;
}

export async function deleteTemplate(templateId: string) {
    const user = await requireUser();
    const existing = await db.template.findFirst({ where: { id: templateId, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Template not found");
    await db.template.delete({ where: { id: templateId } });
    revalidatePath("/workouts/templates");
}
