import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { prisma } from "../db/prisma.js";
import { resolveAssetUrl } from "./assets.js";
import { ollamaJson } from "./financial.js";

interface MacroTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

const EMPTY_MACROS: MacroTotals = {
  calories: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
};

function utcToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
}

function utcDay(value?: unknown): Date {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().startsWith(value)
    )
      return parsed;
  }
  return utcToday();
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDay(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function round(value: number, precision = 1): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function summarizeEntries(
  entries: Array<{
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG?: number | null;
  }>,
): MacroTotals {
  const totals = entries.reduce<MacroTotals>(
    (sum, entry) => ({
      calories: sum.calories + (entry.calories ?? 0),
      proteinG: sum.proteinG + (entry.proteinG ?? 0),
      carbsG: sum.carbsG + (entry.carbsG ?? 0),
      fatG: sum.fatG + (entry.fatG ?? 0),
      fiberG: sum.fiberG + (entry.fiberG ?? 0),
    }),
    { ...EMPTY_MACROS },
  );
  return {
    calories: round(totals.calories, 0),
    proteinG: round(totals.proteinG),
    carbsG: round(totals.carbsG),
    fatG: round(totals.fatG),
    fiberG: round(totals.fiberG),
  };
}

function progress(value: number, goal: number | null): number | null {
  return goal != null && goal > 0 ? round((value / goal) * 100, 0) : null;
}

export async function getOverview(
  userId: string,
  payload?: Record<string, unknown>,
) {
  const date = utcDay(payload?.date);
  const today = utcToday();
  const monthStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
  );
  const monthEnd = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  );

  const [
    day,
    water,
    goal,
    profile,
    products,
    savedMeals,
    favorites,
    settings,
    monthDays,
    currentMeasurement,
  ] = await Promise.all([
    prisma.nutritionDay.findUnique({
      where: { userId_date: { userId, date } },
      select: {
        id: true,
        notes: true,
        meals: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            mealType: true,
            name: true,
            loggedAt: true,
            entries: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                productId: true,
                description: true,
                source: true,
                servingSize: true,
                quantity: true,
                unit: true,
                calories: true,
                proteinG: true,
                carbsG: true,
                fatG: true,
                fiberG: true,
                sugarG: true,
                sodiumMg: true,
                cholesterolMg: true,
                saturatedFatG: true,
                transFatG: true,
                potassiumMg: true,
                confidence: true,
                isFavorite: true,
                imageKey: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    }),
    prisma.waterLog.findUnique({
      where: { userId_date: { userId, date } },
      select: { amountMl: true, updatedAt: true },
    }),
    prisma.nutritionGoal.findUnique({
      where: { userId },
      select: {
        calories: true,
        proteinG: true,
        carbsG: true,
        fatG: true,
        fiberG: true,
        updatedAt: true,
      },
    }),
    prisma.userProfile.findUnique({
      where: { userId },
      select: {
        waterGoalMl: true,
        gender: true,
        birthdate: true,
        heightCm: true,
        activityLevel: true,
        dietGoal: true,
        goalWeightKg: true,
        targetWeeklyChangeKg: true,
      },
    }),
    prisma.foodProduct.findMany({
      where: { userId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        quantity: true,
        unit: true,
        calories: true,
        proteinG: true,
        carbsG: true,
        fatG: true,
        fiberG: true,
        barcode: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { entries: true } },
      },
    }),
    prisma.savedMeal.findMany({
      where: { userId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        mealType: true,
        updatedAt: true,
        items: {
          select: {
            id: true,
            description: true,
            calories: true,
            proteinG: true,
            carbsG: true,
            fatG: true,
          },
        },
      },
    }),
    prisma.foodEntry.findMany({
      where: { isFavorite: true, meal: { day: { userId } } },
      orderBy: { updatedAt: "desc" },
      take: 24,
      distinct: ["description"],
      select: {
        id: true,
        description: true,
        servingSize: true,
        quantity: true,
        unit: true,
        calories: true,
        proteinG: true,
        carbsG: true,
        fatG: true,
        fiberG: true,
        updatedAt: true,
      },
    }),
    prisma.settings.findUnique({
      where: { userId },
      select: { unitSystem: true },
    }),
    prisma.nutritionDay.findMany({
      where: { userId, date: { gte: monthStart, lt: monthEnd } },
      orderBy: { date: "asc" },
      select: {
        date: true,
        meals: {
          select: {
            entries: {
              select: {
                calories: true,
                proteinG: true,
                carbsG: true,
                fatG: true,
                fiberG: true,
              },
            },
          },
        },
      },
    }),
    prisma.bodyMeasurement.findFirst({ where: { userId, weightKg: { not: null } }, orderBy: { date: "desc" }, select: { weightKg: true, date: true } }),
  ]);

  const entries = (day?.meals ?? []).flatMap((meal) => meal.entries);
  const totals = summarizeEntries(entries);
  const goals = goal
    ? {
        calories: goal.calories,
        proteinG: goal.proteinG,
        carbsG: goal.carbsG,
        fatG: goal.fatG,
        fiberG: goal.fiberG,
        updatedAt: goal.updatedAt.toISOString(),
      }
    : null;
  const macroProgress = {
    calories: progress(totals.calories, goals?.calories ?? null),
    proteinG: progress(totals.proteinG, goals?.proteinG ?? null),
    carbsG: progress(totals.carbsG, goals?.carbsG ?? null),
    fatG: progress(totals.fatG, goals?.fatG ?? null),
    fiberG: progress(totals.fiberG, goals?.fiberG ?? null),
  };
  const waterGoalMl = profile?.waterGoalMl ?? 2500;
  const monthRows = monthDays.map((row) => {
    const allEntries = row.meals.flatMap((meal) => meal.entries);
    return { date: isoDay(row.date), ...summarizeEntries(allEntries) };
  });
  const loggedDays = monthRows.length;

  return {
    date: isoDay(date),
    navigation: {
      previousDate: isoDay(shiftDay(date, -1)),
      nextDate: isoDay(shiftDay(date, 1)),
      today: isoDay(today),
      isToday: isoDay(date) === isoDay(today),
    },
    dayId: day?.id ?? null,
    notes: day?.notes ?? null,
    totals,
    progress: macroProgress,
    meals: (day?.meals ?? []).map((meal) => ({
      id: meal.id,
      mealType: meal.mealType,
      name: meal.name,
      loggedAt: meal.loggedAt?.toISOString() ?? null,
      totals: summarizeEntries(meal.entries),
      entries: meal.entries.map((entry) => ({
        id: entry.id,
        productId: entry.productId,
        description: entry.description,
        source: entry.source,
        servingSize: entry.servingSize,
        quantity: entry.quantity,
        unit: entry.unit,
        calories: entry.calories,
        proteinG: entry.proteinG,
        carbsG: entry.carbsG,
        fatG: entry.fatG,
        fiberG: entry.fiberG,
        sugarG: entry.sugarG,
        sodiumMg: entry.sodiumMg,
        cholesterolMg: entry.cholesterolMg,
        saturatedFatG: entry.saturatedFatG,
        transFatG: entry.transFatG,
        potassiumMg: entry.potassiumMg,
        confidence: entry.confidence,
        isFavorite: entry.isFavorite,
        imageKey: entry.imageKey,
        imageUrl: resolveAssetUrl(entry.imageKey),
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      })),
    })),
    water: {
      amountMl: water?.amountMl ?? 0,
      goalMl: waterGoalMl,
      progress: progress(water?.amountMl ?? 0, waterGoalMl) ?? 0,
      updatedAt: water?.updatedAt.toISOString() ?? null,
    },
    goal: goals,
    goalProfile: {
      gender: profile?.gender ?? null,
      birthdate: profile?.birthdate?.toISOString().slice(0, 10) ?? null,
      heightCm: profile?.heightCm ?? null,
      activityLevel: profile?.activityLevel ?? null,
      dietGoal: profile?.dietGoal ?? null,
      goalWeightKg: profile?.goalWeightKg ?? null,
      targetWeeklyChangeKg: profile?.targetWeeklyChangeKg ?? null,
      currentWeightKg: currentMeasurement?.weightKg ?? null,
      currentWeightDate: currentMeasurement?.date ? isoDay(currentMeasurement.date) : null,
    },
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      quantity: product.quantity,
      unit: product.unit,
      calories: product.calories,
      proteinG: product.proteinG,
      carbsG: product.carbsG,
      fatG: product.fatG,
      fiberG: product.fiberG,
      barcode: product.barcode,
      usageCount: product._count.entries,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    })),
    productSummary: {
      count: products.length,
      usedProducts: products.filter((product) => product._count.entries > 0)
        .length,
      barcoded: products.filter((product) => Boolean(product.barcode)).length,
    },
    savedMeals: savedMeals.map((meal) => ({
      id: meal.id,
      name: meal.name,
      mealType: meal.mealType,
      itemCount: meal.items.length,
      totals: summarizeEntries(meal.items),
      items: meal.items,
      updatedAt: meal.updatedAt.toISOString(),
    })),
    savedMealSummary: {
      count: savedMeals.length,
      items: savedMeals.reduce((sum, meal) => sum + meal.items.length, 0),
    },
    favorites: favorites.map((entry) => ({
      id: entry.id,
      description: entry.description,
      servingSize: entry.servingSize,
      quantity: entry.quantity,
      unit: entry.unit,
      calories: entry.calories,
      proteinG: entry.proteinG,
      carbsG: entry.carbsG,
      fatG: entry.fatG,
      fiberG: entry.fiberG,
      updatedAt: entry.updatedAt.toISOString(),
    })),
    favoriteSummary: { count: favorites.length },
    unitSystem: settings?.unitSystem ?? "IMPERIAL",
    month: {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth(),
      loggedDays,
      averageCalories:
        loggedDays > 0
          ? round(
              monthRows.reduce((sum, row) => sum + row.calories, 0) /
                loggedDays,
              0,
            )
          : 0,
      totalProteinG: round(
        monthRows.reduce((sum, row) => sum + row.proteinG, 0),
      ),
      days: monthRows,
    },
  };
}

