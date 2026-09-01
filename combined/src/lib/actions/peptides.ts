"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import type { Block, LogEntry, Peptide } from "@/lib/peptides/types";
import { dryVialsRemaining, isOccurrenceTaken, nextSite } from "@/lib/peptides/admin";
import { generateSchedule } from "@/lib/peptides/schedule";
import { toPeptide, toPeptideScalars, isoToDate } from "@/lib/peptides/mapping";

const peptideInclude = {
    blocks: { orderBy: { order: "asc" } },
    logs: { orderBy: { date: "asc" } },
} as const;

// Peptides now live under /health/peptides; revalidate both the new and legacy
// (redirecting) paths so cached data stays fresh regardless of entry point.
function revalidateOverview(): void {
    revalidatePath("/health/peptides");
    revalidatePath("/peptides");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
}

function revalidateDetail(id: string): void {
    revalidatePath(`/health/peptides/${id}`);
    revalidatePath(`/peptides/${id}`);
    revalidateOverview();
}

/** List all of the current user's peptides as domain objects. */
export async function listPeptides(): Promise<Peptide[]> {
    const user = await requireUser();
    const rows = await db.peptide.findMany({
        where: { userId: user.id },
        orderBy: { position: "asc" },
        include: peptideInclude,
    });
    return rows.map(toPeptide);
}

/** Fetch a single peptide scoped to the current user. Returns null when not found. */
export async function getPeptide(id: string): Promise<Peptide | null> {
    const user = await requireUser();
    const row = await db.peptide.findFirst({
        where: { id, userId: user.id },
        include: peptideInclude,
    });
    return row ? toPeptide(row) : null;
}

/** Initial values accepted by the guided "Add peptide" modal. */
export interface NewPeptideInput {
    name?: string;
    vialMg?: number;
    doseUnit?: "mg" | "mcg";
    waterMl?: number;
    syringeUnitsPerMl?: number;
    vialsOwned?: number;
    cycleStartDate?: string;
}

/** Create a new peptide (optionally seeded by the guided modal) and return it. */
export async function createPeptide(input: string | NewPeptideInput = "New peptide"): Promise<Peptide> {
    const user = await requireUser();
    const seed: NewPeptideInput = typeof input === "string" ? { name: input } : input;
    const count = await db.peptide.count({ where: { userId: user.id } });
    const row = await db.peptide.create({
        data: {
            userId: user.id,
            name: seed.name?.trim() || "New peptide",
            vialMg: seed.vialMg ?? 10,
            doseUnit: seed.doseUnit ?? "mg",
            waterMl: seed.waterMl ?? 2,
            syringeUnitsPerMl: seed.syringeUnitsPerMl ?? 100,
            vialsOwned: seed.vialsOwned ?? 1,
            vialsOpened: 0,
            activeVialRemainingMl: 0,
            cycleStartDate: isoToDate(seed.cycleStartDate),
            position: count,
        },
        include: peptideInclude,
    });
    revalidateOverview();
    return toPeptide(row);
}

/** Patch a peptide's scalar fields (reconstitution, supply, cycle start, etc.). */
export async function updatePeptide(id: string, patch: Partial<Peptide>): Promise<void> {
    const user = await requireUser();
    const owned = await db.peptide.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!owned) return;
    await db.peptide.update({ where: { id }, data: toPeptideScalars(patch) });
    revalidateDetail(id);
}

