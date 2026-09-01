// @ts-nocheck
// import "server-only";

import { db } from "../../db/prisma.js";
import { DEFAULT_CATEGORY_COLORS, DEFAULT_CATEGORY_NAMES, GENERIC_TOTAL_CATEGORY } from "./category-data.js";

/**
 * Seed the default budget category set the first time a user has none. Safe to call
 * during a server-component render (does NOT call revalidatePath). Idempotent:
 * only seeds when the user has zero non-reserved categories.
 */
export async function seedDefaultCategoriesIfEmpty(userId: string): Promise<number> {
    const count = await db.budgetCategory.count({ where: { userId, NOT: { name: GENERIC_TOTAL_CATEGORY } } });
    if (count > 0) return 0;
    const result = await db.budgetCategory.createMany({
        data: DEFAULT_CATEGORY_NAMES.map((name) => ({ userId, name, color: DEFAULT_CATEGORY_COLORS[name] ?? null })),
        skipDuplicates: true,
    });
    return result.count;
}

/** One-time backfill: assign default colors to seeded categories that have none. */
export async function backfillCategoryColors(userId: string): Promise<number> {
    const missing = await db.budgetCategory.findMany({
        where: { userId, color: null, NOT: { name: GENERIC_TOTAL_CATEGORY } },
        select: { id: true, name: true },
    });
    if (missing.length === 0) return 0;
    let updated = 0;
    for (const cat of missing) {
        const color = DEFAULT_CATEGORY_COLORS[cat.name];
        if (!color) continue;
        await db.budgetCategory.update({ where: { id: cat.id }, data: { color } });
        updated++;
    }
    return updated;
}
