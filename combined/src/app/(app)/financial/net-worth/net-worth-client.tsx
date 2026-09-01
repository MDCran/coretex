"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Coins01, TrendUp02 } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { Button } from "@/components/base/buttons/button";
import { formatCompact, formatCurrency } from "@/lib/financial/format";
import { BloomCard, Card, EmptyState, ProgressBar, SectionHeader, Stat } from "../_components/financial-ui";

export interface NetWorthBreakdown {
    cash: number;
    savings: number;
    investments: number;
    otherAssets: number;
    loans: number;
    cardDebt: number;
    debts: number;
    assets: number;
    liabilities: number;
    netWorth: number;
}

export interface NetWorthHistoryPoint {
    date: string; // ISO
    net: number;
    assets: number;
    liabilities: number;
}

type Period = "daily" | "monthly" | "quarterly" | "yearly";
const PERIODS: { key: Period; label: string }[] = [
    { key: "daily", label: "Daily" },
    { key: "monthly", label: "Monthly" },
    { key: "quarterly", label: "Quarterly" },
    { key: "yearly", label: "Yearly" },
];

const ASSET_ROWS: { key: keyof NetWorthBreakdown; label: string; color: string }[] = [
    { key: "cash", label: "Cash", color: "var(--color-fg-success-primary)" },
    { key: "savings", label: "Savings", color: "var(--color-fg-brand-primary)" },
    { key: "investments", label: "Investments", color: "var(--color-utility-purple-500, #8b5cf6)" },
    { key: "otherAssets", label: "Other assets", color: "var(--color-fg-quaternary)" },
];
const LIABILITY_ROWS: { key: keyof NetWorthBreakdown; label: string }[] = [
    { key: "cardDebt", label: "Credit cards" },
    { key: "loans", label: "Loans" },
    { key: "debts", label: "Other debts" },
];

const tooltipStyle = {
    backgroundColor: "var(--color-bg-primary)",
    border: "1px solid var(--color-border-secondary)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--color-text-primary)",
};

