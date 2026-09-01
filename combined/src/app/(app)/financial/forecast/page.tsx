import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildForecast, cadenceDays, expandRecurring, type BillEvent } from "@/lib/financial/forecast";
import { monthlyFromCadence } from "@/lib/financial/format";
import { formatCurrency } from "@/lib/financial/format";
import { BloomCard, Card, SectionHeader, Stat } from "../_components/financial-ui";
import { ForecastChart, type ForecastChartPoint } from "./forecast-chart";

export const dynamic = "force-dynamic";

const LIQUID_KINDS = ["CHECKING", "SAVINGS", "MONEY_MARKET"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export default async function CashFlowForecastPage() {
    const user = await requireUser();

    const now = new Date();
    const windowStart = new Date(now.getTime() - 90 * DAY_MS);

    const [accounts, incomeAgg, spendAgg, subs, debts, cards] = await Promise.all([
        db.finAccount.findMany({ where: { userId: user.id, archived: false }, select: { kind: true, currentBalance: true, includeInNetWorth: true, isAsset: true } }),
        db.incomeEntry.aggregate({ where: { userId: user.id, receivedAt: { gte: windowStart } }, _sum: { amount: true } }),
        db.finTransaction.aggregate({ where: { userId: user.id, date: { gte: windowStart }, amount: { lt: 0 } }, _sum: { amount: true } }),
        db.finSubscription.findMany({ where: { userId: user.id, status: "ACTIVE" }, select: { name: true, merchant: true, amount: true, cadence: true, nextChargeOn: true } }),
        db.debt.findMany({ where: { userId: user.id }, select: { name: true, minimumPayment: true } }),
        db.creditCard.findMany({ where: { userId: user.id, archived: false }, select: { nickname: true, productName: true, minimumPayment: true, paymentDueAt: true } }),
    ]);

    const startBalance = accounts
        .filter((a) => a.includeInNetWorth && a.isAsset && (LIQUID_KINDS as readonly string[]).includes(a.kind))
        .reduce((s, a) => s + Number(a.currentBalance), 0);

    const monthlyIncome = Number(incomeAgg._sum.amount ?? 0) / 3;
    const monthlySpending = Math.abs(Number(spendAgg._sum.amount ?? 0)) / 3;
    const monthlySubsCost = subs.reduce((s, x) => s + monthlyFromCadence(Number(x.amount), x.cadence), 0);

    const dailyIncome = monthlyIncome / 30;
    // Discretionary = all spending minus the discrete recurring bills we place below, so
    // subscriptions/debt aren't double-counted.
    const dailyDiscretionary = Math.max(0, monthlySpending - monthlySubsCost) / 30;

    const bills: BillEvent[] = [];
    for (const s of subs) {
        if (!s.nextChargeOn || Number(s.amount) <= 0) continue;
        const firstOffset = Math.round((s.nextChargeOn.getTime() - now.getTime()) / DAY_MS);
        bills.push(...expandRecurring(firstOffset, cadenceDays(s.cadence), Number(s.amount), s.name || s.merchant));
    }
    for (const d of debts) {
        const amt = Number(d.minimumPayment ?? 0);
        if (amt <= 0) continue;
        bills.push(...expandRecurring(30, 30, amt, `${d.name} (min.)`));
    }
    for (const c of cards) {
        const amt = Number(c.minimumPayment ?? 0);
        if (amt <= 0) continue;
        const firstOffset = c.paymentDueAt ? Math.round((c.paymentDueAt.getTime() - now.getTime()) / DAY_MS) : 25;
        bills.push(...expandRecurring(firstOffset, 30, amt, `${c.nickname || c.productName || "Card"} (min.)`));
    }

    const forecast = buildForecast({ startBalance, dailyIncome, dailyDiscretionary, bills, horizonDays: 90 });

    const fmtDay = (day: number) => {
        const d = new Date(now.getTime() + day * DAY_MS);
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };
    const chartData: ForecastChartPoint[] = forecast.series.map((p) => ({ day: p.day, label: fmtDay(p.day), balance: p.balance }));

    const netMonthly = monthlyIncome - monthlySpending;
    const hasData = startBalance !== 0 || monthlyIncome > 0 || monthlySpending > 0 || bills.length > 0;

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Cash flow forecast"
                description="Projects your liquid balance 30/60/90 days out from recurring income, bills and average spending."
            />

            {!hasData ? (
                <Card>
                    <p className="text-sm text-tertiary">Add a checking/savings account, some income, and recurring bills to see a forecast.</p>
                </Card>
            ) : (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Stat label="Today" value={formatCurrency(startBalance)} sub="liquid cash" />
                        <Stat label="In 30 days" value={formatCurrency(forecast.d30)} tone={forecast.d30 < 0 ? "error" : undefined} />
                        <Stat label="In 60 days" value={formatCurrency(forecast.d60)} tone={forecast.d60 < 0 ? "error" : undefined} />
                        <Stat label="In 90 days" value={formatCurrency(forecast.d90)} tone={forecast.d90 < 0 ? "error" : undefined} />
                    </div>

                    <Card className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-secondary">Projected balance</p>
                            <p className="text-xs text-tertiary">
                                Net {netMonthly >= 0 ? "+" : ""}
                                {formatCurrency(netMonthly)}/mo · {formatCurrency(forecast.totalBills)} in bills over 90 days
                            </p>
                        </div>
                        <ForecastChart data={chartData} />
                    </Card>

                    {forecast.firstNegativeDay != null ? (
                        <BloomCard bloom="error">
                            <p className="text-sm font-semibold text-primary">Heads up — projected shortfall</p>
                            <p className="text-sm text-tertiary">
                                At this rate your liquid balance dips below $0 around {fmtDay(forecast.firstNegativeDay)} (in {forecast.firstNegativeDay} days). Lowest
                                point: {formatCurrency(forecast.lowest.balance)} on {fmtDay(forecast.lowest.day)}.
                            </p>
                        </BloomCard>
                    ) : (
                        <BloomCard bloom="success">
                            <p className="text-sm font-semibold text-primary">On track</p>
                            <p className="text-sm text-tertiary">
                                Your balance stays positive across the next 90 days. Lowest projected point: {formatCurrency(forecast.lowest.balance)} on{" "}
                                {fmtDay(forecast.lowest.day)}.
                            </p>
                        </BloomCard>
                    )}
                </>
            )}
        </div>
    );
}
