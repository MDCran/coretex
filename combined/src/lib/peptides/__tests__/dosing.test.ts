import { describe, it, expect } from "vitest";
import { doseToMg, mgToUnit, concentrationMgPerMl, mlPerDose, unitsPerDose, computeDose, deriveBlock, deriveCycle } from "../dosing";
import type { Peptide } from "../types";

describe("unit conversion", () => {
    it("mcg -> mg", () => {
        expect(doseToMg(30, "mcg")).toBe(0.03);
        expect(doseToMg(2000, "mcg")).toBe(2);
    });
    it("mg -> mg (identity)", () => {
        expect(doseToMg(2, "mg")).toBe(2);
    });
    it("mg -> display unit", () => {
        expect(mgToUnit(2.45, "mcg")).toBeCloseTo(2450);
        expect(mgToUnit(28, "mg")).toBe(28);
    });
});

describe("concentration", () => {
    it("vial_mg / water_ml", () => {
        expect(concentrationMgPerMl(10, 2)).toBe(5); // 5 mg/ml
        expect(concentrationMgPerMl(1, 1)).toBe(1); // 1 mg/ml = 1000 mcg/ml
    });
    it("handles waterMl = 0 without dividing by zero", () => {
        expect(concentrationMgPerMl(10, 0)).toBe(0);
    });
});

describe("worked example: Retatrutide (mg, U-100)", () => {
    // 10 mg vial, 2 ml water -> 5 mg/ml. Dose 2 mg -> 0.4 ml -> 40 units.
    const r = computeDose({ vialMg: 10, waterMl: 2, syringeUnitsPerMl: 100, dose: 2, unit: "mg" });
    it("5 mg/ml", () => expect(r.mgPerMl).toBe(5));
    it("0.4 ml per dose", () => expect(r.mlPerDose).toBeCloseTo(0.4));
    it("40 units per dose", () => expect(r.unitsPerDose).toBeCloseTo(40));
});

describe("worked example: IGF1-LR3 (mcg, U-100)", () => {
    // 1 mg vial, 1 ml water -> 1000 mcg/ml. Dose 30 mcg -> 0.03 ml -> 3 units.
    const r = computeDose({ vialMg: 1, waterMl: 1, syringeUnitsPerMl: 100, dose: 30, unit: "mcg" });
    it("1 mg/ml (= 1000 mcg/ml)", () => expect(r.mgPerMl).toBe(1));
    it("0.03 ml per dose", () => expect(r.mlPerDose).toBeCloseTo(0.03));
    it("3 units per dose", () => expect(r.unitsPerDose).toBeCloseTo(3));
});

describe("syringe scale changes unit count", () => {
    it("U-100 -> 40 units", () => {
        expect(unitsPerDose(mlPerDose(2, 5), 100)).toBeCloseTo(40);
    });
    it("U-40 -> 16 units", () => {
        expect(unitsPerDose(mlPerDose(2, 5), 40)).toBeCloseTo(16);
    });
    it("U-50 -> 20 units", () => {
        expect(unitsPerDose(mlPerDose(2, 5), 50)).toBeCloseTo(20);
    });
    it("IGF1 30 mcg on U-40 -> 1.2 units", () => {
        const r = computeDose({ vialMg: 1, waterMl: 1, syringeUnitsPerMl: 40, dose: 30, unit: "mcg" });
        expect(r.unitsPerDose).toBeCloseTo(1.2);
    });
});

const baseReta: Peptide = {
    id: "reta",
    name: "Retatrutide",
    vialMg: 10,
    doseUnit: "mg",
    waterMl: 2,
    syringeUnitsPerMl: 100,
    vialsOwned: 3,
    vialsOpened: 1,
    activeVialRemainingMl: 2,
    cycleStartDate: "2026-06-01",
    position: 0,
    logs: [],
    blocks: [
        // 7 weeks, 2x/week, 2 mg each => 14 admins => 28 mg total.
        { id: "b1", startWeek: 1, endWeek: 7, dosePerAdmin: 2, dosesPerWeek: 2 },
    ],
};

const baseIgf: Peptide = {
    id: "igf",
    name: "IGF1-LR3",
    vialMg: 1,
    doseUnit: "mcg",
    waterMl: 1,
    syringeUnitsPerMl: 100,
    vialsOwned: 3,
    vialsOpened: 1,
    activeVialRemainingMl: 1,
    cycleStartDate: "2026-06-01",
    position: 1,
    logs: [],
    blocks: [
        // 10 weeks daily at 35 mcg => 70 admins => 2450 mcg = 2.45 mg total.
        { id: "b1", startWeek: 1, endWeek: 10, dosePerAdmin: 35, dosesPerWeek: 7 },
    ],
};

describe("block derivation", () => {
    it("Reta block: 7 weeks, 14 admins, 28 mg", () => {
        const d = deriveBlock(baseReta.blocks[0], baseReta);
        expect(d.weeks).toBe(7);
        expect(d.totalAdmins).toBe(14);
        expect(d.unitsPerAdmin).toBeCloseTo(40);
        expect(d.totalDoseMg).toBeCloseTo(28);
    });
    it("clamps weeks to 0 when endWeek < startWeek", () => {
        const d = deriveBlock({ id: "x", startWeek: 5, endWeek: 2, dosePerAdmin: 2, dosesPerWeek: 7 }, baseReta);
        expect(d.weeks).toBe(0);
        expect(d.totalAdmins).toBe(0);
        expect(d.totalDoseMg).toBe(0);
    });
});

describe("cycle summary", () => {
    it("Reta: 28 of 30 mg, 3 vials, within budget", () => {
        const s = deriveCycle(baseReta);
        expect(s.cycleTotalMg).toBeCloseTo(28);
        expect(s.availableMg).toBe(30);
        expect(s.vialsNeeded).toBe(3);
        expect(s.overBudget).toBe(false);
        expect(s.shortfallMg).toBe(0);
    });
    it("IGF1: 2450 of 3000 mcg, 3 vials", () => {
        const s = deriveCycle(baseIgf);
        expect(mgToUnit(s.cycleTotalMg, "mcg")).toBeCloseTo(2450);
        expect(mgToUnit(s.availableMg, "mcg")).toBeCloseTo(3000);
        expect(s.vialsNeeded).toBe(3);
        expect(s.overBudget).toBe(false);
    });
    it("flags over-budget cycles red", () => {
        const greedy = { ...baseReta, vialsOwned: 2 }; // 20 mg available < 28 mg
        const s = deriveCycle(greedy);
        expect(s.overBudget).toBe(true);
        expect(s.shortfallMg).toBeCloseTo(8);
    });
});
