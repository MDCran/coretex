"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseForm, zText, zOptText, zId, zOptNum, zOptInt, zBool, zOptDate } from "@/lib/learning/zod";
import { runningGrade, DEFAULT_WEIGHTS, type GradeWeight, type GradeItem } from "@/lib/learning/grades";

function rl(...paths: string[]) {
    for (const p of paths) revalidatePath(p);
    revalidatePath("/learning");
}

/** Verify the parent class belongs to the user; throw otherwise. Returns the classId. */
async function requireOwnedClass(userId: string, classId: string): Promise<string> {
    const owned = await db.learningClass.findFirst({ where: { id: classId, userId }, select: { id: true } });
    if (!owned) throw new Error("Class not found");
    return owned.id;
}

/** Coerce the JSON gradeWeights column into a clean GradeWeight[] (falling back to defaults). */
function normalizeWeights(raw: unknown): GradeWeight[] {
    if (!Array.isArray(raw)) return DEFAULT_WEIGHTS;
    const out: GradeWeight[] = [];
    for (const w of raw) {
        if (w && typeof w === "object" && typeof (w as any).name === "string" && typeof (w as any).weight === "number") {
            out.push({ name: (w as any).name, weight: (w as any).weight });
        }
    }
    return out.length ? out : DEFAULT_WEIGHTS;
}

// ── Classes ──────────────────────────────────────────────────

const GRADE_LEVELS = ["HIGH_SCHOOL", "UNDERGRAD", "GRAD"] as const;
const CLASS_STATUSES = ["ACTIVE", "COMPLETED", "DROPPED"] as const;
const HOMEWORK_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "GRADED"] as const;

const classSchema = z.object({
    name: zText,
    gradeLevel: z.enum(GRADE_LEVELS).default("UNDERGRAD"),
    creditHours: zOptNum,
    term: zOptText,
    instructor: zOptText,
    color: zOptText,
    status: z.enum(CLASS_STATUSES).default("ACTIVE"),
    absenceLimit: zOptInt,
});

export async function createClass(fd: FormData) {
    const user = await requireUser();
    const data = parseForm(classSchema, fd);
    await db.learningClass.create({
        data: {
            userId: user.id,
            name: data.name,
            gradeLevel: data.gradeLevel,
            creditHours: data.creditHours ?? null,
            term: data.term ?? null,
            instructor: data.instructor ?? null,
            color: data.color ?? null,
            status: data.status,
            absenceLimit: data.absenceLimit ?? null,
            gradeWeights: DEFAULT_WEIGHTS as unknown as Prisma.InputJsonValue,
        },
    });
    rl("/learning/academic", "/learning/academic/planner");
}

export async function updateClass(fd: FormData) {
    const user = await requireUser();
    const data = parseForm(classSchema.extend({ id: zId }), fd);
    await db.learningClass.updateMany({
        where: { id: data.id, userId: user.id },
        data: {
            name: data.name,
            gradeLevel: data.gradeLevel,
            creditHours: data.creditHours ?? null,
            term: data.term ?? null,
            instructor: data.instructor ?? null,
            color: data.color ?? null,
            status: data.status,
            absenceLimit: data.absenceLimit ?? null,
        },
    });
    rl("/learning/academic", `/learning/academic/${data.id}`, "/learning/academic/planner");
}

export async function deleteClass(fd: FormData) {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    await db.learningClass.deleteMany({ where: { id, userId: user.id } });
    rl("/learning/academic", "/learning/academic/planner");
}

export async function setGradeWeights(fd: FormData) {
    const user = await requireUser();
    const { id, weights } = parseForm(z.object({ id: zId, weights: zText }), fd);
    await requireOwnedClass(user.id, id);

    let parsed: unknown;
    try {
        parsed = JSON.parse(weights);
    } catch {
        throw new Error("Invalid weights payload");
    }
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("At least one category is required");

    const clean: GradeWeight[] = [];
    for (const w of parsed) {
        const name = typeof (w as any)?.name === "string" ? (w as any).name.trim() : "";
        const weight = Number((w as any)?.weight);
        if (!name) throw new Error("Each category needs a name");
        if (!Number.isFinite(weight) || weight < 0) throw new Error("Each weight must be a non-negative number");
        clean.push({ name, weight });
    }
    const sum = clean.reduce((s, w) => s + w.weight, 0);
    // Loose check — allow rounding wiggle room.
    if (Math.abs(sum - 100) > 1) throw new Error(`Weights must sum to ~100% (currently ${Math.round(sum)}%)`);

    await db.learningClass.updateMany({ where: { id, userId: user.id }, data: { gradeWeights: clean as unknown as Prisma.InputJsonValue } });
    rl("/learning/academic", `/learning/academic/${id}`);
}

export async function completeClass(fd: FormData) {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    const cls = await db.learningClass.findFirst({
        where: { id, userId: user.id },
        include: {
            assignments: { where: { status: "GRADED" } },
            tests: true,
        },
    });
    if (!cls) throw new Error("Class not found");

    const weights = normalizeWeights(cls.gradeWeights);
    const items: GradeItem[] = [
        ...cls.assignments
            .filter((a) => a.pointsPossible != null)
            .map((a) => ({ category: a.category, earned: a.pointsEarned, possible: a.pointsPossible, extraCredit: a.extraCredit })),
        ...cls.tests.map((t) => ({
            category: t.category,
            earned: t.score == null ? null : t.score + (t.curveAdjustment ?? 0),
            possible: t.maxScore,
        })),
    ];
    const result = runningGrade(weights, items);

    await db.learningClass.updateMany({
        where: { id, userId: user.id },
        data: { status: "COMPLETED", finalGrade: result.percent ?? null },
    });
    rl("/learning/academic", `/learning/academic/${id}`);
}

