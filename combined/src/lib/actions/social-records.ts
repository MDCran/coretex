"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { uploadUserMediaFile } from "@/lib/uploads";
import { validateUploadBatch } from "@/lib/upload-limits";
import { deleteObject } from "@/lib/s3";
import { str, bool, date, dateTime, assertContactOwner, recomputeLastContact } from "@/lib/actions/social-shared";
import { createEvent } from "@/lib/actions/calendar";
import { resolveReachOutNotification } from "@/lib/social/reach-out-notifications";

function rp(contactId: string) {
    revalidatePath(`/social/contacts/${contactId}`);
}

// ---------- Emails ----------
export async function addEmail(contactId: string, formData: FormData) {
    const user = await requireUser();
    await assertContactOwner(user.id, contactId);
    const email = str(formData, "email");
    if (!email) throw new Error("Email is required");
    await db.contactEmail.create({
        data: { contactId, email, label: str(formData, "label") ?? "Other", isPrimary: bool(formData, "isPrimary") },
    });
    rp(contactId);
}

export async function updateEmail(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactEmail.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    const email = str(formData, "email");
    if (!email) throw new Error("Email is required");
    await db.contactEmail.update({
        where: { id },
        data: { email, label: str(formData, "label") ?? "Other", isPrimary: bool(formData, "isPrimary") },
    });
    rp(row.contact.id);
}

export async function deleteEmail(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactEmail.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.contactEmail.delete({ where: { id } });
    rp(row.contact.id);
}

// ---------- Phones ----------
export async function addPhone(contactId: string, formData: FormData) {
    const user = await requireUser();
    await assertContactOwner(user.id, contactId);
    const phone = str(formData, "phone");
    if (!phone) throw new Error("Phone is required");
    await db.contactPhone.create({
        data: { contactId, phone, label: str(formData, "label") ?? "Mobile", isPrimary: bool(formData, "isPrimary") },
    });
    rp(contactId);
}

export async function updatePhone(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactPhone.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    const phone = str(formData, "phone");
    if (!phone) throw new Error("Phone is required");
    await db.contactPhone.update({
        where: { id },
        data: { phone, label: str(formData, "label") ?? "Mobile", isPrimary: bool(formData, "isPrimary") },
    });
    rp(row.contact.id);
}

export async function deletePhone(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactPhone.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.contactPhone.delete({ where: { id } });
    rp(row.contact.id);
}

// ---------- Handles ----------
export async function addHandle(contactId: string, formData: FormData) {
    const user = await requireUser();
    await assertContactOwner(user.id, contactId);
    const platform = str(formData, "platform");
    const handle = str(formData, "handle");
    if (!platform || !handle) throw new Error("Platform and handle are required");
    await db.contactHandle.create({ data: { contactId, platform, handle } });
    rp(contactId);
}

export async function deleteHandle(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactHandle.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.contactHandle.delete({ where: { id } });
    rp(row.contact.id);
}

// ---------- Addresses ----------
export async function addAddress(contactId: string, formData: FormData) {
    const user = await requireUser();
    await assertContactOwner(user.id, contactId);
    await db.contactAddress.create({
        data: {
            contactId,
            addressType: str(formData, "addressType"),
            addressLine1: str(formData, "addressLine1"),
            addressLine2: str(formData, "addressLine2"),
            city: str(formData, "city"),
            state: str(formData, "state"),
            postalCode: str(formData, "postalCode"),
            country: str(formData, "country"),
        },
    });
    rp(contactId);
}

export async function updateAddress(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactAddress.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.contactAddress.update({
        where: { id },
        data: {
            addressType: str(formData, "addressType"),
            addressLine1: str(formData, "addressLine1"),
            addressLine2: str(formData, "addressLine2"),
            city: str(formData, "city"),
            state: str(formData, "state"),
            postalCode: str(formData, "postalCode"),
            country: str(formData, "country"),
        },
    });
    rp(row.contact.id);
}

export async function deleteAddress(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactAddress.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.contactAddress.delete({ where: { id } });
    rp(row.contact.id);
}

// ---------- Dates ----------
export async function addDate(contactId: string, formData: FormData) {
    const user = await requireUser();
    await assertContactOwner(user.id, contactId);
    const dateType = str(formData, "dateType");
    const dateValue = date(formData, "dateValue");
    if (!dateType || !dateValue) throw new Error("Date type and value are required");
    await db.contactDate.create({ data: { contactId, dateType, dateValue } });
    rp(contactId);
    revalidatePath("/social");
}

export async function updateDate(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactDate.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    const dateType = str(formData, "dateType");
    const dateValue = date(formData, "dateValue");
    if (!dateType || !dateValue) throw new Error("Date type and value are required");
    await db.contactDate.update({ where: { id }, data: { dateType, dateValue } });
    rp(row.contact.id);
    revalidatePath("/social");
}

