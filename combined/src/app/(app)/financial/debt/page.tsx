import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { PayoffDebt } from "@/lib/financial/debt-payoff";
import { DebtClient, type CardDebtRow, type DebtRow } from "./debt-client";
import { DebtPayoffPlanner } from "./debt-payoff-planner";

export default async function DebtPage() {
    const user = await requireUser();

    const [debts, cards] = await Promise.all([
        db.debt.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
        db.creditCard.findMany({
            where: { userId: user.id, archived: false },
            orderBy: { currentBalance: "desc" },
            select: { id: true, nickname: true, productName: true, issuer: true, apr: true, currentBalance: true },
        }),
    ]);

    const debtRows: DebtRow[] = debts.map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        principalOriginal: d.principalOriginal != null ? Number(d.principalOriginal) : null,
        principalRemaining: d.principalRemaining != null ? Number(d.principalRemaining) : null,
        apr: d.apr != null ? Number(d.apr) : null,
        minimumPayment: d.minimumPayment != null ? Number(d.minimumPayment) : null,
        payoffGoalDate: d.payoffGoalDate?.toISOString() ?? null,
        strategy: d.strategy,
    }));

    // Surface credit-card balances as liabilities alongside tracked debts.
    const cardRows: CardDebtRow[] = cards
        .filter((c) => Number(c.currentBalance) > 0)
        .map((c) => ({
            id: c.id,
            label: c.nickname || c.productName || c.issuer || "Credit card",
            balance: Number(c.currentBalance),
            apr: c.apr != null ? Number(c.apr) : null,
        }));

    // Combined payoff inputs: tracked debts + carried card balances. Cards rarely store a
    // minimum, so estimate the standard "2% of balance, min $25" when one isn't on file.
    const payoffDebts: PayoffDebt[] = [
        ...debtRows
            .filter((d) => (d.principalRemaining ?? 0) > 0)
            .map((d) => ({
                id: d.id,
                name: d.name,
                balance: d.principalRemaining ?? 0,
                apr: d.apr ?? 0,
                minPayment: d.minimumPayment ?? Math.max(25, (d.principalRemaining ?? 0) * 0.02),
            })),
        ...cardRows.map((c) => ({ id: c.id, name: c.label, balance: c.balance, apr: c.apr ?? 22, minPayment: Math.max(25, c.balance * 0.02) })),
    ];

    return (
        <div className="flex flex-col gap-8">
            <DebtClient debts={debtRows} cards={cardRows} />
            <DebtPayoffPlanner debts={payoffDebts} />
        </div>
    );
}
