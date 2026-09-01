// @ts-nocheck
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChartSquare02 } from "@untitledui/icons";
import type { Peptide } from "@/lib/peptides/types";
import { generateSchedule } from "@/lib/peptides/schedule";
import { startOfWeek, parseISO } from "@/lib/peptides/date";
import { EmptyState } from "./empty-state";

/** Respect reduced-motion; SSR-safe (defaults to animating on the server). */
const prefersReducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const ANIMATE = !prefersReducedMotion;
const ANIM_DURATION = 800;

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function weekTick(iso: string): string {
    const d = parseISO(iso);
    return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

interface Props {
    peptides: Peptide[];
    colorOf: (id: string) => string;
}

/** Stacked weekly total of planned syringe units, one stack segment per peptide. */
export function UsageChart({ peptides, colorOf }: Props) {
    const series = peptides.map((p) => ({ key: `p_${p.id}`, name: p.name, color: colorOf(p.id) }));

    const byWeek = new Map<string, Record<string, number>>();
    for (const p of peptides) {
        const key = `p_${p.id}`;
        for (const occ of generateSchedule(p)) {
            const wk = startOfWeek(occ.date);
            const row = byWeek.get(wk) ?? {};
            row[key] = (row[key] ?? 0) + occ.units;
            byWeek.set(wk, row);
        }
    }

    const weeks = [...byWeek.keys()].sort();
    const data = weeks.map((wk) => {
        const row: Record<string, number | string> = { week: weekTick(wk) };
        for (const s of series) row[s.key] = Number((byWeek.get(wk)?.[s.key] ?? 0).toFixed(2));
        return row;
    });

    if (data.length === 0) {
        return (
            <EmptyState
                icon={BarChartSquare02}
                title="See your weekly load take shape"
                description="Plan dosing blocks and set a start date — your planned syringe units chart week by week, stacked across every peptide."
                size="sm"
            />
        );
    }

    return (
        <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-border-secondary)" />
                    <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} stroke="var(--color-text-tertiary)" />
                    <YAxis tickLine={false} axisLine={false} width={40} fontSize={11} stroke="var(--color-text-tertiary)" />
                    <Tooltip
                        cursor={{ fill: "var(--color-bg-secondary)" }}
                        contentStyle={{
                            backgroundColor: "var(--color-bg-primary)",
                            border: "1px solid var(--color-border-secondary)",
                            borderRadius: 8,
                            fontSize: 12,
                        }}
                    />
                    {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                    {series.map((s, i) => (
                        <Bar
                            key={s.key}
                            dataKey={s.key}
                            name={s.name}
                            stackId="u"
                            fill={s.color}
                            radius={4}
                            isAnimationActive={ANIMATE}
                            animationBegin={i * 120}
                            animationDuration={ANIM_DURATION}
                            animationEasing="ease-out"
                        />
                    ))}
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
