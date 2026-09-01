"use server";

import { revalidatePath } from "next/cache";
import { addDays, addMonths } from "date-fns";
import type { ReminderCadence } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { int, parseDateTime, str } from "./health-shared";

const CADENCES: ReminderCadence[] = ["ONCE", "EVERY_N_DAYS", "WEEKLY", "MONTHLY_ON_DAY", "EVERY_N_MONTHS"];

function rl() {
    revalidatePath("/calendar/reminders");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
}

function parseCadence(value: string | null): ReminderCadence {
    return CADENCES.includes(value as ReminderCadence) ? (value as ReminderCadence) : "ONCE";
}

/** Clamp a day-of-month (1..31) to the number of days in the target month. */
function clampDay(year: number, month: number, day: number): number {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Math.min(Math.max(1, day), daysInMonth);
}

/**
 * Returns a Date on the same day-of-month (clamped) `monthsAhead` months after
 * `from`, preserving the original time-of-day.
 */
function addMonthsClamped(from: Date, monthsAhead: number, dayOfMonth: number): Date {
    const base = new Date(from);
    // Move to the first of the target month to avoid JS month-overflow when the
    // source day is larger than the target month's length.
    const targetMonthIndex = base.getMonth() + monthsAhead;
    const year = base.getFullYear() + Math.floor(targetMonthIndex / 12);
    const month = ((targetMonthIndex % 12) + 12) % 12;
    const day = clampDay(year, month, dayOfMonth);
    return new Date(year, month, day, base.getHours(), base.getMinutes(), base.getSeconds(), 0);
}

/**
 * Computes the next due date after completing a reminder once at `from`.
 * Returns null when the cadence is ONCE (caller should archive instead).
 */
function advance(
    cadence: ReminderCadence,
    from: Date,
    intervalN: number | null,
    dayOfMonth: number | null,
): Date | null {
    switch (cadence) {
        case "ONCE":
            return null;
        case "EVERY_N_DAYS":
            return addDays(from, Math.max(1, intervalN ?? 1));
        case "WEEKLY":
            return addDays(from, 7);
        case "MONTHLY_ON_DAY": {
            const day = dayOfMonth ?? from.getDate();
            return addMonthsClamped(from, 1, day);
        }
        case "EVERY_N_MONTHS": {
            const day = dayOfMonth ?? from.getDate();
            return addMonthsClamped(from, Math.max(1, intervalN ?? 1), day);
        }
        default:
            return null;
    }
}

async function ownReminder(id: string, userId: string) {
    const owned = await db.recurringReminder.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error("Reminder not found");
}

/** Validates a contactId belongs to the user, returning it or null. */
async function ownedContactId(fd: FormData, userId: string): Promise<string | null> {
    const contactId = str(fd, "contactId");
    if (!contactId) return null;
    const owned = await db.socialContact.findFirst({ where: { id: contactId, userId }, select: { id: true } });
    if (!owned) throw new Error("Contact not found");
    return contactId;
}

function readCadenceFields(fd: FormData) {
    const cadence = parseCadence(str(fd, "cadence"));
    let intervalN: number | null = null;
    let dayOfMonth: number | null = null;

    if (cadence === "EVERY_N_DAYS" || cadence === "EVERY_N_MONTHS") {
        intervalN = Math.max(1, int(fd, "intervalN") ?? 1);
    }
    if (cadence === "MONTHLY_ON_DAY") {
        dayOfMonth = Math.min(31, Math.max(1, int(fd, "dayOfMonth") ?? 1));
    }
    // EVERY_N_MONTHS keeps the day-of-month implied by nextDueAt, so we also
    // capture an explicit dayOfMonth when supplied for stable clamping.
    if (cadence === "EVERY_N_MONTHS") {
        const d = int(fd, "dayOfMonth");
        if (d !== null) dayOfMonth = Math.min(31, Math.max(1, d));
    }
    return { cadence, intervalN, dayOfMonth };
}

export async function createReminder(fd: FormData) {
    const user = await requireUser();
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");

    const contactId = await ownedContactId(fd, user.id);
    const { cadence, intervalN, dayOfMonth } = readCadenceFields(fd);
    const nextDueAt = parseDateTime(str(fd, "nextDueAt"));

    const reminder = await db.recurringReminder.create({
        data: {
            userId: user.id,
            title,
            description: str(fd, "description"),
            location: str(fd, "location"),
            icon: str(fd, "icon"),
            contactId,
            phone: contactId ? null : str(fd, "phone"),
            link: str(fd, "link"),
            cadence,
            intervalN,
            dayOfMonth: cadence === "MONTHLY_ON_DAY" ? (dayOfMonth ?? nextDueAt.getDate()) : dayOfMonth,
            nextDueAt,
        },
    });
    rl();
    return reminder.id;
}

export async function updateReminder(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await ownReminder(id, user.id);

    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");

    const contactId = await ownedContactId(fd, user.id);
    const { cadence, intervalN, dayOfMonth } = readCadenceFields(fd);
    const nextDueAt = parseDateTime(str(fd, "nextDueAt"));

    await db.recurringReminder.update({
        where: { id },
        data: {
            title,
            description: str(fd, "description"),
            location: str(fd, "location"),
            icon: str(fd, "icon"),
            contactId,
            phone: contactId ? null : str(fd, "phone"),
            link: str(fd, "link"),
            cadence,
            intervalN,
            dayOfMonth: cadence === "MONTHLY_ON_DAY" ? (dayOfMonth ?? nextDueAt.getDate()) : dayOfMonth,
            nextDueAt,
        },
    });
    rl();
}

export async function completeReminder(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");

    const reminder = await db.recurringReminder.findFirst({
        where: { id, userId: user.id },
        select: { id: true, cadence: true, intervalN: true, dayOfMonth: true, nextDueAt: true },
    });
    if (!reminder) throw new Error("Reminder not found");

    const now = new Date();
    const next = advance(reminder.cadence, reminder.nextDueAt, reminder.intervalN, reminder.dayOfMonth);

    if (next === null) {
        // ONCE → mark complete and archive.
        await db.recurringReminder.update({
            where: { id },
            data: { lastCompletedAt: now, archived: true },
        });
    } else {
        await db.recurringReminder.update({
            where: { id },
            data: { lastCompletedAt: now, nextDueAt: next },
        });
    }
    rl();
}

export async function snoozeReminder(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const days = str(fd, "days") === "7" ? 7 : 1;

    const reminder = await db.recurringReminder.findFirst({
        where: { id, userId: user.id },
        select: { id: true, nextDueAt: true },
    });
    if (!reminder) throw new Error("Reminder not found");

    await db.recurringReminder.update({
        where: { id },
        data: { nextDueAt: addDays(reminder.nextDueAt, days) },
    });
    rl();
}

export async function archiveReminder(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const archived = str(fd, "archived") !== "false";
    await db.recurringReminder.updateMany({ where: { id, userId: user.id }, data: { archived } });
    rl();
}

export async function deleteReminder(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.recurringReminder.deleteMany({ where: { id, userId: user.id } });
    rl();
}
