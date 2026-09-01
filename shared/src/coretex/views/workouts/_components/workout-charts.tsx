"use client";

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    PolarAngleAxis,
    PolarGrid,
    Radar,
    RadarChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

const COLORS = {
    brand: "var(--color-fg-brand-primary)",
    blue: "var(--color-utility-blue-500)",
    green: "var(--color-utility-green-500)",
    orange: "var(--color-utility-orange-500)",
    grid: "var(--color-border-tertiary)",
    text: "var(--color-text-tertiary)",
    cursor: "var(--color-bg-secondary)",
} as const;

const ANIMATION_DURATION = 700;

const TOOLTIP_STYLE: CSSProperties = {
    backgroundColor: "var(--color-bg-primary)",
    border: "1px solid var(--color-border-secondary)",
    borderRadius: 8,
    boxShadow: "var(--shadow-lg)",
    color: "var(--color-text-primary)",
    fontSize: 12,
};

const TOOLTIP_LABEL_STYLE: CSSProperties = {
    color: "var(--color-text-primary)",
    fontWeight: 600,
};

const LEGEND_STYLE: CSSProperties = {
    color: COLORS.text,
    fontSize: 12,
};

const AXIS_TICK = { fill: COLORS.text, fontSize: 11 } as const;

interface CommonChartProps {
    /** Accessible name for the chart region. */
    ariaLabel?: string;
    /** Pixel height of the responsive plot area. */
    height?: number;
    /** Primary copy shown when there are no meaningful values. */
    emptyTitle?: string;
    /** Supporting empty-state copy. */
    emptyDescription?: string;
}

export interface WorkoutWeeklyVolumePoint {
    label: string;
    volume: number;
    workouts?: number | null;
    workingSets?: number | null;
}

export interface WorkoutWeeklyVolumeChartProps extends CommonChartProps {
    data: WorkoutWeeklyVolumePoint[];
    unit: string;
}

export interface WorkoutMuscleBalancePoint {
    muscle: string;
    sets: number;
}

export interface WorkoutMuscleBalanceChartProps extends CommonChartProps {
    data: WorkoutMuscleBalancePoint[];
    /** Auto uses radar for three or more muscles and horizontal bars otherwise. */
    variant?: "auto" | "radar" | "bar";
}

export interface WorkoutSchedulePoint {
    label: string;
    planned: number;
    completed: number;
}

export interface WorkoutScheduleChartProps extends CommonChartProps {
    data: WorkoutSchedulePoint[];
}

export interface WorkoutBodyTrendPoint {
    label: string;
    weight: number | null;
    bodyFatPct: number | null;
}

export interface WorkoutBodyTrendsChartProps extends CommonChartProps {
    data: WorkoutBodyTrendPoint[];
    weightUnit: string;
}

export interface WorkoutProgressWeightPoint {
    label: string;
    weight: number;
}

export interface WorkoutProgressWeightChartProps extends CommonChartProps {
    data: WorkoutProgressWeightPoint[];
    weightUnit: string;
}

function useChartAnimation(): boolean {
    const [animate, setAnimate] = useState(false);

    useEffect(() => {
        const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
        if (!media) {
            setAnimate(true);
            return;
        }

        const sync = () => setAnimate(!media.matches);
        sync();
        media.addEventListener("change", sync);
        return () => media.removeEventListener("change", sync);
    }, []);

    return animate;
}

