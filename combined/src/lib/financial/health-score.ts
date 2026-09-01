/**
 * Financial Health Score — a 0–100 composite of the standard personal-finance
 * indicators, each scored independently then combined by weight. Components with no
 * data (e.g. no credit limit on file) are dropped and the remaining weights are
 * renormalized, so the score is never penalized for missing inputs.
 *
 * Pure + client-safe: takes plain numbers, returns plain data. No DB / no I/O.
 */

export interface HealthInputs {
    /** Average gross monthly income (trailing months). */
    monthlyIncome: number;
    /** Average monthly spending / outflows (trailing months). */
    monthlySpending: number;
    /** Liquid, emergency-eligible savings (cash + savings + money-market). */
    liquidSavings: number;
    /** Sum of required monthly debt payments (loan + card minimums). */
    monthlyDebtPayments: number;
    /** Total revolving card balance. */
    cardBalance: number;
    /** Total revolving credit limit across cards with a known limit (0 ⇒ unknown). */
    cardLimit: number;
    /** Total monthly budget across categories (0 ⇒ no budget set). */
    monthlyBudget: number;
    /** Spent against that budget so far this month. */
    monthlyBudgetSpent: number;
}

export type HealthStatus = "good" | "warning" | "error";

export interface HealthComponent {
    key: string;
    label: string;
    /** 0–100 sub-score. */
    score: number;
    /** Relative weight when present. */
    weight: number;
    /** Human-readable measured value, e.g. "18%" or "4.2 months". */
    value: string;
    /** One-line explanation of the target. */
    detail: string;
    status: HealthStatus;
}

export interface HealthResult {
    /** 0–100 overall score (renormalized over present components). */
    score: number;
    grade: "A" | "B" | "C" | "D" | "F";
    label: string;
    components: HealthComponent[];
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Linear ramp: `at0` → 0 pts, `at100` → 100 pts (handles either direction). */
function ramp(value: number, at0: number, at100: number): number {
    if (at100 === at0) return value >= at100 ? 100 : 0;
    return clamp(((value - at0) / (at100 - at0)) * 100);
}

function statusFromScore(score: number): HealthStatus {
    if (score >= 67) return "good";
    if (score >= 34) return "warning";
    return "error";
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function computeHealthScore(input: HealthInputs): HealthResult {
    const components: HealthComponent[] = [];

    // 1) Savings rate — (income − spending) / income. 20%+ is excellent. (weight 25)
    if (input.monthlyIncome > 0) {
        const rate = (input.monthlyIncome - input.monthlySpending) / input.monthlyIncome;
        const score = ramp(rate, 0, 0.2);
        components.push({
            key: "savings-rate",
            label: "Savings rate",
            score,
            weight: 25,
            value: pct(rate),
            detail: "Share of income you keep. Aim for 20%+.",
            status: statusFromScore(score),
        });
    }

    // 2) Emergency fund — liquid savings ÷ monthly spending. 6 months is the target. (weight 20)
    if (input.monthlySpending > 0) {
        const months = input.liquidSavings / input.monthlySpending;
        const score = ramp(months, 0, 6);
        components.push({
            key: "emergency-fund",
            label: "Emergency fund",
            score,
            weight: 20,
            value: `${months.toFixed(1)} mo`,
            detail: "Months of expenses in cash. Aim for 3–6 months.",
            status: statusFromScore(score),
        });
    }

    // 3) Debt-to-income — monthly debt payments ÷ gross income. 0% best, 43%+ is the
    //    conventional danger line. (weight 20)
    if (input.monthlyIncome > 0) {
        const dti = input.monthlyDebtPayments / input.monthlyIncome;
        const score = ramp(dti, 0.43, 0); // inverted: lower DTI scores higher
        components.push({
            key: "dti",
            label: "Debt-to-income",
            score,
            weight: 20,
            value: pct(dti),
            detail: "Required debt payments vs income. Keep under 36%.",
            status: statusFromScore(score),
        });
    }

    // 4) Credit utilization — card balance ÷ limit. ≤10% best, ≥50% poor. (weight 20)
    if (input.cardLimit > 0) {
        const util = input.cardBalance / input.cardLimit;
        const score = ramp(util, 0.5, 0.1); // inverted: lower utilization scores higher
        components.push({
            key: "utilization",
            label: "Credit utilization",
            score,
            weight: 20,
            value: pct(util),
            detail: "Card balances vs limits. Keep under 30% (ideally 10%).",
            status: statusFromScore(score),
        });
    }

    // 5) Budget adherence — spent ÷ budget this month. At/under budget is perfect. (weight 15)
    if (input.monthlyBudget > 0) {
        const ratio = input.monthlyBudgetSpent / input.monthlyBudget;
        const score = ratio <= 1 ? 100 : clamp(100 - (ratio - 1) * 200);
        components.push({
            key: "budget",
            label: "Budget adherence",
            score,
            weight: 15,
            value: pct(ratio),
            detail: "Spending vs your monthly budget. Stay at or below 100%.",
            status: statusFromScore(score),
        });
    }

    const totalWeight = components.reduce((s, c) => s + c.weight, 0);
    const score = totalWeight > 0 ? Math.round(components.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight) : 0;

    const grade: HealthResult["grade"] = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
    const label =
        score >= 90 ? "Excellent" : score >= 80 ? "Strong" : score >= 70 ? "Good" : score >= 60 ? "Fair" : score >= 40 ? "Needs work" : "At risk";

    return { score, grade, label, components };
}
