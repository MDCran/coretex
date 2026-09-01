// @ts-nocheck
import { useMemo } from "react";
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Bar, AreaChart, Area, LineChart, Line, PieChart, Pie, Tooltip, Cell } from "recharts";
import { formatCompact, formatCurrency } from "../../personal/personal-ui";
import { EmptyState } from "./financial-ui";


export interface TrendPoint {
    label: string;
    [key: string]: string | number | null | undefined;
}

interface SeriesDef {
    key: string;
    name: string;
    color?: string;
}

/** Financial buckets are stored as YYYY-MM; never expose that internal form in charts. */
function chartDateLabel(value: string | undefined): string | undefined {
    if (!value || /^\s*$/.test(value) || /^\u00a0+$/.test(value)) return value;
    const month = value.match(/^(\d{4})-(\d{2})$/);
    if (month) return `${month[2]}/${month[1]}`;
    const date = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (date) return `${date[2]}/${date[3]}/${date[1]}`;
    return value;
}

/** Respect reduced-motion; SSR-safe (defaults to animating on the server). */
const prefersReducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const ANIMATE = !prefersReducedMotion;
const ANIM_DURATION = 800;

const DEFAULT_COLORS = [
    "var(--color-brand-500)",
    "var(--color-utility-blue-500)",
    "var(--color-utility-pink-500)",
    "var(--color-utility-emerald-500)",
    "var(--color-utility-orange-500)",
    "var(--color-utility-purple-500)",
    "var(--color-utility-amber-500)",
    "var(--color-utility-sky-500)",
];

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
    return [min >= 0 ? Math.max(0, lower) : lower, upper];
};

function formatTooltipValue(value: number, money: boolean, unit?: string): string {
    if (money) return `${formatCurrency(value)} USD`;
    if (unit) return `${value} ${unit}`;
    return String(value);
}

const ChartTooltip = ({ active, payload, label, money, unit }: { active?: boolean; payload?: any[]; label?: string; money?: boolean; unit?: string }) => {
    if (!active || !payload?.length) return null;
    const showLabel = label?.trim();
    return (
        <div className="rounded-lg bg-primary px-3 py-2 text-xs shadow-lg ring-1 ring-secondary ring-inset">
            {showLabel ? <p className="mb-1 font-medium text-primary">{chartDateLabel(label)}</p> : null}
            {payload.map((p: any) => (
                <p key={p.dataKey ?? p.name} className="text-tertiary">
                    <span style={{ color: p.color ?? p.payload?.fill }}>{p.name}</span>:{" "}
                    <span className="font-medium text-primary">{formatTooltipValue(Number(p.value), !!money, unit)}</span>
                </p>
            ))}
        </div>
    );
};

/** Spread a lone data point across the X axis so the chart doesn't look like a blank stub. */
function elongateSparseData(data: TrendPoint[]): TrendPoint[] {
    if (data.length !== 1) return data;
    const p = data[0];
    const clone = (label: string): TrendPoint => {
        const row: TrendPoint = { label };
        for (const [k, v] of Object.entries(p)) {
            if (k !== "label") row[k] = v;
        }
        return row;
    };
    return [clone("\u00A0"), p, clone("\u00A0\u00A0")];
}

interface TrendChartProps {
    data: TrendPoint[];
    series: SeriesDef[];
    type?: "line" | "area" | "bar";
    height?: number;
    emptyLabel?: string;
    money?: boolean;
    /** Suffix for non-money tooltips, e.g. "pts" for credit scores. */
    unit?: string;
    /** Fit the Y axis to the data (with padding) instead of starting at 0. Use for line/area trends; bars should stay zero-based. */
    fitDomain?: boolean;
    /** Called when a rendered point is selected. Bar charts attach this to each bar segment. */
    onPointClick?: (point: TrendPoint, index: number) => void;
}

