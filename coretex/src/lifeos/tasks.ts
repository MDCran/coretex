import { prisma } from "../db/prisma.js";

const DAY_MS = 86_400_000;

function utcDay(value?: unknown): Date {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return new Date(`${value}T00:00:00.000Z`);
    }
    const now = new Date();
    // Prisma stores calendar-only values at UTC midnight. Derive that key from
    // the user's local calendar day so evening use in negative UTC offsets does
    // not jump to tomorrow.
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export async function getDashboard(userId: string, payload?: Record<string, unknown>) {
    const day = utcDay(payload?.date);
    const dow = (day.getUTCDay() + 6) % 7;
    const weekStart = new Date(day.getTime() - dow * DAY_MS);
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);

    const [todos, routines, week] = await Promise.all([
        prisma.todoItem.findMany({
            where: { userId, date: day },
            orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
            include: {
                subtasks: { orderBy: { sortOrder: "asc" } },
                blockedBy: { select: { id: true, title: true, status: true } },
            },
        }),
        prisma.todoRoutine.findMany({ where: { userId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] }),
        prisma.todoItem.findMany({
            where: { userId, date: { gte: weekStart, lt: weekEnd } },
            select: { status: true, date: true, category: true },
        }),
    ]);

    const done = week.filter((todo) => todo.status === "DONE").length;
    const skipped = week.filter((todo) => todo.status === "SKIPPED").length;
    const eligible = week.length - skipped;
    const categories = new Map<string, number>();
    for (const todo of week) {
        if (todo.status === "DONE" && todo.category) categories.set(todo.category, (categories.get(todo.category) ?? 0) + 1);
    }

    return {
        date: isoDay(day),
        todos: todos.map((todo) => ({
            ...todo,
            date: todo.date ? isoDay(todo.date) : null,
            plannedAt: todo.plannedAt?.toISOString() ?? null,
            dueAt: todo.dueAt?.toISOString() ?? null,
            completedAt: todo.completedAt?.toISOString() ?? null,
            createdAt: todo.createdAt.toISOString(),
            updatedAt: todo.updatedAt.toISOString(),
        })),
        routines: routines.map((routine) => ({
            ...routine,
            endDate: routine.endDate ? isoDay(routine.endDate) : null,
            anchorDate: routine.anchorDate ? isoDay(routine.anchorDate) : null,
            createdAt: routine.createdAt.toISOString(),
            updatedAt: routine.updatedAt.toISOString(),
        })),
        digest: {
            done,
            skipped,
            total: week.length,
            completionRate: eligible > 0 ? Math.round((done / eligible) * 100) : 0,
            topCategory: [...categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        },
    };
}

export async function getAnalytics(userId: string) {
    const today = utcDay();
    const start = new Date(today.getTime() - 29 * DAY_MS);
    const todos = await prisma.todoItem.findMany({
        where: { userId, date: { gte: start, lte: today } },
        orderBy: { date: "asc" },
        select: { status: true, date: true, category: true, priority: true, energy: true, durationMinutes: true },
    });

    const byDay = new Map<string, { total: number; done: number; skipped: number; minutes: number }>();
    const byCategory = new Map<string, { total: number; done: number }>();
    const byPriority = new Map<string, { total: number; done: number }>();
    for (const todo of todos) {
        const day = todo.date ? isoDay(todo.date) : "Unscheduled";
        const dayRow = byDay.get(day) ?? { total: 0, done: 0, skipped: 0, minutes: 0 };
        dayRow.total++;
        dayRow.minutes += todo.durationMinutes ?? 0;
        if (todo.status === "DONE") dayRow.done++;
        if (todo.status === "SKIPPED") dayRow.skipped++;
        byDay.set(day, dayRow);

        const category = todo.category ?? "Uncategorized";
        const categoryRow = byCategory.get(category) ?? { total: 0, done: 0 };
        categoryRow.total++;
        if (todo.status === "DONE") categoryRow.done++;
        byCategory.set(category, categoryRow);

        const priorityRow = byPriority.get(todo.priority) ?? { total: 0, done: 0 };
        priorityRow.total++;
        if (todo.status === "DONE") priorityRow.done++;
        byPriority.set(todo.priority, priorityRow);
    }

    const done = todos.filter((todo) => todo.status === "DONE").length;
    const skipped = todos.filter((todo) => todo.status === "SKIPPED").length;
    return {
        range: { start: isoDay(start), end: isoDay(today) },
        summary: {
            total: todos.length,
            done,
            skipped,
            completionRate: todos.length - skipped > 0 ? Math.round((done / (todos.length - skipped)) * 100) : 0,
        },
        byDay: [...byDay.entries()].map(([date, row]) => ({ date, ...row })),
        byCategory: [...byCategory.entries()].map(([category, row]) => ({ category, ...row })),
        byPriority: [...byPriority.entries()].map(([priority, row]) => ({ priority, ...row })),
    };
}

