/**
 * Nutrition & body-goal math — PURE functions, no DB, no React.
 *
 * Everything here works in METRIC (kg, cm) and returns metric values. The UI
 * layer converts to the user's display unit with lib/units. Keeping this pure
 * means it can be unit-tested and reused on both server and client.
 *
 * Formulas used:
 *  - Age: floor of (now − birthdate) in years.
 *  - BMR: Mifflin–St Jeor.
 *      men:   10·kg + 6.25·cm − 5·age + 5
 *      women: 10·kg + 6.25·cm − 5·age − 161
 *      (unknown gender → average of the two constants, −78.)
 *  - TDEE: BMR × activity multiplier.
 *  - Calorie target: TDEE ± (|targetWeeklyChangeKg|·7700 ÷ 7) by diet goal.
 *      7700 kcal ≈ energy in 1 kg of body mass.
 *  - Protein: g/kg of CURRENT bodyweight, by goal (cut 2.2 / recomp 2.0 /
 *      maintain 1.8 / bulk 1.6).
 *  - Water: ~35 ml per kg of bodyweight.
 *  - Body fat: U.S. Navy tape method when girths exist, else BMI-based (rough).
 */

export type Gender = "male" | "female" | "other" | string | null | undefined;
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "athlete" | string | null | undefined;
export type DietGoal = "lose" | "maintain" | "gain" | "recomp" | string | null | undefined;

/** Activity multipliers applied to BMR to get TDEE. */
export const ACTIVITY_MULTIPLIERS: Record<string, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    athlete: 1.9,
};

/** Human labels for the activity levels (shared by UI + suggestions). */
export const ACTIVITY_LABELS: Record<string, string> = {
    sedentary: "Sedentary",
    light: "Lightly active",
    moderate: "Moderately active",
    active: "Very active",
    athlete: "Athlete",
};

/** Energy in ~1 kg of body mass (used for weekly change → daily calorie adjustment). */
export const KCAL_PER_KG = 7700;
/** Imperial equivalent: ~7700 kcal per 2.20462 lb. */
export const KCAL_PER_LB = 3500;

/** Daily kcal deficit/surplus from a weekly mass-change rate in the user's display unit. */
export function dailyCalorieDeltaFromWeeklyChange(weeklyChangeMass: number, unit: "kg" | "lb"): number {
    if (!Number.isFinite(weeklyChangeMass) || weeklyChangeMass <= 0) return 0;
    const kg = unit === "lb" ? weeklyChangeMass / 2.2046226218 : weeklyChangeMass;
    return (kg * KCAL_PER_KG) / 7;
}

/** Hint copy for the weekly-change field, unit-aware. */
export function weeklyChangeCalorieHint(unit: "kg" | "lb"): string {
    if (unit === "lb") {
        return `About ${KCAL_PER_LB.toLocaleString()} kcal per lb of body mass ÷ 7 days adjusts your daily target.`;
    }
    return `About ${KCAL_PER_KG.toLocaleString()} kcal per kg of body mass ÷ 7 days adjusts your daily target.`;
}

// ── Age ───────────────────────────────────────────────────────────────────────
/** Whole years between birthdate and `now` (defaults to today). null if unknown. */
export function ageFromBirthdate(birthdate: Date | string | null | undefined, now: Date = new Date()): number | null {
    if (!birthdate) return null;
    const b = typeof birthdate === "string" ? new Date(birthdate) : birthdate;
    if (Number.isNaN(b.getTime())) return null;
    let age = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
    return age >= 0 && age < 130 ? age : null;
}

// ── BMR / TDEE ─────────────────────────────────────────────────────────────────
/** Mifflin–St Jeor BMR (kcal/day). Returns null if required inputs are missing. */
export function bmrMifflinStJeor(input: { weightKg: number | null; heightCm: number | null; age: number | null; gender: Gender }): number | null {
    const { weightKg, heightCm, age, gender } = input;
    if (weightKg == null || heightCm == null || age == null) return null;
    if (weightKg <= 0 || heightCm <= 0) return null;
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    const g = (gender ?? "").toLowerCase();
    const constant = g === "male" || g === "m" ? 5 : g === "female" || g === "f" ? -161 : -78;
    return Math.round(base + constant);
}

/** Normalize an arbitrary activity value to a known key (defaults to moderate). */
export function normalizeActivity(level: ActivityLevel): keyof typeof ACTIVITY_MULTIPLIERS {
    const k = (level ?? "").toLowerCase();
    if (k in ACTIVITY_MULTIPLIERS) return k as keyof typeof ACTIVITY_MULTIPLIERS;
    // a couple of friendly aliases
    if (k === "very" || k === "very active") return "active";
    if (k === "lightly active") return "light";
    return "moderate";
}

/** TDEE = BMR × activity multiplier. null if bmr is null. */
export function tdee(bmr: number | null, level: ActivityLevel): number | null {
    if (bmr == null) return null;
    return Math.round(bmr * ACTIVITY_MULTIPLIERS[normalizeActivity(level)]);
}

