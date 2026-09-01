// @ts-nocheck






import { Zap, Plus } from "@untitledui/icons";
import { db } from "@/lib/db";
import { ModuleHero } from "@/components/app-shell/module-hero";
import { LiveRefresh } from "@/components/app-shell/live-refresh";
import { NutritionClient, type DaySummary, type EntryRow, type MealGroup, type ProductRow, type SavedMealRow } from "./nutrition-client";

function mapEntry(e: any): EntryRow {
    return {
        id: e.id,
        description: e.description,
        servingSize: e.servingSize,
        quantity: e.quantity,
        unit: e.unit,
        calories: e.calories,
        proteinG: e.proteinG,
        carbsG: e.carbsG,
        fatG: e.fatG,
        fiberG: e.fiberG,
        sugarG: e.sugarG,
        sodiumMg: e.sodiumMg,
        cholesterolMg: e.cholesterolMg,
        saturatedFatG: e.saturatedFatG,
        transFatG: e.transFatG,
        potassiumMg: e.potassiumMg,
        isFavorite: e.isFavorite,
        aiAnalyzed: e.aiAnalyzed ?? false,
        imageUrl: e.imageKey ? fileUrl(e.imageKey) : null,
        // Original text prompt captured at parse time, surfaced in the AI info popover.
        aiPrompt: extractAiPrompt(e.aiRawResponse),
    };
}

/** Pull the original free-text prompt out of a stored aiRawResponse JSON blob. */
function extractAiPrompt(raw: unknown): string | null {
    if (raw && typeof raw === "object" && "prompt" in raw) {
        const p = (raw as { prompt?: unknown }).prompt;
        if (typeof p === "string" && p.trim()) return p.trim();
    }
    return null;
}

export default async function NutritionPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
    const user = await requireUser();
    const sp = await searchParams;
    const dateStr = sp.date ?? new Date().toISOString().slice(0, 10);
    const date = parseDateOnly(dateStr);

    // Month window for the calendar grid (UTC), based on the active day.
    const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));

    const [day, water, goal, products, savedMeals, profile, favoriteEntries, settings, monthSummaries] = await Promise.all([
        db.nutritionDay.findUnique({
            where: { userId_date: { userId: user.id, date } },
            include: { meals: { include: { entries: { orderBy: { order: "asc" } } } } },
        }),
        db.waterLog.findUnique({ where: { userId_date: { userId: user.id, date } } }),
        db.nutritionGoal.findUnique({ where: { userId: user.id } }),
        db.foodProduct.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
        db.savedMeal.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, include: { _count: { select: { items: true } } } }),
        db.userProfile.findUnique({ where: { userId: user.id } }),
        db.foodEntry.findMany({ where: { isFavorite: true, meal: { day: { userId: user.id } } }, orderBy: { updatedAt: "desc" }, take: 12, distinct: ["description"] }),
        db.settings.findUnique({ where: { userId: user.id } }),
        getNutritionDaySummaries(user.id, monthStart, monthEnd),
    ]);

    const meals: MealGroup[] = (day?.meals ?? []).map((m) => ({ mealType: m.mealType, entries: m.entries.map(mapEntry) }));

    const productRows: ProductRow[] = products.map((p) => ({ id: p.id, name: p.name, quantity: p.quantity, unit: p.unit, calories: p.calories, proteinG: p.proteinG, carbsG: p.carbsG, fatG: p.fatG, barcode: p.barcode }));
    const savedMealRows: SavedMealRow[] = savedMeals.map((s) => ({ id: s.id, name: s.name, mealType: s.mealType, itemCount: s._count.items }));

    return (
        <div className="flex flex-col gap-6">
            <LiveRefresh intervalMs={600000} />
            <ModuleHero
                theme="amber"
                icon={Zap}
                eyebrow="Fuel your day"
                title="Track your nutrition"
                description="Snap a photo or describe a meal and let AI log the macros — then keep an eye on calories, protein and water."
                actions={[{ label: "Log a meal", href: "#nutrition-quick-log", icon: Plus }]}
            />
            <NutritionClient
                date={dateStr}
            meals={meals}
            water={water?.amountMl ?? 0}
            waterGoalMl={profile?.waterGoalMl ?? 2500}
            goal={{ calories: goal?.calories ?? null, proteinG: goal?.proteinG ?? null, carbsG: goal?.carbsG ?? null, fatG: goal?.fatG ?? null, fiberG: goal?.fiberG ?? null }}
            // The /health/goals calculator is the only writer of these profile
            // fields, so their presence (plus a saved goal) marks the targets
            // as calculator-derived.
            goalFromCalculator={Boolean(goal && (profile?.activityLevel || profile?.dietGoal))}
            products={productRows}
            savedMeals={savedMealRows}
            favorites={favoriteEntries.map(mapEntry)}
            unitSystem={settings?.unitSystem ?? "IMPERIAL"}
            aiConfigured={aiConfigured()}
                month={{ year: date.getUTCFullYear(), month: date.getUTCMonth(), days: monthSummaries as DaySummary[] }}
            />
        </div>
    );
}