const TODO_STATUSES = ["PLANNED", "IN_PROGRESS", "DRIPPED", "DONE", "SKIPPED"] as const;
const TODO_PRIORITIES = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"] as const;

function requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
    return value.trim();
}

function optionalString(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    return typeof value === "string" ? value.trim() : undefined;
}

function optionalDay(value: unknown): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("date must use YYYY-MM-DD.");
    return new Date(`${value}T00:00:00.000Z`);
}

export async function createTodo(userId: string, payload: Record<string, unknown> = {}) {
    const priority = TODO_PRIORITIES.includes(payload.priority as (typeof TODO_PRIORITIES)[number])
        ? (payload.priority as (typeof TODO_PRIORITIES)[number])
        : "NONE";
    const created = await prisma.todoItem.create({
        data: {
            userId,
            title: requiredString(payload.title, "title"),
            body: optionalString(payload.body) ?? null,
            date: optionalDay(payload.date) ?? utcDay(),
            category: optionalString(payload.category) ?? null,
            priority,
            durationMinutes: typeof payload.durationMinutes === "number" && payload.durationMinutes > 0
                ? Math.round(payload.durationMinutes)
                : null,
        },
        include: { subtasks: true, blockedBy: { select: { id: true, title: true, status: true } } },
    });
    return { id: created.id };
}

export async function updateTodo(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredString(payload.id, "id");
    const existing = await prisma.todoItem.findFirst({ where: { id, userId }, select: { id: true } });
    if (!existing) throw new Error("Todo not found.");

    const status = payload.status === undefined
        ? undefined
        : TODO_STATUSES.includes(payload.status as (typeof TODO_STATUSES)[number])
            ? (payload.status as (typeof TODO_STATUSES)[number])
            : (() => { throw new Error("Invalid todo status."); })();
    const priority = payload.priority === undefined
        ? undefined
        : TODO_PRIORITIES.includes(payload.priority as (typeof TODO_PRIORITIES)[number])
            ? (payload.priority as (typeof TODO_PRIORITIES)[number])
            : (() => { throw new Error("Invalid todo priority."); })();
    const completedAt = status === "DONE" ? new Date() : status ? null : undefined;

    await prisma.todoItem.update({
        where: { id },
        data: {
            ...(payload.title !== undefined ? { title: requiredString(payload.title, "title") } : {}),
            ...(payload.body !== undefined ? { body: optionalString(payload.body) } : {}),
            ...(payload.date !== undefined ? { date: optionalDay(payload.date) } : {}),
            ...(payload.category !== undefined ? { category: optionalString(payload.category) } : {}),
            ...(status !== undefined ? { status, completedAt } : {}),
            ...(priority !== undefined ? { priority } : {}),
        },
    });
    return { id };
}

export async function deleteTodo(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredString(payload.id, "id");
    const deleted = await prisma.todoItem.deleteMany({ where: { id, userId } });
    if (!deleted.count) throw new Error("Todo not found.");
    return { id };
}

export async function createSubtask(userId: string, payload: Record<string, unknown> = {}) {
    const todoId = requiredString(payload.todoId, "todoId");
    const todo = await prisma.todoItem.findFirst({ where: { id: todoId, userId }, select: { id: true } });
    if (!todo) throw new Error("Todo not found.");
    const created = await prisma.todoSubtask.create({
        data: { todoId, title: requiredString(payload.title, "title") },
        select: { id: true },
    });
    return created;
}

export async function toggleSubtask(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredString(payload.id, "id");
    const subtask = await prisma.todoSubtask.findFirst({
        where: { id, todo: { userId } },
        select: { id: true, done: true },
    });
    if (!subtask) throw new Error("Subtask not found.");
    await prisma.todoSubtask.update({ where: { id }, data: { done: !subtask.done } });
    return { id, done: !subtask.done };
}

export async function createRoutine(userId: string, payload: Record<string, unknown> = {}) {
    const routine = await prisma.todoRoutine.create({
        data: {
            userId,
            title: requiredString(payload.title, "title"),
            category: optionalString(payload.category) ?? null,
            cadence: "DAILY",
        },
        select: { id: true },
    });
    return routine;
}

export async function toggleRoutine(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredString(payload.id, "id");
    const routine = await prisma.todoRoutine.findFirst({ where: { id, userId }, select: { id: true, active: true } });
    if (!routine) throw new Error("Routine not found.");
    await prisma.todoRoutine.update({ where: { id }, data: { active: !routine.active } });
    return { id, active: !routine.active };
}

export async function deleteRoutine(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredString(payload.id, "id");
    const deleted = await prisma.todoRoutine.deleteMany({ where: { id, userId } });
    if (!deleted.count) throw new Error("Routine not found.");
    return { id };
}
