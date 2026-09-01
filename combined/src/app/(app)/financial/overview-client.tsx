"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Camera01, CreditCard02, Plus, Receipt, UploadCloud02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { takeNetWorthSnapshot } from "@/lib/actions/financial-networth";
import { formatCurrency, formatDate } from "@/lib/financial/format";
import { AmountBadge } from "./_components/amount-badge";
import { CategoryBadge } from "./_components/category-badge";
import { BloomCard, Card, EmptyRow, ProgressBar, SectionHeader } from "./_components/financial-ui";
import { DonutChart, TrendChart, type TrendPoint } from "./_components/trend-chart";
import { CreditSection, type CreditScoreEntry } from "./_components/credit-section";

interface RecentTxn {
    id: string;
    date: string;
    merchant: string;
    category: string | null;
    amount: number;
}

interface UpcomingBill {
    id: string;
    kind: "subscription" | "debt";
    label: string;
    amount: number;
    date: string | null;
}

export type { CreditScoreEntry };

export interface OverviewData {
    assets: number;
    liabilities: number;
    netWorth: number;
    netWorthDelta: number | null;
    /** Live Alpaca equity included in assets, or null when not connected. */
    alpacaEquity: number | null;
    accountsSummary: { cash: number; savings: number; investments: number; cardDebt: number };
    trend: TrendPoint[];
    cashflow: { inflow: number; outflow: number };
    budget: { totalBudget: number; totalSpent: number };
    spending: { name: string; value: number }[];
    upcomingBills: UpcomingBill[];
    monthlySubCost: number;
    creditScores: CreditScoreEntry[];
    goals: { id: string; title: string; current: number; target: number | null }[];
    recent: RecentTxn[];
}

/** A compact metric tile with an optional delta chip. */
function MetricTile({ label, value, delta }: { label: string; value: string; delta?: { value: number; positive: boolean } }) {
    return (
        <div className="flex flex-col gap-1 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
            <p className="text-sm text-tertiary">{label}</p>
            <p className="text-display-xs font-semibold text-primary">{value}</p>
            {delta && (
                <span className={`inline-flex w-fit items-center gap-1 text-xs font-medium ${delta.positive ? "text-success-primary" : "text-error-primary"}`}>
                    {delta.positive ? <ArrowUpRight aria-hidden="true" className="size-3.5" /> : <ArrowDownRight aria-hidden="true" className="size-3.5" />}
                    {formatCurrency(Math.abs(delta.value))} MoM
                </span>
            )}
        </div>
    );
}

