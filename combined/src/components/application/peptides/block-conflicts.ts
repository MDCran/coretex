import type { Block } from "@/lib/peptides/types";

export interface BlockConflicts {
    /** Block ids that overlap at least one other block (hard conflict). */
    overlapping: Set<string>;
    /** Block ids whose own week range is invalid (endWeek < startWeek). */
    invalidRange: Set<string>;
    /** Human-readable summary lines, e.g. "Weeks 5–6 are covered by two blocks". */
    overlapMessages: string[];
    /** Uncovered week ranges inside the planned span, e.g. "Weeks 3–4 have no block (gap)". */
    gapMessages: string[];
    /** True when there is at least one hard overlap (save should be blocked). */
    hasOverlap: boolean;
}

/** Inclusive count of weeks two ranges share, 0 when they don't touch. */
function overlapWeeks(a: Block, b: Block): { from: number; to: number } | null {
    const from = Math.max(a.startWeek, b.startWeek);
    const to = Math.min(a.endWeek, b.endWeek);
    return from <= to ? { from, to } : null;
}

function weeksLabel(from: number, to: number): string {
    return from === to ? `Week ${from}` : `Weeks ${from}–${to}`;
}

/**
 * Detect plan problems across a peptide's dosing blocks:
 *  - overlapping week ranges (two blocks both covering, say, week 5) — hard conflict,
 *  - gaps (weeks inside the overall span with no covering block) — soft warning,
 *  - invalid ranges (endWeek < startWeek) — hard conflict.
 *
 * Pure + deterministic so it can be unit-tested and reused by the inline editor.
 */
export function detectBlockConflicts(blocks: Block[]): BlockConflicts {
    const overlapping = new Set<string>();
    const invalidRange = new Set<string>();
    const overlapMessages: string[] = [];
    const gapMessages: string[] = [];

    const valid = blocks.filter((b) => {
        if (b.endWeek < b.startWeek) {
            invalidRange.add(b.id);
            return false;
        }
        return true;
    });

    // Pairwise overlap check.
    for (let i = 0; i < valid.length; i++) {
        for (let j = i + 1; j < valid.length; j++) {
            const o = overlapWeeks(valid[i], valid[j]);
            if (o) {
                overlapping.add(valid[i].id);
                overlapping.add(valid[j].id);
                overlapMessages.push(`${weeksLabel(o.from, o.to)} ${o.from === o.to ? "is" : "are"} covered by two blocks`);
            }
        }
    }

    // Gap check across the overall planned span.
    if (valid.length > 0) {
        const minStart = Math.min(...valid.map((b) => b.startWeek));
        const maxEnd = Math.max(...valid.map((b) => b.endWeek));
        const covered = new Array<boolean>(maxEnd - minStart + 1).fill(false);
        for (const b of valid) {
            for (let w = b.startWeek; w <= b.endWeek; w++) covered[w - minStart] = true;
        }
        // Collapse uncovered runs into ranges.
        let runStart: number | null = null;
        for (let w = minStart; w <= maxEnd; w++) {
            const isCovered = covered[w - minStart];
            if (!isCovered && runStart === null) runStart = w;
            if (isCovered && runStart !== null) {
                gapMessages.push(`${weeksLabel(runStart, w - 1)} ${runStart === w - 1 ? "has" : "have"} no block (gap)`);
                runStart = null;
            }
        }
        if (runStart !== null) {
            gapMessages.push(`${weeksLabel(runStart, maxEnd)} ${runStart === maxEnd ? "has" : "have"} no block (gap)`);
        }
    }

    // De-duplicate identical overlap messages (a 3-way overlap can repeat a range).
    const uniqueOverlaps = [...new Set(overlapMessages)];

    return {
        overlapping,
        invalidRange,
        overlapMessages: uniqueOverlaps,
        gapMessages,
        hasOverlap: overlapping.size > 0 || invalidRange.size > 0,
    };
}
