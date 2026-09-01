"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { uploadUserRasterImage } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";

function parseCompany(formData: FormData) {
    const str = (k: string) => {
        const v = formData.get(k);
        const s = typeof v === "string" ? v.trim() : "";
        return s === "" ? null : s;
    };
    const officeLocations = (str("officeLocations") ?? "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

    return {
        name: str("name") ?? "",
        websiteDomain: str("websiteDomain"),
        linkedinUrl: str("linkedinUrl"),
        hqLocation: str("hqLocation"),
        officeLocations,
        industry: str("industry"),
        size: str("size"),
    };
}

async function ownedCompany(userId: string, id: string) {
    const company = await db.company.findFirst({ where: { id, userId } });
    if (!company) throw new Error("Company not found");
    return company;
}

export async function createCompany(formData: FormData) {
    const user = await requireUser();
    const data = parseCompany(formData);
    if (!data.name) throw new Error("Company name is required");

    const logoFile = formData.get("logo") as File | null;
    let logoKey: string | null = null;
    if (logoFile && logoFile.size > 0) {
        const stored = await uploadUserRasterImage(user.id, "jobs", logoFile);
        logoKey = stored.fileKey;
    }

    let company: Awaited<ReturnType<typeof ownedCompany>>;
    try {
        company = await db.company.create({ data: { ...data, logoKey, userId: user.id } });
    } catch (error) {
        if (logoKey) await deleteObject(logoKey).catch(() => {});
        throw error;
    }
    revalidatePath("/career/companies");
    redirect(`/career/companies/${company.id}`);
}

export async function updateCompany(id: string, formData: FormData) {
    const user = await requireUser();
    const existing = await ownedCompany(user.id, id);
    const data = parseCompany(formData);
    if (!data.name) throw new Error("Company name is required");

    const logoFile = formData.get("logo") as File | null;
    const removeLogo = String(formData.get("removeLogo") ?? "") === "on";
    let logoKey: string | undefined;
    if (logoFile && logoFile.size > 0) {
        const stored = await uploadUserRasterImage(user.id, "jobs", logoFile);
        logoKey = stored.fileKey;
    }

    // A new upload wins; otherwise an explicit "remove" nulls the existing logo so the
    // logo falls back to the website domain (LogoKit) or a monogram.
    const logoUpdate: { logoKey?: string | null } = logoKey ? { logoKey } : removeLogo ? { logoKey: null } : {};

    try {
        await db.company.update({ where: { id }, data: { ...data, ...logoUpdate } });
    } catch (error) {
        if (logoKey) await deleteObject(logoKey).catch(() => {});
        throw error;
    }

    // Clean up the previous logo if it was replaced or removed.
    if ((logoKey || removeLogo) && existing.logoKey) await deleteObject(existing.logoKey).catch(() => {});

    revalidatePath("/career/companies");
    revalidatePath(`/career/companies/${id}`);
    redirect(`/career/companies/${id}`);
}

export async function updateCompanyNotes(id: string, formData: FormData) {
    const user = await requireUser();
    await ownedCompany(user.id, id);
    const notes = String(formData.get("notes") ?? "").trim() || null;
    await db.company.update({ where: { id }, data: { notesMarkdown: notes } });
    revalidatePath(`/career/companies/${id}`);
}

export async function deleteCompany(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const company = await ownedCompany(user.id, id);
    await db.company.delete({ where: { id } });
    if (company.logoKey) await deleteObject(company.logoKey).catch(() => {});
    revalidatePath("/career/companies");
    redirect("/career/companies");
}
