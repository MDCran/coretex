"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseForm, zText, zOptText, zId, zOptInt, zOptDate } from "@/lib/learning/zod";

function rl(...paths: string[]) {
    for (const p of paths) revalidatePath(p);
    revalidatePath("/learning/goals");
    revalidatePath("/learning");
}

/** Local midnight today (used for @db.Date and date math). */
function today(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

/** Whole-day difference between two local-midnight dates (a − b), in days. */
function dayDiff(a: Date, b: Date): number {
    const A = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    const B = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    return Math.round((A - B) / 86_400_000);
}

/** Resolve a goal's short, human-readable label. */
function goalLabel(goal: { title: string | null; description: string }): string {
    return goal.title?.trim() || goal.description;
}

// ── Goals ────────────────────────────────────────────────────

const createGoalSchema = z.object({
    title: zOptText,
    description: zText,
    goalType: zOptText,
    targetDate: zOptDate,
    color: zOptText,
});

export async function createGoal(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(createGoalSchema, fd);
    await db.learningGoal.create({
        data: {
            userId: user.id,
            title: input.title ?? null,
            description: input.description,
            goalType: input.goalType ?? null,
            targetDate: input.targetDate ?? null,
            color: input.color ?? null,
        },
    });
    rl();
}

const updateGoalSchema = z.object({
    id: zId,
    title: zOptText,
    description: zText,
    goalType: zOptText,
    targetDate: zOptDate,
    color: zOptText,
});

export async function updateGoal(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(updateGoalSchema, fd);
    const res = await db.learningGoal.updateMany({
        where: { id: input.id, userId: user.id },
        data: {
            title: input.title ?? null,
            description: input.description,
            goalType: input.goalType ?? null,
            targetDate: input.targetDate ?? null,
            color: input.color ?? null,
        },
    });
    if (res.count === 0) throw new Error("Goal not found");
    rl(`/learning/goals/${input.id}`);
}

export async function deleteGoal(fd: FormData) {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    await db.learningGoal.deleteMany({ where: { id, userId: user.id } });
    rl();
}

export async function completeGoal(fd: FormData) {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    const goal = await db.learningGoal.findFirst({ where: { id, userId: user.id }, select: { completed: true } });
    if (!goal) throw new Error("Goal not found");
    await db.learningGoal.update({ where: { id }, data: { completed: !goal.completed } });
    rl(`/learning/goals/${id}`);
}

// ── Milestones ───────────────────────────────────────────────

async function ownedGoal(goalId: string, userId: string) {
    const goal = await db.learningGoal.findFirst({ where: { id: goalId, userId }, select: { id: true } });
    if (!goal) throw new Error("Goal not found");
    return goal;
}

const addMilestoneSchema = z.object({
    goalId: zId,
    title: zText,
    dueDate: zOptDate,
});

export async function addMilestone(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(addMilestoneSchema, fd);
    await ownedGoal(input.goalId, user.id);
    const count = await db.goalMilestone.count({ where: { goalId: input.goalId } });
    await db.goalMilestone.create({
        data: {
            goalId: input.goalId,
            title: input.title,
            dueDate: input.dueDate ?? null,
            order: count,
        },
    });
    rl(`/learning/goals/${input.goalId}`);
}

const updateMilestoneSchema = z.object({
    id: zId,
    title: zText,
    dueDate: zOptDate,
});

export async function updateMilestone(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(updateMilestoneSchema, fd);
    const milestone = await db.goalMilestone.findFirst({
        where: { id: input.id, goal: { userId: user.id } },
        select: { goalId: true },
    });
    if (!milestone) throw new Error("Milestone not found");
    await db.goalMilestone.update({
        where: { id: input.id },
        data: { title: input.title, dueDate: input.dueDate ?? null },
    });
    rl(`/learning/goals/${milestone.goalId}`);
}

const MILESTONE_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "DONE"] as const;

const setMilestoneStatusSchema = z.object({
    id: zId,
    /** Optional explicit status; when omitted the status cycles forward. */
    status: z.enum(MILESTONE_STATUSES).optional(),
});

export async function setMilestoneStatus(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(setMilestoneStatusSchema, fd);
    const milestone = await db.goalMilestone.findFirst({
        where: { id: input.id, goal: { userId: user.id } },
        select: { goalId: true, status: true },
    });
    if (!milestone) throw new Error("Milestone not found");

    let next = input.status;
    if (!next) {
        const i = MILESTONE_STATUSES.indexOf(milestone.status);
        next = MILESTONE_STATUSES[(i + 1) % MILESTONE_STATUSES.length];
    }
    await db.goalMilestone.update({ where: { id: input.id }, data: { status: next } });
    rl(`/learning/goals/${milestone.goalId}`);
}

export async function deleteMilestone(fd: FormData) {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    const milestone = await db.goalMilestone.findFirst({
        where: { id, goal: { userId: user.id } },
        select: { goalId: true },
    });
    if (!milestone) throw new Error("Milestone not found");
    await db.goalMilestone.delete({ where: { id } });
    rl(`/learning/goals/${milestone.goalId}`);
}

// ── Resources ────────────────────────────────────────────────

const addResourceSchema = z.object({
    goalId: zId,
    title: zText,
    resourceType: zOptText,
    url: zOptText,
    notes: zOptText,
});