type NutritionMutationPayload = Record<string, unknown> | undefined;

function nutritionPayload(
  payload: NutritionMutationPayload,
): Record<string, unknown> {
  if (!payload || Array.isArray(payload)) {
    throw new Error("A mutation payload is required.");
  }
  return payload;
}

function nutritionText(
  payload: Record<string, unknown>,
  key: string,
  options: { required?: boolean; max?: number } = {},
): string | null {
  const value = payload[key];
  if (value == null || value === "") {
    if (options.required) throw new Error(`${key} is required.`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${key} must be text.`);
  const trimmed = value.trim();
  if (!trimmed && options.required) throw new Error(`${key} is required.`);
  if (trimmed.length > (options.max ?? 2_000)) {
    throw new Error(`${key} is too long.`);
  }
  return trimmed || null;
}

function nutritionNumber(
  payload: Record<string, unknown>,
  key: string,
  options: {
    required?: boolean;
    min?: number;
    max?: number;
    integer?: boolean;
  } = {},
): number | null {
  const value = payload[key];
  if (value == null || value === "") {
    if (options.required) throw new Error(`${key} is required.`);
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number.`);
  if (options.integer && !Number.isInteger(parsed))
    throw new Error(`${key} must be a whole number.`);
  if (options.min != null && parsed < options.min)
    throw new Error(`${key} must be at least ${options.min}.`);
  if (options.max != null && parsed > options.max)
    throw new Error(`${key} must be at most ${options.max}.`);
  return parsed;
}

function nutritionDay(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("date must use YYYY-MM-DD format.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || !date.toISOString().startsWith(value)) {
    throw new Error("date is invalid.");
  }
  return date;
}

const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
type MealTypeValue = (typeof MEAL_TYPES)[number];
const FOOD_SOURCES = ["MANUAL", "TEXT", "VISION", "BARCODE"] as const;
type FoodSourceValue = (typeof FOOD_SOURCES)[number];

const MAX_FOOD_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_FOOD_PHOTO_BASE64_LENGTH = Math.ceil(MAX_FOOD_PHOTO_BYTES / 3) * 4 + 4;
const FOOD_PHOTO_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function mealType(value: unknown): MealTypeValue {
  if (typeof value !== "string") throw new Error("mealType is required.");
  const normalized = value.toUpperCase();
  if (!MEAL_TYPES.includes(normalized as MealTypeValue)) {
    throw new Error("mealType must be breakfast, lunch, dinner, or snack.");
  }
  return normalized as MealTypeValue;
}

function foodSource(value: unknown): FoodSourceValue {
  if (value == null || value === "") return "MANUAL";
  if (typeof value !== "string") throw new Error("source must be text.");
  const normalized = value.trim().toUpperCase();
  if (!FOOD_SOURCES.includes(normalized as FoodSourceValue)) {
    throw new Error("source must be manual, text, vision, or barcode.");
  }
  return normalized as FoodSourceValue;
}

function foodPhotoDirectory(userId: string): string {
  const dataRoot = process.env.CORETEX_DATA_DIR?.trim() || join(homedir(), ".coretex");
  return resolve(dataRoot, "lifeos", "assets", userId, "nutrition");
}

function matchesFoodPhotoSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/webp") {
    return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function decodeFoodPhoto(
  suppliedBase64: unknown,
  suppliedMimeType: unknown,
): { buffer: Buffer; mimeType: string; extension: string } {
  if (typeof suppliedBase64 !== "string" || !suppliedBase64.trim()) {
    throw new Error("Food photo data must be non-empty base64 text.");
  }
  if (typeof suppliedMimeType !== "string" || !suppliedMimeType.trim()) {
    throw new Error("Food photo type is required.");
  }
  const mimeType = suppliedMimeType.trim().toLowerCase().split(";", 1)[0] ?? "";
  const extension = FOOD_PHOTO_EXTENSIONS[mimeType];
  if (!extension) throw new Error("Food photos must be JPEG, PNG, or WebP images.");

  let encoded = suppliedBase64.trim();
  if (encoded.startsWith("data:")) {
    const dataUrl = /^data:([^;,]+);base64,([a-z0-9+/=]+)$/i.exec(encoded);
    if (!dataUrl) throw new Error("Food photo data URL is invalid.");
    if (dataUrl[1]?.toLowerCase() !== mimeType) throw new Error("Food photo type does not match its data URL.");
    encoded = dataUrl[2] ?? "";
  }
  if (!encoded || encoded.length > MAX_FOOD_PHOTO_BASE64_LENGTH) {
    throw new Error("Food photos must be 12 MB or smaller.");
  }
  if (encoded.length % 4 !== 0 || !/^[a-z0-9+/]*={0,2}$/i.test(encoded)) {
    throw new Error("Food photo data is not valid base64.");
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) throw new Error("The selected food photo is empty.");
  if (buffer.length > MAX_FOOD_PHOTO_BYTES) throw new Error("Food photos must be 12 MB or smaller.");
  if (!matchesFoodPhotoSignature(buffer, mimeType)) {
    throw new Error("Food photo contents do not match the selected image type.");
  }
  return { buffer, mimeType, extension };
}

async function persistFoodPhoto(
  userId: string,
  payload: Record<string, unknown>,
  source: FoodSourceValue,
): Promise<string | null> {
  const suppliedBase64 = payload.photoBase64;
  const suppliedMimeType = payload.mimeType;
  const hasPhoto = suppliedBase64 != null && suppliedBase64 !== "";
  const hasMimeType = suppliedMimeType != null && suppliedMimeType !== "";
  if (!hasPhoto && !hasMimeType) return null;
  if (source !== "VISION") throw new Error("Food photos can only be attached to vision-analyzed entries.");
  if (!hasPhoto) throw new Error("Food photo data is required when a photo type is supplied.");
  const { buffer, extension } = decodeFoodPhoto(suppliedBase64, suppliedMimeType);

  const directory = foodPhotoDirectory(userId);
  await mkdir(directory, { recursive: true });
  const filePath = join(directory, `${Date.now()}-${randomUUID()}${extension}`);
  await writeFile(filePath, buffer, { flag: "wx" });
  return filePath;
}

export async function addWater(userId: string, raw: NutritionMutationPayload) {
  const payload = nutritionPayload(raw);
  const date = nutritionDay(payload.date);
  const amountMl = nutritionNumber(payload, "amountMl", {
    required: true,
    min: 1,
    max: 5_000,
    integer: true,
  }) as number;
  const water = await prisma.$transaction(async (tx) => {
    const current = await tx.waterLog.findUnique({
      where: { userId_date: { userId, date } },
      select: { amountMl: true },
    });
    const nextAmount = Math.min(20_000, (current?.amountMl ?? 0) + amountMl);
    return tx.waterLog.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, amountMl: nextAmount },
      update: { amountMl: nextAmount },
    });
  });
  return {
    ok: true,
    water: {
      amountMl: water.amountMl,
      date: isoDay(water.date),
      updatedAt: water.updatedAt.toISOString(),
    },
  };
}

