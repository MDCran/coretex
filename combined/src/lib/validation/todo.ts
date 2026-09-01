/**
 * Server-side Zod validation for todo create/update forms.
 *
 * Server actions read `FormData`; these schemas normalize the raw string values
 * into typed, validated data and throw a friendly `Error` (first issue message)
 * on failure — matching the throw-based contract the existing actions use.
 */

import { z } from "zod";
import {
    bandForTime,
    cleanLinks,
    cleanTags,
    isValidHHMM,
    maxDayOfMonth,
    type TimeOfDayValue,
    type TodoEnergyValue,
    type TodoPriorityValue,
} from "@/lib/todos-shared";

const DOW_SET = new Set<string>(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);

/** "" / whitespace-only → undefined, so `.optional()` kicks in. */
const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const timeOfDaySchema = z.preprocess(
    emptyToUndefined,
    z.enum(["MORNING", "AFTERNOON", "EVENING", "NIGHT"]).optional(),
);

const startTimeSchema = z.preprocess(
    emptyToUndefined,
    z
        .string()
        .transform((v) => v.trim())
        .refine((v) => isValidHHMM(v), { message: "Start time must be a valid time (HH:MM)" })
        .optional(),
);

const durationSchema = z.preprocess(
    emptyToUndefined,
    z.coerce
        .number()
        .int("Duration must be a whole number of minutes")
        .min(1, "Duration must be at least 1 minute")
        .max(24 * 60, "Duration can't exceed 24 hours")
        .optional(),
);

const dateSchema = z.preprocess(
    emptyToUndefined,
    z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
        .optional(),
);

const cadenceSchema = z.enum(["NONE", "DAILY", "EVERY_N_DAYS", "WEEKLY_DOW", "YEARLY"]).default("NONE");

const prioritySchema = z.preprocess(
    emptyToUndefined,
    z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).default("NONE"),
);

const energySchema = z.preprocess(emptyToUndefined, z.enum(["DEEP_WORK", "QUICK", "COLLABORATIVE"]).optional());

const categorySchema = z.preprocess(emptyToUndefined, z.string().max(40, "Category is too long").optional());

const tagsSchema = z.preprocess((v) => cleanTags(typeof v === "string" ? v : undefined), z.array(z.string()).default([]));

const linksSchema = z.preprocess((v) => cleanLinks(typeof v === "string" ? v : undefined), z.array(z.string()).default([]));

const projectRefSchema = z.preprocess(emptyToUndefined, z.string().max(120, "Project label is too long").optional());

const projectUrlSchema = z.preprocess(emptyToUndefined, z.string().max(2000, "Project URL is too long").optional());

/** Parse a "MON,TUE,.." string into a clean, validated weekday array. */
function parseDaysOfWeek(raw: unknown): string[] {
    if (typeof raw !== "string") return [];
    return raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => DOW_SET.has(s));
}

const titleSchema = z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : ""),
    z.string().min(1, "Title is required").max(200, "Title is too long"),
);

const bodySchema = z.preprocess(emptyToUndefined, z.string().max(5000, "Description is too long").optional());

const baseTodoSchema = z.object({
    title: titleSchema,
    body: bodySchema,
    date: dateSchema,
    cadence: cadenceSchema,
    timeOfDay: timeOfDaySchema,
    startTime: startTimeSchema,
    durationMinutes: durationSchema,
    priority: prioritySchema,
    tags: tagsSchema,
    category: categorySchema,
    energy: energySchema,
    links: linksSchema,
    projectRef: projectRefSchema,
    projectUrl: projectUrlSchema,
    intervalN: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1, "Interval must be at least 1").optional()),
    daysOfWeek: z.preprocess(parseDaysOfWeek, z.array(z.string()).default([])),
    yearlyMonth: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(12).optional()),
    yearlyDay: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(31).optional()),
});

/** If a specific time was given but no explicit bucket, infer one so the
 *  calendar zone-band fallback and the tag stay coherent. */
function withInferredBand<T extends { timeOfDay?: TimeOfDayValue; startTime?: string }>(v: T) {
    return {
        ...v,
        timeOfDay: (v.timeOfDay ?? (v.startTime ? bandForTime(v.startTime) : null)) as TimeOfDayValue | null,
    };
}

const todoCreateSchema = baseTodoSchema
    .refine((v) => v.cadence !== "EVERY_N_DAYS" || (v.intervalN != null && v.intervalN >= 1), {
        message: "Interval must be at least 1 day",
        path: ["intervalN"],
    })
    .refine((v) => v.cadence !== "WEEKLY_DOW" || v.daysOfWeek.length > 0, {
        message: "Pick at least one weekday",
        path: ["daysOfWeek"],
    })
    .refine((v) => v.cadence !== "YEARLY" || (v.yearlyMonth != null && v.yearlyDay != null), {
        message: "Pick a month and day",
        path: ["yearlyMonth"],
    })
    .refine((v) => v.cadence !== "YEARLY" || v.yearlyMonth == null || v.yearlyDay == null || v.yearlyDay <= maxDayOfMonth(v.yearlyMonth), {
        message: "That day doesn't exist in the chosen month",
        path: ["yearlyDay"],
    })
    .transform(withInferredBand);

