import { describe, expect, it } from "vitest";
import { activeSyncedDisplayIndex, activeSyncedLineIndex, parseLrc } from "../lrc";

describe("activeSyncedDisplayIndex", () => {
    const lines = [
        { timeMs: 0, text: "Line one" },
        { timeMs: 5000, text: "" },
        { timeMs: 10000, text: "Line two" },
        { timeMs: 20000, text: "Line three" },
    ];

    it("returns -1 before the first line", () => {
        const delayed = [{ timeMs: 5000, text: "Line one" }, { timeMs: 10000, text: "Line two" }];
        expect(activeSyncedDisplayIndex(delayed, 1000)).toBe(-1);
    });

    it("highlights the current sung line", () => {
        expect(activeSyncedDisplayIndex(lines, 3000)).toBe(0);
        expect(activeSyncedDisplayIndex(lines, 12000)).toBe(2);
    });

    it("holds the previous sung line through instrumental gap markers", () => {
        expect(activeSyncedDisplayIndex(lines, 7000)).toBe(0);
        expect(activeSyncedDisplayIndex(lines, 15000)).toBe(2);
    });

    it("does not advance to the next line until after the lag buffer", () => {
        expect(activeSyncedDisplayIndex(lines, 10050)).toBe(0);
        expect(activeSyncedDisplayIndex(lines, 10100)).toBe(2);
    });
});

describe("parseLrc", () => {
    it("parses timestamps and sorts lines", () => {
        const parsed = parseLrc("[00:10.00]Second\n[00:05.00]First");
        expect(parsed).toEqual([
            { timeMs: 5000, text: "First" },
            { timeMs: 10000, text: "Second" },
        ]);
    });
});

describe("activeSyncedLineIndex", () => {
    it("returns the last line at or before progress", () => {
        const lines = parseLrc("[00:01.00]A\n[00:02.00]B");
        expect(activeSyncedLineIndex(lines, 1500)).toBe(0);
        expect(activeSyncedLineIndex(lines, 2000)).toBe(1);
    });
});