function periodKey(iso: string, period: Period): string {
    if (period === "daily") return iso.slice(0, 10);
    const d = new Date(iso);
    const y = d.getFullYear();
    if (period === "yearly") return `${y}`;
    if (period === "quarterly") return `${y} Q${Math.floor(d.getMonth() / 3) + 1}`;
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function periodLabel(key: string, period: Period): string {
    if (period !== "daily") return key;
    const [, month, day] = key.split("-").map(Number);
    const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${labels[(month || 1) - 1]} ${day || ""}`.trim();
}

export function NetWorthClient({
    breakdown,
    history,
    liquidSavings,
    monthlySpending,
}: {
    breakdown: NetWorthBreakdown;
    history: NetWorthHistoryPoint[];
    liquidSavings: number;
    monthlySpending: number;
}) {
    const [period, setPeriod] = useState<Period>("daily");
    const [targetMonths, setTargetMonths] = useState(6);

    const chartData = useMemo(() => {
        const byPeriod = new Map<string, NetWorthHistoryPoint>();
        // Keep the LAST point in each period (history is ascending by date).
        for (const p of history) byPeriod.set(periodKey(p.date, period), p);
        return [...byPeriod.entries()].map(([label, p]) => ({ label: periodLabel(label, period), net: p.net, assets: p.assets, liabilities: p.liabilities }));
    }, [history, period]);

    const emergencyTarget = monthlySpending * targetMonths;
    const emergencyMonths = monthlySpending > 0 ? liquidSavings / monthlySpending : null;
    const emergencyColor = emergencyMonths == null ? "brand" : emergencyMonths >= targetMonths ? "success" : emergencyMonths >= 3 ? "warning" : "error";

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader title="Net worth" description="Your assets, liabilities and how they've changed over time." />

            <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Net worth" value={formatCurrency(breakdown.netWorth)} tone={breakdown.netWorth >= 0 ? "success" : "error"} />
                <Stat label="Total assets" value={formatCurrency(breakdown.assets)} />
                <Stat label="Total liabilities" value={formatCurrency(breakdown.liabilities)} tone={breakdown.liabilities > 0 ? "error" : undefined} />
            </div>

            {/* History */}
            <Card className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-secondary">History</p>
                    <div className="inline-flex gap-0.5 rounded-lg bg-secondary p-0.5">
                        {PERIODS.map((p) => (
                            <button
                                key={p.key}
                                type="button"
                                onClick={() => setPeriod(p.key)}
                                className={cx("rounded-md px-2.5 py-1 text-xs font-medium transition", period === p.key ? "bg-primary text-primary shadow-xs" : "text-tertiary hover:text-secondary")}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>
                {chartData.length < 2 ? (
                    <EmptyState
                        icon={TrendUp02}
                        title="Your net worth trend starts here"
                        description="Once accounts or transactions are tracked, you'll see a daily net worth line instead of sparse snapshot points."
                    />
                ) : (
                    <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={chartData} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                            <defs>
                                <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--color-fg-brand-primary)" stopOpacity={0.5} />
                                    <stop offset="95%" stopColor="var(--color-fg-brand-primary)" stopOpacity={0.03} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" />
                            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} minTickGap={24} tick={{ fill: "var(--color-text-tertiary)" }} />
                            <YAxis tickLine={false} axisLine={false} width={52} fontSize={12} tickFormatter={(v) => formatCompact(Number(v))} tick={{ fill: "var(--color-text-tertiary)" }} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatCurrency(Number(v)), "Net worth"]} />
                            <Area dataKey="net" type="monotone" fill="url(#nwFill)" stroke="var(--color-fg-brand-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </Card>

            {/* Breakdown */}
            <div className="grid gap-4 lg:grid-cols-2">
                <Card className="flex flex-col gap-3">
                    <p className="text-sm font-medium text-secondary">Assets by type</p>
                    {breakdown.assets <= 0 ? (
                        <EmptyState
                            icon={Coins01}
                            title="See what you're worth"
                            description="Add cash, savings and investment accounts to watch your assets — and your net worth — grow over time."
                            action={
                                <Button size="sm" href="/financial/accounts">
                                    Add an account
                                </Button>
                            }
                        />
                    ) : (
                        <div className="flex flex-col gap-3">
                            {ASSET_ROWS.filter((r) => Number(breakdown[r.key]) > 0).map((r) => {
                                const amount = Number(breakdown[r.key]);
                                const share = amount / breakdown.assets;
                                return (
                                    <div key={r.key} className="flex flex-col gap-1">
                                        <div className="flex items-baseline justify-between gap-2 text-sm">
                                            <span className="flex items-center gap-2 text-secondary">
                                                <span className="size-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                                                {r.label}
                                            </span>
                                            <span className="font-medium text-primary tabular-nums">
                                                {formatCurrency(amount)} <span className="text-tertiary">· {Math.round(share * 100)}%</span>
                                            </span>
                                        </div>
                                        <div className="h-2 w-full overflow-hidden rounded-full bg-quaternary">
                                            <div className="h-full rounded-full" style={{ width: `${share * 100}%`, backgroundColor: r.color }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Card>

                <Card className="flex flex-col gap-3">
                    <p className="text-sm font-medium text-secondary">Liabilities</p>
                    {breakdown.liabilities <= 0 ? (
                        <p className="py-4 text-sm text-success-primary">Debt-free — no liabilities tracked. 🎉</p>
                    ) : (
                        <ul className="flex flex-col divide-y divide-secondary">
                            {LIABILITY_ROWS.filter((r) => Number(breakdown[r.key]) > 0).map((r) => (
                                <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                                    <span className="text-secondary">{r.label}</span>
                                    <span className="font-medium text-primary tabular-nums">{formatCurrency(Number(breakdown[r.key]))}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>

            {/* Emergency fund */}
            <BloomCard bloom={emergencyColor === "error" ? "error" : emergencyColor === "warning" ? "warning" : "success"}>
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-primary">Emergency fund</p>
                        <div className="inline-flex gap-0.5 rounded-lg bg-secondary p-0.5">
                            {[3, 6, 12].map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setTargetMonths(m)}
                                    className={cx("rounded-md px-2.5 py-1 text-xs font-medium transition", targetMonths === m ? "bg-primary text-primary shadow-xs" : "text-tertiary hover:text-secondary")}
                                >
                                    {m} mo
                                </button>
                            ))}
                        </div>
                    </div>
                    <ProgressBar value={liquidSavings} max={emergencyTarget || 1} color={emergencyColor} />
                    <p className="text-sm text-tertiary">
                        {monthlySpending <= 0 ? (
                            "Log some spending to estimate your target."
                        ) : (
                            <>
                                {formatCurrency(liquidSavings)} of {formatCurrency(emergencyTarget)} ({targetMonths}-month target) —{" "}
                                <span className="font-medium text-primary">{emergencyMonths?.toFixed(1)} months</span> of expenses covered.
                            </>
                        )}
                    </p>
                </div>
            </BloomCard>
        </div>
    );
}
