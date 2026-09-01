import type { Block, Peptide } from "@/lib/peptides/types";
import type { Occurrence } from "@/lib/peptides/schedule";
import { generateSchedule } from "@/lib/peptides/schedule";
import { computeDose, deriveCycle } from "@/lib/peptides/dosing";
import { isOccurrenceTaken } from "@/lib/peptides/admin";
import { addDays, todayISO } from "@/lib/peptides/date";

/** The last week of the cycle = max endWeek across all blocks (0 when none). */
export function maxEndWeek(p: Peptide): number {
    return p.blocks.reduce((m, b) => Math.max(m, b.endWeek), 0);
}

/** Block whose week-range covers a given (1-based) week, if any. Lower order wins on overlap. */
export function blockForWeek(p: Peptide, week: number): Block | undefined {
    const hits = p.blocks.filter((b) => week >= b.startWeek && week <= b.endWeek && b.endWeek >= b.startWeek);
    return hits[0];
}

/** Current cycle week (1-based) from cycleStartDate, or null when unscheduled. Not clamped to the cycle. */
export function currentWeek(p: Peptide): number | null {
    if (!p.cycleStartDate) return null;
    const start = new Date(p.cycleStartDate + "T12:00:00Z").getTime();
    const today = new Date(todayISO() + "T12:00:00Z").getTime();
    const diffDays = Math.floor((today - start) / 86_400_000);
    return Math.floor(diffDays / 7) + 1;
}

/** Computed end date = start + (maxEndWeek * 7 − 1) days. "" when unscheduled / empty. */
export function cycleEndDate(p: Peptide): string {
    const weeks = maxEndWeek(p);
    if (!p.cycleStartDate || weeks <= 0) return "";
    return addDays(p.cycleStartDate, weeks * 7 - 1);
}

/** ISO start date of a given (1-based) cycle week. "" when unscheduled. */
export function weekStartISO(p: Peptide, week: number): string {
    if (!p.cycleStartDate || week < 1) return "";
    return addDays(p.cycleStartDate, (week - 1) * 7);
}

/** ISO end date (inclusive) of a given (1-based) cycle week. "" when unscheduled. */
export function weekEndISO(p: Peptide, week: number): string {
    const start = weekStartISO(p, week);
    return start ? addDays(start, 6) : "";
}

export interface CycleDoseTotals {
    /** Total planned administrations across the whole cycle. */
    total: number;
    /** Planned administrations already taken (logged) anywhere in the cycle. */
    taken: number;
    /** Past scheduled doses that were never logged. */
    missed: number;
    /** Untaken planned administrations from today through cycle end. */
    left: number;
}

/**
 * Whole-cycle dose accounting used by the detail header + hero cards. `left`
 * counts only future (today-onward) untaken occurrences so it immediately drops
 * when today's dose is logged, and rises again when it is un-logged.
 */
export function cycleDoseTotals(p: Peptide): CycleDoseTotals {
    const today = todayISO();
    const schedule = generateSchedule(p);
    let taken = 0;
    let missed = 0;
    let left = 0;
    for (const o of schedule) {
        const isTaken = isOccurrenceTaken(p, o);
        if (isTaken) taken++;
        else if (o.date < today) missed++;
        else left++;
    }
    return { total: schedule.length, taken, missed, left };
}

export interface WeekCell {
    /** 1-based cycle week number. */
    week: number;
    block?: Block;
    /** Index of the block in plan order (for color intensity + scroll target). */
    blockIndex: number;
    /** Dose per administration for this week (block.dosePerAdmin), 0 when off. */
    dose: number;
    /** Administrations planned this week. */
    plannedDoses: number;
    /** Administrations taken this week. */
    takenDoses: number;
    /** Whether this week has no covering block. */
    off: boolean;
    isCurrent: boolean;
    isPast: boolean;
    isFuture: boolean;
}

/** Build a per-week breakdown of the entire cycle, week 1 → maxEndWeek. */
export function weekCells(p: Peptide): WeekCell[] {
    const total = maxEndWeek(p);
    if (total <= 0) return [];

    const schedule = generateSchedule(p);
    const planned = new Map<number, number>();
    const taken = new Map<number, number>();
    for (const o of schedule) {
        planned.set(o.weekNumber, (planned.get(o.weekNumber) ?? 0) + 1);
        if (isOccurrenceTaken(p, o)) taken.set(o.weekNumber, (taken.get(o.weekNumber) ?? 0) + 1);
    }

    const cur = currentWeek(p);
    const cells: WeekCell[] = [];
    for (let week = 1; week <= total; week++) {
        const block = blockForWeek(p, week);
        const blockIndex = block ? p.blocks.findIndex((b) => b.id === block.id) : -1;
        cells.push({
            week,
            block,
            blockIndex,
            dose: block?.dosePerAdmin ?? 0,
            plannedDoses: planned.get(week) ?? 0,
            takenDoses: taken.get(week) ?? 0,
            off: !block,
            isCurrent: cur === week,
            isPast: cur != null && week < cur,
            isFuture: cur != null && week > cur,
        });
    }
    return cells;
}

export interface DosesLeft {
    /** Planned administrations from today through the cycle end. */
    planned: number;
    /** Administrations coverable by remaining supply (active vial + dry vials). */
    coverable: number;
    /** ml each remaining administration consumes (weighted by the future plan). */
    upcomingMl: number;
}

/**
 * Doses remaining in the plan from today, and doses the remaining supply can cover.
 * Mirrors the supply snapshot's accounting but exposed for the timeline header.
 */
export function dosesLeft(p: Peptide, snap: { remainingMl: number }): DosesLeft {
    const today = todayISO();
    const future = generateSchedule(p).filter((o) => o.date >= today && !isOccurrenceTaken(p, o));
    const upcomingMl = future.reduce((sum, o) => sum + o.mlPerAdmin, 0);

    let acc = snap.remainingMl;
    let coverable = 0;
    for (const o of future) {
        if (acc + 1e-9 >= o.mlPerAdmin) {
            acc -= o.mlPerAdmin;
            coverable++;
        } else break;
    }
    return { planned: future.length, coverable, upcomingMl };
}

/** Syringe units per administration for a block (0 when not reconstituted). */
export function unitsForBlock(p: Peptide, b: Block): number {
    return computeDose({
        vialMg: p.vialMg,
        waterMl: p.waterMl,
        syringeUnitsPerMl: p.syringeUnitsPerMl,
        dose: b.dosePerAdmin,
        unit: p.doseUnit,
    }).unitsPerDose;
}

/** Re-export for convenience so callers don't import dosing twice. */
export { deriveCycle };
