// @ts-nocheck
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "../../db/prisma.js";
import { num, parseOptionalDateTime, str } from "./financial-shared.js";

export async function createGoal(fd: FormData) {
    const user = await requireUser();
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    await db.financialGoal.create({
        data: {
            userId: user.id,
            title,
            targetAmount: num(fd, "targetAmount"),
            currentAmount: num(fd, "currentAmount") ?? 0,
            targetDate: parseOptionalDateTime(str(fd, "targetDate")),
        },
    });
    revalidatePath("/financial/goals");
    revalidatePath("/financial");
}

export async function updateGoal(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.financialGoal.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    await db.financialGoal.update({
        where: { id },
        data: {
            title,
            targetAmount: num(fd, "targetAmount"),
            currentAmount: num(fd, "currentAmount") ?? existing.currentAmount,
            targetDate: parseOptionalDateTime(str(fd, "targetDate")),
        },
    });
    revalidatePath("/financial/goals");
    revalidatePath("/financial");
}

/** Quick add-contribution: increments currentAmount. */
export async function contributeToGoal(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.financialGoal.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const amount = num(fd, "amount");
    if (amount === null) throw new Error("Amount is required");
    await db.financialGoal.update({
        where: { id },
        data: { currentAmount: Number(existing.currentAmount) + amount },
    });
    revalidatePath("/financial/goals");
    revalidatePath("/financial");
}

export async function deleteGoal(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.financialGoal.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/financial/goals");
    revalidatePath("/financial");
}
