// @ts-nocheck
// import "server-only";

import { db } from "../../db/prisma.js";
import { aiConfigured, extractFromPdf } from "./ai-client.js";
import { getObjectStream } from "./s3-client.js";
import { resolveActiveAlpacaCreds } from "@/lib/financial/alpaca-config";
import { getAccount, getPositions } from "@/lib/financial/alpaca";

/**
 * Brokerage (FinAccount kind == BROKERAGE) holdings + value helpers.
 *
 * A brokerage account's VALUE is derived, in priority order:
 *   1. live Alpaca equity when the account is alpacaLinked AND the user has a
 *      working AlpacaConnection;
 *   2. else the sum of holdings (shares × currentPrice);
 *   3. else the latest DONE statement's ending balance.
 *
 * Holdings come from (a) manual entry, (b) Alpaca positions (mirrored on link/
 * refresh), and (c) AI extraction from uploaded brokerage statement PDFs.
 *
 * Everything here is server-only. Alpaca keys never reach the client.
 */

/** Live Alpaca equity for a specific account when it is linked. Null otherwise. */
async function alpacaEquityForAccount(account: { userId: string; alpacaLinked: boolean }): Promise<number | null> {
    if (!account.alpacaLinked) return null;
    const conn = await db.alpacaConnection.findUnique({ where: { userId: account.userId } });
    const creds = conn ? resolveActiveAlpacaCreds(conn) : null;
    if (!creds) return null;
    try {
        const acct = await getAccount(creds);
        return acct.equity;
    } catch {
        return null; // never let a transient Alpaca error break value computation
    }
}

/**
 * Compute a brokerage account's derived value.
 * @returns { value, source } where source describes which rule produced it.
 */
export async function computeBrokerageAccountValue(
    finAccountId: string,
): Promise<{ value: number; source: "alpaca" | "holdings" | "statement" | "none" }> {
    const account = await db.finAccount.findUnique({
        where: { id: finAccountId },
        select: { userId: true, alpacaLinked: true },
    });
    if (!account) return { value: 0, source: "none" };

    const equity = await alpacaEquityForAccount(account);
    if (equity != null) return { value: equity, source: "alpaca" };

    const holdings = await db.holding.findMany({ where: { finAccountId } });
    if (holdings.length > 0) {
        const value = holdings.reduce((sum, h) => sum + Number(h.shares) * Number(h.currentPrice ?? 0), 0);
        if (value > 0) return { value, source: "holdings" };
    }

    const latest = await db.finStatement.findFirst({
        where: { finAccountId, processingStatus: "DONE", endingBalance: { not: null }, periodEnd: { not: null } },
        orderBy: { periodEnd: "desc" },
        select: { endingBalance: true },
    });
    if (latest?.endingBalance != null) return { value: Number(latest.endingBalance), source: "statement" };

    return { value: 0, source: "none" };
}

/**
 * Mirror live Alpaca positions onto a brokerage account's holdings (upsert by
 * symbol). Read-only Alpaca usage. Returns the number of positions synced, or
 * null when the account isn't linked / Alpaca is unreachable.
 */
export async function syncAlpacaHoldings(finAccountId: string): Promise<number | null> {
    const account = await db.finAccount.findUnique({
        where: { id: finAccountId },
        select: { userId: true, alpacaLinked: true },
    });
    if (!account || !account.alpacaLinked) return null;
    const conn = await db.alpacaConnection.findUnique({ where: { userId: account.userId } });
    const creds = conn ? resolveActiveAlpacaCreds(conn) : null;
    if (!creds) return null;

    let positions;
    try {
        positions = await getPositions(creds);
    } catch {
        return null;
    }

    const asOf = new Date();
    for (const p of positions) {
        if (!p.symbol) continue;
        await upsertHoldingBySymbol(finAccountId, {
            symbol: p.symbol,
            shares: p.qty,
            costBasisPerShare: p.qty !== 0 ? p.avgEntryPrice : null,
            currentPrice: p.currentPrice,
            asOf,
        });
    }
    return positions.length;
}

/** Upsert a holding for an account, matched on (finAccountId, symbol). */
export async function upsertHoldingBySymbol(
    finAccountId: string,
    h: { symbol: string; shares: number; costBasisPerShare?: number | null; currentPrice?: number | null; asOf?: Date | null },
): Promise<void> {
    const symbol = h.symbol.toUpperCase();
    const existing = await db.holding.findFirst({ where: { finAccountId, symbol } });
    const data = {
        shares: h.shares,
        costBasisPerShare: h.costBasisPerShare ?? null,
        currentPrice: h.currentPrice ?? null,
        asOf: h.asOf ?? new Date(),
    };
    if (existing) {
        await db.holding.update({ where: { id: existing.id }, data });
    } else {
        await db.holding.create({ data: { finAccountId, symbol, ...data } });
    }
}

// --- AI: extract holdings from brokerage statement PDFs ---

interface ExtractedHolding {
    symbol: string;
    shares: number;
    costBasisPerShare?: number;
    currentPrice?: number;
}
interface HoldingsExtractionResult {
    asOf?: string;
    holdings: ExtractedHolding[];
}

const HOLDINGS_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        asOf: { type: "string", description: "Statement / holdings as-of date, YYYY-MM-DD." },
        holdings: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    symbol: { type: "string", description: "Ticker symbol, e.g. AAPL. Uppercase." },
                    shares: { type: "number", description: "Number of shares / units held." },
                    costBasisPerShare: { type: "number", description: "Cost basis per share if shown." },
                    currentPrice: { type: "number", description: "Current / closing price per share if shown." },
                },
                required: ["symbol", "shares"],
            },
        },
    },
    required: ["holdings"],
};

