"use server";

import { revalidatePath } from "next/cache";
import { MealType } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConfigured, analyzeImage, runClaude } from "@/lib/ai/claude";
import { assertUserUploadKey, uploadUserRasterImage } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";
import { parseDateOnly, str } from "./health-shared";

/**
 * Nutrition AI: free-text and food-photo analysis.
 *
 * Both flows return AnalyzedItem[] for an editable CONFIRM modal in the client;
 * the user reviews/adjusts values, then `saveAnalyzedEntries` persists FoodEntries
 * with aiAnalyzed=true and the raw model response stored on each entry. The food
 * photo flow additionally uploads the image and stamps imageKey on the entries.
 */

export interface AnalyzedItem {
    description: string;
    quantity?: number | null;
    unit?: string | null;
    calories?: number | null;
    proteinG?: number | null;
    carbsG?: number | null;
    fatG?: number | null;
    fiberG?: number | null;
    sugarG?: number | null;
    sodiumMg?: number | null;
    /** Set by the chat-logging flow so each item can route to its own meal. */
    mealType?: string | null;
}

export interface AnalyzeResult {
    items: AnalyzedItem[];
    /** Raw JSON returned by the model, stored on each saved entry for provenance. */
    raw: string;
    /** Set when a photo was analyzed; persisted on saved entries. */
    imageKey?: string;
    /** The original free-text prompt, stored alongside raw for provenance. */
    prompt?: string;
    /** Total water (ml) the user mentioned drinking, for the chat-logging flow. */
    waterMl?: number | null;
}

const NUTRITION_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        items: {
            type: "array",
            description: "One object per distinct food/drink item identified.",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    description: { type: "string", description: "Short name of the food item, e.g. 'Grilled chicken breast'." },
                    quantity: { type: "number", description: "Numeric amount of the serving, e.g. 1, 2, 150." },
                    unit: { type: "string", description: "Unit for the quantity, e.g. 'g', 'cup', 'piece', 'oz'." },
                    calories: { type: "number", description: "Total calories (kcal) for this item's serving." },
                    proteinG: { type: "number", description: "Protein in grams." },
                    carbsG: { type: "number", description: "Carbohydrates in grams." },
                    fatG: { type: "number", description: "Fat in grams." },
                    fiberG: { type: "number", description: "Fiber in grams." },
                    sugarG: { type: "number", description: "Sugar in grams." },
                    sodiumMg: { type: "number", description: "Sodium in milligrams." },
                },
                required: ["description", "calories", "proteinG", "carbsG", "fatG"],
            },
        },
    },
    required: ["items"],
};

/**
 * Chat-logging schema: like NUTRITION_SCHEMA but each food may carry a mealType,
 * and the model also reports total water consumed (ml) mentioned in the message.
 */
const CHAT_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        foods: {
            type: "array",
            description: "One object per distinct food/drink item the user mentioned eating. Empty if none.",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    description: { type: "string", description: "Short name of the food item." },
                    quantity: { type: "number", description: "Numeric amount of the serving." },
                    unit: { type: "string", description: "Unit for the quantity, e.g. 'g', 'cup', 'piece'." },
                    calories: { type: "number", description: "Total calories (kcal) for this serving." },
                    proteinG: { type: "number", description: "Protein in grams." },
                    carbsG: { type: "number", description: "Carbohydrates in grams." },
                    fatG: { type: "number", description: "Fat in grams." },
                    fiberG: { type: "number", description: "Fiber in grams." },
                    sugarG: { type: "number", description: "Sugar in grams." },
                    sodiumMg: { type: "number", description: "Sodium in milligrams." },
                    mealType: { type: "string", enum: ["BREAKFAST", "LUNCH", "DINNER", "SNACK"], description: "Which meal this item belongs to, inferred from the message; default SNACK." },
                },
                required: ["description", "calories", "proteinG", "carbsG", "fatG"],
            },
        },
        waterMl: { type: "number", description: "Total plain water the user said they drank, in millilitres. 0 or omit if none. Convert other units (oz, cups, L) to ml. Do NOT count coffee/tea/other drinks here — those are foods." },
    },
    required: ["foods"],
};