function useGradientId(prefix: string): string {
    return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function finite(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegative(value: unknown): number {
    return Math.max(0, finite(value) ?? 0);
}

function formatNumber(value: unknown, digits = 0): string {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(finite(value) ?? 0);
}

function compactNumber(value: unknown): string {
    return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(finite(value) ?? 0);
}

function paddedDomain(values: Array<number | null | undefined>, floor = 0, ceiling?: number): [number, number] | undefined {
    const available = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (available.length === 0) return undefined;

    const minimum = Math.min(...available);
    const maximum = Math.max(...available);
    const spread = maximum - minimum;
    const padding = Math.max(spread * 0.12, Math.abs(maximum || minimum) * 0.02, 0.5);
    const lower = Math.max(floor, minimum - padding);
    const upper = ceiling === undefined ? maximum + padding : Math.min(ceiling, maximum + padding);
    return [Math.floor(lower * 10) / 10, Math.ceil(Math.max(upper, lower + 1) * 10) / 10];
}

function ChartFrame({
    ariaLabel,
    summary,
    height,
    hasData,
    emptyTitle,
    emptyDescription,
    children,
}: {
    ariaLabel: string;
    summary: string;
    height: number;
    hasData: boolean;
    emptyTitle: string;
    emptyDescription: string;
    children: (animate: boolean) => ReactNode;
}) {
    const animate = useChartAnimation();

    if (!hasData) {
        return (
            <div
                role="status"
                aria-label={ariaLabel}
                className="flex items-center justify-center rounded-lg border border-dashed border-secondary bg-secondary_subtle px-5 text-center"
                style={{ height }}
            >
                <div>
                    <p className="text-sm font-medium text-secondary">{emptyTitle}</p>
                    <p className="mt-1 text-xs text-tertiary">{emptyDescription}</p>
                </div>
            </div>
        );
    }

    return (
        <figure className="min-w-0">
            <div role="img" aria-label={ariaLabel} className="min-w-0" style={{ height }}>
                {children(animate)}
            </div>
            <figcaption className="sr-only">{summary}</figcaption>
        </figure>
    );
}

function baseXAxisProps() {
    return {
        axisLine: false,
        interval: "preserveStartEnd" as const,
        minTickGap: 28,
        tick: AXIS_TICK,
        tickLine: false,
        tickMargin: 8,
    };
}

function baseYAxisProps() {
    return {
        axisLine: false,
        tick: AXIS_TICK,
        tickLine: false,
        tickMargin: 6,
    };
}

function chartTooltip(formatter: (value: unknown, name: unknown) => [string, string]) {
    return (
        <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: COLORS.cursor, opacity: 0.55 }}
            itemStyle={{ color: "var(--color-text-secondary)" }}
            labelStyle={TOOLTIP_LABEL_STYLE}
            formatter={formatter}
        />
    );
}

/** Weekly lifted volume as a zero-based area chart. */
export function WorkoutWeeklyVolumeChart({
    data,
    unit,
    ariaLabel = `Weekly training volume in ${unit}`,
    height = 260,
    emptyTitle = "No weekly volume yet",
    emptyDescription = "Complete weighted sets to start this trend.",
}: WorkoutWeeklyVolumeChartProps) {
    const gradientId = useGradientId("workout-volume-fill");
    const points = data.map((point) => ({ ...point, volume: nonNegative(point.volume) }));
    const latest = points.at(-1);

    return (
        <ChartFrame
            ariaLabel={ariaLabel}
            summary={`${points.length} weekly points. Latest: ${latest ? `${formatNumber(latest.volume, 1)} ${unit}` : "no value"}.`}
            height={height}
            hasData={points.some((point) => point.volume > 0)}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
        >
            {(animate) => (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height }}>
                    <AreaChart data={points} margin={{ top: 10, right: 12, bottom: 2, left: 0 }} accessibilityLayer>
                        <defs>
                            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={COLORS.brand} stopOpacity={0.35} />
                                <stop offset="100%" stopColor={COLORS.brand} stopOpacity={0.03} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke={COLORS.grid} />
                        <XAxis dataKey="label" {...baseXAxisProps()} />
                        <YAxis {...baseYAxisProps()} domain={[0, "auto"]} width={52} tickFormatter={compactNumber} />
                        {chartTooltip((value) => [`${formatNumber(value, 1)} ${unit}`, "Volume"])}
                        <Area
                            dataKey="volume"
                            name="Volume"
                            type="monotone"
                            stroke={COLORS.brand}
                            strokeWidth={2}
                            fill={`url(#${gradientId})`}
                            dot={false}
                            activeDot={{ r: 4 }}
                            isAnimationActive={animate}
                            animationDuration={ANIMATION_DURATION}
                            animationEasing="ease-out"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            )}
        </ChartFrame>
    );
}

