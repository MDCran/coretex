/**
 * Smart financial alerts — derives actionable warnings from the current financial
 * picture. Pure + client-safe; no persistence (computed fresh each load).
 */

export type AlertSeverity = "error" | "warning" | "info";
export type AlertKind = "balance" | "bill" | "budget" | "utilization" | "transaction" | "emergency";

export interface FinancialAlert {
    id: string;
    severity: AlertSeverity;
    kind: AlertKind;
    title: string;
    detail: string;
}

export interface AlertInputs {
    accounts: { id: string; name: string; balance: number; liquid: boolean }[];
    cards: { id: string; name: string; balance: number; limit: number | null; dueInDays: number | null; overdue: boolean }[];
    upcomingBills: { id: string; label: string; amount: number; inDays: number }[];
    budgetTotal: number;
    budgetSpent: number;
    /** Transactions in the recent window, used to flag unusually large charges. */
    recentOutflows: { id: string; merchant: string; amount: number; date: string }[];
    emergencyMonths: number | null;
    /** Low-balance threshold for liquid accounts. */
    lowBalanceThreshold?: number;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { error: 0, warning: 1, info: 2 };

export function computeAlerts(input: AlertInputs): FinancialAlert[] {
    const alerts: FinancialAlert[] = [];
    const lowBalance = input.lowBalanceThreshold ?? 100;

    // Account balances.
    for (const a of input.accounts) {
        if (a.balance < 0) {
            alerts.push({ id: `bal-neg-${a.id}`, severity: "error", kind: "balance", title: `${a.name} is overdrawn`, detail: `Balance is ${money(a.balance)}.` });
        } else if (a.liquid && a.balance < lowBalance) {
            alerts.push({ id: `bal-low-${a.id}`, severity: "warning", kind: "balance", title: `Low balance: ${a.name}`, detail: `Only ${money(a.balance)} left — below your ${money(lowBalance)} buffer.` });
        }
    }

    // Card payments + utilization.
    for (const c of input.cards) {
        if (c.overdue) {
            alerts.push({ id: `card-overdue-${c.id}`, severity: "error", kind: "bill", title: `${c.name} payment overdue`, detail: `Pay now to avoid late fees and credit damage.` });
        } else if (c.dueInDays != null && c.dueInDays >= 0 && c.dueInDays <= 5) {
            alerts.push({ id: `card-due-${c.id}`, severity: "warning", kind: "bill", title: `${c.name} payment due ${inDaysLabel(c.dueInDays)}`, detail: `Schedule your payment to stay current.` });
        }
        if (c.limit && c.limit > 0) {
            const util = c.balance / c.limit;
            if (util >= 0.9) {
                alerts.push({ id: `util-${c.id}`, severity: "error", kind: "utilization", title: `${c.name} nearly maxed out`, detail: `${pct(util)} utilization — this hurts your credit score.` });
            } else if (util >= 0.7) {
                alerts.push({ id: `util-${c.id}`, severity: "warning", kind: "utilization", title: `High utilization on ${c.name}`, detail: `${pct(util)} utilization — aim to keep it under 30%.` });
            }
        }
    }

    // Upcoming bills (next few days, not already a card alert).
    for (const b of input.upcomingBills) {
        if (b.inDays >= 0 && b.inDays <= 3) {
            alerts.push({ id: `bill-${b.id}`, severity: "info", kind: "bill", title: `${b.label} charges ${inDaysLabel(b.inDays)}`, detail: `${money(-Math.abs(b.amount))} scheduled.` });
        }
    }

    // Budget.
    if (input.budgetTotal > 0) {
        const ratio = input.budgetSpent / input.budgetTotal;
        if (ratio > 1) {
            alerts.push({ id: "budget-over", severity: "warning", kind: "budget", title: "Over budget this month", detail: `You've spent ${money(input.budgetSpent)} of your ${money(input.budgetTotal)} budget (${pct(ratio)}).` });
        } else if (ratio > 0.9) {
            alerts.push({ id: "budget-near", severity: "info", kind: "budget", title: "Approaching your budget", detail: `${pct(ratio)} of this month's budget used.` });
        }
    }

    // Unusually large transactions — flag outflows well above the typical size.
    const amounts = input.recentOutflows.map((t) => Math.abs(t.amount)).sort((a, b) => a - b);
    if (amounts.length >= 4) {
        const median = amounts[Math.floor(amounts.length / 2)];
        const threshold = Math.max(median * 4, 500);
        for (const t of input.recentOutflows) {
            if (Math.abs(t.amount) >= threshold) {
                alerts.push({ id: `txn-${t.id}`, severity: "info", kind: "transaction", title: `Large charge: ${t.merchant}`, detail: `${money(-Math.abs(t.amount))} on ${t.date} — well above your typical spend.` });
            }
        }
    }

    // Emergency fund.
    if (input.emergencyMonths != null && input.emergencyMonths < 1) {
        alerts.push({ id: "emergency", severity: "warning", kind: "emergency", title: "Thin emergency fund", detail: `You have under 1 month of expenses saved. Aim for 3–6 months.` });
    }

    return alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

function money(n: number): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function pct(n: number): string {
    return `${Math.round(n * 100)}%`;
}
function inDaysLabel(days: number): string {
    if (days <= 0) return "today";
    if (days === 1) return "tomorrow";
    return `in ${days} days`;
}
