"use client";

import { cx } from "@/utils/cx";
import { habitColor } from "./habits-ui";

/**
 * A GitHub-style heatmap for the last ~16 weeks of a habit.
 *
 * - BUILD habits: days WITH a log are filled in the habit color (success).
 * - BREAK habits: clean days (no log, in the past, since the habit existed) are
 *   filled green; relapse days (a log exists) are filled red. This inverts the
 *   meaning so a healthy break-habit calendar reads "mostly green".
 */
export function HabitHeatmap({
    logDates,
    color = "brand",
    variant = "build",
    sinceKey,
}: {
    logDates: Set<string>;
    color?: string;
    variant?: "build" | "break";
    /** Earliest day to treat as "tracked" for break-habit clean shading (YYYY-MM-DD). */
    sinceKey?: string;
}) {
    const weeks = 16;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = today.toISOString().slice(0, 10);
    // Start on the Sunday of the week 'weeks-1' ago.
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() - (weeks - 1) * 7);

    const cols: { date: Date; key: string; logged: boolean; future: boolean }[][] = [];
    for (let w = 0; w < weeks; w++) {
        const col: { date: Date; key: string; logged: boolean; future: boolean }[] = [];
        for (let d = 0; d < 7; d++) {
            const date = new Date(start);
            date.setDate(start.getDate() + w * 7 + d);
            const key = date.toISOString().slice(0, 10);
            col.push({ date, key, logged: logDates.has(key), future: date > today });
        }
        cols.push(col);
    }

    const col = habitColor(color);

    function cellClass(cell: { key: string; logged: boolean; future: boolean }): string {
        if (cell.future) return "bg-transparent";
        if (variant === "break") {
            if (cell.logged) return "bg-utility-red-500"; // relapse
            // clean day — only shade days since tracking started (and up to today)
            const tracked = !sinceKey || cell.key >= sinceKey;
            if (tracked && cell.key <= todayKey) return "bg-utility-green-500";
            return "bg-quaternary";
        }
        return cell.logged ? col.solid : "bg-quaternary";
    }

    function title(cell: { key: string; logged: boolean }): string {
        if (variant === "break") return `${cell.key}${cell.logged ? " · slipped" : " · clean"}`;
        return `${cell.key}${cell.logged ? " · done" : ""}`;
    }

    return (
        <div className="flex gap-1 overflow-x-auto">
            {cols.map((c, i) => (
                <div key={i} className="flex flex-col gap-1">
                    {c.map((cell) => (
                        <div key={cell.key} title={title(cell)} className={cx("size-3 rounded-[3px]", cellClass(cell))} />
                    ))}
                </div>
            ))}
        </div>
    );
}
