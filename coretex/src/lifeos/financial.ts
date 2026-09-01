import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import { getObjectBytes, isObjectStorageKey } from "./assets.js";
import { GENERIC_TOTAL_CATEGORY } from "./financial/category-data.js";

type DecimalValue = number | string | { toString(): string } | null | undefined;

const DAY_MS = 86_400_000;
const LIQUID_ACCOUNT_KINDS = new Set(["CHECKING", "SAVINGS", "MONEY_MARKET"]);
const DEDUCTIBLE_MARKER = /\[\[deductible(?::([^\]]+))?\]\]/i;

function numberValue(value: DecimalValue): number {
    const result = Number(value ?? 0);
    return Number.isFinite(result) ? result : 0;
}

function round(value: number, digits = 2): number {
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
    return values.length > 0 ? sum(values) / values.length : 0;
}

function percent(value: number, total: number): number {
    return total > 0 ? round((value / total) * 100, 1) : 0;
}

function isoDate(value: Date | null | undefined): string | null {
    return value ? value.toISOString().slice(0, 10) : null;
}

function isoDateTime(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
}

function monthKey(value: Date): string {
    return value.toISOString().slice(0, 7);
}

function monthBounds(value = new Date()): { start: Date; end: Date } {
    return {
        start: new Date(Date.UTC(value.getFullYear(), value.getMonth(), 1)),
        end: new Date(Date.UTC(value.getFullYear(), value.getMonth() + 1, 1)),
    };
}

function addUtcMonths(value: Date, months: number): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}

function accountLabel(account: { nickname: string | null; last4: string | null; kind?: string }): string {
    return account.nickname || `${account.kind ?? "Account"}${account.last4 ? ` ••${account.last4}` : ""}`;
}

function cardLabel(card: { nickname: string | null; productName: string | null; issuer: string | null; last4?: string | null }): string {
    const name = card.nickname || card.productName || card.issuer || "Card";
    return card.last4 ? `${name} ••${card.last4}` : name;
}

function monthlySubscriptionCost(amount: number, cadence: string): number {
    if (cadence === "YEARLY") return amount / 12;
    if (cadence === "WEEKLY") return (amount * 52) / 12;
    return amount;
}

function recurrenceDays(cadence: string): number | null {
    if (cadence === "WEEKLY") return 7;
    if (cadence === "MONTHLY") return 30;
    if (cadence === "YEARLY") return 365;
    return null;
}

function parseDeductible(notes: string | null): { deductible: boolean; category: string | null; notes: string | null } {
    const match = notes?.match(DEDUCTIBLE_MARKER);
    const cleaned = notes?.replace(DEDUCTIBLE_MARKER, "").trim() || null;
    return { deductible: Boolean(match), category: match?.[1]?.trim() || null, notes: cleaned };
}

/** Read-only account inventory. Plaid and Alpaca values are displayed from the local sync mirror. */
export async function getAccounts(userId: string) {
    const accounts = await prisma.finAccount.findMany({
        where: { userId },
        orderBy: [{ archived: "asc" }, { createdAt: "desc" }],
        select: {
            id: true,
            kind: true,
            institution: true,
            nickname: true,
            last4: true,
            currency: true,
            currentBalance: true,
            lastBalanceAt: true,
            isAsset: true,
            includeInNetWorth: true,
            archived: true,
            openedAt: true,
            closedAt: true,
            notes: true,
            alpacaLinked: true,
            institutionRef: { select: { id: true, name: true, website: true } },
            owners: { select: { id: true, displayName: true } },
            holdings: { select: { id: true, symbol: true, shares: true, currentPrice: true, costBasisPerShare: true, asOf: true } },
            transactions: {
                orderBy: [{ date: "desc" }, { createdAt: "desc" }],
                take: 500,
                select: { id: true, date: true, amount: true, merchant: true, rawDescription: true, pending: true, source: true, category: { select: { name: true } } },
            },
            statements: {
                orderBy: { createdAt: "desc" },
                take: 100,
                select: { id: true, fileName: true, periodStart: true, periodEnd: true, endingBalance: true, processingStatus: true, extractedTransactionCount: true },
            },
            plaidAccount: {
                select: {
                    id: true,
                    name: true,
                    officialName: true,
                    mask: true,
                    type: true,
                    subtype: true,
                    balanceCurrent: true,
                    balanceAvailable: true,
                    lastBalanceSyncAt: true,
                    plaidItem: { select: { institutionName: true, status: true, lastSyncedAt: true } },
                },
            },
            _count: { select: { transactions: true, statements: true } },
        },
    });

    const rows = accounts.map((account) => {
        const balance = numberValue(account.currentBalance);
        const holdingValue = sum(account.holdings.map((holding) => numberValue(holding.shares) * numberValue(holding.currentPrice)));
        return {
            id: account.id,
            name: accountLabel(account),
            kind: account.kind,
            institution: account.institutionRef?.name ?? account.plaidAccount?.plaidItem.institutionName ?? account.institution ?? "Independent",
            institutionWebsite: account.institutionRef?.website ?? null,
            last4: account.last4,
            currency: account.currency,
            balance,
            holdingValue: round(holdingValue),
            isAsset: account.isAsset,
            includeInNetWorth: account.includeInNetWorth,
            archived: account.archived,
            notes: account.notes,
            openedAt: isoDate(account.openedAt),
            closedAt: isoDate(account.closedAt),
            lastUpdated: isoDateTime(account.plaidAccount?.lastBalanceSyncAt ?? account.lastBalanceAt),
            source: account.plaidAccount ? "PLAID" : account.alpacaLinked ? "ALPACA" : "MANUAL",
            connectionStatus: account.plaidAccount?.plaidItem.status ?? (account.alpacaLinked ? "linked" : null),
            availableBalance: account.plaidAccount?.balanceAvailable == null ? null : numberValue(account.plaidAccount.balanceAvailable),
            transactionCount: account._count.transactions,
            statementCount: account._count.statements,
            owners: account.owners.map((owner) => ({ id: owner.id, name: owner.displayName })),
            holdings: account.holdings.map((holding) => ({
                id: holding.id,
                symbol: holding.symbol,
                shares: numberValue(holding.shares),
                currentPrice: holding.currentPrice == null ? null : numberValue(holding.currentPrice),
                costBasisPerShare: holding.costBasisPerShare == null ? null : numberValue(holding.costBasisPerShare),
                asOf: isoDateTime(holding.asOf),
            })),
            transactions: account.transactions.map((transaction) => ({
                id: transaction.id,
                date: isoDate(transaction.date),
                merchant: transaction.merchant || transaction.rawDescription || "Transaction",
                description: transaction.rawDescription,
                category: transaction.category?.name ?? "Uncategorized",
                amount: numberValue(transaction.amount),
                pending: transaction.pending,
                source: transaction.source,
            })),
            statements: account.statements.map((statement) => ({
                id: statement.id,
                fileName: statement.fileName,
                periodStart: isoDate(statement.periodStart),
                periodEnd: isoDate(statement.periodEnd),
                endingBalance: statement.endingBalance == null ? null : numberValue(statement.endingBalance),
                status: statement.processingStatus,
                extractedTransactions: statement.extractedTransactionCount ?? 0,
            })),
        };
    });
    const active = rows.filter((row) => !row.archived);
    const assets = sum(active.filter((row) => row.isAsset).map((row) => Math.max(0, row.balance)));
    const liabilities = sum(active.filter((row) => !row.isAsset).map((row) => Math.abs(row.balance))) +
        sum(active.filter((row) => row.isAsset && row.balance < 0).map((row) => Math.abs(row.balance)));

    return {
        summary: {
            activeAccounts: active.length,
            assetBalance: round(assets),
            liabilityBalance: round(liabilities),
            netAccountBalance: round(assets - liabilities),
            connectedAccounts: active.filter((row) => row.source !== "MANUAL").length,
        },
        accounts: rows,
        integrations: { plaid: "READ_ONLY", alpaca: "READ_ONLY" },
    };
}

export async function getCards(userId: string) {
    const cards = await prisma.creditCard.findMany({
        where: { userId },
        orderBy: [{ archived: "asc" }, { createdAt: "desc" }],
        select: {
            id: true,
            nickname: true,
            productName: true,
            issuer: true,
            cardType: true,
            last4: true,
            apr: true,
            creditLimit: true,
            currentBalance: true,
            minimumPayment: true,
            paymentDueAt: true,
            paymentOverdue: true,
            lastPaymentAmount: true,
            lastStatementBalance: true,
            openedAt: true,
            closedAt: true,
            archived: true,
            notes: true,
            institutionRef: { select: { id: true, name: true, website: true } },
            owners: { select: { id: true, displayName: true } },
            rewards: { orderBy: { order: "asc" }, select: { id: true, category: true, type: true, rate: true, cap: true } },
            transactions: {
                orderBy: [{ date: "desc" }, { createdAt: "desc" }],
                take: 500,
                select: { id: true, date: true, amount: true, merchant: true, rawDescription: true, pending: true, source: true, category: { select: { name: true } } },
            },
            statements: {
                orderBy: { createdAt: "desc" },
                take: 100,
                select: { id: true, fileName: true, periodStart: true, periodEnd: true, endingBalance: true, processingStatus: true, extractedTransactionCount: true },
            },
            plaidAccount: {
                select: {
                    balanceCurrent: true,
                    balanceAvailable: true,
                    balanceLimit: true,
                    lastBalanceSyncAt: true,
                    plaidItem: { select: { institutionName: true, status: true } },
                },
            },
            _count: { select: { transactions: true, statements: true, perks: true } },
        },
    });

    const rows = cards.map((card) => {
        const balance = numberValue(card.currentBalance);
        const limit = card.creditLimit == null ? numberValue(card.plaidAccount?.balanceLimit) : numberValue(card.creditLimit);
        return {
            id: card.id,
            name: cardLabel(card),
            institution: card.institutionRef?.name ?? card.plaidAccount?.plaidItem.institutionName ?? card.issuer ?? "Unknown",
            institutionWebsite: card.institutionRef?.website ?? null,
            cardType: card.cardType,
            last4: card.last4,
            aprPercent: card.apr == null ? null : numberValue(card.apr),
            balance,
            creditLimit: limit || null,
            utilizationPercent: percent(balance, limit),
            minimumPayment: card.minimumPayment == null ? null : numberValue(card.minimumPayment),
            paymentDueAt: isoDate(card.paymentDueAt),
            paymentOverdue: card.paymentOverdue,
            lastPaymentAmount: card.lastPaymentAmount == null ? null : numberValue(card.lastPaymentAmount),
            lastStatementBalance: card.lastStatementBalance == null ? null : numberValue(card.lastStatementBalance),
            openedAt: isoDate(card.openedAt),
            closedAt: isoDate(card.closedAt),
            archived: card.archived,
            notes: card.notes,
            source: card.plaidAccount ? "PLAID" : "MANUAL",
            connectionStatus: card.plaidAccount?.plaidItem.status ?? null,
            lastUpdated: isoDateTime(card.plaidAccount?.lastBalanceSyncAt),
            owners: card.owners.map((owner) => ({ id: owner.id, name: owner.displayName })),
            rewards: card.rewards.map((reward) => ({ ...reward })),
            perkCount: card._count.perks,
            transactionCount: card._count.transactions,
            statementCount: card._count.statements,
            transactions: card.transactions.map((transaction) => ({
                id: transaction.id,
                date: isoDate(transaction.date),
                merchant: transaction.merchant || transaction.rawDescription || "Transaction",
                description: transaction.rawDescription,
                category: transaction.category?.name ?? "Uncategorized",
                amount: numberValue(transaction.amount),
                pending: transaction.pending,
                source: transaction.source,
            })),
            statements: card.statements.map((statement) => ({
                id: statement.id,
                fileName: statement.fileName,
                periodStart: isoDate(statement.periodStart),
                periodEnd: isoDate(statement.periodEnd),
                endingBalance: statement.endingBalance == null ? null : numberValue(statement.endingBalance),
                status: statement.processingStatus,
                extractedTransactions: statement.extractedTransactionCount ?? 0,
            })),
        };
    });
    const active = rows.filter((row) => !row.archived);
    const totalBalance = sum(active.map((row) => row.balance));
    const totalLimit = sum(active.map((row) => row.creditLimit ?? 0));

    return {
        summary: {
            activeCards: active.length,
            totalBalance: round(totalBalance),
            totalCreditLimit: round(totalLimit),
            utilizationPercent: percent(totalBalance, totalLimit),
            minimumPayments: round(sum(active.map((row) => row.minimumPayment ?? 0))),
        },
        cards: rows,
        integrations: { plaid: "READ_ONLY" },
    };
}

export async function getCredit(userId: string) {
    const [scores, cards] = await Promise.all([
        prisma.creditScoreEntry.findMany({
            where: { userId },
            orderBy: { scoreDate: "asc" },
            take: 480,
            select: { id: true, bureau: true, score: true, scoreDate: true, notes: true },
        }),
        prisma.creditCard.findMany({
            where: { userId, archived: false },
            select: { currentBalance: true, creditLimit: true, plaidAccount: { select: { balanceLimit: true } } },
        }),
    ]);
    const totalBalance = sum(cards.map((card) => numberValue(card.currentBalance)));
    const totalLimit = sum(cards.map((card) => numberValue(card.creditLimit ?? card.plaidAccount?.balanceLimit)));
    const latestByBureau = new Map<string, { score: number; scoreDate: string | null }>();
    for (const score of scores) {
        const bureau = (score.bureau ?? "OTHER").toUpperCase();
        latestByBureau.set(bureau, { score: score.score, scoreDate: isoDate(score.scoreDate) });
    }
    const latest = scores.at(-1);

    // Multi-bureau line series: one point per date, columns for Experian / Equifax / TransUnion.
    const byDate = new Map<string, Record<string, number | string | null>>();
    for (const score of scores) {
        const date = isoDate(score.scoreDate) ?? "";
        if (!date) continue;
        const row = byDate.get(date) ?? { date, experian: null, equifax: null, transunion: null };
        const bureau = (score.bureau ?? "").toUpperCase();
        if (bureau.includes("EXPERIAN")) row.experian = score.score;
        else if (bureau.includes("EQUIFAX")) row.equifax = score.score;
        else if (bureau.includes("TRANSUNION") || bureau.includes("TRANS UNION")) row.transunion = score.score;
        byDate.set(date, row);
    }
    // Forward-fill so each bureau's line stays continuous across missing dates.
    let lastE: number | null = null, lastQ: number | null = null, lastT: number | null = null;
    const history = [...byDate.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, row]) => {
            if (typeof row.experian === "number") lastE = row.experian;
            if (typeof row.equifax === "number") lastQ = row.equifax;
            if (typeof row.transunion === "number") lastT = row.transunion;
            return {
                id: date,
                date,
                label: date,
                experian: lastE,
                equifax: lastQ,
                transunion: lastT,
            };
        });

    return {
        summary: {
            latestScore: latest?.score ?? 0,
            scoreEntries: scores.length,
            utilizationPercent: percent(totalBalance, totalLimit),
            revolvingBalance: round(totalBalance),
            availableCredit: round(Math.max(0, totalLimit - totalBalance)),
            experian: latestByBureau.get("EXPERIAN")?.score ?? 0,
            equifax: latestByBureau.get("EQUIFAX")?.score ?? 0,
            transunion: latestByBureau.get("TRANSUNION")?.score ?? 0,
        },
        scores: scores.map((score) => ({
            id: score.id,
            bureau: score.bureau ?? "OTHER",
            score: score.score,
            date: isoDate(score.scoreDate),
            notes: score.notes,
        })),
        history,
        latestByBureau: Object.fromEntries(latestByBureau),
        bureaus: ["EXPERIAN", "EQUIFAX", "TRANSUNION"] as const,
    };
}

export async function getDebt(userId: string) {
    const [debts, cards] = await Promise.all([
        prisma.debt.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            select: { id: true, name: true, kind: true, principalOriginal: true, principalRemaining: true, apr: true, minimumPayment: true, payoffGoalDate: true, strategy: true },
        }),
        prisma.creditCard.findMany({
            where: { userId, archived: false, currentBalance: { gt: 0 } },
            orderBy: { currentBalance: "desc" },
            select: { id: true, nickname: true, productName: true, issuer: true, last4: true, currentBalance: true, creditLimit: true, apr: true, minimumPayment: true, paymentDueAt: true },
        }),
    ]);
    const debtRows = debts.map((debt) => ({
        id: debt.id,
        name: debt.name,
        kind: debt.kind ?? "Other",
        originalBalance: debt.principalOriginal == null ? null : numberValue(debt.principalOriginal),
        balance: numberValue(debt.principalRemaining),
        aprPercent: debt.apr == null ? null : numberValue(debt.apr),
        minimumPayment: debt.minimumPayment == null ? 0 : numberValue(debt.minimumPayment),
        payoffGoalDate: isoDate(debt.payoffGoalDate),
        strategy: debt.strategy,
        source: "DEBT",
    }));
    const cardRows = cards.map((card) => ({
        id: `card:${card.id}`,
        name: cardLabel(card),
        kind: "Credit card",
        originalBalance: card.creditLimit == null ? null : numberValue(card.creditLimit),
        balance: numberValue(card.currentBalance),
        aprPercent: card.apr == null ? null : numberValue(card.apr),
        minimumPayment: numberValue(card.minimumPayment),
        payoffGoalDate: isoDate(card.paymentDueAt),
        strategy: null,
        source: "CARD",
    }));
    const rows = [...debtRows, ...cardRows];
    const totalDebt = sum(rows.map((row) => row.balance));
    const interestWeight = sum(rows.map((row) => row.balance * (row.aprPercent ?? 0)));

    return {
        summary: {
            debtAccounts: rows.length,
            totalDebt: round(totalDebt),
            minimumPayments: round(sum(rows.map((row) => row.minimumPayment))),
            weightedAprPercent: totalDebt > 0 ? round(interestWeight / totalDebt, 2) : 0,
        },
        debts: rows,
    };
}

