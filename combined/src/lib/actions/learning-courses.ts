"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadUserMediaFile } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";
import { detectLearningProvider } from "@/lib/learning/provider";
import { fetchVideoMeta } from "@/lib/learning/youtube";
import { parseForm, zText, zOptText, zId, zOptInt, zInt } from "@/lib/learning/zod";

function rl(...paths: string[]) {
    for (const p of paths) revalidatePath(p);
    revalidatePath("/learning");
}

// ── Course CRUD ──────────────────────────────────────────────

const addCourseSchema = z.object({
    url: zOptText,
    title: zOptText,
    description: zOptText,
    thumbnailUrl: zOptText,
    totalDurationSeconds: zOptInt,
});

export async function addCourse(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(addCourseSchema, fd);

    const provider = detectLearningProvider(input.url);

    let title = input.title;
    let thumbnailUrl = input.thumbnailUrl;
    let url = input.url;

    if (provider === "youtube") {
        if (!input.url) throw new Error("A YouTube URL is required");
        const meta = await fetchVideoMeta(input.url);
        // Auto-fill from oEmbed; allow a manual title override if provided.
        title = input.title ?? meta.title;
        thumbnailUrl = input.thumbnailUrl ?? meta.thumbnailUrl;
        url = meta.url;
    } else {
        if (!title) throw new Error("Title is required for non-YouTube courses");
    }

    if (!title) throw new Error("Title is required");

    await db.learningCourse.create({
        data: {
            userId: user.id,
            title,
            provider,
            url: url ?? null,
            thumbnailUrl: thumbnailUrl ?? null,
            description: input.description ?? null,
            totalDurationSeconds: input.totalDurationSeconds ?? null,
            status: "planned",
        },
    });
    rl("/learning/courses");
}

const updateCourseSchema = z.object({
    id: zId,
    title: zText,
    url: zOptText,
    thumbnailUrl: zOptText,
    description: zOptText,
    totalDurationSeconds: zOptInt,
});

export async function updateCourseDetails(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(updateCourseSchema, fd);
    const res = await db.learningCourse.updateMany({
        where: { id: input.id, userId: user.id },
        data: {
            title: input.title,
            url: input.url ?? null,
            thumbnailUrl: input.thumbnailUrl ?? null,
            description: input.description ?? null,
            totalDurationSeconds: input.totalDurationSeconds ?? null,
        },
    });
    if (res.count === 0) throw new Error("Course not found");
    rl(`/learning/courses/${input.id}`, "/learning/courses");
}

export async function deleteCourse(fd: FormData) {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    const course = await db.learningCourse.findFirst({
        where: { id, userId: user.id },
        select: { certificateKey: true },
    });
    if (course) {
        await db.learningCourse.delete({ where: { id } });
        if (course.certificateKey) await deleteObject(course.certificateKey).catch(() => {});
    }
    rl("/learning/courses");
}

const statusSchema = z.object({
    id: zId,
    status: z.enum(["planned", "in_progress", "completed"]),
});

export async function setCourseStatus(fd: FormData) {
    const user = await requireUser();
    const { id, status } = parseForm(statusSchema, fd);

    const data: { status: string; startedOn?: Date | null; completedOn?: Date | null } = { status };
    if (status === "in_progress") {
        data.startedOn = new Date();
        data.completedOn = null;
    } else if (status === "completed") {
        data.completedOn = new Date();
    } else {
        data.completedOn = null;
    }

    const res = await db.learningCourse.updateMany({ where: { id, userId: user.id }, data });
    if (res.count === 0) throw new Error("Course not found");
    rl(`/learning/courses/${id}`, "/learning/courses");
}

// ── Sections (LearningLesson) ────────────────────────────────

async function ownedCourse(courseId: string, userId: string) {
    const course = await db.learningCourse.findFirst({ where: { id: courseId, userId }, select: { id: true } });
    if (!course) throw new Error("Course not found");
    return course;
}

const addSectionSchema = z.object({
    courseId: zId,
    title: zText,
    description: zOptText,
    estimatedMinutes: zOptInt,
});

export async function addSection(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(addSectionSchema, fd);
    await ownedCourse(input.courseId, user.id);
    const count = await db.learningLesson.count({ where: { courseId: input.courseId } });
    await db.learningLesson.create({
        data: {
            courseId: input.courseId,
            title: input.title,
            description: input.description ?? null,
            estimatedMinutes: input.estimatedMinutes ?? null,
            order: count,
        },
    });
    rl(`/learning/courses/${input.courseId}`, "/learning/courses");
}