const HOLDINGS_PROMPT = `You are extracting the HOLDINGS / POSITIONS table from a brokerage account statement PDF.

Return JSON matching the provided schema. Rules:
- For each security position, output its ticker symbol (uppercase), the number of shares/units held, and (when shown) the cost basis per share and the current/closing price per share.
- Use per-SHARE values. If the statement shows total cost or total market value, divide by shares to get the per-share figure.
- Ignore cash balances, sweep funds without a ticker, totals, and subtotal rows.
- asOf is the statement's holdings as-of / period-end date as YYYY-MM-DD.
- If the document has no parseable holdings table, return an empty holdings array.`;

function toDateOnly(s: string | undefined | null): Date | null {
    if (!s) return null;
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return null;
}

/**
 * Extract holdings from all of a brokerage account's uploaded statement PDFs via
 * Claude, and upsert them onto the account (matched by symbol). The most-recent
 * statement (by periodEnd) wins for each symbol so prices stay current.
 *
 * Safe to call from the account detail "Extract holdings from statements" button,
 * or from the statements pipeline (see TODO below).
 *
 * @returns counts describing the run.
 */
export async function extractHoldingsFromStatements(
    finAccountId: string,
    userId: string,
): Promise<{ upserted: number; statementsScanned: number; skipped: number }> {
    if (!aiConfigured()) {
        throw new Error("AI is not configured — add ANTHROPIC_API_KEY to enable holdings extraction.");
    }

    const account = await db.finAccount.findFirst({ where: { id: finAccountId, userId }, select: { id: true, kind: true } });
    if (!account) throw new Error("Account not found");
    if (account.kind !== "BROKERAGE") throw new Error("Holdings extraction is only available for brokerage accounts.");

    // Oldest first so newer statements overwrite older prices for the same symbol.
    const statements = await db.finStatement.findMany({
        where: { finAccountId },
        orderBy: [{ periodEnd: "asc" }, { createdAt: "asc" }],
        select: { id: true, fileKey: true, fileName: true, periodEnd: true },
    });
    if (statements.length === 0) return { upserted: 0, statementsScanned: 0, skipped: 0 };

    let upserted = 0;
    let scanned = 0;
    let skipped = 0;

    for (const s of statements) {
        // Only PDFs are extractable here.
        if (!s.fileName.toLowerCase().endsWith(".pdf")) {
            skipped++;
            continue;
        }
        try {
            const obj = await getObjectStream(s.fileKey);
            const bytes = await obj.Body!.transformToByteArray();
            const pdfBase64 = Buffer.from(bytes).toString("base64");

            const { data } = await extractFromPdf<HoldingsExtractionResult>({
                purpose: "brokerage-holdings-extract",
                userId,
                prompt: HOLDINGS_PROMPT,
                pdfBase64,
                schema: HOLDINGS_SCHEMA,
            });

            const asOf = toDateOnly(data.asOf) ?? s.periodEnd ?? new Date();
            const holdings = Array.isArray(data.holdings) ? data.holdings : [];
            for (const h of holdings) {
                const symbol = (h.symbol ?? "").trim();
                const shares = Number(h.shares);
                if (!symbol || !Number.isFinite(shares)) continue;
                await upsertHoldingBySymbol(finAccountId, {
                    symbol,
                    shares,
                    costBasisPerShare: Number.isFinite(Number(h.costBasisPerShare)) ? Number(h.costBasisPerShare) : null,
                    currentPrice: Number.isFinite(Number(h.currentPrice)) ? Number(h.currentPrice) : null,
                    asOf,
                });
                upserted++;
            }
            scanned++;
        } catch {
            skipped++;
        }
    }

    return { upserted, statementsScanned: scanned, skipped };
}

/**
 * Idempotent reconcile: migrate any legacy BrokerageAccount rows (and their
 * holdings) to FinAccount(kind BROKERAGE) so nothing is orphaned once the old
 * model is retired. There are ~0 such rows in practice; this is defensive.
 *
 * Runs lazily on the accounts list load. Cheap no-op when there's nothing to do.
 */
export async function reconcileLegacyBrokerage(userId: string): Promise<number> {
    const legacy = await db.brokerageAccount.findMany({
        where: { userId },
        include: { holdings: true, statements: { select: { id: true } } },
    });
    if (legacy.length === 0) return 0;

    let migrated = 0;
    for (const b of legacy) {
        const created = await db.finAccount.create({
            data: {
                userId,
                kind: "BROKERAGE",
                nickname: b.accountName || b.brokerage || "Brokerage",
                institution: b.brokerage,
                currentBalance: b.currentValue,
                isAsset: true,
                includeInNetWorth: true,
                notes: [b.accountType ? `Type: ${b.accountType}` : null, b.notes].filter(Boolean).join("\n") || null,
                archived: b.archived,
            },
        });

        // Re-point holdings and statements onto the new FinAccount.
        if (b.holdings.length) {
            await db.holding.updateMany({ where: { brokerageAccountId: b.id }, data: { finAccountId: created.id, brokerageAccountId: null } });
        }
        if (b.statements.length) {
            await db.finStatement.updateMany({ where: { brokerageAccountId: b.id }, data: { finAccountId: created.id, brokerageAccountId: null } });
        }
        // Remove the now-empty legacy row.
        await db.brokerageAccount.delete({ where: { id: b.id } }).catch(() => undefined);
        migrated++;
    }
    return migrated;
}
