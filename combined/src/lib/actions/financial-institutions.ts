"use server";

import { revalidatePath } from "next/cache";
import type { Institution } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadUserRasterImage } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";
import { str } from "./financial-shared";

/**
 * Read parallel array rows from FormData. Each row is sent as
 * `${prefix}[i].${field}`; we collect until no `${prefix}[i].${primaryField}` exists.
 */
function readRows(fd: FormData, prefix: string, fields: string[], primaryField: string): Record<string, string | null>[] {
    const rows: Record<string, string | null>[] = [];
    for (let i = 0; ; i++) {
        const probe = fd.get(`${prefix}[${i}].${primaryField}`);
        if (probe === null) break;
        const row: Record<string, string | null> = {};
        for (const f of fields) {
            const v = fd.get(`${prefix}[${i}].${f}`);
            row[f] = typeof v === "string" && v.trim() ? v.trim() : null;
        }
        rows.push(row);
    }
    return rows;
}

function institutionDataFromForm(fd: FormData) {
    const name = str(fd, "name");
    if (!name) throw new Error("Institution name is required");
    const phones = readRows(fd, "phones", ["label", "phone"], "phone").filter((r) => r.phone);
    const emails = readRows(fd, "emails", ["label", "email"], "email").filter((r) => r.email);
    const people = readRows(fd, "people", ["name", "role", "phone", "email", "notes"], "name").filter((r) => r.name);
    return {
        name,
        website: str(fd, "website"),
        notes: str(fd, "notes"),
        phones,
        emails,
        people,
    };
}

export async function createInstitution(fd: FormData) {
    const user = await requireUser();
    const data = institutionDataFromForm(fd);

    const existing = await db.institution.findFirst({ where: { userId: user.id, name: data.name } });
    if (existing) throw new Error("An institution with that name already exists");

    // Optional logo upload
    const logoFile = fd.get("logo");
    let logoKey: string | null = null;
    if (logoFile instanceof File && logoFile.size > 0) {
        const stored = await uploadUserRasterImage(user.id, "financial", logoFile);
        logoKey = stored.fileKey;
    }

    let created: Institution;
    try {
        created = await db.institution.create({
            data: {
                userId: user.id,
                name: data.name,
                website: data.website,
                notes: data.notes,
                logoKey,
                phones: { create: data.phones.map((p) => ({ label: p.label ?? "Phone", phone: p.phone! })) },
                emails: { create: data.emails.map((e) => ({ label: e.label ?? "Email", email: e.email! })) },
                people: {
                    create: data.people.map((p) => ({ name: p.name!, role: p.role, phone: p.phone, email: p.email, notes: p.notes })),
                },
            },
        });
    } catch (error) {
        if (logoKey) await deleteObject(logoKey).catch(() => {});
        throw error;
    }
    revalidatePath("/financial/institutions");
    revalidatePath("/financial/accounts");
    revalidatePath("/financial/cards");
    return { id: created.id, name: created.name };
}

export async function updateInstitution(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const owned = await db.institution.findFirst({ where: { id, userId: user.id } });
    if (!owned) throw new Error("Not found");
    const data = institutionDataFromForm(fd);

    const dup = await db.institution.findFirst({ where: { userId: user.id, name: data.name, id: { not: id } } });
    if (dup) throw new Error("An institution with that name already exists");

    // Optional logo upload
    let logoKey = owned.logoKey ?? null;
    let uploadedLogoKey: string | null = null;
    const logoFile = fd.get("logo");
    if (logoFile instanceof File && logoFile.size > 0) {
        const stored = await uploadUserRasterImage(user.id, "financial", logoFile);
        logoKey = stored.fileKey;
        uploadedLogoKey = stored.fileKey;
    }

    // Replace nested rows wholesale (simplest correct approach for small lists).
    try {
        await db.$transaction([
            db.institutionPhone.deleteMany({ where: { institutionId: id } }),
            db.institutionEmail.deleteMany({ where: { institutionId: id } }),
            db.institutionContact.deleteMany({ where: { institutionId: id } }),
            db.institution.update({
                where: { id },
                data: {
                    name: data.name,
                    website: data.website,
                    notes: data.notes,
                    logoKey,
                    phones: { create: data.phones.map((p) => ({ label: p.label ?? "Phone", phone: p.phone! })) },
                    emails: { create: data.emails.map((e) => ({ label: e.label ?? "Email", email: e.email! })) },
                    people: { create: data.people.map((p) => ({ name: p.name!, role: p.role, phone: p.phone, email: p.email, notes: p.notes })) },
                },
            }),
        ]);
    } catch (error) {
        if (uploadedLogoKey) await deleteObject(uploadedLogoKey).catch(() => {});
        throw error;
    }
    if (uploadedLogoKey && owned.logoKey) await deleteObject(owned.logoKey).catch(() => {});
    revalidatePath("/financial/institutions");
    revalidatePath("/financial/accounts");
    revalidatePath("/financial/cards");
}

export async function deleteInstitution(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const owned = await db.institution.findFirst({ where: { id, userId: user.id }, select: { id: true, logoKey: true } });
    if (!owned) return;
    await db.institution.delete({ where: { id: owned.id } });
    if (owned.logoKey) await deleteObject(owned.logoKey).catch(() => {});
    revalidatePath("/financial/institutions");
    revalidatePath("/financial/accounts");
    revalidatePath("/financial/cards");
}

/** Quick-create used by inline "New institution" in the account/card forms. */
export async function quickCreateInstitution(name: string, website?: string): Promise<{ id: string; name: string }> {
    const user = await requireUser();
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Institution name is required");
    const existing = await db.institution.findFirst({ where: { userId: user.id, name: trimmed } });
    if (existing) return { id: existing.id, name: existing.name };
    const created = await db.institution.create({
        data: { userId: user.id, name: trimmed, website: website?.trim() || null },
    });
    revalidatePath("/financial/institutions");
    revalidatePath("/financial/accounts");
    revalidatePath("/financial/cards");
    return { id: created.id, name: created.name };
}
