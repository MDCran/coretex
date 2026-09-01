"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ContactMethod, JobContactKind } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

function str(formData: FormData, k: string) {
    const v = formData.get(k);
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
}

function parseContact(formData: FormData) {
    const name = str(formData, "name");
    if (!name) throw new Error("Name is required");
    return {
        name,
        companyId: str(formData, "companyId"),
        role: str(formData, "role"),
        kind: str(formData, "kind") as JobContactKind | null,
        preferredContactMethod: str(formData, "preferredContactMethod") as ContactMethod | null,
        email: str(formData, "email"),
        phone: str(formData, "phone"),
        linkedinUrl: str(formData, "linkedinUrl"),
        discord: str(formData, "discord"),
        pronouns: str(formData, "pronouns"),
        location: str(formData, "location"),
        timezone: str(formData, "timezone"),
        notesMarkdown: str(formData, "notesMarkdown"),
    };
}

async function ownedContact(userId: string, id: string) {
    const contact = await db.jobContact.findFirst({ where: { id, userId } });
    if (!contact) throw new Error("Contact not found");
    return contact;
}

export async function createContact(formData: FormData) {
    const user = await requireUser();
    const data = parseContact(formData);
    const contact = await db.jobContact.create({ data: { ...data, userId: user.id } });
    revalidatePath("/career/contacts");
    redirect(`/career/contacts/${contact.id}`);
}

export async function updateContact(id: string, formData: FormData) {
    const user = await requireUser();
    await ownedContact(user.id, id);
    const data = parseContact(formData);
    await db.jobContact.update({ where: { id }, data });
    revalidatePath("/career/contacts");
    revalidatePath(`/career/contacts/${id}`);
    redirect(`/career/contacts/${id}`);
}

export async function updateContactNotes(id: string, formData: FormData) {
    const user = await requireUser();
    await ownedContact(user.id, id);
    await db.jobContact.update({ where: { id }, data: { notesMarkdown: str(formData, "notes") } });
    revalidatePath(`/career/contacts/${id}`);
}

export async function deleteContact(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    await ownedContact(user.id, id);
    await db.jobContact.delete({ where: { id } });
    revalidatePath("/career/contacts");
    redirect("/career/contacts");
}

export async function addInteraction(contactId: string, formData: FormData) {
    const user = await requireUser();
    const contact = await ownedContact(user.id, contactId);
    const channel = str(formData, "channel") as ContactMethod | null;
    const note = str(formData, "note");
    const dateStr = str(formData, "date");
    const date = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();

    await db.jobContactInteraction.create({ data: { contactId, channel, note, date } });

    if (!contact.lastContactedAt || date > contact.lastContactedAt) {
        await db.jobContact.update({ where: { id: contactId }, data: { lastContactedAt: date } });
    }
    revalidatePath(`/career/contacts/${contactId}`);
    revalidatePath("/career/contacts");
}

export async function deleteInteraction(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const interaction = await db.jobContactInteraction.findUnique({ where: { id }, include: { contact: true } });
    if (!interaction || interaction.contact.userId !== user.id) throw new Error("Not found");
    await db.jobContactInteraction.delete({ where: { id } });

    const latest = await db.jobContactInteraction.findFirst({
        where: { contactId: interaction.contactId },
        orderBy: { date: "desc" },
    });
    await db.jobContact.update({ where: { id: interaction.contactId }, data: { lastContactedAt: latest?.date ?? null } });
    revalidatePath(`/career/contacts/${interaction.contactId}`);
}