export async function deleteDate(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactDate.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.contactDate.delete({ where: { id } });
    rp(row.contact.id);
}

/**
 * Create an all-day CalendarEvent from a contact's important date. Uses the
 * existing calendar createEvent action (not modified). Titles it
 * "{name}'s {dateType}" and notes the recurring nature in the description so it
 * surfaces on the calendar that day.
 */
export async function addDateToCalendar(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactDate.findUnique({
        where: { id },
        include: { contact: { select: { userId: true, id: true, displayName: true } } },
    });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");

    // Build the all-day occurrence for THIS year (or next if already passed).
    const d = new Date(row.dateValue);
    const now = new Date();
    let year = now.getFullYear();
    const occurrence = new Date(year, d.getMonth(), d.getDate());
    if (occurrence < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        year += 1;
    }
    const starts = new Date(year, d.getMonth(), d.getDate(), 0, 0, 0);

    const fd = new FormData();
    fd.set("title", `${row.contact.displayName}'s ${row.dateType}`);
    fd.set("kind", "EVENT");
    fd.set("allDay", "on");
    fd.set("startsAt", starts.toISOString());
    fd.set("description", `Recurring annual ${row.dateType.toLowerCase()} for ${row.contact.displayName}. Added from Social.`);

    await createEvent(fd);
    rp(row.contact.id);
    revalidatePath("/social");
}

// ---------- Scores (closeness / trust) ----------

/**
 * Update the user-set closeness/trust scores (0–10). These are intentionally
 * the only stored, manually-adjustable scores; "monitoring" is computed live
 * from interaction signals (see connectionHealth in lib/social/format).
 */
export async function updateScores(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    await assertContactOwner(user.id, id);
    const data: { closenessScore?: number | null; trustScore?: number | null } = {};
    if (formData.has("closenessScore")) {
        const v = str(formData, "closenessScore");
        data.closenessScore = v == null ? null : Math.max(0, Math.min(10, parseInt(v, 10) || 0));
    }
    if (formData.has("trustScore")) {
        const v = str(formData, "trustScore");
        data.trustScore = v == null ? null : Math.max(0, Math.min(10, parseInt(v, 10) || 0));
    }
    await db.socialContact.update({ where: { id }, data });
    rp(id);
    revalidatePath("/social/contacts");
}

// ---------- Handles (Socials) ----------
export async function updateHandle(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactHandle.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    const platform = str(formData, "platform");
    const handle = str(formData, "handle");
    if (!platform || !handle) throw new Error("Platform and handle are required");
    await db.contactHandle.update({ where: { id }, data: { platform, handle } });
    rp(row.contact.id);
}

// ---------- Notes ----------
export async function addNote(contactId: string, formData: FormData) {
    const user = await requireUser();
    await assertContactOwner(user.id, contactId);
    const noteText = str(formData, "noteText");
    if (!noteText) throw new Error("Note text is required");
    await db.contactNote.create({ data: { contactId, noteText, noteType: str(formData, "noteType") } });
    rp(contactId);
}

export async function updateNote(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactNote.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    const noteText = str(formData, "noteText");
    if (!noteText) throw new Error("Note text is required");
    await db.contactNote.update({ where: { id }, data: { noteText, noteType: str(formData, "noteType") } });
    rp(row.contact.id);
}

export async function deleteNote(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactNote.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.contactNote.delete({ where: { id } });
    rp(row.contact.id);
}

// ---------- Reminders ----------
export async function addReminder(contactId: string, formData: FormData) {
    const user = await requireUser();
    await assertContactOwner(user.id, contactId);
    const scheduledFor = dateTime(formData, "scheduledFor") ?? date(formData, "scheduledFor");
    if (!scheduledFor) throw new Error("Scheduled date is required");
    await db.contactReminder.create({ data: { contactId, scheduledFor, reminderType: str(formData, "reminderType") } });
    rp(contactId);
    revalidatePath("/social");
}

export async function updateReminder(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactReminder.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    const scheduledFor = dateTime(formData, "scheduledFor") ?? date(formData, "scheduledFor");
    if (!scheduledFor) throw new Error("Scheduled date is required");
    await db.contactReminder.update({ where: { id }, data: { scheduledFor, reminderType: str(formData, "reminderType") } });
    rp(row.contact.id);
    revalidatePath("/social");
}

export async function toggleReminder(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactReminder.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.contactReminder.update({ where: { id }, data: { completed: !row.completed } });
    rp(row.contact.id);
    revalidatePath("/social");
}

export async function deleteReminder(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.contactReminder.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.contactReminder.delete({ where: { id } });
    rp(row.contact.id);
    revalidatePath("/social");
}

