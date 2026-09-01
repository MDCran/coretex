/**
 * Macro color-coding helper for LifeOS nutrition surfaces.
 *
 * Each macro maps to a set of Tailwind class fragments built on the project's
 * `utility-*` color scale (e.g. `--color-utility-blue-500`). These are data-only
 * fragments — compose them into swatches, progress bars, chips, and soft tints.
 *
 *  - `dot`  → a `bg-*` class for a small solid swatch/legend dot
 *  - `text` → a readable `text-*` class for labels/values on a light surface
 *  - `bar`  → a `bg-*` class for a progress-bar fill
 *  - `soft` → a subtle `bg-*` tint for backgrounds/chips
 */
export type MacroKey = "calories" | "protein" | "carbs" | "fat" | "fiber" | "water";

export interface MacroColor {
    /** Solid background for a legend/swatch dot. */
    dot: string;
    /** Readable text color on a light surface. */
    text: string;
    /** Solid background for a progress-bar fill. */
    bar: string;
    /** Subtle background tint (chips, row highlights). */
    soft: string;
}

export const MACRO_COLORS: Record<MacroKey, MacroColor> = {
    // Calories — brand accent so total energy reads as the primary metric.
    calories: {
        dot: "bg-utility-brand-500",
        text: "text-utility-brand-700",
        bar: "bg-utility-brand-500",
        soft: "bg-utility-brand-50",
    },
    // Protein — blue.
    protein: {
        dot: "bg-utility-blue-500",
        text: "text-utility-blue-700",
        bar: "bg-utility-blue-500",
        soft: "bg-utility-blue-50",
    },
    // Carbs — amber.
    carbs: {
        dot: "bg-utility-amber-500",
        text: "text-utility-amber-700",
        bar: "bg-utility-amber-500",
        soft: "bg-utility-amber-50",
    },
    // Fat — pink (rose family).
    fat: {
        dot: "bg-utility-pink-500",
        text: "text-utility-pink-700",
        bar: "bg-utility-pink-500",
        soft: "bg-utility-pink-50",
    },
    // Fiber — emerald/green.
    fiber: {
        dot: "bg-utility-emerald-500",
        text: "text-utility-emerald-700",
        bar: "bg-utility-emerald-500",
        soft: "bg-utility-emerald-50",
    },
    // Water — sky.
    water: {
        dot: "bg-utility-sky-500",
        text: "text-utility-sky-700",
        bar: "bg-utility-sky-500",
        soft: "bg-utility-sky-50",
    },
};

export type MealKey = "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";

/**
 * Meal color-coding helper — assigns one distinct accent to each of the four
 * meals of the day (breakfast, lunch, dinner, snack) so they read at a glance
 * across timelines, chips, dots, and bars.
 *
 * Built on the project's `utility-*` color scale and intentionally uses families
 * NOT consumed by {@link MACRO_COLORS} (brand/blue/amber/pink/emerald/sky) to
 * avoid confusing meals with macros. Each field is a Tailwind class fragment:
 *
 *  - `text` → readable `text-*` label/value color on a light surface
 *  - `dot`  → solid `bg-*` for a legend/swatch dot
 *  - `bar`  → solid `bg-*` for a progress/timeline bar fill
 *  - `soft` → subtle `bg-*` tint for chip/row backgrounds
 *  - `ring` → `ring-*` for outlined chips/cards
 *  - `icon` → `text-*` for accent icons
 */
export const MEAL_COLORS: Record<MealKey, { text: string; dot: string; bar: string; soft: string; ring: string; icon: string }> = {
    // Breakfast — orange (warm, morning).
    BREAKFAST: {
        text: "text-utility-orange-700",
        dot: "bg-utility-orange-500",
        bar: "bg-utility-orange-500",
        soft: "bg-utility-orange-50",
        ring: "ring-utility-orange-200",
        icon: "text-utility-orange-600",
    },
    // Lunch — green (midday).
    LUNCH: {
        text: "text-utility-green-700",
        dot: "bg-utility-green-500",
        bar: "bg-utility-green-500",
        soft: "bg-utility-green-50",
        ring: "ring-utility-green-200",
        icon: "text-utility-green-600",
    },
    // Dinner — indigo (evening).
    DINNER: {
        text: "text-utility-indigo-700",
        dot: "bg-utility-indigo-500",
        bar: "bg-utility-indigo-500",
        soft: "bg-utility-indigo-50",
        ring: "ring-utility-indigo-200",
        icon: "text-utility-indigo-600",
    },
    // Snack — fuchsia (kept clearly distinct from dinner's indigo).
    SNACK: {
        text: "text-utility-fuchsia-700",
        dot: "bg-utility-fuchsia-500",
        bar: "bg-utility-fuchsia-500",
        soft: "bg-utility-fuchsia-50",
        ring: "ring-utility-fuchsia-200",
        icon: "text-utility-fuchsia-600",
    },
};
