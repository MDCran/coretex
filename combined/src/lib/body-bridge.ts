import "server-only";
import { db } from "@/lib/db";

/**
 * Body-measurement ↔ body-metric bridge.
 *
 * Two separate data models track weight:
 *  - `BodyMeasurement` (workouts /workouts/body) — one structured row per day
 *    holding weight + girths (chest/waist/arms/legs…). Stored metric (kg/cm).
 *  - `BodyMetric` (health /health/metrics) — typed time-series rows
 *    (metricType "weight", "body_fat_pct", custom…). Stored metric (kg etc.).
 *
 * To give the user one coherent weight history we keep the WEIGHT value in sync
 * across both: logging a weight in either place surfaces it in the other (and in
 * the health dashboard "latest weight" / overview chart, which read BodyMetric).
 *
 * No recursion: each sync function writes DIRECTLY to the *other* table via `db`.
 * The action that calls it never re-invokes the opposite action, so there is no
 * loop. Both sides dedupe by calendar day to avoid creating duplicate rows.
 *
 * All weights here are already in kg (metric). DB always stores metric.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC day window [start, end) for a given instant. */
function dayWindow(at: Date): { start: Date; end: Date } {
    const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
    return { start, end: new Date(start.getTime() + DAY_MS) };
}

/**
 * Called after a BodyMeasurement is saved in workouts. Mirrors its weight into a
 * "weight" BodyMetric for the same day so it appears in health metrics/dashboard.
 * If weightKg is null (measurement had no weight) this is a no-op.
 */
export async function syncMeasurementWeightToMetric(userId: string, day: Date, weightKg: number | null) {
    if (weightKg == null) return;
    const { start, end } = dayWindow(day);
    const existing = await db.bodyMetric.findFirst({
        where: { userId, metricType: "weight", measuredAt: { gte: start, lt: end } },
        orderBy: { measuredAt: "desc" },
    });
    if (existing) {
        if (existing.value !== weightKg) {
            await db.bodyMetric.update({ where: { id: existing.id }, data: { value: weightKg, unit: "kg" } });
        }
    } else {
        await db.bodyMetric.create({
            data: { userId, metricType: "weight", value: weightKg, unit: "kg", measuredAt: start, notes: "Synced from workouts body log" },
        });
    }
}

/**
 * Called after a "weight" BodyMetric is created/updated in health. Mirrors the
 * value into the BodyMeasurement weight for the same day (creating a minimal
 * measurement row if none exists) so the workouts body page stays consistent.
 */
export async function syncMetricWeightToMeasurement(userId: string, at: Date, weightKg: number) {
    const { start, end } = dayWindow(at);
    const existing = await db.bodyMeasurement.findFirst({
        where: { userId, date: { gte: start, lt: end } },
        orderBy: { date: "desc" },
    });
    if (existing) {
        if (existing.weightKg !== weightKg) {
            await db.bodyMeasurement.update({ where: { id: existing.id }, data: { weightKg } });
        }
    } else {
        await db.bodyMeasurement.create({
            data: { userId, date: start, weightKg, note: "Synced from health metrics" },
        });
    }
}

// ── Unified weight series ─────────────────────────────────────────────────────

export type WeightPoint = {
    /** Calendar day key (yyyy-mm-dd, UTC). */
    day: string;
    /** Weight in kg (metric — convert with lib/units for display). */
    kg: number;
};

/** yyyy-mm-dd (UTC) key for an instant. */
function dayKey(at: Date): string {
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())).toISOString().slice(0, 10);
}

/**
 * THE single source of truth for the user's weight history. Returns one point
 * per calendar day, in kg, sorted oldest→newest. Both the health metrics weight
 * chart and the workouts body weight chart read this so they show the SAME line.
 *
 * Union of both stores, deduped by day. When a day has both a BodyMetric
 * "weight" row and a BodyMeasurement.weightKg, the BodyMetric value wins (it is
 * the typed time-series and is what the bridge writes to on every new save).
 */
