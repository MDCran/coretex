"use server";

import { revalidatePath } from "next/cache";
import type { TransactionSource } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { recomputeOwnerBalance } from "@/lib/financial/balance";
import { num, parseDateOnly, str, transactionDedupHash } from "./financial-shared";

const SOURCES: TransactionSource[] = ["MANUAL", "PLAID", "CSV", "STATEMENT"];
function source(fd: FormData): TransactionSource {
    const v = str(fd, "source");
    return SOURCES.includes(v as TransactionSource) ? (v as TransactionSource) : "MANUAL";
}

/** Validate that an account/card belongs to the user, when provided. */
async function assertOwnership(userId: string, finAccountId: string | null, creditCardId: string | null) {
    if (finAccountId) {
        const a = await db.finAccount.findFirst({ where: { id: finAccountId, userId } });
        if (!a) throw new Error("Account not found");
    }
    if (creditCardId) {
        const c = await db.creditCard.findFirst({ where: { id: creditCardId, userId } });
        if (!c) throw new Error("Card not found");
    }
}

export async function createTransaction(fd: FormData) {
    const user = await requireUser();
    const amount = num(fd, "amount");
    if (amount === null) throw new Error("Amount is required");
    const finAccountId = str(fd, "finAccountId");
    const creditCardId = str(fd, "creditCardId");
    await assertOwnership(user.id, finAccountId, creditCardId);
    const dateStr = str(fd, "date") ?? new Date().toISOString().slice(0, 10);
    const merchant = str(fd, "merchant");
    await db.finTransaction.create({
        data: {
            userId: user.id,
            finAccountId,
            creditCardId,
            date: parseDateOnly(dateStr),
            amount,
            merchant,
            rawDescription: str(fd, "rawDescription"),
            categoryId: str(fd, "categoryId"),
            source: source(fd),
            notes: str(fd, "notes"),
            dedupHash: transactionDedupHash(dateStr, amount, merchant),
        },
    });
    await recomputeOwnerBalance(finAccountId, creditCardId);
    revalidatePath("/financial/transactions");
    revalidatePath("/financial");
}

export async function updateTransaction(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.finTransaction.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const amount = num(fd, "amount");
    if (amount === null) throw new Error("Amount is required");
    const finAccountId = str(fd, "finAccountId");
    const creditCardId = str(fd, "creditCardId");
    await assertOwnership(user.id, finAccountId, creditCardId);
    const dateStr = str(fd, "date") ?? existing.date.toISOString().slice(0, 10);
    await db.finTransaction.update({
        where: { id },
        data: {
            finAccountId,
            creditCardId,
            date: parseDateOnly(dateStr),
            amount,
            merchant: str(fd, "merchant"),
            rawDescription: str(fd, "rawDescription"),
            categoryId: str(fd, "categoryId"),
            source: source(fd),
            notes: str(fd, "notes"),
        },
    });
    // Recompute for both the previous and new owners in case the owner changed.
    await recomputeOwnerBalance(existing.finAccountId, existing.creditCardId);
    await recomputeOwnerBalance(finAccountId, creditCardId);
    revalidatePath("/financial/transactions");
    revalidatePath("/financial");
}

/** Inline category assignment from the table. */
export async function assignCategory(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const owned = await db.finTransaction.findFirst({ where: { id, userId: user.id } });
    if (!owned) throw new Error("Not found");
    await db.finTransaction.update({ where: { id }, data: { categoryId: str(fd, "categoryId") } });
    revalidatePath("/financial/transactions");
    revalidatePath("/financial");
}

export async function deleteTransaction(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.finTransaction.findFirst({ where: { id, userId: user.id }, select: { finAccountId: true, creditCardId: true } });
    await db.finTransaction.deleteMany({ where: { id, userId: user.id } });
    if (existing) await recomputeOwnerBalance(existing.finAccountId, existing.creditCardId);
    revalidatePath("/financial/transactions");
    revalidatePath("/financial");
}

export interface ImportRow {
    date: string; // YYYY-MM-DD
    amount: number;
    merchant?: string | null;
    rawDescription?: string | null;
}

/** Bulk-insert parsed CSV rows, skipping duplicates by dedupHash. Returns counts. */
export async function importTransactions(payload: { finAccountId?: string | null; creditCardId?: string | null; rows: ImportRow[] }) {
    const user = await requireUser();
    const { finAccountId = null, creditCardId = null, rows } = payload;
    if (!rows?.length) return { inserted: 0, skipped: 0 };
    await assertOwnership(user.id, finAccountId, creditCardId);

    // Existing hashes for this user to detect dupes.
    const hashes = rows.map((r) => transactionDedupHash(r.date, r.amount, r.merchant));
    const existing = await db.finTransaction.findMany({
        where: { userId: user.id, dedupHash: { in: hashes } },
        select: { dedupHash: true },
    });
    const seen = new Set(existing.map((e) => e.dedupHash));

    const toInsert: { date: string; data: ImportRow; hash: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const hash = hashes[i];
        if (seen.has(hash)) continue;
        seen.add(hash); // also dedupe within the file itself
        toInsert.push({ date: r.date, data: r, hash });
    }

    if (toInsert.length) {
        await db.finTransaction.createMany({
            data: toInsert.map(({ data, hash }) => ({
                userId: user.id,
                finAccountId,
                creditCardId,
                date: parseDateOnly(data.date),
                amount: data.amount,
                merchant: data.merchant ?? null,
                rawDescription: data.rawDescription ?? null,
                source: "CSV" as TransactionSource,
                dedupHash: hash,
            })),
        });
    }

    await recomputeOwnerBalance(finAccountId, creditCardId);
    revalidatePath("/financial/transactions");
    revalidatePath("/financial");
    return { inserted: toInsert.length, skipped: rows.length - toInsert.length };
}
