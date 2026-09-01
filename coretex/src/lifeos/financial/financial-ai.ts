// @ts-nocheck
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "../../db/prisma.js";
import { CHEAP_CLAUDE_MODEL, aiConfigured, runClaude } from "./ai-client.js";
import { categorizeTransactionsWithAi } from "@/lib/financial/statement-extract";

/** "Categorize with AI": batch uncategorized transactions to Claude and apply results. */
export async function categorizeUncategorizedTransactions() {
    const user = await requireUser();
    const result = await categorizeTransactionsWithAi(user.id);
    revalidatePath("/financial/transactions");
    revalidatePath("/financial/budget");
    revalidatePath("/financial");
    return result;
}

interface NormalizePair {
    raw: string;
    normalized: string;
}
interface NormalizeResult {
    pairs: NormalizePair[];
}
interface NormalizeOneResult {
    normalized: string;
}

const NORMALIZE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["pairs"],
    properties: {
        pairs: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["raw", "normalized"],
                properties: {
                    raw: { type: "string" },
                    normalized: { type: "string" },
                },
            },
        },
    },
} as const;

const NORMALIZE_ONE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["normalized"],
    properties: {
        normalized: { type: "string" },
    },
} as const;

/**
 * "Normalize merchant names with AI": collect distinct raw merchant strings,
 * ask Claude for clean human-readable names (e.g. "NETFLIX.COM*4242 CA" → "Netflix"),
 * and update each transaction's `merchant` while preserving `rawDescription`.
 */
export async function normalizeMerchantsWithAi() {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — add ANTHROPIC_API_KEY to enable merchant normalization.");

    // Distinct raw merchant strings worth cleaning (use rawDescription as the source
    // of truth, falling back to merchant). Cap at 200 distinct values per run.
    const txns = await db.finTransaction.findMany({
        where: { userId: user.id },
        select: { id: true, merchant: true, rawDescription: true },
        orderBy: { date: "desc" },
        take: 2000,
    });

    const sourceOf = (t: { merchant: string | null; rawDescription: string | null }) => (t.rawDescription || t.merchant || "").trim();
    const distinct = [...new Set(txns.map(sourceOf).filter((s) => s.length > 0))].slice(0, 200);
    if (!distinct.length) return { normalized: 0, distinct: 0, updated: 0 };

    const prompt = `Normalize each raw bank/card transaction descriptor into a clean, human-readable merchant name.
Rules:
- Strip store/terminal numbers, location codes, card suffixes, dates, and payment-processor noise.
- Use the well-known brand name with normal capitalization (e.g. "NETFLIX.COM*4242 CA" → "Netflix", "SQ *BLUE BOTTLE COFFEE" → "Blue Bottle Coffee", "AMZN MKTP US*1A2B3" → "Amazon").
- If a descriptor is already clean, return it unchanged.
- If you genuinely cannot tell the merchant, return the original raw string as the normalized value.

Raw descriptors:
${distinct.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Return a pair {raw, normalized} for every raw descriptor, with raw EXACTLY as given.`;

    const { data } = await runClaude<NormalizeResult>({
        purpose: "merchant-normalize",
        userId: user.id,
        model: CHEAP_CLAUDE_MODEL,
        content: prompt,
        schema: NORMALIZE_SCHEMA as unknown as Record<string, unknown>,
    });

    // Map raw -> normalized (only keep meaningful, changed values).
    const map = new Map<string, string>();
    for (const p of data.pairs ?? []) {
        const raw = (p.raw ?? "").trim();
        const norm = (p.normalized ?? "").trim();
        if (!raw || !norm || norm === raw) continue;
        map.set(raw, norm.slice(0, 200));
    }
    if (!map.size) return { normalized: 0, distinct: distinct.length, updated: 0 };

    // Apply to every transaction whose source descriptor matches.
    let updated = 0;
    for (const t of txns) {
        const src = sourceOf(t);
        const norm = map.get(src);
        if (norm && t.merchant !== norm) {
            await db.finTransaction.updateMany({ where: { id: t.id, userId: user.id }, data: { merchant: norm } });
            updated++;
        }
    }

    revalidatePath("/financial/transactions");
    revalidatePath("/financial");
    return { normalized: map.size, distinct: distinct.length, updated };
}

/** Rerun merchant cleanup and category classification for a single transaction. */
export async function cleanAndClassifyTransactionWithAi(id: string) {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured - add ANTHROPIC_API_KEY to enable transaction cleanup.");

    const txn = await db.finTransaction.findFirst({
        where: { id, userId: user.id },
        select: { id: true, merchant: true, rawDescription: true },
    });
    if (!txn) throw new Error("Transaction not found");

    let merchantUpdated = false;
    const source = (txn.rawDescription || txn.merchant || "").trim();
    if (source) {
        const { data } = await runClaude<NormalizeOneResult>({
            purpose: "merchant-normalize-one",
            userId: user.id,
            model: CHEAP_CLAUDE_MODEL,
            content: `Normalize this raw bank/card transaction descriptor into the clean merchant name.
Rules:
- Strip store/terminal numbers, location codes, card suffixes, dates, and payment-processor noise.
- Use the well-known brand name with normal capitalization.
- If you cannot identify a clearer merchant, return the original string.

Raw descriptor: ${source}`,
            schema: NORMALIZE_ONE_SCHEMA as unknown as Record<string, unknown>,
        });
        const normalized = (data.normalized ?? "").trim().slice(0, 200);
        if (normalized && normalized !== txn.merchant) {
            await db.finTransaction.updateMany({ where: { id, userId: user.id }, data: { merchant: normalized } });
            merchantUpdated = true;
        }
    }

    const categorized = await categorizeTransactionsWithAi(user.id, [id]);
    revalidatePath("/financial/transactions");
    revalidatePath("/financial/accounts");
    revalidatePath("/financial/cards");
    revalidatePath("/financial/budget");
    revalidatePath("/financial");
    return { merchantUpdated, categoryUpdated: categorized.updated, total: categorized.total };
}