export async function setWater(userId: string, raw: NutritionMutationPayload) {
  const payload = nutritionPayload(raw);
  const date = nutritionDay(payload.date);
  const amountMl = nutritionNumber(payload, "amountMl", {
    required: true,
    min: 0,
    max: 20_000,
    integer: true,
  }) as number;
  const water = await prisma.waterLog.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, amountMl },
    update: { amountMl },
  });
  return {
    ok: true,
    water: {
      amountMl: water.amountMl,
      date: isoDay(water.date),
      updatedAt: water.updatedAt.toISOString(),
    },
  };
}

export async function logFood(userId: string, raw: NutritionMutationPayload) {
  const payload = nutritionPayload(raw);
  const date = nutritionDay(payload.date);
  const selectedMealType = mealType(payload.mealType);
  const source = foodSource(payload.source);
  const description = nutritionText(payload, "description", {
    required: true,
    max: 250,
  }) as string;
  const productId = nutritionText(payload, "productId", { max: 100 });
  if (productId) {
    const product = await prisma.foodProduct.findFirst({
      where: { id: productId, userId },
      select: { id: true },
    });
    if (!product) throw new Error("Food product not found.");
  }
  const entryData = {
    productId,
    description,
    source,
    servingSize: nutritionText(payload, "servingSize", { max: 100 }),
    quantity: nutritionNumber(payload, "quantity", { min: 0, max: 1_000_000 }),
    unit: nutritionText(payload, "unit", { max: 30 }),
    calories: nutritionNumber(payload, "calories", { min: 0, max: 100_000 }),
    proteinG: nutritionNumber(payload, "proteinG", { min: 0, max: 10_000 }),
    carbsG: nutritionNumber(payload, "carbsG", { min: 0, max: 10_000 }),
    fatG: nutritionNumber(payload, "fatG", { min: 0, max: 10_000 }),
    fiberG: nutritionNumber(payload, "fiberG", { min: 0, max: 10_000 }),
    aiAnalyzed: source === "TEXT" || source === "VISION",
    manuallyAdjusted: source === "MANUAL",
  };
  const imageKey = await persistFoodPhoto(userId, payload, source);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const day = await tx.nutritionDay.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date },
        update: {},
        select: { id: true },
      });
      const requestedMealId = nutritionText(payload, "mealId", { max: 100 });
      let meal = requestedMealId
        ? await tx.meal.findFirst({
            where: { id: requestedMealId, dayId: day.id },
            select: { id: true, mealType: true },
          })
        : await tx.meal.findFirst({
            where: { dayId: day.id, mealType: selectedMealType },
            orderBy: { order: "asc" },
            select: { id: true, mealType: true },
          });
      if (requestedMealId && !meal) throw new Error("Meal not found.");
      if (!meal) {
        meal = await tx.meal.create({
          data: {
            dayId: day.id,
            mealType: selectedMealType,
            name: nutritionText(payload, "mealName", { max: 100 }),
            order: MEAL_TYPES.indexOf(selectedMealType),
            loggedAt: new Date(),
          },
          select: { id: true, mealType: true },
        });
      }
      const entry = await tx.foodEntry.create({
        data: { mealId: meal.id, ...entryData, imageKey },
      });
      return { meal, entry };
    });
    return {
      ok: true,
      date: isoDay(date),
      meal: result.meal,
      entry: {
        ...result.entry,
        imageUrl: resolveAssetUrl(result.entry.imageKey),
        createdAt: result.entry.createdAt.toISOString(),
        updatedAt: result.entry.updatedAt.toISOString(),
      },
    };
  } catch (error) {
    if (imageKey) await unlink(imageKey).catch(() => undefined);
    throw error;
  }
}

