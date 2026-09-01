import Link from "next/link";
import { Activity, Award01, Calendar, Plus, TrendUp02 } from "@untitledui/icons";
import type { TrendPoint } from "@/app/(app)/health/_components/trend-chart";
import { AiSuggestionCard } from "@/components/app-shell/ai-suggestion-card";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMeters, formatSeconds, setVolume, titleCase } from "@/lib/workouts";
import { formatWeight, weightToDisplay, weightUnit } from "@/lib/units";
import { Card, SectionHeader, Stat } from "./_components/workouts-ui";
import { DeltaBadge } from "@/components/foundations/delta-badge";
import { AdherenceCard } from "./_components/adherence-card";
import { PlanSummaryCard } from "./_components/plan-summary-card";
import { WorkoutsHero } from "./_components/workouts-hero";
import { WorkoutsOverviewCharts } from "./_components/workouts-overview-charts";

function startOfWeek(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
}

const PHASE_LABEL: Record<string, string> = { BULK: "Bulk", CUT: "Cut", MAINTAIN: "Maintain" };
const PHASE_COLOR: Record<string, "success" | "warning" | "brand"> = { BULK: "success", CUT: "warning", MAINTAIN: "brand" };

export default async function WorkoutsDashboardPage() {
    const user = await requireUser();

    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday

    const twelveWeeksAgo = startOfWeek(new Date());
    twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 7 * 11);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [recentWorkouts, weekWorkouts, chartWorkouts, activeCycle, recentPRs, templates, schedules] = await Promise.all([
        db.workout.findMany({
            where: { userId: user.id, deletedAt: null, isQuickLog: false },
            orderBy: { date: "desc" },
            take: 6,
            include: { exercises: { include: { sets: true, exercise: { select: { name: true } } } } },
        }),
        db.workout.findMany({
            where: { userId: user.id, deletedAt: null, isQuickLog: false, date: { gte: weekStart } },
            include: { exercises: { include: { sets: true } } },
        }),
        db.workout.findMany({
            where: { userId: user.id, deletedAt: null, date: { gte: twelveWeeksAgo } },
            include: { exercises: { include: { sets: { where: { completed: true } }, exercise: { select: { muscles: true } } } } },
        }),
        db.trainingCycle.findFirst({
            where: { userId: user.id, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
            orderBy: { startDate: "desc" },
        }),
        db.personalRecord.findMany({
            where: { userId: user.id },
            orderBy: { achievedOn: "desc" },
            take: 5,
            include: { exercise: { select: { name: true } } },
        }),
        db.template.findMany({ where: { userId: user.id, archived: false }, orderBy: { updatedAt: "desc" }, take: 8 }),
        db.workoutSchedule.findMany({
            where: { userId: user.id },
            orderBy: { date: "desc" },
            take: 200,
            select: { id: true, date: true, skipped: true, workoutId: true, name: true, template: { select: { name: true } } },
        }),
    ]);

    const settings = await db.settings.findUnique({ where: { userId: user.id } });
    const unitSystem = settings?.unitSystem ?? "IMPERIAL";
    const wU = weightUnit(unitSystem);

    // Mark schedules whose date has a non-deleted workout (implicit fulfillment).
    const scheduleDates = [...new Set(schedules.map((s) => s.date.getTime()))].map((t) => new Date(t));
    const workoutDates = scheduleDates.length
        ? await db.workout.findMany({ where: { userId: user.id, deletedAt: null, date: { in: scheduleDates } }, select: { date: true } })
        : [];
    const datesWithWorkout = new Set(workoutDates.map((w) => w.date.toISOString().slice(0, 10)));
    const adherencePlans = schedules.map((s) => {
        const dateKey = s.date.toISOString().slice(0, 10);
        return { date: dateKey, skipped: s.skipped, workoutId: s.workoutId, hasWorkoutOnDate: datesWithWorkout.has(dateKey) };
    });
    const summaryPlans = schedules.map((s) => {
        const dateKey = s.date.toISOString().slice(0, 10);
        return {
            id: s.id,
            date: dateKey,
            name: s.name,
            templateName: s.template?.name ?? null,
            workoutId: s.workoutId,
            skipped: s.skipped,
            hasWorkoutOnDate: datesWithWorkout.has(dateKey),
        };
    });

    const weekVol = weekWorkouts.reduce(
        (sum, w) => sum + w.exercises.reduce((s, we) => s + we.sets.filter((x) => x.completed).reduce((v, x) => v + setVolume(x), 0), 0),
        0,
    );

    // Week-over-week deltas for the summary tiles, computed consistently from the
    // 12-week dataset (completed sets only) so both weeks use the same basis.
    const thisWeekKey = weekStart.toISOString().slice(0, 10);
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevWeekKey = prevWeekStart.toISOString().slice(0, 10);
    let thisWkCount = 0;
    let lastWkCount = 0;
    let thisWkVol = 0;
    let lastWkVol = 0;
    for (const w of chartWorkouts) {
        const key = startOfWeek(w.date).toISOString().slice(0, 10);
        if (key !== thisWeekKey && key !== prevWeekKey) continue;
        const vol = w.exercises.reduce((s, we) => s + we.sets.reduce((v, x) => v + setVolume(x), 0), 0);
        if (key === thisWeekKey) {
            thisWkCount++;
            thisWkVol += vol;
        } else {
            lastWkCount++;
            lastWkVol += vol;
        }
    }
    const workoutsWowDelta = thisWkCount === 0 && lastWkCount === 0 ? null : thisWkCount - lastWkCount;
    const volumeWowDelta = thisWkVol === 0 && lastWkVol === 0 ? null : Math.round(weightToDisplay(thisWkVol - lastWkVol, unitSystem));

    let cycleDays = 0;
    if (activeCycle) cycleDays = Math.max(0, Math.floor((Date.now() - activeCycle.startDate.getTime()) / 86400000));

    const muscleCounts = new Map<string, number>();
    for (const w of chartWorkouts) {
        if (w.date < thirtyDaysAgo) continue;
        for (const we of w.exercises) {
            const muscles = we.exercise.muscles.length > 0 ? we.exercise.muscles : ["other"];
            const working = we.sets.filter((s) => !s.isWarmup).length;
            for (const m of muscles) muscleCounts.set(m, (muscleCounts.get(m) ?? 0) + working);
        }
    }
    const muscleData: TrendPoint[] = [...muscleCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([muscle, sets]) => ({ label: titleCase(muscle), Sets: sets }));

    const weekVolume = new Map<string, number>();
    for (const w of chartWorkouts) {
        const key = startOfWeek(w.date).toISOString().slice(0, 10);
        const vol = w.exercises.reduce((s, we) => s + we.sets.reduce((v, x) => v + setVolume(x), 0), 0);
        weekVolume.set(key, (weekVolume.get(key) ?? 0) + vol);
    }
    const volumeData: TrendPoint[] = [...weekVolume.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([week, vol]) => ({
            label: new Date(week).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
            Volume: Math.round(weightToDisplay(vol, unitSystem)),
        }));

    return (
        <div className="flex flex-col gap-6">
            <WorkoutsHero templates={templates.map((t) => ({ id: t.id, name: t.name }))} />

            {activeCycle && (
                <Card className="flex flex-wrap items-center justify-between gap-3 bg-secondary_subtle">
                    <div className="flex items-center gap-3">
                        <Badge color={PHASE_COLOR[activeCycle.phase]} size="lg">
                            {PHASE_LABEL[activeCycle.phase]}
                        </Badge>
                        <div>
                            <p className="text-sm font-semibold text-primary">Active training cycle</p>
                            <p className="text-xs text-tertiary">
                                Day {cycleDays + 1} · started {activeCycle.startDate.toLocaleDateString()}
                                {activeCycle.endDate ? ` · ends ${activeCycle.endDate.toLocaleDateString()}` : ""}
                            </p>
                        </div>
                    </div>
                    <Button size="sm" color="secondary" href="/workouts/body">
                        Manage cycles
                    </Button>
                </Card>
            )}

            <PlanSummaryCard plans={summaryPlans} />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat
                    label="Workouts this week"
                    value={weekWorkouts.length}
                    sub={
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span>since Monday</span>
                            <DeltaBadge delta={workoutsWowDelta} tone="directional" hideWhenEven />
                        </span>
                    }
                />
                <Stat
                    label="Volume this week"
                    value={`${Math.round(weightToDisplay(weekVol, unitSystem)).toLocaleString()} ${wU}`}
                    sub={
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span>vs last week</span>
                            <DeltaBadge delta={volumeWowDelta} unit={wU} tone="directional" hideWhenEven />
                        </span>
                    }
                />
                <Stat label="Recent PRs" value={recentPRs.length} sub="latest achievements" />
            </div>

            {weekWorkouts.length === 0 && (
                <AiSuggestionCard
                    tone="rose"
                    iconName="lightning"
                    confidence="medium"
                    title="No workouts logged this week"
                    body="You haven't trained since Monday. A single session keeps your momentum and adherence on track — even a short one counts."
                    href="/workouts/log"
                    ctaLabel="Start a session"
                />
            )}

            <WorkoutsOverviewCharts volumeData={volumeData} muscleData={muscleData} volumeUnit={wU} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <SectionHeader
                        title="Recent workouts"
                        action={
                            <Button size="sm" color="link-color" href="/workouts/log">
                                View log
                            </Button>
                        }
                    />
                    <div className="mt-4 flex flex-col gap-2">
                        {recentWorkouts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                                <FeaturedIcon icon={Activity} color="brand" theme="light" size="lg" />
                                <div className="flex flex-col gap-1">
                                    <p className="text-sm font-semibold text-primary">No workouts yet</p>
                                    <p className="text-sm text-tertiary">Start your first workout to see it here.</p>
                                </div>
                            </div>
                        ) : (
                            recentWorkouts.map((w) => {
                                const completedSets = w.exercises.reduce((s, we) => s + we.sets.filter((x) => x.completed).length, 0);
                                const vol = w.exercises.reduce((s, we) => s + we.sets.filter((x) => x.completed).reduce((v, x) => v + setVolume(x), 0), 0);
                                return (
                                    <Link
                                        key={w.id}
                                        href={`/workouts/session/${w.id}`}
                                        className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-primary">{w.name ?? "Workout"}</p>
                                            <p className="truncate text-xs text-tertiary">
                                                {w.date.toLocaleDateString()} · {w.exercises.length} exercises · {completedSets} sets
                                                {!w.endedAt && <span className="ml-1 text-warning-primary">· in progress</span>}
                                            </p>
                                        </div>
                                        <span className="shrink-0 text-xs font-medium text-tertiary">{Math.round(weightToDisplay(vol, unitSystem)).toLocaleString()} {wU}</span>
                                    </Link>
                                );
                            })
                        )}
                    </div>
                </Card>

                <Card>
                    <SectionHeader title="Recent PRs" action={<Award01 className="size-5 text-fg-quaternary" />} />
                    <div className="mt-4 flex flex-col gap-2">
                        {recentPRs.length === 0 ? (
                            <p className="text-sm text-tertiary">No personal records yet. Finish a workout to start tracking.</p>
                        ) : (
                            recentPRs.map((pr) => (
                                <div key={pr.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 ring-1 ring-secondary ring-inset">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-primary">{pr.exercise.name}</p>
                                        <p className="text-xs text-tertiary">
                                            {titleCase(pr.recordType)} · {pr.achievedOn.toLocaleDateString()}
                                        </p>
                                    </div>
                                    <span className="shrink-0 text-sm font-semibold text-brand-secondary">
                                        {pr.recordType === "reps"
                                            ? `${pr.value} reps`
                                            : pr.recordType === "time"
                                              ? formatSeconds(pr.value)
                                              : pr.recordType === "distance"
                                                ? formatMeters(pr.value)
                                                : formatWeight(pr.value, unitSystem)}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </Card>
            </div>

            <AdherenceCard plans={adherencePlans} />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Link href="/workouts/log" className="flex items-center gap-3 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset hover:bg-secondary_hover">
                    <Plus className="size-5 text-fg-brand-primary" />
                    <span className="text-sm font-semibold text-primary">Start a workout</span>
                </Link>
                <Link href="/workouts/templates" className="flex items-center gap-3 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset hover:bg-secondary_hover">
                    <Calendar className="size-5 text-fg-brand-primary" />
                    <span className="text-sm font-semibold text-primary">Manage templates</span>
                </Link>
                <Link href="/workouts/body" className="flex items-center gap-3 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset hover:bg-secondary_hover">
                    <TrendUp02 className="size-5 text-fg-brand-primary" />
                    <span className="text-sm font-semibold text-primary">Body & metrics</span>
                </Link>
            </div>
        </div>
    );
}
