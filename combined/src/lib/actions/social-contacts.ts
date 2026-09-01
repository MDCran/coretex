"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { uploadUserRasterImage } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";
import { str, int, bool, date, ownedContact, recomputeLastContact } from "@/lib/actions/social-shared";
import { resolveReachOutNotification } from "@/lib/social/reach-out-notifications";

async function ownedTagIds(userId: string, values: FormDataEntryValue[]): Promise<string[]> {
    const ids = [...new Set(values.map(String).filter(Boolean))];
    if (!ids.length) return [];
    const owned = await db.socialTag.findMany({ where: { id: { in: ids }, userId }, select: { id: true } });
    if (owned.length !== ids.length) throw new Error("One or more tags were not found");
    return ids;
}

function parseContact(formData: FormData) {
    const displayName = str(formData, "displayName");
    if (!displayName) throw new Error("Display name is required");
    const energyTags = (str(formData, "energyTags") ?? "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

    return {
        displayName,
        firstName: str(formData, "firstName"),
        lastName: str(formData, "lastName"),
        nickname: str(formData, "nickname"),
        relationshipType: str(formData, "relationshipType"),
        howWeMet: str(formData, "howWeMet"),
        birthday: date(formData, "birthday"),
        occupation: str(formData, "occupation"),
        companyOrSchool: str(formData, "companyOrSchool"),
        hometown: str(formData, "hometown"),
        timezone: str(formData, "timezone"),
        pronouns: str(formData, "pronouns"),
        interests: str(formData, "interests"),
        notes: str(formData, "notes"),
        closenessScore: int(formData, "closenessScore", 1, 10),
        trustScore: int(formData, "trustScore", 1, 10),
        communicationFrequency: str(formData, "communicationFrequency"),
        energyTags,
        innerCircle: bool(formData, "innerCircle"),
        stayInTouch: bool(formData, "stayInTouch"),
        stayInTouchDays: int(formData, "stayInTouchDays", 1),
        preferredContactMethod: str(formData, "preferredContactMethod"),
        active: !bool(formData, "archived"),
    };
}

export async function createContact(formData: FormData) {
    const user = await requireUser();
    const data = parseContact(formData);
    const tagIds = await ownedTagIds(user.id, formData.getAll("tagIds"));

    const avatarFile = formData.get("avatar") as File | null;
    let avatarKey: string | null = null;
    if (avatarFile && avatarFile.size > 0) {
        const stored = await uploadUserRasterImage(user.id, "social", avatarFile);
        avatarKey = stored.fileKey;
    }

    let contact: Awaited<ReturnType<typeof ownedContact>>;
    try {
        contact = await db.socialContact.create({
            data: { ...data, avatarKey, userId: user.id, tags: tagIds.length ? { connect: tagIds.map((tid) => ({ id: tid })) } : undefined },
        });
    } catch (error) {
        if (avatarKey) await deleteObject(avatarKey).catch(() => {});
        throw error;
    }
    revalidatePath("/social/contacts");
    revalidatePath("/social");
    redirect(`/social/contacts/${contact.id}`);
}

export async function updateContact(id: string, formData: FormData) {
    const user = await requireUser();
    const existing = await ownedContact(user.id, id);
    const data = parseContact(formData);
    // Tags (m2m) — submitted as repeated tagIds. Validate all ownership
    // before uploading a replacement avatar so rejection cannot orphan it.
    const tagIds = await ownedTagIds(user.id, formData.getAll("tagIds"));

    const avatarFile = formData.get("avatar") as File | null;
    let avatarKey = existing.avatarKey;
    let uploadedAvatarKey: string | null = null;
    if (avatarFile && avatarFile.size > 0) {
        const stored = await uploadUserRasterImage(user.id, "social", avatarFile);
        avatarKey = stored.fileKey;
        uploadedAvatarKey = stored.fileKey;
    }

    try {
        await db.socialContact.update({
            where: { id },
            data: { ...data, avatarKey, tags: { set: tagIds.map((tid) => ({ id: tid })) } },
        });
    } catch (error) {
        if (uploadedAvatarKey) await deleteObject(uploadedAvatarKey).catch(() => {});
        throw error;
    }
    if (uploadedAvatarKey && existing.avatarKey) await deleteObject(existing.avatarKey).catch(() => {});
    revalidatePath("/social/contacts");
    revalidatePath(`/social/contacts/${id}`);
    revalidatePath("/social");
    redirect(`/social/contacts/${id}`);
}

export async function deleteContact(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const existing = await ownedContact(user.id, id);
    await db.socialContact.delete({ where: { id } });
    if (existing.avatarKey) await deleteObject(existing.avatarKey).catch(() => {});
    revalidatePath("/social/contacts");
    revalidatePath("/social");
    redirect("/social/contacts");
}

/**
 * Schedule/snooze the stay-in-touch cadence for a contact in one click.
 * Enables stayInTouch and sets stayInTouchDays to N, so the next reach-out is
 * due N days after the last contact. Also drops any existing open REACH_OUT
 * reminders so the schedule reflects the new cadence.
 */
export async function scheduleReachOut(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const days = int(formData, "days", 1) ?? 30;
    await ownedContact(user.id, id);
    await db.socialContact.update({ where: { id }, data: { stayInTouch: true, stayInTouchDays: days } });
    revalidatePath("/social");
    revalidatePath("/social/contacts");
    revalidatePath(`/social/contacts/${id}`);
}

/** Log a reach-out interaction, updating lastContactAt. One click "Mark reached out". */
export async function markReachedOut(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    await ownedContact(user.id, id);
    await db.socialInteraction.create({
        data: { contactId: id, interactionType: "REACH_OUT", date: new Date(), notes: "Reached out" },
    });
    await recomputeLastContact(id);
    await resolveReachOutNotification(user.id, id);
    revalidatePath("/social");
    revalidatePath("/social/contacts");
    revalidatePath(`/social/contacts/${id}`);
    revalidatePath("/notifications");
}

/** Toggle inner-circle / stay-in-touch / active inline from cards. */
export async function toggleContactFlag(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const flag = String(formData.get("flag"));
    await ownedContact(user.id, id);
    if (flag === "innerCircle") {
        const c = await db.socialContact.findUniqueOrThrow({ where: { id } });
        await db.socialContact.update({ where: { id }, data: { innerCircle: !c.innerCircle } });
    } else if (flag === "active") {
        const c = await db.socialContact.findUniqueOrThrow({ where: { id } });
        await db.socialContact.update({ where: { id }, data: { active: !c.active } });
    }
    revalidatePath("/social/contacts");
    revalidatePath(`/social/contacts/${id}`);
}