export async function getInstitutions(userId: string) {
    const [institutions, plaidItems, alpaca] = await Promise.all([
        prisma.institution.findMany({
            where: { userId },
            orderBy: { name: "asc" },
            select: {
                id: true,
                name: true,
                website: true,
                notes: true,
                phones: { select: { id: true, label: true, phone: true } },
                emails: { select: { id: true, label: true, email: true } },
                people: { select: { id: true, name: true, role: true, phone: true, email: true } },
                _count: { select: { accounts: true, cards: true } },
            },
        }),
        prisma.plaidItem.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            select: { id: true, institutionId: true, institutionName: true, status: true, errorCode: true, lastSyncedAt: true, lastAccountsSyncAt: true, _count: { select: { accounts: true } } },
        }),
        prisma.alpacaConnection.findUnique({ where: { userId }, select: { id: true, activePaper: true, updatedAt: true } }),
    ]);
    // Pull linked account/card nicknames for each institution (for card view + detail).
    const [linkedAccounts, linkedCards] = await Promise.all([
        prisma.finAccount.findMany({
            where: { userId, archived: false, institutionId: { not: null } },
            select: { id: true, nickname: true, last4: true, kind: true, currentBalance: true, institutionId: true },
        }),
        prisma.creditCard.findMany({
            where: { userId, archived: false },
            select: { id: true, nickname: true, productName: true, issuer: true, last4: true, currentBalance: true, institutionId: true },
        }),
    ]);
    const rows = institutions.map((institution) => {
        const accounts = linkedAccounts.filter((a) => a.institutionId === institution.id).map((a) => ({
            id: a.id,
            name: accountLabel(a),
            kind: a.kind,
            balance: numberValue(a.currentBalance),
        }));
        const cards = linkedCards.filter((c) => c.institutionId === institution.id || (c.issuer && c.issuer.toLowerCase() === institution.name.toLowerCase())).map((c) => ({
            id: c.id,
            name: cardLabel(c),
            balance: numberValue(c.currentBalance),
        }));
        return {
            id: institution.id,
            name: institution.name,
            website: institution.website,
            accountCount: institution._count.accounts,
            cardCount: institution._count.cards,
            phoneCount: institution.phones.length,
            emailCount: institution.emails.length,
            contactCount: institution.people.length,
            notes: institution.notes,
            phones: institution.phones,
            emails: institution.emails,
            contacts: institution.people,
            accounts,
            cards,
            logoDomain: (() => {
                const website = institution.website?.trim();
                if (website) {
                    try {
                        return new URL(website.includes("://") ? website : `https://${website}`).hostname.replace(/^www\./, "");
                    } catch { /* fall through */ }
                }
                return institution.name.toLowerCase().replace(/[^a-z0-9]+/g, "") + ".com";
            })(),
        };
    });
    const connections = [
        ...plaidItems.map((item) => ({
            id: item.id,
            provider: "Plaid",
            institution: item.institutionName ?? item.institutionId ?? "Connected institution",
            status: item.status,
            accounts: item._count.accounts,
            lastSyncedAt: isoDateTime(item.lastSyncedAt ?? item.lastAccountsSyncAt),
            error: item.errorCode,
            mode: "READ_ONLY",
        })),
        ...(alpaca ? [{ id: alpaca.id, provider: "Alpaca", institution: "Alpaca brokerage", status: "connected", accounts: 1, lastSyncedAt: isoDateTime(alpaca.updatedAt), error: null, mode: "READ_ONLY" }] : []),
    ];

    return {
        summary: {
            institutions: rows.length,
            connectedInstitutions: connections.length,
            linkedAccounts: sum(connections.map((connection) => connection.accounts)),
            connectionIssues: connections.filter((connection) => !["good", "connected"].includes(connection.status.toLowerCase())).length,
        },
        institutions: rows,
        connections,
    };
}

function ownerMonogram(nickname: string): string {
    const trimmed = nickname.trim();
    return (trimmed.slice(0, 2) || "??").toUpperCase();
}

const TRANSACTION_PAGE_SIZE = 500;

function transactionPageValue(value: unknown, fallback: number, maximum: number): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(0, Math.trunc(parsed)));
}

export async function getTransactions(userId: string, request: Record<string, unknown> = {}) {
    const { start, end } = monthBounds();
    const limit = Math.max(1, transactionPageValue(request.limit, TRANSACTION_PAGE_SIZE, TRANSACTION_PAGE_SIZE));
    const offset = transactionPageValue(request.offset, 0, 1_000_000);
    const [transactions, categories, manualAccounts, manualCards, inflow, outflow, pending, total] = await Promise.all([
        prisma.finTransaction.findMany({
            where: { userId },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            skip: offset,
            take: limit,
            select: {
                id: true,
                date: true,
                amount: true,
                currency: true,
                merchant: true,
                rawDescription: true,
                pending: true,
                source: true,
                plaidCategory: true,
                plaidTransactionId: true,
                notes: true,
                receiptKey: true,
                receiptFileName: true,
                category: { select: { id: true, name: true, color: true } },
                finAccount: { select: { id: true } },
                creditCard: { select: { id: true } },
                statement: { select: { id: true, fileName: true } },
                splits: { select: { id: true, amount: true, note: true, categoryId: true } },
            },
        }),
        prisma.budgetCategory.findMany({ where: { userId, name: { not: GENERIC_TOTAL_CATEGORY } }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
        prisma.finAccount.findMany({
            where: { userId, archived: false, alpacaLinked: false, plaidAccount: { is: null } },
            orderBy: { nickname: "asc" },
            select: { id: true, nickname: true, last4: true, kind: true, institution: true },
        }),
        prisma.creditCard.findMany({
            where: { userId, archived: false },
            orderBy: { nickname: "asc" },
            select: { id: true, nickname: true, last4: true, productName: true, issuer: true },
        }),
        prisma.finTransaction.aggregate({ where: { userId, date: { gte: start, lt: end }, amount: { gt: 0 } }, _sum: { amount: true } }),
        prisma.finTransaction.aggregate({ where: { userId, date: { gte: start, lt: end }, amount: { lt: 0 } }, _sum: { amount: true } }),
        prisma.finTransaction.count({ where: { userId, pending: true } }),
        prisma.finTransaction.count({ where: { userId } }),
    ]);
    const income = numberValue(inflow._sum.amount);
    const spending = Math.abs(numberValue(outflow._sum.amount));
    const accountName = new Map<string, string>();
    for (const account of manualAccounts) accountName.set(account.id, account.nickname || "Account");
    for (const card of manualCards) accountName.set(card.id, card.nickname || card.productName || card.issuer || "Card");

    return {
        summary: {
            loadedTransactions: transactions.length,
            totalTransactions: total,
            monthIncome: round(income),
            monthSpending: round(spending),
            monthNetCashFlow: round(income - spending),
            pendingTransactions: pending,
        },
        pagination: {
            offset,
            limit,
            total,
            hasPrevious: offset > 0,
            hasMore: offset + transactions.length < total,
        },
        transactions: transactions.map((transaction) => ({
            id: transaction.id,
            date: isoDate(transaction.date),
            merchant: transaction.merchant,
            rawDescription: transaction.rawDescription,
            amount: numberValue(transaction.amount),
            currency: transaction.currency,
            finAccountId: transaction.finAccount?.id ?? null,
            creditCardId: transaction.creditCard?.id ?? null,
            account: transaction.finAccount?.id
                ? (accountName.get(transaction.finAccount.id) ?? null)
                : transaction.creditCard?.id
                  ? (accountName.get(transaction.creditCard.id) ?? null)
                  : null,
            categoryId: transaction.category?.id ?? null,
            category: transaction.category?.name ?? "Uncategorized",
            categoryColor: transaction.category?.color ?? null,
            pending: transaction.pending,
            source: transaction.source,
            plaidTransactionId: transaction.plaidTransactionId,
            plaidCategory: transaction.plaidCategory,
            hasReceipt: Boolean(transaction.receiptKey),
            receiptFileName: transaction.receiptFileName,
            notes: transaction.notes,
            statementId: transaction.statement?.id ?? null,
            statement: transaction.statement ? { id: transaction.statement.id, fileName: transaction.statement.fileName } : null,
            splits: transaction.splits.map((split) => ({ categoryId: split.categoryId, amount: numberValue(split.amount) })),
        })),
        categories: categories.map((category) => ({ id: category.id, label: category.name, color: category.color })),
        accounts: manualAccounts.map((account) => ({
            id: account.id,
            kind: "account" as const,
            nickname: account.nickname || "Account",
            institution: account.institution,
            monogram: ownerMonogram(account.nickname || "Ac"),
            masked: account.last4 ? `••${account.last4}` : null,
            typeLabel: titleCaseWord(account.kind),
        })),
        cards: manualCards.map((card) => ({
            id: card.id,
            kind: "card" as const,
            nickname: card.nickname || card.productName || card.issuer || "Card",
            institution: card.issuer,
            monogram: ownerMonogram(card.nickname || card.productName || "Cd"),
            masked: card.last4 ? `••${card.last4}` : null,
            typeLabel: card.productName || "Card",
        })),
    };
}

function titleCaseWord(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export async function getStatements(userId: string) {
    const [statements, accounts, cards] = await Promise.all([
        prisma.finStatement.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 10_000,
            select: {
            id: true,
            fileName: true,
            mimeType: true,
            fileSize: true,
            finAccountId: true,
            creditCardId: true,
            periodStart: true,
            periodEnd: true,
            endingBalance: true,
            extractedTransactionCount: true,
            processingStatus: true,
            processedAt: true,
            aiExtractedAt: true,
            processingError: true,
            rawExtraction: true,
            createdAt: true,
            finAccount: { select: { id: true, nickname: true, last4: true, kind: true } },
            creditCard: { select: { id: true, nickname: true, productName: true, issuer: true, last4: true } },
            brokerageAccount: { select: { id: true, accountName: true, brokerage: true } },
            },
        }),
        prisma.finAccount.findMany({
            where: { userId, archived: false },
            orderBy: { nickname: "asc" },
            select: { id: true, nickname: true, last4: true, kind: true },
        }),
        prisma.creditCard.findMany({
            where: { userId, archived: false },
            orderBy: { nickname: "asc" },
            select: { id: true, nickname: true, productName: true, issuer: true, last4: true },
        }),
    ]);
    const statusCount = (status: string) => statements.filter((statement) => statement.processingStatus === status).length;
    const rows = statements.map((statement) => ({
        id: statement.id,
        fileName: statement.fileName,
        mimeType: statement.mimeType,
        finAccountId: statement.finAccountId,
        creditCardId: statement.creditCardId,
        ownerRef: statement.finAccountId ? `account:${statement.finAccountId}` : statement.creditCardId ? `card:${statement.creditCardId}` : "",
        owner: statement.finAccount
            ? accountLabel(statement.finAccount)
            : statement.creditCard
              ? cardLabel(statement.creditCard)
              : statement.brokerageAccount?.accountName || statement.brokerageAccount?.brokerage || "Unassigned",
        periodStart: isoDate(statement.periodStart),
        periodEnd: isoDate(statement.periodEnd),
        endingBalance: statement.endingBalance == null ? null : numberValue(statement.endingBalance),
        status: statement.processingStatus,
        extractedTransactions: statement.extractedTransactionCount ?? 0,
        fileSize: statement.fileSize ?? 0,
        uploadedAt: isoDateTime(statement.createdAt),
        processedAt: isoDateTime(statement.processedAt),
        aiExtractedAt: isoDateTime(statement.aiExtractedAt),
        extraction: statement.rawExtraction,
        error: statement.processingError,
    }));

    return {
        summary: {
            statements: rows.length,
            processed: statusCount("DONE"),
            pending: statusCount("PENDING") + statusCount("PROCESSING"),
            failed: statusCount("FAILED"),
            extractedTransactions: sum(rows.map((row) => row.extractedTransactions)),
        },
        statements: rows,
        accounts: accounts.map((account) => ({ id: account.id, name: accountLabel(account) })),
        cards: cards.map((card) => ({ id: card.id, name: cardLabel(card) })),
    };
}

export async function getImportStatus(userId: string) {
    const [statements, sourceGroups, accountCount, cardCount, taxDocumentCount] = await Promise.all([
        prisma.finStatement.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: { id: true, fileName: true, fileSize: true, processingStatus: true, extractedTransactionCount: true, processingError: true, createdAt: true, processedAt: true },
        }),
        prisma.finTransaction.groupBy({ by: ["source"], where: { userId }, _count: { _all: true } }),
        prisma.finAccount.count({ where: { userId } }),
        prisma.creditCard.count({ where: { userId } }),
        prisma.taxDocument.count({ where: { userId } }),
    ]);
    const done = statements.filter((statement) => statement.processingStatus === "DONE").length;
    const failed = statements.filter((statement) => statement.processingStatus === "FAILED").length;
    const processing = statements.filter((statement) => statement.processingStatus === "PROCESSING").length;
    const pending = statements.filter((statement) => statement.processingStatus === "PENDING").length;

    return {
        summary: {
            imports: statements.length,
            completed: done,
            inProgress: pending + processing,
            failed,
            completionPercent: percent(done, statements.length),
            importedTransactions: sum(sourceGroups.map((group) => group._count._all)),
        },
        recentStatements: statements.map((statement) => ({
            id: statement.id,
            fileName: statement.fileName,
            status: statement.processingStatus,
            transactions: statement.extractedTransactionCount ?? 0,
            fileSize: statement.fileSize ?? 0,
            uploadedAt: isoDateTime(statement.createdAt),
            processedAt: isoDateTime(statement.processedAt),
            error: statement.processingError,
        })),
        sourceCounts: sourceGroups.map((group) => ({ id: group.source, source: group.source, transactions: group._count._all })),
        inventory: { accounts: accountCount, cards: cardCount, taxDocuments: taxDocumentCount },
    };
}

export async function getSubscriptions(userId: string) {
    const subscriptions = await prisma.finSubscription.findMany({
        where: { userId },
        orderBy: [{ status: "asc" }, { nextChargeOn: "asc" }],
        select: { id: true, name: true, merchant: true, cadence: true, amount: true, currency: true, status: true, startedOn: true, cancelledOn: true, nextChargeOn: true, notes: true, _count: { select: { transactions: true } } },
    });
    const rows = subscriptions.map((subscription) => ({
        id: subscription.id,
        name: subscription.name || subscription.merchant,
        merchant: subscription.merchant,
        cadence: subscription.cadence,
        amount: numberValue(subscription.amount),
        monthlyCost: round(monthlySubscriptionCost(numberValue(subscription.amount), subscription.cadence)),
        currency: subscription.currency,
        status: subscription.status,
        startedOn: isoDate(subscription.startedOn),
        cancelledOn: isoDate(subscription.cancelledOn),
        nextChargeOn: isoDate(subscription.nextChargeOn),
        transactionCount: subscription._count.transactions,
        notes: subscription.notes,
    }));
    const active = rows.filter((row) => row.status === "ACTIVE");
    const monthlyCost = sum(active.map((row) => row.monthlyCost));

    return {
        summary: {
            activeSubscriptions: active.length,
            monthlyCost: round(monthlyCost),
            annualCost: round(monthlyCost * 12),
            upcomingCharges: active.filter((row) => row.nextChargeOn).length,
        },
        subscriptions: rows,
    };
}

export async function getIncome(userId: string) {
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getFullYear(), 0, 1));
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
    const twelveMonthsAgo = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 11, 1));
    const [streams, manualAccounts, trendEntries, yearTotal, recentTotal] = await Promise.all([
        prisma.incomeStream.findMany({
            where: { userId },
            orderBy: [{ archived: "asc" }, { name: "asc" }],
            select: {
                id: true,
                name: true,
                kind: true,
                notes: true,
                archived: true,
                finAccount: { select: { id: true, nickname: true, last4: true, kind: true } },
                entries: { orderBy: { receivedAt: "desc" }, take: 24, select: { id: true, amount: true, currency: true, receivedAt: true, source: true, notes: true } },
            },
        }),
        prisma.finAccount.findMany({
            where: { userId, archived: false, alpacaLinked: false, plaidAccount: { is: null } },
            orderBy: { nickname: "asc" },
            select: { id: true, nickname: true, last4: true, kind: true },
        }),
        prisma.incomeEntry.findMany({ where: { userId, receivedAt: { gte: twelveMonthsAgo } }, select: { amount: true, receivedAt: true } }),
        prisma.incomeEntry.aggregate({ where: { userId, receivedAt: { gte: yearStart } }, _sum: { amount: true }, _count: { _all: true } }),
        prisma.incomeEntry.aggregate({ where: { userId, receivedAt: { gte: thirtyDaysAgo } }, _sum: { amount: true } }),
    ]);
    const monthly = new Map<string, number>();
    for (const entry of trendEntries) monthly.set(monthKey(entry.receivedAt), (monthly.get(monthKey(entry.receivedAt)) ?? 0) + numberValue(entry.amount));
    const months = Array.from({ length: 12 }, (_, index) => addUtcMonths(twelveMonthsAgo, index));

    return {
        summary: {
            activeStreams: streams.filter((stream) => !stream.archived).length,
            yearToDateIncome: round(numberValue(yearTotal._sum.amount)),
            last30DaysIncome: round(numberValue(recentTotal._sum.amount)),
            paymentsThisYear: yearTotal._count._all,
        },
        streams: streams.map((stream) => ({
            id: stream.id,
            name: stream.name,
            kind: stream.kind ?? "Income",
            finAccountId: stream.finAccount?.id ?? null,
            account: stream.finAccount ? accountLabel(stream.finAccount) : "Unassigned",
            archived: stream.archived,
            totalTracked: round(sum(stream.entries.map((entry) => numberValue(entry.amount)))),
            lastPayment: stream.entries[0] ? numberValue(stream.entries[0].amount) : 0,
            lastReceivedAt: isoDate(stream.entries[0]?.receivedAt),
            paymentCount: stream.entries.length,
            notes: stream.notes,
            entries: stream.entries.map((entry) => ({ id: entry.id, amount: numberValue(entry.amount), currency: entry.currency, receivedAt: isoDate(entry.receivedAt), source: entry.source, notes: entry.notes })),
        })),
        accounts: manualAccounts.map((account) => ({ id: account.id, name: accountLabel(account) })),
        monthly: months.map((month) => ({ id: monthKey(month), month: monthKey(month), income: round(monthly.get(monthKey(month)) ?? 0) })),
    };
}

