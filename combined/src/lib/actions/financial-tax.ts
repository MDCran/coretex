"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteObject } from "@/lib/s3";
import { uploadUserMediaFile } from "@/lib/uploads";
import { int, str } from "./financial-shared";

export async function createTaxDocument(fd: FormData) {
    const user = await requireUser();
    const taxYear = int(fd, "taxYear");
    if (taxYear === null) throw new Error("Tax year is required");

    let fileKey: string | null = null;
    let fileName: string | null = str(fd, "fileName");
    const file = fd.get("file");
    if (file instanceof File && file.size > 0) {
        const uploaded = await uploadUserMediaFile(user.id, "financial", file);
        fileKey = uploaded.fileKey;
        fileName = fileName || uploaded.fileName;
    }

    try {
        await db.taxDocument.create({
            data: {
                userId: user.id,
                taxYear,
                kind: str(fd, "kind"),
                description: str(fd, "description"),
                fileKey,
                fileName,
                notes: str(fd, "notes"),
            },
        });
    } catch (error) {
        if (fileKey) await deleteObject(fileKey).catch(() => {});
        throw error;
    }
    revalidatePath("/financial/tax");
}

export async function updateTaxDocument(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.taxDocument.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const taxYear = int(fd, "taxYear");
    if (taxYear === null) throw new Error("Tax year is required");

    let fileKey = existing.fileKey;
    let uploadedFileKey: string | null = null;
    const renamed = str(fd, "fileName");
    let fileName = renamed || existing.fileName;
    const file = fd.get("file");
    if (file instanceof File && file.size > 0) {
        const uploaded = await uploadUserMediaFile(user.id, "financial", file);
        fileKey = uploaded.fileKey;
        uploadedFileKey = uploaded.fileKey;
        fileName = renamed || uploaded.fileName;
    }

    try {
        await db.taxDocument.update({
            where: { id },
            data: {
                taxYear,
                kind: str(fd, "kind"),
                description: str(fd, "description"),
                fileKey,
                fileName,
                notes: str(fd, "notes"),
            },
        });
    } catch (error) {
        if (uploadedFileKey) await deleteObject(uploadedFileKey).catch(() => {});
        throw error;
    }
    if (uploadedFileKey && existing.fileKey && existing.fileKey !== uploadedFileKey) {
        await deleteObject(existing.fileKey).catch(() => {});
    }
    revalidatePath("/financial/tax");
}

export async function deleteTaxDocument(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.taxDocument.findFirst({ where: { id, userId: user.id }, select: { fileKey: true } });
    const deleted = await db.taxDocument.deleteMany({ where: { id, userId: user.id } });
    if (deleted.count > 0 && existing?.fileKey) await deleteObject(existing.fileKey).catch(() => {});
    revalidatePath("/financial/tax");
}