// ── Workout-based activity suggestion ──────────────────────────────────────────
/**
 * Map an average workouts/week count to a suggested activity level.
 *   0      → sedentary
 *   1–2    → light
 *   3–4    → moderate
 *   5–6    → active
 *   7+     → athlete
 */
export function suggestActivityFromWorkouts(avgPerWeek: number): keyof typeof ACTIVITY_MULTIPLIERS {
    if (avgPerWeek < 1) return "sedentary";
    if (avgPerWeek < 3) return "light";
    if (avgPerWeek < 5) return "moderate";
    if (avgPerWeek < 7) return "active";
    return "athlete";
}

// ── Calorie target by diet goal ─────────────────────────────────────────────────
/**
 * Daily calorie target from TDEE + diet goal + weekly change rate.
 * `targetWeeklyChangeKg` is the magnitude of intended weekly weight change (kg);
 * direction comes from dietGoal. maintain/recomp ⇒ eat at TDEE.
 */
export function calorieTarget(tdeeKcal: number | null, dietGoal: DietGoal, targetWeeklyChangeKg: number | null): number | null {
    if (tdeeKcal == null) return null;
    const goal = (dietGoal ?? "maintain").toLowerCase();
    const rate = Math.abs(targetWeeklyChangeKg ?? 0);
    const dailyDelta = (rate * KCAL_PER_KG) / 7;
    if (goal === "lose" || goal === "cut") return Math.round(tdeeKcal - dailyDelta);
    if (goal === "gain" || goal === "bulk") return Math.round(tdeeKcal + dailyDelta);
    return Math.round(tdeeKcal); // maintain / recomp
}

// ── Protein target ──────────────────────────────────────────────────────────────
/** Protein g/kg of bodyweight by diet goal. */
export function proteinPerKg(dietGoal: DietGoal): number {
    const goal = (dietGoal ?? "maintain").toLowerCase();
    if (goal === "lose" || goal === "cut") return 2.2;
    if (goal === "recomp") return 2.0;
    if (goal === "gain" || goal === "bulk") return 1.6;
    return 1.8; // maintain
}

/** Protein target (g/day). null if weight unknown. */
export function proteinTarget(weightKg: number | null, dietGoal: DietGoal): number | null {
    if (weightKg == null || weightKg <= 0) return null;
    return Math.round(weightKg * proteinPerKg(dietGoal));
}

// ── Water target ────────────────────────────────────────────────────────────────
/** Suggested daily water (ml) ≈ 35 ml/kg. null if weight unknown. */
export function waterTargetMl(weightKg: number | null): number | null {
    if (weightKg == null || weightKg <= 0) return null;
    return Math.round((weightKg * 35) / 50) * 50; // round to nearest 50 ml
}

// ── Macro split ─────────────────────────────────────────────────────────────────
export interface MacroGrams {
    proteinG: number;
    carbsG: number;
    fatG: number;
}
/**
 * Split a calorie target into macro grams. Protein grams are fixed (from
 * proteinTarget); the remaining calories are divided between carbs and fat by
 * `fatPctOfRemaining` (0–1, default 0.35). Protein/carbs = 4 kcal/g, fat = 9.
 */
export function macroSplit(calories: number | null, proteinG: number | null, fatPctOfRemaining = 0.35): MacroGrams | null {
    if (calories == null || calories <= 0) return null;
    const protein = proteinG ?? 0;
    const proteinKcal = protein * 4;
    const remaining = Math.max(0, calories - proteinKcal);
    const fatKcal = remaining * fatPctOfRemaining;
    const carbKcal = remaining - fatKcal;
    return {
        proteinG: Math.round(protein),
        carbsG: Math.round(carbKcal / 4),
        fatG: Math.round(fatKcal / 9),
    };
}

// ── Body fat ────────────────────────────────────────────────────────────────────
export interface BodyFatResult {
    pct: number;
    method: "navy" | "bmi";
    /** True for the BMI fallback, which is a rough estimate. */
    rough: boolean;
}

/**
 * U.S. Navy body-fat % from tape measurements (cm) + height (cm).
 *   men:   495 / (1.0324 − 0.19077·log10(waist−neck) + 0.15456·log10(height)) − 450
 *   women: 495 / (1.29579 − 0.35004·log10(waist+hip−neck) + 0.22100·log10(height)) − 450
 * Returns null if the inputs needed for the gender aren't present/valid.
 */
export function navyBodyFat(input: { gender: Gender; heightCm: number | null; neckCm: number | null; waistCm: number | null; hipCm: number | null }): number | null {
    const { heightCm, neckCm, waistCm, hipCm } = input;
    if (heightCm == null || neckCm == null || waistCm == null) return null;
    const g = (input.gender ?? "").toLowerCase();
    const isFemale = g === "female" || g === "f";
    const log10 = Math.log10;
    let pct: number;
    if (isFemale) {
        if (hipCm == null) return null;
        const inner = waistCm + hipCm - neckCm;
        if (inner <= 0) return null;
        pct = 495 / (1.29579 - 0.35004 * log10(inner) + 0.221 * log10(heightCm)) - 450;
    } else {
        const inner = waistCm - neckCm;
        if (inner <= 0) return null;
        pct = 495 / (1.0324 - 0.19077 * log10(inner) + 0.15456 * log10(heightCm)) - 450;
    }
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 75) return null;
    return Math.round(pct * 10) / 10;
}

