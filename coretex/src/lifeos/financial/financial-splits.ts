// @ts-nocheck
"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../db/prisma.js";
import { requireUser } from "@/lib/auth";

export interface SplitInput {
    categoryId: string | null;
    amount: number;
    note?: string | null;
}

/** Replace a transaction's category splits. Pass [] to clear (back to a single category). */
export async function setTransactionSplits(transactionId: string, splits: SplitInput[]) {
    const user = await requireUser();
    const txn = await db.finTransaction.findFirst({ where: { id: transactionId, userId: user.id }, select: { id: true } });
    if (!txn) throw new Error("Transaction not found");

    const clean = splits.filter((s) => Number.isFinite(s.amount) && s.amount !== 0);
    await db.$transaction([
        db.transactionSplit.deleteMany({ where: { transactionId } }),
        ...(clean.length
            ? [db.transactionSplit.createMany({ data: clean.map((s) => ({ transactionId, categoryId: s.categoryId, amount: s.amount, note: s.note ?? null })) })]
            : []),
    ]);

    revalidatePath("/financial/transactions");
    revalidatePath("/financial/budget");
    revalidatePath("/financial");
}
