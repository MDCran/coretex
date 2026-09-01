// @ts-nocheck

import { cx } from "@/utils/cx";
import { Card, SectionHeader } from "./workouts-ui";
import { useState, useMemo } from "react";
import { Button, Cell } from "react-aria-components";
import { ResponsiveContainer, BarChart, XAxis, Bar } from "recharts";

type SerializablePlan = { date: string; skipped: boolean; workoutId: string | null; hasWorkoutOnDate: boolean };

export function AdherenceCard({ plans }: { plans: SerializablePlan[] }) {
    const [range, setRange] = useState<AdherenceRangeId>("30d");
    const planLikes: PlanLike[] = useMemo(() => plans, [plans]);

    const rangeDef = ADHERENCE_RANGES.find((r) => r.id === range)!;
    const cutoff = useMemo(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - rangeDef.days);
        return d;
    }, [rangeDef.days]);

    const inRange = useMemo(() => planLikes.filter((p) => new Date(p.date) >= cutoff), [planLikes, cutoff]);
    const rate = useMemo(() => completionRate(inRange), [inRange]);
    const streak = useMemo(() => completedStreak(planLikes), [planLikes]);
    const weekData = useMemo(() => weeklyAdherence(planLikes, 6), [planLikes]);

    const hasPlans = planLikes.length > 0;

    return (
        <Card>
            <SectionHeader
                title="Plan adherence"
                action={
                    <Button size="sm" color="link-color" href="/workouts/schedule">
                        Schedule
                    </Button>
                }
            />

            {!hasPlans ? (
                <div className="mt-4 flex flex-col items-start gap-2">
                    <p className="text-sm text-tertiary">No planned workouts yet. Schedule ahead to track adherence.</p>
                    <Button size="sm" color="secondary" href="/workouts/schedule">
                        Plan a workout
                    </Button>
                </div>
            ) : (
                <>
                    <div className="mt-3 inline-flex rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset">
                        {ADHERENCE_RANGES.map((r) => (
                            <button
                                key={r.id}
                                type="button"
                                onClick={() => setRange(r.id)}
                                className={cx(
                                    "rounded-md px-2 py-1 text-xs font-semibold transition duration-100 ease-linear",
                                    range === r.id ? "bg-primary text-primary shadow-xs" : "text-tertiary hover:text-secondary",
                                )}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>

                    <div className="mt-4 flex items-end justify-between gap-4">
                        <div>
                            <p className="text-display-sm font-semibold text-primary">{rate.pct}%</p>
                            <p className="text-xs text-tertiary">
                                {rate.done}/{rate.countable} completed
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-display-sm font-semibold text-brand-secondary">{streak}</p>
                            <p className="text-xs text-tertiary">plan streak</p>
                        </div>
                    </div>

                    <div className="mt-4">
                        <ResponsiveContainer width="100%" height={90}>
                            <BarChart data={weekData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barGap={1}>
                                <XAxis dataKey="label" hide />
                                <Bar dataKey="planned" fill="var(--color-bg-quaternary)" radius={[3, 3, 0, 0]} />
                                <Bar dataKey="completed" radius={[3, 3, 0, 0]}>
                                    {weekData.map((_, i) => (
                                        <Cell key={i} fill="var(--color-bg-success-solid)" />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                        <p className="mt-1 text-center text-[10px] tracking-wide text-quaternary uppercase">Last 6 weeks · planned vs completed</p>
                    </div>
                </>
            )}
        </Card>
    );
}
