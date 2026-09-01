// @ts-nocheck
// import "server-only";

import { db } from "../../db/prisma.js";

/**
 * Derived-balance rules for accounts and cards.
 *
 * The stored `currentBalance` column is a CACHE — the source of truth is derived:
 *   1. the ending balance of the latest DONE statement (by periodEnd), if any;
 *   2. otherwise the signed sum of all transactions.
 *
 * Recompute is called after statement processing and transaction changes so the
 * cache stays accurate. Account creation/edit no longer takes a balance input.
 */

/** Compute an account's derived balance: latest statement ending balance, else txn sum. */
export async function computeFinAccountBalance(finAccountId: string): Promise<number> {
    // Brokerage accounts derive value from Alpaca equity (when linked) → holdings → statement.
    const acct = await db.finAccount.findUnique({ where: { id: finAccountId }, select: { kind: true } });
    if (acct?.kind === "BROKERAGE") {
        const { computeBrokerageAccountValue } = await import("./brokerage-holdings");
        return (await computeBrokerageAccountValue(finAccountId)).value;
    }

    const latest = await db.finStatement.findFirst({
        where: { finAccountId, processingStatus: "DONE", endingBalance: { not: null }, periodEnd: { not: null } },
        orderBy: { periodEnd: "desc" },
        select: { endingBalance: true },
    });
    if (latest?.endingBalance != null) return Number(latest.endingBalance);

    const agg = await db.finTransaction.aggregate({ where: { finAccountId }, _sum: { amount: true } });
    return Number(agg._sum.amount ?? 0);
}

/** Compute a card's derived balance. Statement ending balances are stored positive (amount owed). */
export async function computeCreditCardBalance(creditCardId: string): Promise<number> {
    const latest = await db.finStatement.findFirst({
        where: { creditCardId, processingStatus: "DONE", endingBalance: { not: null }, periodEnd: { not: null } },
        orderBy: { periodEnd: "desc" },
        select: { endingBalance: true },
    });
    if (latest?.endingBalance != null) return Math.abs(Number(latest.endingBalance));

    // Card transactions store charges as negative; balance owed is the absolute net of outflows.
    const agg = await db.finTransaction.aggregate({ where: { creditCardId }, _sum: { amount: true } });
    return Math.abs(Number(agg._sum.amount ?? 0));
}

/** Recompute and persist the cached balance for an account. */
export async function recomputeFinAccountBalance(finAccountId: string): Promise<number> {
    const balance = await computeFinAccountBalance(finAccountId);
    await db.finAccount.update({ where: { id: finAccountId }, data: { currentBalance: balance, lastBalanceAt: new Date() } });
    return balance;
}

/** Recompute and persist the cached balance for a card. */
export async function recomputeCreditCardBalance(creditCardId: string): Promise<number> {
    const balance = await computeCreditCardBalance(creditCardId);
    await db.creditCard.update({ where: { id: creditCardId }, data: { currentBalance: balance } });
    return balance;
}

/** Recompute the owning entity's balance for whichever of account/card is set. */
export async function recomputeOwnerBalance(finAccountId: string | null, creditCardId: string | null): Promise<void> {
    if (finAccountId) await recomputeFinAccountBalance(finAccountId);
    if (creditCardId) await recomputeCreditCardBalance(creditCardId);
}
