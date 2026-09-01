"use server";

import { revalidatePath } from "next/cache";
import type { PhotoAngle, TrainingPhase } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadUserRasterImage } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";

export async function uploadProgressPhoto(form: FormData) {
    const user = await requireUser();
    const file = form.get("file") as File | null;
    if (!file || file.size === 0) throw new Error("A photo file is required");

    const up = await uploadUserRasterImage(user.id, "workouts", file);

    const angle = (form.get("angle") as string) || "";
    const phase = (form.get("phase") as string) || "";
    const weight = form.get("weightKg");
    const takenAt = (form.get("takenAt") as string) || "";
    let workoutId: string | null = null;
    try {
        workoutId = await resolveWorkoutId(user.id, (form.get("workoutId") as string) || "");
        await db.progressPhoto.create({
            data: {
                userId: user.id,
                originalKey: up.fileKey,
                angle: angle ? (angle as PhotoAngle) : null,
                phase: phase ? (phase as TrainingPhase) : null,
                weightKg: weight && weight !== "" ? Number(weight) : null,
                takenAt: takenAt ? new Date(takenAt) : new Date(),
                notes: (form.get("notes") as string) || null,
                workoutId,
                processed: true,
            },
        });
    } catch (error) {
        await deleteObject(up.fileKey).catch(() => {});
        throw error;
    }
    revalidatePath("/workouts/progress");
    revalidatePath("/health/photos");
    if (workoutId) revalidatePath(`/workouts/session/${workoutId}`);
}

/** Validate that an optional workoutId belongs to the user; returns null otherwise. */
async function resolveWorkoutId(userId: string, workoutId: string): Promise<string | null> {
    if (!workoutId) return null;
    const w = await db.workout.findFirst({ where: { id: workoutId, userId, deletedAt: null }, select: { id: true } });
    return w ? w.id : null;
}

export async function deleteProgressPhoto(id: string) {
    const user = await requireUser();
    const existing = await db.progressPhoto.findFirst({
        where: { id, userId: user.id },
        select: { id: true, originalKey: true, thumbKey: true, blurKey: true },
    });
    if (!existing) throw new Error("Not found");
    await db.progressPhoto.delete({ where: { id } });
    await Promise.all([existing.originalKey, existing.thumbKey, existing.blurKey].filter((key): key is string => Boolean(key)).map((key) => deleteObject(key).catch(() => {})));
    revalidatePath("/workouts/progress");
    revalidatePath("/health/photos");
}

export async function updateProgressPhoto(
    id: string,
    data: { angle?: string | null; phase?: string | null; notes?: string | null; weightKg?: number | null; takenAt?: string | null },
) {
    const user = await requireUser();
    const existing = await db.progressPhoto.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Not found");
    await db.progressPhoto.update({
        where: { id },
        data: {
            angle: data.angle ? (data.angle as PhotoAngle) : null,
            phase: data.phase ? (data.phase as TrainingPhase) : null,
            notes: data.notes ?? null,
            weightKg: data.weightKg ?? null,
            takenAt: data.takenAt ? new Date(data.takenAt) : undefined,
        },
    });
    revalidatePath("/workouts/progress");
    revalidatePath("/health/photos");
}