const CHAT_SYSTEM_PROMPT = `You are a precise registered dietitian logging a user's food/drink diary from a casual chat message.
Rules:
- Extract every distinct food and drink the user says they ate or drank into "foods".
- Estimate realistic per-serving nutrition (USDA-style). Macros must be consistent with calories (protein 4, carbs 4, fat 9 kcal/g).
- Infer a sensible mealType per item from context (e.g. "for breakfast", "coffee in the morning" → BREAKFAST). Default to SNACK when unclear.
- If the user mentions drinking PLAIN WATER, sum it into "waterMl" in millilitres (convert oz/cups/litres). Coffee, tea, juice, soda, milk, alcohol etc. are foods, NOT water.
- Return ONLY data matching the provided JSON schema. Do not invent items not mentioned.`;

const SYSTEM_PROMPT = `You are a precise registered dietitian and nutritionist. Estimate nutrition facts for the foods described or shown.
Rules:
- Break the meal into individual food/drink items.
- For each item, estimate realistic per-serving values based on standard nutrition databases (USDA-style).
- Macros must be internally consistent with calories (roughly: protein 4 kcal/g, carbs 4 kcal/g, fat 9 kcal/g).
- Prefer grams or common household units (cup, tbsp, piece, slice) for the unit.
- When portion size is ambiguous, assume a typical single serving and reflect that in quantity/unit.
- Return ONLY data matching the provided JSON schema. Do not invent items that are not described or visible.`;

interface RawSchema {
    items?: AnalyzedItem[];
}

function normalizeItems(items: AnalyzedItem[] | undefined): AnalyzedItem[] {
    if (!Array.isArray(items)) return [];
    return items
        .filter((i) => i && typeof i.description === "string" && i.description.trim().length > 0)
        .map((i) => ({
            description: i.description.trim(),
            quantity: typeof i.quantity === "number" ? i.quantity : null,
            unit: typeof i.unit === "string" && i.unit.trim() ? i.unit.trim() : null,
            calories: typeof i.calories === "number" ? i.calories : null,
            proteinG: typeof i.proteinG === "number" ? i.proteinG : null,
            carbsG: typeof i.carbsG === "number" ? i.carbsG : null,
            fatG: typeof i.fatG === "number" ? i.fatG : null,
            fiberG: typeof i.fiberG === "number" ? i.fiberG : null,
            sugarG: typeof i.sugarG === "number" ? i.sugarG : null,
            sodiumMg: typeof i.sodiumMg === "number" ? i.sodiumMg : null,
            mealType: typeof i.mealType === "string" && i.mealType.trim() ? i.mealType.trim().toUpperCase() : null,
        }));
}

interface ChatRawSchema {
    foods?: AnalyzedItem[];
    waterMl?: number;
}

/** Free-text food description → estimated nutrition for an editable confirm modal. */
export async function analyzeFoodText(fd: FormData): Promise<AnalyzeResult> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const description = str(fd, "description");
    if (!description) throw new Error("Describe what you ate first.");

    const settings = await db.settings.findUnique({ where: { userId: user.id } });

    const { data } = await runClaude<RawSchema>({
        purpose: "nutrition-parse",
        userId: user.id,
        system: SYSTEM_PROMPT,
        model: settings?.aiModel ?? undefined,
        schema: NUTRITION_SCHEMA,
        content: `Estimate the nutrition facts for the following food log entry:\n\n"${description}"`,
    });

    const items = normalizeItems(data.items);
    if (items.length === 0) throw new Error("Couldn't identify any foods from that description.");

    return { items, raw: JSON.stringify({ ...data, prompt: description }), prompt: description };
}

/**
 * Chat-style logging: a single free-text message ("2 eggs and a coffee, drank
 * 500ml water") → foods (each with an inferred mealType) + total water (ml), in
 * ONE call. Returned for an editable confirm modal; nothing is persisted here.
 */