type FoodEstimate = {
  description: string;
  servingSize: string | null;
  quantity: number | null;
  unit: string | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  source: "TEXT" | "VISION" | "BARCODE";
  model: string | null;
  productId: string | null;
  barcode: string | null;
  nutritionBasis: "estimated-serving" | "saved-serving" | "serving" | "100g";
  attribution: { provider: string; url: string | null };
};

type AiFoodEstimate = {
  description?: string;
  servingSize?: string;
  quantity?: number;
  unit?: string;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
};

const OPEN_FOOD_FACTS_ROOT = "https://world.openfoodfacts.org";
const OPEN_FOOD_FACTS_USER_AGENT = "Coretex/0.1 (https://github.com/MDCran/coretex)";

function estimateValue(value: unknown, maximum: number): number | null {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.min(maximum, numeric) : null;
}

function estimateText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maximum) : null;
}

function formattedServing(quantity: number | null, unit: string | null): string | null {
  return quantity == null ? null : `${quantity}${unit ? ` ${unit}` : ""}`;
}

function aiFoodEstimate(
  value: AiFoodEstimate,
  fallbackDescription: string,
  source: "TEXT" | "VISION",
  model: string,
): FoodEstimate {
  const quantity = estimateValue(value.quantity, 1_000_000);
  const unit = estimateText(value.unit, 30);
  const estimate: FoodEstimate = {
    description: estimateText(value.description, 250) ?? fallbackDescription.slice(0, 250),
    servingSize: estimateText(value.servingSize, 100) ?? formattedServing(quantity, unit),
    quantity,
    unit,
    calories: estimateValue(value.calories, 100_000),
    proteinG: estimateValue(value.proteinG, 10_000),
    carbsG: estimateValue(value.carbsG, 10_000),
    fatG: estimateValue(value.fatG, 10_000),
    fiberG: estimateValue(value.fiberG, 10_000),
    source,
    model,
    productId: null,
    barcode: null,
    nutritionBasis: "estimated-serving",
    attribution: { provider: `Local AI (${model})`, url: null },
  };
  if ([estimate.calories, estimate.proteinG, estimate.carbsG, estimate.fatG, estimate.fiberG].every((item) => item == null)) {
    throw new Error("The local AI model did not return a usable nutrition estimate. Try a clearer portion description or a different model.");
  }
  return estimate;
}

