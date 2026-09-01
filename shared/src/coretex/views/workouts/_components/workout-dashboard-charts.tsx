"use client";

import type { ReactNode } from "react";
import {
    WorkoutBodyTrendsChart,
    WorkoutMuscleBalanceChart,
    WorkoutProgressWeightChart,
    WorkoutScheduleChart,
    WorkoutWeeklyVolumeChart,
    type WorkoutBodyTrendPoint,
    type WorkoutMuscleBalancePoint,
    type WorkoutProgressWeightPoint,
    type WorkoutSchedulePoint,
    type WorkoutWeeklyVolumePoint,
} from "./workout-charts";

export {
    WorkoutBodyTrendsChart,
    WorkoutMuscleBalanceChart,
    WorkoutProgressWeightChart,
    WorkoutScheduleChart,
    WorkoutWeeklyVolumeChart,
};
export type {
    WorkoutBodyTrendPoint,
    WorkoutBodyTrendsChartProps,
    WorkoutMuscleBalanceChartProps,
    WorkoutMuscleBalancePoint,
    WorkoutProgressWeightChartProps,
    WorkoutProgressWeightPoint,
    WorkoutScheduleChartProps,
    WorkoutSchedulePoint,
    WorkoutWeeklyVolumeChartProps,
    WorkoutWeeklyVolumePoint,
} from "./workout-charts";

interface WeeklyTrainingLike {
    week: string;
    volume: number;
    workouts?: number | null;
    workingSets?: number | null;
}

interface MuscleBalanceLike {
    muscle: string;
    sets: number;
}

interface SchedulePlanLike {
    date: string;
    status: string;
}

interface BodyMeasurementLike {
    date: string;
    displayWeight: number | null;
    bodyFatPct: number | null;
}

interface ProgressWeightLike {
    date: string;
    displayWeight: number;
}

function ChartPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    return (
        <section className="min-w-0 rounded-xl border border-secondary bg-primary shadow-xs">
            <div className="border-b border-secondary px-5 py-4">
                <h2 className="text-md font-semibold text-primary">{title}</h2>
                <p className="mt-0.5 text-xs text-tertiary">{description}</p>
            </div>
            <div className="min-w-0 p-5">{children}</div>
        </section>
    );
}

function parseDate(value: string): Date | null {
    const bareDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const date = bareDate
        ? new Date(Number(bareDate[1]), Number(bareDate[2]) - 1, Number(bareDate[3]), 12)
        : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function shortDate(value: string): string {
    const date = parseDate(value);
    return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : value;
}

function localDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function weekKey(value: string): string | null {
    const date = parseDate(value);
    if (!date) return null;
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return localDateKey(date);
}

export function TrainingOverviewCharts({
    weeklyTraining,
    muscleBalance,
    weightUnit,
}: {
    weeklyTraining: WeeklyTrainingLike[];
    muscleBalance: MuscleBalanceLike[];
    weightUnit: string;
}) {
    const volumeData: WorkoutWeeklyVolumePoint[] = weeklyTraining.slice(-8).map((row) => ({
        label: shortDate(row.week),
        volume: row.volume,
        workouts: row.workouts,
        workingSets: row.workingSets,
    }));
    const muscleData: WorkoutMuscleBalancePoint[] = muscleBalance.map((row) => ({ muscle: row.muscle, sets: row.sets }));

    return (
        <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
            <ChartPanel title={`Weekly volume (${weightUnit})`} description="Completed weighted-set volume across the last eight weeks.">
                <WorkoutWeeklyVolumeChart data={volumeData} unit={weightUnit} />
            </ChartPanel>
            <ChartPanel title="Muscle balance · last 30 days" description="Completed working sets grouped by primary muscle.">
                <WorkoutMuscleBalanceChart data={muscleData} />
            </ChartPanel>
        </div>
    );
}

export function ScheduleAdherenceChart({ plans }: { plans: SchedulePlanLike[] }) {
    const weeks = new Map<string, WorkoutSchedulePoint>();
    for (const plan of plans) {
        const key = weekKey(plan.date);
        if (!key) continue;
        const row = weeks.get(key) ?? { label: shortDate(key), planned: 0, completed: 0 };
        row.planned += 1;
        if (plan.status.toLowerCase() === "completed") row.completed += 1;
        weeks.set(key, row);
    }
    const data = [...weeks.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(-8)
        .map(([, row]) => row);

    return (
        <ChartPanel title="Schedule adherence" description="Planned sessions compared with completions by week.">
            <WorkoutScheduleChart data={data} />
        </ChartPanel>
    );
}

export function BodyCompositionCharts({
    measurements,
    weightUnit,
}: {
    measurements: BodyMeasurementLike[];
    weightUnit: string;
}) {
    const data: WorkoutBodyTrendPoint[] = [...measurements]
        .sort((left, right) => left.date.localeCompare(right.date))
        .slice(-24)
        .map((row) => ({ label: shortDate(row.date), weight: row.displayWeight, bodyFatPct: row.bodyFatPct }));

    return (
        <ChartPanel title="Body composition trend" description="Weight and body-fat measurements over your latest check-ins.">
            <WorkoutBodyTrendsChart data={data} weightUnit={weightUnit} />
        </ChartPanel>
    );
}

export function ProgressWeightChart({
    weightSeries,
    weightUnit,
}: {
    weightSeries: ProgressWeightLike[];
    weightUnit: string;
}) {
    const data: WorkoutProgressWeightPoint[] = weightSeries.slice(-24).map((row) => ({
        label: shortDate(row.date),
        weight: row.displayWeight,
    }));

    return (
        <ChartPanel title={`Weight alongside progress (${weightUnit})`} description="Body-weight entries and weights captured with progress photos.">
            <WorkoutProgressWeightChart data={data} weightUnit={weightUnit} />
        </ChartPanel>
    );
}
