import type { Peptide } from "@/lib/peptides/types";
import type { Occurrence } from "@/lib/peptides/schedule";
import { dryVialsRemaining, isOccurrenceTaken, nextSite } from "@/lib/peptides/admin";
import type { PeptidesController } from "./use-peptides";

/**
 * Translate a calendar dose toggle into the appropriate normalized action.
 * Mirrors lib/admin.toggleOccurrence but routes through addLog / removeLog so
 * the normalized PeptideLog table stays the source of truth.
 */
export function toggleOccurrence(store: PeptidesController, peptide: Peptide, occ: Occurrence): void {
    // Find the fulfilling log (same date + block, or date + dose for manual logs).
    const existing = peptide.logs.find((l) => l.date === occ.date && (l.blockId === occ.blockId || (!l.blockId && l.dose === occ.dose)));

    if (existing) {
        const restored = Math.min(peptide.waterMl, peptide.activeVialRemainingMl + existing.mlUsed);
        store.removeLog(peptide.id, existing.id, restored);
        return;
    }

    if (isOccurrenceTaken(peptide, occ)) return;

    let remaining = peptide.activeVialRemainingMl;
    let opened = peptide.vialsOpened;
    let openedChanged = false;
    if (remaining < occ.mlPerAdmin && dryVialsRemaining(peptide) > 0) {
        opened += 1;
        remaining = peptide.waterMl;
        openedChanged = true;
    }

    store.addLog(
        peptide.id,
        {
            date: occ.date,
            dose: occ.dose,
            units: Number(occ.units.toFixed(2)),
            mlUsed: Number(occ.mlPerAdmin.toFixed(4)),
            site: nextSite(peptide.logs),
            blockId: occ.blockId,
        },
        {
            activeVialRemainingMl: Math.max(0, remaining - occ.mlPerAdmin),
            ...(openedChanged && { vialsOpened: opened }),
        },
    );
}