function gtinBarcode(value: unknown): string {
  if (typeof value !== "string") throw new Error("barcode is required.");
  const barcode = value.trim();
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(barcode)) {
    throw new Error("Enter a valid 8, 12, 13, or 14 digit food barcode.");
  }
  const expectedCheckDigit = Number(barcode.at(-1));
  let sum = 0;
  for (let index = barcode.length - 2, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(barcode[index]) * (position % 2 === 0 ? 3 : 1);
  }
  if ((10 - (sum % 10)) % 10 !== expectedCheckDigit) {
    throw new Error("That barcode has an invalid check digit. Check the printed number and try again.");
  }
  return barcode;
}

function offNutrient(
  nutriments: Record<string, unknown>,
  name: string,
  basis: "serving" | "100g",
  maximum: number,
): number | null {
  return estimateValue(nutriments[`${name}_${basis}`], maximum);
}

function localProductEstimate(product: {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  barcode: string | null;
}): FoodEstimate {
  return {
    description: product.name,
    servingSize: formattedServing(product.quantity, product.unit),
    quantity: product.quantity,
    unit: product.unit,
    calories: product.calories,
    proteinG: product.proteinG,
    carbsG: product.carbsG,
    fatG: product.fatG,
    fiberG: product.fiberG,
    source: "BARCODE",
    model: null,
    productId: product.id,
    barcode: product.barcode,
    nutritionBasis: "saved-serving",
    attribution: { provider: "Your saved food library", url: null },
  };
}

