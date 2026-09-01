// @ts-nocheck
// import "server-only";

import type { FinAccountKind, CardType, TransactionSource } from "@prisma/client";
import type { AccountBase, CreditCardLiability, Transaction as PlaidTransaction } from "plaid";
import { openIntegrationSecret } from "../../security/integration-secret-box.js";
import { db } from "../../db/prisma.js";
import { plaidClient } from "./plaid-client.js";
import { transactionDedupHash } from "./financial-shared.js";

/** LifeOS convention: negative = outflow. Plaid: positive = money leaving account. */
export function plaidAmountToLife(amount: number): number {
    return -amount;
}

function parsePlaidDate(iso: string): Date {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return new Date(iso.slice(0, 10) + "T00:00:00.000Z");
}

function accountKindFromPlaid(account: AccountBase): FinAccountKind {
    const subtype = (account.subtype ?? "").toLowerCase();
    if (subtype.includes("savings")) return "SAVINGS";
    if (subtype.includes("money market")) return "MONEY_MARKET";
    if (subtype.includes("cd")) return "CD";
    if (account.type === "investment" || account.type === "brokerage") return "BROKERAGE";
    if (account.type === "loan") return "LOAN";
    return "CHECKING";
}

function cardTypeFromPlaid(account: AccountBase): CardType {
    const subtype = (account.subtype ?? "").toLowerCase();
    if (subtype.includes("charge")) return "CHARGE";
    if (subtype.includes("prepaid")) return "PREPAID";
    return "CREDIT";
}

/** Find or create an Institution row for a Plaid institution name. */
async function resolveInstitution(userId: string, name: string | null | undefined): Promise<string | null> {
    const trimmed = name?.trim();
    if (!trimmed) return null;
    const existing = await db.institution.findFirst({ where: { userId, name: trimmed }, select: { id: true } });
    if (existing) return existing.id;
    const created = await db.institution.create({ data: { userId, name: trimmed } });
    return created.id;
}