export async function reopenClass(fd: FormData) {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    await db.learningClass.updateMany({ where: { id, userId: user.id }, data: { status: "ACTIVE", finalGrade: null } });
    rl("/learning/academic", `/learning/academic/${id}`);
}

// ── Assignments ──────────────────────────────────────────────

const assignmentSchema = z.object({
    classId: zId,
    title: zText,
    category: zOptText,
    dueDate: zOptDate,
    status: z.enum(HOMEWORK_STATUSES).default("NOT_STARTED"),
    pointsEarned: zOptNum,
    pointsPossible: zOptNum,
    extraCredit: zBool,
    notes: zOptText,
});

export async function createAssignment(fd: FormData) {
    const user = await requireUser();
    const data = parseForm(assignmentSchema, fd);
    await requireOwnedClass(user.id, data.classId);
    await db.classAssignment.create({
        data: {
            classId: data.classId,
            title: data.title,
            category: data.category ?? null,
            dueDate: data.dueDate ?? null,
            status: data.status,
            pointsEarned: data.pointsEarned ?? null,
            pointsPossible: data.pointsPossible ?? null,
            extraCredit: data.extraCredit,
            notes: data.notes ?? null,
        },
    });
    rl("/learning/academic", `/learning/academic/${data.classId}`, "/learning/academic/planner");
}

export async function updateAssignment(fd: FormData) {
    const user = await requireUser();
    const data = parseForm(assignmentSchema.extend({ id: zId }), fd);
    await requireOwnedClass(user.id, data.classId);
    const owned = await db.classAssignment.findFirst({ where: { id: data.id, classId: data.classId }, select: { id: true } });
    if (!owned) throw new Error("Assignment not found");
    await db.classAssignment.update({
        where: { id: data.id },
        data: {
            title: data.title,
            category: data.category ?? null,
            dueDate: data.dueDate ?? null,
            status: data.status,
            pointsEarned: data.pointsEarned ?? null,
            pointsPossible: data.pointsPossible ?? null,
            extraCredit: data.extraCredit,
            notes: data.notes ?? null,
        },
    });
    rl("/learning/academic", `/learning/academic/${data.classId}`, "/learning/academic/planner");
}

export async function deleteAssignment(fd: FormData) {
    const user = await requireUser();
    const { id, classId } = parseForm(z.object({ id: zId, classId: zId }), fd);
    await requireOwnedClass(user.id, classId);
    await db.classAssignment.deleteMany({ where: { id, classId } });
    rl("/learning/academic", `/learning/academic/${classId}`, "/learning/academic/planner");
}

// ── Tests / quizzes ──────────────────────────────────────────

const testSchema = z.object({
    classId: zId,
    title: zText,
    category: zOptText,
    date: zOptDate,
    score: zOptNum,
    maxScore: zOptNum,
    curveAdjustment: zOptNum,
});

export async function createTest(fd: FormData) {
    const user = await requireUser();
    const data = parseForm(testSchema, fd);
    await requireOwnedClass(user.id, data.classId);
    await db.classTest.create({
        data: {
            classId: data.classId,
            title: data.title,
            category: data.category ?? null,
            date: data.date ?? null,
            score: data.score ?? null,
            maxScore: data.maxScore ?? null,
            curveAdjustment: data.curveAdjustment ?? null,
        },
    });
    rl("/learning/academic", `/learning/academic/${data.classId}`, "/learning/academic/planner");
}

export async function updateTest(fd: FormData) {
    const user = await requireUser();
    const data = parseForm(testSchema.extend({ id: zId }), fd);
    await requireOwnedClass(user.id, data.classId);
    const owned = await db.classTest.findFirst({ where: { id: data.id, classId: data.classId }, select: { id: true } });
    if (!owned) throw new Error("Test not found");
    await db.classTest.update({
        where: { id: data.id },
        data: {
            title: data.title,
            category: data.category ?? null,
            date: data.date ?? null,
            score: data.score ?? null,
            maxScore: data.maxScore ?? null,
            curveAdjustment: data.curveAdjustment ?? null,
        },
    });
    rl("/learning/academic", `/learning/academic/${data.classId}`, "/learning/academic/planner");
}

export async function deleteTest(fd: FormData) {
    const user = await requireUser();
    const { id, classId } = parseForm(z.object({ id: zId, classId: zId }), fd);
    await requireOwnedClass(user.id, classId);
    await db.classTest.deleteMany({ where: { id, classId } });
    rl("/learning/academic", `/learning/academic/${classId}`, "/learning/academic/planner");
}

// ── Absences ─────────────────────────────────────────────────

const absenceSchema = z.object({
    classId: zId,
    date: zOptDate,
    reason: zOptText,
    excused: zBool,
});

export async function addAbsence(fd: FormData) {
    const user = await requireUser();
    const data = parseForm(absenceSchema, fd);
    await requireOwnedClass(user.id, data.classId);
    await db.classAbsence.create({
        data: {
            classId: data.classId,
            date: data.date ?? new Date(),
            reason: data.reason ?? null,
            excused: data.excused,
        },
    });
    rl("/learning/academic", `/learning/academic/${data.classId}`);
}

export async function deleteAbsence(fd: FormData) {
    const user = await requireUser();
    const { id, classId } = parseForm(z.object({ id: zId, classId: zId }), fd);
    await requireOwnedClass(user.id, classId);
    await db.classAbsence.deleteMany({ where: { id, classId } });
    rl("/learning/academic", `/learning/academic/${classId}`);
}
