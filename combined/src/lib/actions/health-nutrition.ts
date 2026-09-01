"use server";

import { revalidatePath } from "next/cache";
import { MealType } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWeightSeries } from "@/lib/body-bridge";
import { ageFromBirthdate, estimateBodyFat, suggestActivityFromWorkouts } from "@/lib/nutrition-calc";
import { num, parseDateOnly, str, ymd } from "./health-shared";

function parseMealType(v: string | null): MealType {
    if (v === "BREAKFAST" || v === "LUNCH" || v === "DINNER" || v === "SNACK") return v;
    return MealType.SNACK;
}

async function getOrCreateDay(userId: string, date: Date) {
    return db.nutritionDay.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date },
        update: {},
    });
}

// ---- Food entries ----
export async function addFoodEntry(fd: FormData) {
    const user = await requireUser();
    const date = parseDateOnly(str(fd, "date"));
    const mealType = parseMealType(str(fd, "mealType"));
    const description = str(fd, "description");
    if (!description) throw new Error("Description is required");

    const day = await getOrCreateDay(user.id, date);
    let meal = await db.meal.findFirst({ where: { dayId: day.id, mealType } });
    if (!meal) meal = await db.meal.create({ data: { dayId: day.id, mealType } });

    await db.foodEntry.create({
        data: {
            mealId: meal.id,
            productId: str(fd, "productId") || null,
            description,
            servingSize: str(fd, "servingSize"),
            quantity: num(fd, "quantity"),
            unit: str(fd, "unit"),
            calories: num(fd, "calories"),
            proteinG: num(fd, "proteinG"),
            carbsG: num(fd, "carbsG"),
            fatG: num(fd, "fatG"),
            fiberG: num(fd, "fiberG"),
            sugarG: num(fd, "sugarG"),
            sodiumMg: num(fd, "sodiumMg"),
            cholesterolMg: num(fd, "cholesterolMg"),
            saturatedFatG: num(fd, "saturatedFatG"),
            transFatG: num(fd, "transFatG"),
            potassiumMg: num(fd, "potassiumMg"),
        },
    });
    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
    revalidatePath("/health");
}

export async function updateFoodEntry(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const entry = await db.foodEntry.findFirst({ where: { id, meal: { day: { userId: user.id } } } });
    if (!entry) throw new Error("Not found");
    const description = str(fd, "description");
    if (!description) throw new Error("Description is required");
    await db.foodEntry.update({
        where: { id },
        data: {
            description,
            servingSize: str(fd, "servingSize"),
            quantity: num(fd, "quantity"),
            unit: str(fd, "unit"),
            calories: num(fd, "calories"),
            proteinG: num(fd, "proteinG"),
            carbsG: num(fd, "carbsG"),
            fatG: num(fd, "fatG"),
            fiberG: num(fd, "fiberG"),
            sugarG: num(fd, "sugarG"),
            sodiumMg: num(fd, "sodiumMg"),
            cholesterolMg: num(fd, "cholesterolMg"),
            saturatedFatG: num(fd, "saturatedFatG"),
            transFatG: num(fd, "transFatG"),
            potassiumMg: num(fd, "potassiumMg"),
            manuallyAdjusted: true,
        },
    });
    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
}

export async function deleteFoodEntry(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const entry = await db.foodEntry.findFirst({ where: { id, meal: { day: { userId: user.id } } } });
    if (!entry) throw new Error("Not found");
    await db.foodEntry.delete({ where: { id } });
    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
    revalidatePath("/health");
}

export async function toggleFavoriteEntry(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const entry = await db.foodEntry.findFirst({ where: { id, meal: { day: { userId: user.id } } } });
    if (!entry) throw new Error("Not found");
    await db.foodEntry.update({ where: { id }, data: { isFavorite: !entry.isFavorite } });
    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
}

// ---- Water ----
export async function addWater(fd: FormData) {
    const user = await requireUser();
    const date = parseDateOnly(str(fd, "date"));
    const delta = num(fd, "amountMl") ?? 0;
    const existing = await db.waterLog.findUnique({ where: { userId_date: { userId: user.id, date } } });
    const next = Math.max(0, (existing?.amountMl ?? 0) + delta);
    await db.waterLog.upsert({
        where: { userId_date: { userId: user.id, date } },
        create: { userId: user.id, date, amountMl: Math.max(0, delta) },
        update: { amountMl: next },
    });
    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
    revalidatePath("/health");
}