export async function analyzeFood(userId: string, raw: NutritionMutationPayload): Promise<FoodEstimate> {
  void userId;
  const payload = nutritionPayload(raw);
  const description = nutritionText(payload, "description", { required: true, max: 2_000 }) as string;
  const ai = await ollamaJson<AiFoodEstimate>(
    `Estimate nutrition for the described food. Return JSON with description, servingSize, quantity, unit, calories, proteinG, carbsG, fatG, and fiberG. All nutrient values must be totals for the stated quantity, not per 100 g unless the serving itself is 100 g. Use a realistic single serving when the portion is ambiguous. Be conservative and do not invent branded product data. Description: ${description}`,
    20_000,
  );
  if (!ai) {
    throw new Error("Food analysis is unavailable. Start Ollama and configure a local text model, then try again.");
  }
  return aiFoodEstimate(ai.value, description, "TEXT", ai.model);
}

export async function analyzeFoodPhoto(userId: string, raw: NutritionMutationPayload): Promise<FoodEstimate> {
  void userId;
  const payload = nutritionPayload(raw);
  const photo = decodeFoodPhoto(payload.base64, payload.mimeType);
  const hint = nutritionText(payload, "description", { max: 500 }) ?? "Food photo";
  const ai = await ollamaJson<AiFoodEstimate>(
    `Identify the visible food and estimate the whole visible serving. Return JSON with description, servingSize, quantity, unit, calories, proteinG, carbsG, fatG, and fiberG. All nutrient values must be totals for the stated visible serving. User hint: ${hint}`,
    30_000,
    [photo.buffer.toString("base64")],
  );
  if (!ai) {
    throw new Error("Food photo analysis is unavailable. Start Ollama and configure a vision-capable local model, then try again.");
  }
  return aiFoodEstimate(ai.value, hint, "VISION", ai.model);
}

