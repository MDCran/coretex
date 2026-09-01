"use server";

import { revalidatePath } from "next/cache";
import type { JobDocumentKind } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { uploadUserMediaFile } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";

const DOCUMENT_KINDS: JobDocumentKind[] = ["RESUME", "COVER_LETTER", "CERTIFICATION", "EDUCATION", "CAREER_OTHER"];

async function ownedDocument(userId: string, id: string) {
    const doc = await db.jobDocument.findFirst({ where: { id, userId } });
    if (!doc) throw new Error("Document not found");
    return doc;
}

export async function createDocument(formData: FormData) {
    const user = await requireUser();
    const name = String(formData.get("name") ?? "").trim();
    const kind = String(formData.get("kind") ?? "") as JobDocumentKind;
    if (!name) throw new Error("Document name is required");
    if (!DOCUMENT_KINDS.includes(kind)) throw new Error("Invalid document kind");

    const file = formData.get("file") as File | null;
    const stored = file && file.size > 0 ? await uploadUserMediaFile(user.id, "jobs", file) : null;
    try {
        await db.$transaction(async (tx) => {
            const doc = await tx.jobDocument.create({ data: { name, kind, userId: user.id } });
            if (stored) {
                await tx.jobDocumentVersion.create({ data: { documentId: doc.id, versionNumber: 1, ...stored } });
            }
        });
    } catch (error) {
        if (stored) await deleteObject(stored.fileKey).catch(() => {});
        throw error;
    }

    revalidatePath("/documents");
}

export async function addVersion(documentId: string, formData: FormData) {
    const user = await requireUser();
    await ownedDocument(user.id, documentId);
    const label = String(formData.get("label") ?? "").trim() || null;
    const file = formData.get("file") as File | null;
    if (!file || file.size === 0) throw new Error("A file is required to add a version");
    const stored = await uploadUserMediaFile(user.id, "jobs", file);

    try {
        const last = await db.jobDocumentVersion.findFirst({ where: { documentId }, orderBy: { versionNumber: "desc" } });
        const versionNumber = (last?.versionNumber ?? 0) + 1;
        await db.jobDocumentVersion.create({ data: { documentId, versionNumber, label, ...stored } });
    } catch (error) {
        await deleteObject(stored.fileKey).catch(() => {});
        throw error;
    }
    revalidatePath("/documents");
}

export async function deleteVersion(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const version = await db.jobDocumentVersion.findUnique({ where: { id }, include: { document: true } });
    if (!version || version.document.userId !== user.id) throw new Error("Not found");
    // Applications referencing this version have their FK set to null automatically.
    await db.jobDocumentVersion.delete({ where: { id } });
    await deleteObject(version.fileKey).catch(() => {});
    revalidatePath("/documents");
}

export async function deleteDocument(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    await ownedDocument(user.id, id);
    const versions = await db.jobDocumentVersion.findMany({ where: { documentId: id } });
    await db.jobDocument.delete({ where: { id } });
    await Promise.all(versions.map((v) => deleteObject(v.fileKey).catch(() => {})));
    revalidatePath("/documents");
}

export async function editDocument(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    await ownedDocument(user.id, id);
    const name = String(formData.get("name") ?? "").trim();
    const kind = String(formData.get("kind") ?? "") as JobDocumentKind;
    if (!name) throw new Error("Name is required");
    const data: { name: string; kind?: JobDocumentKind } = { name };
    if (DOCUMENT_KINDS.includes(kind)) data.kind = kind;
    await db.jobDocument.update({ where: { id }, data });
    revalidatePath("/documents");
}

export async function changeDocumentKind(id: string, kind: JobDocumentKind) {
    const user = await requireUser();
    await ownedDocument(user.id, id);
    if (!DOCUMENT_KINDS.includes(kind)) throw new Error("Invalid kind");
    await db.jobDocument.update({ where: { id }, data: { kind } });
    revalidatePath("/documents");
}

async function ownedVersion(userId: string, id: string) {
    const version = await db.jobDocumentVersion.findUnique({ where: { id }, include: { document: true } });
    if (!version || version.document.userId !== userId) throw new Error("Not found");
    return version;
}

export async function updateVersion(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    await ownedVersion(user.id, id);
    const label = String(formData.get("label") ?? "").trim() || null;
    const fileName = String(formData.get("fileName") ?? "").trim();
    if (!fileName) throw new Error("File name is required");
    await db.jobDocumentVersion.update({ where: { id }, data: { label, fileName } });
    revalidatePath("/documents");
}

/** Edit only the human-readable label of a version. */
export async function editVersionLabel(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    await ownedVersion(user.id, id);
    const label = String(formData.get("label") ?? "").trim() || null;
    await db.jobDocumentVersion.update({ where: { id }, data: { label } });
    revalidatePath("/documents");
}

/** Rename only the display/download file name. The underlying S3 key is unchanged. */
export async function renameVersionFile(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    await ownedVersion(user.id, id);
    const fileName = String(formData.get("fileName") ?? "").trim();
    if (!fileName) throw new Error("File name is required");
    await db.jobDocumentVersion.update({ where: { id }, data: { fileName } });
    revalidatePath("/documents");
}
