"use server";

import { revalidatePath } from "next/cache";
import type { Prisma, SchedulePattern, TherapeuticKind } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// Medications/supplements now live under /health/medications; revalidate the new
// canonical path plus the legacy (redirecting) therapeutics paths so cached data
// stays fresh regardless of the entry point.
const PATH = "/health/medications";
const LEGACY_PATHS = ["/health/peptides/therapeutics", "/peptides/therapeutics"];

function revalidatePath2(path: string): void {
    revalidatePath(path);
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    if (path === PATH) for (const legacy of LEGACY_PATHS) revalidatePath(legacy);
}

// ---------------------------------------------------------------------------
// Medications
// ---------------------------------------------------------------------------

export interface MedSupInput {
    name: string;
    dosageAmount?: number | null;
    dosageUnit?: string | null;
    frequency?: string | null;
    notes?: string | null;
    active?: boolean;
}

export async function createMedication(input: MedSupInput) {
    const user = await requireUser();
    await db.medication.create({ data: { userId: user.id, ...buildMedSupCreate(input) } });
    revalidatePath2(PATH);
}

export async function updateMedication(id: string, input: Partial<MedSupInput>) {
    const user = await requireUser();
    await db.medication.updateMany({ where: { id, userId: user.id }, data: normalizeMedSup(input) });
    revalidatePath2(PATH);
}

export async function deleteMedication(id: string) {
    const user = await requireUser();
    await db.medication.deleteMany({ where: { id, userId: user.id } });
    revalidatePath2(PATH);
}

export async function createSupplement(input: MedSupInput) {
    const user = await requireUser();
    await db.supplement.create({ data: { userId: user.id, ...buildMedSupCreate(input) } });
    revalidatePath2(PATH);
}

export async function updateSupplement(id: string, input: Partial<MedSupInput>) {
    const user = await requireUser();
    await db.supplement.updateMany({ where: { id, userId: user.id }, data: normalizeMedSup(input) });
    revalidatePath2(PATH);
}

export async function deleteSupplement(id: string) {
    const user = await requireUser();
    await db.supplement.deleteMany({ where: { id, userId: user.id } });
    revalidatePath2(PATH);
}

function buildMedSupCreate(input: MedSupInput) {
    return {
        name: input.name,
        dosageAmount: input.dosageAmount ?? null,
        dosageUnit: input.dosageUnit || null,
        frequency: input.frequency || null,
        notes: input.notes || null,
        active: input.active ?? true,
    };
}

function normalizeMedSup(input: Partial<MedSupInput>) {
    const data: Prisma.MedicationUpdateManyMutationInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.dosageAmount !== undefined) data.dosageAmount = input.dosageAmount ?? null;
    if (input.dosageUnit !== undefined) data.dosageUnit = input.dosageUnit || null;
    if (input.frequency !== undefined) data.frequency = input.frequency || null;
    if (input.notes !== undefined) data.notes = input.notes || null;
    if (input.active !== undefined) data.active = input.active;
    return data;
}

// ---------------------------------------------------------------------------
// Therapeutic schedules
// ---------------------------------------------------------------------------

export interface ScheduleInput {
    kind: TherapeuticKind;
    name: string;
    dosage?: string | null;
    notes?: string | null;
    pattern: SchedulePattern;
    everyN?: number | null;
    daysOfWeek?: string[];
    timesOfDay?: string[];
    startDate?: string | null; // YYYY-MM-DD
    endDate?: string | null;
}

function isoToDate(iso?: string | null): Date | null {
    if (!iso) return null;
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12));
}

export async function createSchedule(input: ScheduleInput) {
    const user = await requireUser();
    await db.therapeuticSchedule.create({
        data: {
            userId: user.id,
            kind: input.kind,
            name: input.name,
            dosage: input.dosage || null,
            notes: input.notes || null,
            pattern: input.pattern,
            everyN: input.everyN ?? null,
            daysOfWeek: input.daysOfWeek ?? [],
            timesOfDay: input.timesOfDay ?? [],
            startDate: isoToDate(input.startDate),
            endDate: isoToDate(input.endDate),
        },
    });
    revalidatePath2(PATH);
}

