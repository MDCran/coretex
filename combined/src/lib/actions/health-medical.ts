"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadUserMediaFile } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";
import { bool, int, parseOptionalDateTime, str } from "./health-shared";

async function assertOwnedMedicalRelations(userId: string, providerId: string | null, doctorId: string | null = null) {
    const [provider, doctor] = await Promise.all([
        providerId ? db.provider.findFirst({ where: { id: providerId, userId }, select: { id: true } }) : null,
        doctorId ? db.doctor.findFirst({ where: { id: doctorId, userId }, select: { id: true } }) : null,
    ]);
    if (providerId && !provider) throw new Error("Provider not found");
    if (doctorId && !doctor) throw new Error("Doctor not found");
}

// ---- Providers ----
export async function upsertProvider(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    const data = { name, address: str(fd, "address"), phone: str(fd, "phone"), website: str(fd, "website"), notes: str(fd, "notes") };
    if (id) {
        const existing = await db.provider.findFirst({ where: { id, userId: user.id } });
        if (!existing) throw new Error("Not found");
        await db.provider.update({ where: { id }, data });
    } else {
        await db.provider.create({ data: { userId: user.id, ...data } });
    }
    revalidatePath("/health/medical");
}

export async function deleteProvider(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.provider.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/health/medical");
}

// ---- Doctors ----
export async function upsertDoctor(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    const providerId = str(fd, "providerId") || null;
    await assertOwnedMedicalRelations(user.id, providerId);
    const data = {
        name,
        profession: str(fd, "profession"),
        location: str(fd, "location"),
        phone: str(fd, "phone"),
        email: str(fd, "email"),
        notes: str(fd, "notes"),
        providerId,
    };
    if (id) {
        const existing = await db.doctor.findFirst({ where: { id, userId: user.id } });
        if (!existing) throw new Error("Not found");
        await db.doctor.update({ where: { id }, data });
    } else {
        await db.doctor.create({ data: { userId: user.id, ...data } });
    }
    revalidatePath("/health/medical");
}

export async function deleteDoctor(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.doctor.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/health/medical");
}

// ---- Records ----
export async function createMedicalRecord(fd: FormData) {
    const user = await requireUser();
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    const providerId = str(fd, "providerId") || null;
    const doctorId = str(fd, "doctorId") || null;
    await assertOwnedMedicalRelations(user.id, providerId, doctorId);

    let fileData: { fileKey: string; fileName: string; fileSize: number; mimeType: string } | null = null;
    const file = fd.get("file");
    if (file instanceof File && file.size > 0) {
        fileData = await uploadUserMediaFile(user.id, "health", file);
    }

    try {
        await db.medicalRecord.create({
            data: {
                userId: user.id,
                name,
                providerId,
                doctorId,
                recordDate: parseOptionalDateTime(str(fd, "recordDate")),
                notes: str(fd, "notes"),
                fileKey: fileData?.fileKey ?? null,
                fileName: fileData?.fileName ?? null,
                mimeType: fileData?.mimeType ?? null,
                fileSize: fileData?.fileSize ?? null,
            },
        });
    } catch (error) {
        if (fileData) await deleteObject(fileData.fileKey).catch(() => {});
        throw error;
    }
    revalidatePath("/health/medical");
}

export async function updateMedicalRecord(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.medicalRecord.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");

    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    const providerId = str(fd, "providerId") || null;
    const doctorId = str(fd, "doctorId") || null;
    await assertOwnedMedicalRelations(user.id, providerId, doctorId);

    let fileData: { fileKey: string; fileName: string; fileSize: number; mimeType: string } | null = null;
    const file = fd.get("file");
    if (file instanceof File && file.size > 0) {
        fileData = await uploadUserMediaFile(user.id, "health", file);
    }

    try {
        await db.medicalRecord.update({
            where: { id },
            data: {
                name,
                providerId,
                doctorId,
                recordDate: parseOptionalDateTime(str(fd, "recordDate")),
                notes: str(fd, "notes"),
                ...(fileData
                    ? {
                          fileKey: fileData.fileKey,
                          fileName: fileData.fileName,
                          mimeType: fileData.mimeType,
                          fileSize: fileData.fileSize,
                      }
                    : {}),
            },
        });
    } catch (error) {
        if (fileData) await deleteObject(fileData.fileKey).catch(() => {});
        throw error;
    }
    if (fileData && existing.fileKey && existing.fileKey !== fileData.fileKey) {
        await deleteObject(existing.fileKey).catch(() => {});
    }
    revalidatePath("/health/medical");
}

export async function deleteMedicalRecord(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.medicalRecord.findFirst({
        where: { id, userId: user.id },
        select: { fileKey: true },
    });
    if (existing) {
        await db.medicalRecord.delete({ where: { id } });
        if (existing.fileKey) await deleteObject(existing.fileKey).catch(() => {});
    }
    revalidatePath("/health/medical");
}

export async function addExtractedItem(fd: FormData) {
    const user = await requireUser();
    const recordId = str(fd, "recordId");
    if (!recordId) throw new Error("Missing recordId");
    const record = await db.medicalRecord.findFirst({ where: { id: recordId, userId: user.id } });
    if (!record) throw new Error("Not found");
    const label = str(fd, "label");
    if (!label) throw new Error("Label is required");
    await db.medicalExtractedItem.create({
        data: { recordId, itemType: str(fd, "itemType"), label, value: str(fd, "value"), unit: str(fd, "unit") },
    });
    revalidatePath("/health/medical");
}

export async function deleteExtractedItem(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const item = await db.medicalExtractedItem.findUnique({ where: { id }, include: { record: true } });
    if (!item || item.record.userId !== user.id) throw new Error("Not found");
    await db.medicalExtractedItem.delete({ where: { id } });
    revalidatePath("/health/medical");
}
