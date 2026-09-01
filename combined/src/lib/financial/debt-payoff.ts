/**
 * Multi-debt payoff simulator — snowball (lowest balance first) vs avalanche (highest
 * APR first). Pure + client-safe.
 *
 * Method (the standard "debt rollover"): every month you pay a fixed total = the sum of
 * all minimum payments + your extra. Each active debt gets at least its minimum; the
 * leftover (extra + minimums freed by paid-off debts) is thrown entirely at the current
 * target debt. Interest compounds monthly on the remaining balance.
 */

export type PayoffStrategy = "snowball" | "avalanche";

export interface PayoffDebt {
    id: string;
    name: string;
    balance: number;
    /** Annual percentage rate, e.g. 19.99. */
    apr: number;
    minPayment: number;
}

export interface PayoffOrderEntry {
    id: string;
    name: string;
    /** 1-based month the debt is fully paid off. */
    payoffMonth: number;
    interestPaid: number;
}

export interface PayoffTimelinePoint {
    month: number;
    balance: number;
}

export interface PayoffResult {
    months: number;
    totalInterest: number;
    totalPaid: number;
    order: PayoffOrderEntry[];
    timeline: PayoffTimelinePoint[];
    /** True when the budget can't cover interest + minimums (never pays off within the cap). */
    impossible: boolean;
}

const MONTH_CAP = 600; // 50 years

function priority(debts: { balance: number; apr: number }[], strategy: PayoffStrategy): number[] {
    const idx = debts.map((_, i) => i);
    idx.sort((a, b) => {
        if (strategy === "snowball") return debts[a].balance - debts[b].balance || debts[b].apr - debts[a].apr;
        return debts[b].apr - debts[a].apr || debts[a].balance - debts[b].balance;
    });
    return idx;
}

export function simulatePayoff(input: PayoffDebt[], strategy: PayoffStrategy, extraMonthly: number): PayoffResult {
    const debts = input
        .filter((d) => d.balance > 0)
        .map((d) => ({ id: d.id, name: d.name, balance: d.balance, apr: Math.max(0, d.apr), min: Math.max(0, d.minPayment), interest: 0, payoffMonth: 0 }));

    if (debts.length === 0) {
        return { months: 0, totalInterest: 0, totalPaid: 0, order: [], timeline: [{ month: 0, balance: 0 }], impossible: false };
    }

    const budget = debts.reduce((s, d) => s + d.min, 0) + Math.max(0, extraMonthly);
    const startBalance = debts.reduce((s, d) => s + d.balance, 0);
    const timeline: PayoffTimelinePoint[] = [{ month: 0, balance: round(startBalance) }];

    let month = 0;
    let totalInterest = 0;
    let totalPaid = 0;
    let impossible = false;

    while (debts.some((d) => d.balance > 0.005)) {
        month++;
        if (month > MONTH_CAP) {
            impossible = true;
            break;
        }

        // 1) Accrue interest on every active debt.
        for (const d of debts) {
            if (d.balance <= 0) continue;
            const interest = d.balance * (d.apr / 100 / 12);
            d.balance += interest;
            d.interest += interest;
            totalInterest += interest;
        }

        // 2) Pay minimums on all active debts except the target; collect the rest for the target.
        const activeOrder = priority(debts, strategy).filter((i) => debts[i].balance > 0);
        let remaining = budget;

        // Detect a stuck plan: budget can't even cover this month's interest + minimums.
        const minNeeded = activeOrder.reduce((s, i) => s + Math.min(debts[i].min, debts[i].balance), 0);
        if (budget < minNeeded - 0.01 && activeOrder.length > 0) {
            // Pay what we can proportionally; if balances still grow, we'll hit the cap.
            for (const i of activeOrder) {
                const pay = Math.min(debts[i].balance, (debts[i].min / minNeeded) * budget);
                debts[i].balance -= pay;
                totalPaid += pay;
            }
        } else {
            for (let k = activeOrder.length - 1; k >= 1; k--) {
                const i = activeOrder[k];
                const pay = Math.min(debts[i].min, debts[i].balance);
                debts[i].balance -= pay;
                remaining -= pay;
                totalPaid += pay;
            }
            // Target debt(s): throw the rest, cascading to the next debt if one is cleared mid-month.
            for (const i of activeOrder) {
                if (remaining <= 0) break;
                if (debts[i].balance <= 0) continue;
                const pay = Math.min(debts[i].balance, remaining);
                debts[i].balance -= pay;
                remaining -= pay;
                totalPaid += pay;
            }
        }

        // 3) Stamp payoff month for anything that just cleared.
        for (const d of debts) {
            if (d.payoffMonth === 0 && d.balance <= 0.005) d.payoffMonth = month;
        }

        timeline.push({ month, balance: round(Math.max(0, debts.reduce((s, d) => s + Math.max(0, d.balance), 0))) });
    }

    const order = [...debts]
        .sort((a, b) => a.payoffMonth - b.payoffMonth)
        .map((d) => ({ id: d.id, name: d.name, payoffMonth: d.payoffMonth || month, interestPaid: round(d.interest) }));

    return { months: month, totalInterest: round(totalInterest), totalPaid: round(totalPaid), order, timeline, impossible };
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}