export async function lookupBarcode(userId: string, raw: NutritionMutationPayload): Promise<FoodEstimate> {
  const payload = nutritionPayload(raw);
  const barcode = gtinBarcode(payload.barcode);
  const localProduct = await prisma.foodProduct.findFirst({
    where: { userId, barcode },
    orderBy: { updatedAt: "desc" },
  });
  if (localProduct) return localProductEstimate(localProduct);

  const endpoint = new URL(`/api/v3/product/${barcode}`, OPEN_FOOD_FACTS_ROOT);
  endpoint.searchParams.set(
    "fields",
    "code,product_name,product_name_en,generic_name,serving_size,serving_quantity,serving_quantity_unit,nutriments",
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { "User-Agent": OPEN_FOOD_FACTS_USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Barcode lookup timed out. Check your connection and try again.");
    }
    throw new Error("Barcode lookup could not reach Open Food Facts. Check your connection and try again.");
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 404) throw new Error("No food was found for that barcode. You can still enter it manually.");
  if (response.status === 429) throw new Error("The barcode service is busy. Wait a moment and try again.");
  if (!response.ok) throw new Error(`Barcode lookup failed (HTTP ${response.status}). Try again or enter the food manually.`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The barcode service returned an unreadable response. Try again later.");
  }
  const result = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const product = result.product && typeof result.product === "object"
    ? result.product as Record<string, unknown>
    : null;
  if (result.status !== "success" || !product) {
    throw new Error("No food was found for that barcode. You can still enter it manually.");
  }
  const description = estimateText(product.product_name, 250)
    ?? estimateText(product.product_name_en, 250)
    ?? estimateText(product.generic_name, 250);
  if (!description) throw new Error("That barcode has no usable product name. Enter the food manually.");
  const nutriments = product.nutriments && typeof product.nutriments === "object"
    ? product.nutriments as Record<string, unknown>
    : {};
  const nutrientNames = ["energy-kcal", "proteins", "carbohydrates", "fat", "fiber"];
  const hasServingNutrition = nutrientNames.some((name) => offNutrient(nutriments, name, "serving", 100_000) != null);
  const nutritionBasis = hasServingNutrition ? "serving" as const : "100g" as const;
  const servingUnit = estimateText(product.serving_quantity_unit, 30);
  const quantity = nutritionBasis === "serving"
    ? estimateValue(product.serving_quantity, 1_000_000)
    : 100;
  const unit = nutritionBasis === "serving"
    ? servingUnit
    : servingUnit === "ml" ? "ml" : "g";
  const servingSize = nutritionBasis === "serving"
    ? estimateText(product.serving_size, 100) ?? formattedServing(quantity, unit)
    : `100 ${unit}`;
  const externalEstimate = {
    description,
    servingSize,
    quantity,
    unit,
    calories: offNutrient(nutriments, "energy-kcal", nutritionBasis, 100_000),
    proteinG: offNutrient(nutriments, "proteins", nutritionBasis, 10_000),
    carbsG: offNutrient(nutriments, "carbohydrates", nutritionBasis, 10_000),
    fatG: offNutrient(nutriments, "fat", nutritionBasis, 10_000),
    fiberG: offNutrient(nutriments, "fiber", nutritionBasis, 10_000),
  };
  const cachedProduct = await prisma.foodProduct.create({
    data: {
      userId,
      name: externalEstimate.description,
      quantity: externalEstimate.quantity,
      unit: externalEstimate.unit,
      calories: externalEstimate.calories,
      proteinG: externalEstimate.proteinG,
      carbsG: externalEstimate.carbsG,
      fatG: externalEstimate.fatG,
      fiberG: externalEstimate.fiberG,
      barcode,
    },
    select: { id: true },
  });
  return {
    ...externalEstimate,
    source: "BARCODE",
    model: null,
    productId: cachedProduct.id,
    barcode,
    nutritionBasis,
    attribution: {
      provider: "Open Food Facts",
      url: `${OPEN_FOOD_FACTS_ROOT}/product/${barcode}`,
    },
  };
}

export async function updateGoals(
  userId: string,
  raw: NutritionMutationPayload,
) {
  const payload = nutritionPayload(raw);
  const goalData = {
    calories: nutritionNumber(payload, "calories", { min: 0, max: 100_000 }),
    proteinG: nutritionNumber(payload, "proteinG", { min: 0, max: 10_000 }),
    carbsG: nutritionNumber(payload, "carbsG", { min: 0, max: 10_000 }),
    fatG: nutritionNumber(payload, "fatG", { min: 0, max: 10_000 }),
    fiberG: nutritionNumber(payload, "fiberG", { min: 0, max: 10_000 }),
  };
  const waterGoalMl = nutritionNumber(payload, "waterGoalMl", {
    min: 250,
    max: 20_000,
    integer: true,
  });
  if (
    Object.values(goalData).every((value) => value == null) &&
    waterGoalMl == null
  ) {
    throw new Error("Set at least one nutrition goal.");
  }
  const [goal, profile] = await prisma.$transaction([
    prisma.nutritionGoal.upsert({
      where: { userId },
      create: { userId, ...goalData },
      update: goalData,
    }),
    prisma.userProfile.upsert({
      where: { userId },
      create: { userId, ...(waterGoalMl == null ? {} : { waterGoalMl }) },
      update: waterGoalMl == null ? {} : { waterGoalMl },
    }),
  ]);
  return {
    ok: true,
    goal: {
      ...goal,
      createdAt: goal.createdAt.toISOString(),
      updatedAt: goal.updatedAt.toISOString(),
    },
    waterGoalMl: profile.waterGoalMl ?? 2_500,
  };
}

