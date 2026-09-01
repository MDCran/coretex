import { AlertCircle, AlertTriangle, CheckCircle, InfoCircle } from "@untitledui/icons";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeAlerts, type AlertSeverity } from "@/lib/financial/alerts";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { BloomCard, Card, SectionHeader } from "../_components/financial-ui";

export const dynamic = "force-dynamic";

const LIQUID_KINDS = ["CHECKING", "SAVINGS", "MONEY_MARKET"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle } as const;
const severityColor: Record<AlertSeverity, "error" | "warning" | "brand"> = { error: "error", warning: "warning", info: "brand" };

export default async function FinancialAlertsPage() {
    const user = await requireUser();
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const recentStart = new Date(now.getTime() - 30 * DAY_MS);
    const windowStart = new Date(now.getTime() - 90 * DAY_MS);

    const [accounts, cards, subs, budgetCats, monthAgg, recent, spendAgg] = await Promise.all([
        db.finAccount.findMany({ where: { userId: user.id, archived: false }, select: { id: true, kind: true, nickname: true, last4: true, currentBalance: true } }),
        db.creditCard.findMany({ where: { userId: user.id, archived: false }, select: { id: true, nickname: true, productName: true, currentBalance: true, creditLimit: true, paymentDueAt: true, paymentOverdue: true } }),
        db.finSubscription.findMany({ where: { userId: user.id, status: "ACTIVE" }, select: { id: true, name: true, merchant: true, amount: true, nextChargeOn: true } }),
        db.budgetCategory.findMany({ where: { userId: user.id }, select: { monthlyBudget: true } }),
        db.finTransaction.aggregate({ where: { userId: user.id, date: { gte: monthStart, lt: monthEnd } }, _sum: { amount: true } }),
        db.finTransaction.findMany({ where: { userId: user.id, date: { gte: recentStart }, amount: { lt: 0 } }, orderBy: { date: "desc" }, take: 100, select: { id: true, merchant: true, rawDescription: true, amount: true, date: true } }),
        db.finTransaction.aggregate({ where: { userId: user.id, date: { gte: windowStart }, amount: { lt: 0 } }, _sum: { amount: true } }),
    ]);

    const liquidBalance = accounts.filter((a) => (LIQUID_KINDS as readonly string[]).includes(a.kind)).reduce((s, a) => s + Number(a.currentBalance), 0);
    const monthlySpending = Math.abs(Number(spendAgg._sum.amount ?? 0)) / 3;
    const emergencyMonths = monthlySpending > 0 ? liquidBalance / monthlySpending : null;

    const alerts = computeAlerts({
        accounts: accounts.map((a) => ({
            id: a.id,
            name: a.nickname || `Account ••${a.last4 ?? ""}`,
            balance: Number(a.currentBalance),
            liquid: (LIQUID_KINDS as readonly string[]).includes(a.kind),
        })),
        cards: cards.map((c) => ({
            id: c.id,
            name: c.nickname || c.productName || "Card",
            balance: Number(c.currentBalance),
            limit: c.creditLimit != null ? Number(c.creditLimit) : null,
            dueInDays: c.paymentDueAt ? Math.round((c.paymentDueAt.getTime() - now.getTime()) / DAY_MS) : null,
            overdue: c.paymentOverdue,
        })),
        upcomingBills: subs
            .filter((s) => s.nextChargeOn)
            .map((s) => ({ id: s.id, label: s.name || s.merchant, amount: Number(s.amount), inDays: Math.round((s.nextChargeOn!.getTime() - now.getTime()) / DAY_MS) })),
        budgetTotal: budgetCats.reduce((s, c) => s + Number(c.monthlyBudget ?? 0), 0),
        budgetSpent: Math.max(0, -Number(monthAgg._sum.amount ?? 0)),
        recentOutflows: recent.map((t) => ({ id: t.id, merchant: t.merchant || t.rawDescription || "Charge", amount: Number(t.amount), date: t.date.toISOString().slice(0, 10) })),
        emergencyMonths,
    });

    const counts = {
        error: alerts.filter((a) => a.severity === "error").length,
        warning: alerts.filter((a) => a.severity === "warning").length,
        info: alerts.filter((a) => a.severity === "info").length,
    };

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Smart alerts"
                description="Low balances, due bills, overdrafts, high utilization, budget overruns and unusual charges — surfaced automatically."
            />

            {alerts.length === 0 ? (
                <BloomCard bloom="success">
                    <div className="flex items-center gap-3">
                        <FeaturedIcon icon={CheckCircle} color="success" theme="light" size="md" />
                        <div>
                            <p className="text-sm font-semibold text-primary">All clear</p>
                            <p className="text-sm text-tertiary">No alerts right now — balances are healthy, bills are current, and spending is on track.</p>
                        </div>
                    </div>
                </BloomCard>
            ) : (
                <>
                    <p className="text-sm text-tertiary">
                        {counts.error > 0 && <span className="font-medium text-error-primary">{counts.error} urgent</span>}
                        {counts.error > 0 && (counts.warning > 0 || counts.info > 0) && " · "}
                        {counts.warning > 0 && <span className="font-medium text-warning-primary">{counts.warning} warning{counts.warning === 1 ? "" : "s"}</span>}
                        {counts.warning > 0 && counts.info > 0 && " · "}
                        {counts.info > 0 && <span className="text-tertiary">{counts.info} info</span>}
                    </p>
                    <div className="flex flex-col gap-3">
                        {alerts.map((a) => {
                            const Icon = severityIcon[a.severity];
                            return (
                                <Card key={a.id} className="flex items-start gap-3">
                                    <FeaturedIcon icon={Icon} color={severityColor[a.severity]} theme="light" size="md" />
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-primary">{a.title}</p>
                                        <p className="text-sm text-tertiary">{a.detail}</p>
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