/** Rough BMI-based body-fat estimate (Deurenberg). Labeled rough in the UI. */
export function bmiBodyFat(input: { weightKg: number | null; heightCm: number | null; age: number | null; gender: Gender }): number | null {
    const { weightKg, heightCm, age } = input;
    if (weightKg == null || heightCm == null || age == null || heightCm <= 0) return null;
    const bmi = weightKg / (heightCm / 100) ** 2;
    const g = (input.gender ?? "").toLowerCase();
    const sex = g === "male" || g === "m" ? 1 : 0; // female/other → 0
    const pct = 1.2 * bmi + 0.23 * age - 10.8 * sex - 5.4;
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 75) return null;
    return Math.round(pct * 10) / 10;
}

/** Best available body-fat estimate: Navy if girths present, else BMI (rough). */
export function estimateBodyFat(input: {
    gender: Gender;
    heightCm: number | null;
    weightKg: number | null;
    age: number | null;
    neckCm: number | null;
    waistCm: number | null;
    hipCm: number | null;
}): BodyFatResult | null {
    const navy = navyBodyFat(input);
    if (navy != null) return { pct: navy, method: "navy", rough: false };
    const bmi = bmiBodyFat(input);
    if (bmi != null) return { pct: bmi, method: "bmi", rough: true };
    return null;
}

// ── Bidirectional weight ↔ body-fat target calc ─────────────────────────────────
/** Lean body mass (kg) from weight and body-fat fraction. null if unknown. */
export function leanMassKg(weightKg: number | null, bodyFatPct: number | null): number | null {
    if (weightKg == null || bodyFatPct == null) return null;
    if (weightKg <= 0 || bodyFatPct < 0 || bodyFatPct >= 100) return null;
    return weightKg * (1 - bodyFatPct / 100);
}

/**
 * Given current weight + current BF% and a TARGET weight, the implied target
 * BF% assuming lean mass stays constant:  targetBF = 1 − leanMass / targetWeight.
 */
export function targetBodyFatFromWeight(currentWeightKg: number | null, currentBodyFatPct: number | null, targetWeightKg: number | null): number | null {
    const lean = leanMassKg(currentWeightKg, currentBodyFatPct);
    if (lean == null || targetWeightKg == null || targetWeightKg <= 0) return null;
    const pct = (1 - lean / targetWeightKg) * 100;
    if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return null;
    return Math.round(pct * 10) / 10;
}

/**
 * Given current weight + current BF% and a TARGET BF%, the implied target
 * weight assuming lean mass stays constant:  targetWeight = leanMass / (1 − targetBF).
 */
export function targetWeightFromBodyFat(currentWeightKg: number | null, currentBodyFatPct: number | null, targetBodyFatPct: number | null): number | null {
    const lean = leanMassKg(currentWeightKg, currentBodyFatPct);
    if (lean == null || targetBodyFatPct == null || targetBodyFatPct < 0 || targetBodyFatPct >= 100) return null;
    const w = lean / (1 - targetBodyFatPct / 100);
    if (!Number.isFinite(w) || w <= 0) return null;
    return Math.round(w * 10) / 10;
}

// ── Full plan (one call to drive the calculator) ────────────────────────────────
export interface GoalPlanInput {
    gender: Gender;
    age: number | null;
    heightCm: number | null;
    weightKg: number | null;
    activityLevel: ActivityLevel;
    dietGoal: DietGoal;
    targetWeeklyChangeKg: number | null;
    /** When set, overrides protein-based macro split fat fraction (0–1). */
    fatPctOfRemaining?: number;
}

export interface GoalPlan {
    age: number | null;
    bmr: number | null;
    tdee: number | null;
    activityKey: string;
    activityMultiplier: number;
    calories: number | null;
    proteinG: number | null;
    proteinPerKg: number;
    waterMl: number | null;
    macros: MacroGrams | null;
}

/** Compute the full goal plan from profile-shaped inputs. All values metric. */
export function computeGoalPlan(input: GoalPlanInput): GoalPlan {
    const activityKey = normalizeActivity(input.activityLevel);
    const bmr = bmrMifflinStJeor({ weightKg: input.weightKg, heightCm: input.heightCm, age: input.age, gender: input.gender });
    const tdeeKcal = tdee(bmr, activityKey);
    const calories = calorieTarget(tdeeKcal, input.dietGoal, input.targetWeeklyChangeKg);
    const protein = proteinTarget(input.weightKg, input.dietGoal);
    const macros = macroSplit(calories, protein, input.fatPctOfRemaining ?? 0.35);
    return {
        age: input.age,
        bmr,
        tdee: tdeeKcal,
        activityKey,
        activityMultiplier: ACTIVITY_MULTIPLIERS[activityKey],
        calories,
        proteinG: protein,
        proteinPerKg: proteinPerKg(input.dietGoal),
        waterMl: waterTargetMl(input.weightKg),
        macros,
    };
}