export async function getBudget(userId: string) {
    const now = new Date();
    const { start, end } = monthBounds(now);
    const historyMonths = 12;
    const historyStart = addUtcMonths(start, -(historyMonths - 1));
    const [categories, genericRow, transactions] = await Promise.all([
        prisma.budgetCategory.findMany({
            where: { userId, name: { not: GENERIC_TOTAL_CATEGORY } },
            orderBy: { name: "asc" },
            select: { id: true, name: true, color: true, parentId: true, parent: { select: { name: true } }, monthlyBudget: true },
        }),
        prisma.budgetCategory.findFirst({ where: { userId, name: GENERIC_TOTAL_CATEGORY }, select: { monthlyBudget: true } }),
        prisma.finTransaction.findMany({
            where: { userId, date: { gte: historyStart, lt: end }, amount: { lt: 0 } },
            orderBy: { date: "desc" },
            select: { id: true, date: true, amount: true, merchant: true, rawDescription: true, categoryId: true, splits: { select: { amount: true, categoryId: true } } },
        }),
    ]);

    // Bucket spend by month, then by category (or "" for uncategorized), across the whole history window.
    const spentByMonth = new Map<string, Map<string, number>>();
    for (const transaction of transactions) {
        const key = monthKey(transaction.date);
        let bucket = spentByMonth.get(key);
        if (!bucket) { bucket = new Map<string, number>(); spentByMonth.set(key, bucket); }
        if (transaction.splits.length > 0) {
            for (const split of transaction.splits) {
                const amount = Math.abs(numberValue(split.amount));
                const catKey = split.categoryId ?? "";
                bucket.set(catKey, (bucket.get(catKey) ?? 0) + amount);
            }
        } else {
            const amount = Math.abs(numberValue(transaction.amount));
            const catKey = transaction.categoryId ?? "";
            bucket.set(catKey, (bucket.get(catKey) ?? 0) + amount);
        }
    }

    const currentMonthKey = monthKey(start);
    const currentSpent = spentByMonth.get(currentMonthKey) ?? new Map<string, number>();
    const uncategorized = currentSpent.get("") ?? 0;

    const rows = categories.map((category) => {
        const budget = category.monthlyBudget == null ? 0 : numberValue(category.monthlyBudget);
        const categorySpent = currentSpent.get(category.id) ?? 0;
        return {
            id: category.id,
            name: category.name,
            parentId: category.parentId,
            parent: category.parent?.name ?? null,
            color: category.color,
            monthlyBudget: round(budget),
            spent: round(categorySpent),
            remaining: round(budget - categorySpent),
            utilizationPercent: percent(categorySpent, budget),
        };
    });
    const totalBudget = sum(rows.map((row) => row.monthlyBudget));
    const totalSpent = sum(rows.map((row) => row.spent)) + uncategorized;
    const genericTotal = genericRow?.monthlyBudget == null ? null : round(numberValue(genericRow.monthlyBudget));

    // Trailing 12-month history for the budget-vs-actual chart (budget targets are constant; only spend varies by month).
    const months = Array.from({ length: historyMonths }, (_, index) => addUtcMonths(historyStart, index));
    const history = months.map((month) => {
        const key = monthKey(month);
        const bucket = spentByMonth.get(key) ?? new Map<string, number>();
        const monthUncategorized = bucket.get("") ?? 0;
        const categorySpend = rows.map((row) => ({ id: row.id, spent: round(bucket.get(row.id) ?? 0) }));
        return {
            month: key,
            totalBudget: round(genericTotal ?? totalBudget),
            totalSpent: round(sum(categorySpend.map((c) => c.spent)) + monthUncategorized),
            categories: categorySpend,
        };
    });

    // Per-category 12-month spending trend, derived from the same history buckets (for the drill-down chart).
    const spendingTrends: Record<string, Array<{ label: string; Spending: number }>> = {};
    for (const row of rows) {
        spendingTrends[row.id] = history.map((month) => ({ label: month.month, Spending: month.categories.find((c) => c.id === row.id)?.spent ?? 0 }));
    }

    // Recent transactions per category this month, for the drill-down list.
    const transactionsByCategory: Record<string, Array<{ id: string; date: string | null; amount: number; merchant: string }>> = {};
    for (const transaction of transactions) {
        if (monthKey(transaction.date) !== currentMonthKey) continue;
        const catId = transaction.categoryId;
        if (!catId) continue;
        const list = transactionsByCategory[catId] ?? (transactionsByCategory[catId] = []);
        if (list.length < 50) list.push({ id: transaction.id, date: isoDate(transaction.date), amount: numberValue(transaction.amount), merchant: transaction.merchant || transaction.rawDescription || "Transaction" });
    }

    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const monthPace = Math.min(1, now.getUTCDate() / daysInMonth);

    return {
        summary: {
            monthlyBudget: round(totalBudget),
            monthSpending: round(totalSpent),
            remainingBudget: round(totalBudget - totalSpent),
            utilizationPercent: percent(totalSpent, totalBudget),
            uncategorizedSpending: round(uncategorized),
        },
        month: currentMonthKey,
        categories: rows,
        uncategorizedSpend: round(uncategorized),
        monthPace,
        genericTotal,
        aiConfigured: true,
        history,
        spendingTrends,
        transactionsByCategory,
    };
}

export async function getGoals(userId: string) {
    const goals = await prisma.financialGoal.findMany({
        where: { userId },
        orderBy: [{ targetDate: "asc" }, { createdAt: "desc" }],
        select: { id: true, title: true, targetAmount: true, currentAmount: true, targetDate: true, createdAt: true, updatedAt: true },
    });
    const rows = goals.map((goal) => {
        const target = numberValue(goal.targetAmount);
        const current = numberValue(goal.currentAmount);
        return {
            id: goal.id,
            title: goal.title,
            targetAmount: target || null,
            currentAmount: current,
            remainingAmount: target > 0 ? round(Math.max(0, target - current)) : null,
            progressPercent: percent(current, target),
            targetDate: isoDate(goal.targetDate),
            updatedAt: isoDateTime(goal.updatedAt),
        };
    });
    const totalTarget = sum(rows.map((row) => row.targetAmount ?? 0));
    const totalCurrent = sum(rows.map((row) => row.currentAmount));

    return {
        summary: {
            goals: rows.length,
            totalTarget: round(totalTarget),
            totalSaved: round(totalCurrent),
            overallProgressPercent: percent(totalCurrent, totalTarget),
        },
        goals: rows,
    };
}

export async function getCurrencies(userId: string) {
    const [rates, accounts] = await Promise.all([
        prisma.exchangeRate.findMany({ orderBy: { code: "asc" }, select: { code: true, rateToUsd: true, asOf: true } }),
        prisma.finAccount.findMany({ where: { userId, archived: false }, orderBy: { currency: "asc" }, select: { id: true, nickname: true, last4: true, kind: true, currency: true, currentBalance: true } }),
    ]);
    const rateMap = new Map<string, number>([["USD", 1], ...rates.map((rate) => [rate.code, numberValue(rate.rateToUsd)] as [string, number])]);
    const balances = accounts.map((account) => {
        const balance = numberValue(account.currentBalance);
        const rate = rateMap.get(account.currency) ?? null;
        return {
            id: account.id,
            account: accountLabel(account),
            currency: account.currency,
            balance,
            rateToUsd: rate,
            valueUsd: rate == null ? null : round(balance * rate),
        };
    });
    const lastUpdated = rates.length > 0 ? rates.reduce((latest, rate) => rate.asOf > latest ? rate.asOf : latest, rates[0].asOf) : null;

    return {
        summary: {
            currencies: new Set(balances.map((balance) => balance.currency)).size,
            foreignAccounts: balances.filter((balance) => balance.currency !== "USD").length,
            foreignValueUsd: round(sum(balances.filter((balance) => balance.currency !== "USD").map((balance) => balance.valueUsd ?? 0))),
            missingRates: balances.filter((balance) => balance.rateToUsd == null).length,
        },
        balances,
        rates: [{ id: "USD", code: "USD", rateToUsd: 1, asOf: isoDateTime(lastUpdated) }, ...rates.map((rate) => ({ id: rate.code, code: rate.code, rateToUsd: numberValue(rate.rateToUsd), asOf: isoDateTime(rate.asOf) }))],
        lastUpdated: isoDateTime(lastUpdated),
    };
}

export async function getTax(userId: string) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const firstYear = currentYear - 3;
    const start = new Date(Date.UTC(firstYear, 0, 1));
    const [documents, income, spending] = await Promise.all([
        prisma.taxDocument.findMany({ where: { userId }, orderBy: [{ taxYear: "desc" }, { createdAt: "desc" }], select: { id: true, taxYear: true, kind: true, description: true, fileName: true, fileKey: true, notes: true, createdAt: true, updatedAt: true } }),
        prisma.incomeEntry.findMany({ where: { userId, receivedAt: { gte: start } }, select: { amount: true, receivedAt: true } }),
        prisma.finTransaction.findMany({ where: { userId, date: { gte: start }, amount: { lt: 0 } }, select: { amount: true, date: true, notes: true } }),
    ]);
    const yearly = new Map<number, { income: number; spending: number; deductible: number }>();
    for (let year = firstYear; year <= currentYear; year += 1) yearly.set(year, { income: 0, spending: 0, deductible: 0 });
    for (const entry of income) {
        const bucket = yearly.get(entry.receivedAt.getUTCFullYear());
        if (bucket) bucket.income += numberValue(entry.amount);
    }
    for (const transaction of spending) {
        const bucket = yearly.get(transaction.date.getUTCFullYear());
        if (!bucket) continue;
        const amount = Math.abs(numberValue(transaction.amount));
        bucket.spending += amount;
        if (parseDeductible(transaction.notes).deductible) bucket.deductible += amount;
    }
    const current = yearly.get(currentYear) ?? { income: 0, spending: 0, deductible: 0 };

    return {
        summary: {
            taxDocuments: documents.length,
            currentYearIncome: round(current.income),
            currentYearSpending: round(current.spending),
            currentYearDeductions: round(current.deductible),
        },
        documents: documents.map((document) => ({ id: document.id, taxYear: document.taxYear, kind: document.kind ?? "Other", description: document.description, fileName: document.fileName, hasFile: Boolean(document.fileKey), notes: document.notes, addedAt: isoDateTime(document.createdAt), updatedAt: isoDateTime(document.updatedAt) })),
        years: [...yearly.entries()].sort((a, b) => b[0] - a[0]).map(([year, values]) => ({ id: String(year), year, income: round(values.income), spending: round(values.spending), deductible: round(values.deductible), documents: documents.filter((document) => document.taxYear === year).length })),
        documentKinds: [...TAX_DOCUMENT_KINDS],
    };
}

/** IRS Schedule C–style expense categories for self-employed / business deductions. */
export const SCHEDULE_C_CATEGORIES = [
    "Advertising",
    "Car and truck expenses",
    "Commissions and fees",
    "Contract labor",
    "Depletion",
    "Depreciation",
    "Employee benefit programs",
    "Insurance (other than health)",
    "Interest (mortgage)",
    "Interest (other)",
    "Legal and professional services",
    "Office expense",
    "Pension and profit-sharing plans",
    "Rent or lease (vehicles)",
    "Rent or lease (other)",
    "Repairs and maintenance",
    "Supplies",
    "Taxes and licenses",
    "Travel",
    "Meals",
    "Utilities",
    "Wages",
    "Other expenses",
] as const;

/** Transaction-based deduction ledger; markers are read but never mutated here. */
export async function getDeductions(userId: string, payload?: MutationPayload) {
    const nowYear = new Date().getFullYear();
    const requestedYear = payload && typeof payload === "object" && !Array.isArray(payload) ? Number((payload as Record<string, unknown>).year) : NaN;
    const year = Number.isFinite(requestedYear) && requestedYear >= 1900 && requestedYear <= 2200 ? requestedYear : nowYear;
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const transactions = await prisma.finTransaction.findMany({
        where: { userId, date: { gte: start, lt: end }, amount: { lt: 0 } },
        orderBy: { date: "desc" },
        take: 2000,
        select: { id: true, date: true, amount: true, merchant: true, rawDescription: true, notes: true, category: { select: { name: true, color: true } } },
    });
    const rows = transactions.map((transaction) => {
        const parsed = parseDeductible(transaction.notes);
        return {
            id: transaction.id,
            date: isoDate(transaction.date),
            merchant: transaction.merchant || transaction.rawDescription || "Transaction",
            category: transaction.category?.name ?? "Uncategorized",
            categoryColor: transaction.category?.color ?? null,
            deductionCategory: parsed.category ?? null,
            deductible: parsed.deductible,
            amount: numberValue(transaction.amount),
            note: parsed.notes,
        };
    });
    const deductible = rows.filter((row) => row.deductible);
    const categories = new Map<string, number>();
    for (const row of deductible) categories.set(row.deductionCategory ?? "Uncategorized", (categories.get(row.deductionCategory ?? "Uncategorized") ?? 0) + Math.abs(row.amount));

    return {
        summary: {
            taxYear: year,
            deductibleTransactions: deductible.length,
            totalDeductions: round(sum(deductible.map((row) => Math.abs(row.amount)))),
            reviewedTransactions: transactions.length,
        },
        rows,
        year,
        years: Array.from({ length: 4 }, (_, index) => nowYear - index),
        categories: [...categories.entries()].sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ id: category, category, amount: round(amount) })),
        scheduleCCategories: [...SCHEDULE_C_CATEGORIES],
    };
}

/** Income-entry analysis for the desktop paycheck screen; this is historical, not tax advice. */
export async function getPaycheck(userId: string) {
    const since = new Date(Date.now() - 365 * DAY_MS);
    const entries = await prisma.incomeEntry.findMany({
        where: { userId },
        orderBy: { receivedAt: "desc" },
        take: 100,
        select: { id: true, amount: true, currency: true, receivedAt: true, source: true, notes: true, stream: { select: { id: true, name: true, kind: true } } },
    });
    const recent = entries.filter((entry) => entry.receivedAt >= since);
    const amounts = recent.slice(0, 12).map((entry) => numberValue(entry.amount));
    const dates = recent.map((entry) => entry.receivedAt.getTime()).sort((a, b) => b - a);
    const intervals = dates.slice(0, -1).map((value, index) => Math.abs(value - dates[index + 1]) / DAY_MS).filter((value) => value > 0);
    const sortedIntervals = [...intervals].sort((a, b) => a - b);
    const medianDays = sortedIntervals.length > 0 ? sortedIntervals[Math.floor(sortedIntervals.length / 2)] : 0;
    const frequency = medianDays <= 9 ? "Weekly" : medianDays <= 18 ? "Biweekly" : medianDays <= 40 ? "Monthly" : "Irregular";
    const periods = frequency === "Weekly" ? 52 : frequency === "Biweekly" ? 26 : frequency === "Monthly" ? 12 : recent.length;
    const avg = average(amounts);

    return {
        summary: {
            latestPayment: entries[0] ? numberValue(entries[0].amount) : 0,
            averagePayment: round(avg),
            trailingTwelveMonths: round(sum(recent.map((entry) => numberValue(entry.amount)))),
            inferredAnnualIncome: round(avg * periods),
            paymentsTracked: recent.length,
            inferredFrequency: frequency,
        },
        paychecks: entries.map((entry) => ({ id: entry.id, date: isoDate(entry.receivedAt), stream: entry.stream.name, kind: entry.stream.kind ?? "Income", amount: numberValue(entry.amount), currency: entry.currency, source: entry.source, notes: entry.notes })),
    };
}

export async function getNetWorth(userId: string) {
    const [accounts, cards, debts, snapshots] = await Promise.all([
        prisma.finAccount.findMany({ where: { userId, archived: false, includeInNetWorth: true }, select: { id: true, nickname: true, last4: true, kind: true, isAsset: true, currentBalance: true, currency: true, institutionRef: { select: { name: true } } } }),
        prisma.creditCard.findMany({ where: { userId, archived: false }, select: { id: true, nickname: true, productName: true, issuer: true, last4: true, currentBalance: true } }),
        prisma.debt.findMany({ where: { userId }, select: { id: true, name: true, kind: true, principalRemaining: true } }),
        prisma.netWorthSnapshot.findMany({ where: { userId }, orderBy: { asOf: "asc" }, take: 120, select: { id: true, asOf: true, assets: true, liabilities: true, netWorth: true } }),
    ]);
    const breakdown: Array<{ id: string; name: string; kind: string; type: "ASSET" | "LIABILITY"; amount: number; currency: string; institution: string | null }> = [];
    for (const account of accounts) {
        const balance = numberValue(account.currentBalance);
        if (account.isAsset && balance >= 0) breakdown.push({ id: account.id, name: accountLabel(account), kind: account.kind, type: "ASSET", amount: balance, currency: account.currency, institution: account.institutionRef?.name ?? null });
        else breakdown.push({ id: account.id, name: accountLabel(account), kind: account.kind, type: "LIABILITY", amount: Math.abs(balance), currency: account.currency, institution: account.institutionRef?.name ?? null });
    }
    for (const card of cards) {
        const balance = numberValue(card.currentBalance);
        if (balance > 0) breakdown.push({ id: `card:${card.id}`, name: cardLabel(card), kind: "CREDIT_CARD", type: "LIABILITY", amount: balance, currency: "USD", institution: card.issuer });
    }
    for (const debt of debts) {
        const balance = numberValue(debt.principalRemaining);
        if (balance > 0) breakdown.push({ id: `debt:${debt.id}`, name: debt.name, kind: debt.kind ?? "DEBT", type: "LIABILITY", amount: balance, currency: "USD", institution: null });
    }
    const assets = sum(breakdown.filter((item) => item.type === "ASSET").map((item) => item.amount));
    const liabilities = sum(breakdown.filter((item) => item.type === "LIABILITY").map((item) => item.amount));
    const netWorth = assets - liabilities;
    const previous = snapshots.at(-1);

    return {
        summary: {
            totalAssets: round(assets),
            totalLiabilities: round(liabilities),
            netWorth: round(netWorth),
            changeSinceSnapshot: round(netWorth - numberValue(previous?.netWorth)),
        },
        breakdown: breakdown.sort((a, b) => b.amount - a.amount),
        history: snapshots.map((snapshot) => ({ id: snapshot.id, date: isoDate(snapshot.asOf), assets: numberValue(snapshot.assets), liabilities: numberValue(snapshot.liabilities), netWorth: numberValue(snapshot.netWorth) })),
    };
}

export async function getCalendar(userId: string) {
    const now = new Date();
    const horizon = new Date(now.getTime() + 90 * DAY_MS);
    const [subscriptions, cards] = await Promise.all([
        prisma.finSubscription.findMany({ where: { userId, status: "ACTIVE", nextChargeOn: { not: null } }, select: { id: true, name: true, merchant: true, cadence: true, amount: true, currency: true, nextChargeOn: true } }),
        prisma.creditCard.findMany({ where: { userId, archived: false, paymentDueAt: { not: null } }, select: { id: true, nickname: true, productName: true, issuer: true, last4: true, minimumPayment: true, paymentDueAt: true, paymentOverdue: true } }),
    ]);
    const events: Array<{ id: string; date: string | null; label: string; amount: number; currency: string; kind: string; overdue: boolean }> = [];
    for (const subscription of subscriptions) {
        if (!subscription.nextChargeOn) continue;
        const cadence = recurrenceDays(subscription.cadence);
        let date = new Date(subscription.nextChargeOn);
        let occurrence = 0;
        while (date <= horizon && occurrence < 20) {
            if (date >= new Date(now.getTime() - 31 * DAY_MS)) events.push({ id: `subscription:${subscription.id}:${occurrence}`, date: isoDate(date), label: subscription.name || subscription.merchant, amount: numberValue(subscription.amount), currency: subscription.currency, kind: "SUBSCRIPTION", overdue: date < now });
            if (!cadence) break;
            date = new Date(date.getTime() + cadence * DAY_MS);
            occurrence += 1;
        }
    }
    for (const card of cards) {
        if (!card.paymentDueAt || numberValue(card.minimumPayment) <= 0) continue;
        events.push({ id: `card:${card.id}`, date: isoDate(card.paymentDueAt), label: `${cardLabel(card)} payment`, amount: numberValue(card.minimumPayment), currency: "USD", kind: "CARD_PAYMENT", overdue: card.paymentOverdue || card.paymentDueAt < now });
    }
    events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const next30 = new Date(now.getTime() + 30 * DAY_MS);
    const upcoming = events.filter((event) => event.date && new Date(`${event.date}T00:00:00Z`) <= next30 && !event.overdue);

    return {
        summary: {
            scheduledEvents: events.length,
            next30DaysTotal: round(sum(upcoming.map((event) => event.amount))),
            overdueEvents: events.filter((event) => event.overdue).length,
            upcomingEvents: events.filter((event) => !event.overdue).length,
        },
        events,
    };
}