/** Working-set distribution by primary muscle. */
export function WorkoutMuscleBalanceChart({
    data,
    variant = "auto",
    ariaLabel = "Working sets by muscle group",
    height = 280,
    emptyTitle = "No muscle balance data yet",
    emptyDescription = "Complete working sets to see how training is distributed.",
}: WorkoutMuscleBalanceChartProps) {
    const points = data
        .map((point) => ({ muscle: point.muscle, sets: nonNegative(point.sets) }))
        .filter((point) => point.muscle.trim().length > 0)
        .sort((left, right) => right.sets - left.sets);
    const useRadar = variant === "radar" || (variant === "auto" && points.length >= 3);
    const leader = points[0];

    return (
        <ChartFrame
            ariaLabel={ariaLabel}
            summary={`${points.length} muscle groups. ${leader ? `${leader.muscle} leads with ${formatNumber(leader.sets)} sets.` : "No working sets."}`}
            height={height}
            hasData={points.some((point) => point.sets > 0)}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
        >
            {(animate) => (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height }}>
                    {useRadar ? (
                        <RadarChart data={points} outerRadius="68%" margin={{ top: 16, right: 26, bottom: 16, left: 26 }} accessibilityLayer>
                            <PolarGrid stroke={COLORS.grid} />
                            <PolarAngleAxis dataKey="muscle" tick={AXIS_TICK} />
                            <Tooltip
                                contentStyle={TOOLTIP_STYLE}
                                itemStyle={{ color: "var(--color-text-secondary)" }}
                                labelStyle={TOOLTIP_LABEL_STYLE}
                                formatter={(value) => [`${formatNumber(value)} sets`, "Working sets"]}
                            />
                            <Radar
                                dataKey="sets"
                                name="Working sets"
                                stroke={COLORS.brand}
                                strokeWidth={2}
                                fill={COLORS.brand}
                                fillOpacity={0.2}
                                isAnimationActive={animate}
                                animationDuration={ANIMATION_DURATION}
                                animationEasing="ease-out"
                            />
                        </RadarChart>
                    ) : (
                        <BarChart data={points} layout="vertical" margin={{ top: 8, right: 16, bottom: 4, left: 8 }} accessibilityLayer>
                            <CartesianGrid horizontal={false} stroke={COLORS.grid} />
                            <XAxis type="number" allowDecimals={false} {...baseXAxisProps()} />
                            <YAxis type="category" dataKey="muscle" width={96} {...baseYAxisProps()} />
                            {chartTooltip((value) => [`${formatNumber(value)} sets`, "Working sets"])}
                            <Bar
                                dataKey="sets"
                                name="Working sets"
                                fill={COLORS.brand}
                                radius={[0, 4, 4, 0]}
                                isAnimationActive={animate}
                                animationDuration={ANIMATION_DURATION}
                                animationEasing="ease-out"
                            />
                        </BarChart>
                    )}
                </ResponsiveContainer>
            )}
        </ChartFrame>
    );
}

/** Planned versus completed sessions by week. */
export function WorkoutScheduleChart({
    data,
    ariaLabel = "Planned and completed workouts by week",
    height = 250,
    emptyTitle = "No schedule activity yet",
    emptyDescription = "Schedule a session to begin tracking weekly adherence.",
}: WorkoutScheduleChartProps) {
    const points = data.map((point) => ({ ...point, planned: nonNegative(point.planned), completed: nonNegative(point.completed) }));
    const plannedTotal = points.reduce((sum, point) => sum + point.planned, 0);
    const completedTotal = points.reduce((sum, point) => sum + point.completed, 0);

    return (
        <ChartFrame
            ariaLabel={ariaLabel}
            summary={`${formatNumber(plannedTotal)} planned and ${formatNumber(completedTotal)} completed sessions across ${points.length} weeks.`}
            height={height}
            hasData={plannedTotal > 0 || completedTotal > 0}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
        >
            {(animate) => (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height }}>
                    <BarChart data={points} barGap={4} margin={{ top: 8, right: 12, bottom: 2, left: 0 }} accessibilityLayer>
                        <CartesianGrid vertical={false} stroke={COLORS.grid} />
                        <XAxis dataKey="label" {...baseXAxisProps()} />
                        <YAxis allowDecimals={false} width={34} {...baseYAxisProps()} />
                        {chartTooltip((value, name) => [`${formatNumber(value)} sessions`, String(name)])}
                        <Legend iconType="circle" iconSize={8} wrapperStyle={LEGEND_STYLE} />
                        <Bar
                            dataKey="planned"
                            name="Planned"
                            fill={COLORS.orange}
                            radius={[4, 4, 0, 0]}
                            isAnimationActive={animate}
                            animationDuration={ANIMATION_DURATION}
                            animationEasing="ease-out"
                        />
                        <Bar
                            dataKey="completed"
                            name="Completed"
                            fill={COLORS.green}
                            radius={[4, 4, 0, 0]}
                            isAnimationActive={animate}
                            animationDuration={ANIMATION_DURATION}
                            animationEasing="ease-out"
                        />
                    </BarChart>
                </ResponsiveContainer>
            )}
        </ChartFrame>
    );
}

