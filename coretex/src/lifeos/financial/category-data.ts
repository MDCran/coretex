// @ts-nocheck
/** Server-safe budget category data (no React/icon imports). */

/** The ~24 default category names seeded on a user's first budget visit. */
export const DEFAULT_CATEGORY_NAMES: string[] = [
    "Housing",
    "Rent/Mortgage",
    "Utilities",
    "Groceries",
    "Dining Out",
    "Coffee",
    "Transportation",
    "Gas",
    "Car",
    "Insurance",
    "Health",
    "Fitness",
    "Subscriptions",
    "Entertainment",
    "Shopping",
    "Clothing",
    "Travel",
    "Education",
    "Gifts",
    "Pets",
    "Personal Care",
    "Phone/Internet",
    "Savings",
    "Misc",
];

/**
 * GENERIC budget mode: a single monthly total is stored as a special
 * BudgetCategory with this reserved name (no schema change). When present, the
 * budget page can run in "generic total" mode; otherwise per-category mode.
 * The reserved category is hidden from the normal category list/UI.
 */
export const GENERIC_TOTAL_CATEGORY = "__total__";

/** Default hex colors for seeded categories (matches budget PALETTE). */
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
};
