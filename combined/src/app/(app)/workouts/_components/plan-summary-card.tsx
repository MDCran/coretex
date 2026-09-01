"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar, CalendarPlus01, PlayCircle, Trophy01, Zap } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { startScheduledWorkout } from "@/lib/actions/workouts-schedule";
import { completedStreak, type PlanLike, planStatus } from "@/lib/workouts-schedule";
import { Card } from "./workouts-ui";

type SummaryPlan = {
    id: string;
    date: string; // yyyy-mm-dd
    name: string | null;
    templateName: string | null;
    workoutId: string | null;
    skipped: boolean;
    hasWorkoutOnDate: boolean;
};

function startOfTodayLocal(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * Prominent "training plan" snapshot for the workouts dashboard: current plan
 * streak, this week's planned-vs-done, and the next planned workout with a start
 * button. Surfaces the schedule data that already exists but was buried.
 */
export function PlanSummaryCard({ plans }: { plans: SummaryPlan[] }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    const today = useMemo(startOfTodayLocal, []);
    const planLikes: PlanLike[] = useMemo(() => plans.map((p) => ({ date: p.date, skipped: p.skipped, workoutId: p.workoutId, hasWorkoutOnDate: p.hasWorkoutOnDate })), [plans]);
    const streak = useMemo(() => completedStreak(planLikes, today), [planLikes, today]);

    // This week's Monday → next Monday window.
    const weekStart = useMemo(() => {
        const d = new Date(today);
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        return d;
    }, [today]);
    const weekEnd = useMemo(() => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + 7);
        return d;
    }, [weekStart]);

    const week = useMemo(() => {
        const inWeek = plans.filter((p) => {
            const d = new Date(`${p.date}T00:00:00`);
            return d >= weekStart && d < weekEnd;
        });
        const done = inWeek.filter((p) => planStatus(p, today) === "done").length;
        return { planned: inWeek.length, done };
    }, [plans, weekStart, weekEnd, today]);

    // Next planned (upcoming, soonest) — falls back to a missed-but-startable plan.
    const next = useMemo(() => {
        const upcoming = plans
            .filter((p) => planStatus(p, today) === "upcoming")
            .sort((a, b) => a.date.localeCompare(b.date));
        if (upcoming.length > 0) return upcoming[0];
        const missed = plans
            .filter((p) => planStatus(p, today) === "missed")
            .sort((a, b) => b.date.localeCompare(a.date));
        return missed[0] ?? null;
    }, [plans, today]);

    const onStart = (id: string) =>
        startTransition(async () => {
            try {
                const wid = await startScheduledWorkout(id);
                router.push(`/workouts/session/${wid}`);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to start");
            }
        });

    const hasPlans = plans.length > 0;

    if (!hasPlans) {
        return (
            <Card className="flex flex-col items-start gap-3 bg-secondary_subtle sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <FeaturedIcon icon={Calendar} color="brand" theme="light" size="lg" />
                    <div>
                        <p className="text-sm font-semibold text-primary">Plan your training week</p>
                        <p className="text-sm text-tertiary">Schedule workouts ahead to build a streak and track adherence.</p>
                    </div>
                </div>
                <Button size="sm" color="primary" iconLeading={CalendarPlus01} href="/workouts/schedule">
                    Plan a workout
                </Button>
            </Card>
        );
    }

    const nextDate = next ? new Date(`${next.date}T00:00:00`) : null;
    const nextIsToday = next ? next.date === today.toISOString().slice(0, 10) || nextDate?.toDateString() === today.toDateString() : false;
    const nextTitle = next ? next.name || next.templateName || "Workout" : null;

    return (
        <Card className="bg-secondary_subtle">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-primary">
                    <Calendar className="size-5 text-fg-brand-primary" aria-hidden="true" />
                    Your training plan
                </h2>
                <Button size="sm" color="link-color" href="/workouts/schedule">
                    Open schedule
                </Button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                {/* Streak */}
                <div className="flex items-center gap-3 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
                    <FeaturedIcon icon={Zap} color={streak > 0 ? "warning" : "gray"} theme="light" size="md" />
                    <div>
                        <p className="text-display-xs font-semibold text-primary">{streak}</p>
                        <p className="text-xs text-tertiary">plan streak</p>
                    </div>
                </div>

                {/* This week planned vs done */}
                <div className="flex items-center gap-3 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
                    <FeaturedIcon icon={Trophy01} color="success" theme="light" size="md" />
                    <div>
                        <p className="text-display-xs font-semibold text-primary">
                            {week.done}
                            <span className="text-lg font-medium text-tertiary">/{week.planned}</span>
                        </p>
                        <p className="text-xs text-tertiary">planned done this week</p>
                    </div>
                </div>

                {/* Next planned */}
                <div className="flex flex-col justify-between gap-2 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
                    {next && nextDate ? (
                        <>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <p className="truncate text-sm font-semibold text-primary">{nextTitle}</p>
                                    {nextIsToday && (
                                        <Badge color="brand" size="sm">
                                            Today
                                        </Badge>
                                    )}
                                </div>
                                <p className="text-xs text-tertiary">
                                    Next ·{" "}
                                    {nextDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                                    {next.templateName && next.name ? ` · ${next.templateName}` : ""}
                                </p>
                            </div>
                            <Button size="sm" color="primary" iconLeading={PlayCircle} isDisabled={pending} onClick={() => onStart(next.id)}>
                                Start workout
                            </Button>
                        </>
                    ) : (
                        <>
                            <div>
                                <p className="text-sm font-semibold text-primary">No upcoming plan</p>
                                <p className="text-xs text-tertiary">Schedule your next session.</p>
                            </div>
                            <Button size="sm" color="secondary" iconLeading={CalendarPlus01} href="/workouts/schedule">
                                Plan one
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </Card>
    );
}
