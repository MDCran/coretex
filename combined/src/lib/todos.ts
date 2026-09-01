import "server-only";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { int, parseOptionalDateTime, str } from "@/lib/actions/health-shared";
import { runClaude } from "@/lib/ai/claude";
import { parseTodoForm, parseTodoUpdateForm } from "@/lib/validation/todo";
import {
    bandForTime,
    cleanTags,
    isValidHHMM,
    maxDayOfMonth,
    type TimeOfDayValue,
    type TodoEnergyValue,
    type TodoPriorityValue,
} from "@/lib/todos-shared";

// ── Date helpers (UTC midnight, matching @db.Date semantics) ──

export const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

/** Parse a YYYY-MM-DD string to a UTC-midnight Date. Falls back to today. */
export function parseDateKey(value: string | null | undefined): Date {
    const s = (value ?? "").trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Format a Date as YYYY-MM-DD using its UTC parts. */
export function dateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** Parse an optional "YYYY-MM-DD" to a UTC-midnight Date, or null when empty/invalid. */
function parseOptionalDateOnly(value: string | null | undefined): Date | null {
    const m = (value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Normalize any Date to its UTC-midnight day. */
export function dayOf(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Whole days between two UTC-midnight dates (b - a). */
function daysBetween(a: Date, b: Date): number {
    return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

type RoutineForMath = {
    cadence: "DAILY" | "EVERY_N_DAYS" | "WEEKLY_DOW" | "YEARLY";
    intervalN: number | null;
    daysOfWeek: string[];
    yearlyMonth: number | null;
    yearlyDay: number | null;
    anchorDate?: Date | null;
    endDate?: Date | null;
    createdAt: Date;
};

/** Is the routine due on the given UTC-midnight date? */
export function isRoutineDue(r: RoutineForMath, date: Date): boolean {
    // Respect a recurring end date (inclusive): nothing after it.
    if (r.endDate && date.getTime() > dayOf(r.endDate).getTime()) return false;
    switch (r.cadence) {
        case "DAILY":
            return true;
        case "EVERY_N_DAYS": {
            const n = r.intervalN && r.intervalN > 0 ? r.intervalN : 1;
            // Count from the explicit anchor when set, else the creation day.
            const start = dayOf(r.anchorDate ?? r.createdAt);
            const diff = daysBetween(start, date);
            return diff >= 0 && diff % n === 0;
        }
        case "WEEKLY_DOW":
            return r.daysOfWeek.includes(DOW[date.getUTCDay()]);
        case "YEARLY":
            return r.yearlyMonth === date.getUTCMonth() + 1 && r.yearlyDay === date.getUTCDate();
        default:
            return false;
    }
}

/** Next due date strictly after `from` (UTC-midnight), or null within ~2 years. */
export function nextRoutineOccurrence(r: RoutineForMath, from: Date): Date | null {
    let d = new Date(dayOf(from).getTime() + 86400000);
    for (let i = 0; i < 366 * 2; i++) {
        if (isRoutineDue(r, d)) return d;
        if (r.endDate && d.getTime() > dayOf(r.endDate).getTime()) return null;
        d = new Date(d.getTime() + 86400000);
    }
    return null;
}

// ── Materialization ──────────────────────────────────────────
//
// Model: todos are per-day. For a viewed date D we:
//  1. (one-time, cheap) backfill legacy rows that have no `date` by setting
//     date = createdAt's day, so they show up in history.
//  2. For each active routine due on D, ensure exactly one TodoItem
//     (routineId, date=D) exists. The @@unique([routineId, date]) makes this
//     idempotent — re-running never duplicates.
//  3. Sweep past routine-items still open (PLANNED/IN_PROGRESS) to SKIPPED —
//     "didn't do it yesterday → today's copy replaces it, old one is skipped".
//
// Safe to call on every page load for the viewed date and for "today".

/** Idempotently ensure a viewed date is materialized + run the past sweep. */
export async function materializeDay(userId: string, date: Date): Promise<void> {
    const day = dayOf(date);

    // 1. Legacy backfill: assign date = createdAt-day for any dateless rows.
    const legacy = await db.todoItem.findMany({
        where: { userId, date: null },
        select: { id: true, createdAt: true },
    });
    if (legacy.length) {
        await Promise.all(
            legacy.map((t) => db.todoItem.update({ where: { id: t.id }, data: { date: dayOf(t.createdAt) } })),
        );
    }

    // 2. Materialize active routines due on `day`.
    const routines = await db.todoRoutine.findMany({
        where: { userId, active: true },
        select: {
            id: true,
            title: true,
            body: true,
            cadence: true,
            intervalN: true,
            daysOfWeek: true,
            yearlyMonth: true,
            yearlyDay: true,
            anchorDate: true,
            endDate: true,
            timeOfDay: true,
            startTime: true,
            durationMinutes: true,
            priority: true,
            category: true,
            energy: true,
            tags: true,
            createdAt: true,
        },
    });

    const dueRoutines = routines.filter((r) => isRoutineDue(r, day));
    if (dueRoutines.length) {
        const existing = await db.todoItem.findMany({
            where: { userId, date: day, routineId: { in: dueRoutines.map((r) => r.id) } },
            select: { routineId: true },
        });
        const have = new Set(existing.map((e) => e.routineId));
        const toCreate = dueRoutines.filter((r) => !have.has(r.id));
        if (toCreate.length) {
            // createMany skips duplicates that would violate @@unique — fully idempotent.
            await db.todoItem.createMany({
                data: toCreate.map((r) => ({
                    userId,
                    title: r.title,
                    body: r.body,
                    routineId: r.id,
                    date: day,
                    // Inherit the routine's scheduling + classification defaults so
                    // recurring todos land on the calendar with the right metadata.
                    timeOfDay: r.timeOfDay,
                    startTime: r.startTime,
                    durationMinutes: r.durationMinutes,
                    priority: r.priority,
                    category: r.category,
                    energy: r.energy,
                    tags: r.tags,
                    status: "PLANNED" as const,
                    source: "USER" as const,
                })),
                skipDuplicates: true,
            });
        }
    }

    // 3. Sweep: past routine-items still open → SKIPPED.
    await db.todoItem.updateMany({
        where: {
            userId,
            routineId: { not: null },
            date: { lt: day },
            status: { in: ["PLANNED", "IN_PROGRESS", "DRIPPED"] },
        },
        data: { status: "SKIPPED" },
    });
}

// ── Queries ──────────────────────────────────────────────────

export type TodoItemDTO = {
    id: string;
    title: string;
    body: string | null;
    status: "PLANNED" | "IN_PROGRESS" | "DONE" | "SKIPPED";
    source: string;
    date: string | null;
    /** Part-of-day bucket — tag/badge + zone-band calendar placement. */
    timeOfDay: TimeOfDayValue | null;
    /** "HH:MM" 24h wall-clock for calendar block position; null = unscheduled time. */
    startTime: string | null;
    /** Estimated minutes to complete — block height + daily capacity. */
    durationMinutes: number | null;
    priority: TodoPriorityValue;
    tags: string[];
    category: string | null;
    energy: TodoEnergyValue | null;
    sortOrder: number;
    links: string[];
    projectRef: string | null;
    projectUrl: string | null;
    rolledOver: boolean;
    blockedById: string | null;
    /** Title + done-state of the blocker (for the lock chip). */
    blockedByTitle: string | null;
    blockedByDone: boolean | null;
    subtasks: TodoSubtaskDTO[];
    dueAt: string | null;
    plannedAt: string | null;
    completedAt: string | null;
    hindrance: string | null;
    routineId: string | null;
    routineCadence: "DAILY" | "EVERY_N_DAYS" | "WEEKLY_DOW" | "YEARLY" | null;
};

export type TodoSubtaskDTO = {
    id: string;
    title: string;
    done: boolean;
    sortOrder: number;
};

/** Map a DRIPPED (legacy) status to PLANNED for the UI. */
function uiStatus(s: string): TodoItemDTO["status"] {
    if (s === "DRIPPED") return "PLANNED";
    return s as TodoItemDTO["status"];
}

type RawSubtask = { id: string; title: string; done: boolean; sortOrder: number };

type RawTodo = {
    id: string;
    title: string;
    body: string | null;
    status: string;
    source: string;
    date: Date | null;
    timeOfDay: string | null;
    startTime: string | null;
    durationMinutes: number | null;
    priority: string;
    tags: string[];
    category: string | null;
    energy: string | null;
    sortOrder: number;
    links: string[];
    projectRef: string | null;
    projectUrl: string | null;
    rolledOver: boolean;
    blockedById: string | null;
    blockedBy: { title: string; status: string } | null;
    subtasks: RawSubtask[];
    dueAt: Date | null;
    plannedAt: Date | null;
    completedAt: Date | null;
    hindrance: string | null;
    routineId: string | null;
    routine: { cadence: string } | null;
};

function toDTO(t: RawTodo): TodoItemDTO {
    return {
        id: t.id,
        title: t.title,
        body: t.body,
        status: uiStatus(t.status),
        source: t.source,
        date: t.date ? dateKey(t.date) : null,
        timeOfDay: (t.timeOfDay as TimeOfDayValue | null) ?? null,
        startTime: t.startTime,
        durationMinutes: t.durationMinutes,
        priority: (t.priority as TodoPriorityValue) ?? "NONE",
        tags: t.tags ?? [],
        category: t.category,
        energy: (t.energy as TodoEnergyValue | null) ?? null,
        sortOrder: t.sortOrder ?? 0,
        links: t.links ?? [],
        projectRef: t.projectRef,
        projectUrl: t.projectUrl,
        rolledOver: t.rolledOver ?? false,
        blockedById: t.blockedById,
        blockedByTitle: t.blockedBy?.title ?? null,
        blockedByDone: t.blockedBy ? t.blockedBy.status === "DONE" : null,
        subtasks: (t.subtasks ?? [])
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((s) => ({ id: s.id, title: s.title, done: s.done, sortOrder: s.sortOrder })),
        dueAt: t.dueAt?.toISOString() ?? null,
        plannedAt: t.plannedAt?.toISOString() ?? null,
        completedAt: t.completedAt?.toISOString() ?? null,
        hindrance: t.hindrance,
        routineId: t.routineId,
        routineCadence: (t.routine?.cadence as TodoItemDTO["routineCadence"]) ?? null,
    };
}

const TODO_SELECT = {
    id: true,
    title: true,
    body: true,
    status: true,
    source: true,
    date: true,
    timeOfDay: true,
    startTime: true,
    durationMinutes: true,
    priority: true,
    tags: true,
    category: true,
    energy: true,
    sortOrder: true,
    links: true,
    projectRef: true,
    projectUrl: true,
    rolledOver: true,
    blockedById: true,
    blockedBy: { select: { title: true, status: true } },
    subtasks: { select: { id: true, title: true, done: true, sortOrder: true } },
    dueAt: true,
    plannedAt: true,
    completedAt: true,
    hindrance: true,
    routineId: true,
    routine: { select: { cadence: true } },
} as const;

/** All todo items for a single day. Materializes first (idempotent). */
export async function getTodosForDay(userId: string, date: Date): Promise<TodoItemDTO[]> {
    const day = dayOf(date);
    await materializeDay(userId, day);
    const rows = await db.todoItem.findMany({
        where: { userId, date: day },
        orderBy: [{ sortOrder: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        select: TODO_SELECT,
    });
    return rows.map(toDTO);
}

/**
 * Todos overlapping a date range — for calendar integration.
 * TODO(calendar agent): consume this to render todos on the calendar grid.
 * Returns items whose `date` falls within [start, end] (inclusive of both days).
 */
export async function getTodosForRange(userId: string, start: Date, end: Date): Promise<TodoItemDTO[]> {
    const rows = await db.todoItem.findMany({
        where: { userId, date: { gte: dayOf(start), lte: dayOf(end) } },
        orderBy: [{ date: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }],
        select: TODO_SELECT,
    });
    return rows.map(toDTO);
}

export type RoutineDTO = {
    id: string;
    title: string;
    body: string | null;
    cadence: "DAILY" | "EVERY_N_DAYS" | "WEEKLY_DOW" | "YEARLY";
    intervalN: number | null;
    daysOfWeek: string[];
    yearlyMonth: number | null;
    yearlyDay: number | null;
    anchorDate: string | null;
    endDate: string | null;
    timeOfDay: TimeOfDayValue | null;
    startTime: string | null;
    durationMinutes: number | null;
    priority: TodoPriorityValue;
    category: string | null;
    energy: TodoEnergyValue | null;
    tags: string[];
    active: boolean;
    /** Next materialization date (yyyy-MM-dd), for the preview chip. */
    nextOccurrence: string | null;
    /** Current consecutive-completion streak (most recent occurrences DONE). */
    streak: number;
};

export async function getRoutines(userId: string): Promise<RoutineDTO[]> {
    const rows = await db.todoRoutine.findMany({
        where: { userId },
        orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    });
    const today = dayOf(new Date());
    const todayK = dateKey(today);

    // Streaks: pull the last ~120 days of routine items in one query, then walk
    // each routine's occurrences newest-first counting consecutive DONE.
    const since = new Date(today.getTime() - 120 * 86400000);
    const recent = await db.todoItem.findMany({
        where: { userId, routineId: { in: rows.map((r) => r.id) }, date: { gte: since, lte: today } },
        select: { routineId: true, date: true, status: true },
        orderBy: { date: "desc" },
    });
    const byRoutine = new Map<string, { date: string; status: string }[]>();
    for (const it of recent) {
        if (!it.routineId || !it.date) continue;
        const arr = byRoutine.get(it.routineId) ?? [];
        arr.push({ date: dateKey(it.date), status: it.status });
        byRoutine.set(it.routineId, arr);
    }
    const streakFor = (routineId: string): number => {
        const items = byRoutine.get(routineId) ?? [];
        let streak = 0;
        for (const it of items) {
            if (it.date === todayK && it.status !== "DONE") continue; // today not done yet — don't penalize
            if (it.status === "DONE") streak++;
            else break;
        }
        return streak;
    };

    return rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        cadence: r.cadence,
        intervalN: r.intervalN,
        daysOfWeek: r.daysOfWeek,
        yearlyMonth: r.yearlyMonth,
        yearlyDay: r.yearlyDay,
        anchorDate: r.anchorDate ? dateKey(r.anchorDate) : null,
        endDate: r.endDate ? dateKey(r.endDate) : null,
        timeOfDay: (r.timeOfDay as TimeOfDayValue | null) ?? null,
        startTime: r.startTime,
        durationMinutes: r.durationMinutes,
        priority: (r.priority as TodoPriorityValue) ?? "NONE",
        category: r.category,
        energy: (r.energy as TodoEnergyValue | null) ?? null,
        tags: r.tags,
        active: r.active,
        nextOccurrence: r.active
            ? (() => {
                  const n = nextRoutineOccurrence(r, today);
                  return n ? dateKey(n) : null;
              })()
            : null,
        streak: streakFor(r.id),
    }));
}

/**
 * Roll one-off (non-routine) PLANNED items from past days forward to `today`,
 * flagged `rolledOver`. Routine items are swept to SKIPPED by materializeDay
 * instead; this is the complementary policy for standalone tasks.
 */
export async function rolloverPastTodos(userId: string, today: Date): Promise<void> {
    const day = dayOf(today);
    // PLANNED and IN_PROGRESS one-offs carry forward (in-progress work shouldn't be
    // stranded in the past now that the calendar sweep only skips routine items).
    await db.todoItem.updateMany({
        where: { userId, routineId: null, status: { in: ["PLANNED", "IN_PROGRESS"] }, date: { lt: day } },
        data: { date: day, rolledOver: true },
    });
}

// ── Mutation implementations ─────────────────────────────────
//
// These are plain async functions (NOT "use server" exports) so they can be
// safely imported and re-wrapped by multiple action modules without breaking
// the server-action export contract. The thin "use server" wrappers live in
// src/lib/actions/todos.ts (and a back-compat shim in actions/focus.ts).

const ALLOWED_STATUS = ["PLANNED", "IN_PROGRESS", "DONE", "SKIPPED"] as const;
type WriteStatus = (typeof ALLOWED_STATUS)[number];

export async function createTodoImpl(fd: FormData) {
    const user = await requireUser();
    // Zod validates + normalizes title, body, date, cadence params, and the
    // scheduling fields (timeOfDay / startTime / durationMinutes).
    const input = parseTodoForm(fd);
    const day = parseDateKey(input.date);

    if (input.cadence === "NONE") {
        await db.todoItem.create({
            data: {
                userId: user.id,
                title: input.title,
                body: input.body,
                date: day,
                timeOfDay: input.timeOfDay,
                startTime: input.startTime,
                durationMinutes: input.durationMinutes,
                priority: input.priority,
                tags: input.tags,
                category: input.category,
                energy: input.energy,
                links: input.links,
                projectRef: input.projectRef,
                projectUrl: input.projectUrl,
                dueAt: parseOptionalDateTime(str(fd, "dueAt")),
                plannedAt: parseOptionalDateTime(str(fd, "plannedAt")),
            },
        });
        revalidatePath("/todos");
        revalidatePath("/dashboard");
        revalidatePath("/calendar");
        return;
    }

    // cadence narrowed to a recurring value; routine carries the scheduling +
    // classification defaults that each materialized TodoItem inherits.
    const anchor = parseOptionalDateOnly(str(fd, "anchorDate"));
    await db.todoRoutine.create({
        data: {
            userId: user.id,
            title: input.title,
            body: input.body,
            cadence: input.cadence,
            intervalN: input.cadence === "EVERY_N_DAYS" ? input.intervalN : null,
            daysOfWeek: input.cadence === "WEEKLY_DOW" ? input.daysOfWeek : [],
            yearlyMonth: input.cadence === "YEARLY" ? input.yearlyMonth : null,
            yearlyDay: input.cadence === "YEARLY" ? input.yearlyDay : null,
            anchorDate: input.cadence === "EVERY_N_DAYS" ? anchor : null,
            endDate: parseOptionalDateOnly(str(fd, "endDate")),
            timeOfDay: input.timeOfDay,
            startTime: input.startTime,
            durationMinutes: input.durationMinutes,
            priority: input.priority,
            category: input.category,
            energy: input.energy,
            tags: input.tags,
        },
    });

    await materializeDay(user.id, day);
    revalidatePath("/todos");
    revalidatePath("/dashboard");
    revalidatePath("/calendar");
}

export async function updateTodoImpl(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const input = parseTodoUpdateForm(fd);
    await db.todoItem.updateMany({
        where: { id, userId: user.id },
        data: {
            title: input.title,
            body: input.body,
            timeOfDay: input.timeOfDay,
            startTime: input.startTime,
            durationMinutes: input.durationMinutes,
            priority: input.priority,
            tags: input.tags,
            category: input.category,
            energy: input.energy,
            links: input.links,
            projectRef: input.projectRef,
            projectUrl: input.projectUrl,
            dueAt: parseOptionalDateTime(str(fd, "dueAt")),
            plannedAt: parseOptionalDateTime(str(fd, "plannedAt")),
        },
    });
    revalidatePath("/todos");
    revalidatePath("/dashboard");
    revalidatePath("/calendar");
}

export async function setTodoStatusImpl(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    const status = str(fd, "status");
    if (!id || !status) throw new Error("Missing fields");
    if (!(ALLOWED_STATUS as readonly string[]).includes(status)) throw new Error("Invalid status");
    await db.todoItem.updateMany({
        where: { id, userId: user.id },
        data: {
            status: status as WriteStatus,
            completedAt: status === "DONE" ? new Date() : null,
            hindrance: status === "SKIPPED" ? str(fd, "hindrance") : null,
        },
    });
    revalidatePath("/todos");
    revalidatePath("/dashboard");
    revalidatePath("/calendar");
}

export async function deleteTodoImpl(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.todoItem.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/todos");
    revalidatePath("/dashboard");
}

export async function updateRoutineImpl(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const cadence = str(fd, "cadence");
    if (cadence && !["DAILY", "EVERY_N_DAYS", "WEEKLY_DOW", "YEARLY"].includes(cadence)) throw new Error("Invalid cadence");

    const daysOfWeek = (str(fd, "daysOfWeek") ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => (DOW as readonly string[]).includes(s));
    const intervalN = int(fd, "intervalN");
    const yearlyMonth = int(fd, "yearlyMonth");
    const yearlyDay = int(fd, "yearlyDay");
    if (cadence === "YEARLY" && yearlyMonth && yearlyDay && yearlyDay > maxDayOfMonth(yearlyMonth)) {
        throw new Error("That day doesn't exist in the chosen month");
    }

    // Scheduling defaults (always overwritten from the edit form).
    const startTime = str(fd, "startTime");
    if (startTime && !isValidHHMM(startTime)) throw new Error("Start time must be a valid time (HH:MM)");
    const durationMinutes = int(fd, "durationMinutes");
    const timeOfDayRaw = str(fd, "timeOfDay");
    const timeOfDay: TimeOfDayValue | null =
        timeOfDayRaw && ["MORNING", "AFTERNOON", "EVENING", "NIGHT"].includes(timeOfDayRaw)
            ? (timeOfDayRaw as TimeOfDayValue)
            : startTime
              ? bandForTime(startTime)
              : null;

    // Classification defaults.
    const priorityRaw = str(fd, "priority");
    const priority = priorityRaw && ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"].includes(priorityRaw) ? (priorityRaw as TodoPriorityValue) : "NONE";
    const energyRaw = str(fd, "energy");
    const energy = energyRaw && ["DEEP_WORK", "QUICK", "COLLABORATIVE"].includes(energyRaw) ? (energyRaw as TodoEnergyValue) : null;
    const tags = cleanTags(str(fd, "tags"));
    const category = str(fd, "category");

    await db.todoRoutine.updateMany({
        where: { id, userId: user.id },
        data: {
            title: str(fd, "title") ?? undefined,
            body: str(fd, "body"),
            cadence: (cadence as RoutineDTO["cadence"]) ?? undefined,
            intervalN: cadence === "EVERY_N_DAYS" ? intervalN : cadence ? null : undefined,
            daysOfWeek: cadence === "WEEKLY_DOW" ? daysOfWeek : cadence ? [] : undefined,
            yearlyMonth: cadence === "YEARLY" ? yearlyMonth : cadence ? null : undefined,
            yearlyDay: cadence === "YEARLY" ? yearlyDay : cadence ? null : undefined,
            anchorDate: cadence === "EVERY_N_DAYS" ? parseOptionalDateOnly(str(fd, "anchorDate")) : cadence ? null : undefined,
            endDate: parseOptionalDateOnly(str(fd, "endDate")),
            timeOfDay,
            startTime: startTime ?? null,
            // The routine edit form always posts these fields, so an empty value is
            // an intentional clear (null), consistent with startTime above.
            durationMinutes: durationMinutes ?? null,
            priority,
            category,
            energy,
            tags,
        },
    });
    revalidatePath("/todos");
    revalidatePath("/calendar");
}

export async function toggleRoutineActiveImpl(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const r = await db.todoRoutine.findFirst({ where: { id, userId: user.id }, select: { active: true } });
    if (!r) throw new Error("Not found");
    await db.todoRoutine.update({ where: { id }, data: { active: !r.active } });
    revalidatePath("/todos");
}

export async function deleteRoutineImpl(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    // Schema cascades TodoItem rows for this routine on delete.
    await db.todoRoutine.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/todos");
    revalidatePath("/dashboard");
}

// ── Backlog: bulk, reschedule, duplicate, reorder, subtasks, deps ──

function revalidateTodoSurfaces() {
    revalidatePath("/todos");
    revalidatePath("/dashboard");
    revalidatePath("/calendar");
}

/** Parse a comma-separated "ids" field into a clean string array. */
function idList(fd: FormData, key = "ids"): string[] {
    return (str(fd, key) ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Clone a todo to a target date (defaults to its own day), as a one-off. */
export async function duplicateTodoImpl(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const src = await db.todoItem.findFirst({ where: { id, userId: user.id }, select: TODO_SELECT });
    if (!src) throw new Error("Not found");
    const targetDate = parseOptionalDateOnly(str(fd, "date")) ?? (src.date ? dayOf(src.date) : parseDateKey(null));
    await db.todoItem.create({
        data: {
            userId: user.id,
            title: src.title,
            body: src.body,
            date: targetDate,
            timeOfDay: src.timeOfDay,
            startTime: src.startTime,
            durationMinutes: src.durationMinutes,
            priority: src.priority,
            tags: src.tags,
            category: src.category,
            energy: src.energy,
            links: src.links,
            projectRef: src.projectRef,
            projectUrl: src.projectUrl,
            status: "PLANNED",
            source: "USER",
        },
    });
    revalidateTodoSurfaces();
}

/** Move a todo to a date (`date`) or by a day offset (`days`). Detaches from its
 *  routine so it never collides with the @@unique([routineId, date]) constraint. */
export async function rescheduleTodoImpl(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const explicit = parseOptionalDateOnly(str(fd, "date"));
    let target = explicit;
    if (!target) {
        const days = int(fd, "days") ?? 1;
        const cur = await db.todoItem.findFirst({ where: { id, userId: user.id }, select: { date: true } });
        const base = cur?.date ? dayOf(cur.date) : parseDateKey(null);
        target = new Date(base.getTime() + days * 86400000);
    }
    await db.todoItem.updateMany({
        where: { id, userId: user.id },
        data: { date: target, routineId: null, rolledOver: false },
    });
    revalidateTodoSurfaces();
}

export async function bulkSetStatusImpl(fd: FormData) {
    const user = await requireUser();
    const ids = idList(fd);
    const status = str(fd, "status");
    if (!ids.length || !status) throw new Error("Missing fields");
    if (!(ALLOWED_STATUS as readonly string[]).includes(status)) throw new Error("Invalid status");
    await db.todoItem.updateMany({
        where: { id: { in: ids }, userId: user.id },
        data: { status: status as WriteStatus, completedAt: status === "DONE" ? new Date() : null },
    });
    revalidateTodoSurfaces();
}

export async function bulkDeleteImpl(fd: FormData) {
    const user = await requireUser();
    const ids = idList(fd);
    if (!ids.length) throw new Error("No items selected");
    await db.todoItem.deleteMany({ where: { id: { in: ids }, userId: user.id } });
    revalidateTodoSurfaces();
}

/** Persist a manual ordering: `ids` is the desired order within a column. */
export async function reorderTodosImpl(fd: FormData) {
    const user = await requireUser();
    const ids = idList(fd);
    if (!ids.length) return;
    // Scope to the caller's todos and require a single (status, date) group so
    // sortOrder stays meaningful within one column-day.
    const owned = await db.todoItem.findMany({
        where: { id: { in: ids }, userId: user.id },
        select: { id: true, status: true, date: true },
    });
    if (owned.length < 2) return;
    const statuses = new Set(owned.map((o) => o.status));
    const days = new Set(owned.map((o) => (o.date ? o.date.toISOString() : "null")));
    if (statuses.size > 1 || days.size > 1) throw new Error("Can only reorder within one column");
    const ownedSet = new Set(owned.map((o) => o.id));
    await db.$transaction(
        ids.filter((id) => ownedSet.has(id)).map((id, i) => db.todoItem.update({ where: { id }, data: { sortOrder: i } })),
    );
    revalidatePath("/todos");
}

export async function addSubtaskImpl(fd: FormData) {
    const user = await requireUser();
    const todoId = str(fd, "todoId");
    const title = str(fd, "title");
    if (!todoId || !title) throw new Error("Missing fields");
    const parent = await db.todoItem.findFirst({ where: { id: todoId, userId: user.id }, select: { id: true } });
    if (!parent) throw new Error("Not found");
    const count = await db.todoSubtask.count({ where: { todoId } });
    await db.todoSubtask.create({ data: { todoId, title: title.slice(0, 300), sortOrder: count } });
    revalidatePath("/todos");
}

export async function toggleSubtaskImpl(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const sub = await db.todoSubtask.findFirst({ where: { id, todo: { userId: user.id } }, select: { done: true } });
    if (!sub) throw new Error("Not found");
    await db.todoSubtask.update({ where: { id }, data: { done: !sub.done } });
    revalidatePath("/todos");
}

export async function deleteSubtaskImpl(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.todoSubtask.deleteMany({ where: { id, todo: { userId: user.id } } });
    revalidatePath("/todos");
}

/** Set or clear which todo blocks this one. Guards against self/forward cycles. */
export async function setBlockedByImpl(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const blockedById = str(fd, "blockedById"); // empty clears the dependency
    if (blockedById) {
        if (blockedById === id) throw new Error("A task can't block itself");
        const blocker = await db.todoItem.findFirst({ where: { id: blockedById, userId: user.id }, select: { blockedById: true } });
        if (!blocker) throw new Error("Blocker not found");
        // Walk the blocker's chain — if it leads back to `id`, this would cycle
        // (covers A→B→A and longer A→B→C→A). Bounded + visited-guarded.
        const visited = new Set<string>([blockedById]);
        let cursor = blocker.blockedById;
        for (let i = 0; i < 1000 && cursor; i++) {
            if (cursor === id) throw new Error("That would create a dependency cycle");
            if (visited.has(cursor)) break;
            visited.add(cursor);
            const next = await db.todoItem.findFirst({ where: { id: cursor, userId: user.id }, select: { blockedById: true } });
            cursor = next?.blockedById ?? null;
        }
    }
    await db.todoItem.updateMany({ where: { id, userId: user.id }, data: { blockedById: blockedById ?? null } });
    revalidatePath("/todos");
    revalidatePath("/calendar");
}

/** AI: break a todo's title/body into a suggested subtask checklist. */
export async function breakdownTodoImpl(fd: FormData): Promise<void> {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const todo = await db.todoItem.findFirst({ where: { id, userId: user.id }, select: { title: true, body: true } });
    if (!todo) throw new Error("Not found");

    const result = await runClaude<{ subtasks: string[] }>({
        purpose: "todo-breakdown",
        userId: user.id,
        system:
            "You break a task into a short, concrete checklist of 3–7 actionable subtasks. " +
            "Each subtask is a short imperative phrase (no numbering, no trailing punctuation). " +
            "Return only the most useful steps.",
        content: `Task: ${todo.title}${todo.body ? `\n\nDetails: ${todo.body}` : ""}`,
        schema: {
            type: "object",
            additionalProperties: false,
            properties: {
                subtasks: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 7 },
            },
            required: ["subtasks"],
        },
    });

    const existing = await db.todoSubtask.count({ where: { todoId: id } });
    const subs = (result.data.subtasks ?? [])
        .map((s) => String(s).trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, 7);
    if (subs.length) {
        await db.todoSubtask.createMany({
            data: subs.map((title, i) => ({ todoId: id, title, sortOrder: existing + i })),
        });
    }
    revalidatePath("/todos");
}
