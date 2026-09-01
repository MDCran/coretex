// @ts-nocheck

import type { FC } from "react";
import {
    Activity,
    Beaker02,
    Bus,
    Car01,
    CreditCard01,
    DotsHorizontal,
    Droplets01,
    Film01,
    Gift01,
    GraduationHat01,
    Heart,
    HelpCircle,
    Home01,
    Home02,
    Lightning02,
    MedicalCross,
    PiggyBank01,
    Plane,
    Receipt,
    Scissors01,
    ShoppingBag01,
    ShoppingCart01,
    Tag01,
    Tag02,
    Umbrella01,
    Wifi,
} from "@untitledui/icons";

/**
 * BudgetCategory has no `icon` column, so we map icons to categories BY NAME on
 * the client. Default seeded categories all resolve to a curated icon; user-created
 * categories fall back to a tag icon. Lookup is case-insensitive and tolerant of
 * separators ("Phone/Internet" → "phone internet").
 */

/** Component map keyed by the registry name string. */
export const CATEGORY_ICON_COMPONENTS: Record<string, FC<{ className?: string }>> = {
    Home01,
    Home02,
    Lightning02,
    ShoppingCart01,
    Receipt,
    Beaker02,
    Bus,
    Droplets01,
    Car01,
    Umbrella01,
    MedicalCross,
    Activity,
    CreditCard01,
    Film01,
    ShoppingBag01,
    Tag02,
    Plane,
    GraduationHat01,
    Gift01,
    Heart,
    Scissors01,
    Wifi,
    PiggyBank01,
    Tag01,
    HelpCircle,
    DotsHorizontal,
};

const FALLBACK_ICON = "Tag01";

/** Normalize a category name for matching (lowercase, separators → spaces). */
function norm(name: string): string {
    return name.toLowerCase().replace(/[/&,]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Maps a (normalized) category name to a registry icon name. */
const NAME_TO_ICON: Record<string, string> = {
    housing: "Home01",
    "rent mortgage": "Home02",
    rent: "Home02",
    mortgage: "Home02",
    utilities: "Lightning02",
    groceries: "ShoppingCart01",
    "dining out": "Receipt",
    dining: "Receipt",
    coffee: "Beaker02",
    transportation: "Bus",
    transport: "Bus",
    gas: "Droplets01",
    fuel: "Droplets01",
    car: "Car01",
    auto: "Car01",
    insurance: "Umbrella01",
    health: "MedicalCross",
    medical: "MedicalCross",
    fitness: "Activity",
    gym: "Activity",
    subscriptions: "CreditCard01",
    subscription: "CreditCard01",
    entertainment: "Film01",
    shopping: "ShoppingBag01",
    clothing: "Tag02",
    clothes: "Tag02",
    travel: "Plane",
    education: "GraduationHat01",
    gifts: "Gift01",
    gift: "Gift01",
    pets: "Heart",
    pet: "Heart",
    "personal care": "Scissors01",
    "phone internet": "Wifi",
    phone: "Wifi",
    internet: "Wifi",
    savings: "PiggyBank01",
    misc: "DotsHorizontal",
    miscellaneous: "DotsHorizontal",
    other: "DotsHorizontal",
    uncategorized: "HelpCircle",
};

/** Resolve a category name to its icon registry name string. */
export function categoryIconName(name: string | null | undefined): string {
    if (!name) return FALLBACK_ICON;
    return NAME_TO_ICON[norm(name)] ?? FALLBACK_ICON;
}

/** Resolve a category name directly to its icon component. */
export function categoryIcon(name: string | null | undefined): FC<{ className?: string }> {
    return CATEGORY_ICON_COMPONENTS[categoryIconName(name)] ?? CATEGORY_ICON_COMPONENTS[FALLBACK_ICON];
}

/** Default hex colors for seeded categories (matches budget palette / server seed). */
export const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
    Housing: "#7C3AED",
    "Rent/Mortgage": "#8B5CF6",
    Utilities: "#F97316",
    Groceries: "#22C55E",
    "Dining Out": "#EF4444",
    Coffee: "#EAB308",
    Transportation: "#3B82F6",
    Gas: "#06B6D4",
    Car: "#14B8A6",
    Insurance: "#6B7280",
    Health: "#EC4899",
    Fitness: "#F43F5E",
    Subscriptions: "#7C3AED",
    Entertainment: "#EC4899",
    Shopping: "#3B82F6",
    Clothing: "#8B5CF6",
    Travel: "#06B6D4",
    Education: "#22C55E",
    Gifts: "#EAB308",
    Pets: "#F97316",
    "Personal Care": "#F43F5E",
    "Phone/Internet": "#3B82F6",
    Savings: "#14B8A6",
    Misc: "#6B7280",
    Uncategorized: "#6B7280",
};

/** Resolve a display color for a category: explicit value wins, then seeded defaults. */
export function categoryColor(name: string | null | undefined, explicit?: string | null): string | null {
    if (explicit) return explicit;
    if (!name) return DEFAULT_CATEGORY_COLORS.Uncategorized;
    if (DEFAULT_CATEGORY_COLORS[name]) return DEFAULT_CATEGORY_COLORS[name];
    // Case-insensitive / separator-tolerant fallback
    const key = Object.keys(DEFAULT_CATEGORY_COLORS).find((k) => norm(k) === norm(name));
    return key ? DEFAULT_CATEGORY_COLORS[key] : null;
}