export async function setWater(fd: FormData) {
    const user = await requireUser();
    const date = parseDateOnly(str(fd, "date"));
    const amountMl = Math.max(0, num(fd, "amountMl") ?? 0);
    await db.waterLog.upsert({
        where: { userId_date: { userId: user.id, date } },
        create: { userId: user.id, date, amountMl },
        update: { amountMl },
    });
    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
    revalidatePath("/health");
}

// ---- Goals ----
/**
 * Quick numeric overrides for the unified goals. Writes the SAME rows the
 * /health/goals calculator writes via `applyCalculatedGoals`: the singleton
 * NutritionGoal (calories/macros/fiber) and, when a `waterGoalMl` field is
 * posted, `UserProfile.waterGoalMl` — so the nutrition page and health goals
 * always read one source of truth.
 */
export async function saveNutritionGoal(fd: FormData) {
    const user = await requireUser();
    const data = {
        calories: num(fd, "calories"),
        proteinG: num(fd, "proteinG"),
        carbsG: num(fd, "carbsG"),
        fatG: num(fd, "fatG"),
        fiberG: num(fd, "fiberG"),
    };
    const waterGoalMl = num(fd, "waterGoalMl");
    await db.$transaction([
        db.nutritionGoal.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data }),
        ...(waterGoalMl != null
            ? [db.userProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, waterGoalMl }, update: { waterGoalMl } })]
            : []),
    ]);
    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
    revalidatePath("/health");
    revalidatePath("/health/goals");
}

// ---- Food products ----
export async function upsertFoodProduct(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    const data = {
        name,
        quantity: num(fd, "quantity"),
        unit: str(fd, "unit"),
        calories: num(fd, "calories"),
        proteinG: num(fd, "proteinG"),
        carbsG: num(fd, "carbsG"),
        fatG: num(fd, "fatG"),
        barcode: str(fd, "barcode"),
    };
    if (id) {
        const existing = await db.foodProduct.findFirst({ where: { id, userId: user.id } });
        if (!existing) throw new Error("Not found");
        await db.foodProduct.update({ where: { id }, data });
    } else {
        await db.foodProduct.create({ data: { userId: user.id, ...data } });
    }
    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
}

export async function deleteFoodProduct(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.foodProduct.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
}

// ---- Saved meals ----
export async function saveMealAsTemplate(fd: FormData) {
    const user = await requireUser();
    const date = parseDateOnly(str(fd, "date"));
    const mealType = parseMealType(str(fd, "mealType"));
    const name = str(fd, "name") ?? `${mealType} template`;

    const day = await db.nutritionDay.findUnique({ where: { userId_date: { userId: user.id, date } } });
    const meal = day ? await db.meal.findFirst({ where: { dayId: day.id, mealType }, include: { entries: true } }) : null;
    if (!meal || meal.entries.length === 0) throw new Error("No entries to save in this meal");

    await db.savedMeal.create({
        data: {
            userId: user.id,
            name,
            mealType,
            items: { create: meal.entries.map((e) => ({ description: e.description, calories: e.calories, proteinG: e.proteinG, carbsG: e.carbsG, fatG: e.fatG })) },
        },
    });
    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
}

export async function applySavedMeal(fd: FormData) {
    const user = await requireUser();
    const savedMealId = str(fd, "savedMealId");
    if (!savedMealId) throw new Error("Missing savedMealId");
    const saved = await db.savedMeal.findFirst({ where: { id: savedMealId, userId: user.id }, include: { items: true } });
    if (!saved) throw new Error("Not found");
    const date = parseDateOnly(str(fd, "date"));
    const mealType = parseMealType(str(fd, "mealType") ?? saved.mealType ?? "SNACK");

    const day = await getOrCreateDay(user.id, date);
    let meal = await db.meal.findFirst({ where: { dayId: day.id, mealType } });
    if (!meal) meal = await db.meal.create({ data: { dayId: day.id, mealType } });

    await db.foodEntry.createMany({
        data: saved.items.map((i) => ({ mealId: meal!.id, description: i.description, calories: i.calories, proteinG: i.proteinG, carbsG: i.carbsG, fatG: i.fatG })),
    });
    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
    revalidatePath("/health");
}

