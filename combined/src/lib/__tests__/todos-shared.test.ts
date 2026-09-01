import { describe, it, expect } from "vitest";
import {
    bandForTime,
    cleanLinks,
    cleanTags,
    formatDuration,
    hhmmToMinutes,
    isValidHHMM,
    maxDayOfMonth,
    minutesToHHMM,
    summarizeCapacity,
    todoGridPlacement,
} from "../todos-shared";
import { parseNaturalTodo } from "../todos-nl";

describe("bandForTime (matches TIME_ZONES boundaries)", () => {
    it("maps 0–6 to NIGHT, not MORNING", () => {
        expect(bandForTime("05:30")).toBe("NIGHT");
        expect(bandForTime("00:00")).toBe("NIGHT");
    });
    it("maps the four daytime bands correctly", () => {
        expect(bandForTime("06:00")).toBe("MORNING");
        expect(bandForTime("11:59")).toBe("MORNING");
        expect(bandForTime("12:00")).toBe("AFTERNOON");
        expect(bandForTime("17:00")).toBe("EVENING");
        expect(bandForTime("21:00")).toBe("NIGHT");
        expect(bandForTime("23:30")).toBe("NIGHT");
    });
    it("returns null for invalid input", () => {
        expect(bandForTime("nope")).toBeNull();
        expect(bandForTime(null)).toBeNull();
    });
});

describe("HH:MM helpers", () => {
    it("validates and round-trips", () => {
        expect(isValidHHMM("9:05")).toBe(true);
        expect(isValidHHMM("24:00")).toBe(false);
        expect(hhmmToMinutes("01:30")).toBe(90);
        expect(minutesToHHMM(90)).toBe("01:30");
        expect(minutesToHHMM(2000)).toBe("23:59"); // clamped
    });
});

describe("formatDuration", () => {
    it("formats minutes/hours", () => {
        expect(formatDuration(45)).toBe("45m");
        expect(formatDuration(60)).toBe("1h");
        expect(formatDuration(90)).toBe("1h 30m");
        expect(formatDuration(0)).toBe("");
        expect(formatDuration(null)).toBe("");
    });
});

describe("maxDayOfMonth", () => {
    it("knows month lengths (Feb allows 29)", () => {
        expect(maxDayOfMonth(2)).toBe(29);
        expect(maxDayOfMonth(4)).toBe(30);
        expect(maxDayOfMonth(1)).toBe(31);
        expect(maxDayOfMonth(12)).toBe(31);
    });
});

describe("cleanTags / cleanLinks", () => {
    it("strips #, trims, de-dupes (case-insensitive)", () => {
        expect(cleanTags("#Client, client , Admin")).toEqual(["Client", "Admin"]);
        expect(cleanTags("")).toEqual([]);
    });
    it("splits links on newline/comma", () => {
        expect(cleanLinks("https://a.com\nhttps://b.com")).toEqual(["https://a.com", "https://b.com"]);
        expect(cleanLinks("")).toEqual([]);
    });
});

describe("summarizeCapacity", () => {
    it("sums non-skipped durations and flags over-capacity", () => {
        const s = summarizeCapacity(
            [
                { status: "PLANNED", durationMinutes: 120 },
                { status: "DONE", durationMinutes: 60 },
                { status: "SKIPPED", durationMinutes: 300 },
                { status: "PLANNED", durationMinutes: null },
            ],
            150,
        );
        expect(s.scheduledMinutes).toBe(180);
        expect(s.estimatedCount).toBe(2);
        expect(s.over).toBe(true);
    });
});

describe("todoGridPlacement", () => {
    it("classifies block / zone / none", () => {
        expect(todoGridPlacement({ startTime: "09:00", timeOfDay: null })).toBe("block");
        expect(todoGridPlacement({ startTime: null, timeOfDay: "MORNING" })).toBe("zone");
        expect(todoGridPlacement({ startTime: null, timeOfDay: null })).toBe("none");
    });
});

describe("parseNaturalTodo", () => {
    const base = new Date(Date.UTC(2026, 5, 16)); // Tue 2026-06-16

    it("parses the full spec example", () => {
        const p = parseNaturalTodo("Call client tomorrow at 3pm for 30 min #Client high priority", base);
        expect(p.title).toBe("Call client");
        expect(p.date).toBe("2026-06-17");
        expect(p.startTime).toBe("15:00");
        expect(p.durationMinutes).toBe(30);
        expect(p.tags).toEqual(["Client"]);
        expect(p.priority).toBe("HIGH");
        expect(p.matched).toBe(true);
    });

    it("does NOT treat a bare number as a time without 'at'/am-pm/minutes", () => {
        const p = parseNaturalTodo("meet 3 people for coffee", base);
        expect(p.startTime).toBeNull();
    });

    it("accepts 'at 9' as a time when adjacent", () => {
        const p = parseNaturalTodo("standup at 9", base);
        expect(p.startTime).toBe("09:00");
    });

    it("resolves weekday names to the upcoming day", () => {
        const p = parseNaturalTodo("gym monday", base);
        expect(p.date).toBe("2026-06-22"); // next Monday after Tue Jun 16
    });

    it("returns matched=false and keeps the title when nothing is recognized", () => {
        const p = parseNaturalTodo("Buy groceries", base);
        expect(p.matched).toBe(false);
        expect(p.title).toBe("Buy groceries");
    });
});
