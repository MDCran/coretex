"use client";

import { useId } from "react";
import { format } from "date-fns";
import type { JobStatus } from "@prisma/client";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    PolarAngleAxis,
    PolarGrid,
    PolarRadiusAxis,
    Radar,
    RadarChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { Coins01, Star01 } from "@untitledui/icons";
import { STATUS_HEX, STATUS_LABELS, STATUS_ORDER } from "@/lib/jobs/enums";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";

const tooltipStyle = {
    backgroundColor: "var(--color-bg-primary)",
    border: "1px solid var(--color-border-secondary)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--color-text-primary)",
};

/** Respect reduced-motion; SSR-safe (defaults to animating on the server). */
const prefersReducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const ANIMATE = !prefersReducedMotion;
const ANIM_DURATION = 800;

const fmtCompact = (n: number) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** Stacked compensation chart: base + bonus + equity over time. */
export function CompChart({ data }: { data: { label: string; base: number; bonus: number; equity: number }[] }) {
    if (data.length === 0) {
        return (
            <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-center">
                <FeaturedIcon icon={Coins01} color="brand" theme="light" size="md" />
                <p className="text-sm font-medium text-secondary">No compensation logged yet</p>
                <p className="max-w-xs text-xs text-tertiary">Add your base, bonus, and equity to watch your total comp grow over time.</p>
            </div>
        );
    }
    return (
        <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} tick={{ fill: "var(--color-text-tertiary)" }} />
                <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={fmtCompact} fontSize={12} tick={{ fill: "var(--color-text-tertiary)" }} />
                <Tooltip cursor={{ fill: "var(--color-bg-secondary)" }} contentStyle={tooltipStyle} formatter={(v) => fmtCompact(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="base" name="Base" stackId="comp" fill="var(--color-fg-brand-primary)" radius={[0, 0, 0, 0]} isAnimationActive={ANIMATE} animationBegin={0} animationDuration={ANIM_DURATION} animationEasing="ease-out" />
                <Bar dataKey="bonus" name="Bonus" stackId="comp" fill="var(--color-fg-success-secondary)" isAnimationActive={ANIMATE} animationBegin={120} animationDuration={ANIM_DURATION} animationEasing="ease-out" />
                <Bar dataKey="equity" name="Equity" stackId="comp" fill="var(--color-fg-warning-secondary)" radius={[5, 5, 0, 0]} isAnimationActive={ANIMATE} animationBegin={240} animationDuration={ANIM_DURATION} animationEasing="ease-out" />
            </BarChart>
        </ResponsiveContainer>
    );
}

// =====================================================================================
// Status journey — every application's pipeline progression over time. X = time, Y =
// pipeline status (Not started → Applied → … → Withdrawn). Each application is one line
// whose stroke is a left→right gradient through the colors of the statuses it passed,
// and every dot is a status change you can hover to see which application it was.
// =====================================================================================

export interface JourneyPoint {
    /** epoch ms of the status change. */
    t: number;
    /** STATUS_ORDER index (the Y level). */
    level: number;
    status: JobStatus;
    statusLabel: string;
    role: string;
    company: string;
    /** STATUS_HEX for this point's status (dot color + gradient stop). */
    color: string;
}

export interface JourneySeries {
    id: string;
    role: string;
    company: string;
    points: JourneyPoint[];
}

const Y_MAX = STATUS_ORDER.length - 1;

function JourneyTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: JourneyPoint }> }) {
    if (!active || !payload?.length) return null;
    // Dedupe by application+status+time in case multiple lines report the same x.
    const seen = new Set<string>();
    const rows = payload
        .map((p) => p.payload)
        .filter((pt): pt is JourneyPoint => {
            if (!pt || typeof pt.t !== "number") return false;
            const k = `${pt.role}|${pt.t}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    if (!rows.length) return null;
    return (
        <div className="max-w-xs rounded-lg border border-secondary bg-primary px-3 py-2 text-xs shadow-md">
            {rows.map((pt) => (
                <div key={`${pt.role}-${pt.t}`} className="flex flex-col gap-0.5">
                    <span className="font-medium text-primary">{pt.role}</span>
                    <span className="text-tertiary">{pt.company}</span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="inline-block size-2 rounded-full" style={{ background: pt.color }} />
                        <span className="font-medium text-secondary">{pt.statusLabel}</span>
                        <span className="text-quaternary">· {format(new Date(pt.t), "MMM d, yyyy")}</span>
                    </span>
                </div>
            ))}
        </div>
    );
}

/** Status progression over time, one gradient line + hoverable dots per application. */
export function StatusJourneyChart({ series }: { series: JourneySeries[] }) {
    const rawId = useId();
    const uid = rawId.replace(/[^a-zA-Z0-9]/g, "");

    const withLines = series.filter((s) => s.points.length > 0);
    // Explicit X domain: with per-series data and no chart-level data, Recharts can't
    // resolve "dataMin"/"dataMax", so derive the time bounds ourselves.
    const allT = withLines.flatMap((s) => s.points.map((p) => p.t));
    const tMin = allT.length ? Math.min(...allT) : 0;
    const tMax = allT.length ? Math.max(...allT) : 1;
    // Pad the domain by ~3% on each side so first/last dots aren't clipped at the edge.
    const pad = Math.max(1, Math.round((tMax - tMin) * 0.03));
    if (withLines.length === 0) {
        return (
            <div className="flex h-[320px] flex-col items-center justify-center gap-1 text-center">
                <p className="text-sm font-medium text-secondary">No status history yet</p>
                <p className="text-xs text-tertiary">As applications move through your pipeline, their journeys plot here.</p>
            </div>
        );
    }

    // Evenly spaced ticks across the true min→max so x labels match real timestamps.
    const TICK_COUNT = 5;
    const ticks =
        tMin === tMax ? [tMin] : Array.from({ length: TICK_COUNT }, (_, i) => Math.round(tMin + ((tMax - tMin) * i) / (TICK_COUNT - 1)));
    const tickFmt = (tMax - tMin) / 86_400_000 > 365 ? "MMM yy" : "MMM d";

    // Statuses actually present, in pipeline order, for the color key below the chart.
    const presentStatuses = STATUS_ORDER.filter((s) => withLines.some((line) => line.points.some((p) => p.status === s)));

    return (
        <div className="flex flex-col gap-3">
        <ResponsiveContainer width="100%" height={360}>
            <LineChart margin={{ left: 8, right: 24, top: 12, bottom: 4 }}>
                <defs>
                    {withLines.map((s) => {
                        const t0 = s.points[0].t;
                        const t1 = s.points[s.points.length - 1].t;
                        const span = t1 - t0 || 1;
                        return (
                            <linearGradient key={s.id} id={`journey-${uid}-${s.id}`} x1="0" y1="0" x2="1" y2="0">
                                {s.points.map((p, i) => (
                                    <stop key={i} offset={`${Math.round(((p.t - t0) / span) * 100)}%`} stopColor={p.color} />
                                ))}
                            </linearGradient>
                        );
                    })}
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" />
                <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={[tMin - pad, tMax + pad]}
                    ticks={ticks}
                    allowDataOverflow
                    tickFormatter={(t) => format(new Date(t), tickFmt)}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    fontSize={12}
                    minTickGap={24}
                    tick={{ fill: "var(--color-text-tertiary)" }}
                />
                <YAxis
                    type="number"
                    domain={[0, Y_MAX]}
                    ticks={STATUS_ORDER.map((_, i) => i)}
                    tickFormatter={(v) => STATUS_LABELS[STATUS_ORDER[v as number]] ?? ""}
                    tickLine={false}
                    axisLine={false}
                    width={104}
                    fontSize={11}
                    tick={{ fill: "var(--color-text-tertiary)" }}
                />
                <Tooltip content={<JourneyTooltip />} cursor={{ stroke: "var(--color-border-secondary)" }} isAnimationActive={false} />
                {withLines.map((s) => (
                    <Line
                        key={s.id}
                        data={s.points}
                        dataKey="level"
                        type="stepAfter"
                        stroke={s.points.length > 1 ? `url(#journey-${uid}-${s.id})` : s.points[0].color}
                        strokeWidth={2}
                        isAnimationActive={false}
                        dot={(props: { cx?: number; cy?: number; payload?: JourneyPoint; index?: number }) => {
                            const { cx, cy, payload, index } = props;
                            if (cx == null || cy == null || !payload) return <g key={`${s.id}-${index}`} />;
                            return <circle key={`${s.id}-${index}`} cx={cx} cy={cy} r={3.5} fill={payload.color} stroke="var(--color-bg-primary)" strokeWidth={1.5} />;
                        }}
                        activeDot={{ r: 6, strokeWidth: 2, stroke: "var(--color-bg-primary)" }}
                    />
                ))}
            </LineChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
            {presentStatuses.map((s) => (
                <span key={s} className="flex items-center gap-1.5 text-xs text-tertiary">
                    <span className="size-2.5 rounded-full" style={{ background: STATUS_HEX[s] }} aria-hidden="true" />
                    {STATUS_LABELS[s]}
                </span>
            ))}
        </div>
        </div>
    );
}

