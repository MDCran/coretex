/**
 * Pure grade / GPA math shared by server actions and client "what-if" UIs.
 * No imports — safe in both environments.
 */

export interface GradeWeight {
    name: string;
    weight: number; // percent contribution; bucket weights should sum to ~100
}

export interface GradeItem {
    category: string | null;
    earned: number | null;
    possible: number | null;
    extraCredit?: boolean;
}

export interface CategoryResult {
    name: string;
    weight: number;
    /** 0-100 percent for this category, or null when no graded items yet. */
    percent: number | null;
    earned: number;
    possible: number;
}

export interface GradeResult {
    /** Weighted running percent over categories that have graded items, 0-100. */
    percent: number | null;
    letter: string | null;
    gpa: number | null;
    categories: CategoryResult[];
    /** Sum of weights for categories that currently have data. */
    gradedWeight: number;
}

/** Standard +/- letter scale on a 0-100 percentage. */
export function letterGrade(percent: number): string {
    if (percent >= 93) return "A";
    if (percent >= 90) return "A-";
    if (percent >= 87) return "B+";
    if (percent >= 83) return "B";
    if (percent >= 80) return "B-";
    if (percent >= 77) return "C+";
    if (percent >= 73) return "C";
    if (percent >= 70) return "C-";
    if (percent >= 67) return "D+";
    if (percent >= 63) return "D";
    if (percent >= 60) return "D-";
    return "F";
}

/** 4.0-scale GPA points for a letter grade. */
export function gpaPoints(letter: string): number {
    const map: Record<string, number> = {
        A: 4.0,
        "A-": 3.7,
        "B+": 3.3,
        B: 3.0,
        "B-": 2.7,
        "C+": 2.3,
        C: 2.0,
        "C-": 1.7,
        "D+": 1.3,
        D: 1.0,
        "D-": 0.7,
        F: 0.0,
    };
    return map[letter] ?? 0;
}

/** Combine assignment + test items into per-category percentages. */
export function categoryResults(weights: GradeWeight[], items: GradeItem[]): CategoryResult[] {
    return weights.map((w) => {
        const bucket = items.filter((it) => (it.category ?? "").toLowerCase() === w.name.toLowerCase());
        let earned = 0;
        let possible = 0;
        for (const it of bucket) {
            if (it.earned == null || it.possible == null || it.possible <= 0) continue;
            earned += it.earned;
            // Extra-credit items add to the numerator but not the denominator.
            if (!it.extraCredit) possible += it.possible;
        }
        const percent = possible > 0 ? (earned / possible) * 100 : null;
        return { name: w.name, weight: w.weight, percent, earned, possible };
    });
}

/** Weighted running grade, renormalized over categories that have data. */
export function runningGrade(weights: GradeWeight[], items: GradeItem[]): GradeResult {
    const categories = categoryResults(weights, items);
    const withData = categories.filter((c) => c.percent != null);
    const gradedWeight = withData.reduce((s, c) => s + c.weight, 0);

    if (gradedWeight <= 0) {
        return { percent: null, letter: null, gpa: null, categories, gradedWeight: 0 };
    }
    const weighted = withData.reduce((s, c) => s + (c.percent as number) * c.weight, 0) / gradedWeight;
    const percent = Math.round(weighted * 100) / 100;
    const letter = letterGrade(percent);
    return { percent, letter, gpa: gpaPoints(letter), categories, gradedWeight };
}

/**
 * "What do I need on <targetCategory> to finish the class at <targetPercent>?"
 * Assumes all other categories keep their current average and the target
 * category will be fully completed (its full weight counts).
 */
export function whatIfNeeded(
    weights: GradeWeight[],
    items: GradeItem[],
    targetCategory: string,
    targetPercent: number,
): number | null {
    const cats = categoryResults(weights, items);
    const target = cats.find((c) => c.name.toLowerCase() === targetCategory.toLowerCase());
    if (!target || target.weight <= 0) return null;

    const totalWeight = weights.reduce((s, w) => s + w.weight, 0);
    if (totalWeight <= 0) return null;

    // Contribution from every *other* category at its current average.
    let othersContribution = 0;
    for (const c of cats) {
        if (c.name.toLowerCase() === targetCategory.toLowerCase()) continue;
        if (c.percent != null) othersContribution += (c.percent * c.weight) / totalWeight;
    }
    // targetPercent = othersContribution + needed * (weight/total)  →  solve needed.
    const needed = ((targetPercent - othersContribution) * totalWeight) / target.weight;
    return Math.round(needed * 10) / 10;
}

export interface GpaClass {
    creditHours: number | null;
    finalGrade: number | null; // locked final percent
    runningPercent: number | null; // live computed percent
}

/** Cumulative GPA across classes, credit-weighted. Uses finalGrade if set, else running. */
export function cumulativeGpa(classes: GpaClass[]): number | null {
    let points = 0;
    let credits = 0;
    for (const c of classes) {
        const pct = c.finalGrade ?? c.runningPercent;
        if (pct == null) continue;
        const ch = c.creditHours ?? 1;
        points += gpaPoints(letterGrade(pct)) * ch;
        credits += ch;
    }
    if (credits <= 0) return null;
    return Math.round((points / credits) * 100) / 100;
}

export const DEFAULT_WEIGHTS: GradeWeight[] = [
    { name: "Assignments", weight: 40 },
    { name: "Midterm", weight: 25 },
    { name: "Final", weight: 35 },
];
