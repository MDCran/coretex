"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, parseOptionalDateTime, str } from "./financial-shared";

export async function createDebt(fd: FormData) {
    const user = await requireUser();
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    await db.debt.create({
        data: {
            userId: user.id,
            name,
            kind: str(fd, "kind"),
            principalOriginal: num(fd, "principalOriginal"),
            principalRemaining: num(fd, "principalRemaining"),
            apr: num(fd, "apr"),
            minimumPayment: num(fd, "minimumPayment"),
            payoffGoalDate: parseOptionalDateTime(str(fd, "payoffGoalDate")),
            strategy: str(fd, "strategy"),
        },
    });
    revalidatePath("/financial/debt");
    revalidatePath("/financial");
}

export async function updateDebt(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.debt.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    await db.debt.update({
        where: { id },
        data: {
            name,
            kind: str(fd, "kind"),
            principalOriginal: num(fd, "principalOriginal"),
            principalRemaining: num(fd, "principalRemaining"),
            apr: num(fd, "apr"),
            minimumPayment: num(fd, "minimumPayment"),
            payoffGoalDate: parseOptionalDateTime(str(fd, "payoffGoalDate")),
            strategy: str(fd, "strategy"),
        },
    });
    revalidatePath("/financial/debt");
    revalidatePath("/financial");
}

export async function deleteDebt(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.debt.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/financial/debt");
    revalidatePath("/financial");
}