export async function getWeightSeries(userId: string): Promise<WeightPoint[]> {
    const [metrics, measurements] = await Promise.all([
        db.bodyMetric.findMany({
            where: { userId, metricType: "weight" },
            select: { value: true, measuredAt: true },
            orderBy: { measuredAt: "asc" },
        }),
        db.bodyMeasurement.findMany({
            where: { userId, weightKg: { not: null } },
            select: { weightKg: true, date: true },
            orderBy: { date: "asc" },
        }),
    ]);

    const byDay = new Map<string, number>();
    // Measurements first, then metrics overwrite (BodyMetric wins on conflict).
    for (const m of measurements) if (m.weightKg != null) byDay.set(dayKey(m.date), m.weightKg);
    for (const m of metrics) byDay.set(dayKey(m.measuredAt), m.value);

    return [...byDay.entries()]
        .map(([day, kg]) => ({ day, kg }))
        .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * One-time historical reconciliation so legacy rows (saved before the bridge
 * existed) line up across both stores. For every day that has a weight in only
 * one store, the missing counterpart is created. Cheap to call repeatedly: it
 * only writes when something is actually missing, and is a no-op once aligned.
 *
 * Pages call this on load when a cheap count check shows the two stores disagree
 * (see countWeightMismatch). Returns the number of rows created.
 */
export async function reconcileWeightSeries(userId: string): Promise<number> {
    const [metrics, measurements] = await Promise.all([
        db.bodyMetric.findMany({
            where: { userId, metricType: "weight" },
            select: { value: true, measuredAt: true },
        }),
        db.bodyMeasurement.findMany({
            where: { userId, weightKg: { not: null } },
            select: { id: true, weightKg: true, date: true },
        }),
    ]);

    const metricDays = new Map<string, number>();
    for (const m of metrics) metricDays.set(dayKey(m.measuredAt), m.value);
    const measurementDays = new Map<string, number>();
    for (const m of measurements) if (m.weightKg != null) measurementDays.set(dayKey(m.date), m.weightKg);

    let created = 0;

    // Measurement weight present but no BodyMetric that day → create the metric.
    for (const [day, kg] of measurementDays) {
        if (!metricDays.has(day)) {
            const start = new Date(`${day}T00:00:00.000Z`);
            await db.bodyMetric.create({
                data: { userId, metricType: "weight", value: kg, unit: "kg", measuredAt: start, notes: "Reconciled from workouts body log" },
            });
            created++;
        }
    }

    // BodyMetric weight present but no measurement that day → create a minimal measurement.
    for (const [day, kg] of metricDays) {
        if (!measurementDays.has(day)) {
            const start = new Date(`${day}T00:00:00.000Z`);
            await db.bodyMeasurement.create({
                data: { userId, date: start, weightKg: kg, note: "Reconciled from health metrics" },
            });
            created++;
        }
    }

    return created;
}

/**
 * Cheap mismatch check: returns true when the two stores have a different number
 * of distinct weight-days, meaning a reconciliation pass is worthwhile. Used to
 * gate reconcileWeightSeries() on page load without scanning all rows.
 */
export async function weightSeriesNeedsReconcile(userId: string): Promise<boolean> {
    const [metrics, measurements] = await Promise.all([
        db.bodyMetric.findMany({ where: { userId, metricType: "weight" }, select: { measuredAt: true } }),
        db.bodyMeasurement.findMany({ where: { userId, weightKg: { not: null } }, select: { date: true } }),
    ]);
    const metricDays = new Set(metrics.map((m) => dayKey(m.measuredAt)));
    const measurementDays = new Set(measurements.map((m) => dayKey(m.date)));
    if (metricDays.size !== measurementDays.size) return true;
    for (const d of metricDays) if (!measurementDays.has(d)) return true;
    return false;
}

/**
 * Remove the same-day weight counterpart in the OPPOSITE store when a weight is
 * deleted, so deleting in one place never leaves a phantom point in the other
 * chart (both charts read getWeightSeries, which unions both stores).
 *
 * source = "metric": a BodyMetric weight was deleted → clear the matching
 *   BodyMeasurement.weightKg (the measurement row is kept if it still holds
 *   girths/body-fat; only the weight is nulled, and rows that become empty are
 *   removed).
 * source = "measurement": a BodyMeasurement weight was deleted → delete the
 *   matching "weight" BodyMetric rows for that day.
 */
export async function deleteWeightCounterpart(userId: string, day: Date, source: "metric" | "measurement") {
    const { start, end } = dayWindow(day);
    if (source === "metric") {
        const measurements = await db.bodyMeasurement.findMany({ where: { userId, date: { gte: start, lt: end }, weightKg: { not: null } } });
        for (const m of measurements) {
            const hasOtherData =
                m.bodyFatPct != null || m.chestCm != null || m.waistCm != null || m.neckCm != null || m.hipCm != null ||
                m.armLCm != null || m.armRCm != null || m.legLCm != null || m.legRCm != null || (m.note != null && m.note.trim() !== "");
            if (hasOtherData) {
                await db.bodyMeasurement.update({ where: { id: m.id }, data: { weightKg: null } });
            } else {
                await db.bodyMeasurement.delete({ where: { id: m.id } });
            }
        }
    } else {
        await db.bodyMetric.deleteMany({ where: { userId, metricType: "weight", measuredAt: { gte: start, lt: end } } });
    }
}
