// @ts-nocheck
"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../db/prisma.js";
import { requireUser } from "@/lib/auth";
import { aiConfigured, analyzeImage } from "./ai-client.js";
import { uploadUserFile } from "@/lib/uploads";

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

function mimeFor(file: File): "image/jpeg" | "image/png" | "image/webp" {
    if (file.type === "image/png") return "image/png";
    if (file.type === "image/webp") return "image/webp";
    return "image/jpeg";
}

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
    if (!file.type.startsWith("image/")) throw new Error("Upload an image (JPG, PNG or WebP).");

    const { fileKey } = await uploadUserFile(user.id, "receipts", file);
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    const { data } = await analyzeImage<ReceiptData>({
        purpose: "receipt-ocr",
        userId: user.id,
        mimeType: mimeFor(file),
        imageBase64: base64,
        schema: RECEIPT_SCHEMA,
        prompt: "This is a photo of a purchase receipt. Extract the merchant name, the grand total paid (positive number), the purchase date (YYYY-MM-DD), and a likely spending category. Respond with only the structured fields.",
    });

    return {
        receiptKey: fileKey,
        merchant: data?.merchant?.trim() || null,
        amount: typeof data?.amount === "number" ? Math.abs(data.amount) : null,
        date: data?.date?.slice(0, 10) || null,
        category: data?.category?.trim() || null,
    };
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
    if (!input.finAccountId && !input.creditCardId) throw new Error("Pick an account or card for this purchase.");
    if (input.finAccountId) {
        const a = await db.finAccount.findFirst({ where: { id: input.finAccountId, userId: user.id }, select: { id: true } });
        if (!a) throw new Error("Account not found");
    }
    if (input.creditCardId) {
        const c = await db.creditCard.findFirst({ where: { id: input.creditCardId, userId: user.id }, select: { id: true } });
        if (!c) throw new Error("Card not found");
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
