"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Target04, TrendUp02, Zap } from "@untitledui/icons";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import {
    ADHERENCE_RANGES,
    type AdherenceRangeId,
    completedStreak,
    completionRate,
    type PlanLike,
    weeklyAdherence,
} from "@/lib/workouts-schedule";
import { cx } from "@/utils/cx";
import { Card } from "../../_components/workouts-ui";

type SerializablePlan = { date: string; skipped: boolean; workoutId: string | null; hasWorkoutOnDate: boolean };

const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-lg bg-primary px-3 py-2 text-xs shadow-lg ring-1 ring-secondary ring-inset">
            <p className="mb-1 font-medium text-primary">Week of {label}</p>
            {payload.map((p: any) => (
                <p key={p.dataKey} className="text-tertiary">
                    <span style={{ color: p.color }}>{p.name}</span>: <span className="font-medium text-primary">{p.value}</span>
                </p>
            ))}
        </div>
    );
};

export function AdherenceStats({ plans }: { plans: SerializablePlan[] }) {
    const [range, setRange] = useState<AdherenceRangeId>("30d");

    const planLikes: PlanLike[] = useMemo(() => plans.map((p) => ({ date: p.date, skipped: p.skipped, workoutId: p.workoutId, hasWorkoutOnDate: p.hasWorkoutOnDate })), [plans]);

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
    const weeks = range === "7d" ? 4 : range === "30d" ? 6 : range === "90d" ? 12 : 12;
    const weekData = useMemo(() => weeklyAdherence(planLikes, weeks), [planLikes, weeks]);

    return (
        <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-primary">Adherence</h2>
                <div className="inline-flex rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset">
                    {ADHERENCE_RANGES.map((r) => (
                        <button
                            key={r.id}
                            type="button"
                            onClick={() => setRange(r.id)}
                            className={cx(
                                "rounded-md px-2.5 py-1 text-xs font-semibold transition duration-100 ease-linear",
                                range === r.id ? "bg-primary text-primary shadow-xs" : "text-tertiary hover:text-secondary",
                            )}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex items-center gap-3 rounded-xl bg-secondary_subtle p-4">
                    <FeaturedIcon icon={Target04} color="brand" theme="light" size="md" />
                    <div>
                        <p className="text-display-xs font-semibold text-primary">{rate.pct}%</p>
                        <p className="text-xs text-tertiary">
                            {rate.done}/{rate.countable} completed
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-secondary_subtle p-4">
                    <FeaturedIcon icon={Zap} color="warning" theme="light" size="md" />
                    <div>
                        <p className="text-display-xs font-semibold text-primary">{streak}</p>
                        <p className="text-xs text-tertiary">plan streak</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-secondary_subtle p-4">
                    <FeaturedIcon icon={TrendUp02} color="success" theme="light" size="md" />
                    <div>
                        <p className="text-display-xs font-semibold text-primary">{inRange.length}</p>
                        <p className="text-xs text-tertiary">plans in range</p>
                    </div>
                </div>
            </div>

            <div className="mt-5">
                <p className="mb-2 text-xs font-semibold tracking-wide text-quaternary uppercase">Planned vs completed by week</p>
                <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={weekData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }} barGap={2}>
                        <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" strokeDasharray="3 3" />
                        <XAxis dataKey="label" stroke="var(--color-border-tertiary)" tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }} tickLine={false} />
                        <YAxis allowDecimals={false} stroke="var(--color-border-tertiary)" tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }} tickLine={false} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--color-bg-secondary)" }} />
                        <Bar dataKey="planned" name="Planned" fill="var(--color-bg-quaternary)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="completed" name="Completed" radius={[4, 4, 0, 0]}>
                            {weekData.map((_, i) => (
                                <Cell key={i} fill="var(--color-bg-success-solid)" />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}
