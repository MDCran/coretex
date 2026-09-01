"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteWeightCounterpart, syncMetricWeightToMeasurement } from "@/lib/body-bridge";
import { num, parseDateTime, str } from "./health-shared";

export async function createBodyMetric(fd: FormData) {
    const user = await requireUser();
    const value = num(fd, "value");
    if (value === null) throw new Error("Value is required");
    const metricType = str(fd, "metricType") ?? "weight";
    const measuredAt = parseDateTime(str(fd, "measuredAt"));
    // value arrives already converted to metric (kg) by the client form.
    await db.bodyMetric.create({
        data: {
            userId: user.id,
            metricType,
            customName: str(fd, "customName"),
            value,
            unit: str(fd, "unit"),
            measuredAt,
            notes: str(fd, "notes"),
        },
    });
    // Bridge: mirror a weight metric into the workouts BodyMeasurement (see lib/body-bridge.ts).
    if (metricType === "weight") await syncMetricWeightToMeasurement(user.id, measuredAt, value);
    revalidatePath("/health/metrics");
    revalidatePath("/health");
    revalidatePath("/workouts/body");
}

export async function updateBodyMetric(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.bodyMetric.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const value = num(fd, "value");
    if (value === null) throw new Error("Value is required");
    const metricType = str(fd, "metricType") ?? existing.metricType;
    const measuredAt = parseDateTime(str(fd, "measuredAt"));
    await db.bodyMetric.update({
        where: { id },
        data: {
            metricType,
            customName: str(fd, "customName"),
            value,
            unit: str(fd, "unit"),
            measuredAt,
            notes: str(fd, "notes"),
        },
    });
    // Bridge: keep the workouts BodyMeasurement weight in sync (see lib/body-bridge.ts).
    if (metricType === "weight") await syncMetricWeightToMeasurement(user.id, measuredAt, value);
    revalidatePath("/health/metrics");
    revalidatePath("/health");
    revalidatePath("/workouts/body");
}

export async function deleteBodyMetric(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    // Look up the row before deleting so we can clear the same-day weight
    // counterpart (see lib/body-bridge.ts) and avoid a phantom point in the
    // workouts body weight chart, which shares the unified getWeightSeries.
    const existing = await db.bodyMetric.findFirst({ where: { id, userId: user.id }, select: { metricType: true, measuredAt: true } });
    await db.bodyMetric.deleteMany({ where: { id, userId: user.id } });
    if (existing?.metricType === "weight") {
        await deleteWeightCounterpart(user.id, existing.measuredAt, "metric");
    }
    revalidatePath("/health/metrics");
    revalidatePath("/health");
    revalidatePath("/workouts/body");
}
