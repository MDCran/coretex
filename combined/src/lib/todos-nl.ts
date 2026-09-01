/**
 * Lightweight natural-language parser for the quick-add input.
 *
 * Parses phrases like:
 *   "Call client tomorrow at 3pm for 30 min #Client high priority"
 * into structured fields, returning the leftover text as the title. Pure and
 * dependency-free so it can run client-side; pass a `baseDate` for determinism.
 */

import { minutesToHHMM, type TodoEnergyValue, type TodoPriorityValue } from "@/lib/todos-shared";

export interface ParsedTodo {
    title: string;
    date: string | null; // yyyy-MM-dd (UTC day key)
    startTime: string | null; // HH:MM
    durationMinutes: number | null;
    tags: string[];
    priority: TodoPriorityValue | null;
    energy: TodoEnergyValue | null;
    /** True if anything beyond the title was recognized. */
    matched: boolean;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function utcKey(base: Date, addDays: number): string {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()) + addDays * 86400000);
    return d.toISOString().slice(0, 10);
}

export function parseNaturalTodo(input: string, baseDate: Date = new Date()): ParsedTodo {
    let text = ` ${input} `;
    let matched = false;
    const strip = (re: RegExp) => {
        text = text.replace(re, " ");
    };

    // Tags: #word
    const tags: string[] = [];
    for (const m of input.matchAll(/#([\p{L}\d][\p{L}\d_-]*)/gu)) tags.push(m[1]);
    if (tags.length) {
        matched = true;
        strip(/#[\p{L}\d][\p{L}\d_-]*/gu);
    }

    // Priority: "high priority" / "urgent" / "asap"
    let priority: TodoPriorityValue | null = null;
    const pm = text.match(/\b(urgent|high|medium|low)\s+priority\b/i);
    if (pm) {
        priority = pm[1].toUpperCase() as TodoPriorityValue;
        matched = true;
        strip(/\b(urgent|high|medium|low)\s+priority\b/i);
    } else if (/\b(urgent|asap)\b/i.test(text)) {
        priority = "URGENT";
        matched = true;
        strip(/\b(urgent|asap)\b/i);
    } else if (/!{2,}/.test(text)) {
        priority = "HIGH";
        matched = true;
        strip(/!{2,}/g);
    }

    // Energy: "deep work" / "collaborative"
    let energy: TodoEnergyValue | null = null;
    if (/\bdeep work\b/i.test(text)) {
        energy = "DEEP_WORK";
        matched = true;
        strip(/\bdeep work\b/i);
    } else if (/\bcollaborat\w*\b/i.test(text)) {
        energy = "COLLABORATIVE";
        matched = true;
        strip(/\bcollaborat\w*\b/i);
    }

    // Duration: "for 30 min" / "30m" / "1h" / "1.5h" / "90 minutes"
    let durationMinutes: number | null = null;
    const dm = text.match(/\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i);
    if (dm) {
        const n = parseFloat(dm[1]);
        const unit = dm[2].toLowerCase();
        durationMinutes = unit.startsWith("h") ? Math.round(n * 60) : Math.round(n);
        if (durationMinutes > 0 && durationMinutes <= 1440) {
            matched = true;
            strip(/\b(?:for\s+)?\d+(?:\.\d+)?\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i);
        } else {
            durationMinutes = null;
        }
    }

    // Time: "at 3pm" / "at 15:30" / "3:30 pm"
    let startTime: string | null = null;
    const tm = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    // Accept a bare hour only when am/pm or minutes are present, or when "at" sits
    // directly before the number (not merely somewhere in the text).
    const atAdjacent = tm ? /^at\b/i.test(tm[0].trim()) : false;
    if (tm && (tm[3] || tm[2] || atAdjacent)) {
        let h = parseInt(tm[1], 10);
        const min = tm[2] ? parseInt(tm[2], 10) : 0;
        const ap = tm[3]?.toLowerCase();
        if (ap === "pm" && h < 12) h += 12;
        if (ap === "am" && h === 12) h = 0;
        if (h === 24 && min === 0) h = 0; // tolerate "24:00" as midnight
        if (h <= 23 && min <= 59) {
            startTime = minutesToHHMM(h * 60 + min);
            matched = true;
            strip(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(am|pm)?\b/i);
        }
    }

    // Date: today / tomorrow / in N days / next week / weekday name
    let date: string | null = null;
    if (/\btomorrow\b/i.test(text)) {
        date = utcKey(baseDate, 1);
        strip(/\btomorrow\b/i);
        matched = true;
    } else if (/\btoday\b/i.test(text)) {
        date = utcKey(baseDate, 0);
        strip(/\btoday\b/i);
        matched = true;
    } else if (/\bnext week\b/i.test(text)) {
        date = utcKey(baseDate, 7);
        strip(/\bnext week\b/i);
        matched = true;
    } else {
        const inM = text.match(/\bin\s+(\d+)\s+days?\b/i);
        if (inM) {
            date = utcKey(baseDate, parseInt(inM[1], 10));
            strip(/\bin\s+\d+\s+days?\b/i);
            matched = true;
        } else {
            const wm = text.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i);
            if (wm) {
                const target = WEEKDAYS.indexOf(wm[1].toLowerCase());
                const cur = baseDate.getUTCDay();
                let delta = (target - cur + 7) % 7;
                if (delta === 0) delta = 7; // "monday" means the upcoming one
                date = utcKey(baseDate, delta);
                strip(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i);
                matched = true;
            }
        }
    }

    const title = text.replace(/\s{2,}/g, " ").trim().replace(/[\s,]+$/, "").trim();
    return {
        title: title || input.trim(),
        date,
        startTime,
        durationMinutes,
        tags,
        priority,
        energy,
        matched,
    };
}
