// @ts-nocheck

import { cx } from "@/utils/cx";
import type { EntryRow, MealGroup } from "../nutrition-client";
import { NutritionFacts, NutritionFactsLabel } from "@/components/nutrition/nutrition-facts-label";
import { RichSelect } from "@/components/base/select/rich-select";
import { useMemo, useState } from "react";

const MEAL_LABEL: Record<string, string> = { BREAKFAST: "Breakfast", LUNCH: "Lunch", DINNER: "Dinner", SNACK: "Snack" };
const mealLabel = (mt: string) => MEAL_LABEL[mt] ?? mt.charAt(0) + mt.slice(1).toLowerCase();

const num = (n: number | null | undefined) => (typeof n === "number" ? n : 0);
const sumKey = (entries: EntryRow[], k: keyof EntryRow) => entries.reduce((a, e) => a + num(e[k] as number | null), 0);
const round = (n: number) => Math.round(n * 10) / 10;

function toFacts(entries: EntryRow[], servingLabel: string): NutritionFacts {
    return {
        calories: Math.round(sumKey(entries, "calories")),
        servings: entries.length,
        servingLabel,
        totalFatG: round(sumKey(entries, "fatG")),
        satFatG: round(sumKey(entries, "saturatedFatG")),
        transFatG: round(sumKey(entries, "transFatG")),
        cholesterolMg: Math.round(sumKey(entries, "cholesterolMg")),
        sodiumMg: Math.round(sumKey(entries, "sodiumMg")),
        carbsG: round(sumKey(entries, "carbsG")),
        fiberG: round(sumKey(entries, "fiberG")),
        sugarG: round(sumKey(entries, "sugarG")),
        proteinG: round(sumKey(entries, "proteinG")),
        potassiumMg: Math.round(sumKey(entries, "potassiumMg")),
    };
}

/**
 * Macro breakdown rows for the color-coded RIGHT column. Calories is shown as a
 * headline metric; the gram macros (protein/carbs/fat/fiber) get proportional bars.
 */
const MACRO_ROWS: { key: MacroKey; label: string; field: keyof EntryRow; unit: string }[] = [
    { key: "calories", label: "Calories", field: "calories", unit: "" },
    { key: "protein", label: "Protein", field: "proteinG", unit: "g" },
    { key: "carbs", label: "Carbs", field: "carbsG", unit: "g" },
    { key: "fat", label: "Fat", field: "fatG", unit: "g" },
    { key: "fiber", label: "Fiber", field: "fiberG", unit: "g" },
];

/** The gram macros that share a proportional-bar scale (calories is excluded — different unit). */
const GRAM_MACROS: MacroKey[] = ["protein", "carbs", "fat", "fiber"];

const isMealKey = (v: string): v is MealKey => v === "BREAKFAST" || v === "LUNCH" || v === "DINNER" || v === "SNACK";

/**
 * The per-meal accent fragment for the FDA panel's top stripe. We pass the meal's `bar`
 * token (`bg-utility-X-500`) — a literal class the macro-colors module already emits — so
 * the stripe renders as a clean solid colored line. Returns undefined for unknown meals.
 */
function mealAccent(mealType: string): string | undefined {
    return isMealKey(mealType) ? MEAL_COLORS[mealType].bar : undefined;
}

type View = "day" | "meal" | "item";

/**
 * Nutrition Facts workspace with a Day / Meal / Item scope toggle. On large screens it lays
 * out as two columns: the black/white FDA panel (centerpiece) on the left and a color-coded
 * macro breakdown on the right. Per-meal scope tints the panel's top accent stripe.
 */