export async function getForecast(userId: string) {
    const now = new Date();
    const currentMonth = monthBounds(now).start;
    const historyStart = addUtcMonths(currentMonth, -6);
    const [accounts, transactions, subscriptions, cards] = await Promise.all([
        prisma.finAccount.findMany({ where: { userId, archived: false, kind: { in: ["CHECKING", "SAVINGS", "MONEY_MARKET"] } }, select: { currentBalance: true } }),
        prisma.finTransaction.findMany({ where: { userId, date: { gte: historyStart } }, select: { amount: true, date: true } }),
        prisma.finSubscription.findMany({ where: { userId, status: "ACTIVE" }, select: { amount: true, cadence: true } }),
        prisma.creditCard.findMany({ where: { userId, archived: false }, select: { minimumPayment: true } }),
    ]);
    // Forecast is driven by income, not a blend of every discretionary purchase:
    // averaging in dining/shopping/etc. noise from the trailing months made the
    // projection swing with one-off spending. Recurring obligations (subscriptions,
    // card minimums) are still subtracted since they're known, not noise.
    const monthlyIncome = new Map<string, number>();
    for (const transaction of transactions) {
        const amount = numberValue(transaction.amount);
        if (amount > 0) monthlyIncome.set(monthKey(transaction.date), (monthlyIncome.get(monthKey(transaction.date)) ?? 0) + amount);
    }
    const completeMonthFlows = [...monthlyIncome.entries()].filter(([key]) => key < monthKey(currentMonth)).map(([, value]) => value);
    const recurringExpenses = sum(subscriptions.map((subscription) => monthlySubscriptionCost(numberValue(subscription.amount), subscription.cadence))) + sum(cards.map((card) => numberValue(card.minimumPayment)));
    const averageIncome = completeMonthFlows.length > 0 ? average(completeMonthFlows) : 0;
    const averageNet = averageIncome - recurringExpenses;
    const startingCash = sum(accounts.map((account) => numberValue(account.currentBalance)));
    let projected = startingCash;
    const projections = Array.from({ length: 6 }, (_, index) => {
        projected += averageNet;
        const date = addUtcMonths(currentMonth, index + 1);
        return { id: monthKey(date), month: monthKey(date), projectedCash: round(projected), projectedNetFlow: round(averageNet), recurringObligations: round(recurringExpenses) };
    });

    return {
        summary: {
            startingCash: round(startingCash),
            averageMonthlyNet: round(averageNet),
            recurringObligations: round(recurringExpenses),
            projectedSixMonthCash: projections.at(-1)?.projectedCash ?? round(startingCash),
            historyMonths: completeMonthFlows.length,
        },
        projections,
    };
}

export async function getReports(userId: string) {
    const now = new Date();
    const historyMonths = 24;
    const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - (historyMonths - 1), 1));
    const [transactions, snapshots] = await Promise.all([
        prisma.finTransaction.findMany({
            where: { userId, date: { gte: start } },
            orderBy: { date: "desc" },
            take: 10_000,
            select: {
                id: true,
                date: true,
                amount: true,
                merchant: true,
                rawDescription: true,
                category: { select: { id: true, name: true } },
                finAccount: { select: { nickname: true, last4: true, kind: true } },
                creditCard: { select: { nickname: true, productName: true, issuer: true, last4: true } },
                splits: { select: { amount: true, category: { select: { id: true, name: true } } } },
            },
        }),
        prisma.netWorthSnapshot.findMany({ where: { userId, asOf: { gte: start } }, orderBy: { asOf: "asc" }, select: { id: true, asOf: true, netWorth: true } }),
    ]);
    const monthMap = new Map<string, { income: number; spending: number }>();
    const categoryMap = new Map<string, number>();
    const reportRows: Array<{ id: string; date: string | null; merchant: string; category: string; account: string; amount: number }> = [];
    for (const transaction of transactions) {
        const key = monthKey(transaction.date);
        const bucket = monthMap.get(key) ?? { income: 0, spending: 0 };
        const amount = numberValue(transaction.amount);
        const merchant = transaction.merchant || transaction.rawDescription || "Transaction";
        const account = transaction.finAccount ? accountLabel(transaction.finAccount) : transaction.creditCard ? cardLabel(transaction.creditCard) : "Unassigned";
        if (amount >= 0) {
            bucket.income += amount;
        } else if (transaction.splits.length > 0) {
            for (const split of transaction.splits) {
                const splitAmount = numberValue(split.amount);
                bucket.spending += Math.abs(splitAmount);
                const category = split.category?.name ?? "Uncategorized";
                categoryMap.set(category, (categoryMap.get(category) ?? 0) + Math.abs(splitAmount));
            }
        } else {
            bucket.spending += Math.abs(amount);
            const category = transaction.category?.name ?? "Uncategorized";
            categoryMap.set(category, (categoryMap.get(category) ?? 0) + Math.abs(amount));
        }
        const splitCategories = [...new Set(transaction.splits.map((split) => split.category?.name ?? "Uncategorized"))];
        reportRows.push({
            id: transaction.id,
            date: isoDate(transaction.date),
            merchant,
            category: splitCategories.length > 0 ? splitCategories.join(", ") : transaction.category?.name ?? "Uncategorized",
            account,
            amount,
        });
        monthMap.set(key, bucket);
    }
    const months = Array.from({ length: historyMonths }, (_, index) => addUtcMonths(start, index));
    const monthly = months.map((month) => {
        const values = monthMap.get(monthKey(month)) ?? { income: 0, spending: 0 };
        return { id: monthKey(month), month: monthKey(month), income: round(values.income), spending: round(values.spending), netCashFlow: round(values.income - values.spending) };
    });
    const totalIncome = sum(monthly.map((row) => row.income));
    const totalSpending = sum(monthly.map((row) => row.spending));

    return {
        summary: {
            totalIncome: round(totalIncome),
            totalSpending: round(totalSpending),
            netCashFlow: round(totalIncome - totalSpending),
            averageMonthlySpending: round(totalSpending / historyMonths),
        },
        monthly,
        transactions: reportRows.slice(0, 5_000),
        categories: [...categoryMap.entries()].sort((a, b) => b[1] - a[1]).map(([category, spending]) => ({ id: category, category, spending: round(spending), sharePercent: percent(spending, totalSpending) })),
        netWorthHistory: snapshots.map((snapshot) => ({ id: snapshot.id, date: isoDate(snapshot.asOf), netWorth: numberValue(snapshot.netWorth) })),
    };
}

export async function getHealth(userId: string) {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS);
    const [netWorth, budget, credit, transactions, accounts] = await Promise.all([
        getNetWorth(userId),
        getBudget(userId),
        getCredit(userId),
        prisma.finTransaction.findMany({ where: { userId, date: { gte: ninetyDaysAgo } }, select: { amount: true } }),
        prisma.finAccount.findMany({ where: { userId, archived: false, kind: { in: ["CHECKING", "SAVINGS", "MONEY_MARKET"] } }, select: { currentBalance: true } }),
    ]);
    const income = sum(transactions.map((transaction) => Math.max(0, numberValue(transaction.amount))));
    const spending = sum(transactions.map((transaction) => Math.max(0, -numberValue(transaction.amount))));
    const monthlySpending = spending / 3;
    const liquid = sum(accounts.map((account) => numberValue(account.currentBalance)));
    const emergencyMonths = monthlySpending > 0 ? liquid / monthlySpending : 0;
    const savingsRate = income > 0 ? Math.max(-100, Math.min(100, ((income - spending) / income) * 100)) : 0;
    const debtToAssets = percent(netWorth.summary.totalLiabilities, netWorth.summary.totalAssets);
    const utilization = credit.summary.utilizationPercent;
    const budgetUse = budget.summary.utilizationPercent;
    const components = [
        { id: "emergency", label: "Emergency reserves", score: round(Math.min(100, (emergencyMonths / 6) * 100)), detail: `${round(emergencyMonths, 1)} months of spending` },
        { id: "savings", label: "Savings rate", score: round(Math.max(0, Math.min(100, (savingsRate / 20) * 100))), detail: `${round(savingsRate, 1)}% over 90 days` },
        { id: "debt", label: "Debt load", score: round(Math.max(0, 100 - debtToAssets)), detail: `${debtToAssets}% of assets` },
        { id: "credit", label: "Credit utilization", score: round(Math.max(0, 100 - utilization * 2)), detail: `${utilization}% utilized` },
        { id: "budget", label: "Budget adherence", score: budget.summary.monthlyBudget > 0 ? round(Math.max(0, 100 - Math.max(0, budgetUse - 100) * 2)) : 50, detail: budget.summary.monthlyBudget > 0 ? `${budgetUse}% used` : "No budget targets yet" },
    ];
    const score = Math.round(average(components.map((component) => component.score)));
    const recommendations: string[] = [];
    if (emergencyMonths < 3) recommendations.push("Build liquid reserves toward at least three months of typical spending.");
    if (utilization > 30) recommendations.push("Reduce revolving card balances below 30% utilization.");
    if (savingsRate < 10) recommendations.push("Review recurring expenses and target a 10% or better savings rate.");
    if (budget.summary.monthlyBudget <= 0) recommendations.push("Set monthly category targets so budget adherence can be measured.");

    return {
        summary: {
            healthScore: score,
            emergencyMonths: round(emergencyMonths, 1),
            savingsRatePercent: round(savingsRate, 1),
            debtToAssetsPercent: debtToAssets,
            creditUtilizationPercent: utilization,
        },
        grade: score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 55 ? "Fair" : "Needs attention",
        components,
        recommendations,
    };
}

export async function getAlerts(userId: string) {
    const now = new Date();
    const { start, end } = monthBounds(now);
    const [accounts, cards, subscriptions, categories, monthSpending, plaidItems] = await Promise.all([
        prisma.finAccount.findMany({ where: { userId, archived: false }, select: { id: true, nickname: true, last4: true, kind: true, currentBalance: true } }),
        prisma.creditCard.findMany({ where: { userId, archived: false }, select: { id: true, nickname: true, productName: true, issuer: true, last4: true, currentBalance: true, creditLimit: true, paymentDueAt: true, paymentOverdue: true, minimumPayment: true } }),
        prisma.finSubscription.findMany({ where: { userId, status: "ACTIVE", nextChargeOn: { not: null } }, select: { id: true, name: true, merchant: true, amount: true, nextChargeOn: true } }),
        prisma.budgetCategory.findMany({ where: { userId }, select: { monthlyBudget: true } }),
        prisma.finTransaction.aggregate({ where: { userId, date: { gte: start, lt: end }, amount: { lt: 0 } }, _sum: { amount: true } }),
        prisma.plaidItem.findMany({ where: { userId }, select: { id: true, institutionName: true, status: true, errorCode: true } }),
    ]);
    const alerts: Array<{ id: string; severity: "critical" | "warning" | "info"; title: string; detail: string; amount: number | null; dueDate: string | null }> = [];
    for (const account of accounts) {
        const balance = numberValue(account.currentBalance);
        if (LIQUID_ACCOUNT_KINDS.has(account.kind) && balance < 0) alerts.push({ id: `overdrawn:${account.id}`, severity: "critical", title: `${accountLabel(account)} is overdrawn`, detail: "The locally mirrored balance is below zero.", amount: Math.abs(balance), dueDate: null });
    }
    for (const card of cards) {
        const balance = numberValue(card.currentBalance);
        const limit = numberValue(card.creditLimit);
        const utilization = percent(balance, limit);
        if (card.paymentOverdue) alerts.push({ id: `overdue:${card.id}`, severity: "critical", title: `${cardLabel(card)} payment is overdue`, detail: "Review the issuer balance and due date.", amount: numberValue(card.minimumPayment), dueDate: isoDate(card.paymentDueAt) });
        else if (card.paymentDueAt) {
            const days = Math.ceil((card.paymentDueAt.getTime() - now.getTime()) / DAY_MS);
            if (days >= 0 && days <= 7) alerts.push({ id: `due:${card.id}`, severity: days <= 2 ? "warning" : "info", title: `${cardLabel(card)} payment is due soon`, detail: `Due in ${days} day${days === 1 ? "" : "s"}.`, amount: numberValue(card.minimumPayment), dueDate: isoDate(card.paymentDueAt) });
        }
        if (utilization >= 80) alerts.push({ id: `utilization:${card.id}`, severity: utilization >= 95 ? "critical" : "warning", title: `${cardLabel(card)} utilization is high`, detail: `${utilization}% of the recorded limit is in use.`, amount: balance, dueDate: null });
    }
    for (const subscription of subscriptions) {
        if (!subscription.nextChargeOn) continue;
        const days = Math.ceil((subscription.nextChargeOn.getTime() - now.getTime()) / DAY_MS);
        if (days >= 0 && days <= 3) alerts.push({ id: `subscription:${subscription.id}`, severity: "info", title: `${subscription.name || subscription.merchant} renews soon`, detail: `Expected in ${days} day${days === 1 ? "" : "s"}.`, amount: numberValue(subscription.amount), dueDate: isoDate(subscription.nextChargeOn) });
    }
    const budget = sum(categories.map((category) => numberValue(category.monthlyBudget)));
    const spending = Math.abs(numberValue(monthSpending._sum.amount));
    if (budget > 0 && spending > budget) alerts.push({ id: `budget:${monthKey(now)}`, severity: "warning", title: "Monthly spending is over budget", detail: `${percent(spending, budget)}% of category targets has been spent.`, amount: spending - budget, dueDate: null });
    for (const item of plaidItems) {
        if (item.status.toLowerCase() !== "good") alerts.push({ id: `plaid:${item.id}`, severity: "warning", title: `${item.institutionName ?? "Plaid"} needs attention`, detail: item.errorCode || `Connection status: ${item.status}`, amount: null, dueDate: null });
    }
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);

    return {
        summary: {
            alerts: alerts.length,
            critical: alerts.filter((alert) => alert.severity === "critical").length,
            warnings: alerts.filter((alert) => alert.severity === "warning").length,
            information: alerts.filter((alert) => alert.severity === "info").length,
        },
        alerts,
    };
}

export async function getOverview(userId: string) {
    const { start, end } = monthBounds();
    const [netWorth, budget, income, subscriptions, credit, recentTransactions, categories, manualAccounts, manualCards, monthIncome, monthOutflow, plaidItems, alpaca, reports] = await Promise.all([
        getNetWorth(userId),
        getBudget(userId),
        getIncome(userId),
        getSubscriptions(userId),
        getCredit(userId),
        prisma.finTransaction.findMany({
            where: { userId, pending: false },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            take: 12,
            select: {
                id: true,
                date: true,
                amount: true,
                currency: true,
                merchant: true,
                rawDescription: true,
                pending: true,
                source: true,
                notes: true,
                receiptKey: true,
                receiptFileName: true,
                statementId: true,
                statement: { select: { id: true, fileName: true } },
                category: { select: { id: true, name: true, color: true } },
                finAccount: { select: { id: true, nickname: true } },
                creditCard: { select: { id: true, nickname: true, productName: true, issuer: true } },
                splits: { select: { categoryId: true, amount: true } },
            },
        }),
        prisma.budgetCategory.findMany({ where: { userId, name: { not: GENERIC_TOTAL_CATEGORY } }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
        prisma.finAccount.findMany({
            where: { userId, archived: false },
            orderBy: { nickname: "asc" },
            select: { id: true, nickname: true, last4: true, kind: true, institution: true },
        }),
        prisma.creditCard.findMany({
            where: { userId, archived: false },
            orderBy: { nickname: "asc" },
            select: { id: true, nickname: true, last4: true, productName: true, issuer: true },
        }),
        prisma.finTransaction.aggregate({ where: { userId, date: { gte: start, lt: end }, amount: { gt: 0 } }, _sum: { amount: true } }),
        prisma.finTransaction.aggregate({ where: { userId, date: { gte: start, lt: end }, amount: { lt: 0 } }, _sum: { amount: true } }),
        prisma.plaidItem.findMany({ where: { userId }, select: { id: true, institutionName: true, status: true, lastSyncedAt: true } }),
        prisma.alpacaConnection.findUnique({ where: { userId }, select: { id: true, activePaper: true, updatedAt: true } }),
        getReports(userId),
    ]);
    const currentIncome = numberValue(monthIncome._sum.amount);
    const currentSpending = Math.abs(numberValue(monthOutflow._sum.amount));

    return {
        summary: {
            netWorth: netWorth.summary.netWorth,
            monthIncome: round(currentIncome),
            monthSpending: round(currentSpending),
            monthNetCashFlow: round(currentIncome - currentSpending),
            budgetRemaining: budget.summary.remainingBudget,
            activeSubscriptions: subscriptions.summary.activeSubscriptions,
            creditScore: credit.summary.latestScore,
        },
        // Same row shape as financial:getTransactions so the shared ledger table works on overview.
        recentTransactions: recentTransactions.map((transaction) => ({
            id: transaction.id,
            date: isoDate(transaction.date),
            merchant: transaction.merchant,
            rawDescription: transaction.rawDescription,
            amount: numberValue(transaction.amount),
            currency: transaction.currency,
            finAccountId: transaction.finAccount?.id ?? null,
            creditCardId: transaction.creditCard?.id ?? null,
            account:
                transaction.finAccount?.nickname
                ?? transaction.creditCard?.nickname
                ?? transaction.creditCard?.productName
                ?? transaction.creditCard?.issuer
                ?? null,
            categoryId: transaction.category?.id ?? null,
            category: transaction.category?.name ?? "Uncategorized",
            categoryColor: transaction.category?.color ?? null,
            pending: transaction.pending,
            source: transaction.source,
            hasReceipt: Boolean(transaction.receiptKey),
            receiptFileName: transaction.receiptFileName,
            notes: transaction.notes,
            statementId: transaction.statement?.id ?? transaction.statementId ?? null,
            statement: transaction.statement ? { id: transaction.statement.id, fileName: transaction.statement.fileName } : null,
            splits: transaction.splits.map((split) => ({ categoryId: split.categoryId, amount: numberValue(split.amount) })),
        })),
        categories: categories.map((category) => ({ id: category.id, label: category.name, color: category.color })),
        accounts: manualAccounts.map((account) => ({
            id: account.id,
            kind: "account" as const,
            nickname: account.nickname || "Account",
            institution: account.institution,
            monogram: ownerMonogram(account.nickname || "Ac"),
            masked: account.last4 ? `••${account.last4}` : null,
            typeLabel: titleCaseWord(account.kind),
        })),
        cards: manualCards.map((card) => ({
            id: card.id,
            kind: "card" as const,
            nickname: card.nickname || card.productName || card.issuer || "Card",
            institution: card.issuer,
            monogram: ownerMonogram(card.nickname || card.productName || card.issuer || "Cd"),
            masked: card.last4 ? `••${card.last4}` : null,
            typeLabel: "Card",
        })),
        monthly: reports.monthly,
        snapshots: {
            netWorth: netWorth.summary,
            budget: budget.summary,
            income: income.summary,
            subscriptions: subscriptions.summary,
            credit: credit.summary,
        },
        integrations: {
            plaid: plaidItems.map((item) => ({ id: item.id, institution: item.institutionName ?? "Connected institution", status: item.status, lastSyncedAt: isoDateTime(item.lastSyncedAt), mode: "READ_ONLY" })),
            alpaca: alpaca ? { connected: true, environment: alpaca.activePaper ? "PAPER" : "LIVE", lastUpdated: isoDateTime(alpaca.updatedAt), mode: "READ_ONLY" } : { connected: false, mode: "READ_ONLY" },
        },
    };
}

// ---------------------------------------------------------------------------
// Desktop-local manual mutations
// ---------------------------------------------------------------------------

type MutationPayload = Record<string, unknown> | undefined;

const ACCOUNT_KINDS = ["CHECKING", "SAVINGS", "MONEY_MARKET", "CD", "BROKERAGE", "OTHER"] as const;
const CARD_TYPES = ["CREDIT", "DEBIT", "CHARGE", "PREPAID", "OTHER"] as const;
const CREDIT_BUREAUS = ["EQUIFAX", "EXPERIAN", "TRANSUNION"] as const;
const SUBSCRIPTION_CADENCES = ["MONTHLY", "YEARLY", "WEEKLY", "OTHER"] as const;
const SUBSCRIPTION_STATUSES = ["ACTIVE", "CANCELLED", "PAUSED"] as const;

function payloadRecord(payload: MutationPayload): Record<string, unknown> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Action details are required.");
    return payload;
}

function hasField(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

function requiredText(value: unknown, label: string, maxLength = 200): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
    const text = value.trim();
    if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
    return text;
}

function optionalText(value: unknown, label: string, maxLength = 2_000): string | null {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") throw new Error(`${label} must be text.`);
    const text = value.trim();
    if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
    return text || null;
}

function idValue(value: unknown, label = "Record id"): string {
    return requiredText(value, label, 200);
}

function numericValue(value: unknown, label: string, options: { min?: number; max?: number; nullable?: boolean } = {}): number | null {
    if (value === null || value === undefined || value === "") {
        if (options.nullable) return null;
        throw new Error(`${label} is required.`);
    }
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid number.`);
    if (options.min !== undefined && parsed < options.min) throw new Error(`${label} must be at least ${options.min}.`);
    if (options.max !== undefined && parsed > options.max) throw new Error(`${label} must be at most ${options.max}.`);
    return parsed;
}

function booleanValue(value: unknown, label: string): boolean {
    if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
    return value;
}

function dateOnly(value: unknown, label: string, nullable = false): Date | null {
    if (value === null || value === undefined || value === "") {
        if (nullable) return null;
        throw new Error(`${label} is required.`);
    }
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD.`);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || isoDate(date) !== value) throw new Error(`${label} is invalid.`);
    return date;
}

