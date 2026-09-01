import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { convertToUsd } from "@/lib/financial/fx";
import { buildDailyNetWorthHistory } from "@/lib/financial/net-worth-history";
import { NetWorthClient, type NetWorthBreakdown, type NetWorthHistoryPoint } from "./net-worth-client";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function NetWorthPage() {
    const user = await requireUser();
    const windowStart = new Date(Date.now() - 90 * DAY_MS);

    const [accounts, brokerage, cards, debts, spendAgg, rates] = await Promise.all([
        db.finAccount.findMany({ where: { userId: user.id, archived: false }, select: { kind: true, currentBalance: true, currency: true, includeInNetWorth: true, isAsset: true } }),
        db.brokerageAccount.findMany({ where: { userId: user.id, archived: false }, select: { currentValue: true } }),
        db.creditCard.findMany({ where: { userId: user.id, archived: false }, select: { currentBalance: true } }),
        db.debt.findMany({ where: { userId: user.id }, select: { principalRemaining: true } }),
        db.finTransaction.aggregate({ where: { userId: user.id, date: { gte: windowStart }, amount: { lt: 0 } }, _sum: { amount: true } }),
        db.exchangeRate.findMany(),
    ]);

    // Convert every balance to USD so mixed-currency accounts net worth is accurate.
    const rateMap = new Map(rates.map((r) => [r.code, Number(r.rateToUsd)]));

    let cash = 0;
    let savings = 0;
    let investments = 0;
    let otherAssets = 0;
    let loans = 0;
    for (const a of accounts) {
        if (!a.includeInNetWorth) continue;
        const bal = convertToUsd(Number(a.currentBalance), a.currency, rateMap);
        if (a.kind === "LOAN" || !a.isAsset) {
            loans += Math.abs(bal);
        } else if (a.kind === "CHECKING") {
            cash += bal;
        } else if (a.kind === "SAVINGS" || a.kind === "MONEY_MARKET" || a.kind === "CD") {
            savings += bal;
        } else if (a.kind === "BROKERAGE") {
            investments += bal;
        } else {
            otherAssets += bal;
        }
    }
    investments += brokerage.reduce((s, b) => s + Number(b.currentValue), 0);

    const cardDebt = cards.reduce((s, c) => s + Number(c.currentBalance), 0);
    const debtTotal = debts.reduce((s, d) => s + Number(d.principalRemaining ?? 0), 0);

    const assets = cash + savings + investments + otherAssets;
    const liabilities = loans + cardDebt + debtTotal;

    const breakdown: NetWorthBreakdown = {
        cash,
        savings,
        investments,
        otherAssets,
        loans,
        cardDebt,
        debts: debtTotal,
        assets,
        liabilities,
        netWorth: assets - liabilities,
    };

    const dailyHistory = await buildDailyNetWorthHistory({ userId: user.id, current: { assets, liabilities, netWorth: breakdown.netWorth }, days: 365 });
    const history: NetWorthHistoryPoint[] = dailyHistory.map((point) => ({
        date: point.date,
        net: point.netWorth,
        assets: point.assets,
        liabilities: point.liabilities,
    }));

    const liquidSavings = cash + savings;
    const monthlySpending = Math.abs(Number(spendAgg._sum.amount ?? 0)) / 3;

    return <NetWorthClient breakdown={breakdown} history={history} liquidSavings={liquidSavings} monthlySpending={monthlySpending} />;
}
