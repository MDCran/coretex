import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWeightSeries, reconcileWeightSeries, weightSeriesNeedsReconcile } from "@/lib/body-bridge";
import { MetricsClient, type MetricRow, type GirthRow } from "./metrics-client";

export default async function MetricsPage() {
    const user = await requireUser();

    // One-time historical alignment so the weight chart here matches the workouts
    // body weight chart (both read the unified getWeightSeries — see body-bridge.ts).
    if (await weightSeriesNeedsReconcile(user.id)) {
        await reconcileWeightSeries(user.id);
    }

    const [metrics, settings, latestMeasurement, weightSeries] = await Promise.all([
        db.bodyMetric.findMany({ where: { userId: user.id }, orderBy: { measuredAt: "desc" }, take: 500 }),
        db.settings.findUnique({ where: { userId: user.id } }),
        // Latest workouts body log — its girths are surfaced read-only below (bridge).
        db.bodyMeasurement.findFirst({ where: { userId: user.id }, orderBy: { date: "desc" } }),
        // Unified weight history shared with the workouts body weight chart.
        getWeightSeries(user.id),
    ]);

    const rows: MetricRow[] = metrics.map((m) => ({
        id: m.id,
        metricType: m.metricType,
        customName: m.customName,
        value: m.value,
        unit: m.unit,
        measuredAt: m.measuredAt.toISOString(),
        notes: m.notes,
    }));

    // Girth measurements only live in BodyMeasurement; show them read-only here so
    // the health metrics page is a complete picture (see lib/body-bridge.ts).
    const girths: GirthRow[] = latestMeasurement
        ? (
              [
                  ["Chest", latestMeasurement.chestCm],
                  ["Waist", latestMeasurement.waistCm],
                  ["Neck", latestMeasurement.neckCm],
                  ["Hip", latestMeasurement.hipCm],
                  ["Arm (L)", latestMeasurement.armLCm],
                  ["Arm (R)", latestMeasurement.armRCm],
                  ["Leg (L)", latestMeasurement.legLCm],
                  ["Leg (R)", latestMeasurement.legRCm],
              ] as const
          )
              .filter(([, v]) => v != null)
              .map(([label, v]) => ({ label, cm: v as number }))
        : [];

    return (
        <MetricsClient
            metrics={rows}
            weightSeries={weightSeries}
            unitSystem={settings?.unitSystem ?? "IMPERIAL"}
            girths={girths}
            girthDate={latestMeasurement ? latestMeasurement.date.toISOString() : null}
        />
    );
}
