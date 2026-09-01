import type { Block, DoseUnit, Peptide } from "./types";

/** 1 mg = 1000 mcg. Convert any dose value to milligrams. */
export function doseToMg(value: number, unit: DoseUnit): number {
    return unit === "mcg" ? value / 1000 : value;
}

/** Convert a value in mg to the given display unit. */
export function mgToUnit(mg: number, unit: DoseUnit): number {
    return unit === "mcg" ? mg * 1000 : mg;
}

/**
 * concentration_mg_per_ml = vial_mg / water_ml
 * Returns 0 when waterMl <= 0 (un-reconstituted / invalid).
 */
export function concentrationMgPerMl(vialMg: number, waterMl: number): number {
    if (!waterMl || waterMl <= 0) return 0;
    return vialMg / waterMl;
}

/**
 * ml_per_dose = dose_mg / concentration_mg_per_ml
 * Returns 0 when concentration is 0 to avoid division by zero.
 */
export function mlPerDose(doseMg: number, concentrationMgPerMl: number): number {
    if (!concentrationMgPerMl || concentrationMgPerMl <= 0) return 0;
    return doseMg / concentrationMgPerMl;
}

/** units_per_dose = ml_per_dose * syringe_units_per_ml (100 for U-100). */
export function unitsPerDose(mlPerDose: number, syringeUnitsPerMl: number): number {
    return mlPerDose * syringeUnitsPerMl;
}

export interface DoseResult {
    doseMg: number;
    mgPerMl: number;
    mlPerDose: number;
    unitsPerDose: number;
}

/**
 * One-shot conversion: a dose (in `unit`) into ml and syringe units, given the
 * vial reconstitution and syringe scale.
 */
export function computeDose(params: {
    vialMg: number;
    waterMl: number;
    syringeUnitsPerMl: number;
    dose: number;
    unit: DoseUnit;
}): DoseResult {
    const doseMg = doseToMg(params.dose, params.unit);
    const mgPerMl = concentrationMgPerMl(params.vialMg, params.waterMl);
    const ml = mlPerDose(doseMg, mgPerMl);
    const units = unitsPerDose(ml, params.syringeUnitsPerMl);
    return { doseMg, mgPerMl, mlPerDose: ml, unitsPerDose: units };
}

export interface BlockDerived {
    weeks: number;
    totalAdmins: number;
    doseMg: number;
    mlPerAdmin: number;
    unitsPerAdmin: number;
    totalDoseMg: number;
}

/**
 * Derived figures for a single cycle block. Guards against endWeek < startWeek
 * by clamping weeks to 0.
 */
export function deriveBlock(
    block: Block,
    peptide: Pick<Peptide, "vialMg" | "waterMl" | "syringeUnitsPerMl" | "doseUnit">,
): BlockDerived {
    const weeks = Math.max(0, block.endWeek - block.startWeek + 1);
    const totalAdmins = weeks * block.dosesPerWeek;
    const {
        doseMg,
        mlPerDose: mlPerAdmin,
        unitsPerDose: unitsPerAdmin,
    } = computeDose({
        vialMg: peptide.vialMg,
        waterMl: peptide.waterMl,
        syringeUnitsPerMl: peptide.syringeUnitsPerMl,
        dose: block.dosePerAdmin,
        unit: peptide.doseUnit,
    });
    return {
        weeks,
        totalAdmins,
        doseMg,
        mlPerAdmin,
        unitsPerAdmin,
        totalDoseMg: doseMg * totalAdmins,
    };
}

export interface CycleSummary {
    cycleTotalMg: number;
    availableMg: number;
    vialsNeeded: number;
    /** mg by which the cycle exceeds what is owned (0 when within budget). */
    shortfallMg: number;
    overBudget: boolean;
}

/**
 * cycleTotalMg = sum of block totalDoseMg
 * availableMg  = vialsOwned * vialMg
 * vialsNeeded  = ceil(cycleTotalMg / vialMg)
 */
export function deriveCycle(peptide: Peptide): CycleSummary {
    const cycleTotalMg = peptide.blocks.reduce((sum, b) => sum + deriveBlock(b, peptide).totalDoseMg, 0);
    const availableMg = peptide.vialsOwned * peptide.vialMg;
    const vialsNeeded = peptide.vialMg > 0 ? Math.ceil(cycleTotalMg / peptide.vialMg) : 0;
    const shortfallMg = Math.max(0, cycleTotalMg - availableMg);
    return {
        cycleTotalMg,
        availableMg,
        vialsNeeded,
        shortfallMg,
        overBudget: cycleTotalMg > availableMg,
    };
}

/** Frequency presets for dosesPerWeek. */
export const FREQUENCY_PRESETS: { label: string; value: number }[] = [
    { label: "Daily", value: 7 },
    { label: "EOD", value: 3.5 },
    { label: "3x / week", value: 3 },
    { label: "2x / week", value: 2 },
    { label: "Weekly", value: 1 },
];