export async function deletePeptide(id: string): Promise<void> {
    const user = await requireUser();
    await db.peptide.deleteMany({ where: { id, userId: user.id } });
    revalidateOverview();
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

async function assertOwned(peptideId: string): Promise<boolean> {
    const user = await requireUser();
    const owned = await db.peptide.findFirst({ where: { id: peptideId, userId: user.id }, select: { id: true } });
    return !!owned;
}

export async function addBlock(peptideId: string): Promise<void> {
    if (!(await assertOwned(peptideId))) return;
    const count = await db.peptideBlock.count({ where: { peptideId } });
    await db.peptideBlock.create({
        data: { peptideId, startWeek: 1, endWeek: 4, dosePerAdmin: 1, dosesPerWeek: 7, order: count },
    });
    revalidateDetail(peptideId);
}

export async function updateBlock(peptideId: string, blockId: string, patch: Partial<Block>): Promise<void> {
    if (!(await assertOwned(peptideId))) return;
    await db.peptideBlock.updateMany({
        where: { id: blockId, peptideId },
        data: {
            ...(patch.startWeek !== undefined && { startWeek: patch.startWeek }),
            ...(patch.endWeek !== undefined && { endWeek: patch.endWeek }),
            ...(patch.dosePerAdmin !== undefined && { dosePerAdmin: patch.dosePerAdmin }),
            ...(patch.dosesPerWeek !== undefined && { dosesPerWeek: patch.dosesPerWeek }),
            ...(patch.note !== undefined && { note: patch.note || null }),
        },
    });
    revalidateDetail(peptideId);
}

export async function removeBlock(peptideId: string, blockId: string): Promise<void> {
    if (!(await assertOwned(peptideId))) return;
    await db.peptideBlock.deleteMany({ where: { id: blockId, peptideId } });
    revalidateDetail(peptideId);
}

/** Duplicate a block into the weeks immediately after it (for tapering). */
export async function duplicateBlock(peptideId: string, blockId: string): Promise<void> {
    if (!(await assertOwned(peptideId))) return;
    const src = await db.peptideBlock.findFirst({ where: { id: blockId, peptideId } });
    if (!src) return;
    const span = Math.max(0, src.endWeek - src.startWeek);
    const startWeek = src.endWeek + 1;
    const count = await db.peptideBlock.count({ where: { peptideId } });
    await db.peptideBlock.create({
        data: {
            peptideId,
            startWeek,
            endWeek: startWeek + span,
            dosePerAdmin: src.dosePerAdmin,
            dosesPerWeek: src.dosesPerWeek,
            note: src.note,
            order: count,
        },
    });
    revalidateDetail(peptideId);
}

/**
 * Extend or shrink a block's end week by `delta` weeks (clamped so endWeek
 * never drops below startWeek). Used by the Plan tab's quick +/− controls.
 */
export async function resizeBlock(peptideId: string, blockId: string, delta: number): Promise<void> {
    if (!(await assertOwned(peptideId))) return;
    const src = await db.peptideBlock.findFirst({ where: { id: blockId, peptideId } });
    if (!src) return;
    const endWeek = Math.max(src.startWeek, src.endWeek + delta);
    await db.peptideBlock.updateMany({ where: { id: blockId, peptideId }, data: { endWeek } });
    revalidateDetail(peptideId);
}

/**
 * Split a block at the start of `week`: the original block ends at week-1 and a
 * second block (same dose/frequency/note) covers `week`..original endWeek.
 * No-op when `week` is not strictly inside the block.
 */
export async function splitBlock(peptideId: string, blockId: string, week: number): Promise<void> {
    if (!(await assertOwned(peptideId))) return;
    const src = await db.peptideBlock.findFirst({ where: { id: blockId, peptideId } });
    if (!src) return;
    if (week <= src.startWeek || week > src.endWeek) return;
    const count = await db.peptideBlock.count({ where: { peptideId } });
    await db.$transaction([
        db.peptideBlock.updateMany({ where: { id: blockId, peptideId }, data: { endWeek: week - 1 } }),
        db.peptideBlock.create({
            data: {
                peptideId,
                startWeek: week,
                endWeek: src.endWeek,
                dosePerAdmin: src.dosePerAdmin,
                dosesPerWeek: src.dosesPerWeek,
                note: src.note,
                order: count,
            },
        }),
    ]);
    revalidateDetail(peptideId);
}

// ---------------------------------------------------------------------------
// Logs + vial supply
// ---------------------------------------------------------------------------

/**
 * Create a log entry and decrement the active vial. `activeVialRemainingMl` and
 * `vialsOpened` are computed on the client (via toggleOccurrence / log form) and
 * passed through so the normalized DB stays in sync with the domain logic.
 */
export async function addLog(
    peptideId: string,
    entry: Omit<LogEntry, "id">,
    supply: { activeVialRemainingMl: number; vialsOpened?: number },
): Promise<void> {
    if (!(await assertOwned(peptideId))) return;
    await db.$transaction([
        db.peptideLog.create({
            data: {
                peptideId,
                blockId: entry.blockId ?? null,
                date: isoToDate(entry.date)!,
                dose: entry.dose,
                units: entry.units,
                mlUsed: entry.mlUsed,
                site: entry.site || null,
            },
        }),
        db.peptide.update({
            where: { id: peptideId },
            data: {
                activeVialRemainingMl: supply.activeVialRemainingMl,
                ...(supply.vialsOpened !== undefined && { vialsOpened: supply.vialsOpened }),
            },
        }),
    ]);
    revalidateDetail(peptideId);
}

/** Delete a log entry and restore its volume to the active vial. */
export async function removeLog(peptideId: string, logId: string, restoredRemainingMl: number): Promise<void> {
    if (!(await assertOwned(peptideId))) return;
    await db.$transaction([
        db.peptideLog.deleteMany({ where: { id: logId, peptideId } }),
        db.peptide.update({ where: { id: peptideId }, data: { activeVialRemainingMl: restoredRemainingMl } }),
    ]);
    revalidateDetail(peptideId);
}

/** Open / reconstitute a new vial. */
export async function openNewVial(peptideId: string, vialsOpened: number, activeVialRemainingMl: number): Promise<void> {
    if (!(await assertOwned(peptideId))) return;
    await db.peptide.update({ where: { id: peptideId }, data: { vialsOpened, activeVialRemainingMl } });
    revalidateDetail(peptideId);
}

/** Toggle a scheduled peptide dose on a given date (calendar / dashboard actions). */
export async function togglePeptideOccurrence(peptideId: string, date: string): Promise<void> {
    const p = await getPeptide(peptideId);
    if (!p) throw new Error("Peptide not found");
    const occ = generateSchedule(p).find((o) => o.date === date);
    if (!occ) throw new Error("No dose scheduled for this date");

    if (isOccurrenceTaken(p, occ)) {
        const existing = p.logs.find(
            (l) => l.date === occ.date && (l.blockId === occ.blockId || (!l.blockId && l.dose === occ.dose)),
        );
        if (!existing) return;
        const restored = Math.min(p.waterMl, p.activeVialRemainingMl + existing.mlUsed);
        await removeLog(peptideId, existing.id, restored);
        return;
    }

    let remaining = p.activeVialRemainingMl;
    let opened = p.vialsOpened;
    let openedChanged = false;
    if (remaining < occ.mlPerAdmin && dryVialsRemaining(p) > 0) {
        opened += 1;
        remaining = p.waterMl;
        openedChanged = true;
    }
    await addLog(
        peptideId,
        {
            date: occ.date,
            dose: occ.dose,
            units: Number(occ.units.toFixed(2)),
            mlUsed: Number(occ.mlPerAdmin.toFixed(4)),
            site: nextSite(p.logs),
            blockId: occ.blockId,
        },
        {
            activeVialRemainingMl: Math.max(0, remaining - occ.mlPerAdmin),
            ...(openedChanged && { vialsOpened: opened }),
        },
    );
}
