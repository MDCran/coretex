"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createTodoImpl, deleteTodoImpl, setTodoStatusImpl, updateTodoImpl } from "@/lib/todos";
import { int, parseDateOnly, str } from "./health-shared";

// ── Focus sprints ────────────────────────────────────────────

export async function createSprint(fd: FormData) {
    const user = await requireUser();
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    const start = (fd.get("start") as string) === "true";
    await db.focusSprint.create({
        data: {
            userId: user.id,
            title,
            durationMinutes: int(fd, "durationMinutes"),
            startedAt: start ? new Date() : null,
        },
    });
    revalidatePath("/focus");
}

export async function updateSprint(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    await db.focusSprint.updateMany({
        where: { id, userId: user.id },
        data: { title, durationMinutes: int(fd, "durationMinutes") },
    });
    revalidatePath("/focus");
}

export async function startSprint(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.focusSprint.updateMany({ where: { id, userId: user.id }, data: { startedAt: new Date(), finishedAt: null, completed: false } });
    revalidatePath("/focus");
}

export async function finishSprint(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.focusSprint.updateMany({ where: { id, userId: user.id }, data: { finishedAt: new Date(), completed: true } });
    revalidatePath("/focus");
}

export async function deleteSprint(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.focusSprint.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/focus");
}

// ── Weekly priorities ────────────────────────────────────────

export async function createPriority(fd: FormData) {
    const user = await requireUser();
    const priorityText = str(fd, "priorityText");
    if (!priorityText) throw new Error("Priority is required");
    const weekOf = parseDateOnly(str(fd, "weekOf"));
    const count = await db.weeklyPriority.count({ where: { userId: user.id, weekOf } });
    await db.weeklyPriority.create({ data: { userId: user.id, priorityText, weekOf, order: count } });
    revalidatePath("/focus");
}

export async function updatePriority(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const priorityText = str(fd, "priorityText");
    if (!priorityText) throw new Error("Priority is required");
    await db.weeklyPriority.updateMany({
        where: { id, userId: user.id },
        data: { priorityText, weekOf: parseDateOnly(str(fd, "weekOf")) },
    });
    revalidatePath("/focus");
}

export async function togglePriority(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const p = await db.weeklyPriority.findFirst({ where: { id, userId: user.id }, select: { completed: true } });
    if (!p) throw new Error("Not found");
    await db.weeklyPriority.update({ where: { id }, data: { completed: !p.completed } });
    revalidatePath("/focus");
}

export async function deletePriority(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.weeklyPriority.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/focus");
}

// ── Reward goals ─────────────────────────────────────────────

export async function createReward(fd: FormData) {
    const user = await requireUser();
    const description = str(fd, "description");
    if (!description) throw new Error("Description is required");
    await db.rewardGoal.create({ data: { userId: user.id, description, points: int(fd, "points") ?? 0 } });
    revalidatePath("/focus");
}

export async function updateReward(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const description = str(fd, "description");
    if (!description) throw new Error("Description is required");
    await db.rewardGoal.updateMany({
        where: { id, userId: user.id },
        data: { description, points: int(fd, "points") ?? 0 },
    });
    revalidatePath("/focus");
}

export async function toggleReward(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const r = await db.rewardGoal.findFirst({ where: { id, userId: user.id }, select: { earned: true } });
    if (!r) throw new Error("Not found");
    await db.rewardGoal.update({ where: { id }, data: { earned: !r.earned } });
    revalidatePath("/focus");
}

export async function deleteReward(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.rewardGoal.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/focus");
}

// ── Goal periods ─────────────────────────────────────────────

export async function createPeriod(fd: FormData) {
    const user = await requireUser();
    const periodName = str(fd, "periodName");
    if (!periodName) throw new Error("Name is required");
    await db.goalPeriod.create({
        data: { userId: user.id, periodName, startDate: parseDateOnly(str(fd, "startDate")), endDate: parseDateOnly(str(fd, "endDate")) },
    });
    revalidatePath("/focus");
}

export async function updatePeriod(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.goalPeriod.updateMany({
        where: { id, userId: user.id },
        data: { periodName: str(fd, "periodName") ?? undefined, startDate: parseDateOnly(str(fd, "startDate")), endDate: parseDateOnly(str(fd, "endDate")) },
    });
    revalidatePath("/focus");
}

export async function deletePeriod(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.goalPeriod.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/focus");
}

// Todos moved to src/lib/todos.ts (per-day + routines model).
// Back-compat "use server" wrappers so existing import paths keep working
// (e.g. the calendar client imports setTodoStatus from here).

export async function createTodo(fd: FormData) {
    return createTodoImpl(fd);
}

export async function updateTodo(fd: FormData) {
    return updateTodoImpl(fd);
}

export async function setTodoStatus(fd: FormData) {
    return setTodoStatusImpl(fd);
}

export async function deleteTodo(fd: FormData) {
    return deleteTodoImpl(fd);
}

// ── Notifications ────────────────────────────────────────────

export async function markNotificationRead(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    revalidatePath("/notifications");
}

export async function markNotificationUnread(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: null } });
    revalidatePath("/notifications");
}

export async function markAllNotificationsRead() {
    const user = await requireUser();
    await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    revalidatePath("/notifications");
}

export async function deleteNotification(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.notification.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/notifications");
}
