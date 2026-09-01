"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, formatCurrency } from "@/lib/financial/format";

export interface ForecastChartPoint {
    day: number;
    label: string;
    balance: number;
}

/** Respect reduced-motion; SSR-safe (defaults to animating on the server). */
const prefersReducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const ANIMATE = !prefersReducedMotion;
const ANIM_DURATION = 800;

const tooltipStyle = {
    backgroundColor: "var(--color-bg-primary)",
    border: "1px solid var(--color-border-secondary)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--color-text-primary)",
};

export function ForecastChart({ data }: { data: ForecastChartPoint[] }) {
    return (
        <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                <defs>
                    <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-fg-brand-primary)" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="var(--color-fg-brand-primary)" stopOpacity={0.03} />
                    </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" />
                <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    fontSize={12}
                    interval={14}
                    tick={{ fill: "var(--color-text-tertiary)" }}
                />
                <YAxis tickLine={false} axisLine={false} width={52} fontSize={12} tickFormatter={(v) => formatCompact(Number(v))} tick={{ fill: "var(--color-text-tertiary)" }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatCurrency(Number(v)), "Projected balance"]} />
                <ReferenceLine y={0} stroke="var(--color-fg-error-primary)" strokeDasharray="3 3" />
                <Area
                    dataKey="balance"
                    type="monotone"
                    fill="url(#forecastFill)"
                    stroke="var(--color-fg-brand-primary)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={ANIMATE}
                    animationDuration={ANIM_DURATION}
                    animationEasing="ease-out"
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}
