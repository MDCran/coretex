// @ts-nocheck
"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../db/prisma.js";
import { requireUser } from "@/lib/auth";
import { setDeductibleMarker } from "@/lib/financial/deductions";

/** Toggle a transaction's tax-deductible status (and optional deduction category). */
export async function setTransactionDeductible(id: string, deductible: boolean, category: string | null) {
    const user = await requireUser();
    const txn = await db.finTransaction.findFirst({ where: { id, userId: user.id }, select: { notes: true } });
    if (!txn) throw new Error("Transaction not found");
    await db.finTransaction.update({ where: { id }, data: { notes: setDeductibleMarker(txn.notes, deductible, category) } });
    revalidatePath("/financial/deductions");
    revalidatePath("/financial/tax");
}