/** Normalized shape consumed by the server actions. */
export interface NormalizedTodo {
    title: string;
    body: string | null;
    date: string | null;
    cadence: "NONE" | "DAILY" | "EVERY_N_DAYS" | "WEEKLY_DOW" | "YEARLY";
    timeOfDay: TimeOfDayValue | null;
    startTime: string | null;
    durationMinutes: number | null;
    priority: TodoPriorityValue;
    tags: string[];
    category: string | null;
    energy: TodoEnergyValue | null;
    links: string[];
    projectRef: string | null;
    projectUrl: string | null;
    intervalN: number | null;
    daysOfWeek: string[];
    yearlyMonth: number | null;
    yearlyDay: number | null;
}

function firstIssueMessage(error: z.ZodError): string {
    return error.issues[0]?.message ?? "Invalid todo";
}

/** Collect every form field the todo schemas understand into a plain record. */
function rawTodoRecord(fd: FormData): Record<string, unknown> {
    const get = (k: string) => {
        const v = fd.get(k);
        return typeof v === "string" ? v : undefined;
    };
    return {
        title: get("title"),
        body: get("body"),
        date: get("date"),
        cadence: get("cadence"),
        timeOfDay: get("timeOfDay"),
        startTime: get("startTime"),
        durationMinutes: get("durationMinutes"),
        priority: get("priority"),
        tags: get("tags"),
        category: get("category"),
        energy: get("energy"),
        links: get("links"),
        projectRef: get("projectRef"),
        projectUrl: get("projectUrl"),
        intervalN: get("intervalN"),
        daysOfWeek: get("daysOfWeek"),
        yearlyMonth: get("yearlyMonth"),
        yearlyDay: get("yearlyDay"),
    };
}

/** Validate a create-todo form. Throws `Error(firstIssueMessage)` on failure. */
export function parseTodoForm(fd: FormData): NormalizedTodo {
    const parsed = todoCreateSchema.safeParse(rawTodoRecord(fd));
    if (!parsed.success) throw new Error(firstIssueMessage(parsed.error));
    const d = parsed.data;
    return {
        title: d.title,
        body: d.body ?? null,
        date: d.date ?? null,
        cadence: d.cadence,
        timeOfDay: d.timeOfDay,
        startTime: d.startTime ?? null,
        durationMinutes: d.durationMinutes ?? null,
        priority: d.priority,
        tags: d.tags,
        category: d.category ?? null,
        energy: d.energy ?? null,
        links: d.links,
        projectRef: d.projectRef ?? null,
        projectUrl: d.projectUrl ?? null,
        intervalN: d.intervalN ?? null,
        daysOfWeek: d.daysOfWeek,
        yearlyMonth: d.yearlyMonth ?? null,
        yearlyDay: d.yearlyDay ?? null,
    };
}

// ── Update (todo item edit): no cadence; title required ──

const todoUpdateSchema = z
    .object({
        title: titleSchema,
        body: bodySchema,
        timeOfDay: timeOfDaySchema,
        startTime: startTimeSchema,
        durationMinutes: durationSchema,
        priority: prioritySchema,
        tags: tagsSchema,
        category: categorySchema,
        energy: energySchema,
        links: linksSchema,
        projectRef: projectRefSchema,
        projectUrl: projectUrlSchema,
    })
    .transform(withInferredBand);

export interface NormalizedTodoUpdate {
    title: string;
    body: string | null;
    timeOfDay: TimeOfDayValue | null;
    startTime: string | null;
    durationMinutes: number | null;
    priority: TodoPriorityValue;
    tags: string[];
    category: string | null;
    energy: TodoEnergyValue | null;
    links: string[];
    projectRef: string | null;
    projectUrl: string | null;
}

/** Validate a todo-edit form. Throws `Error(firstIssueMessage)` on failure. */
export function parseTodoUpdateForm(fd: FormData): NormalizedTodoUpdate {
    const get = (k: string) => {
        const v = fd.get(k);
        return typeof v === "string" ? v : undefined;
    };
    const parsed = todoUpdateSchema.safeParse({
        title: get("title"),
        body: get("body"),
        timeOfDay: get("timeOfDay"),
        startTime: get("startTime"),
        durationMinutes: get("durationMinutes"),
        priority: get("priority"),
        tags: get("tags"),
        category: get("category"),
        energy: get("energy"),
        links: get("links"),
        projectRef: get("projectRef"),
        projectUrl: get("projectUrl"),
    });
    if (!parsed.success) throw new Error(firstIssueMessage(parsed.error));
    const d = parsed.data;
    return {
        title: d.title,
        body: d.body ?? null,
        timeOfDay: d.timeOfDay,
        startTime: d.startTime ?? null,
        durationMinutes: d.durationMinutes ?? null,
        priority: d.priority,
        tags: d.tags,
        category: d.category ?? null,
        energy: d.energy ?? null,
        links: d.links,
        projectRef: d.projectRef ?? null,
        projectUrl: d.projectUrl ?? null,
    };
}
