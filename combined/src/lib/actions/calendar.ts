"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bool, parseDateTime, parseOptionalDateTime, str } from "./health-shared";

const ALLOWED_COLORS = [
    "red",
    "orange",
    "amber",
    "yellow",
    "green",
    "emerald",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
    "brand",
    "neutral",
];

function rl() {
    revalidatePath("/calendar");
    revalidatePath("/calendar/categories");
}

// ── Events ───────────────────────────────────────────────────

export async function createEvent(fd: FormData) {
    const user = await requireUser();
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");

    const kind = str(fd, "kind") === "APPOINTMENT" ? "APPOINTMENT" : "EVENT";
    const allDay = bool(fd, "allDay");
    const startsAt = parseDateTime(str(fd, "startsAt"));
    const endsAt = parseOptionalDateTime(str(fd, "endsAt"));

    const categoryId = str(fd, "categoryId");
    if (categoryId) {
        const owned = await db.eventCategory.findFirst({ where: { id: categoryId, userId: user.id }, select: { id: true } });
        if (!owned) throw new Error("Category not found");
    }
    const providerId = kind === "APPOINTMENT" ? str(fd, "providerId") : null;
    const doctorId = kind === "APPOINTMENT" ? str(fd, "doctorId") : null;

    const event = await db.calendarEvent.create({
        data: {
            userId: user.id,
            kind,
            title,
            description: str(fd, "description"),
            location: str(fd, "location"),
            startsAt,
            endsAt,
            allDay,
            categoryId: categoryId ?? null,
            providerId,
            doctorId,
            visitNotes: kind === "APPOINTMENT" ? str(fd, "visitNotes") : null,
        },
    });

    await syncAttendees(event.id, user.id, fd);
    await syncReminders(event.id, fd);

    rl();
    return event.id;
}

export async function updateEvent(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.calendarEvent.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Event not found");

    const kind = str(fd, "kind") === "APPOINTMENT" ? "APPOINTMENT" : "EVENT";
    const categoryId = str(fd, "categoryId");
    if (categoryId) {
        const owned = await db.eventCategory.findFirst({ where: { id: categoryId, userId: user.id }, select: { id: true } });
        if (!owned) throw new Error("Category not found");
    }

    await db.calendarEvent.update({
        where: { id },
        data: {
            kind,
            title: str(fd, "title") ?? undefined,
            description: str(fd, "description"),
            location: str(fd, "location"),
            startsAt: parseDateTime(str(fd, "startsAt")),
            endsAt: parseOptionalDateTime(str(fd, "endsAt")),
            allDay: bool(fd, "allDay"),
            categoryId: categoryId ?? null,
            providerId: kind === "APPOINTMENT" ? str(fd, "providerId") : null,
            doctorId: kind === "APPOINTMENT" ? str(fd, "doctorId") : null,
            visitNotes: kind === "APPOINTMENT" ? str(fd, "visitNotes") : null,
        },
    });

    // Replace attendees & reminders.
    await db.eventAttendee.deleteMany({ where: { eventId: id } });
    await db.eventReminder.deleteMany({ where: { eventId: id } });
    await syncAttendees(id, user.id, fd);
    await syncReminders(id, fd);

    rl();
}

export async function deleteEvent(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.calendarEvent.deleteMany({ where: { id, userId: user.id } });
    rl();
}

/**
 * Attendees are passed as JSON in `attendees` field: array of
 * { contactId?: string; name?: string; email?: string }.
 */
async function syncAttendees(eventId: string, userId: string, fd: FormData) {
    const raw = str(fd, "attendees");
    if (!raw) return;
    let parsed: Array<{ contactId?: string; name?: string; email?: string }> = [];
    try {
        parsed = JSON.parse(raw);
    } catch {
        return;
    }
    const rows = parsed
        .map((a) => ({
            eventId,
            contactId: a.contactId || null,
            name: a.name?.trim() || null,
            email: a.email?.trim() || null,
        }))
        .filter((a) => a.contactId || a.name || a.email);
    if (rows.length) await db.eventAttendee.createMany({ data: rows });
}

/**
 * Reminders passed as JSON in `reminders` field: array of
 * { minutesBefore: number; channel?: "INAPP" | "EMAIL" }.
 */
async function syncReminders(eventId: string, fd: FormData) {
    const raw = str(fd, "reminders");
    if (!raw) return;
    let parsed: Array<{ minutesBefore: number; channel?: string }> = [];
    try {
        parsed = JSON.parse(raw);
    } catch {
        return;
    }
    const rows = parsed
        .filter((r) => Number.isFinite(r.minutesBefore))
        .map((r) => ({
            eventId,
            minutesBefore: Math.max(0, Math.round(r.minutesBefore)),
            channel: r.channel === "EMAIL" ? ("EMAIL" as const) : ("INAPP" as const),
        }));
    if (rows.length) await db.eventReminder.createMany({ data: rows });
}

// ── Categories ───────────────────────────────────────────────

export async function createCategory(fd: FormData) {
    const user = await requireUser();
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    const color = str(fd, "color") ?? "neutral";
    await db.eventCategory.create({
        data: {
            userId: user.id,
            name,
            color: ALLOWED_COLORS.includes(color) ? color : "neutral",
            icon: str(fd, "icon"),
        },
    });
    rl();
}

export async function updateCategory(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const color = str(fd, "color") ?? "neutral";
    await db.eventCategory.updateMany({
        where: { id, userId: user.id },
        data: {
            name: str(fd, "name") ?? undefined,
            color: ALLOWED_COLORS.includes(color) ? color : "neutral",
            icon: str(fd, "icon"),
        },
    });
    rl();
}

export async function deleteCategory(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.eventCategory.deleteMany({ where: { id, userId: user.id } });
    rl();
}

// ── Social event → CalendarEvent integration ─────────────────

/**
 * Create a CalendarEvent from a social context (e.g. "Coffee with Alice").
 * Optionally links to a contact via attendees.
 * Revalidates both /calendar and /social so the event appears immediately.
 */
export async function createSocialEvent(
    contactId: string | null,
    data: {
        title: string;
        startsAt: string;
        endsAt?: string | null;
        allDay?: boolean;
        description?: string | null;
        location?: string | null;
    },
) {
    const user = await requireUser();
    if (!data.title) throw new Error("Title is required");

    const startsAt = parseDateTime(data.startsAt);
    const endsAt = data.endsAt ? parseOptionalDateTime(data.endsAt) : null;

    // Find or create a "Social" category (purple) to tag social events.
    let socialCategory = await db.eventCategory.findFirst({
        where: { userId: user.id, name: "Social" },
        select: { id: true },
    });
    if (!socialCategory) {
        socialCategory = await db.eventCategory.create({
            data: { userId: user.id, name: "Social", color: "purple", icon: "Users01" },
            select: { id: true },
        });
    }

    const event = await db.calendarEvent.create({
        data: {
            userId: user.id,
            kind: "EVENT",
            title: data.title,
            description: data.description ?? null,
            location: data.location ?? null,
            startsAt,
            endsAt,
            allDay: data.allDay ?? false,
            categoryId: socialCategory.id,
        },
    });

    // Link to the contact via EventAttendee if contactId provided.
    if (contactId) {
        const contact = await db.socialContact.findFirst({ where: { id: contactId, userId: user.id }, select: { displayName: true } });
        if (contact) {
            await db.eventAttendee.create({ data: { eventId: event.id, contactId, name: contact.displayName } });
        }
    }

    revalidatePath("/calendar");
    revalidatePath("/social");
    revalidatePath("/social/calendar");
    return event.id;
}