export async function updateProfileAndCalculate(userId: string, raw: NutritionMutationPayload) {
  const payload = nutritionPayload(raw);
  const birthdateText = nutritionText(payload, "birthdate", { required: true, max: 10 }) as string;
  const birthdate = new Date(`${birthdateText}T00:00:00.000Z`);
  if (Number.isNaN(birthdate.getTime()) || birthdate >= new Date()) throw new Error("Enter a valid birthdate.");
  const heightCm = nutritionNumber(payload, "heightCm", { required: true, min: 75, max: 275 }) as number;
  const activityLevel = nutritionText(payload, "activityLevel", { required: true, max: 40 }) as string;
  const gender = nutritionText(payload, "gender", { max: 40 });
  const dietGoal = nutritionText(payload, "dietGoal", { required: true, max: 40 }) as string;
  const goalWeightKg = nutritionNumber(payload, "goalWeightKg", { min: 20, max: 500 });
  const targetWeeklyChangeKg = nutritionNumber(payload, "targetWeeklyChangeKg", { min: 0, max: 2 });
  const activityMultipliers: Record<string, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
  if (!activityMultipliers[activityLevel]) throw new Error("Choose a valid activity level.");
  if (!["maintain", "lose", "gain"].includes(dietGoal)) throw new Error("Choose a valid nutrition goal.");
  const measurement = await prisma.bodyMeasurement.findFirst({ where: { userId, weightKg: { not: null } }, orderBy: { date: "desc" }, select: { weightKg: true, date: true } });
  if (!measurement?.weightKg) throw new Error("Log a current weight in Health or Workouts before calculating nutrition targets.");
  const age = Math.max(13, Math.floor((Date.now() - birthdate.getTime()) / (365.2425 * 86_400_000)));
  const genderAdjustment = gender === "male" ? 5 : gender === "female" ? -161 : -78;
  const bmr = 10 * measurement.weightKg + 6.25 * heightCm - 5 * age + genderAdjustment;
  const maintenance = bmr * activityMultipliers[activityLevel];
  const weeklyChange = targetWeeklyChangeKg ?? (dietGoal === "maintain" ? 0 : 0.25);
  const adjustment = dietGoal === "lose" ? -(weeklyChange * 7_700) / 7 : dietGoal === "gain" ? (weeklyChange * 7_700) / 7 : 0;
  const calories = Math.round(Math.max(1_200, Math.min(6_000, maintenance + adjustment)));
  const proteinG = round(measurement.weightKg * (dietGoal === "lose" ? 2 : 1.8), 0);
  const fatG = round(measurement.weightKg * 0.8, 0);
  const carbsG = round(Math.max(0, (calories - proteinG * 4 - fatG * 9) / 4), 0);
  const fiberG = round((calories / 1_000) * 14, 0);
  const waterGoalMl = Math.round(Math.max(1_500, Math.min(8_000, measurement.weightKg * 35)));
  const [profile, goal] = await prisma.$transaction([
    prisma.userProfile.upsert({ where: { userId }, create: { userId, gender, birthdate, heightCm, activityLevel, dietGoal, goalWeightKg, targetWeeklyChangeKg: weeklyChange, waterGoalMl }, update: { gender, birthdate, heightCm, activityLevel, dietGoal, goalWeightKg, targetWeeklyChangeKg: weeklyChange, waterGoalMl } }),
    prisma.nutritionGoal.upsert({ where: { userId }, create: { userId, calories, proteinG, carbsG, fatG, fiberG }, update: { calories, proteinG, carbsG, fatG, fiberG } }),
  ]);
  return { ok: true, age, currentWeightKg: measurement.weightKg, currentWeightDate: isoDay(measurement.date), bmr: Math.round(bmr), maintenanceCalories: Math.round(maintenance), waterGoalMl, profile, goal };
}
