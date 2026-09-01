"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bool, int, parseDateOnly, str } from "./health-shared";

function daysOfWeek(fd: FormData): string[] {
    return fd.getAll("daysOfWeek").filter((v): v is string => typeof v === "string");
}

export async function createHabit(fd: FormData) {
    const user = await requireUser();
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    const stackAfterHabitId = str(fd, "stackAfterHabitId");
    await db.habit.create({
        data: {
            userId: user.id,
            name,
            description: str(fd, "description"),
            habitType: str(fd, "habitType") ?? "good",
            frequency: str(fd, "frequency") ?? "daily",
            targetCount: int(fd, "targetCount"),
            targetDays: int(fd, "targetDays"),
            daysOfWeek: daysOfWeek(fd),
            color: str(fd, "color"),
            icon: str(fd, "icon"),
            category: str(fd, "category"),
            cue: str(fd, "cue"),
            routine: str(fd, "routine"),
            reward: str(fd, "reward"),
            stackAfterHabitId: stackAfterHabitId || null,
            difficulty: str(fd, "difficulty"),
            priority: str(fd, "priority"),
            reminderTime: str(fd, "reminderTime"),
        },
    });
    revalidatePath("/health/habits");
    revalidatePath("/health");
}

export async function updateHabit(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.habit.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    const stackAfterHabitId = str(fd, "stackAfterHabitId");
    await db.habit.update({
        where: { id },
        data: {
            name,
            description: str(fd, "description"),
            habitType: str(fd, "habitType") ?? existing.habitType,
            frequency: str(fd, "frequency") ?? existing.frequency,
            targetCount: int(fd, "targetCount"),
            targetDays: int(fd, "targetDays"),
            daysOfWeek: daysOfWeek(fd),
            color: str(fd, "color"),
            icon: str(fd, "icon"),
            category: str(fd, "category"),
            cue: str(fd, "cue"),
            routine: str(fd, "routine"),
            reward: str(fd, "reward"),
            stackAfterHabitId: stackAfterHabitId && stackAfterHabitId !== id ? stackAfterHabitId : null,
            difficulty: str(fd, "difficulty"),
            priority: str(fd, "priority"),
            reminderTime: str(fd, "reminderTime"),
            active: bool(fd, "active"),
        },
    });
    revalidatePath("/health/habits");
    revalidatePath("/health");
}

export async function deleteHabit(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.habit.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/health/habits");
    revalidatePath("/health");
}

/** Toggle a habit completion for a given date (default today). */
export async function toggleHabitLog(fd: FormData) {
    const user = await requireUser();
    const habitId = str(fd, "habitId");
    if (!habitId) throw new Error("Missing habitId");
    const habit = await db.habit.findFirst({ where: { id: habitId, userId: user.id } });
    if (!habit) throw new Error("Not found");
    const logDate = parseDateOnly(str(fd, "logDate"));

    const existing = await db.habitLog.findFirst({ where: { habitId, logDate } });
    if (existing) {
        await db.habitLog.delete({ where: { id: existing.id } });
    } else {
        await db.habitLog.create({ data: { habitId, logDate, count: 1 } });
    }
    revalidatePath("/health/habits");
    revalidatePath("/health");
}

export async function addHabitMilestone(fd: FormData) {
    const user = await requireUser();
    const habitId = str(fd, "habitId");
    if (!habitId) throw new Error("Missing habitId");
    const habit = await db.habit.findFirst({ where: { id: habitId, userId: user.id } });
    if (!habit) throw new Error("Not found");
    await db.habitMilestone.create({
        data: { habitId, milestoneDate: parseDateOnly(str(fd, "milestoneDate")), description: str(fd, "description") },
    });
    revalidatePath("/health/habits");
}

export async function deleteHabitMilestone(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const milestone = await db.habitMilestone.findUnique({ where: { id }, include: { habit: true } });
    if (!milestone || milestone.habit.userId !== user.id) throw new Error("Not found");
    await db.habitMilestone.delete({ where: { id } });
    revalidatePath("/health/habits");
}
