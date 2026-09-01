import type { ReactNode } from "react";
import { cx } from "@/utils/cx";

export interface NutritionFacts {
    calories: number | null;
    servings?: number;
    servingLabel?: string;
    totalFatG?: number | null;
    satFatG?: number | null;
    transFatG?: number | null;
    cholesterolMg?: number | null;
    sodiumMg?: number | null;
    carbsG?: number | null;
    fiberG?: number | null;
    sugarG?: number | null;
    proteinG?: number | null;
    potassiumMg?: number | null;
}

export interface NutritionFactsLabelProps {
    facts: NutritionFacts;
    title?: string;
    className?: string;
    /**
     * Optional accent fragment (a color class such as `bg-*`, `border-*`, or `ring-*`). When
     * provided, a thin colored bar is rendered above the title so a per-meal panel can carry
     * that meal's color. The panel otherwise stays a pure black/white nutrition sheet.
     */
    accentClassName?: string;
}

const has = (v: number | null | undefined): v is number => v !== null && v !== undefined;

/** Format a number, dropping trailing ".0" so 12.0 → "12" but 12.5 → "12.5". */
function fmt(v: number): string {
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

/**
 * A single nutrient line. `indent` shifts the name to mimic the FDA panel's
 * sub-nutrient indentation; `bold` is used for primary nutrient rows.
 */
function NutrientRow({
    name,
    value,
    unit,
    indent = false,
    bold = false,
    divider = true,
}: {
    name: string;
    value: number;
    unit: string;
    indent?: boolean;
    bold?: boolean;
    divider?: boolean;
}) {
    return (
        <div className={cx("flex items-baseline justify-between py-0.5 text-sm text-primary", divider && "border-b border-secondary")}>
            <span className={cx(indent && "pl-4", bold ? "font-bold" : "font-normal")}>{name}</span>
            <span className={cx("tabular-nums", bold ? "font-bold" : "font-semibold")}>
                {fmt(value)}
                {unit}
            </span>
        </div>
    );
}

/**
 * A faithful, presentational FDA "Nutrition Facts" panel. Pure/server-safe.
 *
 * Uses semantic tokens (text-primary / border-primary) for the heavy black rules so
 * the panel inverts cleanly in dark mode. Rows whose value is null/undefined are omitted.
 */
export function NutritionFactsLabel({ facts, title = "Nutrition Facts", className, accentClassName }: NutritionFactsLabelProps): ReactNode {
    const { calories, servings, servingLabel, totalFatG, satFatG, transFatG, cholesterolMg, sodiumMg, carbsG, fiberG, sugarG, proteinG, potassiumMg } =
        facts;

    return (
        <section
            className={cx(
                "max-w-sm overflow-hidden rounded-2xl bg-primary p-4 font-sans text-primary ring-1 ring-secondary ring-inset",
                className,
            )}
            aria-label={title}
        >
            {/* Optional per-meal accent stripe (color-coding only; panel stays B/W otherwise). */}
            {accentClassName && <div className={cx("-mx-4 -mt-4 mb-3 h-[2px] w-[calc(100%+2rem)]", accentClassName)} aria-hidden="true" />}

            {/* Title */}
            <h2 className="text-2xl leading-none font-extrabold tracking-tight">{title}</h2>

            {/* Servings */}
            {(has(servings) || servingLabel) && (
                <p className="mt-1 text-sm text-primary">
                    {has(servings) && (
                        <span className="font-semibold tabular-nums">
                            {fmt(servings)} serving{servings === 1 ? "" : "s"} per container
                        </span>
                    )}
                    {servingLabel && (
                        <span className="mt-0.5 flex items-baseline justify-between font-bold">
                            <span>Serving size</span>
                            <span>{servingLabel}</span>
                        </span>
                    )}
                </p>
            )}

            {/* Heavy rule under the header block */}
            <div className="mt-1 border-t-8 border-primary" />

            {/* Calories — the oversized hero number */}
            <div className="flex items-end justify-between py-1">
                <div className="leading-tight">
                    <p className="text-xs font-bold text-primary">Amount per serving</p>
                    <p className="text-3xl leading-none font-extrabold">Calories</p>
                </div>
                <p className="text-4xl leading-none font-extrabold tabular-nums">{has(calories) ? fmt(calories) : "—"}</p>
            </div>

            {/* Medium rule before nutrient table */}
            <div className="border-t-4 border-primary" />

            {/* % Daily Value caption */}
            <p className="border-b border-secondary py-0.5 text-right text-xs font-bold text-primary">% Daily Value*</p>

            {/* Nutrient rows */}
            {has(totalFatG) && <NutrientRow name="Total Fat" value={totalFatG} unit="g" bold />}
            {has(satFatG) && <NutrientRow name="Saturated Fat" value={satFatG} unit="g" indent />}
            {has(transFatG) && <NutrientRow name="Trans Fat" value={transFatG} unit="g" indent />}
            {has(cholesterolMg) && <NutrientRow name="Cholesterol" value={cholesterolMg} unit="mg" bold />}
            {has(sodiumMg) && <NutrientRow name="Sodium" value={sodiumMg} unit="mg" bold />}
            {has(carbsG) && <NutrientRow name="Total Carbohydrate" value={carbsG} unit="g" bold />}
            {has(fiberG) && <NutrientRow name="Dietary Fiber" value={fiberG} unit="g" indent />}
            {has(sugarG) && <NutrientRow name="Total Sugars" value={sugarG} unit="g" indent />}

            {/* Heavy rule between carbs/protein groups, mirroring the real panel */}
            {has(proteinG) && (
                <>
                    <div className="border-t-4 border-primary" />
                    <NutrientRow name="Protein" value={proteinG} unit="g" bold divider={false} />
                </>
            )}

            {/* Potassium sits below a heavy rule in the micronutrient block */}
            {has(potassiumMg) && (
                <>
                    <div className="border-t-8 border-primary" />
                    <NutrientRow name="Potassium" value={potassiumMg} unit="mg" divider={false} />
                </>
            )}

            {/* Footnote */}
            <div className="mt-1 border-t-4 border-primary pt-1">
                <p className="text-[10px] leading-snug text-tertiary">
                    * The % Daily Value (DV) tells you how much a nutrient in a serving of food contributes to a daily diet. 2,000 calories a day is
                    used for general nutrition advice.
                </p>
            </div>
        </section>
    );
}
