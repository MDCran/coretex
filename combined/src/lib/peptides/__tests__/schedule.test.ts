import { describe, it, expect } from "vitest";
import { generateSchedule, weekdayOffsets } from "../schedule";
import { addDays } from "../date";
import type { Peptide } from "../types";

function peptide(partial: Partial<Peptide>): Peptide {
    return {
        id: "p",
        name: "Test",
        vialMg: 10,
        doseUnit: "mg",
        waterMl: 2,
        syringeUnitsPerMl: 100,
        vialsOwned: 3,
        vialsOpened: 0,
        activeVialRemainingMl: 0,
        cycleStartDate: "2026-06-01",
        position: 0,
        logs: [],
        blocks: [],
        ...partial,
    };
}

describe("weekdayOffsets", () => {
    it("daily -> every day", () => expect(weekdayOffsets(7)).toEqual([0, 1, 2, 3, 4, 5, 6]));
    it("3x -> three spread days", () => expect(weekdayOffsets(3)).toEqual([0, 2, 5]));
    it("2x -> two days", () => expect(weekdayOffsets(2)).toEqual([0, 4]));
    it("weekly -> one day", () => expect(weekdayOffsets(1)).toEqual([0]));
    it("zero -> none", () => expect(weekdayOffsets(0)).toEqual([]));
});

describe("generateSchedule", () => {
    it("returns nothing without a start date", () => {
        expect(generateSchedule(peptide({ cycleStartDate: "" }))).toEqual([]);
    });

    it("daily for 1 week => 7 dated doses starting on the start date", () => {
        const occ = generateSchedule(peptide({ blocks: [{ id: "b", startWeek: 1, endWeek: 1, dosePerAdmin: 2, dosesPerWeek: 7 }] }));
        expect(occ).toHaveLength(7);
        expect(occ[0].date).toBe("2026-06-01");
        expect(occ[6].date).toBe("2026-06-07");
        expect(occ[0].units).toBeCloseTo(40); // 2 mg @ 5 mg/ml on U-100
    });

    it("EOD for 2 weeks => 7 doses, every other day", () => {
        const occ = generateSchedule(peptide({ blocks: [{ id: "b", startWeek: 1, endWeek: 2, dosePerAdmin: 2, dosesPerWeek: 3.5 }] }));
        expect(occ).toHaveLength(7); // 14 days / 2
        expect(occ[1].date).toBe(addDays("2026-06-01", 2));
    });

    it("Reta seed block (2x, weeks 1-7) => 14 dated doses", () => {
        const occ = generateSchedule(peptide({ blocks: [{ id: "b", startWeek: 1, endWeek: 7, dosePerAdmin: 2, dosesPerWeek: 2 }] }));
        expect(occ).toHaveLength(14);
        expect(occ.every((o) => o.units > 0)).toBe(true);
    });

    it("respects block.startWeek offset", () => {
        const occ = generateSchedule(peptide({ blocks: [{ id: "b", startWeek: 3, endWeek: 3, dosePerAdmin: 2, dosesPerWeek: 1 }] }));
        expect(occ).toHaveLength(1);
        // Week 3 starts 14 days after the cycle start.
        expect(occ[0].date).toBe(addDays("2026-06-01", 14));
        expect(occ[0].weekNumber).toBe(3);
    });

    it("skips blocks with endWeek < startWeek", () => {
        const occ = generateSchedule(peptide({ blocks: [{ id: "b", startWeek: 5, endWeek: 2, dosePerAdmin: 2, dosesPerWeek: 7 }] }));
        expect(occ).toEqual([]);
    });
});
