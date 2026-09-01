// @ts-nocheck
/**
 * Paycheck / take-home estimator (US, tax year 2025). Pure + client-safe.
 *
 * This is an estimate for planning, not tax advice: it models federal income tax
 * (progressive brackets on taxable income after the standard deduction + pre-tax
 * deductions), FICA (Social Security + Medicare incl. the additional Medicare tax),
 * and an optional flat state rate. It does not model itemized deductions, credits,
 * local taxes, or supplemental withholding rules.
 */

export type FilingStatus = "single" | "married" | "head";
export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly" | "annual";

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
    weekly: 52,
    biweekly: 26,
    semimonthly: 24,
    monthly: 12,
    annual: 1,
};

export const FILING_LABELS: Record<FilingStatus, string> = {
    single: "Single",
    married: "Married filing jointly",
    head: "Head of household",
};

export const FREQUENCY_LABELS: Record<PayFrequency, string> = {
    weekly: "Weekly",
    biweekly: "Every 2 weeks",
    semimonthly: "Twice a month",
    monthly: "Monthly",
    annual: "Annual",
};

/** A progressive bracket: marginal `rate` applies to income above `from`. */
interface Bracket {
    from: number;
    rate: number;
}

// 2025 federal brackets.
const BRACKETS_2025: Record<FilingStatus, Bracket[]> = {
    single: [
        { from: 0, rate: 0.1 },
        { from: 11925, rate: 0.12 },
        { from: 48475, rate: 0.22 },
        { from: 103350, rate: 0.24 },
        { from: 197300, rate: 0.32 },
        { from: 250525, rate: 0.35 },
        { from: 626350, rate: 0.37 },
    ],
    married: [
        { from: 0, rate: 0.1 },
        { from: 23850, rate: 0.12 },
        { from: 96950, rate: 0.22 },
        { from: 206700, rate: 0.24 },
        { from: 394600, rate: 0.32 },
        { from: 501050, rate: 0.35 },
        { from: 751600, rate: 0.37 },
    ],
    head: [
        { from: 0, rate: 0.1 },
        { from: 17000, rate: 0.12 },
        { from: 64850, rate: 0.22 },
        { from: 103350, rate: 0.24 },
        { from: 197300, rate: 0.32 },
        { from: 250500, rate: 0.35 },
        { from: 626350, rate: 0.37 },
    ],
};

const STANDARD_DEDUCTION_2025: Record<FilingStatus, number> = {
    single: 15000,
    married: 30000,
    head: 22500,
};

// FICA constants (2025).
const SS_WAGE_BASE = 176100;
const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;
const ADDL_MEDICARE_RATE = 0.009;
const ADDL_MEDICARE_THRESHOLD: Record<FilingStatus, number> = {
    single: 200000,
    married: 250000,
    head: 200000,
};

/** Progressive tax on `taxable` using the given brackets. */
function progressiveTax(taxable: number, brackets: Bracket[]): number {
    if (taxable <= 0) return 0;
    let tax = 0;
    for (let i = 0; i < brackets.length; i++) {
        const from = brackets[i].from;
        if (taxable <= from) break;
        const to = i + 1 < brackets.length ? brackets[i + 1].from : Infinity;
        const span = Math.min(taxable, to) - from;
        tax += span * brackets[i].rate;
    }
    return tax;
}

export interface PaycheckInputs {
    /** Gross annual salary, before any deductions. */
    grossAnnual: number;
    filingStatus: FilingStatus;
    frequency: PayFrequency;
    /** Annual pre-tax retirement contribution (401k/403b) — reduces federal taxable, not FICA. */
    pretaxRetirement: number;
    /** Annual pre-tax health/HSA premiums (cafeteria) — reduces federal taxable AND FICA wages. */
    pretaxHealth: number;
    /** Flat state income-tax rate as a percentage, e.g. 5 for 5%. */
    statePercent: number;
}

export interface PaycheckResult {
    grossAnnual: number;
    federalTax: number;
    socialSecurity: number;
    medicare: number;
    stateTax: number;
    pretaxTotal: number;
    takeHomeAnnual: number;
    /** Per-pay-period take-home for the chosen frequency. */
    takeHomePerPeriod: number;
    /** Total tax / gross. */
    effectiveRate: number;
    /** Breakdown rows for charting. */
    breakdown: { key: string; label: string; amount: number }[];
}

export function computePaycheck(input: PaycheckInputs): PaycheckResult {
    const gross = Math.max(0, input.grossAnnual);
    const retirement = Math.max(0, Math.min(input.pretaxRetirement, gross));
    const health = Math.max(0, Math.min(input.pretaxHealth, gross));
    const pretaxTotal = Math.min(gross, retirement + health);

    // Federal income tax — taxable income after pre-tax deductions and standard deduction.
    const federalTaxable = Math.max(0, gross - retirement - health - STANDARD_DEDUCTION_2025[input.filingStatus]);
    const federalTax = progressiveTax(federalTaxable, BRACKETS_2025[input.filingStatus]);

    // FICA — Social Security is capped at the wage base; health premiums reduce FICA wages
    // but 401(k) does not.
    const ficaWages = Math.max(0, gross - health);
    const socialSecurity = Math.min(ficaWages, SS_WAGE_BASE) * SS_RATE;
    const addlThreshold = ADDL_MEDICARE_THRESHOLD[input.filingStatus];
    const medicare = ficaWages * MEDICARE_RATE + Math.max(0, ficaWages - addlThreshold) * ADDL_MEDICARE_RATE;

    // State — flat rate on income after pre-tax deductions (simplified).
    const stateTax = Math.max(0, gross - retirement - health) * (Math.max(0, input.statePercent) / 100);

    const totalTax = federalTax + socialSecurity + medicare + stateTax;
    const takeHomeAnnual = Math.max(0, gross - pretaxTotal - totalTax);
    const periods = PERIODS_PER_YEAR[input.frequency];

    return {
        grossAnnual: gross,
        federalTax,
        socialSecurity,
        medicare,
        stateTax,
        pretaxTotal,
        takeHomeAnnual,
        takeHomePerPeriod: takeHomeAnnual / periods,
        effectiveRate: gross > 0 ? totalTax / gross : 0,
        breakdown: [
            { key: "take-home", label: "Take-home", amount: takeHomeAnnual },
            { key: "federal", label: "Federal tax", amount: federalTax },
            { key: "ss", label: "Social Security", amount: socialSecurity },
            { key: "medicare", label: "Medicare", amount: medicare },
            { key: "state", label: "State tax", amount: stateTax },
            { key: "pretax", label: "Pre-tax (401k/health)", amount: pretaxTotal },
        ].filter((r) => r.amount > 0),
    };
}