export async function updateSchedule(id: string, input: Partial<ScheduleInput>) {
    const user = await requireUser();
    const data: Prisma.TherapeuticScheduleUpdateManyMutationInput = {};
    if (input.kind !== undefined) data.kind = input.kind;
    if (input.name !== undefined) data.name = input.name;
    if (input.dosage !== undefined) data.dosage = input.dosage || null;
    if (input.notes !== undefined) data.notes = input.notes || null;
    if (input.pattern !== undefined) data.pattern = input.pattern;
    if (input.everyN !== undefined) data.everyN = input.everyN ?? null;
    if (input.daysOfWeek !== undefined) data.daysOfWeek = input.daysOfWeek;
    if (input.timesOfDay !== undefined) data.timesOfDay = input.timesOfDay;
    if (input.startDate !== undefined) data.startDate = isoToDate(input.startDate);
    if (input.endDate !== undefined) data.endDate = isoToDate(input.endDate);
    await db.therapeuticSchedule.updateMany({ where: { id, userId: user.id }, data });
    revalidatePath2(PATH);
}

export async function deleteSchedule(id: string) {
    const user = await requireUser();
    await db.therapeuticSchedule.deleteMany({ where: { id, userId: user.id } });
    revalidatePath2(PATH);
}

// ---------------------------------------------------------------------------
// Dose materialization (next 7 days) + log/skip
// ---------------------------------------------------------------------------

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Decide whether a schedule fires on a given day (UTC). */
function firesOn(
    schedule: { pattern: SchedulePattern; everyN: number | null; daysOfWeek: string[]; startDate: Date | null },
    day: Date,
): boolean {
    const start = schedule.startDate;
    if (start && day < new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))) return false;
    switch (schedule.pattern) {
        case "DAILY":
            return true;
        case "EVERY_N_DAYS": {
            if (!schedule.everyN || schedule.everyN <= 0) return false;
            const anchor = start ?? day;
            const diffDays = Math.round((Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate())) / 86400000);
            return diffDays >= 0 && diffDays % schedule.everyN === 0;
        }
        case "WEEKLY_DOW":
            return schedule.daysOfWeek.includes(DOW[day.getUTCDay()]);
        case "WEEKLY_ONCE": {
            // Fire on the start date's weekday, or Monday if none.
            const targetDow = start ? start.getUTCDay() : 1;
            return day.getUTCDay() === targetDow;
        }
        default:
            return false;
    }
}

/**
 * Materialize TherapeuticDose rows for the next `days` days for any active
 * schedule that should fire, when a dose for that slot doesn't already exist.
 */
export async function materializeUpcomingDoses(days = 7): Promise<void> {
    const user = await requireUser();
    const schedules = await db.therapeuticSchedule.findMany({ where: { userId: user.id, archived: false } });
    if (schedules.length === 0) return;

    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + days + 1);

    const existing = await db.therapeuticDose.findMany({
        where: { userId: user.id, scheduledAt: { gte: today, lt: horizon }, scheduleId: { in: schedules.map((s) => s.id) } },
        select: { scheduleId: true, scheduledAt: true },
    });
    const seen = new Set(existing.map((e) => `${e.scheduleId}|${e.scheduledAt.toISOString()}`));

    const toCreate: Prisma.TherapeuticDoseCreateManyInput[] = [];
    for (let i = 0; i < days; i++) {
        const day = new Date(today);
        day.setUTCDate(day.getUTCDate() + i);
        for (const s of schedules) {
            if (s.endDate && day > s.endDate) continue;
            if (!firesOn(s, day)) continue;
            const times = s.timesOfDay.length > 0 ? s.timesOfDay : ["09:00"];
            for (const t of times) {
                const [hh, mm] = t.split(":").map(Number);
                const scheduledAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh || 0, mm || 0));
                const key = `${s.id}|${scheduledAt.toISOString()}`;
                if (seen.has(key)) continue;
                seen.add(key);
                toCreate.push({ userId: user.id, scheduleId: s.id, scheduledAt });
            }
        }
    }

    if (toCreate.length > 0) {
        await db.therapeuticDose.createMany({ data: toCreate });
        revalidatePath2(PATH);
    }
}

export async function logDose(doseId: string) {
    const user = await requireUser();
    await db.therapeuticDose.updateMany({ where: { id: doseId, userId: user.id }, data: { loggedAt: new Date(), skippedAt: null } });
    revalidatePath2(PATH);
}

export async function skipDose(doseId: string) {
    const user = await requireUser();
    await db.therapeuticDose.updateMany({ where: { id: doseId, userId: user.id }, data: { skippedAt: new Date(), loggedAt: null } });
    revalidatePath2(PATH);
}

export async function resetDose(doseId: string) {
    const user = await requireUser();
    await db.therapeuticDose.updateMany({ where: { id: doseId, userId: user.id }, data: { skippedAt: null, loggedAt: null } });
    revalidatePath2(PATH);
}

// ---------------------------------------------------------------------------
// Ad-hoc therapeutic logs
// ---------------------------------------------------------------------------