const EmptyChart = ({ label, height }: { label: string; height: number }) => (
    <div className="flex items-center justify-center" style={{ height }}>
        <EmptyState title={label} description="Add some entries to see this chart." className="py-6" />
    </div>
);

/** Reusable recharts wrapper for financial trends. Renders an empty state when no data. */
export const TrendChart = ({ data, series, type = "line", height = 240, emptyLabel = "No data yet", money = true, unit, fitDomain = false, onPointClick }: TrendChartProps) => {
    const chartData = useMemo(() => elongateSparseData(data), [data]);
    const sparse = data.length <= 1;

    if (!data.length) return <EmptyChart label={emptyLabel} height={height} />;

    const axisProps = {
        stroke: "var(--color-border-tertiary)",
        tick: { fill: "var(--color-text-tertiary)", fontSize: 11 },
        tickLine: false,
    };
    const yTick = money ? (v: number) => formatCompact(v) : unit ? (v: number) => `${v}` : undefined;
    const yDomain = fitDomain && type !== "bar" ? computeFitDomain(chartData, series) : undefined;
    const tooltip = <ChartTooltip money={money} unit={unit} />;
    const showDots = sparse && type === "line";

    return (
        <ResponsiveContainer width="100%" height={height}>
            {type === "bar" ? (
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" {...axisProps} tickFormatter={chartDateLabel} hide={sparse} />
                    <YAxis {...axisProps} tickFormatter={yTick} width={56} />
                    <Tooltip content={tooltip} cursor={{ fill: "var(--color-bg-secondary)" }} />
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
                            onClick={onPointClick ? (entry: any, index: number) => onPointClick((entry?.payload ?? entry) as TrendPoint, index) : undefined}
                            style={onPointClick ? { cursor: "pointer" } : undefined}
                        />
                    ))}
                </BarChart>
            ) : type === "area" ? (
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" {...axisProps} tickFormatter={chartDateLabel} hide={sparse} />
                    <YAxis {...axisProps} tickFormatter={yTick} width={56} domain={yDomain} />
                    <Tooltip content={tooltip} />
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
                            style={{ filter: `drop-shadow(0 0 5px ${s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]})` }}
                            connectNulls
                            dot={showDots}
                            isAnimationActive={ANIMATE}
                            animationBegin={i * 120}
                            animationDuration={ANIM_DURATION}
                            animationEasing="ease-out"
                        />
                    ))}
                </AreaChart>
            ) : (
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -4 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" {...axisProps} tickFormatter={chartDateLabel} hide={sparse} />
                    <YAxis {...axisProps} tickFormatter={yTick} width={56} domain={yDomain} />
                    <Tooltip content={tooltip} />
                    {series.map((s, i) => (
                        <Line
                            key={s.key}
                            dataKey={s.key}
                            name={s.name}
                            type="monotone"
                            stroke={s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                            strokeWidth={2}
                            style={{ filter: `drop-shadow(0 0 5px ${s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]})` }}
                            dot={showDots ? { r: 4, strokeWidth: 2 } : false}
                            activeDot={showDots ? { r: 6 } : undefined}
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

export interface DonutSlice {
    name: string;
    value: number;
    color?: string;
}

/** Donut chart for category breakdowns (spending). */
export const DonutChart = ({ data, height = 240, emptyLabel = "No data yet" }: { data: DonutSlice[]; height?: number; emptyLabel?: string }) => {
    if (!data.length) return <EmptyChart label={emptyLabel} height={height} />;
    return (
        <ResponsiveContainer width="100%" height={height}>
            <PieChart>
                <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="80%"
                    paddingAngle={2}
                    stroke="var(--color-bg-primary)"
                    isAnimationActive={ANIMATE}
                    animationDuration={ANIM_DURATION}
                    animationEasing="ease-out"
                >
                    {data.map((slice, i) => (
                        <Cell key={i} fill={slice.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]} />
                    ))}
                </Pie>
                <Tooltip content={<ChartTooltip money />} />
            </PieChart>
        </ResponsiveContainer>
    );
};