/** Weight and body-fat trends with separate unit-aware axes. */
export function WorkoutBodyTrendsChart({
    data,
    weightUnit,
    ariaLabel = `Body weight in ${weightUnit} and body-fat percentage over time`,
    height = 280,
    emptyTitle = "No body trends yet",
    emptyDescription = "Add weight or body-fat measurements to see change over time.",
}: WorkoutBodyTrendsChartProps) {
    const points = data.map((point) => ({
        ...point,
        weight: finite(point.weight),
        bodyFatPct: finite(point.bodyFatPct),
    }));
    const weights = points.map((point) => point.weight);
    const bodyFat = points.map((point) => point.bodyFatPct);
    const hasWeight = weights.some((value) => value !== null && value > 0);
    const hasBodyFat = bodyFat.some((value) => value !== null && value >= 0);
    const latest = [...points].reverse().find((point) => point.weight !== null || point.bodyFatPct !== null);

    return (
        <ChartFrame
            ariaLabel={ariaLabel}
            summary={`Latest measurement${latest ? ` on ${latest.label}: ${latest.weight === null ? "no weight" : `${formatNumber(latest.weight, 1)} ${weightUnit}`}, ${latest.bodyFatPct === null ? "no body-fat value" : `${formatNumber(latest.bodyFatPct, 1)}% body fat`}` : ": none"}.`}
            height={height}
            hasData={hasWeight || hasBodyFat}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
        >
            {(animate) => (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height }}>
                    <LineChart data={points} margin={{ top: 8, right: hasBodyFat ? 4 : 12, bottom: 2, left: 0 }} accessibilityLayer>
                        <CartesianGrid vertical={false} stroke={COLORS.grid} />
                        <XAxis dataKey="label" {...baseXAxisProps()} />
                        {hasWeight && (
                            <YAxis
                                yAxisId="weight"
                                width={50}
                                domain={paddedDomain(weights)}
                                tickFormatter={(value) => formatNumber(value, 1)}
                                {...baseYAxisProps()}
                            />
                        )}
                        {hasBodyFat && (
                            <YAxis
                                yAxisId="bodyFat"
                                orientation="right"
                                width={42}
                                domain={paddedDomain(bodyFat, 0, 100)}
                                tickFormatter={(value) => `${formatNumber(value)}%`}
                                {...baseYAxisProps()}
                            />
                        )}
                        {chartTooltip((value, name) => [
                            String(name) === "Body fat" ? `${formatNumber(value, 1)}%` : `${formatNumber(value, 1)} ${weightUnit}`,
                            String(name),
                        ])}
                        <Legend iconType="circle" iconSize={8} wrapperStyle={LEGEND_STYLE} />
                        {hasWeight && (
                            <Line
                                yAxisId="weight"
                                dataKey="weight"
                                name="Weight"
                                type="monotone"
                                stroke={COLORS.brand}
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 4 }}
                                connectNulls
                                isAnimationActive={animate}
                                animationDuration={ANIMATION_DURATION}
                                animationEasing="ease-out"
                            />
                        )}
                        {hasBodyFat && (
                            <Line
                                yAxisId="bodyFat"
                                dataKey="bodyFatPct"
                                name="Body fat"
                                type="monotone"
                                stroke={COLORS.orange}
                                strokeWidth={2}
                                strokeDasharray="5 4"
                                dot={false}
                                activeDot={{ r: 4 }}
                                connectNulls
                                isAnimationActive={animate}
                                animationDuration={ANIMATION_DURATION}
                                animationEasing="ease-out"
                            />
                        )}
                    </LineChart>
                </ResponsiveContainer>
            )}
        </ChartFrame>
    );
}

/** Body-weight trend used alongside progress photos. */
export function WorkoutProgressWeightChart({
    data,
    weightUnit,
    ariaLabel = `Progress timeline weight in ${weightUnit}`,
    height = 250,
    emptyTitle = "No progress weight trend yet",
    emptyDescription = "Add a weight measurement or progress-photo weight to begin.",
}: WorkoutProgressWeightChartProps) {
    const gradientId = useGradientId("workout-progress-weight-fill");
    const points = data.map((point) => ({ ...point, weight: nonNegative(point.weight) }));
    const latest = points.at(-1);

    return (
        <ChartFrame
            ariaLabel={ariaLabel}
            summary={`${points.length} weight points. Latest: ${latest ? `${formatNumber(latest.weight, 1)} ${weightUnit}` : "no value"}.`}
            height={height}
            hasData={points.some((point) => point.weight > 0)}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
        >
            {(animate) => (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height }}>
                    <AreaChart data={points} margin={{ top: 10, right: 12, bottom: 2, left: 0 }} accessibilityLayer>
                        <defs>
                            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={COLORS.blue} stopOpacity={0.3} />
                                <stop offset="100%" stopColor={COLORS.blue} stopOpacity={0.03} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke={COLORS.grid} />
                        <XAxis dataKey="label" {...baseXAxisProps()} />
                        <YAxis
                            width={50}
                            domain={paddedDomain(points.map((point) => point.weight))}
                            tickFormatter={(value) => formatNumber(value, 1)}
                            {...baseYAxisProps()}
                        />
                        {chartTooltip((value) => [`${formatNumber(value, 1)} ${weightUnit}`, "Weight"])}
                        <Area
                            dataKey="weight"
                            name="Weight"
                            type="monotone"
                            stroke={COLORS.blue}
                            strokeWidth={2}
                            fill={`url(#${gradientId})`}
                            dot={false}
                            activeDot={{ r: 4 }}
                            isAnimationActive={animate}
                            animationDuration={ANIMATION_DURATION}
                            animationEasing="ease-out"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            )}
        </ChartFrame>
    );
}
