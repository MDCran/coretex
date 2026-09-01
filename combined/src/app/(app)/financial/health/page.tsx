import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeHealthScore, type HealthStatus } from "@/lib/financial/health-score";
import { formatCurrency } from "@/lib/financial/format";
import { BloomCard, Card, ProgressBar, SectionHeader, Stat } from "../_components/financial-ui";

export const dynamic = "force-dynamic";

const LIQUID_KINDS = ["CHECKING", "SAVINGS", "MONEY_MARKET"] as const;

const statusColor: Record<HealthStatus, "success" | "warning" | "error"> = {
    good: "success",
    warning: "warning",
    error: "error",
};
const statusHex: Record<HealthStatus, string> = {
    good: "var(--color-fg-success-primary)",
    warning: "var(--color-fg-warning-primary)",
    error: "var(--color-fg-error-primary)",
};

function overallStatus(score: number): HealthStatus {
    if (score >= 67) return "good";
    if (score >= 34) return "warning";
    return "error";
}

export default async function FinancialHealthPage() {
    const user = await requireUser();

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const windowStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [incomeAgg, spendAgg, accounts, cards, debts, budgetCats, monthAgg] = await Promise.all([
        db.incomeEntry.aggregate({ where: { userId: user.id, receivedAt: { gte: windowStart } }, _sum: { amount: true } }),
        db.finTransaction.aggregate({ where: { userId: user.id, date: { gte: windowStart }, amount: { lt: 0 } }, _sum: { amount: true } }),
        db.finAccount.findMany({ where: { userId: user.id, archived: false }, select: { kind: true, currentBalance: true, includeInNetWorth: true, isAsset: true } }),
        db.creditCard.findMany({ where: { userId: user.id, archived: false }, select: { currentBalance: true, creditLimit: true, minimumPayment: true } }),
        db.debt.findMany({ where: { userId: user.id }, select: { minimumPayment: true } }),
        db.budgetCategory.findMany({ where: { userId: user.id }, select: { monthlyBudget: true } }),
        db.finTransaction.aggregate({ where: { userId: user.id, date: { gte: monthStart, lt: monthEnd } }, _sum: { amount: true } }),
    ]);

    const monthlyIncome = Number(incomeAgg._sum.amount ?? 0) / 3;
    const monthlySpending = Math.abs(Number(spendAgg._sum.amount ?? 0)) / 3;
    const liquidSavings = accounts
        .filter((a) => a.includeInNetWorth && a.isAsset && (LIQUID_KINDS as readonly string[]).includes(a.kind))
        .reduce((s, a) => s + Number(a.currentBalance), 0);
    const monthlyDebtPayments =
        debts.reduce((s, d) => s + Number(d.minimumPayment ?? 0), 0) + cards.reduce((s, c) => s + Number(c.minimumPayment ?? 0), 0);
    const cardBalance = cards.reduce((s, c) => s + Number(c.currentBalance), 0);
    const cardLimit = cards.reduce((s, c) => s + (c.creditLimit != null ? Number(c.creditLimit) : 0), 0);
    const monthlyBudget = budgetCats.reduce((s, c) => s + Number(c.monthlyBudget ?? 0), 0);
    const monthlyBudgetSpent = Math.max(0, -Number(monthAgg._sum.amount ?? 0));

    const result = computeHealthScore({
        monthlyIncome,
        monthlySpending,
        liquidSavings,
        monthlyDebtPayments,
        cardBalance,
        cardLimit,
        monthlyBudget,
        monthlyBudgetSpent,
    });

    const status = overallStatus(result.score);
    const hasData = result.components.length > 0;

    // Gauge geometry.
    const R = 52;
    const CIRC = 2 * Math.PI * R;
    const dash = (result.score / 100) * CIRC;

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Financial health score"
                description="A composite of your savings rate, emergency fund, debt-to-income, credit utilization and budget adherence."
            />

            {!hasData ? (
                <Card>
                    <p className="text-sm text-tertiary">
                        Add income, accounts, cards or budgets to generate your score. We use the last 90 days of income and spending plus your current balances.
                    </p>
                </Card>
            ) : (
                <>
                    <BloomCard bloom={statusColor[status]}>
                        <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-8">
                            <div className="relative shrink-0">
                                <svg viewBox="0 0 120 120" className="size-40">
                                    <circle cx="60" cy="60" r={R} fill="none" stroke="var(--color-bg-quaternary)" strokeWidth="12" />
                                    <circle
                                        cx="60"
                                        cy="60"
                                        r={R}
                                        fill="none"
                                        stroke={statusHex[status]}
                                        strokeWidth="12"
                                        strokeLinecap="round"
                                        strokeDasharray={`${dash} ${CIRC}`}
                                        transform="rotate(-90 60 60)"
                                    />
                                    <text x="60" y="56" textAnchor="middle" className="fill-primary text-3xl font-bold" style={{ fontSize: 30 }}>
                                        {result.score}
                                    </text>
                                    <text x="60" y="78" textAnchor="middle" className="fill-tertiary" style={{ fontSize: 12 }}>
                                        / 100
                                    </text>
                                </svg>
                            </div>
                            <div className="flex flex-col gap-1 text-center sm:text-left">
                                <p className="text-display-xs font-semibold text-primary">
                                    {result.label} <span className="text-tertiary">· {result.grade}</span>
                                </p>
                                <p className="max-w-md text-sm text-tertiary">
                                    Scored from {result.components.length} indicator{result.components.length === 1 ? "" : "s"}. Improve the lowest bars below to raise
                                    your score the fastest.
                                </p>
                            </div>
                        </div>
                    </BloomCard>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {result.components.map((c) => (
                            <Card key={c.key} className="flex flex-col gap-3">
                                <div className="flex items-baseline justify-between gap-2">
                                    <p className="text-sm font-medium text-secondary">{c.label}</p>
                                    <p className="text-sm font-semibold text-primary tabular-nums">{c.value}</p>
                                </div>
                                <ProgressBar value={c.score} max={100} color={statusColor[c.status]} />
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs text-tertiary">{c.detail}</p>
                                    <span className="shrink-0 text-xs font-medium text-tertiary tabular-nums">{c.score}/100</span>
                                </div>
                            </Card>
                        ))}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Stat label="Avg monthly income" value={formatCurrency(monthlyIncome)} sub="trailing 90 days" />
                        <Stat label="Avg monthly spending" value={formatCurrency(monthlySpending)} sub="trailing 90 days" />
                        <Stat label="Liquid savings" value={formatCurrency(liquidSavings)} sub="cash + savings" />
                        <Stat label="Monthly debt payments" value={formatCurrency(monthlyDebtPayments)} sub="loan + card minimums" />
                    </div>
                </>
            )}
        </div>
    );
}