export function NutritionFactsCard({ meals }: { meals: MealGroup[] }) {
    const allEntries = useMemo(() => meals.flatMap((m) => m.entries), [meals]);
    const itemsFlat = useMemo(
        () => meals.flatMap((m) => m.entries.map((e) => ({ entry: e, mealType: m.mealType }))),
        [meals],
    );

    const [view, setView] = useState<View>("day");
    const [mealType, setMealType] = useState<string>(meals[0]?.mealType ?? "BREAKFAST");
    const [itemId, setItemId] = useState<string>("");

    const entries: EntryRow[] = useMemo(() => {
        if (view === "day") return allEntries;
        if (view === "meal") return meals.find((m) => m.mealType === mealType)?.entries ?? [];
        const found = itemsFlat.find((x) => x.entry.id === itemId);
        return found ? [found.entry] : itemsFlat[0] ? [itemsFlat[0].entry] : [];
    }, [view, mealType, itemId, allEntries, meals, itemsFlat]);

    const servingLabel =
        view === "day" ? "Full day" : view === "meal" ? mealLabel(mealType) : (itemsFlat.find((x) => x.entry.id === itemId)?.entry.description ?? itemsFlat[0]?.entry.description ?? "Item");

    const facts = toFacts(entries, servingLabel);

    // Largest gram macro in the current scope — used to scale the proportional breakdown bars.
    const maxGram = useMemo(
        () =>
            Math.max(
                0,
                ...MACRO_ROWS.filter((m) => GRAM_MACROS.includes(m.key)).map((m) => round(sumKey(entries, m.field))),
            ),
        [entries],
    );

    return (
        <div className="rounded-2xl bg-primary p-5 ring-1 ring-secondary ring-inset sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-md font-semibold text-primary">Nutrition facts</h3>
                <div className="flex rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset">
                    {(["day", "meal", "item"] as const).map((v) => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => setView(v)}
                            className={cx(
                                "cursor-pointer rounded-md px-3 py-1 text-sm font-medium capitalize transition duration-100 ease-linear",
                                view === v ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-tertiary hover:text-secondary",
                            )}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>

            {/* Scope selector */}
            {view === "meal" && meals.length > 0 && (
                <div className="mt-3"><RichSelect
                    aria-label="Nutrition facts meal"
                    value={mealType}
                    onChange={(e) => setMealType(e.target.value)}
                    options={meals.map((meal) => ({ value: meal.mealType, label: `${mealLabel(meal.mealType)} · ${meal.entries.length} item${meal.entries.length === 1 ? "" : "s"}` }))}
                /></div>
            )}
            {view === "item" && itemsFlat.length > 0 && (
                <div className="mt-3"><RichSelect
                    aria-label="Nutrition facts item"
                    value={itemId || itemsFlat[0]?.entry.id || ""}
                    onChange={(e) => setItemId(e.target.value)}
                    options={itemsFlat.map((item) => ({ value: item.entry.id, label: `${item.entry.description} (${mealLabel(item.mealType)})` }))}
                /></div>
            )}

            {allEntries.length === 0 ? (
                <p className="mt-6 text-center text-sm text-tertiary">Log some food to see the nutrition facts.</p>
            ) : (
                <div className="mt-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
                    {/* LEFT — the black/white FDA sheet, the centerpiece. */}
                    <NutritionFactsLabel
                        facts={facts}
                        className="mx-auto lg:mx-0"
                        accentClassName={view === "meal" ? mealAccent(mealType) : undefined}
                    />

                    {/* RIGHT — color-coded macro breakdown. */}
                    <div className="mt-6 lg:mt-0">
                        <h4 className="text-sm font-semibold text-secondary">Macro breakdown</h4>
                        <dl className="mt-3 flex flex-col gap-3.5">
                            {MACRO_ROWS.map((m) => {
                                const c = MACRO_COLORS[m.key];
                                const val = round(sumKey(entries, m.field));
                                // Gram macros share a proportional scale (relative to the largest gram macro);
                                // calories is a headline metric without a bar.
                                const isGram = GRAM_MACROS.includes(m.key);
                                const pct = isGram && maxGram > 0 ? Math.min(100, Math.round((val / maxGram) * 100)) : 0;
                                return (
                                    <div key={m.key}>
                                        <div className="flex items-baseline justify-between gap-3">
                                            <dt className="flex items-center gap-2 text-sm font-medium text-secondary">
                                                <span className={cx("size-2.5 shrink-0 rounded-full", c.dot)} aria-hidden="true" />
                                                {m.label}
                                            </dt>
                                            <dd className={cx("text-sm font-semibold tabular-nums", c.text)}>
                                                {val}
                                                {m.unit}
                                            </dd>
                                        </div>
                                        {isGram && (
                                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-tertiary">
                                                <div
                                                    className={cx("h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:duration-0", c.bar)}
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </dl>
                    </div>
                </div>
            )}
        </div>
    );
}