export async function addResource(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(addResourceSchema, fd);
    await ownedGoal(input.goalId, user.id);
    await db.learningResource.create({
        data: {
            userId: user.id,
            goalId: input.goalId,
            title: input.title,
            resourceType: input.resourceType ?? null,
            url: input.url ?? null,
            notes: input.notes ?? null,
        },
    });
    rl(`/learning/goals/${input.goalId}`);
}

const updateResourceSchema = z.object({
    id: zId,
    title: zText,
    resourceType: zOptText,
    url: zOptText,
    notes: zOptText,
});

export async function updateResource(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(updateResourceSchema, fd);
    const resource = await db.learningResource.findFirst({
        where: { id: input.id, userId: user.id },
        select: { goalId: true },
    });
    if (!resource) throw new Error("Resource not found");
    await db.learningResource.update({
        where: { id: input.id },
        data: {
            title: input.title,
            resourceType: input.resourceType ?? null,
            url: input.url ?? null,
            notes: input.notes ?? null,
        },
    });
    if (resource.goalId) rl(`/learning/goals/${resource.goalId}`);
    else rl();
}

export async function deleteResource(fd: FormData) {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    const resource = await db.learningResource.findFirst({ where: { id, userId: user.id }, select: { goalId: true } });
    if (!resource) throw new Error("Resource not found");
    await db.learningResource.delete({ where: { id } });
    if (resource.goalId) rl(`/learning/goals/${resource.goalId}`);
    else rl();
}

// ── Progress sessions ────────────────────────────────────────

const logSessionSchema = z.object({
    goalId: zId,
    durationMinutes: zOptInt,
    notes: zOptText,
});

/** Free-form progress session for a goal (minutes + notes). */
export async function logGoalSession(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(logSessionSchema, fd);
    const goal = await db.learningGoal.findFirst({
        where: { id: input.goalId, userId: user.id },
        select: { title: true, description: true },
    });
    if (!goal) throw new Error("Goal not found");

    await db.learningSession.create({
        data: {
            userId: user.id,
            sessionDate: today(),
            goalId: input.goalId,
            subject: goalLabel(goal),
            durationMinutes: input.durationMinutes ?? null,
            notes: input.notes ?? null,
        },
    });
    rl(`/learning/goals/${input.goalId}`, "/learning/sessions");
}

const checkInSchema = z.object({
    goalId: zId,
    durationMinutes: zOptInt,
    notes: zOptText,
});

/**
 * "I studied today" — advances the daily streak and logs a session.
 *
 * Streak rules (relative to lastStudiedOn):
 *   - already today          → no streak change (still logs the session)
 *   - yesterday (gap 1 day)  → streak + 1
 *   - 2 days ago + token     → consume one freeze token, streak + 1
 *   - otherwise              → reset streak to 1
 * lastStudiedOn is always set to today.
 */
export async function checkInGoal(fd: FormData) {
    const user = await requireUser();
    const input = parseForm(checkInSchema, fd);
    const goal = await db.learningGoal.findFirst({
        where: { id: input.goalId, userId: user.id },
        select: { title: true, description: true, streakCount: true, lastStudiedOn: true, freezeTokens: true },
    });
    if (!goal) throw new Error("Goal not found");

    const t = today();
    const last = goal.lastStudiedOn ? new Date(goal.lastStudiedOn) : null;
    const gap = last ? dayDiff(t, last) : null;

    let streakCount = goal.streakCount;
    let freezeTokens = goal.freezeTokens;
    let alreadyToday = false;

    if (gap === 0) {
        alreadyToday = true; // studied earlier today — keep the streak as-is
    } else if (gap === 1) {
        streakCount = goal.streakCount + 1;
    } else if (gap === 2 && goal.freezeTokens > 0) {
        // One missed day, bridged by a freeze token.
        freezeTokens = goal.freezeTokens - 1;
        streakCount = goal.streakCount + 1;
    } else {
        streakCount = 1; // first study, or a broken streak
    }

    await db.$transaction([
        db.learningGoal.update({
            where: { id: input.goalId },
            data: { streakCount, freezeTokens, lastStudiedOn: t },
        }),
        db.learningSession.create({
            data: {
                userId: user.id,
                sessionDate: t,
                goalId: input.goalId,
                subject: goalLabel(goal),
                durationMinutes: input.durationMinutes ?? null,
                notes: input.notes ?? null,
            },
        }),
    ]);

    rl(`/learning/goals/${input.goalId}`, "/learning/sessions");
    return { streakCount, freezeTokens, alreadyToday };
}

// ── Freeze tokens ────────────────────────────────────────────

const MAX_FREEZE_TOKENS = 3;

export async function addFreezeToken(fd: FormData) {
    const user = await requireUser();
    const { goalId } = parseForm(z.object({ goalId: zId }), fd);
    const goal = await db.learningGoal.findFirst({ where: { id: goalId, userId: user.id }, select: { freezeTokens: true } });
    if (!goal) throw new Error("Goal not found");
    if (goal.freezeTokens >= MAX_FREEZE_TOKENS) throw new Error(`You can hold at most ${MAX_FREEZE_TOKENS} freeze tokens`);
    await db.learningGoal.update({
        where: { id: goalId },
        data: { freezeTokens: Math.min(MAX_FREEZE_TOKENS, goal.freezeTokens + 1) },
    });
    rl(`/learning/goals/${goalId}`);
}
