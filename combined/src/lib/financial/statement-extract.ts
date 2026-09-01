import "server-only";

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { CHEAP_CLAUDE_MODEL, aiConfigured, extractFromPdf, runClaude } from "@/lib/ai/claude";
import { getObjectStream } from "@/lib/s3";
import { recomputeOwnerBalance } from "./balance";
import { fileExtension, fullStatementFileName } from "./statement-name";

/**
 * Statement → AI extraction pipeline.
 *
 * EXTRACTION SCHEMA (json_schema constrained):
 *   {
 *     institution?: string,
 *     periodStart?: "YYYY-MM-DD",
 *     periodEnd?:   "YYYY-MM-DD",
 *     endingBalance?: number,           // statement closing balance / amount owed
 *     transactions: [{
 *        date: "YYYY-MM-DD",
 *        description: string,
 *        merchant?: string,
 *        amount: number                 // SIGNED: negative = charge/withdrawal, positive = credit/deposit
 *     }]
 *   }
 *
 * DEDUPE: each transaction gets a sha256 dedupHash over
 *   `{ownerId}|{YYYY-MM-DD}|{amount.toFixed(2)}|{normalizedDescription}`.
 * Existing hashes for the same user are skipped; the file is also de-duped against itself.
 *
 * DUPLICATE STATEMENT DETECTION: before inserting, if there is an existing DONE
 * statement for the SAME account/card with the same periodStart & periodEnd AND
 * >= 90% of this extraction's dedupHashes already exist, this statement is marked
 * FAILED ("Duplicate of statement <name>") and NO transactions are created.
 *
 * STATUS: PENDING → PROCESSING → DONE | FAILED (processingError on failure).
 */

interface ExtractedTransaction {
    date: string;
    description: string;
    merchant?: string;
    amount: number;
}

interface ExtractionResult {
    institution?: string;
    accountLast4?: string;
    periodStart?: string;
    periodEnd?: string;
    endingBalance?: number;
    transactions: ExtractedTransaction[];
}

export const STATEMENT_EXTRACTION_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        institution: { type: "string", description: "Bank/card/brokerage name printed on the statement." },
        accountLast4: {
            type: "string",
            description:
                "The last 4 digits of the account or card number this statement is for, taken from hints like 'Account number ending in 1234', 'Account ****1234', or a masked card number. Digits only; empty if not shown.",
        },
        periodStart: { type: "string", description: "Statement period start, YYYY-MM-DD." },
        periodEnd: { type: "string", description: "Statement period end / closing date, YYYY-MM-DD." },
        endingBalance: { type: "number", description: "Closing/ending balance (for cards, the statement balance owed)." },
        transactions: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    date: { type: "string", description: "Transaction date, YYYY-MM-DD." },
                    description: { type: "string", description: "Raw line description." },
                    merchant: { type: "string", description: "Cleaned merchant name if identifiable." },
                    amount: {
                        type: "number",
                        description: "Signed amount: negative = charge/withdrawal/debit, positive = credit/deposit/payment received.",
                    },
                },
                required: ["date", "description", "amount"],
            },
        },
    },
    required: ["transactions"],
};

const EXTRACTION_PROMPT = `You are extracting structured data from a financial statement PDF (bank account, credit card, or brokerage).

Return JSON matching the provided schema. Rules:
- institution is the bank/card/brokerage name printed on the statement.
- accountLast4 is the last 4 digits of the account/card this statement covers. Look for "Account number ending in NNNN", "Account ****NNNN", "Card ending NNNN", or a masked account/card number, and return just the 4 digits. Leave it empty if no such hint is present.
- periodStart / periodEnd are the statement's covered period (closing date for periodEnd), formatted YYYY-MM-DD.
- endingBalance is the closing balance. For a credit card, use the new balance / statement balance owed (a positive number).
- For EACH posted transaction, output a signed amount:
    - negative for charges, purchases, withdrawals, fees, debits;
    - positive for deposits, credits, refunds, payments received, interest earned.
- date is the posting/transaction date as YYYY-MM-DD. If only month/day are shown, infer the year from the statement period.
- description is the raw line text; merchant is a cleaned merchant name when you can identify one.
- Do NOT include running balances, summary rows, or section subtotals as transactions.
- If the document is not a parseable statement, return an empty transactions array.`;

