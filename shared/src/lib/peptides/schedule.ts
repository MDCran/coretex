import type { DoseUnit, Peptide } from "./types";
import { computeDose } from "./dosing";
import { addDays } from "./date";

export interface Occurrence {
    date: string; // YYYY-MM-DD
    blockId: string;
    /** Cycle week number this dose falls in (block.startWeek-based). */
    weekNumber: number;
    dose: number; // in the peptide's doseUnit
    unit: DoseUnit;
    units: number; // syringe units
    mlPerAdmin: number;
    /** Timing note carried from the block, e.g. "morning". */
    note?: string;
}

const EOD = 3.5;

/**
 * Day-of-week offsets (0..6 within a cycle week) for a given doses-per-week count.
 * Spreads doses roughly evenly across the week. EOD is handled separately.
 */
export function weekdayOffsets(dosesPerWeek: number): number[] {
    const n = Math.floor(dosesPerWeek);
    if (n <= 0) return [];
    if (n >= 7) return [0, 1, 2, 3, 4, 5, 6];
    const offsets: number[] = [];
    for (let i = 0; i < n; i++) {
        const o = Math.round((i * 7) / n);
        if (o < 7 && !offsets.includes(o)) offsets.push(o);
    }
    return offsets;
}

/**
 * Expand a peptide's cycle blocks into concrete dated administrations, anchored
 * to peptide.cycleStartDate (week 1, day 1). Returns [] when no start date is set.
 */
export function generateSchedule(peptide: Peptide): Occurrence[] {
    if (!peptide.cycleStartDate) return [];
    const out: Occurrence[] = [];

    for (const b of peptide.blocks) {
        const weeks = Math.max(0, b.endWeek - b.startWeek + 1);
        if (weeks <= 0 || b.dosesPerWeek <= 0) continue;

        const blockStartDay = (b.startWeek - 1) * 7;
        const { unitsPerDose, mlPerDose } = computeDose({
            vialMg: peptide.vialMg,
            waterMl: peptide.waterMl,
            syringeUnitsPerMl: peptide.syringeUnitsPerMl,
            dose: b.dosePerAdmin,
            unit: peptide.doseUnit,
        });

        const push = (dayInBlock: number) => {
            out.push({
                date: addDays(peptide.cycleStartDate, blockStartDay + dayInBlock),
                blockId: b.id,
                weekNumber: b.startWeek + Math.floor(dayInBlock / 7),
                dose: b.dosePerAdmin,
                unit: peptide.doseUnit,
                units: unitsPerDose,
                mlPerAdmin: mlPerDose,
                note: b.note,
            });
        };

        const totalDays = weeks * 7;
        if (b.dosesPerWeek === EOD) {
            for (let d = 0; d < totalDays; d += 2) push(d);
        } else {
            const offsets = weekdayOffsets(b.dosesPerWeek);
            for (let w = 0; w < weeks; w++) {
                for (const off of offsets) push(w * 7 + off);
            }
        }
    }

    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Group occurrences by date for calendar rendering. */
export function scheduleByDate(occ: Occurrence[]): Map<string, Occurrence[]> {
    const map = new Map<string, Occurrence[]>();
    for (const o of occ) {
        const list = map.get(o.date);
        if (list) list.push(o);
        else map.set(o.date, [o]);
    }
    return map;
}