const updateSectionSchema = z.object({
    id: zId,
    title: zText,
    description: zOptText,
    estimatedMinutes: zOptInt,
});

export async function updateSection(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(updateSectionSchema, fd);
    const lesson = await db.learningLesson.findFirst({
        where: { id: input.id, course: { userId: user.id } },
        select: { courseId: true },
    });
    if (!lesson) throw new Error("Section not found");
    await db.learningLesson.update({
        where: { id: input.id },
        data: {
            title: input.title,
            description: input.description ?? null,
            estimatedMinutes: input.estimatedMinutes ?? null,
        },
    });
    rl(`/learning/courses/${lesson.courseId}`, "/learning/courses");
}

export async function toggleSection(fd: FormData) {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    const lesson = await db.learningLesson.findFirst({
        where: { id, course: { userId: user.id } },
        select: { completed: true, courseId: true },
    });
    if (!lesson) throw new Error("Section not found");
    await db.learningLesson.update({ where: { id }, data: { completed: !lesson.completed } });
    rl(`/learning/courses/${lesson.courseId}`, "/learning/courses");
}

export async function deleteSection(fd: FormData) {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    const lesson = await db.learningLesson.findFirst({
        where: { id, course: { userId: user.id } },
        select: { courseId: true },
    });
    if (!lesson) throw new Error("Section not found");
    await db.learningLesson.delete({ where: { id } });
    rl(`/learning/courses/${lesson.courseId}`, "/learning/courses");
}

// ── Time logging ─────────────────────────────────────────────

const logTimeSchema = z.object({
    id: zId,
    minutes: zInt.refine((n) => n > 0, "Minutes must be greater than 0"),
});

export async function logCourseTime(fd: FormData) {
    const user = await requireUser();
    const { id, minutes } = parseForm(logTimeSchema, fd);
    const course = await db.learningCourse.findFirst({ where: { id, userId: user.id }, select: { title: true } });
    if (!course) throw new Error("Course not found");

    await db.$transaction([
        db.learningCourse.update({
            where: { id },
            data: { timeInvestedMinutes: { increment: minutes } },
        }),
        db.learningSession.create({
            data: {
                userId: user.id,
                sessionDate: new Date(),
                durationMinutes: minutes,
                subject: course.title,
                courseId: id,
            },
        }),
    ]);
    rl(`/learning/courses/${id}`, "/learning/courses", "/learning/sessions");
}

// ── Rating & review ──────────────────────────────────────────

const rateSchema = z.object({
    id: zId,
    rating: z.coerce.number().int().min(1, "Rating must be 1-5").max(5, "Rating must be 1-5"),
    review: zOptText,
});

export async function rateCourse(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(rateSchema, fd);
    const res = await db.learningCourse.updateMany({
        where: { id: input.id, userId: user.id },
        data: { rating: input.rating, review: input.review ?? null },
    });
    if (res.count === 0) throw new Error("Course not found");
    rl(`/learning/courses/${input.id}`, "/learning/courses");
}

// ── Certificate upload ───────────────────────────────────────

export async function uploadCertificate(fd: FormData) {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Please choose a file to upload");

    const course = await db.learningCourse.findFirst({
        where: { id, userId: user.id },
        select: { id: true, certificateKey: true },
    });
    if (!course) throw new Error("Course not found");

    const { fileKey } = await uploadUserMediaFile(user.id, "learning/certificates", file);
    try {
        await db.learningCourse.update({ where: { id }, data: { certificateKey: fileKey } });
    } catch (error) {
        await deleteObject(fileKey).catch(() => {});
        throw error;
    }
    if (course.certificateKey && course.certificateKey !== fileKey) {
        await deleteObject(course.certificateKey).catch(() => {});
    }
    rl(`/learning/courses/${id}`, "/learning/courses");
}

// ── Linked goal ──────────────────────────────────────────────

const linkedGoalSchema = z.object({
    id: zId,
    linkedGoalId: zOptText,
});

export async function setLinkedGoal(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(linkedGoalSchema, fd);

    if (input.linkedGoalId) {
        const goal = await db.learningGoal.findFirst({
            where: { id: input.linkedGoalId, userId: user.id },
            select: { id: true },
        });
        if (!goal) throw new Error("Goal not found");
    }

    const res = await db.learningCourse.updateMany({
        where: { id: input.id, userId: user.id },
        data: { linkedGoalId: input.linkedGoalId ?? null },
    });
    if (res.count === 0) throw new Error("Course not found");
    rl(`/learning/courses/${input.id}`, "/learning/courses");
}
