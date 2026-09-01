"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Computes the current net worth from accounts, cards and debts, then persists a
 * NetWorthSnapshot with a category breakdown.
 *
 * BROKERAGE accounts are now FinAccounts of kind BROKERAGE; their currentBalance
 * cache already reflects the right value (live Alpaca equity when alpacaLinked →
 * sum of holdings → latest statement). So they are counted ONCE here as part of
 * the account loop — we deliberately DO NOT add getAlpacaEquity() separately to
 * avoid double-counting a linked account's live equity. The legacy BrokerageAccount
 * model is being retired and is reconciled into FinAccounts on the accounts page,
 * so it is no longer summed here.
 */
export async function takeNetWorthSnapshot() {
    const user = await requireUser();
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const [accounts, cards, debts] = await Promise.all([
        db.finAccount.findMany({ where: { userId: user.id, archived: false, includeInNetWorth: true } }),
        db.creditCard.findMany({ where: { userId: user.id, archived: false } }),
        db.debt.findMany({ where: { userId: user.id } }),
    ]);

    let cash = 0;
    let savings = 0;
    let loans = 0;
    let brokerageValue = 0;
    let otherAssets = 0;
    for (const a of accounts) {
        const bal = Number(a.currentBalance);
        if (a.kind === "LOAN" || !a.isAsset) {
            loans += Math.abs(bal);
        } else if (a.kind === "SAVINGS") {
            savings += bal;
        } else if (a.kind === "CHECKING") {
            cash += bal;
        } else if (a.kind === "BROKERAGE") {
            brokerageValue += bal; // includes live Alpaca equity when the account is linked
        } else {
            otherAssets += bal; // MONEY_MARKET, CD, OTHER
        }
    }

    const cardBalances = cards.reduce((s, c) => s + Number(c.currentBalance), 0);
    const debtBalances = debts.reduce((s, d) => s + Number(d.principalRemaining ?? 0), 0);

    const assets = cash + savings + otherAssets + brokerageValue;
    const liabilities = loans + cardBalances + debtBalances;
    const netWorth = assets - liabilities;

    const breakdown = {
        cash,
        savings,
        brokerage: brokerageValue,
        otherAssets,
        loans,
        cards: cardBalances,
        debts: debtBalances,
    };

    const existing = await db.netWorthSnapshot.findFirst({
        where: { userId: user.id, asOf: { gte: today, lt: tomorrow } },
        orderBy: { asOf: "desc" },
        select: { id: true },
    });

    if (existing) {
        await db.netWorthSnapshot.update({
            where: { id: existing.id },
            data: { asOf: today, assets, liabilities, netWorth, breakdown },
        });
    } else {
        await db.netWorthSnapshot.create({
            data: { userId: user.id, asOf: today, assets, liabilities, netWorth, breakdown },
        });
    }

    revalidatePath("/financial");
    revalidatePath("/financial/net-worth");
    revalidatePath("/dashboard");
    return { assets, liabilities, netWorth };
}
