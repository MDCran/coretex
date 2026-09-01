// @ts-nocheck
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "../../db/prisma.js";
import { GENERIC_TOTAL_CATEGORY } from "@/lib/financial/category-data";
import { num, str } from "./financial-shared.js";

/**
 * Set (or clear) the GENERIC monthly budget total. Stored without a schema change
 * as a reserved BudgetCategory named "__total__" whose monthlyBudget holds the
 * total. Pass an empty value to switch back to per-category mode.
 */
export async function setGenericBudgetTotal(fd: FormData) {
    const user = await requireUser();
    const total = num(fd, "total");
    if (total === null) {
        await db.budgetCategory.deleteMany({ where: { userId: user.id, name: GENERIC_TOTAL_CATEGORY } });
    } else {
        await db.budgetCategory.upsert({
            where: { userId_name: { userId: user.id, name: GENERIC_TOTAL_CATEGORY } },
            create: { userId: user.id, name: GENERIC_TOTAL_CATEGORY, monthlyBudget: total },
            update: { monthlyBudget: total },
        });
    }
    revalidatePath("/financial/budget");
    revalidatePath("/financial");
}

export async function createBudgetCategory(fd: FormData) {
    const user = await requireUser();
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    if (name === GENERIC_TOTAL_CATEGORY) throw new Error("That name is reserved");
    const parentId = str(fd, "parentId");
    if (parentId) {
        const parent = await db.budgetCategory.findFirst({ where: { id: parentId, userId: user.id } });
        if (!parent) throw new Error("Parent not found");
    }
    const color = str(fd, "color");
    try {
        await db.budgetCategory.create({
            data: { userId: user.id, name, parentId, monthlyBudget: num(fd, "monthlyBudget"), color },
        });
    } catch {
        throw new Error("A category with that name already exists");
    }
    revalidatePath("/financial/budget");
    revalidatePath("/financial/transactions");
    revalidatePath("/financial");
}

export async function updateBudgetCategory(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.budgetCategory.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    if (name === GENERIC_TOTAL_CATEGORY) throw new Error("That name is reserved");
    const parentId = str(fd, "parentId");
    if (parentId === id) throw new Error("A category cannot be its own parent");
    const color = str(fd, "color");
    await db.budgetCategory.update({
        where: { id },
        data: { name, parentId, monthlyBudget: num(fd, "monthlyBudget"), color },
    });
    revalidatePath("/financial/budget");
    revalidatePath("/financial/transactions");
    revalidatePath("/financial");
}

export async function deleteBudgetCategory(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.budgetCategory.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/financial/budget");
    revalidatePath("/financial");
}
