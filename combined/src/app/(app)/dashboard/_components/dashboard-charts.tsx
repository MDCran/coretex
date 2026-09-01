"use client";

import Link from "next/link";
import { ArrowRight, CreditCard02 } from "@untitledui/icons";
import { formatCurrency, formatCurrency0 } from "@/lib/financial/format";
import { formatDateShort } from "@/lib/dates";
import { TrendChart, type TrendPoint } from "@/app/(app)/health/_components/trend-chart";
import { cx } from "@/utils/cx";

export interface BillDue {
    id: string;
    label: string;
    dueAt: string;
    minimumPayment: number | null;
    overdue: boolean;
}

interface Props {
    netWorthTrend: TrendPoint[];
    spendingTrend: TrendPoint[];
    habitTrend: TrendPoint[];
    sleepTrend: TrendPoint[];
    weightTrend: TrendPoint[];
    workoutTrend: TrendPoint[];
    weekSpending: number;
    avgSleepHours: number | null;
    weightUnitLabel: string;
    todosDoneWeek: number;
    todosTotalWeek: number;
    billsDue: BillDue[];
}

function ChartCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-4 rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-primary">{title}</h2>
                {action}
            </div>
            {children}
        </div>
    );
}

export function DashboardCharts({
    netWorthTrend,
    spendingTrend,
    habitTrend,
    sleepTrend,
    weightTrend,
    workoutTrend,
    weekSpending,
    avgSleepHours,
    weightUnitLabel,
    todosDoneWeek,
    todosTotalWeek,
    billsDue,
}: Props) {
    const todoPct = todosTotalWeek > 0 ? Math.round((todosDoneWeek / todosTotalWeek) * 100) : 0;
    const workoutTotal = workoutTrend.reduce((s, p) => s + Number(p.workouts ?? 0), 0);

    return (
        <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <ChartCard
                    title="Net worth trend"
                    action={
                        <Link href="/financial" className="text-xs font-medium text-brand-secondary hover:underline">
                            Financial
                        </Link>
                    }
                >
                    <TrendChart
                        data={netWorthTrend}
                        series={[{ key: "netWorth", name: "Net worth" }]}
                        type="area"
                        height={200}
                        fitDomain
                        emptyLabel="No net worth snapshots yet"
                    />
                </ChartCard>

                <ChartCard
                    title="Spending — last 7 days"
                    action={
                        <span className="text-xs font-medium text-tertiary tabular-nums">{formatCurrency0(weekSpending)} this week</span>
                    }
                >
                    <TrendChart
                        data={spendingTrend}
                        series={[{ key: "spent", name: "Spent" }]}
                        type="bar"
                        height={200}
                        emptyLabel="No transactions this week"
                    />
                </ChartCard>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                <ChartCard title="Habit logs — last 7 days">
                    <TrendChart
                        data={habitTrend}
                        series={[{ key: "habits", name: "Habits logged" }]}
                        type="bar"
                        height={180}
                        emptyLabel="No habits logged this week"
                    />
                </ChartCard>

                <ChartCard
                    title="Todo completion"
                    action={
                        <Link href="/todos" className="inline-flex items-center gap-1 text-xs font-medium text-brand-secondary hover:underline">
                            View todos <ArrowRight className="size-3.5" aria-hidden="true" />
                        </Link>
                    }
                >
                    <div className="flex flex-col gap-4 py-2">
                        <div className="flex items-end justify-between gap-4">
                            <span className="text-display-sm font-semibold tabular-nums text-primary">{todoPct}%</span>
                            <span className="text-sm text-tertiary">
                                {todosDoneWeek} / {todosTotalWeek} this week
                            </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-quaternary">
                            <div
                                className="h-full rounded-full bg-brand-solid transition-all duration-300"
                                style={{ width: `${Math.min(100, todoPct)}%` }}
                            />
                        </div>
                        <p className="text-xs text-tertiary">Done vs scheduled todos over the past 7 days.</p>
                    </div>
                </ChartCard>

                <ChartCard
                    title="Bills due soon"
                    action={
                        <Link href="/financial/subscriptions" className="text-xs font-medium text-brand-secondary hover:underline">
                            Subscriptions
                        </Link>
                    }
                >
                    {billsDue.length === 0 ? (
                        <p className="py-8 text-center text-sm text-tertiary">No payment due dates on file.</p>
                    ) : (
                        <ul className="flex flex-col divide-y divide-secondary">
                            {billsDue.map((b) => (
                                <li key={b.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                                        <CreditCard02 className="size-4 text-fg-quaternary" aria-hidden="true" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium text-primary">{b.label}</span>
                                        <span className={cx("block text-xs", b.overdue ? "text-error-primary" : "text-tertiary")}>
                                            Due {formatDateShort(b.dueAt)}
                                            {b.minimumPayment != null ? ` · ${formatCurrency(b.minimumPayment)} min` : ""}
                                        </span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </ChartCard>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                <ChartCard
                    title="Sleep — last 7 nights"
                    action={
                        avgSleepHours != null ? (
                            <span className="text-xs font-medium text-tertiary tabular-nums">{avgSleepHours}h avg</span>
                        ) : (
                            <Link href="/health/sleep" className="text-xs font-medium text-brand-secondary hover:underline">
                                Sleep
                            </Link>
                        )
                    }
                >
                    <TrendChart
                        data={sleepTrend}
                        series={[{ key: "hours", name: "Hours", color: "var(--color-utility-blue-500)" }]}
                        type="area"
                        height={180}
                        emptyLabel="No sleep logged this week"
                    />
                </ChartCard>

                <ChartCard
                    title="Weight trend"
                    action={
                        <Link href="/health/metrics" className="text-xs font-medium text-brand-secondary hover:underline">
                            Metrics
                        </Link>
                    }
                >
                    <TrendChart
                        data={weightTrend}
                        series={[{ key: "weight", name: `Weight (${weightUnitLabel})` }]}
                        type="area"
                        height={180}
                        fitDomain
                        emptyLabel="No weight entries yet"
                    />
                </ChartCard>

                <ChartCard
                    title="Workouts — last 6 weeks"
                    action={<span className="text-xs font-medium text-tertiary tabular-nums">{workoutTotal} total</span>}
                >
                    <TrendChart
                        data={workoutTrend}
                        series={[{ key: "workouts", name: "Workouts", color: "var(--color-utility-pink-500)" }]}
                        type="bar"
                        height={180}
                        emptyLabel="No workouts in the last 6 weeks"
                    />
                </ChartCard>
            </div>
        </div>
    );
}
