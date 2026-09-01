"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { aiConfigured, analyzeImage } from "@/lib/ai/claude";
import { assertUserUploadKey, uploadUserRasterImage } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";

interface ReceiptData {
    merchant?: string | null;
    amount?: number | null;
    date?: string | null;
    category?: string | null;
}

const RECEIPT_SCHEMA = {
    type: "object",
    properties: {
        merchant: { type: "string", description: "Store / merchant name" },
        amount: { type: "number", description: "Grand total actually paid, as a positive number" },
        date: { type: "string", description: "Purchase date as YYYY-MM-DD" },
        category: { type: "string", description: "A likely spending category, e.g. Groceries, Dining, Gas, Supplies" },
    },
};

export interface ScanReceiptResult {
    receiptKey: string;
    merchant: string | null;
    amount: number | null;
    date: string | null;
    category: string | null;
}

/** Upload a receipt image, OCR it with Claude vision, and return the parsed fields. */
export async function scanReceipt(formData: FormData): Promise<ScanReceiptResult> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a receipt image to scan.");
    const stored = await uploadUserRasterImage(user.id, "receipts", file);
    const base64 = stored.processedBuffer.toString("base64");

    try {
        const { data } = await analyzeImage<ReceiptData>({
            purpose: "receipt-ocr",
            userId: user.id,
            mimeType: "image/webp",
            imageBase64: base64,
            schema: RECEIPT_SCHEMA,
            prompt: "This is a photo of a purchase receipt. Extract the merchant name, the grand total paid (positive number), the purchase date (YYYY-MM-DD), and a likely spending category. Respond with only the structured fields.",
        });

        return {
            receiptKey: stored.fileKey,
            merchant: data?.merchant?.trim() || null,
            amount: typeof data?.amount === "number" ? Math.abs(data.amount) : null,
            date: data?.date?.slice(0, 10) || null,
            category: data?.category?.trim() || null,
        };
    } catch (error) {
        await deleteObject(stored.fileKey).catch(() => {});
        throw error;
    }
}

/** Create a transaction from a scanned receipt, linking the stored image. */
export async function createReceiptTransaction(input: {
    receiptKey: string;
    finAccountId: string | null;
    creditCardId: string | null;
    date: string;
    amount: number; // positive total; stored as a negative outflow
    merchant: string | null;
    categoryId: string | null;
    notes: string | null;
}) {
    const user = await requireUser();
    assertUserUploadKey(user.id, "receipts", input.receiptKey);
    if (!input.finAccountId && !input.creditCardId) throw new Error("Pick an account or card for this purchase.");
    if (input.finAccountId && input.creditCardId) throw new Error("Pick either an account or a card, not both.");
    if (input.finAccountId) {
        const a = await db.finAccount.findFirst({ where: { id: input.finAccountId, userId: user.id }, select: { id: true } });
        if (!a) throw new Error("Account not found");
    }
    if (input.creditCardId) {
        const c = await db.creditCard.findFirst({ where: { id: input.creditCardId, userId: user.id }, select: { id: true } });
        if (!c) throw new Error("Card not found");
    }
    if (input.categoryId) {
        const category = await db.budgetCategory.findFirst({ where: { id: input.categoryId, userId: user.id }, select: { id: true } });
        if (!category) throw new Error("Category not found");
    }

    await db.finTransaction.create({
        data: {
            userId: user.id,
            finAccountId: input.finAccountId,
            creditCardId: input.creditCardId,
            date: new Date(`${input.date}T00:00:00`),
            amount: -Math.abs(input.amount),
            merchant: input.merchant,
            categoryId: input.categoryId,
            receiptKey: input.receiptKey,
            source: "MANUAL",
            notes: input.notes,
        },
    });
    revalidatePath("/financial/transactions");
    revalidatePath("/financial");
}

/** Remove a scanned receipt that the user abandoned before creating a transaction. */
export async function discardPendingReceipt(receiptKey: string) {
    const user = await requireUser();
    assertUserUploadKey(user.id, "receipts", receiptKey);
    const linked = await db.finTransaction.findFirst({ where: { userId: user.id, receiptKey }, select: { id: true } });
    if (!linked) await deleteObject(receiptKey).catch(() => {});
}
