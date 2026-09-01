import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { TrendChart, type TrendPoint } from "@/app/(app)/health/_components/trend-chart";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatWeight, weightToDisplay, weightUnit } from "@/lib/units";
import { getWeightSeries, reconcileWeightSeries, weightSeriesNeedsReconcile } from "@/lib/body-bridge";
import { formatMeters, formatSeconds, setVolume, titleCase } from "@/lib/workouts";
import { recomputeAllPersonalRecords } from "@/lib/workouts-prs";
import { Card, EmptyState, PageHeader, SectionHeader } from "../_components/workouts-ui";
import { BodyPageActions } from "./_components/body-page-actions";
import { BodyMetricsClient, type BodyMeasurementRow } from "./_components/body-metrics-client";
import { BodyDiagramCard } from "./_components/body-diagram-card";
import { TrainingCycleManager } from "./_components/training-cycle-manager";
import { RecomputePrsButton } from "./_components/recompute-prs-button";

function startOfWeek(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
}

export default async function BodyPage() {
    const user = await requireUser();

    // One-time historical alignment: if the two weight stores disagree, merge them
    // so old data lines up before we read the unified series (see lib/body-bridge.ts).
    if (await weightSeriesNeedsReconcile(user.id)) {
        await reconcileWeightSeries(user.id);
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const twelveWeeksAgo = startOfWeek(new Date());
    twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 7 * 11);

    // Auto-backfill PRs (cheap two-count check) if migrated data has sets but no PRs.
    const [prCount, completedSetCount] = await Promise.all([
        db.personalRecord.count({ where: { userId: user.id } }),
        db.setEntry.count({ where: { completed: true, isWarmup: false, workoutExercise: { workout: { userId: user.id, deletedAt: null } } } }),
    ]);
    if (prCount === 0 && completedSetCount > 0) {
        await recomputeAllPersonalRecords(user.id);
    }

    const [measurements, cycles, settings, weightSeries, prs, recentWorkouts] = await Promise.all([
        db.bodyMeasurement.findMany({ where: { userId: user.id }, orderBy: { date: "desc" }, take: 120 }),
        db.trainingCycle.findMany({ where: { userId: user.id }, orderBy: { startDate: "desc" } }),
        db.settings.findUnique({ where: { userId: user.id } }),
        // Unified weight history shared with the health metrics weight chart.
        getWeightSeries(user.id),
        db.personalRecord.findMany({
            where: { userId: user.id },
            orderBy: [{ exercise: { name: "asc" } }, { recordType: "asc" }],
            include: { exercise: { select: { name: true } } },
        }),
        db.workout.findMany({
            where: { userId: user.id, deletedAt: null, date: { gte: twelveWeeksAgo } },
            include: { exercises: { include: { sets: { where: { completed: true } }, exercise: { select: { muscles: true } } } } },
        }),
    ]);

    const unitSystem = settings?.unitSystem ?? "IMPERIAL";
    const wU = weightUnit(unitSystem);

    const measurementRows: BodyMeasurementRow[] = measurements.map((m) => ({
        id: m.id,
        date: m.date.toISOString().slice(0, 10),
        weightKg: m.weightKg,
        bodyFatPct: m.bodyFatPct,
        chestCm: m.chestCm,
        waistCm: m.waistCm,
        neckCm: m.neckCm,
        hipCm: m.hipCm,
        armLCm: m.armLCm,
        armRCm: m.armRCm,
        legLCm: m.legLCm,
        legRCm: m.legRCm,
        note: m.note,
    }));

    // Muscle balance — sets per primary muscle group, last 30 days.
    const muscleCounts = new Map<string, number>();
    for (const w of recentWorkouts) {
        if (w.date < thirtyDaysAgo) continue;
        for (const we of w.exercises) {
            const muscles = we.exercise.muscles.length > 0 ? we.exercise.muscles : ["other"];
            const working = we.sets.filter((s) => !s.isWarmup).length;
            for (const m of muscles) muscleCounts.set(m, (muscleCounts.get(m) ?? 0) + working);
        }
    }
    const muscleData: TrendPoint[] = [...muscleCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([muscle, sets]) => ({ label: titleCase(muscle), Sets: sets }));

    // Weekly volume — last 12 weeks.
    const weekVolume = new Map<string, number>();
    for (const w of recentWorkouts) {
        const key = startOfWeek(w.date).toISOString().slice(0, 10);
        const vol = w.exercises.reduce((s, we) => s + we.sets.reduce((v, x) => v + setVolume(x), 0), 0);
        weekVolume.set(key, (weekVolume.get(key) ?? 0) + vol);
    }
    const volumeData: TrendPoint[] = [...weekVolume.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([week, vol]) => ({ label: new Date(week).toLocaleDateString(undefined, { month: "short", day: "numeric" }), Volume: Math.round(weightToDisplay(vol, unitSystem)) }));

    // Group PRs by exercise for the table.
    const byExercise = new Map<string, { name: string; oneRm?: number; volume?: number; reps?: number; time?: number; distance?: number; date: Date }>();
    for (const pr of prs) {
        const entry = byExercise.get(pr.exerciseId) ?? { name: pr.exercise.name, date: pr.achievedOn };
        if (pr.recordType === "1RM") entry.oneRm = pr.value;
        else if (pr.recordType === "volume") entry.volume = pr.value;
        else if (pr.recordType === "reps") entry.reps = pr.value;
        else if (pr.recordType === "time") entry.time = pr.value;
        else if (pr.recordType === "distance") entry.distance = pr.value;
        if (pr.achievedOn > entry.date) entry.date = pr.achievedOn;
        byExercise.set(pr.exerciseId, entry);
    }
    const prRows = [...byExercise.values()].sort((a, b) => a.name.localeCompare(b.name));
    const anyTimed = prRows.some((r) => r.time != null || r.distance != null);

    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                title="Body & metrics"
                description="Track weight, body fat and measurements, watch your training volume, and celebrate every personal record."
                actions={<BodyPageActions />}
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
                <BodyMetricsClient measurements={measurementRows} weightSeries={weightSeries} unitSystem={unitSystem} />
                <BodyDiagramCard measurement={measurementRows[0] ?? null} unitSystem={unitSystem} />
            </div>

            {/* ── Muscle balance & weekly volume ────────────────────────────── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card>
                    <SectionHeader title="Muscle balance" description="Working sets per muscle group, last 30 days." />
                    <div className="mt-4">
                        <TrendChart data={muscleData} series={[{ key: "Sets", name: "Sets" }]} type="bar" emptyLabel="No sets in the last 30 days" />
                    </div>
                </Card>
                <Card>
                    <SectionHeader title="Weekly volume" description={`Total ${wU} lifted per week, last 12 weeks.`} />
                    <div className="mt-4">
                        <TrendChart data={volumeData} series={[{ key: "Volume", name: `Volume (${wU})` }]} type="area" emptyLabel="No volume logged yet" />
                    </div>
                </Card>
            </div>

            {/* ── Personal records ──────────────────────────────────────────── */}
            <Card>
                <SectionHeader title="Personal records" description="Best estimated 1RM, set volume and reps per exercise." action={<RecomputePrsButton />} />

                {/* Empty state spans both mobile + desktop layouts */}
                {prRows.length === 0 && (
                    <EmptyState
                        iconName="trophy"
                        color="warning"
                        title="No personal records yet"
                        description="Log a few working sets and we'll automatically track your best estimated 1RM, set volume and reps for every exercise."
                        action={
                            <Button size="md" color="primary" href="/workouts/log">
                                Start a workout
                            </Button>
                        }
                    />
                )}

                {/* Mobile: stacked card per exercise (< 640px) */}
                <ul className={cx("mt-4 flex-col gap-3 sm:hidden", prRows.length === 0 ? "hidden" : "flex")}>
                    {prRows.map((r) => (
                            <li key={r.name} className="rounded-lg bg-primary p-3 ring-1 ring-secondary ring-inset">
                                <div className="flex items-start justify-between gap-2">
                                    <span className="font-medium text-primary">{r.name}</span>
                                    <span className="text-xs text-tertiary">{r.date.toLocaleDateString()}</span>
                                </div>
                                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                                    <div className="flex flex-col">
                                        <dt className="text-xs text-tertiary">Est. 1RM</dt>
                                        <dd className="text-secondary">{r.oneRm != null ? formatWeight(r.oneRm, unitSystem) : "—"}</dd>
                                    </div>
                                    <div className="flex flex-col">
                                        <dt className="text-xs text-tertiary">Best set volume</dt>
                                        <dd className="text-secondary">{r.volume != null ? `${Math.round(weightToDisplay(r.volume, unitSystem)).toLocaleString()} ${wU}` : "—"}</dd>
                                    </div>
                                    <div className="flex flex-col">
                                        <dt className="text-xs text-tertiary">Most reps</dt>
                                        <dd className="text-secondary">{r.reps != null ? `${r.reps} reps` : "—"}</dd>
                                    </div>
                                    {anyTimed && (
                                        <div className="flex flex-col">
                                            <dt className="text-xs text-tertiary">Best time</dt>
                                            <dd className="text-secondary">{r.time != null ? formatSeconds(r.time) : "—"}</dd>
                                        </div>
                                    )}
                                    {anyTimed && (
                                        <div className="flex flex-col">
                                            <dt className="text-xs text-tertiary">Best distance</dt>
                                            <dd className="text-secondary">{r.distance != null ? formatMeters(r.distance) : "—"}</dd>
                                        </div>
                                    )}
                                </dl>
                            </li>
                        ))}
                </ul>

                {/* Tablet/desktop: table (>= 640px) */}
                <div className={cx("mt-4 hidden overflow-x-auto", prRows.length === 0 ? "" : "sm:block")}>
                    <table className="w-full min-w-[560px] text-sm">
                        <thead>
                            <tr className="border-b border-secondary text-left text-xs text-tertiary">
                                <th className="py-2 pr-3 font-medium">Exercise</th>
                                <th className="py-2 pr-3 font-medium">Est. 1RM</th>
                                <th className="py-2 pr-3 font-medium">Best set volume</th>
                                <th className="py-2 pr-3 font-medium">Most reps</th>
                                {anyTimed && <th className="py-2 pr-3 font-medium">Best time</th>}
                                {anyTimed && <th className="py-2 pr-3 font-medium">Best distance</th>}
                                <th className="py-2 font-medium">Last PR</th>
                            </tr>
                        </thead>
                        <tbody>
                            {prRows.map((r) => (
                                    <tr key={r.name} className="border-b border-secondary text-secondary">
                                        <td className="py-2 pr-3 font-medium text-primary">{r.name}</td>
                                        <td className="py-2 pr-3">{r.oneRm != null ? formatWeight(r.oneRm, unitSystem) : "—"}</td>
                                        <td className="py-2 pr-3">{r.volume != null ? `${Math.round(weightToDisplay(r.volume, unitSystem)).toLocaleString()} ${wU}` : "—"}</td>
                                        <td className="py-2 pr-3">{r.reps != null ? `${r.reps} reps` : "—"}</td>
                                        {anyTimed && <td className="py-2 pr-3">{r.time != null ? formatSeconds(r.time) : "—"}</td>}
                                        {anyTimed && <td className="py-2 pr-3">{r.distance != null ? formatMeters(r.distance) : "—"}</td>}
                                        <td className="py-2">{r.date.toLocaleDateString()}</td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <TrainingCycleManager
                cycles={cycles.map((c) => ({
                    id: c.id,
                    phase: c.phase,
                    startDate: c.startDate.toISOString().slice(0, 10),
                    endDate: c.endDate ? c.endDate.toISOString().slice(0, 10) : null,
                    note: c.note,
                }))}
            />
        </div>
    );
}