export async function deleteSavedMeal(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.savedMeal.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
}

// ---- Save a food entry to the food DB (FoodProduct) ----
/**
 * Create a reusable FoodProduct from an existing FoodEntry so the user can
 * quick-add it later. Used by the "Save to food DB" button on AI/regular entries.
 */
export async function saveEntryAsProduct(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const entry = await db.foodEntry.findFirst({ where: { id, meal: { day: { userId: user.id } } } });
    if (!entry) throw new Error("Not found");

    await db.foodProduct.create({
        data: {
            userId: user.id,
            name: entry.description,
            quantity: entry.quantity,
            unit: entry.unit,
            calories: entry.calories,
            proteinG: entry.proteinG,
            carbsG: entry.carbsG,
            fatG: entry.fatG,
        },
    });
    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
}

// ============================================================
// Calendar overlay helper — EXPORTED for other modules
// ============================================================
/**
 * TODO(calendar): the calendar module imports this to overlay nutrition on the
 * month grid. Returns one summary per day in [start, end) (inclusive of start,
 * exclusive of end) that has logged food, with totals. Dates are YYYY-MM-DD.
 *
 * Keep the return shape stable: { date, calories, protein, mealCount }.
 */
export type NutritionDaySummary = { date: string; calories: number; protein: number; mealCount: number };

export async function getNutritionDaySummaries(userId: string, start: Date, end: Date): Promise<NutritionDaySummary[]> {
    const days = await db.nutritionDay.findMany({
        where: { userId, date: { gte: start, lt: end } },
        include: { meals: { include: { entries: { select: { calories: true, proteinG: true } } } } },
        orderBy: { date: "asc" },
    });

    return days.map((d) => {
        let calories = 0;
        let protein = 0;
        let mealCount = 0;
        for (const meal of d.meals) {
            if (meal.entries.length > 0) mealCount++;
            for (const e of meal.entries) {
                calories += e.calories ?? 0;
                protein += e.proteinG ?? 0;
            }
        }
        return { date: ymd(d.date), calories: Math.round(calories), protein: Math.round(protein), mealCount };
    });
}

// ============================================================
// Unified goals calculator: inputs + apply
// ============================================================

export interface GoalCalcData {
    gender: string | null;
    age: number | null;
    heightCm: number | null;
    /** Latest known bodyweight (kg) from the unified weight series. */
    currentWeightKg: number | null;
    /** Latest body-fat estimate, or null if not computable. */
    currentBodyFatPct: number | null;
    bodyFatMethod: "navy" | "bmi" | null;
    bodyFatRough: boolean;
    /** Most recent girths (cm) used for the Navy estimate, when present. */
    neckCm: number | null;
    waistCm: number | null;
    hipCm: number | null;
    activityLevel: string | null;
    dietGoal: string | null;
    targetWeeklyChangeKg: number | null;
    goalWeightKg: number | null;
    goalBodyFatPct: number | null;
    goalTargetDate: string | null;
    waterGoalMl: number | null;
    /** Average workouts/week over the last 4 weeks (rounded to 1 dp). */
    avgWorkoutsPerWeek: number;
    /** Activity level suggested from the workout average. */
    suggestedActivity: string;
    /** Existing nutrition goal values, if any. */
    goal: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null; fiberG: number | null };
}

