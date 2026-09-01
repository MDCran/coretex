"use server";

import { revalidatePath } from "next/cache";
import type { ExerciseForce, ExerciseLevel, ExerciseMechanic, MediaType } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadUserMediaFile } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";
import { slugify } from "@/lib/workouts";

function strArray(form: FormData, key: string): string[] {
    const raw = (form.get(key) as string | null) ?? "";
    return raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

function enumOrNull<T extends string>(form: FormData, key: string): T | null {
    const v = (form.get(key) as string | null) ?? "";
    return v ? (v as T) : null;
}

/** A custom exercise may derive only from the caller's exercise or a global library exercise. */
async function allowedParentId(userId: string, form: FormData, exerciseId?: string): Promise<string | null> {
    const parentId = ((form.get("parentId") as string | null) ?? "").trim();
    if (!parentId) return null;
    if (exerciseId && parentId === exerciseId) throw new Error("An exercise cannot be its own parent");
    const parent = await db.exercise.findFirst({
        where: { id: parentId, OR: [{ userId }, { userId: null }] },
        select: { id: true },
    });
    if (!parent) throw new Error("Parent exercise not found");
    return parent.id;
}

/** Create a custom exercise owned by the current user. */
export async function createExercise(form: FormData) {
    const user = await requireUser();
    const name = (form.get("name") as string)?.trim();
    if (!name) throw new Error("Name is required");
    const parentId = await allowedParentId(user.id, form);

    let mediaKey: string | null = null;
    let mediaType: MediaType | null = enumOrNull<MediaType>(form, "mediaType");
    const mediaFile = form.get("mediaFile") as File | null;
    if (mediaFile && mediaFile.size > 0) {
        const up = await uploadUserMediaFile(user.id, "workouts", mediaFile);
        mediaKey = up.fileKey;
        mediaType = mediaType ?? (up.mimeType.startsWith("video") ? "VIDEO" : "IMAGE");
    }

    const created = await db.exercise.create({
        data: {
            userId: user.id,
            name,
            slug: slugify(name),
            muscles: strArray(form, "muscles"),
            secondaryMuscles: strArray(form, "secondaryMuscles"),
            equipment: strArray(form, "equipment"),
            parentId,
            instructions: (form.get("instructions") as string) || null,
            notes: (form.get("notes") as string) || null,
            mediaUrl: (form.get("mediaUrl") as string) || null,
            mediaKey,
            mediaType,
            category: (form.get("category") as string) || null,
            force: enumOrNull<ExerciseForce>(form, "force"),
            level: enumOrNull<ExerciseLevel>(form, "level"),
            mechanic: enumOrNull<ExerciseMechanic>(form, "mechanic"),
            tracksReps: form.get("tracksReps") === "on",
            tracksWeight: form.get("tracksWeight") === "on",
            tracksTime: form.get("tracksTime") === "on",
            tracksDistance: form.get("tracksDistance") === "on",
        },
    }).catch(async (error) => {
        if (mediaKey) await deleteObject(mediaKey).catch(() => {});
        throw error;
    });
    revalidatePath("/workouts/exercises");
    return created.slug;
}

/** Quick-create a minimal weighted exercise (used inside the session add-exercise modal). */
export async function quickCreateExercise(name: string): Promise<{ id: string; name: string; slug: string }> {
    const user = await requireUser();
    const clean = name.trim();
    if (!clean) throw new Error("Name is required");
    const created = await db.exercise.create({
        data: { userId: user.id, name: clean, slug: slugify(clean), tracksReps: true, tracksWeight: true },
        select: { id: true, name: true, slug: true },
    });
    revalidatePath("/workouts/exercises");
    return created;
}

export async function updateExercise(exerciseId: string, form: FormData) {
    const user = await requireUser();
    const existing = await db.exercise.findFirst({ where: { id: exerciseId, userId: user.id } });
    if (!existing) throw new Error("Exercise not found or not editable");
    const parentId = await allowedParentId(user.id, form, exerciseId);

    let mediaKey = existing.mediaKey;
    let mediaType = existing.mediaType;
    const mediaFile = form.get("mediaFile") as File | null;
    if (mediaFile && mediaFile.size > 0) {
        const up = await uploadUserMediaFile(user.id, "workouts", mediaFile);
        mediaKey = up.fileKey;
        mediaType = up.mimeType.startsWith("video") ? "VIDEO" : "IMAGE";
    }

    try {
        await db.exercise.update({
            where: { id: exerciseId },
            data: {
                name: (form.get("name") as string)?.trim() || existing.name,
                muscles: strArray(form, "muscles"),
                secondaryMuscles: strArray(form, "secondaryMuscles"),
                equipment: strArray(form, "equipment"),
                parentId,
                instructions: (form.get("instructions") as string) || null,
                notes: (form.get("notes") as string) || null,
                mediaUrl: (form.get("mediaUrl") as string) || null,
                mediaKey,
                mediaType,
                category: (form.get("category") as string) || null,
                force: enumOrNull<ExerciseForce>(form, "force"),
                level: enumOrNull<ExerciseLevel>(form, "level"),
                mechanic: enumOrNull<ExerciseMechanic>(form, "mechanic"),
                tracksReps: form.get("tracksReps") === "on",
                tracksWeight: form.get("tracksWeight") === "on",
                tracksTime: form.get("tracksTime") === "on",
                tracksDistance: form.get("tracksDistance") === "on",
            },
        });
    } catch (error) {
        if (mediaKey !== existing.mediaKey && mediaKey) await deleteObject(mediaKey).catch(() => {});
        throw error;
    }
    if (mediaKey !== existing.mediaKey && existing.mediaKey) {
        await deleteObject(existing.mediaKey).catch(() => {});
    }
    revalidatePath("/workouts/exercises");
    revalidatePath(`/workouts/exercises/${existing.slug}`);
}

export async function archiveExercise(exerciseId: string, archived: boolean) {
    const user = await requireUser();
    const existing = await db.exercise.findFirst({ where: { id: exerciseId, userId: user.id } });
    if (!existing) throw new Error("Exercise not found or not editable");
    await db.exercise.update({
        where: { id: exerciseId },
        data: { archived, archivedAt: archived ? new Date() : null },
    });
    revalidatePath("/workouts/exercises");
}
