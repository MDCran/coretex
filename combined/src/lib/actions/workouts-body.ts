"use server";

import { revalidatePath } from "next/cache";
import type { TrainingPhase } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateKeyToUtc } from "@/lib/workouts";
import { deleteWeightCounterpart, syncMeasurementWeightToMetric } from "@/lib/body-bridge";

function num(form: FormData, key: string): number | null {
    const v = form.get(key);
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

export async function createBodyMeasurement(form: FormData) {
    const user = await requireUser();
    const dateKey = (form.get("date") as string) || new Date().toISOString().slice(0, 10);
    const date = dateKeyToUtc(dateKey);
    // Values arrive already converted to metric (kg/cm) by the client form.
    const weightKg = num(form, "weightKg");
    await db.bodyMeasurement.create({
        data: {
            userId: user.id,
            date,
            weightKg,
            bodyFatPct: num(form, "bodyFatPct"),
            chestCm: num(form, "chestCm"),
            waistCm: num(form, "waistCm"),
            neckCm: num(form, "neckCm"),
            hipCm: num(form, "hipCm"),
            armLCm: num(form, "armLCm"),
            armRCm: num(form, "armRCm"),
            legLCm: num(form, "legLCm"),
            legRCm: num(form, "legRCm"),
            note: (form.get("note") as string) || null,
        },
    });
    // Bridge: mirror weight into health BodyMetric (see lib/body-bridge.ts).
    await syncMeasurementWeightToMetric(user.id, date, weightKg);
    revalidatePath("/workouts/body");
    revalidatePath("/health/metrics");
    revalidatePath("/health");
}

export async function updateBodyMeasurement(id: string, form: FormData) {
    const user = await requireUser();
    const existing = await db.bodyMeasurement.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const dateKey = (form.get("date") as string) || existing.date.toISOString().slice(0, 10);
    const date = dateKeyToUtc(dateKey);
    const weightKg = num(form, "weightKg");
    await db.bodyMeasurement.update({
        where: { id },
        data: {
            date,
            weightKg,
            bodyFatPct: num(form, "bodyFatPct"),
            chestCm: num(form, "chestCm"),
            waistCm: num(form, "waistCm"),
            neckCm: num(form, "neckCm"),
            hipCm: num(form, "hipCm"),
            armLCm: num(form, "armLCm"),
            armRCm: num(form, "armRCm"),
            legLCm: num(form, "legLCm"),
            legRCm: num(form, "legRCm"),
            note: (form.get("note") as string) || null,
        },
    });
    await syncMeasurementWeightToMetric(user.id, date, weightKg);
    revalidatePath("/workouts/body");
    revalidatePath("/health/metrics");
    revalidatePath("/health");
}

export async function deleteBodyMeasurement(id: string) {
    const user = await requireUser();
    const existing = await db.bodyMeasurement.findFirst({ where: { id, userId: user.id }, select: { id: true, date: true, weightKg: true } });
    if (!existing) throw new Error("Not found");
    await db.bodyMeasurement.delete({ where: { id } });
    // If this measurement carried a weight, also remove the same-day "weight"
    // BodyMetric counterpart so the health metrics weight chart doesn't keep a
    // phantom point (both charts share the unified getWeightSeries — see
    // lib/body-bridge.ts).
    if (existing.weightKg != null) {
        await deleteWeightCounterpart(user.id, existing.date, "measurement");
    }
    revalidatePath("/workouts/body");
    revalidatePath("/health/metrics");
    revalidatePath("/health");
}

export async function createTrainingCycle(form: FormData) {
    const user = await requireUser();
    const phase = (form.get("phase") as TrainingPhase) || "MAINTAIN";
    const startKey = (form.get("startDate") as string) || new Date().toISOString().slice(0, 10);
    const endKey = (form.get("endDate") as string) || "";
    await db.trainingCycle.create({
        data: {
            userId: user.id,
            phase,
            startDate: dateKeyToUtc(startKey),
            endDate: endKey ? dateKeyToUtc(endKey) : null,
            note: (form.get("note") as string) || null,
        },
    });
    revalidatePath("/workouts/body");
    revalidatePath("/workouts");
}

export async function updateTrainingCycle(id: string, form: FormData) {
    const user = await requireUser();
    const existing = await db.trainingCycle.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Not found");
    const phase = (form.get("phase") as TrainingPhase) || "MAINTAIN";
    const startKey = (form.get("startDate") as string) || new Date().toISOString().slice(0, 10);
    const endKey = (form.get("endDate") as string) || "";
    await db.trainingCycle.update({
        where: { id },
        data: {
            phase,
            startDate: dateKeyToUtc(startKey),
            endDate: endKey ? dateKeyToUtc(endKey) : null,
            note: (form.get("note") as string) || null,
        },
    });
    revalidatePath("/workouts/body");
    revalidatePath("/workouts");
}

export async function deleteTrainingCycle(id: string) {
    const user = await requireUser();
    const existing = await db.trainingCycle.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Not found");
    await db.trainingCycle.delete({ where: { id } });
    revalidatePath("/workouts/body");
    revalidatePath("/workouts");
}
