import type { LogEntry, Peptide } from "./types";
import type { Occurrence } from "./schedule";

export const SITES = ["L abdomen", "R abdomen", "L thigh", "R thigh", "L delt", "R delt", "L glute", "R glute"];

/** Suggest the next rotation site after the most recent log entry. */
export function nextSite(logs: LogEntry[]): string {
    const last = logs[logs.length - 1]?.site;
    const i = last ? SITES.indexOf(last) : -1;
    return SITES[(i + 1) % SITES.length];
}

export function dryVialsRemaining(p: Peptide): number {
    return Math.max(0, p.vialsOwned - p.vialsOpened);
}

/** Find a log entry that fulfils a scheduled occurrence (same date + block). */
function matchLog(p: Peptide, occ: Occurrence): LogEntry | undefined {
    return p.logs.find((l) => l.date === occ.date && (l.blockId === occ.blockId || (!l.blockId && l.dose === occ.dose)));
}

export function isOccurrenceTaken(p: Peptide, occ: Occurrence): boolean {
    return matchLog(p, occ) !== undefined;
}

/**
 * Toggle a scheduled dose as taken / not taken. Marking logs the dose and
 * decrements the active vial — auto-opening a fresh dry vial first when the
 * current one can't cover the draw. Returns the peptide fields to patch.
 */
export function toggleOccurrence(p: Peptide, occ: Occurrence): Partial<Peptide> {
    const existing = matchLog(p, occ);

    if (existing) {
        // Un-mark: drop the log and restore its volume (capped at a full vial).
        return {
            logs: p.logs.filter((l) => l.id !== existing.id),
            activeVialRemainingMl: Math.min(p.waterMl, p.activeVialRemainingMl + existing.mlUsed),
        };
    }

    // Mark taken.
    let remaining = p.activeVialRemainingMl;
    let opened = p.vialsOpened;
    // Open a fresh vial on demand if the current one can't cover this dose.
    if (remaining < occ.mlPerAdmin && dryVialsRemaining(p) > 0) {
        opened += 1;
        remaining = p.waterMl;
    }
    const entry: LogEntry = {
        id: crypto.randomUUID(),
        date: occ.date,
        dose: occ.dose,
        units: Number(occ.units.toFixed(2)),
        mlUsed: Number(occ.mlPerAdmin.toFixed(4)),
        site: nextSite(p.logs),
        blockId: occ.blockId,
    };
    return {
        logs: [...p.logs, entry],
        vialsOpened: opened,
        activeVialRemainingMl: Math.max(0, remaining - occ.mlPerAdmin),
    };
}
