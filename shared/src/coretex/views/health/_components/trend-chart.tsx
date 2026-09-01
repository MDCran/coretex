// @ts-nocheck
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
export interface TrendPoint {
    label: string;
    [key: string]: string | number | null | undefined;
}

interface SeriesDef {
    key: string;
    name: string;
    color?: string;
}

/** Respect reduced-motion; SSR-safe (defaults to animating on the server). */
const prefersReducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const ANIMATE = !prefersReducedMotion;
const ANIM_DURATION = 800;

const DEFAULT_COLORS = ["var(--color-brand-500)", "var(--color-utility-blue-500)", "var(--color-utility-pink-500)"];

/** Padded data-fit Y domain so trends fill the chart instead of starting at 0. Pad ≈ 8% of range, min 1 unit. */
const computeFitDomain = (data: TrendPoint[], series: SeriesDef[]): [number, number] | undefined => {
    const values: number[] = [];
    for (const point of data) {
        for (const s of series) {
            const v = point[s.key];
            if (typeof v === "number" && Number.isFinite(v)) values.push(v);
        }
    }
    if (!values.length) return undefined;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(1, (max - min) * 0.08);
    const lower = Math.floor(min - pad);
    const upper = Math.ceil(max + pad);
    // Don't dip below zero for non-negative measurement series (weight, hours, etc.).
    return [min >= 0 ? Math.max(0, lower) : lower, upper];
};

const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-lg bg-primary px-3 py-2 text-xs shadow-lg ring-1 ring-secondary ring-inset">
            <p className="mb-1 font-medium text-primary">{label}</p>
            {payload.map((p: any) => (
                <p key={p.dataKey} className="text-tertiary">
                    <span style={{ color: p.color }}>{p.name}</span>: <span className="font-medium text-primary">{p.value}</span>
                </p>
            ))}
        </div>
    );
};

interface TrendChartProps {
    data: TrendPoint[];
    series: SeriesDef[];
    type?: "line" | "area" | "bar";
    height?: number;
    emptyLabel?: string;
    /** Fit the Y axis to the data (with padding) instead of starting at 0. Use for line/area trends of measurements; bars should stay zero-based. */
    fitDomain?: boolean;
}

/** Reusable recharts wrapper for health trends. Renders an empty state when no data. */
export const TrendChart = ({ data, series, type = "line", height = 240, emptyLabel = "No data yet", fitDomain = false }: TrendChartProps) => {
    if (!data.length) {
        return (
            <div
                className="flex items-center justify-center overflow-hidden rounded-lg bg-secondary_subtle ring-1 ring-secondary ring-inset"
                style={{ height }}
            >
                <div className="px-4 text-center">
                    <p className="text-sm font-medium text-secondary">{emptyLabel}</p>
                    <p className="mt-1 text-xs text-tertiary">Log some entries to see your trend.</p>
                </div>
            </div>
        );
    }

    const axisProps = {
        stroke: "var(--color-border-tertiary)",
        tick: { fill: "var(--color-text-tertiary)", fontSize: 11 },
        tickLine: false,
    };
    const yDomain = fitDomain && type !== "bar" ? computeFitDomain(data, series) : undefined;

    return (
        <ResponsiveContainer width="100%" height={height}>
            {type === "bar" ? (
                <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--color-bg-secondary)" }} />
                    {series.map((s, i) => (
                        <Bar
                            key={s.key}
                            dataKey={s.key}
                            name={s.name}
                            fill={s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                            radius={[4, 4, 0, 0]}
                            isAnimationActive={ANIMATE}
                            animationBegin={i * 120}
                            animationDuration={ANIM_DURATION}
                            animationEasing="ease-out"
                        />
                    ))}
                </BarChart>
            ) : type === "area" ? (
                <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis {...axisProps} domain={yDomain} />
                    <Tooltip content={<ChartTooltip />} />
                    {series.map((s, i) => (
                        <Area
                            key={s.key}
                            dataKey={s.key}
                            name={s.name}
                            type="monotone"
                            stroke={s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                            fill={s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                            fillOpacity={0.15}
                            strokeWidth={2}
                            connectNulls
                            dot={false}
                            isAnimationActive={ANIMATE}
                            animationBegin={i * 120}
                            animationDuration={ANIM_DURATION}
                            animationEasing="ease-out"
                        />
                    ))}
                </AreaChart>
            ) : (
                <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis {...axisProps} domain={yDomain} />
                    <Tooltip content={<ChartTooltip />} />
                    {series.map((s, i) => (
                        <Line
                            key={s.key}
                            dataKey={s.key}
                            name={s.name}
                            type="monotone"
                            stroke={s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 5 }}
                            connectNulls
                            isAnimationActive={ANIMATE}
                            animationBegin={i * 120}
                            animationDuration={ANIM_DURATION}
                            animationEasing="ease-out"
                        />
                    ))}
                </LineChart>
            )}
        </ResponsiveContainer>
    );
};