/** Gather every input the unified goals calculator needs (server-side). */
export async function getGoalCalcData(): Promise<GoalCalcData> {
    const user = await requireUser();

    const now = new Date();
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

    const [profile, latestMeasurement, weightSeries, workoutCount, goal] = await Promise.all([
        db.userProfile.findUnique({ where: { userId: user.id } }),
        db.bodyMeasurement.findFirst({
            where: { userId: user.id, OR: [{ neckCm: { not: null } }, { waistCm: { not: null } }, { hipCm: { not: null } }] },
            orderBy: { date: "desc" },
        }),
        getWeightSeries(user.id),
        db.workout.count({ where: { userId: user.id, deletedAt: null, date: { gte: fourWeeksAgo, lt: now } } }),
        db.nutritionGoal.findUnique({ where: { userId: user.id } }),
    ]);

    const currentWeightKg = weightSeries.length ? weightSeries[weightSeries.length - 1].kg : null;
    const age = ageFromBirthdate(profile?.birthdate ?? null, now);

    const bf = estimateBodyFat({
        gender: profile?.gender ?? null,
        heightCm: profile?.heightCm ?? null,
        weightKg: currentWeightKg,
        age,
        neckCm: latestMeasurement?.neckCm ?? null,
        waistCm: latestMeasurement?.waistCm ?? null,
        hipCm: latestMeasurement?.hipCm ?? null,
    });

    const avgWorkoutsPerWeek = Math.round((workoutCount / 4) * 10) / 10;

    return {
        gender: profile?.gender ?? null,
        age,
        heightCm: profile?.heightCm ?? null,
        currentWeightKg,
        currentBodyFatPct: bf?.pct ?? null,
        bodyFatMethod: bf?.method ?? null,
        bodyFatRough: bf?.rough ?? false,
        neckCm: latestMeasurement?.neckCm ?? null,
        waistCm: latestMeasurement?.waistCm ?? null,
        hipCm: latestMeasurement?.hipCm ?? null,
        activityLevel: profile?.activityLevel ?? null,
        dietGoal: profile?.dietGoal ?? null,
        targetWeeklyChangeKg: profile?.targetWeeklyChangeKg ?? null,
        goalWeightKg: profile?.goalWeightKg ?? null,
        goalBodyFatPct: profile?.goalBodyFatPct ?? null,
        goalTargetDate: profile?.goalTargetDate?.toISOString() ?? null,
        waterGoalMl: profile?.waterGoalMl ?? null,
        avgWorkoutsPerWeek,
        suggestedActivity: suggestActivityFromWorkouts(avgWorkoutsPerWeek),
        goal: { calories: goal?.calories ?? null, proteinG: goal?.proteinG ?? null, carbsG: goal?.carbsG ?? null, fatG: goal?.fatG ?? null, fiberG: goal?.fiberG ?? null },
    };
}

/**
 * Apply the calculator output: writes NutritionGoal (calories/macros/fiber),
 * Settings.unitSystem and the UserProfile goal fields (activity, diet,
 * weekly-change, goal weight/BF/date, water goal) in one transaction.
 *
 * The client computes the plan with lib/nutrition-calc and submits the final
 * (possibly user-tweaked) metric values; we trust + persist them here.
 */
export async function applyCalculatedGoals(fd: FormData) {
    const user = await requireUser();

    const unitSystem = str(fd, "unitSystem") === "METRIC" ? "METRIC" : "IMPERIAL";

    const nutritionGoal = {
        calories: num(fd, "calories"),
        proteinG: num(fd, "proteinG"),
        carbsG: num(fd, "carbsG"),
        fatG: num(fd, "fatG"),
        fiberG: num(fd, "fiberG"),
    };

    const profileData = {
        activityLevel: str(fd, "activityLevel"),
        dietGoal: str(fd, "dietGoal"),
        targetWeeklyChangeKg: num(fd, "targetWeeklyChangeKg"),
        goalWeightKg: num(fd, "goalWeightKg"),
        goalBodyFatPct: num(fd, "goalBodyFatPct"),
        goalTargetDate: (() => {
            const v = str(fd, "goalTargetDate");
            if (!v) return null;
            const d = new Date(v);
            return Number.isNaN(d.getTime()) ? null : d;
        })(),
        waterGoalMl: num(fd, "waterGoalMl"),
    };

    await db.$transaction([
        db.nutritionGoal.upsert({ where: { userId: user.id }, create: { userId: user.id, ...nutritionGoal }, update: nutritionGoal }),
        db.settings.upsert({ where: { userId: user.id }, create: { userId: user.id, unitSystem }, update: { unitSystem } }),
        db.userProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, ...profileData }, update: profileData }),
    ]);

    revalidatePath("/nutrition");
    revalidatePath("/health/goals");
    revalidatePath("/health");
    revalidatePath("/health/nutrition");
    revalidatePath("/settings");
    revalidatePath("/settings/goals");
}
