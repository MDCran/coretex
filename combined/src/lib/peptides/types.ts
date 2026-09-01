export type DoseUnit = "mg" | "mcg";

/** Units per ml for common insulin-syringe scales. U-100 => 100 units = 1 ml. */
export type SyringeUnitsPerMl = 100 | 50 | 40;

export interface Block {
    id: string;
    startWeek: number;
    endWeek: number;
    /** Dose per administration, expressed in the peptide's doseUnit. */
    dosePerAdmin: number;
    /** Administrations per week. Presets: Daily=7, EOD=3.5, 3x=3, 2x=2, Weekly=1. */
    dosesPerWeek: number;
    /** Free-text timing note, e.g. "morning", "after workout". */
    note?: string;
}

export interface LogEntry {
    id: string;
    /** ISO date string (YYYY-MM-DD). */
    date: string;
    /** Dose administered, in the peptide's doseUnit. */
    dose: number;
    units: number;
    mlUsed: number;
    site: string;
    /** Set when the entry was created by checking off a scheduled dose. */
    blockId?: string;
}

export interface Peptide {
    id: string;
    name: string;
    vialMg: number;
    doseUnit: DoseUnit;
    waterMl: number;
    syringeUnitsPerMl: SyringeUnitsPerMl;
    /** Total vials in inventory (dry + reconstituted). */
    vialsOwned: number;
    /** How many vials have been reconstituted/opened so far. */
    vialsOpened: number;
    /** Remaining volume (ml) in the currently-open vial. */
    activeVialRemainingMl: number;
    /** Anchor date (YYYY-MM-DD) for cycle week 1, day 1. "" = not scheduled yet. */
    cycleStartDate: string;
    blocks: Block[];
    logs: LogEntry[];
    position: number;
}
