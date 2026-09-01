"use client";

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
 * the client. Default seeded categories (see DEFAULT_CATEGORIES) all resolve to a
 * curated icon; user-created categories fall back to a tag icon. Lookup is
 * case-insensitive and tolerant of separators ("Phone/Internet" → "phone internet").
 */

/** Component map keyed by the registry name string (safe across the RSC boundary). */
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

export interface DefaultCategory {
    name: string;
    icon: string;
}

/** The ~24 default categories seeded on a user's first budget visit. */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
    { name: "Housing", icon: "Home01" },
    { name: "Rent/Mortgage", icon: "Home02" },
    { name: "Utilities", icon: "Lightning02" },
    { name: "Groceries", icon: "ShoppingCart01" },
    { name: "Dining Out", icon: "Receipt" },
    { name: "Coffee", icon: "Beaker02" },
    { name: "Transportation", icon: "Bus" },
    { name: "Gas", icon: "Droplets01" },
    { name: "Car", icon: "Car01" },
    { name: "Insurance", icon: "Umbrella01" },
    { name: "Health", icon: "MedicalCross" },
    { name: "Fitness", icon: "Activity" },
    { name: "Subscriptions", icon: "CreditCard01" },
    { name: "Entertainment", icon: "Film01" },
    { name: "Shopping", icon: "ShoppingBag01" },
    { name: "Clothing", icon: "Tag02" },
    { name: "Travel", icon: "Plane" },
    { name: "Education", icon: "GraduationHat01" },
    { name: "Gifts", icon: "Gift01" },
    { name: "Pets", icon: "Heart" },
    { name: "Personal Care", icon: "Scissors01" },
    { name: "Phone/Internet", icon: "Wifi" },
    { name: "Savings", icon: "PiggyBank01" },
    { name: "Misc", icon: "DotsHorizontal" },
];

/** Plain list of default category names (server-safe usage via this client file is fine for data). */
export const DEFAULT_CATEGORY_NAMES: string[] = DEFAULT_CATEGORIES.map((c) => c.name);