/** Normalize a description for hashing (lowercase, collapse whitespace). */
function normalizeDescription(desc: string | null | undefined): string {
    return (desc ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Deterministic dedup hash scoped to the owning account/card. */
export function statementDedupHash(ownerId: string, date: string, amount: number, description: string | null | undefined): string {
    const normalized = `${ownerId}|${date}|${amount.toFixed(2)}|${normalizeDescription(description)}`;
    return createHash("sha256").update(normalized).digest("hex");
}

/** Coerce a possibly-loose date string to YYYY-MM-DD, or null. */
function toDateOnly(s: string | undefined | null): string | null {
    if (!s) return null;
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseDateUtc(s: string | null): Date | null {
    if (!s) return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** A friendly label for the owning entity, used in normalized names + dup messages. */
function ownerLabel(s: {
    finAccount?: { nickname: string | null; institution: string | null; institutionRef?: { name: string } | null } | null;
    creditCard?: { nickname?: string | null; productName: string | null; issuer: string | null; institutionRef?: { name: string } | null } | null;
    brokerageAccount?: { accountName: string | null; brokerage: string | null } | null;
}): string {
    if (s.finAccount) return s.finAccount.nickname || s.finAccount.institutionRef?.name || s.finAccount.institution || "Account";
    if (s.creditCard) return s.creditCard.nickname || s.creditCard.productName || s.creditCard.institutionRef?.name || s.creditCard.issuer || "Card";
    if (s.brokerageAccount) return s.brokerageAccount.accountName || s.brokerageAccount.brokerage || "Brokerage";
    return "Statement";
}

async function uniqueStatementFileName(userId: string, proposed: string, excludeId: string): Promise<string> {
    const ext = fileExtension(proposed);
    const base = ext ? proposed.slice(0, -(ext.length + 1)) : proposed;
    let candidate = proposed;
    for (let i = 2; i < 100; i++) {
        const existing = await db.finStatement.findFirst({
            where: { userId, fileName: candidate, id: { not: excludeId } },
            select: { id: true },
        });
        if (!existing) return candidate;
        candidate = ext ? `${base}_${i}.${ext}` : `${base}_${i}`;
    }
    return `${base}_${Date.now()}${ext ? `.${ext}` : ""}`;
}

function ownerFilter(statement: { finAccountId: string | null; creditCardId: string | null; brokerageAccountId: string | null }) {
    return statement.finAccountId
        ? { finAccountId: statement.finAccountId }
        : statement.creditCardId
          ? { creditCardId: statement.creditCardId }
          : statement.brokerageAccountId
            ? { brokerageAccountId: statement.brokerageAccountId }
            : {};
}

/**
 * Process a single statement through the AI pipeline. Idempotent-ish: callable as
 * the initial trigger or as a "reprocess" — it resets status and clears its own
 * STATEMENT transactions before re-inserting.
 *
 * @returns a small result describing the outcome.
 */
export async function processStatement(statementId: string, userId: string): Promise<{
    status: "DONE" | "FAILED";
    inserted: number;
    skipped: number;
    duplicate?: boolean;
    error?: string;
}> {
    const statement = await db.finStatement.findFirst({
        where: { id: statementId, userId },
        include: {
            finAccount: { include: { institutionRef: { select: { name: true } } } },
            creditCard: { include: { institutionRef: { select: { name: true } } } },
            brokerageAccount: true,
        },
    });
    if (!statement) throw new Error("Statement not found");

    if (!aiConfigured()) {
        throw new Error("AI is not configured — add ANTHROPIC_API_KEY to enable statement extraction.");
    }

    const ownerId = statement.finAccountId ?? statement.creditCardId ?? statement.brokerageAccountId ?? statement.id;
    const isCard = Boolean(statement.creditCardId);

    await db.finStatement.update({
        where: { id: statement.id },
        data: { processingStatus: "PROCESSING", processingError: null },
    });

    try {
        // Fetch the PDF bytes from MinIO.
        const obj = await getObjectStream(statement.fileKey);
        const bytes = await obj.Body!.transformToByteArray();
        const pdfBase64 = Buffer.from(bytes).toString("base64");

        const { data } = await extractFromPdf<ExtractionResult>({
            purpose: "statement-extract",
            userId,
            prompt: EXTRACTION_PROMPT,
            pdfBase64,
            schema: STATEMENT_EXTRACTION_SCHEMA,
        });

        const periodStart = toDateOnly(data.periodStart) ?? (statement.periodStart ? statement.periodStart.toISOString().slice(0, 10) : null);
        const periodEnd = toDateOnly(data.periodEnd) ?? (statement.periodEnd ? statement.periodEnd.toISOString().slice(0, 10) : null);
        const endingBalance = typeof data.endingBalance === "number" ? data.endingBalance : statement.endingBalance != null ? Number(statement.endingBalance) : null;

        const rawTxns = Array.isArray(data.transactions) ? data.transactions : [];
        const cleaned = rawTxns
            .map((t) => ({ date: toDateOnly(t.date), description: t.description ?? "", merchant: t.merchant ?? null, amount: Number(t.amount) }))
            .filter((t) => t.date && Number.isFinite(t.amount)) as { date: string; description: string; merchant: string | null; amount: number }[];

        const hashes = cleaned.map((t) => statementDedupHash(ownerId, t.date, t.amount, t.description));

        // --- Duplicate statement detection ---
        const existingDone = await db.finStatement.findMany({
            where: {
                userId,
                id: { not: statement.id },
                processingStatus: { not: "FAILED" },
                ...ownerFilter(statement),
            },
            select: { id: true, fileName: true, periodStart: true, periodEnd: true },
        });

        const psDate = parseDateUtc(periodStart);
        const peDate = parseDateUtc(periodEnd);
        const samePeriod = existingDone.filter(
            (e) =>
                psDate && peDate && e.periodStart && e.periodEnd &&
                e.periodStart.getTime() === psDate.getTime() &&
                e.periodEnd.getTime() === peDate.getTime(),
        );

        if (samePeriod.length > 0 && cleaned.length === 0) {
            const dupName = samePeriod[0].fileName;
            await db.finStatement.update({
                where: { id: statement.id },
                data: {
                    processingStatus: "FAILED",
                    processingError: `Duplicate of statement ${dupName}`,
                    periodStart: psDate,
                    periodEnd: peDate,
                    endingBalance,
                    extractedTransactionCount: cleaned.length,
                    rawExtraction: data as unknown as object,
                    processedAt: new Date(),
                },
            });
            return { status: "FAILED", inserted: 0, skipped: cleaned.length, duplicate: true, error: `Duplicate of statement ${dupName}` };
        }

        if (cleaned.length > 0 && samePeriod.length > 0) {
            const existingHashes = await db.finTransaction.findMany({
                where: { userId, statementId: { in: samePeriod.map((e) => e.id) }, dedupHash: { in: hashes } },
                select: { dedupHash: true },
            });
            const overlap = new Set(existingHashes.map((h) => h.dedupHash));
            const overlapRatio = hashes.length ? overlap.size / hashes.length : 0;
            if (overlapRatio >= 0.9) {
                const dupName = samePeriod[0].fileName;
                await db.finStatement.update({
                    where: { id: statement.id },
                    data: {
                        processingStatus: "FAILED",
                        processingError: `Duplicate of statement ${dupName}`,
                        periodStart: psDate,
                        periodEnd: peDate,
                        endingBalance,
                        extractedTransactionCount: cleaned.length,
                        rawExtraction: data as unknown as object,
                        processedAt: new Date(),
                    },
                });
                return { status: "FAILED", inserted: 0, skipped: cleaned.length, duplicate: true, error: `Duplicate of statement ${dupName}` };
            }
        }

        // Clear this statement's previously-created transactions (reprocess support).
        await db.finTransaction.deleteMany({ where: { statementId: statement.id } });

        // Skip transactions whose dedupHash already exists for this user.
        const existing = await db.finTransaction.findMany({
            where: { userId, dedupHash: { in: hashes } },
            select: { dedupHash: true },
        });
        const seen = new Set(existing.map((e) => e.dedupHash));

        const toInsert: { date: string; description: string; merchant: string | null; amount: number; hash: string }[] = [];
        for (let i = 0; i < cleaned.length; i++) {
            const hash = hashes[i];
            if (seen.has(hash)) continue;
            seen.add(hash);
            toInsert.push({ ...cleaned[i], hash });
        }

        if (toInsert.length) {
            await db.finTransaction.createMany({
                data: toInsert.map((t) => ({
                    userId,
                    finAccountId: statement.finAccountId,
                    creditCardId: statement.creditCardId,
                    statementId: statement.id,
                    date: new Date(`${t.date}T00:00:00.000Z`),
                    amount: t.amount,
                    merchant: t.merchant,
                    rawDescription: t.description,
                    source: "STATEMENT",
                    dedupHash: t.hash,
                })),
            });
        }

        // Auto-name the stored file: {nickname-or-institution}_{last4}_{start}_{end}.ext
        const extractedLast4 = typeof data.accountLast4 === "string" ? data.accountLast4.replace(/\D/g, "").slice(-4) || null : null;
        const last4 =
            statement.finAccount?.last4 ??
            statement.creditCard?.last4 ??
            extractedLast4;
        const autoName = fullStatementFileName({
            entityLabel: ownerLabel(statement),
            last4,
            periodStart: psDate ?? statement.periodStart,
            periodEnd: peDate ?? statement.periodEnd,
            extension: fileExtension(statement.fileName),
        });
        const uniqueAutoName = await uniqueStatementFileName(userId, autoName, statement.id);

        await db.finStatement.update({
            where: { id: statement.id },
            data: {
                processingStatus: "DONE",
                processingError: null,
                periodStart: psDate ?? statement.periodStart,
                periodEnd: peDate ?? statement.periodEnd,
                endingBalance,
                extractedTransactionCount: cleaned.length,
                rawExtraction: data as unknown as object,
                processedAt: new Date(),
                // only auto-rename when we have a period to name from
                ...(psDate || peDate ? { fileName: uniqueAutoName } : {}),
            },
        });

        // Auto-categorize the newly inserted statement transactions, then refresh cache.
        if (toInsert.length) await autoCategorizeStatement(statement.id, userId).catch(() => undefined);
        await recomputeOwnerBalance(statement.finAccountId, statement.creditCardId);

        return { status: "DONE", inserted: toInsert.length, skipped: cleaned.length - toInsert.length };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db.finStatement.update({
            where: { id: statement.id },
            data: { processingStatus: "FAILED", processingError: message.slice(0, 500), processedAt: new Date() },
        }).catch(() => undefined);
        // re-throw so the caller can surface a toast; the owner label is included for context.
        throw new Error(`${ownerLabel(statement)} statement extraction failed: ${message}`);
    }
}

const CATEGORIZE_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        assignments: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    transactionId: { type: "string" },
                    categoryName: { type: "string" },
                },
                required: ["transactionId", "categoryName"],
            },
        },
    },
    required: ["assignments"],
};

