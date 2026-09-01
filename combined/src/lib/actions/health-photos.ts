"use server";

import { revalidatePath } from "next/cache";
import { PhotoAngle, TrainingPhase } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadUserRasterImage } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";
import { num, parseOptionalDateTime, str } from "./health-shared";

function parseAngle(v: string | null): PhotoAngle | null {
    if (v === "FRONT" || v === "SIDE" || v === "BACK") return v;
    return null;
}
function parsePhase(v: string | null): TrainingPhase | null {
    if (v === "BULK" || v === "CUT" || v === "MAINTAIN") return v;
    return null;
}

export async function createProgressPhoto(fd: FormData) {
    const user = await requireUser();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("A photo is required");
    const uploaded = await uploadUserRasterImage(user.id, "health", file);

    let workoutId: string | null = null;
    try {
        // Optional link to a workout (must belong to the user).
        const workoutIdRaw = str(fd, "workoutId");
        if (workoutIdRaw) {
            const w = await db.workout.findFirst({ where: { id: workoutIdRaw, userId: user.id, deletedAt: null }, select: { id: true } });
            workoutId = w ? w.id : null;
        }

        await db.progressPhoto.create({
            data: {
                userId: user.id,
                originalKey: uploaded.fileKey,
                angle: parseAngle(str(fd, "angle")),
                phase: parsePhase(str(fd, "phase")),
                weightKg: num(fd, "weightKg"),
                notes: str(fd, "notes"),
                takenAt: parseOptionalDateTime(str(fd, "takenAt")) ?? new Date(),
                workoutId,
            },
        });
    } catch (error) {
        await deleteObject(uploaded.fileKey).catch(() => {});
        throw error;
    }
    revalidatePath("/health/photos");
    revalidatePath("/health");
    revalidatePath("/workouts/progress");
    if (workoutId) revalidatePath(`/workouts/session/${workoutId}`);
}

export async function deleteProgressPhoto(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.progressPhoto.findFirst({
        where: { id, userId: user.id },
        select: { id: true, originalKey: true, thumbKey: true, blurKey: true },
    });
    if (!existing) return;
    await db.progressPhoto.delete({ where: { id: existing.id } });
    await Promise.all([existing.originalKey, existing.thumbKey, existing.blurKey].filter((key): key is string => Boolean(key)).map((key) => deleteObject(key).catch(() => {})));
    revalidatePath("/health/photos");
    revalidatePath("/health");
    revalidatePath("/workouts/progress");
}
