import type { Peptide as DbPeptide, PeptideBlock as DbBlock, PeptideLog as DbLog } from "@prisma/client";
import type { Block, DoseUnit, LogEntry, Peptide, SyringeUnitsPerMl } from "./types";

/** Convert a DB Date (DateTime? @db.Date) to a YYYY-MM-DD string ("" when null). */
export function dateToISO(d: Date | null | undefined): string {
    if (!d) return "";
    return d.toISOString().slice(0, 10);
}

/** Convert a YYYY-MM-DD string to a UTC-noon Date for storage (null when empty). */
export function isoToDate(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12));
}

type DbPeptideWithRelations = DbPeptide & {
    blocks: DbBlock[];
    logs: DbLog[];
};

/** Map a Prisma row (with normalized blocks/logs) into the domain Peptide type. */
export function toPeptide(row: DbPeptideWithRelations): Peptide {
    const blocks: Block[] = [...row.blocks]
        .sort((a, b) => a.order - b.order || a.startWeek - b.startWeek)
        .map((b) => ({
            id: b.id,
            startWeek: b.startWeek,
            endWeek: b.endWeek,
            dosePerAdmin: b.dosePerAdmin,
            dosesPerWeek: b.dosesPerWeek,
            note: b.note ?? undefined,
        }));

    const logs: LogEntry[] = [...row.logs]
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map((l) => ({
            id: l.id,
            date: dateToISO(l.date),
            dose: l.dose,
            units: l.units,
            mlUsed: l.mlUsed,
            site: l.site ?? "",
            blockId: l.blockId ?? undefined,
        }));

    return {
        id: row.id,
        name: row.name,
        vialMg: row.vialMg,
        doseUnit: row.doseUnit as DoseUnit,
        waterMl: row.waterMl,
        syringeUnitsPerMl: row.syringeUnitsPerMl as SyringeUnitsPerMl,
        vialsOwned: row.vialsOwned,
        vialsOpened: row.vialsOpened,
        activeVialRemainingMl: row.activeVialRemainingMl,
        cycleStartDate: dateToISO(row.cycleStartDate),
        blocks,
        logs,
        position: row.position,
    };
}

/** Scalar (non-relation) Peptide fields for create/update. */
export function toPeptideScalars(p: Partial<Peptide>) {
    const out: Record<string, unknown> = {};
    if (p.name !== undefined) out.name = p.name;
    if (p.vialMg !== undefined) out.vialMg = p.vialMg;
    if (p.doseUnit !== undefined) out.doseUnit = p.doseUnit;
    if (p.waterMl !== undefined) out.waterMl = p.waterMl;
    if (p.syringeUnitsPerMl !== undefined) out.syringeUnitsPerMl = p.syringeUnitsPerMl;
    if (p.vialsOwned !== undefined) out.vialsOwned = p.vialsOwned;
    if (p.vialsOpened !== undefined) out.vialsOpened = p.vialsOpened;
    if (p.activeVialRemainingMl !== undefined) out.activeVialRemainingMl = p.activeVialRemainingMl;
    if (p.cycleStartDate !== undefined) out.cycleStartDate = isoToDate(p.cycleStartDate);
    if (p.position !== undefined) out.position = p.position;
    return out;
}