export function OverviewClient({ data }: { data: OverviewData }) {
    const [snapping, setSnapping] = useState(false);

    async function onSnapshot() {
        setSnapping(true);
        try {
            const res = await takeNetWorthSnapshot();
            toast.success(`Snapshot saved — net worth ${formatCurrency(res.netWorth)}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to take snapshot");
        } finally {
            setSnapping(false);
        }
    }

    const cashflowNet = data.cashflow.inflow - data.cashflow.outflow;
    const cashflowMax = Math.max(data.cashflow.inflow, data.cashflow.outflow, 1);
    const budgetPct = data.budget.totalBudget > 0 ? Math.round((data.budget.totalSpent / data.budget.totalBudget) * 100) : 0;
    const budgetOver = data.budget.totalBudget > 0 && data.budget.totalSpent > data.budget.totalBudget;
    const hasStackedTrend = data.trend.some((p) => p.assets != null || p.liabilities != null);

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Overview"
                description="Your whole-life finances at a glance."
                action={
                    <Button size="md" iconLeading={Camera01} onClick={onSnapshot} isLoading={snapping}>
                        Take snapshot
                    </Button>
                }
            />

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2">
                <Button size="sm" color="secondary" iconLeading={Plus} href="/financial/transactions">
                    Add transaction
                </Button>
                <Button size="sm" color="secondary" iconLeading={UploadCloud02} href="/financial/statements">
                    Upload statement
                </Button>
                <Button size="sm" color="secondary" iconLeading={Receipt} href="/financial/subscriptions">
                    Subscriptions
                </Button>
                <Button size="sm" color="secondary" iconLeading={CreditCard02} href="/financial/cards">
                    Cards
                </Button>
            </div>

            {/* Net worth hero */}
            <BloomCard bloom="brand" className="flex flex-col gap-1">
                <p className="text-sm text-tertiary">Net worth</p>
                <div className="flex flex-wrap items-baseline gap-3">
                    <p className="text-display-md font-semibold text-primary">{formatCurrency(data.netWorth)}</p>
                    {data.netWorthDelta != null && (
                        <Badge size="md" color={data.netWorthDelta >= 0 ? "success" : "error"}>
                            {data.netWorthDelta >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(data.netWorthDelta))} vs 30 days ago
                        </Badge>
                    )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <span className="text-tertiary">
                        Assets <span className="font-medium text-success-primary">{formatCurrency(data.assets)}</span>
                    </span>
                    <span className="text-tertiary">
                        Liabilities <span className="font-medium text-error-primary">{formatCurrency(data.liabilities)}</span>
                    </span>
                    {data.alpacaEquity != null && (
                        <span className="inline-flex items-center gap-1.5 text-tertiary">
                            Alpaca <span className="font-medium text-primary">{formatCurrency(data.alpacaEquity)}</span>
                            <Badge size="sm" color="success" type="pill-color">
                                <span className="inline-flex items-center gap-1">
                                    <span className="size-1.5 rounded-full bg-fg-success-primary" aria-hidden="true" />
                                    Live
                                </span>
                            </Badge>
                        </span>
                    )}
                </div>
            </BloomCard>

            {/* Account summary metrics */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricTile label="Cash" value={formatCurrency(data.accountsSummary.cash)} />
                <MetricTile label="Savings" value={formatCurrency(data.accountsSummary.savings)} />
                <MetricTile label="Investments" value={formatCurrency(data.accountsSummary.investments)} />
                <MetricTile label="Card debt" value={formatCurrency(data.accountsSummary.cardDebt)} />
            </div>

            {/* Net worth trend (assets vs liabilities stacked when available) */}
            <Card>
                <h3 className="mb-4 text-md font-semibold text-primary">Net worth trend</h3>
                {hasStackedTrend ? (
                    <TrendChart
                        data={data.trend}
                        series={[
                            { key: "assets", name: "Assets", color: "var(--color-utility-emerald-500)" },
                            { key: "liabilities", name: "Liabilities", color: "var(--color-utility-orange-500)" },
                            { key: "value", name: "Net worth", color: "var(--color-brand-500)" },
                        ]}
                        type="area"
                        fitDomain
                        emptyLabel="No net worth history yet"
                    />
                ) : (
                    <TrendChart data={data.trend} series={[{ key: "value", name: "Net worth" }]} type="area" fitDomain emptyLabel="No net worth history yet" />
                )}
            </Card>

            {/* Cashflow + budget health */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <BloomCard bloom="success" className="flex flex-col gap-4">
                    <div className="flex items-baseline justify-between">
                        <h3 className="text-md font-semibold text-primary">Cashflow this month</h3>
                        <span className={`text-sm font-semibold ${cashflowNet >= 0 ? "text-success-primary" : "text-error-primary"}`}>
                            {cashflowNet >= 0 ? "+" : "−"}
                            {formatCurrency(Math.abs(cashflowNet))} net
                        </span>
                    </div>
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-3">
                            <span className="w-16 text-xs text-tertiary">In</span>
                            <div className="h-3 flex-1 overflow-hidden rounded-full bg-quaternary">
                                <div className="h-full rounded-full bg-success-solid" style={{ width: `${(data.cashflow.inflow / cashflowMax) * 100}%` }} />
                            </div>
                            <span className="w-24 text-right text-sm font-medium text-success-primary">{formatCurrency(data.cashflow.inflow)}</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="w-16 text-xs text-tertiary">Out</span>
                            <div className="h-3 flex-1 overflow-hidden rounded-full bg-quaternary">
                                <div className="h-full rounded-full bg-error-solid" style={{ width: `${(data.cashflow.outflow / cashflowMax) * 100}%` }} />
                            </div>
                            <span className="w-24 text-right text-sm font-medium text-error-primary">{formatCurrency(data.cashflow.outflow)}</span>
                        </div>
                    </div>
                </BloomCard>

                <BloomCard bloom="warning" className="flex flex-col gap-3">
                    <div className="flex items-baseline justify-between">
                        <h3 className="text-md font-semibold text-primary">Budget health</h3>
                        <Link href="/financial/budget" className="text-sm font-medium text-brand-secondary hover:underline">
                            Manage
                        </Link>
                    </div>
                    {data.budget.totalBudget > 0 ? (
                        <>
                            <div className="flex items-baseline justify-between text-sm">
                                <span className={budgetOver ? "font-medium text-error-primary" : "font-medium text-primary"}>{formatCurrency(data.budget.totalSpent)}</span>
                                <span className="text-tertiary">of {formatCurrency(data.budget.totalBudget)} budgeted</span>
                            </div>
                            <ProgressBar value={data.budget.totalSpent} max={data.budget.totalBudget} color={budgetOver ? "error" : budgetPct > 80 ? "warning" : "success"} />
                            <p className="text-xs text-tertiary">
                                {budgetOver ? `Over budget by ${formatCurrency(data.budget.totalSpent - data.budget.totalBudget)}.` : `${formatCurrency(data.budget.totalBudget - data.budget.totalSpent)} remaining this month.`}
                            </p>
                        </>
                    ) : (
                        <div className="flex flex-col items-start gap-2 py-2">
                            <p className="text-sm text-tertiary">Set category targets to see spending tracked against your budget at a glance.</p>
                            <Button size="sm" color="secondary" href="/financial/budget" iconLeading={Plus}>
                                Create a budget
                            </Button>
                        </div>
                    )}
                </BloomCard>
            </div>

            {/* Spending + upcoming bills */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <BloomCard bloom="error">
                    <h3 className="mb-4 text-md font-semibold text-primary">This month's spending</h3>
                    <DonutChart data={data.spending} emptyLabel="No spending recorded" />
                    {data.spending.length > 0 && (
                        <ul className="mt-4 flex flex-col gap-1.5">
                            {data.spending.slice(0, 6).map((s) => (
                                <li key={s.name} className="flex justify-between text-sm">
                                    <span className="text-tertiary">{s.name}</span>
                                    <span className="font-medium text-primary">{formatCurrency(s.value)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </BloomCard>

                <BloomCard className="flex flex-col">
                    <div className="mb-4 flex items-baseline justify-between">
                        <h3 className="text-md font-semibold text-primary">Upcoming bills (14 days)</h3>
                        <span className="text-sm text-tertiary">{formatCurrency(data.monthlySubCost)}/mo subs</span>
                    </div>
                    {data.upcomingBills.length === 0 ? (
                        <p className="py-6 text-center text-sm text-tertiary">No bills due in the next 14 days.</p>
                    ) : (
                        <ul className="flex flex-col divide-y divide-secondary">
                            {data.upcomingBills.map((b) => (
                                <li key={`${b.kind}-${b.id}`} className="flex items-center justify-between py-2.5">
                                    <div className="flex items-center gap-2">
                                        <Badge size="sm" color={b.kind === "debt" ? "warning" : "gray"}>
                                            {b.kind === "debt" ? "Debt" : "Sub"}
                                        </Badge>
                                        <div>
                                            <p className="text-sm font-medium text-primary">{b.label}</p>
                                            {b.date && <p className="text-xs text-tertiary">{formatDate(b.date)}</p>}
                                        </div>
                                    </div>
                                    <span className="text-sm font-medium text-primary">{formatCurrency(b.amount)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </BloomCard>
            </div>

            {/* Credit score section — full bureau-aware view (shared with /financial/credit) */}
            <CreditSection scores={data.creditScores} />

            {/* Goals strip (compact on overview) */}
            {data.goals.length > 0 && (
                <Card className="flex flex-col gap-3">
                    <div className="flex items-baseline justify-between">
                        <h3 className="text-md font-semibold text-primary">Goals</h3>
                    </div>
                    <ul className="flex flex-col gap-3">
                        {data.goals.slice(0, 4).map((g) => {
                            const target = g.target ?? 0;
                            const pct = target > 0 ? Math.min(100, Math.round((g.current / target) * 100)) : 0;
                            return (
                                <li key={g.id} className="flex flex-col gap-1">
                                    <div className="flex justify-between text-sm">
                                        <span className="font-medium text-primary">{g.title}</span>
                                        <span className="text-tertiary">{target > 0 ? `${pct}%` : formatCurrency(g.current)}</span>
                                    </div>
                                    {target > 0 && <ProgressBar value={g.current} max={target} color={g.current >= target ? "success" : "brand"} />}
                                </li>
                            );
                        })}
                    </ul>
                </Card>
            )}

            {/* Recent transactions */}
            <Card className="overflow-x-auto p-0">
                <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                    <h3 className="text-md font-semibold text-primary">Recent transactions</h3>
                    <Link href="/financial/transactions" className="text-sm font-medium text-brand-secondary hover:underline">
                        View all
                    </Link>
                </div>
                <table className="w-full min-w-[560px] text-sm">
                    <thead>
                        <tr className="border-b border-secondary text-left text-tertiary">
                            <th className="px-5 py-3 font-medium">Date</th>
                            <th className="px-5 py-3 font-medium">Merchant</th>
                            <th className="px-5 py-3 font-medium">Category</th>
                            <th className="px-5 py-3 text-right font-medium">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.recent.length === 0 && <EmptyRow colSpan={4} label="No transactions yet." />}
                        {data.recent.map((t) => (
                            <tr key={t.id} className="border-b border-secondary last:border-0">
                                <td className="px-5 py-3 text-tertiary">{formatDate(t.date)}</td>
                                <td className="px-5 py-3 font-medium text-primary">{t.merchant}</td>
                                <td className="px-5 py-3">{t.category ? <CategoryBadge name={t.category} /> : <Badge size="sm" type="modern" color="gray">Uncategorized</Badge>}</td>
                                <td className="px-5 py-3 text-right">
                                    <AmountBadge amount={t.amount} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Card>
        </div>
    );
}