function normalizeMatchText(value: string | null | undefined): string {
    return (value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function textLooksRelated(source: string | null | undefined, candidates: Array<string | null | undefined>): boolean {
    const a = normalizeMatchText(source);
    if (a.length < 4) return false;
    return candidates.some((candidate) => {
        const b = normalizeMatchText(candidate);
        if (b.length < 4) return false;
        return a.includes(b) || b.includes(a);
    });
}

async function findExistingCreditCardForPlaid(
    userId: string,
    institutionId: string | null,
    acct: AccountBase,
    alreadyLinkedIds: Set<string>,
): Promise<string | null> {
    const mask = acct.mask?.trim();
    if (!mask) return null;

    const cardType = cardTypeFromPlaid(acct);
    const candidates = (
        await db.creditCard.findMany({
            where: { userId, last4: mask, cardType },
            select: { id: true, institutionId: true, nickname: true, productName: true, issuer: true },
        })
    ).filter((c) => !alreadyLinkedIds.has(c.id));
    if (!candidates.length) return null;

    const sameInstitution = institutionId ? candidates.filter((c) => c.institutionId === institutionId) : [];
    if (sameInstitution.length === 1) return sameInstitution[0].id;
    if (candidates.length === 1) return candidates[0].id;

    const plaidName = acct.official_name || acct.name;
    const nameMatches = candidates.filter((c) => textLooksRelated(plaidName, [c.nickname, c.productName, c.issuer]));
    return nameMatches.length === 1 ? nameMatches[0].id : null;
}

async function findExistingFinAccountForPlaid(
    userId: string,
    institutionId: string | null,
    acct: AccountBase,
    alreadyLinkedIds: Set<string>,
): Promise<string | null> {
    const mask = acct.mask?.trim();
    if (!mask) return null;

    const kind = accountKindFromPlaid(acct);
    const candidates = (
        await db.finAccount.findMany({
            where: { userId, last4: mask, kind },
            select: { id: true, institutionId: true, nickname: true, institution: true },
        })
    ).filter((a) => !alreadyLinkedIds.has(a.id));
    if (!candidates.length) return null;

    const sameInstitution = institutionId ? candidates.filter((a) => a.institutionId === institutionId) : [];
    if (sameInstitution.length === 1) return sameInstitution[0].id;
    if (candidates.length === 1) return candidates[0].id;

    const plaidName = acct.official_name || acct.name;
    const nameMatches = candidates.filter((a) => textLooksRelated(plaidName, [a.nickname, a.institution]));
    return nameMatches.length === 1 ? nameMatches[0].id : null;
}

/** Provision LifeOS FinAccount / CreditCard rows for newly linked Plaid accounts. */
export async function provisionPlaidAccounts(
    userId: string,
    plaidItemId: string,
    accounts: AccountBase[],
    institutionName: string | null,
): Promise<void> {
    const institutionId = await resolveInstitution(userId, institutionName);
    const existingLinks = await db.plaidAccount.findMany({
        where: { userId },
        select: { finAccountId: true, creditCardId: true },
    });
    const linkedFinAccountIds = new Set(existingLinks.map((a) => a.finAccountId).filter(Boolean) as string[]);
    const linkedCreditCardIds = new Set(existingLinks.map((a) => a.creditCardId).filter(Boolean) as string[]);

    for (const acct of accounts) {
        const existing = await db.plaidAccount.findUnique({
            where: { plaidAccountId: acct.account_id },
            select: { id: true },
        });
        if (existing) continue;

        const displayName = acct.official_name || acct.name;
        const mask = acct.mask ?? null;

        if (acct.type === "credit") {
            const bal = acct.balances.current != null ? Math.abs(acct.balances.current) : 0;
            const existingCardId = await findExistingCreditCardForPlaid(userId, institutionId, acct, linkedCreditCardIds);
            const card =
                existingCardId
                    ? await db.creditCard.update({
                          where: { id: existingCardId },
                          data: {
                              ...(institutionId ? { institutionId } : {}),
                              last4: mask,
                              currentBalance: bal,
                              ...(acct.balances.limit != null ? { creditLimit: acct.balances.limit } : {}),
                          },
                          select: { id: true },
                      })
                    : await db.creditCard.create({
                          data: {
                              userId,
                              institutionId,
                              nickname: displayName,
                              productName: acct.subtype ?? null,
                              last4: mask,
                              cardType: cardTypeFromPlaid(acct),
                              currentBalance: bal,
                              ...(acct.balances.limit != null ? { creditLimit: acct.balances.limit } : {}),
                          },
                          select: { id: true },
                      });
            linkedCreditCardIds.add(card.id);
            await db.plaidAccount.create({
                data: {
                    userId,
                    plaidItemId,
                    plaidAccountId: acct.account_id,
                    name: acct.name,
                    officialName: acct.official_name ?? null,
                    mask,
                    type: acct.type,
                    subtype: acct.subtype ?? null,
                    creditCardId: card.id,
                    balanceCurrent: acct.balances.current,
                    balanceAvailable: acct.balances.available,
                    balanceLimit: acct.balances.limit,
                    lastBalanceSyncAt: new Date(),
                } as Parameters<typeof db.plaidAccount.create>[0]["data"],
            });
            continue;
        }

        if (acct.type === "depository" || acct.type === "loan" || acct.type === "investment" || acct.type === "brokerage") {
            const kind = accountKindFromPlaid(acct);
            const bal = acct.balances.current ?? 0;
            const existingFinAccountId = await findExistingFinAccountForPlaid(userId, institutionId, acct, linkedFinAccountIds);
            const fin =
                existingFinAccountId
                    ? await db.finAccount.update({
                          where: { id: existingFinAccountId },
                          data: {
                              ...(institutionId ? { institutionId } : {}),
                              last4: mask,
                              currentBalance: bal,
                              lastBalanceAt: new Date(),
                          },
                          select: { id: true },
                      })
                    : await db.finAccount.create({
                          data: {
                              userId,
                              institutionId,
                              kind,
                              nickname: displayName,
                              last4: mask,
                              isAsset: kind !== "LOAN",
                              currentBalance: bal,
                              lastBalanceAt: new Date(),
                          },
                          select: { id: true },
                      });
            linkedFinAccountIds.add(fin.id);
            await db.plaidAccount.create({
                data: {
                    userId,
                    plaidItemId,
                    plaidAccountId: acct.account_id,
                    name: acct.name,
                    officialName: acct.official_name ?? null,
                    mask,
                    type: acct.type,
                    subtype: acct.subtype ?? null,
                    finAccountId: fin.id,
                    balanceCurrent: acct.balances.current,
                    balanceAvailable: acct.balances.available,
                    balanceLimit: acct.balances.limit,
                    lastBalanceSyncAt: new Date(),
                } as Parameters<typeof db.plaidAccount.create>[0]["data"],
            });
        }
    }
}

function merchantFromPlaid(tx: PlaidTransaction): string | null {
    return tx.merchant_name ?? tx.name ?? null;
}

function plaidCategoryLabel(tx: PlaidTransaction): string | null {
    const pfc = tx.personal_finance_category?.primary;
    if (pfc) return pfc.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const legacy = tx.category?.[0];
    return legacy ?? null;
}

const GENERIC_TRANSACTION_TOKENS = new Set(["payment", "purchase", "debit", "credit", "card", "check", "pos", "ach", "web", "online"]);

function transactionTextTokens(value: string | null | undefined): Set<string> {
    return new Set(
        normalizeMatchText(value)
            .split(" ")
            .map((token) => token.trim())
            .filter((token) => token.length >= 4 && !GENERIC_TRANSACTION_TOKENS.has(token)),
    );
}

function transactionTextMatches(plaidTexts: Array<string | null | undefined>, rowTexts: Array<string | null | undefined>): boolean {
    for (const plaidText of plaidTexts) {
        for (const rowText of rowTexts) {
            if (textLooksRelated(plaidText, [rowText])) return true;
            const plaidTokens = transactionTextTokens(plaidText);
            const rowTokens = transactionTextTokens(rowText);
            if (!plaidTokens.size || !rowTokens.size) continue;
            const shared = [...plaidTokens].filter((token) => rowTokens.has(token));
            if (shared.some((token) => token.length >= 6)) return true;
            const overlap = shared.length / Math.min(plaidTokens.size, rowTokens.size);
            if (shared.length >= 2 && overlap >= 0.67) return true;
        }
    }
    return false;
}

/** Map Plaid category labels to the user's BudgetCategory rows (best-effort). */
async function resolveBudgetCategoryId(userId: string, plaidLabel: string | null): Promise<string | null> {
    if (!plaidLabel) return null;
    const key = plaidLabel.toLowerCase();
    const aliases: Record<string, string[]> = {
        "food and drink": ["food", "dining", "restaurants", "groceries"],
        travel: ["travel", "vacation"],
        shops: ["shopping", "retail"],
        recreation: ["entertainment", "fun"],
        service: ["services"],
        healthcare: ["health", "medical"],
        payment: ["bills", "utilities"],
        transfer: ["transfer"],
        "bank fees": ["fees"],
    };
    const cats = await db.budgetCategory.findMany({ where: { userId }, select: { id: true, name: true } });
    const direct = cats.find((c) => c.name.toLowerCase() === key || c.name.toLowerCase().includes(key));
    if (direct) return direct.id;
    for (const [plaidKey, names] of Object.entries(aliases)) {
        if (!key.includes(plaidKey)) continue;
        const hit = cats.find((c) => names.some((n) => c.name.toLowerCase().includes(n)));
        if (hit) return hit.id;
    }
    return null;
}

function parseOptionalPlaidDate(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    return parsePlaidDate(iso);
}

/** /accounts/get — refresh balances and persist to linked FinAccount / CreditCard rows. */
export async function syncPlaidAccountsFromPlaid(plaidItemDbId: string): Promise<{ accounts: number }> {
    const item = await db.plaidItem.findUnique({
        where: { id: plaidItemDbId },
        include: {
            accounts: {
                select: { id: true, plaidAccountId: true, finAccountId: true, creditCardId: true, type: true },
            },
        },
    });
    if (!item) throw new Error("Plaid item not found");

    const client = plaidClient();
    const res = await client.accountsGet({
        access_token: openIntegrationSecret(item.accessToken, { provider: "plaid", userId: item.userId, field: "accessToken" }),
    });
    const byPlaidId = new Map(item.accounts.map((a) => [a.plaidAccountId, a]));
    const now = new Date();
    let count = 0;

    for (const acct of res.data.accounts) {
        const mapped = byPlaidId.get(acct.account_id);
        if (!mapped) continue;

        const current = acct.balances.current ?? null;
        const available = acct.balances.available ?? null;
        const limit = acct.balances.limit ?? null;

        await db.plaidAccount.update({
            where: { id: mapped.id },
            data: {
                balanceCurrent: current,
                balanceAvailable: available,
                balanceLimit: limit,
                lastBalanceSyncAt: now,
            } as Parameters<typeof db.plaidAccount.update>[0]["data"],
        });

        if (mapped.finAccountId && current != null) {
            await db.finAccount.update({
                where: { id: mapped.finAccountId },
                data: { currentBalance: current, lastBalanceAt: now },
            });
        }

        if (mapped.creditCardId && current != null) {
            await db.creditCard.update({
                where: { id: mapped.creditCardId },
                data: {
                    currentBalance: Math.abs(current),
                    ...(limit != null ? { creditLimit: limit } : {}),
                },
            });
        }
        count++;
    }

    await db.plaidItem.update({
        where: { id: plaidItemDbId },
        data: { lastAccountsSyncAt: now },
    });

    return { accounts: count };
}

/** /liabilities/get — credit limits, APR, minimum payment, due dates. */
export async function syncPlaidLiabilitiesFromPlaid(plaidItemDbId: string): Promise<{ cards: number }> {
    const item = await db.plaidItem.findUnique({
        where: { id: plaidItemDbId },
        include: {
            accounts: {
                where: { creditCardId: { not: null } },
                select: { plaidAccountId: true, creditCardId: true },
            },
        },
    });
    if (!item) throw new Error("Plaid item not found");
    if (item.accounts.length === 0) return { cards: 0 };

    const client = plaidClient();
    let credit: CreditCardLiability[] = [];
    try {
        const res = await client.liabilitiesGet({
            access_token: openIntegrationSecret(item.accessToken, { provider: "plaid", userId: item.userId, field: "accessToken" }),
        });
        credit = res.data.liabilities.credit ?? [];
    } catch (e) {
        // Liabilities may be unavailable for some institutions in sandbox.
        console.warn("[plaid] liabilities/get skipped:", e);
        return { cards: 0 };
    }

    const cardByPlaidId = new Map(
        item.accounts.filter((a) => a.creditCardId).map((a) => [a.plaidAccountId, a.creditCardId!]),
    );
    let count = 0;

    for (const liab of credit) {
        if (!liab.account_id) continue;
        const creditCardId = cardByPlaidId.get(liab.account_id);
        if (!creditCardId) continue;

        const purchaseApr = liab.aprs?.find((a) => a.apr_type === "purchase_apr") ?? liab.aprs?.[0];

        await db.creditCard.update({
            where: { id: creditCardId },
            data: {
                ...(purchaseApr?.apr_percentage != null ? { apr: purchaseApr.apr_percentage } : {}),
                ...(liab.last_statement_balance != null ? { lastStatementBalance: liab.last_statement_balance } : {}),
                ...(liab.minimum_payment_amount != null ? { minimumPayment: liab.minimum_payment_amount } : {}),
                ...(liab.last_payment_amount != null ? { lastPaymentAmount: liab.last_payment_amount } : {}),
                paymentDueAt: parseOptionalPlaidDate(liab.next_payment_due_date),
                paymentOverdue: liab.is_overdue ?? false,
                ...(liab.last_statement_balance != null ? { currentBalance: Math.abs(liab.last_statement_balance) } : {}),
            },
        });
        count++;
    }

    return { cards: count };
}

/** Full item sync: accounts → liabilities → transactions (server-side only). */
export async function syncPlaidItemFull(plaidItemDbId: string): Promise<PlaidSyncResult & { accounts: number; liabilityCards: number }> {
    const accounts = await syncPlaidAccountsFromPlaid(plaidItemDbId);
    const liabilityCards = await syncPlaidLiabilitiesFromPlaid(plaidItemDbId);
    const txns = await syncPlaidItemTransactions(plaidItemDbId);
    return { ...txns, accounts: accounts.accounts, liabilityCards: liabilityCards.cards };
}

type PlaidUpsertStatus = "added" | "updated" | "linked" | "skipped";

async function findExistingLifeTransactionForPlaid(
    userId: string,
    finAccountId: string | null,
    creditCardId: string | null,
    date: Date,
    amount: number,
    tx: PlaidTransaction,
    dedupHash: string,
): Promise<{ id: string; merchant: string | null; rawDescription: string | null; categoryId: string | null } | null> {
    const ownerWhere = finAccountId ? { finAccountId } : creditCardId ? { creditCardId } : {};
    const candidates = await db.finTransaction.findMany({
        where: {
            userId,
            plaidTransactionId: null,
            date,
            amount,
            ...ownerWhere,
        },
        select: { id: true, merchant: true, rawDescription: true, categoryId: true, dedupHash: true },
        take: 20,
    });
    if (!candidates.length) return null;

    const plaidTexts = [tx.merchant_name, tx.name];
    const textMatch = candidates.find((row) => transactionTextMatches(plaidTexts, [row.merchant, row.rawDescription]));
    if (textMatch) return textMatch;

    // Manual/CSV imports use the same generic dedupe hash. Statement rows use a stronger owner-scoped hash,
    // so this fallback intentionally only handles non-statement rows that were imported before Plaid sync.
    return candidates.find((row) => row.dedupHash === dedupHash) ?? null;
}

async function upsertPlaidTransaction(
    userId: string,
    finAccountId: string | null,
    creditCardId: string | null,
    tx: PlaidTransaction,
): Promise<PlaidUpsertStatus> {
    const dateStr = tx.date;
    const amount = plaidAmountToLife(tx.amount);
    const merchant = merchantFromPlaid(tx);
    const hash = transactionDedupHash(dateStr, amount, merchant);
    const date = parsePlaidDate(dateStr);

    const existingByPlaid = await db.finTransaction.findUnique({
        where: { plaidTransactionId: tx.transaction_id },
        select: { id: true, source: true },
    });

    const plaidCategory = plaidCategoryLabel(tx);
    const categoryId = await resolveBudgetCategoryId(userId, plaidCategory);

    const data = {
        date,
        amount,
        merchant,
        rawDescription: tx.name,
        pending: tx.pending,
        source: "PLAID" as TransactionSource,
        plaidCategory,
        ...(categoryId ? { categoryId } : {}),
        finAccountId,
        creditCardId,
    };

    if (existingByPlaid) {
        await db.finTransaction.update({
            where: { id: existingByPlaid.id },
            data: existingByPlaid.source === "PLAID" ? data : { ...data, source: existingByPlaid.source },
        });
        return "updated";
    }

    const existingLifeRow = await findExistingLifeTransactionForPlaid(userId, finAccountId, creditCardId, date, amount, tx, hash);
    if (existingLifeRow) {
        await db.finTransaction.update({
            where: { id: existingLifeRow.id },
            data: {
                plaidTransactionId: tx.transaction_id,
                finAccountId,
                creditCardId,
                pending: tx.pending,
                plaidCategory,
                ...(merchant && !existingLifeRow.merchant ? { merchant } : {}),
                ...(tx.name && !existingLifeRow.rawDescription ? { rawDescription: tx.name } : {}),
                ...(categoryId && !existingLifeRow.categoryId ? { categoryId } : {}),
            },
        });
        return "linked";
    }

    await db.finTransaction.create({
        data: {
            userId,
            plaidTransactionId: tx.transaction_id,
            dedupHash: hash,
            ...data,
        },
    });
    return "added";
}

export interface PlaidSyncResult {
    added: number;
    updated: number;
    linked: number;
    removed: number;
    skipped: number;
}

/** Sync transactions for a single Plaid Item using /transactions/sync. */
export async function syncPlaidItemTransactions(plaidItemDbId: string): Promise<PlaidSyncResult> {
    const item = await db.plaidItem.findUnique({
        where: { id: plaidItemDbId },
        include: {
            accounts: {
                select: {
                    id: true,
                    plaidAccountId: true,
                    finAccountId: true,
                    creditCardId: true,
                },
            },
        },
    });
    if (!item) throw new Error("Plaid item not found");

    const accountByPlaidId = new Map(item.accounts.map((a) => [a.plaidAccountId, a]));
    const client = plaidClient();

    let cursor = item.transactionsCursor ?? undefined;
    let hasMore = true;
    const result: PlaidSyncResult = { added: 0, updated: 0, linked: 0, removed: 0, skipped: 0 };

    while (hasMore) {
        const res = await client.transactionsSync({
            access_token: openIntegrationSecret(item.accessToken, { provider: "plaid", userId: item.userId, field: "accessToken" }),
            cursor,
        });

        for (const tx of res.data.added) {
            const mapped = accountByPlaidId.get(tx.account_id);
            if (!mapped || (!mapped.finAccountId && !mapped.creditCardId)) {
                result.skipped++;
                continue;
            }
            const status = await upsertPlaidTransaction(item.userId, mapped.finAccountId, mapped.creditCardId, tx);
            if (status === "added") result.added++;
            else if (status === "updated") result.updated++;
            else if (status === "linked") result.linked++;
            else result.skipped++;
        }

        for (const tx of res.data.modified) {
            const mapped = accountByPlaidId.get(tx.account_id);
            if (!mapped || (!mapped.finAccountId && !mapped.creditCardId)) continue;
            const status = await upsertPlaidTransaction(item.userId, mapped.finAccountId, mapped.creditCardId, tx);
            if (status === "updated") result.updated++;
            else if (status === "added") result.added++;
            else if (status === "linked") result.linked++;
        }

        for (const removed of res.data.removed) {
            const detached = await db.finTransaction.updateMany({
                where: { userId: item.userId, plaidTransactionId: removed.transaction_id, source: { not: "PLAID" } },
                data: { plaidTransactionId: null, pending: false },
            });
            const deleted = await db.finTransaction.deleteMany({
                where: { userId: item.userId, plaidTransactionId: removed.transaction_id, source: "PLAID" },
            });
            result.updated += detached.count;
            result.removed += deleted.count;
        }

        cursor = res.data.next_cursor;
        hasMore = res.data.has_more;
    }

    await db.plaidItem.update({
        where: { id: plaidItemDbId },
        data: {
            transactionsCursor: cursor ?? item.transactionsCursor,
            lastSyncedAt: new Date(),
            status: "good",
            errorCode: null,
        },
    });

    // Plaid-linked balances come from /accounts/get — refresh those instead of txn-sum recompute.
    try {
        await syncPlaidAccountsFromPlaid(plaidItemDbId);
    } catch (e) {
        console.warn("[plaid] post-txn balance refresh failed:", e);
    }

    return result;
}