/** Skills radar: current proficiency vs target. */
export function SkillsRadar({ data }: { data: { skill: string; proficiency: number; target: number }[] }) {
    if (data.length < 3) {
        return <SkillsBars data={data} />;
    }
    return (
        <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={data} outerRadius="70%">
                <PolarGrid stroke="var(--color-border-tertiary)" />
                <PolarAngleAxis dataKey="skill" fontSize={11} tick={{ fill: "var(--color-text-tertiary)" }} />
                <PolarRadiusAxis domain={[0, 10]} angle={90} fontSize={10} tick={{ fill: "var(--color-text-tertiary)" }} />
                <Radar name="Current" dataKey="proficiency" stroke="var(--color-fg-brand-primary)" fill="var(--color-fg-brand-primary)" fillOpacity={0.35} isAnimationActive={ANIMATE} animationBegin={0} animationDuration={ANIM_DURATION} animationEasing="ease-out" />
                <Radar name="Target" dataKey="target" stroke="var(--color-fg-warning-secondary)" fill="var(--color-fg-warning-secondary)" fillOpacity={0.1} isAnimationActive={ANIMATE} animationBegin={150} animationDuration={ANIM_DURATION} animationEasing="ease-out" />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Tooltip contentStyle={tooltipStyle} />
            </RadarChart>
        </ResponsiveContainer>
    );
}