function enumValue<const T extends readonly string[]>(value: unknown, label: string, values: T): T[number] {
    if (typeof value !== "string" || !values.includes(value as T[number])) throw new Error(`${label} is invalid.`);
    return value as T[number];
}

function currencyValue(value: unknown): string {
    const currency = requiredText(value ?? "USD", "Currency", 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter ISO code.");
    return currency;
}

function last4Value(value: unknown): string | null {
    const last4 = optionalText(value, "Last four digits", 4);
    if (last4 && !/^\d{4}$/.test(last4)) throw new Error("Last four digits must contain exactly four numbers.");
    return last4;
}

function assertChanges(data: object): void {
    if (Object.keys(data).length === 0) throw new Error("No changes were provided.");
}

async function requireManualAccount(userId: string, id: string) {
    const account = await prisma.finAccount.findFirst({
        where: { id, userId },
        select: { id: true, alpacaLinked: true, plaidAccount: { select: { id: true } } },
    });
    if (!account) throw new Error("Account not found.");
    return account;
}

async function optionalManualAccountId(userId: string, value: unknown, label = "Account"): Promise<string | null> {
    const id = optionalText(value, `${label} id`, 200);
    if (!id) return null;
    await requireManualAccount(userId, id);
    return id;
}

async function optionalManualCardId(userId: string, value: unknown): Promise<string | null> {
    const id = optionalText(value, "Card id", 200);
    if (!id) return null;
    const card = await prisma.creditCard.findFirst({ where: { id, userId }, select: { id: true } });
    if (!card) throw new Error("Card not found.");
    return id;
}

async function optionalCategoryId(userId: string, value: unknown, excludingId?: string): Promise<string | null> {
    const id = optionalText(value, "Category id", 200);
    if (!id) return null;
    if (excludingId && id === excludingId) throw new Error("A budget category cannot be its own parent.");
    const category = await prisma.budgetCategory.findFirst({ where: { id, userId }, select: { id: true } });
    if (!category) throw new Error("Budget category not found.");
    return category.id;
}

async function requireManualTransaction(userId: string, id: string) {
    const transaction = await prisma.finTransaction.findFirst({
        where: { id, userId },
        select: { id: true, source: true, plaidTransactionId: true },
    });
    if (!transaction) throw new Error("Transaction not found.");
    return transaction;
}

export async function createAccount(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const balance = numericValue(input.currentBalance ?? 0, "Current balance", { min: -1_000_000_000_000, max: 1_000_000_000_000 }) ?? 0;
    const account = await prisma.finAccount.create({
        data: {
            userId,
            kind: enumValue(input.kind ?? "CHECKING", "Account kind", ACCOUNT_KINDS),
            nickname: requiredText(input.nickname, "Account name", 120),
            institution: optionalText(input.institution, "Institution", 160),
            last4: last4Value(input.last4),
            currency: currencyValue(input.currency ?? "USD"),
            currentBalance: balance,
            lastBalanceAt: new Date(),
            isAsset: input.isAsset === undefined ? true : booleanValue(input.isAsset, "Asset setting"),
            includeInNetWorth: input.includeInNetWorth === undefined ? true : booleanValue(input.includeInNetWorth, "Net-worth setting"),
            notes: optionalText(input.notes, "Notes"),
        },
        select: { id: true, nickname: true, kind: true, currency: true, currentBalance: true, createdAt: true },
    });
    return { id: account.id, name: account.nickname, kind: account.kind, currency: account.currency, balance: numberValue(account.currentBalance), createdAt: isoDateTime(account.createdAt) };
}

export async function updateAccount(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Account id");
    await requireManualAccount(userId, id);
    const data: Prisma.FinAccountUncheckedUpdateInput = {};
    if (hasField(input, "kind")) data.kind = enumValue(input.kind, "Account kind", ACCOUNT_KINDS);
    if (hasField(input, "nickname")) data.nickname = requiredText(input.nickname, "Account name", 120);
    if (hasField(input, "institution")) data.institution = optionalText(input.institution, "Institution", 160);
    if (hasField(input, "last4")) data.last4 = last4Value(input.last4);
    if (hasField(input, "currency")) data.currency = currencyValue(input.currency);
    if (hasField(input, "currentBalance")) {
        data.currentBalance = numericValue(input.currentBalance, "Current balance", { min: -1_000_000_000_000, max: 1_000_000_000_000 }) ?? 0;
        data.lastBalanceAt = new Date();
    }
    if (hasField(input, "isAsset")) data.isAsset = booleanValue(input.isAsset, "Asset setting");
    if (hasField(input, "includeInNetWorth")) data.includeInNetWorth = booleanValue(input.includeInNetWorth, "Net-worth setting");
    if (hasField(input, "archived")) data.archived = booleanValue(input.archived, "Archived setting");
    if (hasField(input, "notes")) data.notes = optionalText(input.notes, "Notes");
    assertChanges(data);
    const account = await prisma.finAccount.update({ where: { id }, data, select: { id: true, nickname: true, kind: true, archived: true, updatedAt: true } });
    return { id: account.id, name: account.nickname, kind: account.kind, archived: account.archived, updatedAt: isoDateTime(account.updatedAt) };
}

export async function deleteAccount(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Account id");
    await requireManualAccount(userId, id);
    const account = await prisma.finAccount.findUnique({
        where: { id },
        select: { _count: { select: { transactions: true, statements: true, holdings: true, incomeStreams: true, openedFromPlans: true, replaces: true } } },
    });
    const references = account ? Object.values(account._count).reduce((total, value) => total + value, 0) : 0;
    if (references > 0) throw new Error("This account has financial history. Archive it instead of deleting it.");
    await prisma.finAccount.delete({ where: { id } });
    return { id, deleted: true };
}

export async function createTransaction(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const amount = numericValue(input.amount, "Amount", { min: -1_000_000_000_000, max: 1_000_000_000_000 }) ?? 0;
    if (amount === 0) throw new Error("Amount cannot be zero.");
    const [finAccountId, creditCardId, categoryId] = await Promise.all([
        optionalManualAccountId(userId, input.finAccountId),
        optionalManualCardId(userId, input.creditCardId),
        optionalCategoryId(userId, input.categoryId),
    ]);
    const transaction = await prisma.finTransaction.create({
        data: {
            userId,
            date: dateOnly(input.date, "Transaction date")!,
            amount,
            currency: currencyValue(input.currency ?? "USD"),
            merchant: requiredText(input.merchant, "Merchant or description", 200),
            categoryId,
            finAccountId,
            creditCardId,
            pending: input.pending === undefined ? false : booleanValue(input.pending, "Pending setting"),
            source: "MANUAL",
            notes: optionalText(input.notes, "Notes"),
        },
        select: { id: true, date: true, amount: true, merchant: true, currency: true },
    });
    return { id: transaction.id, date: isoDate(transaction.date), amount: numberValue(transaction.amount), merchant: transaction.merchant, currency: transaction.currency };
}

export async function updateTransaction(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Transaction id");
    await requireManualTransaction(userId, id);
    const data: Prisma.FinTransactionUncheckedUpdateInput = {};
    if (hasField(input, "date")) data.date = dateOnly(input.date, "Transaction date")!;
    if (hasField(input, "amount")) {
        const amount = numericValue(input.amount, "Amount", { min: -1_000_000_000_000, max: 1_000_000_000_000 }) ?? 0;
        if (amount === 0) throw new Error("Amount cannot be zero.");
        data.amount = amount;
    }
    if (hasField(input, "currency")) data.currency = currencyValue(input.currency);
    if (hasField(input, "merchant")) data.merchant = requiredText(input.merchant, "Merchant or description", 200);
    if (hasField(input, "categoryId")) data.categoryId = await optionalCategoryId(userId, input.categoryId);
    if (hasField(input, "finAccountId")) data.finAccountId = await optionalManualAccountId(userId, input.finAccountId);
    if (hasField(input, "creditCardId")) data.creditCardId = await optionalManualCardId(userId, input.creditCardId);
    if (hasField(input, "pending")) data.pending = booleanValue(input.pending, "Pending setting");
    if (hasField(input, "notes")) data.notes = optionalText(input.notes, "Notes");
    assertChanges(data);
    const transaction = await prisma.finTransaction.update({ where: { id }, data, select: { id: true, date: true, amount: true, merchant: true, updatedAt: true } });
    return { id: transaction.id, date: isoDate(transaction.date), amount: numberValue(transaction.amount), merchant: transaction.merchant, updatedAt: isoDateTime(transaction.updatedAt) };
}

export async function deleteTransaction(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Transaction id");
    await requireManualTransaction(userId, id);
    await prisma.finTransaction.delete({ where: { id } });
    return { id, deleted: true };
}

/** Bulk-insert transactions parsed client-side from a CSV, deduping against existing rows. */
export async function importTransactions(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const finAccountId = await optionalManualAccountId(userId, input.finAccountId);
    const creditCardId = await optionalManualCardId(userId, input.creditCardId);
    const rows = Array.isArray(input.rows) ? input.rows : [];
    if (rows.length === 0) throw new Error("No rows to import.");
    let inserted = 0;
    let skipped = 0;
    for (const raw of rows.slice(0, 5_000)) {
        const row = raw as Record<string, unknown>;
        const date = dateOnly(row.date, "Row date", true);
        const amount = numericValue(row.amount, "Row amount", { nullable: true });
        if (!date || amount === null || amount === 0) { skipped += 1; continue; }
        const merchant = optionalText(row.merchant, "Row merchant", 200) ?? optionalText(row.rawDescription, "Row description", 500) ?? "Imported transaction";
        const dedupHash = createHash("sha256").update(`${userId}|${isoDate(date)}|${amount.toFixed(2)}|${normalizeMerchant(merchant)}|${finAccountId ?? creditCardId ?? ""}`).digest("hex");
        if (await prisma.finTransaction.findFirst({ where: { userId, dedupHash }, select: { id: true } })) { skipped += 1; continue; }
        await prisma.finTransaction.create({
            data: {
                userId,
                finAccountId,
                creditCardId,
                date,
                amount,
                merchant,
                rawDescription: optionalText(row.rawDescription, "Row description", 500),
                source: "CSV",
                dedupHash,
            },
        });
        inserted += 1;
    }
    return { inserted, skipped };
}

export async function createBudgetCategory(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const parentId = await optionalCategoryId(userId, input.parentId);
    const name = requiredText(input.name, "Category name", 100);
    if (name === GENERIC_TOTAL_CATEGORY) throw new Error("That name is reserved.");
    if (await prisma.budgetCategory.findFirst({ where: { userId, name }, select: { id: true } })) throw new Error("A budget category with this name already exists.");
    const category = await prisma.budgetCategory.create({
        data: {
            userId,
            name,
            color: optionalText(input.color, "Color", 40),
            parentId,
            monthlyBudget: numericValue(input.monthlyBudget, "Monthly budget", { min: 0, max: 1_000_000_000, nullable: true }),
        },
        select: { id: true, name: true, monthlyBudget: true, createdAt: true },
    });
    return { id: category.id, name: category.name, monthlyBudget: category.monthlyBudget == null ? null : numberValue(category.monthlyBudget), createdAt: isoDateTime(category.createdAt) };
}

export async function updateBudgetCategory(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Category id");
    const owned = await prisma.budgetCategory.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error("Budget category not found.");
    const data: Prisma.BudgetCategoryUncheckedUpdateInput = {};
    if (hasField(input, "name")) {
        const name = requiredText(input.name, "Category name", 100);
        if (name === GENERIC_TOTAL_CATEGORY) throw new Error("That name is reserved.");
        if (await prisma.budgetCategory.findFirst({ where: { userId, name, id: { not: id } }, select: { id: true } })) throw new Error("A budget category with this name already exists.");
        data.name = name;
    }
    if (hasField(input, "color")) data.color = optionalText(input.color, "Color", 40);
    if (hasField(input, "parentId")) data.parentId = await optionalCategoryId(userId, input.parentId, id);
    if (hasField(input, "monthlyBudget")) data.monthlyBudget = numericValue(input.monthlyBudget, "Monthly budget", { min: 0, max: 1_000_000_000, nullable: true });
    assertChanges(data);
    const category = await prisma.budgetCategory.update({ where: { id }, data, select: { id: true, name: true, monthlyBudget: true, updatedAt: true } });
    return { id: category.id, name: category.name, monthlyBudget: category.monthlyBudget == null ? null : numberValue(category.monthlyBudget), updatedAt: isoDateTime(category.updatedAt) };
}

export async function deleteBudgetCategory(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Category id");
    const category = await prisma.budgetCategory.findFirst({ where: { id, userId }, select: { id: true } });
    if (!category) throw new Error("Budget category not found.");
    await prisma.budgetCategory.delete({ where: { id } });
    return { id, deleted: true };
}

/**
 * Set (or clear) the GENERIC monthly budget total, stored without a schema change as a
 * reserved BudgetCategory named GENERIC_TOTAL_CATEGORY whose monthlyBudget holds the total.
 * Passing a null/empty total switches the budget page back to per-category mode.
 */
export async function setGenericBudgetTotal(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const total = numericValue(input.total, "Monthly total", { min: 0, max: 1_000_000_000, nullable: true });
    if (total === null) {
        await prisma.budgetCategory.deleteMany({ where: { userId, name: GENERIC_TOTAL_CATEGORY } });
        return { genericTotal: null };
    }
    await prisma.budgetCategory.upsert({
        where: { userId_name: { userId, name: GENERIC_TOTAL_CATEGORY } },
        create: { userId, name: GENERIC_TOTAL_CATEGORY, monthlyBudget: total },
        update: { monthlyBudget: total },
    });
    return { genericTotal: round(total) };
}

export async function createSubscription(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const status = enumValue(input.status ?? "ACTIVE", "Subscription status", SUBSCRIPTION_STATUSES);
    const subscription = await prisma.finSubscription.create({
        data: {
            userId,
            name: optionalText(input.name, "Subscription name", 160),
            merchant: requiredText(input.merchant, "Merchant", 160),
            cadence: enumValue(input.cadence ?? "MONTHLY", "Billing cadence", SUBSCRIPTION_CADENCES),
            amount: numericValue(input.amount, "Amount", { min: 0, max: 1_000_000_000 }) ?? 0,
            currency: currencyValue(input.currency ?? "USD"),
            status,
            startedOn: dateOnly(input.startedOn, "Start date", true),
            nextChargeOn: dateOnly(input.nextChargeOn, "Next charge date", true),
            cancelledOn: status === "CANCELLED" ? dateOnly(input.cancelledOn, "Cancellation date", true) ?? new Date() : null,
            notes: optionalText(input.notes, "Notes"),
        },
        select: { id: true, name: true, merchant: true, status: true, amount: true, currency: true, createdAt: true },
    });
    return { id: subscription.id, name: subscription.name ?? subscription.merchant, status: subscription.status, amount: numberValue(subscription.amount), currency: subscription.currency, createdAt: isoDateTime(subscription.createdAt) };
}

export async function updateSubscription(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Subscription id");
    const owned = await prisma.finSubscription.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error("Subscription not found.");
    const data: Prisma.FinSubscriptionUncheckedUpdateInput = {};
    if (hasField(input, "name")) data.name = optionalText(input.name, "Subscription name", 160);
    if (hasField(input, "merchant")) data.merchant = requiredText(input.merchant, "Merchant", 160);
    if (hasField(input, "cadence")) data.cadence = enumValue(input.cadence, "Billing cadence", SUBSCRIPTION_CADENCES);
    if (hasField(input, "amount")) data.amount = numericValue(input.amount, "Amount", { min: 0, max: 1_000_000_000 }) ?? 0;
    if (hasField(input, "currency")) data.currency = currencyValue(input.currency);
    if (hasField(input, "status")) {
        const status = enumValue(input.status, "Subscription status", SUBSCRIPTION_STATUSES);
        data.status = status;
        if (status === "CANCELLED" && !hasField(input, "cancelledOn")) data.cancelledOn = new Date();
        if (status !== "CANCELLED" && !hasField(input, "cancelledOn")) data.cancelledOn = null;
    }
    if (hasField(input, "startedOn")) data.startedOn = dateOnly(input.startedOn, "Start date", true);
    if (hasField(input, "nextChargeOn")) data.nextChargeOn = dateOnly(input.nextChargeOn, "Next charge date", true);
    if (hasField(input, "cancelledOn")) data.cancelledOn = dateOnly(input.cancelledOn, "Cancellation date", true);
    if (hasField(input, "notes")) data.notes = optionalText(input.notes, "Notes");
    assertChanges(data);
    const subscription = await prisma.finSubscription.update({ where: { id }, data, select: { id: true, name: true, merchant: true, status: true, updatedAt: true } });
    return { id: subscription.id, name: subscription.name ?? subscription.merchant, status: subscription.status, updatedAt: isoDateTime(subscription.updatedAt) };
}

export async function deleteSubscription(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Subscription id");
    const owned = await prisma.finSubscription.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error("Subscription not found.");
    await prisma.finSubscription.delete({ where: { id } });
    return { id, deleted: true };
}

export async function createIncomeStream(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const finAccountId = await optionalManualAccountId(userId, input.finAccountId, "Destination account");
    const name = requiredText(input.name, "Income stream name", 140);
    if (await prisma.incomeStream.findFirst({ where: { userId, name }, select: { id: true } })) throw new Error("An income stream with this name already exists.");
    const stream = await prisma.incomeStream.create({
        data: {
            userId,
            name,
            kind: optionalText(input.kind, "Income kind", 80),
            finAccountId,
            notes: optionalText(input.notes, "Notes"),
            archived: input.archived === undefined ? false : booleanValue(input.archived, "Archived setting"),
        },
        select: { id: true, name: true, kind: true, archived: true, createdAt: true },
    });
    return { ...stream, createdAt: isoDateTime(stream.createdAt) };
}

export async function updateIncomeStream(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Income stream id");
    const owned = await prisma.incomeStream.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error("Income stream not found.");
    const data: Prisma.IncomeStreamUncheckedUpdateInput = {};
    if (hasField(input, "name")) {
        const name = requiredText(input.name, "Income stream name", 140);
        if (await prisma.incomeStream.findFirst({ where: { userId, name, id: { not: id } }, select: { id: true } })) throw new Error("An income stream with this name already exists.");
        data.name = name;
    }
    if (hasField(input, "kind")) data.kind = optionalText(input.kind, "Income kind", 80);
    if (hasField(input, "finAccountId")) data.finAccountId = await optionalManualAccountId(userId, input.finAccountId, "Destination account");
    if (hasField(input, "notes")) data.notes = optionalText(input.notes, "Notes");
    if (hasField(input, "archived")) data.archived = booleanValue(input.archived, "Archived setting");
    assertChanges(data);
    const stream = await prisma.incomeStream.update({ where: { id }, data, select: { id: true, name: true, kind: true, archived: true, updatedAt: true } });
    return { ...stream, updatedAt: isoDateTime(stream.updatedAt) };
}

export async function deleteIncomeStream(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Income stream id");
    const stream = await prisma.incomeStream.findFirst({ where: { id, userId }, select: { id: true, _count: { select: { entries: true } } } });
    if (!stream) throw new Error("Income stream not found.");
    if (stream._count.entries > 0) throw new Error("This stream has payment history. Archive it instead of deleting it.");
    await prisma.incomeStream.delete({ where: { id } });
    return { id, deleted: true };
}

async function requireIncomeStream(userId: string, value: unknown): Promise<string> {
    const id = idValue(value, "Income stream id");
    const stream = await prisma.incomeStream.findFirst({ where: { id, userId }, select: { id: true } });
    if (!stream) throw new Error("Income stream not found.");
    return stream.id;
}

async function requireManualIncomeEntry(userId: string, id: string) {
    const entry = await prisma.incomeEntry.findFirst({ where: { id, userId }, select: { id: true, source: true } });
    if (!entry) throw new Error("Income payment not found.");
    return entry;
}

export async function createIncomeEntry(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const streamId = await requireIncomeStream(userId, input.streamId);
    const entry = await prisma.incomeEntry.create({
        data: {
            userId,
            streamId,
            amount: numericValue(input.amount, "Payment amount", { min: 0.01, max: 1_000_000_000_000 }) ?? 0,
            currency: currencyValue(input.currency ?? "USD"),
            receivedAt: dateOnly(input.receivedAt, "Received date")!,
            source: "MANUAL",
            notes: optionalText(input.notes, "Notes"),
        },
        select: { id: true, streamId: true, amount: true, currency: true, receivedAt: true, source: true },
    });
    return { id: entry.id, streamId: entry.streamId, amount: numberValue(entry.amount), currency: entry.currency, receivedAt: isoDate(entry.receivedAt), source: entry.source };
}

export async function updateIncomeEntry(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Income payment id");
    await requireManualIncomeEntry(userId, id);
    const data: Prisma.IncomeEntryUncheckedUpdateInput = {};
    if (hasField(input, "streamId")) data.streamId = await requireIncomeStream(userId, input.streamId);
    if (hasField(input, "amount")) data.amount = numericValue(input.amount, "Payment amount", { min: 0.01, max: 1_000_000_000_000 }) ?? 0;
    if (hasField(input, "currency")) data.currency = currencyValue(input.currency);
    if (hasField(input, "receivedAt")) data.receivedAt = dateOnly(input.receivedAt, "Received date")!;
    if (hasField(input, "notes")) data.notes = optionalText(input.notes, "Notes");
    assertChanges(data);
    const entry = await prisma.incomeEntry.update({ where: { id }, data, select: { id: true, streamId: true, amount: true, currency: true, receivedAt: true } });
    return { id: entry.id, streamId: entry.streamId, amount: numberValue(entry.amount), currency: entry.currency, receivedAt: isoDate(entry.receivedAt) };
}

export async function deleteIncomeEntry(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Income payment id");
    await requireManualIncomeEntry(userId, id);
    await prisma.incomeEntry.delete({ where: { id } });
    return { id, deleted: true };
}

export async function createDebt(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const debt = await prisma.debt.create({
        data: {
            userId,
            name: requiredText(input.name, "Debt name", 160),
            kind: optionalText(input.kind, "Debt kind", 80),
            principalOriginal: numericValue(input.principalOriginal, "Original balance", { min: 0, max: 1_000_000_000_000, nullable: true }),
            principalRemaining: numericValue(input.principalRemaining, "Remaining balance", { min: 0, max: 1_000_000_000_000, nullable: true }),
            apr: numericValue(input.apr, "APR", { min: 0, max: 1_000, nullable: true }),
            minimumPayment: numericValue(input.minimumPayment, "Minimum payment", { min: 0, max: 1_000_000_000, nullable: true }),
            payoffGoalDate: dateOnly(input.payoffGoalDate, "Payoff goal date", true),
            strategy: optionalText(input.strategy, "Payoff strategy", 1_000),
        },
        select: { id: true, name: true, principalRemaining: true, createdAt: true },
    });
    return { id: debt.id, name: debt.name, balance: numberValue(debt.principalRemaining), createdAt: isoDateTime(debt.createdAt) };
}

export async function updateDebt(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Debt id");
    const owned = await prisma.debt.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error("Debt not found.");
    const data: Prisma.DebtUncheckedUpdateInput = {};
    if (hasField(input, "name")) data.name = requiredText(input.name, "Debt name", 160);
    if (hasField(input, "kind")) data.kind = optionalText(input.kind, "Debt kind", 80);
    if (hasField(input, "principalOriginal")) data.principalOriginal = numericValue(input.principalOriginal, "Original balance", { min: 0, max: 1_000_000_000_000, nullable: true });
    if (hasField(input, "principalRemaining")) data.principalRemaining = numericValue(input.principalRemaining, "Remaining balance", { min: 0, max: 1_000_000_000_000, nullable: true });
    if (hasField(input, "apr")) data.apr = numericValue(input.apr, "APR", { min: 0, max: 1_000, nullable: true });
    if (hasField(input, "minimumPayment")) data.minimumPayment = numericValue(input.minimumPayment, "Minimum payment", { min: 0, max: 1_000_000_000, nullable: true });
    if (hasField(input, "payoffGoalDate")) data.payoffGoalDate = dateOnly(input.payoffGoalDate, "Payoff goal date", true);
    if (hasField(input, "strategy")) data.strategy = optionalText(input.strategy, "Payoff strategy", 1_000);
    assertChanges(data);
    const debt = await prisma.debt.update({ where: { id }, data, select: { id: true, name: true, principalRemaining: true, updatedAt: true } });
    return { id: debt.id, name: debt.name, balance: numberValue(debt.principalRemaining), updatedAt: isoDateTime(debt.updatedAt) };
}

export async function deleteDebt(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Debt id");
    const debt = await prisma.debt.findFirst({ where: { id, userId }, select: { id: true } });
    if (!debt) throw new Error("Debt not found.");
    await prisma.debt.delete({ where: { id } });
    return { id, deleted: true };
}

export async function createGoal(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const goal = await prisma.financialGoal.create({
        data: {
            userId,
            title: requiredText(input.title, "Goal title", 160),
            targetAmount: numericValue(input.targetAmount, "Target amount", { min: 0.01, max: 1_000_000_000_000, nullable: true }),
            currentAmount: numericValue(input.currentAmount ?? 0, "Current amount", { min: 0, max: 1_000_000_000_000 }) ?? 0,
            targetDate: dateOnly(input.targetDate, "Target date", true),
        },
        select: { id: true, title: true, targetAmount: true, currentAmount: true, targetDate: true, createdAt: true },
    });
    return { id: goal.id, title: goal.title, targetAmount: goal.targetAmount == null ? null : numberValue(goal.targetAmount), currentAmount: numberValue(goal.currentAmount), targetDate: isoDate(goal.targetDate), createdAt: isoDateTime(goal.createdAt) };
}

export async function updateGoal(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Goal id");
    const owned = await prisma.financialGoal.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error("Financial goal not found.");
    const data: Prisma.FinancialGoalUncheckedUpdateInput = {};
    if (hasField(input, "title")) data.title = requiredText(input.title, "Goal title", 160);
    if (hasField(input, "targetAmount")) data.targetAmount = numericValue(input.targetAmount, "Target amount", { min: 0.01, max: 1_000_000_000_000, nullable: true });
    if (hasField(input, "currentAmount")) data.currentAmount = numericValue(input.currentAmount, "Current amount", { min: 0, max: 1_000_000_000_000 }) ?? 0;
    if (hasField(input, "targetDate")) data.targetDate = dateOnly(input.targetDate, "Target date", true);
    assertChanges(data);
    const goal = await prisma.financialGoal.update({ where: { id }, data, select: { id: true, title: true, targetAmount: true, currentAmount: true, targetDate: true, updatedAt: true } });
    return { id: goal.id, title: goal.title, targetAmount: goal.targetAmount == null ? null : numberValue(goal.targetAmount), currentAmount: numberValue(goal.currentAmount), targetDate: isoDate(goal.targetDate), updatedAt: isoDateTime(goal.updatedAt) };
}

export async function deleteGoal(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Goal id");
    const goal = await prisma.financialGoal.findFirst({ where: { id, userId }, select: { id: true } });
    if (!goal) throw new Error("Financial goal not found.");
    await prisma.financialGoal.delete({ where: { id } });
    return { id, deleted: true };
}

// ---------------------------------------------------------------------------
// Remaining financial CRUD (cards, institutions, credit, statements, tax)
// ---------------------------------------------------------------------------

export async function createCard(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const card = await prisma.creditCard.create({
        data: {
            userId,
            nickname: requiredText(input.nickname, "Card name", 120),
            productName: optionalText(input.productName, "Product name", 160),
            issuer: optionalText(input.issuer, "Issuer", 160),
            cardType: enumValue(input.cardType ?? "CREDIT", "Card type", CARD_TYPES),
            last4: last4Value(input.last4),
            apr: numericValue(input.apr, "APR", { min: 0, max: 1_000, nullable: true }),
            creditLimit: numericValue(input.creditLimit, "Credit limit", { min: 0, max: 1_000_000_000, nullable: true }),
            currentBalance: numericValue(input.currentBalance ?? 0, "Current balance", { min: -1_000_000_000, max: 1_000_000_000 }) ?? 0,
            minimumPayment: numericValue(input.minimumPayment, "Minimum payment", { min: 0, max: 1_000_000_000, nullable: true }),
            paymentDueAt: dateOnly(input.paymentDueAt, "Payment due date", true),
            paymentOverdue: input.paymentOverdue === undefined ? false : booleanValue(input.paymentOverdue, "Overdue setting"),
            notes: optionalText(input.notes, "Notes"),
        },
        select: { id: true, nickname: true, cardType: true, currentBalance: true, createdAt: true },
    });
    return { id: card.id, name: card.nickname, cardType: card.cardType, balance: numberValue(card.currentBalance), createdAt: isoDateTime(card.createdAt) };
}

export async function updateCard(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Card id");
    const owned = await prisma.creditCard.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error("Card not found.");
    const data: Prisma.CreditCardUncheckedUpdateInput = {};
    if (hasField(input, "nickname")) data.nickname = requiredText(input.nickname, "Card name", 120);
    if (hasField(input, "productName")) data.productName = optionalText(input.productName, "Product name", 160);
    if (hasField(input, "issuer")) data.issuer = optionalText(input.issuer, "Issuer", 160);
    if (hasField(input, "cardType")) data.cardType = enumValue(input.cardType, "Card type", CARD_TYPES);
    if (hasField(input, "last4")) data.last4 = last4Value(input.last4);
    if (hasField(input, "apr")) data.apr = numericValue(input.apr, "APR", { min: 0, max: 1_000, nullable: true });
    if (hasField(input, "creditLimit")) data.creditLimit = numericValue(input.creditLimit, "Credit limit", { min: 0, max: 1_000_000_000, nullable: true });
    if (hasField(input, "currentBalance")) data.currentBalance = numericValue(input.currentBalance, "Current balance", { min: -1_000_000_000, max: 1_000_000_000 }) ?? 0;
    if (hasField(input, "minimumPayment")) data.minimumPayment = numericValue(input.minimumPayment, "Minimum payment", { min: 0, max: 1_000_000_000, nullable: true });
    if (hasField(input, "paymentDueAt")) data.paymentDueAt = dateOnly(input.paymentDueAt, "Payment due date", true);
    if (hasField(input, "paymentOverdue")) data.paymentOverdue = booleanValue(input.paymentOverdue, "Overdue setting");
    if (hasField(input, "archived")) data.archived = booleanValue(input.archived, "Archived setting");
    if (hasField(input, "notes")) data.notes = optionalText(input.notes, "Notes");
    assertChanges(data);
    const card = await prisma.creditCard.update({ where: { id }, data, select: { id: true, nickname: true, cardType: true, archived: true, updatedAt: true } });
    return { ...card, updatedAt: isoDateTime(card.updatedAt) };
}

export async function deleteCard(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Card id");
    const card = await prisma.creditCard.findFirst({ where: { id, userId }, select: { id: true, _count: { select: { transactions: true, statements: true, cardNumbers: true, rewards: true, perks: true } } } });
    if (!card) throw new Error("Card not found.");
    const references = Object.values(card._count).reduce((total, value) => total + value, 0);
    if (references > 0) throw new Error("This card has financial history. Archive it instead of deleting it.");
    await prisma.creditCard.delete({ where: { id } });
    return { id, deleted: true };
}

export async function createInstitution(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const name = requiredText(input.name, "Institution name", 160);
    if (await prisma.institution.findFirst({ where: { userId, name }, select: { id: true } })) throw new Error("An institution with this name already exists.");
    const institution = await prisma.institution.create({ data: { userId, name, website: optionalText(input.website, "Website", 400), notes: optionalText(input.notes, "Notes") }, select: { id: true, name: true, website: true, createdAt: true } });
    return { ...institution, createdAt: isoDateTime(institution.createdAt) };
}

export async function updateInstitution(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Institution id");
    const owned = await prisma.institution.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error("Institution not found.");
    const data: Prisma.InstitutionUncheckedUpdateInput = {};
    if (hasField(input, "name")) data.name = requiredText(input.name, "Institution name", 160);
    if (hasField(input, "website")) data.website = optionalText(input.website, "Website", 400);
    if (hasField(input, "notes")) data.notes = optionalText(input.notes, "Notes");
    assertChanges(data);
    const institution = await prisma.institution.update({ where: { id }, data, select: { id: true, name: true, website: true, updatedAt: true } });
    return { ...institution, updatedAt: isoDateTime(institution.updatedAt) };
}

export async function deleteInstitution(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Institution id");
    const institution = await prisma.institution.findFirst({ where: { id, userId }, select: { id: true, _count: { select: { accounts: true, cards: true } } } });
    if (!institution) throw new Error("Institution not found.");
    if (institution._count.accounts + institution._count.cards > 0) throw new Error("Move linked accounts and cards before deleting this institution.");
    await prisma.institution.delete({ where: { id } });
    return { id, deleted: true };
}

export async function createCreditScore(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const entry = await prisma.creditScoreEntry.create({
        data: { userId, score: numericValue(input.score, "Credit score", { min: 300, max: 850 })!, scoreDate: dateOnly(input.date, "Score date")!, bureau: input.bureau ? enumValue(input.bureau, "Credit bureau", CREDIT_BUREAUS) : null, notes: optionalText(input.notes, "Notes") },
        select: { id: true, score: true, bureau: true, scoreDate: true },
    });
    return { id: entry.id, score: entry.score, bureau: entry.bureau, date: isoDate(entry.scoreDate) };
}

export async function updateCreditScore(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Credit score id");
    if (!await prisma.creditScoreEntry.findFirst({ where: { id, userId }, select: { id: true } })) throw new Error("Credit score entry not found.");
    const data: Prisma.CreditScoreEntryUncheckedUpdateInput = {};
    if (hasField(input, "score")) data.score = numericValue(input.score, "Credit score", { min: 300, max: 850 })!;
    if (hasField(input, "date")) data.scoreDate = dateOnly(input.date, "Score date")!;
    if (hasField(input, "bureau")) data.bureau = input.bureau ? enumValue(input.bureau, "Credit bureau", CREDIT_BUREAUS) : null;
    if (hasField(input, "notes")) data.notes = optionalText(input.notes, "Notes");
    assertChanges(data);
    const entry = await prisma.creditScoreEntry.update({ where: { id }, data, select: { id: true, score: true, bureau: true, scoreDate: true } });
    return { id: entry.id, score: entry.score, bureau: entry.bureau, date: isoDate(entry.scoreDate) };
}

export async function deleteCreditScore(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Credit score id");
    if (!await prisma.creditScoreEntry.findFirst({ where: { id, userId }, select: { id: true } })) throw new Error("Credit score entry not found.");
    await prisma.creditScoreEntry.delete({ where: { id } });
    return { id, deleted: true };
}

export async function updateStatement(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Statement id");
    if (!await prisma.finStatement.findFirst({ where: { id, userId }, select: { id: true } })) throw new Error("Statement not found.");
    const data: Prisma.FinStatementUncheckedUpdateInput = {};
    if (hasField(input, "fileName")) data.fileName = requiredText(input.fileName, "File name", 220);
    if (hasField(input, "periodStart")) data.periodStart = dateOnly(input.periodStart, "Period start", true);
    if (hasField(input, "periodEnd")) data.periodEnd = dateOnly(input.periodEnd, "Period end", true);
    if (hasField(input, "endingBalance")) data.endingBalance = numericValue(input.endingBalance, "Ending balance", { min: -1_000_000_000_000, max: 1_000_000_000_000, nullable: true });
    if (hasField(input, "owner")) {
        const owner = optionalText(input.owner, "Statement owner", 240) ?? "";
        const [kind, ownerId] = owner.split(":");
        data.finAccountId = kind === "account" && ownerId ? ownerId : null;
        data.creditCardId = kind === "card" && ownerId ? ownerId : null;
    }
    if (hasField(input, "finAccountId")) { data.finAccountId = optionalText(input.finAccountId, "Account id", 200); data.creditCardId = null; }
    if (hasField(input, "creditCardId")) { data.creditCardId = optionalText(input.creditCardId, "Card id", 200); data.finAccountId = null; }
    assertChanges(data);
    const statement = await prisma.finStatement.update({ where: { id }, data, select: { id: true, fileName: true, periodStart: true, periodEnd: true, endingBalance: true } });
    return { id: statement.id, fileName: statement.fileName, periodStart: isoDate(statement.periodStart), periodEnd: isoDate(statement.periodEnd), endingBalance: statement.endingBalance == null ? null : numberValue(statement.endingBalance) };
}

export async function deleteStatement(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Statement id");
    const statement = await prisma.finStatement.findFirst({ where: { id, userId }, select: { id: true, fileKey: true } });
    if (!statement) throw new Error("Statement not found.");
    await prisma.finStatement.delete({ where: { id } });
    const resolved = path.resolve(statement.fileKey);
    const allowedRoot = path.resolve(path.join(homedir(), ".coretex", "financial", "files"));
    if (resolved.startsWith(`${allowedRoot}${path.sep}`)) await unlink(resolved).catch(() => undefined);
    return { id, deleted: true };
}

const TAX_DOCUMENT_KINDS = [
    "W-2", "W-2G", "1099-NEC", "1099-MISC", "1099-INT", "1099-DIV", "1099-B", "1099-R", "1099-K", "1099-G",
    "1098", "1098-E", "1098-T", "K-1", "Schedule C", "Schedule E", "Tax return", "Receipt", "Invoice", "Charitable donation",
    "Medical expense", "Education", "Property tax", "Estimated payment", "Other",
] as const;

/** Persist an optional base64 file payload into the shared financial file store, sha256-prefixed like importFile. */
async function storeOptionalFinancialFile(input: Record<string, unknown>, fallbackFileName: string | null): Promise<{ fileKey: string; fileName: string } | null> {
    if (!hasField(input, "base64") || !input.base64) return null;
    const fileName = safeImportName(requiredText(input.fileName ?? fallbackFileName, "File name", 220));
    optionalText(input.mimeType, "MIME type", 120);
    const encoded = requiredText(input.base64, "File contents", Math.ceil(MAX_IMPORT_BYTES * 1.5));
    const buffer = Buffer.from(encoded, "base64");
    if (buffer.length === 0) throw new Error("The selected file is empty.");
    if (buffer.length > MAX_IMPORT_BYTES) throw new Error("Files are limited to 20 MB.");
    await mkdir(FINANCIAL_FILES_DIR, { recursive: true });
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const storedName = `${sha256.slice(0, 16)}-${fileName}`;
    const fileKey = path.join(FINANCIAL_FILES_DIR, storedName);
    await writeFile(fileKey, buffer);
    return { fileKey, fileName };
}

export async function createTaxDocument(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const taxYear = numericValue(input.taxYear, "Tax year", { min: 1900, max: 2200 })!;
    const kind = optionalText(input.kind, "Document type", 100) ?? "Other";
    const requestedFileName = optionalText(input.fileName, "File name", 220);
    const stored = await storeOptionalFinancialFile(input, requestedFileName);
    const document = await prisma.taxDocument.create({
        data: {
            userId,
            taxYear,
            kind,
            description: optionalText(input.description, "Description", 500),
            fileName: stored?.fileName ?? requestedFileName,
            fileKey: stored?.fileKey ?? null,
            notes: optionalText(input.notes, "Notes"),
        },
        select: { id: true, taxYear: true, kind: true, description: true, fileName: true, createdAt: true },
    });
    return { ...document, createdAt: isoDateTime(document.createdAt) };
}

export async function updateTaxDocument(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Tax document id");
    const existing = await prisma.taxDocument.findFirst({ where: { id, userId }, select: { id: true, fileName: true, fileKey: true } });
    if (!existing) throw new Error("Tax document not found.");
    const data: Prisma.TaxDocumentUncheckedUpdateInput = {};
    if (hasField(input, "taxYear")) data.taxYear = numericValue(input.taxYear, "Tax year", { min: 1900, max: 2200 })!;
    if (hasField(input, "kind")) data.kind = optionalText(input.kind, "Document kind", 100);
    if (hasField(input, "description")) data.description = optionalText(input.description, "Description", 500);
    if (hasField(input, "fileName")) data.fileName = optionalText(input.fileName, "File name", 220);
    if (hasField(input, "notes")) data.notes = optionalText(input.notes, "Notes");
    const stored = await storeOptionalFinancialFile(input, (data.fileName as string | null) ?? existing.fileName);
    if (stored) {
        data.fileKey = stored.fileKey;
        data.fileName = stored.fileName;
    }
    assertChanges(data);
    const document = await prisma.taxDocument.update({ where: { id }, data, select: { id: true, taxYear: true, kind: true, description: true, fileName: true, updatedAt: true } });
    if (stored && existing.fileKey && existing.fileKey !== stored.fileKey) {
        const resolved = path.resolve(existing.fileKey);
        const allowedRoot = path.resolve(FINANCIAL_FILES_DIR);
        if (resolved.startsWith(`${allowedRoot}${path.sep}`)) await unlink(resolved).catch(() => undefined);
    }
    return { ...document, updatedAt: isoDateTime(document.updatedAt) };
}

export async function deleteTaxDocument(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Tax document id");
    const document = await prisma.taxDocument.findFirst({ where: { id, userId }, select: { id: true, fileKey: true } });
    if (!document) throw new Error("Tax document not found.");
    await prisma.taxDocument.delete({ where: { id } });
    if (document.fileKey) {
        const resolved = path.resolve(document.fileKey);
        const allowedRoot = path.resolve(path.join(homedir(), ".coretex", "financial", "files"));
        if (resolved.startsWith(`${allowedRoot}${path.sep}`)) await unlink(resolved).catch(() => undefined);
    }
    return { id, deleted: true };
}

export async function setDeductible(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Transaction id");
    const transaction = await prisma.finTransaction.findFirst({ where: { id, userId }, select: { id: true, notes: true } });
    if (!transaction) throw new Error("Transaction not found.");
    const prior = parseDeductible(transaction.notes);
    const deductible = booleanValue(input.deductible, "Deductible setting");
    const category = optionalText(input.category, "Deduction category", 120);
    const notes = optionalText(input.notes, "Notes") ?? prior.notes;
    const marker = deductible ? `[[deductible${category ? `:${category}` : ""}]]` : "";
    await prisma.finTransaction.update({ where: { id }, data: { notes: [marker, notes].filter(Boolean).join(" ") || null } });
    return { id, deductible, category };
}

// ---------------------------------------------------------------------------
// Financial document ingestion, AI diagnostics, and recurring detection
// ---------------------------------------------------------------------------

const FINANCIAL_FILES_DIR = path.join(homedir(), ".coretex", "financial", "files");
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

const CATEGORY_DEFAULTS: Record<string, string> = {
    "Housing": "purple",
    "Groceries": "success",
    "Dining": "orange",
    "Transportation": "blue",
    "Utilities": "warning",
    "Health": "pink",
    "Shopping": "brand",
    "Entertainment": "indigo",
    "Travel": "cyan",
    "Income": "success",
    "Transfers": "gray",
    "Fees": "error",
    "Subscriptions": "violet",
    "Other": "gray",
};

function safeImportName(name: string): string {
    const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim();
    return (cleaned || "financial-document").slice(0, 180);
}

function normalizeMerchant(value: string): string {
    return value
        .toLowerCase()
        .replace(/\b(pos|debit|credit|purchase|payment|online|recurring|ach|card)\b/g, " ")
        .replace(/[#*]\d+/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .slice(0, 5)
        .join(" ");
}

function heuristicCategory(merchant: string, amount: number): string {
    const text = merchant.toLowerCase();
    if (amount > 0 && /payroll|salary|direct dep|deposit|income|paycheck|employer/.test(text)) return "Income";
    if (/rent|mortgage|property|hoa|apartment/.test(text)) return "Housing";
    if (/grocery|market|foods|walmart|target|costco|aldi|kroger|safeway|publix|trader joe/.test(text)) return "Groceries";
    if (/restaurant|cafe|coffee|doordash|ubereats|grubhub|pizza|bar\b|bakery|mcdonald|starbucks/.test(text)) return "Dining";
    if (/uber|lyft|shell|exxon|chevron|gas|fuel|parking|transit|metro|auto|tire/.test(text)) return "Transportation";
    if (/electric|water|utility|internet|wireless|phone|comcast|verizon|at&t|tmobile/.test(text)) return "Utilities";
    if (/pharmacy|medical|dental|doctor|hospital|clinic|health|cvs|walgreens/.test(text)) return "Health";
    if (/netflix|spotify|hulu|disney|prime video|youtube|patreon|subscription/.test(text)) return "Subscriptions";
    if (/airline|hotel|airbnb|booking|expedia|travel/.test(text)) return "Travel";
    if (/cinema|theater|steam|playstation|xbox|concert|ticket/.test(text)) return "Entertainment";
    if (/fee|interest charge|overdraft|late charge|service charge/.test(text)) return "Fees";
    if (/transfer|zelle|venmo|cash app|paypal transfer|payment thank/.test(text)) return "Transfers";
    if (/amazon|etsy|shop|store|retail/.test(text)) return "Shopping";
    return amount > 0 ? "Income" : "Other";
}

async function categoryIdFor(userId: string, name: string): Promise<string> {
    const existing = await prisma.budgetCategory.findFirst({ where: { userId, name }, select: { id: true } });
    if (existing) return existing.id;
    const category = await prisma.budgetCategory.create({
        data: { userId, name, color: CATEGORY_DEFAULTS[name] ?? "gray" },
        select: { id: true },
    });
    return category.id;
}

function parseJsonContent<T>(content: string): T | null {
    const stripped = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { return JSON.parse(stripped) as T; } catch { /* try the first JSON object */ }
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
        try { return JSON.parse(stripped.slice(start, end + 1)) as T; } catch { /* invalid model output */ }
    }
    return null;
}

export async function ollamaJson<T>(prompt: string, timeoutMs = 5_000, images?: string[]): Promise<{ value: T; model: string } | null> {
    let host = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").trim().replace(/\/$/, "");
    if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let model = (process.env.CORETEX_OLLAMA_MODEL || process.env.OLLAMA_MODEL || "").trim();
        if (!model) {
            const tags = await fetch(`${host}/api/tags`, { signal: controller.signal });
            if (!tags.ok) return null;
            const body = await tags.json() as { models?: Array<{ name?: string; model?: string }> };
            model = body.models?.[0]?.model || body.models?.[0]?.name || "";
        }
        if (!model) return null;
        const response = await fetch(`${host}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                model,
                stream: false,
                format: "json",
                messages: [
                    { role: "system", content: "Return only valid JSON. Never invent identifiers that are not present in the input." },
                    { role: "user", content: prompt, ...(images?.length ? { images } : {}) },
                ],
                options: { temperature: 0.1 },
            }),
            signal: controller.signal,
        });
        if (!response.ok) return null;
        const body = await response.json() as { message?: { content?: string }; response?: string };
        const parsed = parseJsonContent<T>(body.message?.content || body.response || "");
        return parsed ? { value: parsed, model } : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

function extractDocumentText(buffer: Buffer, mimeType: string, fileName: string): string {
    if (/csv|text|tab-separated|ofx|qfx/i.test(mimeType) || /\.(csv|tsv|txt|ofx|qfx)$/i.test(fileName)) {
        return buffer.toString("utf8").replace(/^\uFEFF/, "");
    }
    // Text PDFs expose useful metadata as printable runs. Scanned PDFs still get
    // filename/account inference and remain available for preview/re-analysis.
    return [...buffer.toString("latin1").matchAll(/[\x20-\x7e]{5,}/g)]
        .map((match) => match[0])
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 80_000);
}

function parseDelimited(text: string): Array<Record<string, string>> {
    const first = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
    const delimiter = first.split("\t").length > first.split(",").length ? "\t" : ",";
    const records: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === '"') {
            if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
            else quoted = !quoted;
        } else if (char === delimiter && !quoted) {
            row.push(cell.trim()); cell = "";
        } else if ((char === "\n" || char === "\r") && !quoted) {
            if (char === "\r" && text[index + 1] === "\n") index += 1;
            row.push(cell.trim()); cell = "";
            if (row.some(Boolean)) records.push(row);
            row = [];
        } else {
            cell += char;
        }
    }
    if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) records.push(row); }
    if (records.length < 2) return [];
    const headers = records[0].map((header, index) => header.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `column_${index}`);
    return records.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function fieldFrom(row: Record<string, string>, candidates: string[]): string {
    for (const candidate of candidates) {
        const key = Object.keys(row).find((field) => field === candidate || field.includes(candidate));
        if (key && row[key]) return row[key];
    }
    return "";
}

function parseMoney(value: string): number | null {
    if (!value.trim()) return null;
    const negative = /^\s*\(/.test(value) || /-/.test(value);
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(parsed)) return null;
    return negative ? -parsed : parsed;
}

function parseImportedDate(value: string): Date | null {
    const text = value.trim();
    if (!text) return null;
    const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    const us = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    let normalized = text;
    if (iso) normalized = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    else if (us) normalized = `${us[3].length === 2 ? `20${us[3]}` : us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
    const date = new Date(`${normalized.slice(0, 10)}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

async function inferImportOwner(userId: string, fileName: string, text: string) {
    const [accounts, cards] = await Promise.all([
        prisma.finAccount.findMany({ where: { userId }, select: { id: true, nickname: true, last4: true, institution: true, institutionRef: { select: { name: true } } } }),
        prisma.creditCard.findMany({ where: { userId }, select: { id: true, nickname: true, productName: true, issuer: true, last4: true, institutionRef: { select: { name: true } } } }),
    ]);
    const haystack = `${fileName} ${text.slice(0, 20_000)}`.toLowerCase();
    const candidates = [
        ...accounts.map((account) => ({ kind: "account" as const, id: account.id, label: accountLabel({ ...account, kind: "Account" }), terms: [account.nickname, account.last4, account.institutionRef?.name, account.institution] })),
        ...cards.map((card) => ({ kind: "card" as const, id: card.id, label: cardLabel(card), terms: [card.nickname, card.productName, card.last4, card.institutionRef?.name, card.issuer] })),
    ];
    const ranked = candidates.map((candidate) => ({
        ...candidate,
        score: candidate.terms.filter((term) => term && String(term).length >= 3 && haystack.includes(String(term).toLowerCase())).reduce((score, term) => score + (String(term).match(/^\d{4}$/) ? 5 : 2), 0),
    })).sort((a, b) => b.score - a.score);
    return ranked[0]?.score > 0 ? ranked[0] : null;
}

export async function importFile(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const fileName = safeImportName(requiredText(input.fileName, "File name", 220));
    const mimeType = optionalText(input.mimeType, "MIME type", 120) || "application/octet-stream";
    const encoded = requiredText(input.base64, "File contents", Math.ceil(MAX_IMPORT_BYTES * 1.5));
    const buffer = Buffer.from(encoded, "base64");
    if (buffer.length === 0) throw new Error("The selected file is empty.");
    if (buffer.length > MAX_IMPORT_BYTES) throw new Error("Financial imports are limited to 20 MB per file.");
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const duplicate = await prisma.finStatement.findFirst({ where: { userId, fileSha256: sha256 }, select: { id: true, fileName: true, extractedTransactionCount: true, finAccount: { select: { nickname: true, last4: true, kind: true } }, creditCard: { select: { nickname: true, productName: true, issuer: true, last4: true } } } });
    if (duplicate) return {
        id: duplicate.id,
        classification: "duplicate statement",
        owner: duplicate.finAccount ? accountLabel(duplicate.finAccount) : duplicate.creditCard ? cardLabel(duplicate.creditCard) : "Unassigned",
        transactionCount: duplicate.extractedTransactionCount ?? 0,
        duplicate: true,
    };

    await mkdir(FINANCIAL_FILES_DIR, { recursive: true });
    const storedName = `${sha256.slice(0, 16)}-${fileName}`;
    const fileKey = path.join(FINANCIAL_FILES_DIR, storedName);
    await writeFile(fileKey, buffer);
    const text = extractDocumentText(buffer, mimeType, fileName);
    const lower = `${fileName} ${text.slice(0, 20_000)}`.toLowerCase();
    const taxLike = /\b(w-?2|1099|1098|tax return|schedule [a-z]|form 1040|tax document)\b/.test(lower);
    const owner = await inferImportOwner(userId, fileName, text);

    if (taxLike) {
        const yearMatch = lower.match(/\b(20\d{2})\b/);
        const taxYear = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
        const document = await prisma.taxDocument.create({
            data: { userId, taxYear, kind: /w-?2/.test(lower) ? "W-2" : /1099/.test(lower) ? "1099" : "Tax document", description: "Automatically classified during financial import", fileKey, fileName },
            select: { id: true },
        });
        return { id: document.id, classification: "tax document", owner: `Tax year ${taxYear}`, transactionCount: 0, aiUsed: false };
    }

    const csvRows = /csv|tab-separated|\.csv$|\.tsv$/i.test(`${mimeType} ${fileName}`) ? parseDelimited(text) : [];
    const extracted: Array<{ date: Date; amount: number; merchant: string; description: string; pending: boolean; endingBalance: number | null }> = [];
    for (const row of csvRows.slice(0, 25_000)) {
        const date = parseImportedDate(fieldFrom(row, ["date", "posted_date", "transaction_date", "posting_date"]));
        if (!date) continue;
        let amount = parseMoney(fieldFrom(row, ["amount", "transaction_amount"]));
        if (amount === null) {
            const debit = parseMoney(fieldFrom(row, ["debit", "withdrawal", "charge"]));
            const credit = parseMoney(fieldFrom(row, ["credit", "deposit"]));
            amount = credit != null && credit !== 0 ? Math.abs(credit) : debit != null ? -Math.abs(debit) : null;
        }
        if (amount === null) continue;
        const type = fieldFrom(row, ["type", "transaction_type"]).toLowerCase();
        if (/debit|purchase|withdrawal|charge/.test(type) && amount > 0) amount *= -1;
        const merchant = fieldFrom(row, ["merchant", "payee", "name", "description", "memo"]) || "Imported transaction";
        extracted.push({
            date,
            amount,
            merchant: merchant.slice(0, 180),
            description: fieldFrom(row, ["description", "memo", "details"]).slice(0, 500),
            pending: /pending|yes|true/.test(fieldFrom(row, ["pending", "status"]).toLowerCase()),
            endingBalance: parseMoney(fieldFrom(row, ["balance", "running_balance", "ending_balance"])),
        });
    }
    const dates = extracted.map((transaction) => transaction.date.getTime());
    const periodStart = dates.length ? new Date(Math.min(...dates)) : null;
    const periodEnd = dates.length ? new Date(Math.max(...dates)) : null;
    const ai = text.length > 20
        ? await ollamaJson<{ kind?: string; institution?: string; accountHint?: string; periodStart?: string; periodEnd?: string }>(`Classify this financial document and extract safe metadata. JSON keys: kind (statement, transaction export, tax document, receipt, other), institution, accountHint, periodStart (YYYY-MM-DD or null), periodEnd (YYYY-MM-DD or null). Filename: ${fileName}\nText excerpt:\n${text.slice(0, 8_000)}`, 4_000)
        : null;
    const classification = csvRows.length ? "transaction export" : ai?.value.kind || "statement";
    const statement = await prisma.finStatement.create({
        data: {
            userId,
            ...(owner?.kind === "account" ? { finAccountId: owner.id } : {}),
            ...(owner?.kind === "card" ? { creditCardId: owner.id } : {}),
            fileKey,
            fileName,
            fileSha256: sha256,
            mimeType,
            fileSize: buffer.length,
            periodStart: parseImportedDate(ai?.value.periodStart || "") ?? periodStart,
            periodEnd: parseImportedDate(ai?.value.periodEnd || "") ?? periodEnd,
            endingBalance: extracted.map((transaction) => transaction.endingBalance).filter((value): value is number => value != null).at(-1) ?? null,
            processingStatus: "PROCESSING",
            rawExtraction: {
                classification,
                institution: ai?.value.institution ?? null,
                accountHint: ai?.value.accountHint ?? null,
                previewText: text.slice(0, 12_000),
                aiModel: ai?.model ?? null,
            } as Prisma.InputJsonValue,
        },
        select: { id: true },
    });

    let transactionCount = 0;
    for (const transaction of extracted) {
        const dedupHash = createHash("sha256").update(`${userId}|${isoDate(transaction.date)}|${transaction.amount.toFixed(2)}|${normalizeMerchant(transaction.merchant)}|${owner?.id ?? ""}`).digest("hex");
        if (await prisma.finTransaction.findFirst({ where: { userId, OR: [{ dedupHash }, { statementId: statement.id, date: transaction.date, amount: transaction.amount, merchant: transaction.merchant }] }, select: { id: true } })) continue;
        const categoryName = heuristicCategory(transaction.merchant, transaction.amount);
        const categoryId = await categoryIdFor(userId, categoryName);
        await prisma.finTransaction.create({
            data: {
                userId,
                ...(owner?.kind === "account" ? { finAccountId: owner.id } : {}),
                ...(owner?.kind === "card" ? { creditCardId: owner.id } : {}),
                statementId: statement.id,
                date: transaction.date,
                amount: transaction.amount,
                merchant: transaction.merchant,
                rawDescription: transaction.description || null,
                categoryId,
                pending: transaction.pending,
                source: csvRows.length ? "CSV" : "STATEMENT",
                dedupHash,
                notes: `Auto-classified: ${categoryName}`,
            },
        });
        transactionCount += 1;
    }
    await prisma.finStatement.update({
        where: { id: statement.id },
        data: { processingStatus: "DONE", processedAt: new Date(), aiExtractedAt: ai ? new Date() : null, extractedTransactionCount: transactionCount },
    });
    return { id: statement.id, classification, owner: owner?.label ?? "Unassigned", transactionCount, aiUsed: Boolean(ai), model: ai?.model ?? null };
}

export async function getFinancialFile(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Document id");
    const statement = await prisma.finStatement.findFirst({ where: { id, userId }, select: { fileKey: true, fileName: true, mimeType: true } });
    const tax = statement ? null : await prisma.taxDocument.findFirst({ where: { id, userId }, select: { fileKey: true, fileName: true } });
    const receipt = statement || tax ? null : await prisma.finTransaction.findFirst({ where: { id, userId }, select: { receiptKey: true, receiptFileName: true, receiptMimeType: true } });
    const fileKey = statement?.fileKey || tax?.fileKey || receipt?.receiptKey;
    if (!fileKey) throw new Error("Document file not found.");
    const buffer = await readStoredFinancialFile(fileKey);
    const fileName = statement?.fileName ?? tax?.fileName ?? receipt?.receiptFileName ?? path.basename(fileKey);
    return {
        fileName,
        mimeType: statement?.mimeType ?? receipt?.receiptMimeType ?? mimeTypeFromFileName(fileName),
        base64: buffer.toString("base64"),
    };
}

function mimeTypeFromFileName(fileName: string): string {
    const extension = path.extname(fileName).toLowerCase();
    if (extension === ".pdf") return "application/pdf";
    if (extension === ".png") return "image/png";
    if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
    if (extension === ".gif") return "image/gif";
    if (extension === ".webp") return "image/webp";
    return "application/octet-stream";
}

/** Attach (or replace) a receipt image/PDF on an existing transaction, stored in the shared financial file store. */
export async function attachReceipt(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Transaction id");
    const transaction = await prisma.finTransaction.findFirst({ where: { id, userId }, select: { id: true, receiptKey: true } });
    if (!transaction) throw new Error("Transaction not found.");
    const fileName = safeImportName(requiredText(input.fileName, "File name", 220));
    const mimeType = optionalText(input.mimeType, "MIME type", 120) || "application/octet-stream";
    const encoded = requiredText(input.base64, "File contents", Math.ceil(MAX_IMPORT_BYTES * 1.5));
    const buffer = Buffer.from(encoded, "base64");
    if (buffer.length === 0) throw new Error("The selected file is empty.");
    if (buffer.length > MAX_IMPORT_BYTES) throw new Error("Receipts are limited to 20 MB.");
    await mkdir(FINANCIAL_FILES_DIR, { recursive: true });
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const fileKey = path.join(FINANCIAL_FILES_DIR, `${sha256.slice(0, 16)}-${fileName}`);
    await writeFile(fileKey, buffer);
    const priorKey = transaction.receiptKey;
    await prisma.finTransaction.update({ where: { id }, data: { receiptKey: fileKey, receiptFileName: fileName, receiptMimeType: mimeType } });
    if (priorKey && priorKey !== fileKey) {
        const resolved = path.resolve(priorKey);
        const allowedRoot = path.resolve(FINANCIAL_FILES_DIR);
        if (resolved.startsWith(`${allowedRoot}${path.sep}`)) await unlink(resolved).catch(() => undefined);
    }
    return { id, hasReceipt: true, receiptFileName: fileName };
}

export async function deleteReceipt(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Transaction id");
    const transaction = await prisma.finTransaction.findFirst({ where: { id, userId }, select: { id: true, receiptKey: true } });
    if (!transaction) throw new Error("Transaction not found.");
    await prisma.finTransaction.update({ where: { id }, data: { receiptKey: null, receiptFileName: null, receiptMimeType: null } });
    if (transaction.receiptKey) {
        const resolved = path.resolve(transaction.receiptKey);
        const allowedRoot = path.resolve(FINANCIAL_FILES_DIR);
        if (resolved.startsWith(`${allowedRoot}${path.sep}`)) await unlink(resolved).catch(() => undefined);
    }
    return { id, hasReceipt: false };
}

async function readStoredFinancialFile(fileKey: string): Promise<Buffer> {
    // Combined/LifeOS statements live in MinIO under keys like u/<userId>/financial/...
    if (isObjectStorageKey(fileKey)) {
        const buffer = await getObjectBytes(fileKey);
        if (buffer.length > MAX_IMPORT_BYTES) throw new Error("This document is too large to analyze in-app.");
        return buffer;
    }
    const resolved = path.resolve(fileKey);
    const allowedRoot = path.resolve(FINANCIAL_FILES_DIR);
    if (!resolved.startsWith(`${allowedRoot}${path.sep}`) && resolved !== allowedRoot) {
        throw new Error("Document path is outside the financial file store.");
    }
    const buffer = await readFile(resolved);
    if (buffer.length > MAX_IMPORT_BYTES) throw new Error("This document is too large to analyze in-app.");
    return buffer;
}

/** Re-run local extraction without duplicating the statement or its transactions. */
export async function reanalyzeStatement(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Statement id");
    const statement = await prisma.finStatement.findFirst({
        where: { id, userId },
        select: {
            id: true,
            fileKey: true,
            fileName: true,
            mimeType: true,
            rawExtraction: true,
            transactions: { take: 500, select: { id: true, merchant: true, rawDescription: true, amount: true } },
        },
    });
    if (!statement) throw new Error("Statement not found.");
    const buffer = await readStoredFinancialFile(statement.fileKey);
    const text = extractDocumentText(buffer, statement.mimeType ?? "application/octet-stream", statement.fileName);
    const samples = statement.transactions.slice(0, 120).map((transaction) => ({
        id: transaction.id,
        merchant: transaction.merchant || transaction.rawDescription || "Transaction",
        amount: numberValue(transaction.amount),
    }));
    const ai = await ollamaJson<{
        kind?: string;
        institution?: string;
        accountHint?: string;
        periodStart?: string | null;
        periodEnd?: string | null;
        endingBalance?: number | null;
        categories?: Array<{ id?: string; category?: string }>;
    }>(`Re-analyze this financial statement. Return JSON with kind, institution, accountHint, periodStart, periodEnd, endingBalance, and categories. categories must be an array of {id,category} using common personal-budget categories.\nFilename: ${statement.fileName}\nTransactions: ${JSON.stringify(samples)}\nText excerpt:\n${text.slice(0, 10_000)}`, 8_000);

    let categorized = 0;
    const categoryById = new Map((ai?.value.categories ?? []).filter((row) => row.id && row.category).map((row) => [row.id!, row.category!]));
    for (const transaction of statement.transactions) {
        const name = categoryById.get(transaction.id) ?? heuristicCategory(transaction.merchant || transaction.rawDescription || "", numberValue(transaction.amount));
        const categoryId = await categoryIdFor(userId, name);
        await prisma.finTransaction.update({ where: { id: transaction.id }, data: { categoryId } });
        categorized += 1;
    }

    const prior = statement.rawExtraction && typeof statement.rawExtraction === "object" && !Array.isArray(statement.rawExtraction)
        ? statement.rawExtraction as Record<string, unknown>
        : {};
    const update: Prisma.FinStatementUncheckedUpdateInput = {
        processingStatus: "DONE",
        processingError: null,
        processedAt: new Date(),
        aiExtractedAt: ai ? new Date() : null,
        rawExtraction: {
            ...prior,
            classification: ai?.value.kind ?? prior.classification ?? "statement",
            institution: ai?.value.institution ?? prior.institution ?? null,
            accountHint: ai?.value.accountHint ?? prior.accountHint ?? null,
            previewText: text.slice(0, 12_000),
            aiModel: ai?.model ?? null,
            lastReanalyzedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
    };
    const periodStart = parseImportedDate(ai?.value.periodStart ?? "");
    const periodEnd = parseImportedDate(ai?.value.periodEnd ?? "");
    if (periodStart) update.periodStart = periodStart;
    if (periodEnd) update.periodEnd = periodEnd;
    if (Number.isFinite(Number(ai?.value.endingBalance))) update.endingBalance = Number(ai?.value.endingBalance);
    await prisma.finStatement.update({ where: { id }, data: update });
    return { id, categorized, aiUsed: Boolean(ai), model: ai?.model ?? null, classification: ai?.value.kind ?? "statement" };
}

export async function reanalyzeTaxDocument(userId: string, payload: MutationPayload) {
    const id = idValue(payloadRecord(payload).id, "Tax document id");
    const document = await prisma.taxDocument.findFirst({ where: { id, userId }, select: { id: true, fileKey: true, fileName: true, taxYear: true, kind: true, description: true } });
    if (!document) throw new Error("Tax document not found.");
    if (!document.fileKey) throw new Error("This tax record does not have an attached file.");
    const buffer = await readStoredFinancialFile(document.fileKey);
    const text = extractDocumentText(buffer, "application/octet-stream", document.fileName ?? "tax-document");
    const ai = await ollamaJson<{ taxYear?: number; kind?: string; description?: string }>(`Extract searchable metadata from this tax document. Return JSON with taxYear, kind (for example W-2, 1099-NEC, 1098, receipt, return), and a short description.\nFilename: ${document.fileName ?? ""}\nText excerpt:\n${text.slice(0, 10_000)}`, 6_000);
    const yearFromText = text.match(/\b(20\d{2})\b/);
    const taxYear = Number(ai?.value.taxYear ?? yearFromText?.[1] ?? document.taxYear);
    const kind = optionalText(ai?.value.kind, "Document kind", 100) ?? document.kind;
    const description = optionalText(ai?.value.description, "Description", 500) ?? document.description;
    await prisma.taxDocument.update({ where: { id }, data: { taxYear: taxYear >= 1900 && taxYear <= 2200 ? taxYear : document.taxYear, kind, description } });
    return { id, taxYear, kind, description, aiUsed: Boolean(ai), model: ai?.model ?? null };
}

export async function aiCategorizeTransaction(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Transaction id");
    const [transaction, categories] = await Promise.all([
        prisma.finTransaction.findFirst({ where: { id, userId }, select: { id: true, merchant: true, rawDescription: true, amount: true, date: true, category: { select: { name: true } } } }),
        prisma.budgetCategory.findMany({ where: { userId }, select: { name: true } }),
    ]);
    if (!transaction) throw new Error("Transaction not found.");
    const merchant = transaction.merchant || transaction.rawDescription || "Transaction";
    const fallback = heuristicCategory(merchant, numberValue(transaction.amount));
    const allowed = [...new Set([...categories.map((category) => category.name), ...Object.keys(CATEGORY_DEFAULTS)])];
    const ai = await ollamaJson<{ category?: string; confidence?: number; reason?: string }>(`Categorize this transaction for a personal budget. Choose exactly one category from the allowed list. Return {"category":"...","confidence":0-1,"reason":"short explanation"}. Allowed: ${allowed.join(", ")}\nMerchant: ${merchant}\nDescription: ${transaction.rawDescription ?? ""}\nAmount (negative is spending): ${numberValue(transaction.amount)}\nDate: ${isoDate(transaction.date)}`);
    const proposed = ai?.value.category && allowed.some((category) => category.toLowerCase() === ai.value.category!.toLowerCase())
        ? allowed.find((category) => category.toLowerCase() === ai.value.category!.toLowerCase())!
        : fallback;
    const categoryId = await categoryIdFor(userId, proposed);
    await prisma.finTransaction.update({ where: { id }, data: { categoryId, notes: optionalText(input.notes, "Notes") ?? `AI diagnostic: ${ai?.value.reason || `rule-based match for ${merchant}`}` } });
    return { id, categoryId, category: proposed, confidence: ai?.value.confidence ?? (proposed === "Other" ? 0.35 : 0.7), reason: ai?.value.reason ?? "Local classification rules were used because Ollama was unavailable.", aiUsed: Boolean(ai), model: ai?.model ?? null };
}

export async function setTransactionCategory(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Transaction id");
    const transaction = await prisma.finTransaction.findFirst({ where: { id, userId }, select: { id: true } });
    if (!transaction) throw new Error("Transaction not found.");
    const categoryId = await optionalCategoryId(userId, input.categoryId);
    await prisma.finTransaction.update({ where: { id }, data: { categoryId, notes: optionalText(input.notes, "Override note") } });
    return { id, categoryId, updated: true };
}

/** Replace a transaction's category splits. Pass an empty array to clear (back to a single category). */
export async function setTransactionSplits(userId: string, payload: MutationPayload) {
    const input = payloadRecord(payload);
    const id = idValue(input.id, "Transaction id");
    const transaction = await prisma.finTransaction.findFirst({ where: { id, userId }, select: { id: true } });
    if (!transaction) throw new Error("Transaction not found.");
    const splits = Array.isArray(input.splits) ? input.splits : [];
    const clean: Array<{ categoryId: string | null; amount: number }> = [];
    for (const raw of splits) {
        const row = raw as Record<string, unknown>;
        const amount = numericValue(row.amount, "Split amount", { nullable: true });
        if (amount === null || amount === 0) continue;
        clean.push({ categoryId: await optionalCategoryId(userId, row.categoryId), amount });
    }
    await prisma.$transaction([
        prisma.transactionSplit.deleteMany({ where: { transactionId: id } }),
        ...(clean.length ? [prisma.transactionSplit.createMany({ data: clean.map((s) => ({ transactionId: id, categoryId: s.categoryId, amount: s.amount })) })] : []),
    ]);
    return { id, splitCount: clean.length };
}

export async function detectSubscriptions(userId: string) {
    const since = new Date(Date.now() - 550 * DAY_MS);
    const [transactions, existing] = await Promise.all([
        prisma.finTransaction.findMany({ where: { userId, amount: { lt: 0 }, date: { gte: since } }, orderBy: { date: "asc" }, select: { id: true, merchant: true, rawDescription: true, amount: true, date: true } }),
        prisma.finSubscription.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, merchant: true, amount: true, cadence: true, status: true } }),
    ]);
    const merchantNames = [...new Set(transactions.map((transaction) => transaction.merchant || transaction.rawDescription || "").filter(Boolean))];
    const ai = merchantNames.length > 1
        ? await ollamaJson<{ aliases?: Array<{ merchant: string; canonical: string }> }>(`Normalize recurring billing merchant aliases. Return {"aliases":[{"merchant":"exact input","canonical":"clean service name"}]}. Inputs: ${JSON.stringify(merchantNames.slice(0, 250))}`, 6_000)
        : null;
    const aliases = new Map((ai?.value.aliases ?? []).map((alias) => [alias.merchant.toLowerCase(), alias.canonical]));
    const groups = new Map<string, Array<(typeof transactions)[number]>>();
    for (const transaction of transactions) {
        const raw = transaction.merchant || transaction.rawDescription || "Unknown";
        const canonical = aliases.get(raw.toLowerCase()) || normalizeMerchant(raw) || raw.toLowerCase();
        const group = groups.get(canonical) ?? [];
        group.push(transaction);
        groups.set(canonical, group);
    }
    let created = 0;
    let updated = 0;
    let duplicatesMerged = 0;
    let detected = 0;
    for (const [canonical, rows] of groups) {
        if (rows.length < 2) continue;
        const intervals = rows.slice(1).map((row, index) => Math.round((row.date.getTime() - rows[index].date.getTime()) / DAY_MS)).filter((days) => days > 0);
        const averageInterval = average(intervals);
        const amounts = rows.map((row) => Math.abs(numberValue(row.amount)));
        const meanAmount = average(amounts);
        const deviation = meanAmount > 0 ? Math.max(...amounts.map((amount) => Math.abs(amount - meanAmount) / meanAmount)) : 1;
        const cadence = averageInterval >= 300 ? "YEARLY" : averageInterval >= 20 && averageInterval <= 45 ? "MONTHLY" : averageInterval >= 5 && averageInterval <= 10 ? "WEEKLY" : null;
        if (!cadence || deviation > 0.35) continue;
        detected += 1;
        const matches = existing.filter((subscription) => normalizeMerchant(subscription.merchant || subscription.name || "") === normalizeMerchant(canonical));
        let subscriptionId: string;
        const latest = rows.at(-1)!;
        const nextCharge = new Date(latest.date.getTime() + (cadence === "WEEKLY" ? 7 : cadence === "YEARLY" ? 365 : 30) * DAY_MS);
        if (matches.length > 0) {
            const keeper = matches[0];
            subscriptionId = keeper.id;
            await prisma.finSubscription.update({ where: { id: keeper.id }, data: { merchant: canonical.slice(0, 160), name: canonical.replace(/\b\w/g, (char) => char.toUpperCase()).slice(0, 160), amount: round(meanAmount), cadence, status: "ACTIVE", nextChargeOn: nextCharge } });
            updated += 1;
            for (const duplicate of matches.slice(1)) {
                await prisma.finTransaction.updateMany({ where: { userId, subscriptionId: duplicate.id }, data: { subscriptionId: keeper.id } });
                await prisma.finSubscription.delete({ where: { id: duplicate.id } });
                duplicatesMerged += 1;
            }
        } else {
            const subscription = await prisma.finSubscription.create({ data: { userId, name: canonical.replace(/\b\w/g, (char) => char.toUpperCase()).slice(0, 160), merchant: canonical.slice(0, 160), amount: round(meanAmount), cadence, status: "ACTIVE", startedOn: rows[0].date, nextChargeOn: nextCharge }, select: { id: true } });
            subscriptionId = subscription.id;
            created += 1;
        }
        await prisma.finTransaction.updateMany({ where: { userId, id: { in: rows.map((row) => row.id) } }, data: { subscriptionId } });
    }
    return { detected, created, updated, duplicatesMerged, aiUsed: Boolean(ai), model: ai?.model ?? null };
}
