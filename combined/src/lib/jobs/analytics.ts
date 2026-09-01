import type { JobStatus } from "@prisma/client";

/**
 * Pure analytics over the application pipeline: response rates, time-to-stage,
 * and a daily activity heatmap. No DB/IO so it's easy to unit-test and cheap.
 */

const DAY = 86_400_000;

export interface AnalyticsApp {
    status: JobStatus;
    heardFrom: string | null;
    createdAt: Date;
    dateApplied: Date | null;
    events: { toStatus: JobStatus | null; createdAt: Date }[];
}

const RESPONDED: JobStatus[] = ["UNDER_REVIEW", "ASSESSMENT", "INTERVIEWING", "OFFERED", "OFFER_ACCEPTED", "OFFER_DECLINED", "REJECTED"];
const INTERVIEWED: JobStatus[] = ["INTERVIEWING", "OFFERED", "OFFER_ACCEPTED", "OFFER_DECLINED"];
const OFFERED: JobStatus[] = ["OFFERED", "OFFER_ACCEPTED", "OFFER_DECLINED"];

function reached(app: AnalyticsApp, set: JobStatus[]): boolean {
    if (set.includes(app.status)) return true;
    return app.events.some((e) => e.toStatus != null && set.includes(e.toStatus));
}

/** Earliest time the application reached any status in `set`, or null. */
function firstReached(app: AnalyticsApp, set: JobStatus[]): number | null {
    const times = app.events.filter((e) => e.toStatus != null && set.includes(e.toStatus)).map((e) => e.createdAt.getTime());
    return times.length ? Math.min(...times) : null;
}

function appliedAt(app: AnalyticsApp): number {
    return (app.dateApplied ?? app.createdAt).getTime();
}

export interface FunnelStat {
    total: number;
    responded: number;
    interviewed: number;
    offered: number;
    responseRate: number;
    interviewRate: number;
    offerRate: number;
}

export function funnel(apps: AnalyticsApp[]): FunnelStat {
    const total = apps.length;
    const responded = apps.filter((a) => reached(a, RESPONDED)).length;
    const interviewed = apps.filter((a) => reached(a, INTERVIEWED)).length;
    const offered = apps.filter((a) => reached(a, OFFERED)).length;
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
    return { total, responded, interviewed, offered, responseRate: pct(responded), interviewRate: pct(interviewed), offerRate: pct(offered) };
}

export interface SourceStat {
    source: string;
    total: number;
    responded: number;
    responseRate: number;
}

export function bySource(apps: AnalyticsApp[], labelOf: (s: string | null) => string): SourceStat[] {
    const map = new Map<string, { total: number; responded: number }>();
    for (const a of apps) {
        const key = a.heardFrom ?? "OTHER";
        const agg = map.get(key) ?? { total: 0, responded: 0 };
        agg.total += 1;
        if (reached(a, RESPONDED)) agg.responded += 1;
        map.set(key, agg);
    }
    return [...map.entries()]
        .map(([k, v]) => ({ source: labelOf(k), total: v.total, responded: v.responded, responseRate: v.total ? Math.round((v.responded / v.total) * 100) : 0 }))
        .sort((a, b) => b.total - a.total);
}

/** Average days between applying and reaching response / interview / offer. */
export function timeToStage(apps: AnalyticsApp[]): { toResponse: number | null; toInterview: number | null; toOffer: number | null } {
    const avg = (set: JobStatus[]) => {
        const diffs: number[] = [];
        for (const a of apps) {
            const t = firstReached(a, set);
            if (t != null) {
                const d = (t - appliedAt(a)) / DAY;
                if (d >= 0) diffs.push(d);
            }
        }
        return diffs.length ? Math.round((diffs.reduce((s, d) => s + d, 0) / diffs.length) * 10) / 10 : null;
    };
    return { toResponse: avg(RESPONDED), toInterview: avg(INTERVIEWED), toOffer: avg(OFFERED) };
}

export interface HeatCell {
    /** yyyy-MM-dd */
    day: string;
    count: number;
}

/** Daily application counts for the last `weeks` weeks, aligned to week columns. */
export function heatmap(apps: AnalyticsApp[], weeks = 26, today: Date = new Date()): { cells: HeatCell[]; max: number } {
    const counts = new Map<string, number>();
    for (const a of apps) {
        const d = a.dateApplied ?? a.createdAt;
        const key = d.toISOString().slice(0, 10);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const cells: HeatCell[] = [];
    let max = 0;
    const totalDays = weeks * 7;
    const start = new Date(today.getTime() - (totalDays - 1) * DAY);
    for (let i = 0; i < totalDays; i++) {
        const d = new Date(start.getTime() + i * DAY);
        const key = d.toISOString().slice(0, 10);
        const count = counts.get(key) ?? 0;
        if (count > max) max = count;
        cells.push({ day: key, count });
    }
    return { cells, max };
}
