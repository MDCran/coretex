// @ts-nocheck






import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Card, PageHeader, SectionHeader } from "../_components/workouts-ui";
import { StartWorkoutButtons } from "../_components/start-workout-buttons";
import { LogDatePicker } from "./_components/log-date-picker";
import { DeleteWorkoutButton } from "./_components/delete-workout-button";
import { DayPlanCard } from "./_components/day-plan-card";
import { WorkoutStatusBadge } from "./_components/workout-status-badge";
import { db } from "@/lib/db";

export default async function WorkoutLogPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
    const user = await requireUser();
    const sp = await searchParams;
    const dateKey = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : toDateKey(new Date());

    const [workouts, templates, schedules] = await Promise.all([
        db.workout.findMany({
            where: { userId: user.id, deletedAt: null, isQuickLog: false, date: dateKeyToUtc(dateKey) },
            orderBy: { createdAt: "asc" },
            include: { exercises: { include: { sets: true, exercise: { select: { name: true } } } } },
        }),
        db.template.findMany({ where: { userId: user.id, archived: false }, orderBy: { updatedAt: "desc" } }),
        db.workoutSchedule.findMany({
            where: { userId: user.id, date: dateKeyToUtc(dateKey) },
            orderBy: { createdAt: "asc" },
            include: { template: { select: { name: true } } },
        }),
    ]);

    const settings = await db.settings.findUnique({ where: { userId: user.id } });
    const unitSystem = settings?.unitSystem ?? "IMPERIAL";
    const wU = weightUnit(unitSystem);

    const hasWorkoutOnDate = workouts.length > 0;
    const dayPlans = schedules.map((s) => ({
        id: s.id,
        name: s.name,
        templateName: s.template?.name ?? null,
        notes: s.notes,
        workoutId: s.workoutId,
        skipped: s.skipped,
        status: planStatus({ date: s.date, skipped: s.skipped, workoutId: s.workoutId, hasWorkoutOnDate }),
    }));

    return (
        <div className="flex flex-col gap-6">
            <PageHeader title="Workout log" description="Pick a day, then start an empty session or load a template to log your sets." />

            <div className="flex flex-wrap items-center justify-between gap-3">
                <LogDatePicker dateKey={dateKey} />
                <StartWorkoutButtons dateKey={dateKey} templates={templates.map((t) => ({ id: t.id, name: t.name }))} />
            </div>

            <DayPlanCard plans={dayPlans} />

            <Card>
                <SectionHeader title={`Workouts on ${dateKeyToUtc(dateKey).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`} />
                <div className="mt-4 flex flex-col gap-3">
                    {workouts.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-10 text-center">
                            <FeaturedIcon icon={Dumbbell01} color="brand" theme="light" size="lg" />
                            <div className="max-w-sm">
                                <p className="text-sm font-semibold text-primary">Nothing logged for this day</p>
                                <p className="mt-1 text-sm text-tertiary">
                                    Start an empty session or load one of your templates to begin tracking sets, reps and PRs.
                                </p>
                            </div>
                            <StartWorkoutButtons dateKey={dateKey} templates={templates.map((t) => ({ id: t.id, name: t.name }))} />
                        </div>
                    ) : (
                        workouts.map((w) => {
                            const completedSets = w.exercises.reduce((s, we) => s + we.sets.filter((x) => x.completed).length, 0);
                            const vol = w.exercises.reduce((s, we) => s + we.sets.filter((x) => x.completed).reduce((v, x) => v + setVolume(x), 0), 0);
                            return (
                                <div key={w.id} className="flex items-center justify-between gap-3 rounded-lg p-4 ring-1 ring-secondary ring-inset">
                                    <a href="#">
                                        <div className="flex items-center gap-2">
                                            <p className="truncate text-sm font-semibold text-primary">{w.name ?? "Workout"}</p>
                                            <WorkoutStatusBadge ended={!!w.endedAt} />
                                        </div>
                                        <p className="mt-0.5 truncate text-xs text-tertiary">
                                            {w.exercises.length} exercises · {completedSets} sets · {Math.round(weightToDisplay(vol, unitSystem)).toLocaleString()} {wU}
                                        </p>
                                    </a>
                                    <DeleteWorkoutButton workoutId={w.id} />
                                </div>
                            );
                        })
                    )}
                </div>
            </Card>
        </div>
    );
}