// ---------- Interactions ----------
export async function addInteraction(contactId: string, formData: FormData) {
    const user = await requireUser();
    await assertContactOwner(user.id, contactId);
    await db.socialInteraction.create({
        data: {
            contactId,
            interactionType: str(formData, "interactionType"),
            date: date(formData, "date") ?? new Date(),
            notes: str(formData, "notes"),
        },
    });
    await recomputeLastContact(contactId);
    await resolveReachOutNotification(user.id, contactId);
    rp(contactId);
    revalidatePath("/social/contacts");
    revalidatePath("/social");
    revalidatePath("/notifications");
}

export async function updateInteraction(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.socialInteraction.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.socialInteraction.update({
        where: { id },
        data: {
            interactionType: str(formData, "interactionType"),
            date: date(formData, "date") ?? row.date,
            notes: str(formData, "notes"),
        },
    });
    await recomputeLastContact(row.contact.id);
    rp(row.contact.id);
    revalidatePath("/social/contacts");
    revalidatePath("/social");
}

export async function deleteInteraction(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.socialInteraction.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.socialInteraction.delete({ where: { id } });
    await recomputeLastContact(row.contact.id);
    rp(row.contact.id);
    revalidatePath("/social");
}

// ---------- Communications ----------
export async function addCommunication(contactId: string, formData: FormData) {
    const user = await requireUser();
    await assertContactOwner(user.id, contactId);
    await db.communicationLog.create({
        data: {
            contactId,
            channel: str(formData, "channel"),
            sentiment: str(formData, "sentiment"),
            date: date(formData, "date") ?? new Date(),
            notes: str(formData, "notes"),
        },
    });
    await recomputeLastContact(contactId);
    await resolveReachOutNotification(user.id, contactId);
    rp(contactId);
    revalidatePath("/social/contacts");
    revalidatePath("/social");
    revalidatePath("/notifications");
}

export async function updateCommunication(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.communicationLog.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.communicationLog.update({
        where: { id },
        data: {
            channel: str(formData, "channel"),
            sentiment: str(formData, "sentiment"),
            date: date(formData, "date") ?? row.date,
            notes: str(formData, "notes"),
        },
    });
    await recomputeLastContact(row.contact.id);
    rp(row.contact.id);
    revalidatePath("/social/contacts");
    revalidatePath("/social");
}

export async function deleteCommunication(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.communicationLog.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.communicationLog.delete({ where: { id } });
    await recomputeLastContact(row.contact.id);
    rp(row.contact.id);
    revalidatePath("/social");
}

// ---------- Memories ----------

async function deleteKeysBestEffort(keys: Array<string | null | undefined>) {
    await Promise.allSettled([...new Set(keys.filter((key): key is string => Boolean(key)))].map((key) => deleteObject(key)));
}

/** Upload all `media` files from a form and return rows for SocialMemoryMedia. */
async function uploadMemoryMedia(userId: string, files: File[]) {
    validateUploadBatch(files);
    const rows: { key: string; fileName: string; mimeType: string; sizeBytes: number }[] = [];
    try {
        for (const file of files) {
            const stored = await uploadUserMediaFile(userId, "social", file);
            rows.push({
                key: stored.fileKey,
                fileName: stored.fileName || "file",
                mimeType: stored.mimeType,
                sizeBytes: stored.fileSize,
            });
        }
    } catch (error) {
        await deleteKeysBestEffort(rows.map((row) => row.key));
        throw error;
    }
    return rows;
}

export async function addMemory(contactId: string, formData: FormData) {
    const user = await requireUser();
    await assertContactOwner(user.id, contactId);
    const description = str(formData, "description");
    if (!description) throw new Error("Description is required");

    const files = formData.getAll("media").filter((f): f is File => f instanceof File && f.size > 0);
    const media = await uploadMemoryMedia(user.id, files);

    try {
        await db.socialMemory.create({
            data: {
                contactId,
                title: str(formData, "title"),
                description,
                memoryDate: date(formData, "memoryDate"),
                location: str(formData, "location"),
                media: media.length ? { create: media } : undefined,
            },
        });
    } catch (error) {
        await deleteKeysBestEffort(media.map((item) => item.key));
        throw error;
    }
    rp(contactId);
}