/** Fallback / small-set skills view: horizontal bars of proficiency vs target. */
export function SkillsBars({ data }: { data: { skill: string; proficiency: number; target: number }[] }) {
    if (data.length === 0) {
        return (
            <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-center">
                <FeaturedIcon icon={Star01} color="brand" theme="light" size="md" />
                <p className="text-sm font-medium text-secondary">No skills tracked yet</p>
                <p className="max-w-xs text-xs text-tertiary">Add a few skills with targets to map your strengths and spot gaps before your next interview.</p>
            </div>
        );
    }
    return (
        <ResponsiveContainer width="100%" height={Math.max(160, data.length * 56)}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} stroke="var(--color-border-tertiary)" />
                <XAxis type="number" domain={[0, 10]} allowDecimals={false} fontSize={12} tick={{ fill: "var(--color-text-tertiary)" }} />
                <YAxis type="category" dataKey="skill" tickLine={false} axisLine={false} width={104} fontSize={12} tick={{ fill: "var(--color-text-tertiary)" }} />
                <Tooltip cursor={{ fill: "var(--color-bg-secondary)" }} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="proficiency" name="Current" fill="var(--color-fg-brand-primary)" radius={4} isAnimationActive={ANIMATE} animationBegin={0} animationDuration={ANIM_DURATION} animationEasing="ease-out" />
                <Bar dataKey="target" name="Target" fill="var(--color-fg-warning-secondary)" radius={4} isAnimationActive={ANIMATE} animationBegin={120} animationDuration={ANIM_DURATION} animationEasing="ease-out" />
            </BarChart>
        </ResponsiveContainer>
    );
}
