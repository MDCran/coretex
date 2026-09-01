"use client";

import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";
import { TrendChart, type TrendPoint } from "@/app/(app)/health/_components/trend-chart";
import { Card, SectionHeader } from "./workouts-ui";

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

export function WorkoutsOverviewCharts({
    volumeData,
    muscleData,
    volumeUnit,
}: {
    volumeData: TrendPoint[];
    muscleData: TrendPoint[];
    volumeUnit: string;
}) {
    const radarData = muscleData.map((m) => ({
        muscle: String(m.label),
        sets: Number(m.Sets ?? 0),
    }));

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="overflow-hidden">
                <SectionHeader title="Weekly volume" description={`Total ${volumeUnit} lifted per week.`} />
                <div className="mt-4">
                    <TrendChart data={volumeData} series={[{ key: "Volume", name: `Volume (${volumeUnit})` }]} type="area" fitDomain emptyLabel="Log workouts to see volume trends" />
                </div>
            </Card>
            <Card className="overflow-hidden">
                <SectionHeader title="Muscle balance" description="Working sets by target muscle, last 30 days." />
                <div className="mt-4">
                    {radarData.length >= 3 ? (
                        <ResponsiveContainer width="100%" height={280}>
                            <RadarChart data={radarData} outerRadius="72%">
                                <PolarGrid stroke="var(--color-border-tertiary)" />
                                <PolarAngleAxis dataKey="muscle" fontSize={11} tick={{ fill: "var(--color-text-tertiary)" }} />
                                <Radar
                                    name="Sets"
                                    dataKey="sets"
                                    stroke="var(--color-fg-brand-primary)"
                                    fill="var(--color-fg-brand-primary)"
                                    fillOpacity={0.3}
                                    isAnimationActive={ANIMATE}
                                    animationDuration={ANIM_DURATION}
                                    animationEasing="ease-out"
                                />
                                <Tooltip contentStyle={tooltipStyle} />
                            </RadarChart>
                        </ResponsiveContainer>
                    ) : (
                        <TrendChart data={muscleData} series={[{ key: "Sets", name: "Sets" }]} type="bar" emptyLabel="No sets logged yet" />
                    )}
                </div>
            </Card>
        </div>
    );
}
