"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { str } from "@/lib/actions/social-shared";

async function ownedTag(userId: string, id: string) {
    const tag = await db.socialTag.findFirst({ where: { id, userId } });
    if (!tag) throw new Error("Tag not found");
    return tag;
}

export async function createTag(formData: FormData) {
    const user = await requireUser();
    const name = str(formData, "name");
    if (!name) throw new Error("Tag name is required");
    await db.socialTag.create({ data: { userId: user.id, name, color: str(formData, "color") } });
    revalidatePath("/social/contacts");
}

/** Create a tag and return it (for inline create-as-you-type on the contact form). */
export async function createTagReturning(formData: FormData): Promise<{ id: string; name: string; color: string | null }> {
    const user = await requireUser();
    const name = str(formData, "name");
    if (!name) throw new Error("Tag name is required");
    const existing = await db.socialTag.findFirst({ where: { userId: user.id, name }, select: { id: true, name: true, color: true } });
    if (existing) return existing;
    const tag = await db.socialTag.create({ data: { userId: user.id, name, color: str(formData, "color") }, select: { id: true, name: true, color: true } });
    revalidatePath("/social/contacts");
    return tag;
}

export async function updateTag(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    await ownedTag(user.id, id);
    const name = str(formData, "name");
    if (!name) throw new Error("Tag name is required");
    await db.socialTag.update({ where: { id }, data: { name, color: str(formData, "color") } });
    revalidatePath("/social/contacts");
}

export async function deleteTag(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    await ownedTag(user.id, id);
    await db.socialTag.delete({ where: { id } });
    revalidatePath("/social/contacts");
}
