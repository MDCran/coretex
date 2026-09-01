"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { str, dateTime, date, assertContactOwner, recomputeLastContact } from "@/lib/actions/social-shared";

/** Verify a draft belongs to the user, returning it. Throws if not found. */
async function ownedDraft(userId: string, id: string) {
    const draft = await db.outreachDraft.findFirst({ where: { id, userId } });
    if (!draft) throw new Error("Draft not found");
    return draft;
}

/** Parse the shared draft fields from a FormData payload. */
async function parseDraft(userId: string, formData: FormData) {
    const body = str(formData, "body");
    if (!body) throw new Error("Message body is required");
    const contactId = str(formData, "contactId");
    if (contactId) await assertContactOwner(userId, contactId);
    const dueAt = dateTime(formData, "dueAt") ?? date(formData, "dueAt");
    return { contactId, channel: str(formData, "channel"), body, dueAt };
}

export async function createDraft(formData: FormData) {
    const user = await requireUser();
    const data = await parseDraft(user.id, formData);
    await db.outreachDraft.create({ data: { ...data, userId: user.id } });
    revalidatePath("/social/drafts");
    revalidatePath("/social");
}

export async function updateDraft(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    await ownedDraft(user.id, id);
    const data = await parseDraft(user.id, formData);
    await db.outreachDraft.update({ where: { id }, data });
    revalidatePath("/social/drafts");
    revalidatePath("/social");
}

/** Mark a draft sent: stamp sentAt, log a "message" interaction, update lastContactAt. */
export async function markDraftSent(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const draft = await ownedDraft(user.id, id);
    await db.outreachDraft.update({ where: { id }, data: { sentAt: new Date() } });
    if (draft.contactId) {
        await db.socialInteraction.create({
            data: {
                contactId: draft.contactId,
                interactionType: "MESSAGE",
                date: new Date(),
                notes: draft.body,
            },
        });
        await recomputeLastContact(draft.contactId);
        revalidatePath(`/social/contacts/${draft.contactId}`);
    }
    revalidatePath("/social/drafts");
    revalidatePath("/social");
}

export async function archiveDraft(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const draft = await ownedDraft(user.id, id);
    await db.outreachDraft.update({ where: { id }, data: { archived: !draft.archived } });
    revalidatePath("/social/drafts");
    revalidatePath("/social");
}

export async function deleteDraft(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    await ownedDraft(user.id, id);
    await db.outreachDraft.delete({ where: { id } });
    revalidatePath("/social/drafts");
    revalidatePath("/social");
}