interface CategorizeResult {
    assignments: { transactionId: string; categoryName: string }[];
}

/**
 * AI-categorize up to ~100 uncategorized transactions. When `transactionIds` is
 * provided only those are considered and can be recategorized (used to categorize a freshly-extracted
 * statement); otherwise all of the user's uncategorized transactions are batched.
 * Returns the number of transactions updated.
 */
export async function categorizeTransactionsWithAi(userId: string, transactionIds?: string[]): Promise<{ updated: number; total: number }> {
    if (!aiConfigured()) throw new Error("AI is not configured — add ANTHROPIC_API_KEY to enable categorization.");

    const categories = await db.budgetCategory.findMany({
        where: { userId, NOT: { name: "__total__" } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
    });
    if (!categories.length) return { updated: 0, total: 0 };

    const txns = await db.finTransaction.findMany({
        where: {
            userId,
            ...(transactionIds && transactionIds.length ? { id: { in: transactionIds } } : { categoryId: null }),
        },
        select: { id: true, merchant: true, rawDescription: true, amount: true },
        orderBy: { date: "desc" },
        take: 100,
    });
    if (!txns.length) return { updated: 0, total: 0 };

    const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    const list = txns.map((t) => ({
        id: t.id,
        text: (t.merchant || t.rawDescription || "").slice(0, 120),
        amount: Number(t.amount),
    }));

    const prompt = `Assign each transaction below to the single best-fit budget category.
Categories (use the name EXACTLY as written): ${categories.map((c) => c.name).join(", ")}.

Transactions (id — description — amount; negative = spending):
${list.map((t) => `${t.id} — ${t.text || "(no description)"} — ${t.amount}`).join("\n")}

Return assignments with transactionId and the chosen categoryName. Only include transactions you can confidently categorize; omit the rest.`;

    const { data } = await runClaude<CategorizeResult>({
        purpose: "transaction-categorize",
        userId,
        model: CHEAP_CLAUDE_MODEL,
        content: prompt,
        schema: CATEGORIZE_SCHEMA,
    });

    let updated = 0;
    const validIds = new Set(txns.map((t) => t.id));
    for (const a of data.assignments ?? []) {
        const categoryId = byName.get((a.categoryName ?? "").toLowerCase());
        if (!categoryId || !validIds.has(a.transactionId)) continue;
        await db.finTransaction.updateMany({ where: { id: a.transactionId, userId }, data: { categoryId } });
        updated++;
    }
    return { updated, total: txns.length };
}

/** Auto-categorize the transactions created for a specific statement. */
async function autoCategorizeStatement(statementId: string, userId: string): Promise<void> {
    const txns = await db.finTransaction.findMany({ where: { statementId, userId, categoryId: null }, select: { id: true } });
    if (!txns.length) return;
    await categorizeTransactionsWithAi(userId, txns.map((t) => t.id));
}
