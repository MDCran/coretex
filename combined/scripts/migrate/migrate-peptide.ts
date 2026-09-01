/**
 * Migrate peptide_tracker -> LifeOS Peptides module.
 *
 * Source: postgresql://peptide:peptide@localhost:5441/peptide
 * Single "Peptide" table with JSONB `blocks` and `logs` arrays. No S3.
 *
 * Mapping:
 *   Peptide scalar fields -> Peptide (cycleStartDate "" -> null, else parsed)
 *   blocks[]  -> PeptideBlock rows (order = array index; source block.id mapped)
 *   logs[]    -> PeptideLog rows   (date string -> Date; blockId remapped via
 *                the per-peptide block id map — source block ids live inside the
 *                JSON, so we record old-json-block-id -> new-PeptideBlock-id).
 *
 * See peptide_tracker/lib/types.ts for Block / LogEntry shapes.
 */

import {
    alreadyMigrated,
    CliArgs,
    IdMap,
    parseArgs,
    parseDateOnly,
    prisma,
    printCounts,
    resolveUserId,
    safeDisconnect,
    SOURCES,
    sourcePrisma,
    toDate,
    writeMarker,
} from "./shared";

const src = SOURCES.peptide;

interface JsonBlock {
    id: string;
    startWeek: number;
    endWeek: number;
    dosePerAdmin: number;
    dosesPerWeek: number;
    note?: string;
}
interface JsonLog {
    id: string;
    date: string;
    dose: number;
    units: number;
    mlUsed: number;
    site?: string;
    blockId?: string;
}
interface PeptideRow {
    id: string;
    name: string;
    vialMg: number;
    doseUnit: string;
    waterMl: number;
    syringeUnitsPerMl: number;
    vialsOwned: number;
    vialsOpened: number;
    activeVialRemainingMl: number;
    cycleStartDate: string;
    blocks: unknown;
    logs: unknown;
    position: number;
    createdAt: Date | null;
    updatedAt: Date | null;
}

function asArray<T>(v: unknown): T[] {
    if (Array.isArray(v)) return v as T[];
    if (typeof v === "string") {
        try {
            const parsed = JSON.parse(v);
            return Array.isArray(parsed) ? (parsed as T[]) : [];
        } catch {
            return [];
        }
    }
    return [];
}

export async function migratePeptide(args: CliArgs): Promise<void> {
    const userId = await resolveUserId(args.userEmail);
    if (!args.force && (await alreadyMigrated(userId, "peptide"))) {
        console.log("[peptide] already migrated (marker present) — skipping. Use --force to re-run.");
        return;
    }

    const db = sourcePrisma(src.db);
    const counts: Record<string, number> = { Peptide: 0, PeptideBlock: 0, PeptideLog: 0 };
    try {
        console.log("[peptide] connecting to source…");
        const peptides = await db.$queryRawUnsafe<PeptideRow[]>(
            `SELECT id,name,"vialMg","doseUnit","waterMl","syringeUnitsPerMl","vialsOwned","vialsOpened","activeVialRemainingMl","cycleStartDate",blocks,logs,position,"createdAt","updatedAt" FROM "Peptide" ORDER BY position ASC`,
        );

        counts.Peptide = peptides.length;
        for (const p of peptides) {
            counts.PeptideBlock += asArray<JsonBlock>(p.blocks).length;
            counts.PeptideLog += asArray<JsonLog>(p.logs).length;
        }

        if (args.dryRun) {
            printCounts("peptide DRY-RUN", counts);
            return;
        }

        for (const p of peptides) {
            const blocks = asArray<JsonBlock>(p.blocks);
            const logs = asArray<JsonLog>(p.logs);

            const createdPeptide = await prisma.peptide.create({
                data: {
                    userId,
                    name: p.name,
                    vialMg: p.vialMg,
                    doseUnit: p.doseUnit ?? "mg",
                    waterMl: p.waterMl,
                    syringeUnitsPerMl: p.syringeUnitsPerMl ?? 100,
                    vialsOwned: p.vialsOwned ?? 0,
                    vialsOpened: p.vialsOpened ?? 0,
                    activeVialRemainingMl: p.activeVialRemainingMl ?? 0,
                    // "" -> null; else YYYY-MM-DD -> Date (target is @db.Date).
                    cycleStartDate: parseDateOnly(p.cycleStartDate),
                    position: p.position ?? 0,
                    createdAt: toDate(p.createdAt) ?? undefined,
                    updatedAt: toDate(p.updatedAt) ?? undefined,
                },
            });

            // blocks -> PeptideBlock, recording json-id -> new-id for log remap.
            const blockMap = new IdMap(`peptide-block:${p.id}`);
            for (let i = 0; i < blocks.length; i++) {
                const b = blocks[i];
                const createdBlock = await prisma.peptideBlock.create({
                    data: {
                        peptideId: createdPeptide.id,
                        startWeek: Math.trunc(b.startWeek ?? 0),
                        endWeek: Math.trunc(b.endWeek ?? 0),
                        dosePerAdmin: b.dosePerAdmin ?? 0,
                        dosesPerWeek: b.dosesPerWeek ?? 0,
                        note: b.note ?? null,
                        order: i,
                    },
                });
                if (b.id) blockMap.set(b.id, createdBlock.id);
            }

            // logs -> PeptideLog (blockId remapped; unknown ids -> null).
            for (const l of logs) {
                const date = parseDateOnly(l.date);
                await prisma.peptideLog.create({
                    data: {
                        peptideId: createdPeptide.id,
                        blockId: blockMap.get(l.blockId) ?? null,
                        date: date ?? new Date(),
                        dose: l.dose ?? 0,
                        units: l.units ?? 0,
                        mlUsed: l.mlUsed ?? 0,
                        site: l.site ?? null,
                    },
                });
            }
        }

        printCounts("peptide", counts);
        await writeMarker(userId, "peptide", counts, args.dryRun);
        console.log("[peptide] done.");
    } finally {
        await safeDisconnect(db);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    migratePeptide(parseArgs())
        .then(() => prisma.$disconnect())
        .catch(async (e) => {
            console.error(e);
            await prisma.$disconnect();
            process.exit(1);
        });
}