export async function updateMemory(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.socialMemory.findUnique({
        where: { id },
        include: { contact: { select: { userId: true, id: true } }, media: true },
    });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    const description = str(formData, "description");
    if (!description) throw new Error("Description is required");

    // Stage media removals; storage is deleted only after the database update succeeds.
    const removeIds = formData.getAll("removeMediaIds").map(String).filter(Boolean);
    const toRemove = row.media.filter((m) => removeIds.includes(m.id));

    // Only accept legacy keys that already belong to this memory.
    const removeKeys = formData.getAll("removeMediaKeys").map(String).filter(Boolean);
    const legacyKeysToRemove = row.mediaKeys.filter((key) => removeKeys.includes(key));
    const nextKeys = row.mediaKeys.filter((key) => !removeKeys.includes(key));

    // Add newly uploaded media.
    const files = formData.getAll("media").filter((f): f is File => f instanceof File && f.size > 0);
    const newMedia = await uploadMemoryMedia(user.id, files);

    try {
        await db.socialMemory.update({
            where: { id },
            data: {
                title: str(formData, "title"),
                description,
                memoryDate: date(formData, "memoryDate"),
                location: str(formData, "location"),
                mediaKeys: nextKeys,
                media: toRemove.length || newMedia.length
                    ? {
                        ...(toRemove.length ? { deleteMany: { id: { in: toRemove.map((item) => item.id) } } } : {}),
                        ...(newMedia.length ? { create: newMedia } : {}),
                    }
                    : undefined,
            },
        });
    } catch (error) {
        await deleteKeysBestEffort(newMedia.map((item) => item.key));
        throw error;
    }
    await deleteKeysBestEffort([
        ...toRemove.map((item) => item.key),
        ...legacyKeysToRemove,
    ]);
    rp(row.contact.id);
}

export async function deleteMemory(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.socialMemory.findUnique({
        where: { id },
        include: { contact: { select: { userId: true, id: true } }, media: true },
    });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.socialMemory.delete({ where: { id } });
    await deleteKeysBestEffort([
        ...row.mediaKeys,
        ...row.media.map((item) => item.key),
    ]);
    rp(row.contact.id);
}

// ---------- Gifts ----------
export async function addGift(contactId: string, formData: FormData) {
    const user = await requireUser();
    await assertContactOwner(user.id, contactId);
    const giftDescription = str(formData, "giftDescription");
    if (!giftDescription) throw new Error("Description is required");
    await db.socialGift.create({
        data: {
            contactId,
            giftDescription,
            givenDate: date(formData, "givenDate"),
            occasion: str(formData, "occasion"),
            direction: str(formData, "direction") ?? "given",
        },
    });
    rp(contactId);
}

export async function updateGift(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.socialGift.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    const giftDescription = str(formData, "giftDescription");
    if (!giftDescription) throw new Error("Description is required");
    await db.socialGift.update({
        where: { id },
        data: {
            giftDescription,
            givenDate: date(formData, "givenDate"),
            occasion: str(formData, "occasion"),
            direction: str(formData, "direction") ?? "given",
        },
    });
    rp(row.contact.id);
}

export async function deleteGift(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.socialGift.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.socialGift.delete({ where: { id } });
    rp(row.contact.id);
}

// ---------- Conflicts ----------
export async function addConflict(contactId: string, formData: FormData) {
    const user = await requireUser();
    await assertContactOwner(user.id, contactId);
    const description = str(formData, "description");
    if (!description) throw new Error("Description is required");
    await db.socialConflict.create({
        data: { contactId, description, date: date(formData, "date"), resolution: str(formData, "resolution") },
    });
    rp(contactId);
}

export async function updateConflict(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.socialConflict.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.socialConflict.update({ where: { id }, data: { resolution: str(formData, "resolution") } });
    rp(row.contact.id);
}

export async function deleteConflict(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.socialConflict.findUnique({ where: { id }, include: { contact: { select: { userId: true, id: true } } } });
    if (!row || row.contact.userId !== user.id) throw new Error("Not found");
    await db.socialConflict.delete({ where: { id } });
    rp(row.contact.id);
}

// ---------- Connections ----------
export async function addConnection(contactId: string, formData: FormData) {
    const user = await requireUser();
    await assertContactOwner(user.id, contactId);
    const contact2Id = str(formData, "contact2Id");
    if (!contact2Id) throw new Error("Pick a contact to connect");
    await assertContactOwner(user.id, contact2Id);
    if (contact2Id === contactId) throw new Error("Cannot connect a contact to itself");
    await db.socialConnection.create({
        data: { contact1Id: contactId, contact2Id, relationshipType: str(formData, "relationshipType"), notes: str(formData, "notes") },
    });
    rp(contactId);
    rp(contact2Id);
}

export async function deleteConnection(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.socialConnection.findUnique({
        where: { id },
        include: { contact1: { select: { userId: true, id: true } }, contact2: { select: { id: true } } },
    });
    if (!row || row.contact1.userId !== user.id) throw new Error("Not found");
    await db.socialConnection.delete({ where: { id } });
    rp(row.contact1.id);
    rp(row.contact2.id);
}
