import type { FoodSource, MealType, Prisma } from "@prisma/client";
import { unlink } from "node:fs/promises";
import { prisma } from "../db/prisma.js";
import * as nutrition from "./nutrition.js";

type Payload = Record<string, unknown> | undefined;
type MacroSnapshot = {
  productId: string | null;
  description: string;
  source: FoodSource;
  servingSize: string | null;
  quantity: number | null;
  unit: string | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
};

const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
const FOOD_SOURCES = ["MANUAL", "TEXT", "VISION", "BARCODE"] as const;

function objectPayload(raw: Payload): Record<string, unknown> {
  if (!raw || Array.isArray(raw)) throw new Error("A mutation payload is required.");
  return raw;
}

function has(payload: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function textValue(
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
  if (trimmed.length > (options.max ?? 2_000)) throw new Error(`${key} is too long.`);
  return trimmed || null;
}

function numberValue(
  payload: Record<string, unknown>,
  key: string,
  options: { required?: boolean; min?: number; max?: number; integer?: boolean } = {},
): number | null {
  const value = payload[key];
  if (value == null || value === "") {
    if (options.required) throw new Error(`${key} is required.`);
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number.`);
  if (options.integer && !Number.isInteger(parsed)) throw new Error(`${key} must be a whole number.`);
  if (options.min != null && parsed < options.min) throw new Error(`${key} must be at least ${options.min}.`);
  if (options.max != null && parsed > options.max) throw new Error(`${key} must be at most ${options.max}.`);
  return parsed;
}

function boolValue(payload: Record<string, unknown>, key: string): boolean {
  if (typeof payload[key] !== "boolean") throw new Error(`${key} must be true or false.`);
  return payload[key] as boolean;
}

function dayValue(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("date must use YYYY-MM-DD format.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || !date.toISOString().startsWith(value)) throw new Error("date is invalid.");
  return date;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mealTypeValue(value: unknown, required = true): MealType | null {
  if (value == null || value === "") {
    if (required) throw new Error("mealType is required.");
    return null;
  }
  if (typeof value !== "string") throw new Error("mealType must be text.");
  const normalized = value.trim().toUpperCase();
  if (!MEAL_TYPES.includes(normalized as (typeof MEAL_TYPES)[number])) {
    throw new Error("mealType must be breakfast, lunch, dinner, or snack.");
  }
  return normalized as MealType;
}

function sourceValue(value: unknown): FoodSource {
  if (value == null || value === "") return "MANUAL";
  if (typeof value !== "string") throw new Error("source must be text.");
  const normalized = value.trim().toUpperCase();
  if (!FOOD_SOURCES.includes(normalized as (typeof FOOD_SOURCES)[number])) {
    throw new Error("source must be manual, text, vision, or barcode.");
  }
  return normalized as FoodSource;
}

function round(value: number, precision = 1): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function totals(items: Array<Pick<MacroSnapshot, "calories" | "proteinG" | "carbsG" | "fatG" | "fiberG">>) {
  const sum = items.reduce<{
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  }>(
    (result, item) => ({
      calories: result.calories + (item.calories ?? 0),
      proteinG: result.proteinG + (item.proteinG ?? 0),
      carbsG: result.carbsG + (item.carbsG ?? 0),
      fatG: result.fatG + (item.fatG ?? 0),
      fiberG: result.fiberG + (item.fiberG ?? 0),
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  );
  return {
    calories: round(sum.calories, 0),
    proteinG: round(sum.proteinG),
    carbsG: round(sum.carbsG),
    fatG: round(sum.fatG),
    fiberG: round(sum.fiberG),
  };
}

const itemSelect = {
  id: true,
  position: true,
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
} satisfies Prisma.SavedMealItemSelect;

const savedMealSelect = {
  id: true,
  name: true,
  mealType: true,
  createdAt: true,
  updatedAt: true,
  items: { orderBy: { position: "asc" as const }, select: itemSelect },
} satisfies Prisma.SavedMealSelect;

type SelectedSavedMeal = Prisma.SavedMealGetPayload<{ select: typeof savedMealSelect }>;

function serializeSavedMeal(meal: SelectedSavedMeal) {
  return {
    id: meal.id,
    name: meal.name,
    mealType: meal.mealType,
    itemCount: meal.items.length,
    totals: totals(meal.items),
    items: meal.items,
    createdAt: meal.createdAt.toISOString(),
    updatedAt: meal.updatedAt.toISOString(),
  };
}

function parseItem(value: unknown, position: number): MacroSnapshot & { position: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`items[${position}] must be an object.`);
  }
  const payload = value as Record<string, unknown>;
  return {
    position,
    productId: textValue(payload, "productId", { max: 100 }),
    description: textValue(payload, "description", { required: true, max: 250 }) as string,
    source: sourceValue(payload.source),
    servingSize: textValue(payload, "servingSize", { max: 100 }),
    quantity: numberValue(payload, "quantity", { min: 0, max: 1_000_000 }),
    unit: textValue(payload, "unit", { max: 30 }),
    calories: numberValue(payload, "calories", { min: 0, max: 100_000 }),
    proteinG: numberValue(payload, "proteinG", { min: 0, max: 10_000 }),
    carbsG: numberValue(payload, "carbsG", { min: 0, max: 10_000 }),
    fatG: numberValue(payload, "fatG", { min: 0, max: 10_000 }),
    fiberG: numberValue(payload, "fiberG", { min: 0, max: 10_000 }),
  };
}

function parseItems(value: unknown): Array<MacroSnapshot & { position: number }> {
  if (!Array.isArray(value)) throw new Error("items must be a list.");
  if (!value.length) throw new Error("A saved meal must contain at least one food item.");
  if (value.length > 100) throw new Error("A saved meal can contain at most 100 food items.");
  return value.map(parseItem);
}

async function assertProductsOwned(userId: string, items: Array<{ productId: string | null }>) {
  const ids = [...new Set(items.flatMap((item) => (item.productId ? [item.productId] : [])))];
  if (!ids.length) return;
  const count = await prisma.foodProduct.count({ where: { userId, id: { in: ids } } });
  if (count !== ids.length) throw new Error("One or more saved-meal food products were not found.");
}

async function libraryOverview(userId: string) {
  const [savedMeals, favorites] = await Promise.all([
    prisma.savedMeal.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      select: savedMealSelect,
    }),
    prisma.foodEntry.findMany({
      where: { isFavorite: true, meal: { day: { userId } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      distinct: ["description"],
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
        updatedAt: true,
      },
    }),
  ]);
  return {
    savedMeals: savedMeals.map(serializeSavedMeal),
    savedMealSummary: {
      count: savedMeals.length,
      items: savedMeals.reduce((sum, meal) => sum + meal.items.length, 0),
    },
    favorites: favorites.map((entry) => ({
      ...entry,
      updatedAt: entry.updatedAt.toISOString(),
    })),
    favoriteSummary: { count: favorites.length },
  };
}

export async function getOverview(
  userId: string,
  payload?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const [overview, library] = await Promise.all([
    nutrition.getOverview(userId, payload),
    libraryOverview(userId),
  ]);
  return { ...overview, ...library };
}

async function destinationMeal(
  tx: Prisma.TransactionClient,
  userId: string,
  date: Date,
  selectedType: MealType,
  requestedMealId: string | null,
) {
  const day = await tx.nutritionDay.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date },
    update: {},
    select: { id: true },
  });
  let meal = requestedMealId
    ? await tx.meal.findFirst({
        where: { id: requestedMealId, dayId: day.id },
        select: { id: true, mealType: true },
      })
    : await tx.meal.findFirst({
        where: { dayId: day.id, mealType: selectedType },
        orderBy: { order: "asc" },
        select: { id: true, mealType: true },
      });
  if (requestedMealId && !meal) throw new Error("Meal not found for the selected date.");
  if (!meal) {
    meal = await tx.meal.create({
      data: {
        dayId: day.id,
        mealType: selectedType,
        order: MEAL_TYPES.indexOf(selectedType as (typeof MEAL_TYPES)[number]),
        loggedAt: new Date(),
      },
      select: { id: true, mealType: true },
    });
  }
  const order = await tx.foodEntry.aggregate({ where: { mealId: meal.id }, _max: { order: true } });
  return { meal, nextOrder: (order._max.order ?? -1) + 1 };
}

export async function setFoodFavorite(userId: string, raw: Payload) {
  const payload = objectPayload(raw);
  const entryId = textValue(payload, "entryId", { required: true, max: 100 }) as string;
  const isFavorite = boolValue(payload, "isFavorite");
  const existing = await prisma.foodEntry.findFirst({
    where: { id: entryId, meal: { day: { userId } } },
    select: { id: true },
  });
  if (!existing) throw new Error("Food entry not found.");
  const favorite = await prisma.foodEntry.update({
    where: { id: entryId },
    data: { isFavorite },
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
      isFavorite: true,
      updatedAt: true,
    },
  });
  return { ok: true, favorite: { ...favorite, updatedAt: favorite.updatedAt.toISOString() } };
}

export async function logFavorite(userId: string, raw: Payload) {
  const payload = objectPayload(raw);
  const favoriteEntryId = textValue(payload, "favoriteEntryId", { required: true, max: 100 }) as string;
  const date = dayValue(payload.date);
  const selectedType = mealTypeValue(payload.mealType) as MealType;
  const requestedMealId = textValue(payload, "mealId", { max: 100 });
  const favorite = await prisma.foodEntry.findFirst({
    where: { id: favoriteEntryId, isFavorite: true, meal: { day: { userId } } },
    select: {
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
      aiAnalyzed: true,
      manuallyAdjusted: true,
      confidence: true,
    },
  });
  if (!favorite) throw new Error("Favorite food not found.");
  const result = await prisma.$transaction(async (tx) => {
    const destination = await destinationMeal(tx, userId, date, selectedType, requestedMealId);
    const entry = await tx.foodEntry.create({
      data: { mealId: destination.meal.id, ...favorite, order: destination.nextOrder },
    });
    return { meal: destination.meal, entry };
  });
  return {
    ok: true,
    date: isoDay(date),
    meal: result.meal,
    entry: {
      ...result.entry,
      createdAt: result.entry.createdAt.toISOString(),
      updatedAt: result.entry.updatedAt.toISOString(),
    },
  };
}

async function sourceMealItems(userId: string, sourceMealId: string) {
  const sourceMeal = await prisma.meal.findFirst({
    where: { id: sourceMealId, day: { userId } },
    select: {
      mealType: true,
      entries: {
        orderBy: { order: "asc" },
        select: {
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
        },
      },
    },
  });
  if (!sourceMeal) throw new Error("Source meal not found.");
  if (!sourceMeal.entries.length) throw new Error("The source meal has no food items to save.");
  return {
    mealType: sourceMeal.mealType,
    items: sourceMeal.entries.map((entry, position) => ({ ...entry, position })),
  };
}

export async function createSavedMeal(userId: string, raw: Payload) {
  const payload = objectPayload(raw);
  const name = textValue(payload, "name", { required: true, max: 120 }) as string;
  const sourceMealId = textValue(payload, "sourceMealId", { max: 100 });
  if (sourceMealId && has(payload, "items")) throw new Error("Use either sourceMealId or items, not both.");
  const source = sourceMealId ? await sourceMealItems(userId, sourceMealId) : null;
  const items = source?.items ?? parseItems(payload.items);
  await assertProductsOwned(userId, items);
  const selectedType = has(payload, "mealType")
    ? mealTypeValue(payload.mealType, false)
    : (source?.mealType ?? null);
  const savedMeal = await prisma.savedMeal.create({
    data: {
      userId,
      name,
      mealType: selectedType,
      items: { create: items },
    },
    select: savedMealSelect,
  });
  return { ok: true, savedMeal: serializeSavedMeal(savedMeal) };
}

export async function updateSavedMeal(userId: string, raw: Payload) {
  const payload = objectPayload(raw);
  const savedMealId = textValue(payload, "savedMealId", { required: true, max: 100 }) as string;
  if (!has(payload, "name") && !has(payload, "mealType") && !has(payload, "items")) {
    throw new Error("Set at least one saved-meal field to update.");
  }
  const existing = await prisma.savedMeal.findFirst({ where: { id: savedMealId, userId }, select: { id: true } });
  if (!existing) throw new Error("Saved meal not found.");
  const items = has(payload, "items") ? parseItems(payload.items) : null;
  if (items) await assertProductsOwned(userId, items);
  const savedMeal = await prisma.$transaction(async (tx) => {
    if (items) {
      await tx.savedMealItem.deleteMany({ where: { savedMealId } });
      await tx.savedMealItem.createMany({ data: items.map((item) => ({ savedMealId, ...item })) });
    }
    return tx.savedMeal.update({
      where: { id: savedMealId },
      data: {
        ...(has(payload, "name")
          ? { name: textValue(payload, "name", { required: true, max: 120 }) as string }
          : {}),
        ...(has(payload, "mealType") ? { mealType: mealTypeValue(payload.mealType, false) } : {}),
      },
      select: savedMealSelect,
    });
  });
  return { ok: true, savedMeal: serializeSavedMeal(savedMeal) };
}

export async function deleteSavedMeal(userId: string, raw: Payload) {
  const payload = objectPayload(raw);
  const savedMealId = textValue(payload, "savedMealId", { required: true, max: 100 }) as string;
  const result = await prisma.savedMeal.deleteMany({ where: { id: savedMealId, userId } });
  if (!result.count) throw new Error("Saved meal not found.");
  return { ok: true, id: savedMealId, deleted: true };
}

export async function logSavedMeal(userId: string, raw: Payload) {
  const payload = objectPayload(raw);
  const savedMealId = textValue(payload, "savedMealId", { required: true, max: 100 }) as string;
  const date = dayValue(payload.date);
  const requestedMealId = textValue(payload, "mealId", { max: 100 });
  const savedMeal = await prisma.savedMeal.findFirst({
    where: { id: savedMealId, userId },
    select: savedMealSelect,
  });
  if (!savedMeal) throw new Error("Saved meal not found.");
  if (!savedMeal.items.length) throw new Error("This saved meal has no food items.");
  const selectedType = has(payload, "mealType")
    ? (mealTypeValue(payload.mealType) as MealType)
    : savedMeal.mealType;
  if (!selectedType) throw new Error("Choose a meal for this saved meal.");
  const result = await prisma.$transaction(async (tx) => {
    const destination = await destinationMeal(tx, userId, date, selectedType, requestedMealId);
    const entries = [];
    for (const [index, item] of savedMeal.items.entries()) {
      const entry = await tx.foodEntry.create({
        data: {
          mealId: destination.meal.id,
          productId: item.productId,
          description: item.description,
          source: item.source,
          servingSize: item.servingSize,
          quantity: item.quantity,
          unit: item.unit,
          calories: item.calories,
          proteinG: item.proteinG,
          carbsG: item.carbsG,
          fatG: item.fatG,
          fiberG: item.fiberG,
          aiAnalyzed: item.source === "TEXT" || item.source === "VISION",
          manuallyAdjusted: item.source === "MANUAL",
          order: destination.nextOrder + index,
        },
      });
      entries.push(entry);
    }
    return { meal: destination.meal, entries };
  });
  return {
    ok: true,
    date: isoDay(date),
    meal: result.meal,
    entries: result.entries.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    })),
    totals: totals(result.entries),
  };
}

export async function updateFoodEntry(userId: string, raw: Payload) {
  const payload = objectPayload(raw);
  const entryId = textValue(payload, "entryId", { required: true, max: 100 }) as string;
  const existing = await prisma.foodEntry.findFirst({
    where: { id: entryId, meal: { day: { userId } } },
    select: { id: true },
  });
  if (!existing) throw new Error("Food entry not found.");
  const data: Prisma.FoodEntryUncheckedUpdateInput = {};
  if (has(payload, "description")) {
    data.description = textValue(payload, "description", { required: true, max: 250 }) as string;
  }
  if (has(payload, "servingSize")) {
    data.servingSize = textValue(payload, "servingSize", { max: 100 });
  }
  if (has(payload, "unit")) {
    data.unit = textValue(payload, "unit", { max: 30 });
  }
  const numberFields = ["quantity", "calories", "proteinG", "carbsG", "fatG", "fiberG"] as const;
  for (const field of numberFields) {
    if (has(payload, field)) {
      data[field] = numberValue(payload, field, {
        min: 0,
        max: field === "quantity" ? 1_000_000 : field === "calories" ? 100_000 : 10_000,
      });
    }
  }
  if (has(payload, "source")) {
    const source = sourceValue(payload.source);
    data.source = source;
    data.aiAnalyzed = source === "TEXT" || source === "VISION";
    data.manuallyAdjusted = source === "MANUAL";
  }
  if (!Object.keys(data).length) throw new Error("Set at least one food field to update.");
  const entry = await prisma.foodEntry.update({ where: { id: entryId }, data });
  return {
    ok: true,
    entry: {
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    },
  };
}

export async function deleteFoodEntry(userId: string, raw: Payload) {
  const payload = objectPayload(raw);
  const entryId = textValue(payload, "entryId", { required: true, max: 100 }) as string;
  const entry = await prisma.foodEntry.findFirst({
    where: { id: entryId, meal: { day: { userId } } },
    select: { id: true, imageKey: true },
  });
  if (!entry) throw new Error("Food entry not found.");
  await prisma.foodEntry.delete({ where: { id: entryId } });
  if (entry.imageKey) await unlink(entry.imageKey).catch(() => undefined);
  return { ok: true, id: entryId, deleted: true };
}

export async function updateGoals(userId: string, raw: Payload) {
  const payload = objectPayload(raw);
  const limits = {
    calories: 100_000,
    proteinG: 10_000,
    carbsG: 10_000,
    fatG: 10_000,
    fiberG: 10_000,
  } as const;
  const goalData: Partial<Record<keyof typeof limits, number | null>> = {};
  for (const [field, maximum] of Object.entries(limits) as Array<[keyof typeof limits, number]>) {
    if (has(payload, field)) goalData[field] = numberValue(payload, field, { min: 0, max: maximum });
  }
  const waterPresent = has(payload, "waterGoalMl");
  const waterGoalMl = waterPresent
    ? numberValue(payload, "waterGoalMl", { min: 250, max: 20_000, integer: true })
    : undefined;
  if (!Object.keys(goalData).length && !waterPresent) throw new Error("Set at least one nutrition goal.");
  const [goal, profile] = await prisma.$transaction([
    prisma.nutritionGoal.upsert({
      where: { userId },
      create: { userId, ...goalData },
      update: goalData,
    }),
    prisma.userProfile.upsert({
      where: { userId },
      create: { userId, ...(waterPresent ? { waterGoalMl } : {}) },
      update: waterPresent ? { waterGoalMl } : {},
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
