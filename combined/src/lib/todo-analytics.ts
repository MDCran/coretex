import "server-only";

import { db } from "@/lib/db";
import { dateKey, dayOf } from "@/lib/todos";

// ── Weekly review digest ─────────────────────────────────────

export interface WeeklyDigest {
    weekStart: string;
    weekEnd: string;
    done: number;
    skipped: number;
    open: number;
    total: number;
    completionRate: number; // 0..1 of (done / (done+skipped+open))
    perDayDone: { day: string; done: number }[];
    topCategory: { category: string; done: number } | null;
}

/** Summarize the 7 days starting at `weekStart` (UTC-midnight). */
export async function getWeeklyDigest(userId: string, weekStart: Date): Promise<WeeklyDigest> {
    const start = dayOf(weekStart);
    const end = new Date(start.getTime() + 6 * 86400000);
    const rows = await db.todoItem.findMany({
        where: { userId, date: { gte: start, lte: end } },
        select: { date: true, status: true, category: true },
    });

    let done = 0;
    let skipped = 0;
    let open = 0;
    const perDay = new Map<string, number>();
    const byCat = new Map<string, number>();
    for (let i = 0; i < 7; i++) perDay.set(dateKey(new Date(start.getTime() + i * 86400000)), 0);

    for (const r of rows) {
        if (r.status === "DONE") {
            done++;
            if (r.date) perDay.set(dateKey(r.date), (perDay.get(dateKey(r.date)) ?? 0) + 1);
            if (r.category) byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1);
        } else if (r.status === "SKIPPED") {
            skipped++;
        } else {
            open++;
        }
    }
    const total = done + skipped + open;
    const topCat = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
        weekStart: dateKey(start),
        weekEnd: dateKey(end),
        done,
        skipped,
        open,
        total,
        completionRate: total ? done / total : 0,
        perDayDone: [...perDay.entries()].map(([day, d]) => ({ day, done: d })),
        topCategory: topCat ? { category: topCat[0], done: topCat[1] } : null,
    };
}

// ── Workload heatmap ─────────────────────────────────────────

export interface DayLoad {
    day: string;
    count: number;
    minutes: number;
    doneCount: number;
}

/** Per-day scheduled load (non-skipped) for the heatmap, keyed yyyy-MM-dd. */
export async function getTodoLoadByDay(userId: string, start: Date, end: Date): Promise<DayLoad[]> {
    const rows = await db.todoItem.findMany({
        where: { userId, date: { gte: dayOf(start), lte: dayOf(end) } },
        select: { date: true, status: true, durationMinutes: true },
    });
    const map = new Map<string, DayLoad>();
    for (const r of rows) {
        if (!r.date) continue;
        const k = dateKey(r.date);
        const cur = map.get(k) ?? { day: k, count: 0, minutes: 0, doneCount: 0 };
        if (r.status !== "SKIPPED") {
            cur.count += 1;
            cur.minutes += r.durationMinutes ?? 0;
        }
        if (r.status === "DONE") cur.doneCount += 1;
        map.set(k, cur);
    }
    return [...map.values()];
}

// ── Analytics dashboard ──────────────────────────────────────

export interface RateBreakdown {
    key: string;
    done: number;
    skipped: number;
    total: number;
    rate: number;
}

export interface TodoAnalytics {
    start: string;
    end: string;
    totalDone: number;
    totalSkipped: number;
    totalOpen: number;
    completionRate: number;
    avgDurationMin: number;
    byCategory: RateBreakdown[];
    byPriority: RateBreakdown[];
    mostSkipped: { key: string; skipped: number }[];
}

function bump(map: Map<string, RateBreakdown>, key: string, status: string) {
    const cur = map.get(key) ?? { key, done: 0, skipped: 0, total: 0, rate: 0 };
    cur.total += 1;
    if (status === "DONE") cur.done += 1;
    else if (status === "SKIPPED") cur.skipped += 1;
    map.set(key, cur);
}
function finalize(map: Map<string, RateBreakdown>): RateBreakdown[] {
    return [...map.values()]
        .map((b) => ({ ...b, rate: b.total ? b.done / b.total : 0 }))
        .sort((a, b) => b.total - a.total);
}

export async function getTodoAnalytics(userId: string, start: Date, end: Date): Promise<TodoAnalytics> {
    const rows = await db.todoItem.findMany({
        where: { userId, date: { gte: dayOf(start), lte: dayOf(end) } },
        select: { status: true, category: true, priority: true, durationMinutes: true },
    });
    const cat = new Map<string, RateBreakdown>();
    const pri = new Map<string, RateBreakdown>();
    let totalDone = 0;
    let totalSkipped = 0;
    let totalOpen = 0;
    let durSum = 0;
    let durCount = 0;
    for (const r of rows) {
        bump(cat, r.category ?? "Uncategorized", r.status);
        bump(pri, r.priority, r.status);
        if (r.status === "DONE") totalDone++;
        else if (r.status === "SKIPPED") totalSkipped++;
        else totalOpen++;
        if (r.durationMinutes != null && r.durationMinutes > 0) {
            durSum += r.durationMinutes;
            durCount++;
        }
    }
    const total = totalDone + totalSkipped + totalOpen;
    const byCategory = finalize(cat);
    return {
        start: dateKey(dayOf(start)),
        end: dateKey(dayOf(end)),
        totalDone,
        totalSkipped,
        totalOpen,
        completionRate: total ? totalDone / total : 0,
        avgDurationMin: durCount ? Math.round(durSum / durCount) : 0,
        byCategory,
        byPriority: finalize(pri),
        mostSkipped: byCategory
            .filter((b) => b.skipped > 0)
            .sort((a, b) => b.skipped - a.skipped)
            .slice(0, 5)
            .map((b) => ({ key: b.key, skipped: b.skipped })),
    };
}