export async function analyzeFoodChat(fd: FormData): Promise<AnalyzeResult> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const description = str(fd, "description");
    if (!description) throw new Error("Tell me what you ate or drank first.");

    const defaultMeal = str(fd, "defaultMealType");
    const mealDefault =
        defaultMeal === "BREAKFAST" || defaultMeal === "LUNCH" || defaultMeal === "DINNER" || defaultMeal === "SNACK"
            ? defaultMeal
            : null;
    const waterOnly = str(fd, "waterOnly") === "true";

    const settings = await db.settings.findUnique({ where: { userId: user.id } });

    const hints: string[] = [];
    if (mealDefault) hints.push(`Default meal for items without an explicit meal in the message: ${mealDefault}.`);
    if (waterOnly) hints.push("The user is logging water only — extract plain water into waterMl; foods array should be empty unless they also mention food.");

    const { data } = await runClaude<ChatRawSchema>({
        purpose: "nutrition-chat",
        userId: user.id,
        system: CHAT_SYSTEM_PROMPT,
        model: settings?.aiModel ?? undefined,
        schema: CHAT_SCHEMA,
        content: `Log this diary message:\n\n"${description}"${hints.length ? `\n\nContext:\n- ${hints.join("\n- ")}` : ""}`,
    });

    const items = normalizeItems(data.foods);
    const waterMl = typeof data.waterMl === "number" && data.waterMl > 0 ? Math.round(data.waterMl) : null;
    if (items.length === 0 && !waterMl) throw new Error("Couldn't find any food or water in that message.");

    return { items, waterMl, raw: JSON.stringify({ ...data, prompt: description }), prompt: description };
}

/** Food photo → estimated nutrition. Uploads the image and returns its imageKey. */
export async function analyzeFoodPhoto(fd: FormData): Promise<AnalyzeResult> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const file = fd.get("photo") as File | null;
    if (!file || file.size === 0) throw new Error("Choose a photo first.");

    // Validate, cap, strip metadata, and re-encode before either storage or AI use.
    const stored = await uploadUserRasterImage(user.id, "nutrition", file);
    const imageBase64 = stored.processedBuffer.toString("base64");

    try {
        const settings = await db.settings.findUnique({ where: { userId: user.id } });

        const { data } = await analyzeImage<RawSchema>({
            purpose: "nutrition-photo",
            userId: user.id,
            model: settings?.aiModel ?? undefined,
            schema: NUTRITION_SCHEMA,
            mimeType: "image/webp",
            imageBase64,
            prompt: `${SYSTEM_PROMPT}\n\nIdentify every food and drink visible in this photo and estimate its nutrition facts.`,
        });

        const items = normalizeItems(data.items);
        if (items.length === 0) throw new Error("Couldn't identify any foods in that photo.");

        return { items, raw: JSON.stringify(data), imageKey: stored.fileKey };
    } catch (error) {
        await deleteObject(stored.fileKey).catch(() => {});
        throw error;
    }
}

/** Remove an analyzed photo when the review dialog is cancelled before saving. */
export async function discardPendingFoodPhoto(imageKey: string) {
    const user = await requireUser();
    assertUserUploadKey(user.id, "nutrition", imageKey);
    const linked = await db.foodEntry.findFirst({
        where: { imageKey, meal: { day: { userId: user.id } } },
        select: { id: true },
    });
    if (!linked) await deleteObject(imageKey).catch(() => {});
}

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

/**
 * Persist the (possibly edited) analyzed items as FoodEntries on the chosen meal.
 * The client submits the reviewed values as `items` (JSON), plus date/mealType and
 * the stored `raw` response and optional `imageKey`.
 */
