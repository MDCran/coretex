"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { int, parseDateOnly, parseOptionalDateTime, str } from "./health-shared";

interface InterruptionInput {
    time: string | null;
    durationMinutes: number | null;
    reason: string | null;
    notes: string | null;
}

function readInterruptions(fd: FormData): InterruptionInput[] {
    const raw = fd.get("interruptions");
    if (typeof raw !== "string" || !raw.trim()) return [];
    try {
        const parsed = JSON.parse(raw) as any[];
        return parsed.map((i) => ({
            time: i.time || null,
            durationMinutes: i.durationMinutes != null && i.durationMinutes !== "" ? Math.round(Number(i.durationMinutes)) : null,
            reason: i.reason?.trim() || null,
            notes: i.notes?.trim() || null,
        }));
    } catch {
        return [];
    }
}

function computeTotalMinutes(bedtime: Date | null, wakeTime: Date | null): number | null {
    if (!bedtime || !wakeTime) return null;
    let diff = (wakeTime.getTime() - bedtime.getTime()) / 60000;
    if (diff < 0) diff += 24 * 60; // crossed midnight
    return Math.round(diff);
}

export async function upsertSleepEntry(fd: FormData) {
    const user = await requireUser();
    const date = parseDateOnly(str(fd, "date"));
    const bedtime = parseOptionalDateTime(str(fd, "bedtime"));
    const wakeTime = parseOptionalDateTime(str(fd, "wakeTime"));
    const interruptions = readInterruptions(fd);

    const data = {
        date,
        bedtime,
        wakeTime,
        totalMinutes: computeTotalMinutes(bedtime, wakeTime),
        sleepQuality: int(fd, "sleepQuality"),
        feelRested: int(fd, "feelRested"),
        sleepLatencyMin: int(fd, "sleepLatencyMin"),
        restingHrBpm: int(fd, "restingHrBpm"),
        hrvMs: int(fd, "hrvMs"),
        notes: str(fd, "notes"),
    };

    const existing = await db.sleepEntry.findUnique({ where: { userId_date: { userId: user.id, date } } });
    if (existing) {
        await db.$transaction([
            db.sleepInterruption.deleteMany({ where: { entryId: existing.id } }),
            db.sleepEntry.update({
                where: { id: existing.id },
                data: { ...data, interruptions: { create: interruptions.map((i) => ({ time: i.time ? new Date(i.time) : null, durationMinutes: i.durationMinutes, reason: i.reason, notes: i.notes })) } },
            }),
        ]);
    } else {
        await db.sleepEntry.create({
            data: { userId: user.id, ...data, interruptions: { create: interruptions.map((i) => ({ time: i.time ? new Date(i.time) : null, durationMinutes: i.durationMinutes, reason: i.reason, notes: i.notes })) } },
        });
    }
    revalidatePath("/health/sleep");
    revalidatePath("/health");
}

export async function deleteSleepEntry(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.sleepEntry.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/health/sleep");
    revalidatePath("/health");
}
