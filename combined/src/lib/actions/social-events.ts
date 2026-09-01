"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { uploadUserRasterImage } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";
import { str, date } from "@/lib/actions/social-shared";

function parseAttendees(formData: FormData): string[] {
    return (str(formData, "attendees") ?? "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

async function ownedEvent(userId: string, id: string) {
    const event = await db.socialEvent.findFirst({ where: { id, userId } });
    if (!event) throw new Error("Event not found");
    return event;
}

/**
 * Lightweight quick-log used by the floating Social widget. Creates a SocialEvent
 * (the same table the widget's upcoming list reads) WITHOUT redirecting, so the
 * user stays in the widget. Returns void; the widget re-fetches its snapshot.
 */
export async function quickLogSocialEvent(data: { name: string; eventDate: string; location?: string | null }) {
    const user = await requireUser();
    const name = data.name.trim();
    if (!name) throw new Error("Event name is required");
    const parsed = new Date(data.eventDate);
    await db.socialEvent.create({
        data: {
            userId: user.id,
            name,
            eventDate: Number.isNaN(parsed.getTime()) ? new Date() : parsed,
            location: data.location?.trim() || null,
            attendees: [],
        },
    });
    revalidatePath("/social/events");
    revalidatePath("/social");
    revalidatePath("/social/calendar");
}

export async function createEvent(formData: FormData) {
    const user = await requireUser();
    const name = str(formData, "name");
    if (!name) throw new Error("Event name is required");

    const cover = formData.get("coverImage") as File | null;
    let coverImageKey: string | null = null;
    if (cover && cover.size > 0) {
        const stored = await uploadUserRasterImage(user.id, "social", cover);
        coverImageKey = stored.fileKey;
    }

    try {
        await db.socialEvent.create({
            data: {
                userId: user.id,
                name,
                eventDate: date(formData, "eventDate"),
                location: str(formData, "location"),
                attendees: parseAttendees(formData),
                notes: str(formData, "notes"),
                coverImageKey,
            },
        });
    } catch (error) {
        if (coverImageKey) await deleteObject(coverImageKey).catch(() => {});
        throw error;
    }
    revalidatePath("/social/events");
    revalidatePath("/social");
    revalidatePath("/calendar");
    revalidatePath("/social/calendar");
    redirect("/social/events");
}

export async function updateEvent(id: string, formData: FormData) {
    const user = await requireUser();
    const existing = await ownedEvent(user.id, id);
    const name = str(formData, "name");
    if (!name) throw new Error("Event name is required");

    const cover = formData.get("coverImage") as File | null;
    let coverImageKey = existing.coverImageKey;
    let uploadedCoverKey: string | null = null;
    if (cover && cover.size > 0) {
        const stored = await uploadUserRasterImage(user.id, "social", cover);
        coverImageKey = stored.fileKey;
        uploadedCoverKey = stored.fileKey;
    }

    try {
        await db.socialEvent.update({
            where: { id },
            data: {
                name,
                eventDate: date(formData, "eventDate"),
                location: str(formData, "location"),
                attendees: parseAttendees(formData),
                notes: str(formData, "notes"),
                coverImageKey,
            },
        });
    } catch (error) {
        if (uploadedCoverKey) await deleteObject(uploadedCoverKey).catch(() => {});
        throw error;
    }
    if (uploadedCoverKey && existing.coverImageKey) await deleteObject(existing.coverImageKey).catch(() => {});
    revalidatePath("/social/events");
    revalidatePath("/social");
    revalidatePath("/calendar");
    revalidatePath("/social/calendar");
    redirect("/social/events");
}

export async function deleteEvent(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const existing = await ownedEvent(user.id, id);
    await db.socialEvent.delete({ where: { id } });
    if (existing.coverImageKey) await deleteObject(existing.coverImageKey).catch(() => {});
    revalidatePath("/social/events");
    revalidatePath("/social");
    revalidatePath("/calendar");
    revalidatePath("/social/calendar");
}