export async function saveAnalyzedEntries(fd: FormData) {
    const user = await requireUser();

    const date = parseDateOnly(str(fd, "date"));
    const mealType = parseMealType(str(fd, "mealType"));
    const imageKey = str(fd, "imageKey");
    if (imageKey) assertUserUploadKey(user.id, "nutrition", imageKey);
    const raw = str(fd, "raw");

    let items: AnalyzedItem[] = [];
    try {
        const parsed = JSON.parse(str(fd, "items") ?? "[]");
        items = normalizeItems(Array.isArray(parsed) ? parsed : []);
    } catch {
        throw new Error("Invalid items payload.");
    }
    if (items.length === 0) throw new Error("Nothing to save.");

    const rawJson: unknown = raw ? safeJson(raw) : null;

    const day = await getOrCreateDay(user.id, date);
    let meal = await db.meal.findFirst({ where: { dayId: day.id, mealType } });
    if (!meal) meal = await db.meal.create({ data: { dayId: day.id, mealType } });

    await db.foodEntry.createMany({
        data: items.map((i) => ({
            mealId: meal!.id,
            description: i.description,
            quantity: i.quantity ?? null,
            unit: i.unit ?? null,
            calories: i.calories ?? null,
            proteinG: i.proteinG ?? null,
            carbsG: i.carbsG ?? null,
            fatG: i.fatG ?? null,
            fiberG: i.fiberG ?? null,
            sugarG: i.sugarG ?? null,
            sodiumMg: i.sodiumMg ?? null,
            aiAnalyzed: true,
            aiRawResponse: rawJson === null ? undefined : (rawJson as object),
            ...(imageKey ? { imageKey } : {}),
        })),
    });

    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
    revalidatePath("/health");
}

/**
 * Chat-logging save: routes each food to its OWN meal (item.mealType, falling
 * back to `defaultMealType`) and adds the reviewed water amount (ml) to the day's
 * water log. Foods are tagged aiAnalyzed with the raw response (incl. the
 * original prompt) for provenance. Items + waterMl come reviewed from the modal.
 */
export async function saveChatEntries(fd: FormData) {
    const user = await requireUser();

    const date = parseDateOnly(str(fd, "date"));
    const defaultMealType = parseMealType(str(fd, "defaultMealType"));
    const raw = str(fd, "raw");
    const waterMl = (() => {
        const n = Number(str(fd, "waterMl") ?? "");
        return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    })();

    let items: AnalyzedItem[] = [];
    try {
        const parsed = JSON.parse(str(fd, "items") ?? "[]");
        items = normalizeItems(Array.isArray(parsed) ? parsed : []);
    } catch {
        throw new Error("Invalid items payload.");
    }
    if (items.length === 0 && waterMl <= 0) throw new Error("Nothing to save.");

    const rawJson: unknown = raw ? safeJson(raw) : null;

    if (items.length > 0) {
        const day = await getOrCreateDay(user.id, date);

        // Group items by their (per-item) meal type so each lands in the right meal.
        const byMeal = new Map<MealType, AnalyzedItem[]>();
        for (const i of items) {
            const key = i.mealType ? parseMealType(i.mealType) : defaultMealType;
            const list = byMeal.get(key) ?? [];
            list.push(i);
            byMeal.set(key, list);
        }

        for (const [mealType, mealItems] of byMeal) {
            let meal = await db.meal.findFirst({ where: { dayId: day.id, mealType } });
            if (!meal) meal = await db.meal.create({ data: { dayId: day.id, mealType } });
            await db.foodEntry.createMany({
                data: mealItems.map((i) => ({
                    mealId: meal!.id,
                    description: i.description,
                    quantity: i.quantity ?? null,
                    unit: i.unit ?? null,
                    calories: i.calories ?? null,
                    proteinG: i.proteinG ?? null,
                    carbsG: i.carbsG ?? null,
                    fatG: i.fatG ?? null,
                    fiberG: i.fiberG ?? null,
                    sugarG: i.sugarG ?? null,
                    sodiumMg: i.sodiumMg ?? null,
                    aiAnalyzed: true,
                    aiRawResponse: rawJson === null ? undefined : (rawJson as object),
                })),
            });
        }
    }

    if (waterMl > 0) {
        const existing = await db.waterLog.findUnique({ where: { userId_date: { userId: user.id, date } } });
        await db.waterLog.upsert({
            where: { userId_date: { userId: user.id, date } },
            create: { userId: user.id, date, amountMl: waterMl },
            update: { amountMl: (existing?.amountMl ?? 0) + waterMl },
        });
    }

    revalidatePath("/nutrition");
    revalidatePath("/health/nutrition");
    revalidatePath("/health");
}

function safeJson(s: string): unknown {
    try {
        return JSON.parse(s);
    } catch {
        return s;
    }
}
