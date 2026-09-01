"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, parseDateTime, str } from "./health-shared";

interface CustomField {
    label: string;
    unit: string | null;
    value: number;
}

function readCustomFields(fd: FormData): CustomField[] {
    const raw = fd.get("customFields");
    if (typeof raw !== "string" || !raw.trim()) return [];
    try {
        const parsed = JSON.parse(raw) as CustomField[];
        return parsed
            .filter((f) => f && typeof f.label === "string" && f.label.trim() && Number.isFinite(Number(f.value)))
            .map((f, i) => ({ label: f.label.trim(), unit: f.unit?.toString().trim() || null, value: Number(f.value), position: i }));
    } catch {
        return [];
    }
}

export async function createVital(fd: FormData) {
    const user = await requireUser();
    const vitalType = str(fd, "vitalType") ?? "heart_rate";
    const fields = readCustomFields(fd);
    await db.vitalReading.create({
        data: {
            userId: user.id,
            vitalType,
            customName: str(fd, "customName"),
            value: num(fd, "value"),
            value2: num(fd, "value2"),
            unit: str(fd, "unit"),
            measuredAt: parseDateTime(str(fd, "measuredAt")),
            notes: str(fd, "notes"),
            fields: vitalType === "custom" ? { create: fields.map((f, i) => ({ label: f.label, unit: f.unit, value: f.value, position: i })) } : undefined,
        },
    });
    revalidatePath("/health/vitals");
    revalidatePath("/health");
}

export async function updateVital(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.vitalReading.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const vitalType = str(fd, "vitalType") ?? existing.vitalType;
    const fields = readCustomFields(fd);
    await db.$transaction([
        db.vitalReadingField.deleteMany({ where: { readingId: id } }),
        db.vitalReading.update({
            where: { id },
            data: {
                vitalType,
                customName: str(fd, "customName"),
                value: num(fd, "value"),
                value2: num(fd, "value2"),
                unit: str(fd, "unit"),
                measuredAt: parseDateTime(str(fd, "measuredAt")),
                notes: str(fd, "notes"),
                fields: vitalType === "custom" ? { create: fields.map((f, i) => ({ label: f.label, unit: f.unit, value: f.value, position: i })) } : undefined,
            },
        }),
    ]);
    revalidatePath("/health/vitals");
    revalidatePath("/health");
}

export async function deleteVital(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.vitalReading.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/health/vitals");
    revalidatePath("/health");
}