export interface TherapeuticLogInput {
    therapeuticKind: TherapeuticKind;
    name?: string | null;
    doseAmount?: number | null;
    doseUnit?: string | null;
    notes?: string | null;
}

export async function createTherapeuticLog(input: TherapeuticLogInput) {
    const user = await requireUser();
    await db.therapeuticLog.create({
        data: {
            userId: user.id,
            therapeuticKind: input.therapeuticKind,
            name: input.name || null,
            doseAmount: input.doseAmount ?? null,
            doseUnit: input.doseUnit || null,
            notes: input.notes || null,
        },
    });
    revalidatePath2(PATH);
}

export async function deleteTherapeuticLog(id: string) {
    const user = await requireUser();
    await db.therapeuticLog.deleteMany({ where: { id, userId: user.id } });
    revalidatePath2(PATH);
}

// ---------------------------------------------------------------------------
// Adherence (per-schedule, last N days)
// ---------------------------------------------------------------------------

export type AdherenceDayStatus = "taken" | "skipped" | "missed" | "none";

export interface AdherenceDay {
    date: string; // YYYY-MM-DD
    status: AdherenceDayStatus;
}

export interface ScheduleAdherence {
    scheduleId: string;
    /** Counts over the requested window. */
    taken: number;
    skipped: number;
    missed: number;
    /** taken / (taken + skipped + missed), 0..1. */
    rate: number;
    /** Consecutive most-recent days (ending today) where every due dose was taken. */
    streak: number;
    /** One entry per day in the window, oldest → newest, for the calendar strip. */
    days: AdherenceDay[];
}

/**
 * Compute adherence per active schedule over the last `days` days. A scheduled
 * dose is "taken" when logged, "skipped" when explicitly skipped, "missed" when
 * its slot is in the past and was neither. The streak counts back from today
 * over days that had at least one due dose and no missed/skipped ones.
 */
export async function getAdherence(days = 30): Promise<ScheduleAdherence[]> {
    const user = await requireUser();
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const since = new Date(todayUTC);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    const horizon = new Date(todayUTC);
    horizon.setUTCDate(horizon.getUTCDate() + 1); // include all of today

    const schedules = await db.therapeuticSchedule.findMany({ where: { userId: user.id, archived: false }, select: { id: true } });
    if (schedules.length === 0) return [];

    const doses = await db.therapeuticDose.findMany({
        where: { userId: user.id, scheduleId: { in: schedules.map((s) => s.id) }, scheduledAt: { gte: since, lt: horizon } },
        select: { scheduleId: true, scheduledAt: true, loggedAt: true, skippedAt: true },
        orderBy: { scheduledAt: "asc" },
    });

    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const todayIso = iso(todayUTC);

    const result: ScheduleAdherence[] = [];
    for (const s of schedules) {
        const mine = doses.filter((d) => d.scheduleId === s.id);
        // Roll up per-day status (worst-status wins: missed > skipped > taken).
        const byDay = new Map<string, AdherenceDayStatus>();
        let taken = 0;
        let skipped = 0;
        let missed = 0;
        for (const d of mine) {
            const key = iso(d.scheduledAt);
            let status: AdherenceDayStatus;
            if (d.loggedAt) {
                status = "taken";
                taken++;
            } else if (d.skippedAt) {
                status = "skipped";
                skipped++;
            } else if (d.scheduledAt < now) {
                status = "missed";
                missed++;
            } else {
                status = "none"; // upcoming today
            }
            const prev = byDay.get(key);
            const rank: Record<AdherenceDayStatus, number> = { missed: 3, skipped: 2, taken: 1, none: 0 };
            if (!prev || rank[status] > rank[prev]) byDay.set(key, status);
        }

        const dayList: AdherenceDay[] = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(todayUTC);
            d.setUTCDate(d.getUTCDate() - i);
            const key = iso(d);
            dayList.push({ date: key, status: byDay.get(key) ?? "none" });
        }

        // Streak: walk back from today over days with a "taken" status, stopping at
        // the first missed/skipped day. Days with no due dose are skipped over.
        let streak = 0;
        for (let i = dayList.length - 1; i >= 0; i--) {
            const day = dayList[i];
            if (day.status === "taken") streak++;
            else if (day.status === "missed" || day.status === "skipped") break;
            else if (day.date === todayIso) continue; // today not yet due — don't break the streak
            else continue; // no dose due that day
        }

        const total = taken + skipped + missed;
        result.push({
            scheduleId: s.id,
            taken,
            skipped,
            missed,
            rate: total > 0 ? taken / total : 0,
            streak,
            days: dayList,
        });
    }
    return result;
}
