import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { monthlyFromCadence } from "@/lib/financial/format";
import { formatMonthYear } from "@/lib/dates";
import { BankNote03 } from "@untitledui/icons";
import { getAlpacaEquity } from "@/lib/actions/financial-alpaca";
import { buildDailyNetWorthHistory } from "@/lib/financial/net-worth-history";
import { GradientCtaBanner } from "@/components/app-shell/gradient-cta-banner";
import { AiSuggestionCard } from "@/components/app-shell/ai-suggestion-card";
import { OverviewClient, type OverviewData } from "./overview-client";

export default async function FinancialOverviewPage() {
    const user = await requireUser();

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const upcomingEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const [accounts, brokerage, cards, debts, spendingByCat, categories, recentTxns, subs, cashflowAgg, scores, goals, budgetCats, alpacaEquity] = await Promise.all([
        db.finAccount.findMany({ where: { userId: user.id, archived: false } }),
        db.brokerageAccount.findMany({ where: { userId: user.id, archived: false } }),
        db.creditCard.findMany({ where: { userId: user.id, archived: false } }),
        db.debt.findMany({ where: { userId: user.id } }),
        db.finTransaction.groupBy({
            by: ["categoryId"],
            // Net of refunds: sum ALL amounts this month per category (a refund offsets a
            // charge), then flip the sign below so true spending is positive.
            where: { userId: user.id, date: { gte: monthStart, lt: monthEnd } },
            _sum: { amount: true },
        }),
        db.budgetCategory.findMany({ where: { userId: user.id } }),
        db.finTransaction.findMany({ where: { userId: user.id }, orderBy: { date: "desc" }, take: 8, include: { category: true } }),
        db.finSubscription.findMany({ where: { userId: user.id, status: "ACTIVE" }, orderBy: { nextChargeOn: "asc" } }),
        db.finTransaction.findMany({ where: { userId: user.id, date: { gte: monthStart, lt: monthEnd } }, select: { amount: true } }),
        db.creditScoreEntry.findMany({ where: { userId: user.id }, orderBy: { scoreDate: "asc" }, take: 120 }),
        db.financialGoal.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
        db.budgetCategory.findMany({ where: { userId: user.id } }),
        getAlpacaEquity(user.id), // live Alpaca equity (null when not connected)
    ]);

    // Net worth (live).
    // BROKERAGE accounts are FinAccounts now; their currentBalance already reflects
    // live Alpaca equity (when alpacaLinked) → holdings → statement, so they are
    // counted ONCE in the account loop below. We do NOT add getAlpacaEquity()
    // separately here — that would double-count a linked account's live equity.
    let assets = 0;
    let liabilities = 0;
    let brokerageAssets = 0;
    for (const a of accounts) {
        if (!a.includeInNetWorth) continue;
        const bal = Number(a.currentBalance);
        if (a.kind === "LOAN" || !a.isAsset) liabilities += Math.abs(bal);
        else {
            assets += bal;
            if (a.kind === "BROKERAGE") brokerageAssets += bal;
        }
    }
    // Legacy BrokerageAccount rows are reconciled into FinAccounts on the accounts
    // page; include any not-yet-migrated rows so nothing is missed in the meantime.
    const legacyBrokerage = brokerage.reduce((s, b) => s + Number(b.currentValue), 0);
    assets += legacyBrokerage;
    liabilities += cards.reduce((s, c) => s + Number(c.currentBalance), 0);
    liabilities += debts.reduce((s, d) => s + Number(d.principalRemaining ?? 0), 0);
    const netWorth = assets - liabilities;

    const netWorthHistory = await buildDailyNetWorthHistory({ userId: user.id, current: { assets, liabilities, netWorth }, days: 90 });
    const priorPoint = netWorthHistory.length > 31 ? netWorthHistory[netWorthHistory.length - 31] : null;
    const netWorthDelta = priorPoint ? netWorth - priorPoint.netWorth : null;

    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const spending = spendingByCat
        .map((g) => ({ name: g.categoryId ? (catName.get(g.categoryId) ?? "Other") : "Uncategorized", value: Math.max(0, -Number(g._sum.amount ?? 0)) }))
        .filter((x) => x.value > 0)
        .sort((a, b) => b.value - a.value);

    // Cashflow this month.
    let inflow = 0;
    let outflow = 0;
    for (const t of cashflowAgg) {
        const v = Number(t.amount);
        if (v >= 0) inflow += v;
        else outflow += Math.abs(v);
    }

    // Budget health.
    const totalBudget = budgetCats.reduce((s, c) => s + Number(c.monthlyBudget ?? 0), 0);
    const totalSpent = spending.reduce((s, x) => s + x.value, 0);

    // Upcoming bills: subscriptions due in 14 days + debt minimum payments.
    const upcomingSubs = subs
        .filter((s) => s.nextChargeOn && s.nextChargeOn >= now && s.nextChargeOn <= upcomingEnd)
        .map((s) => ({ id: s.id, kind: "subscription" as const, label: s.name || s.merchant, amount: Number(s.amount), date: s.nextChargeOn!.toISOString() }));
    const upcomingDebts = debts
        .filter((d) => d.minimumPayment != null && Number(d.minimumPayment) > 0)
        .map((d) => ({ id: d.id, kind: "debt" as const, label: `${d.name} (min. payment)`, amount: Number(d.minimumPayment), date: null as string | null }));
    const upcomingBills = [...upcomingSubs, ...upcomingDebts].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));

    const monthlySubCost = subs.reduce((sum, s) => sum + monthlyFromCadence(Number(s.amount), s.cadence), 0);

    const data: OverviewData = {
        assets,
        liabilities,
        netWorth,
        netWorthDelta,
        alpacaEquity: alpacaEquity ?? null,
        accountsSummary: {
            cash: accounts.filter((a) => a.kind === "CHECKING").reduce((s, a) => s + Number(a.currentBalance), 0),
            savings: accounts.filter((a) => a.kind === "SAVINGS").reduce((s, a) => s + Number(a.currentBalance), 0),
            investments: brokerageAssets + legacyBrokerage,
            cardDebt: cards.reduce((s, c) => s + Number(c.currentBalance), 0),
        },
        trend: netWorthHistory.map((point) => ({
            label: point.label,
            value: point.netWorth,
            assets: point.assets,
            liabilities: point.liabilities,
        })),
        cashflow: { inflow, outflow },
        budget: { totalBudget, totalSpent },
        spending,
        upcomingBills,
        monthlySubCost,
        creditScores: scores.map((s) => ({
            id: s.id,
            label: formatMonthYear(s.scoreDate),
            value: s.score,
            scoreDate: s.scoreDate.toISOString().slice(0, 10),
            bureau: s.bureau ?? null,
            notes: s.notes ?? null,
        })),
        goals: goals.map((g) => ({
            id: g.id,
            title: g.title,
            current: Number(g.currentAmount),
            target: g.targetAmount != null ? Number(g.targetAmount) : null,
        })),
        recent: recentTxns.map((t) => ({
            id: t.id,
            date: t.date.toISOString(),
            merchant: t.merchant || t.rawDescription || "—",
            category: t.category?.name ?? null,
            amount: Number(t.amount),
        })),
    };

    // Rule-based money insight: no budget set up → nudge to create one; otherwise
    // flag this month's spending if it has pushed past the planned budget.
    const overBudget = totalBudget > 0 ? totalSpent - totalBudget : 0;
    const aiSuggestion =
        budgetCats.length === 0
            ? {
                  title: "Set up a monthly budget",
                  body: "You're tracking spending but haven't set any budget categories yet. Add a few to see where your money is going and catch overspend early.",
                  iconName: "pie-chart" as const,
                  confidence: "high" as const,
                  href: "/financial/budget",
                  ctaLabel: "Create a budget",
              }
            : overBudget > 0
              ? {
                    title: "You're over budget this month",
                    body: `Spending so far is $${Math.round(totalSpent).toLocaleString()} against a $${Math.round(totalBudget).toLocaleString()} budget — about $${Math.round(overBudget).toLocaleString()} over. Review your categories before month-end.`,
                    iconName: "trend-up" as const,
                    confidence: "high" as const,
                    href: "/financial/budget",
                    ctaLabel: "Review budget",
                }
              : null;

    return (
        <div className="flex flex-col gap-6">
            <GradientCtaBanner
                tone="emerald"
                icon={BankNote03}
                eyebrow="Your money, in control"
                title="Grow your net worth"
                description="Track spending, net worth and goals in one place — log activity to keep your numbers sharp."
                primary={{ label: "Log a transaction", href: "/financial/transactions" }}
                secondary={{ label: "Connect accounts", href: "/financial/accounts" }}
            />
            {aiSuggestion && (
                <AiSuggestionCard
                    tone="emerald"
                    title={aiSuggestion.title}
                    body={aiSuggestion.body}
                    iconName={aiSuggestion.iconName}
                    confidence={aiSuggestion.confidence}
                    href={aiSuggestion.href}
                    ctaLabel={aiSuggestion.ctaLabel}
                />
            )}
            <OverviewClient data={data} />
        </div>
    );
}
