import "server-only";

import { db } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface NetWorthTotals {
    assets: number;
    liabilities: number;
    netWorth: number;
}

export interface DailyNetWorthPoint extends NetWorthTotals {
    /** Date-only ISO key, e.g. 2026-06-19. */
    date: string;
    /** Tight chart label, e.g. Jun 19. */
    label: string;
}

function utcDayStart(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDay(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function labelForIsoDay(iso: string): string {
    const [, month, day] = iso.split("-").map(Number);
    return `${MONTH_LABELS[(month || 1) - 1]} ${day || ""}`.trim();
}

function roundedMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

export async function getCurrentNetWorthTotals(userId: string): Promise<NetWorthTotals> {
    const [accounts, brokerage, cards, debts] = await Promise.all([
        db.finAccount.findMany({ where: { userId, archived: false } }),
        db.brokerageAccount.findMany({ where: { userId, archived: false } }),
        db.creditCard.findMany({ where: { userId, archived: false } }),
        db.debt.findMany({ where: { userId } }),
    ]);

    let assets = 0;
    let liabilities = 0;

    for (const account of accounts) {
        if (!account.includeInNetWorth) continue;
        const balance = Number(account.currentBalance);
        if (account.kind === "LOAN" || !account.isAsset) liabilities += Math.abs(balance);
        else assets += balance;
    }

    assets += brokerage.reduce((sum, account) => sum + Number(account.currentValue), 0);
    liabilities += cards.reduce((sum, card) => sum + Number(card.currentBalance), 0);
    liabilities += debts.reduce((sum, debt) => sum + Number(debt.principalRemaining ?? 0), 0);

    return { assets, liabilities, netWorth: assets - liabilities };
}

export async function buildDailyNetWorthHistory({
    userId,
    current,
    days = 90,
}: {
    userId: string;
    current: NetWorthTotals;
    days?: number;
}): Promise<DailyNetWorthPoint[]> {
    const safeDays = Math.max(2, Math.min(730, Math.round(days)));
    const today = utcDayStart(new Date());
    const start = new Date(today.getTime() - (safeDays - 1) * DAY_MS);
    const endExclusive = new Date(today.getTime() + DAY_MS);

    const transactions = await db.finTransaction.findMany({
        where: {
            userId,
            date: { gte: start, lt: endExclusive },
            OR: [{ finAccountId: { not: null } }, { creditCardId: { not: null } }],
        },
        select: {
            date: true,
            amount: true,
            finAccount: { select: { archived: true, includeInNetWorth: true, isAsset: true, kind: true } },
            creditCard: { select: { archived: true } },
        },
    });

    if (transactions.length === 0 && current.assets === 0 && current.liabilities === 0 && current.netWorth === 0) return [];

    const deltas = new Map<string, { assets: number; liabilities: number }>();
    let totalAssetDelta = 0;
    let totalLiabilityDelta = 0;

    for (const txn of transactions) {
        const amount = Number(txn.amount);
        if (!Number.isFinite(amount) || amount === 0) continue;

        let assetDelta = 0;
        let liabilityDelta = 0;

        if (txn.finAccount) {
            if (txn.finAccount.archived || !txn.finAccount.includeInNetWorth) continue;
            if (txn.finAccount.kind === "LOAN" || !txn.finAccount.isAsset) liabilityDelta = -amount;
            else assetDelta = amount;
        } else if (txn.creditCard) {
            if (txn.creditCard.archived) continue;
            // Card charges are negative and increase liabilities; payments are positive and reduce them.
            liabilityDelta = -amount;
        } else {
            continue;
        }

        const key = isoDay(txn.date);
        const bucket = deltas.get(key) ?? { assets: 0, liabilities: 0 };
        bucket.assets += assetDelta;
        bucket.liabilities += liabilityDelta;
        deltas.set(key, bucket);
        totalAssetDelta += assetDelta;
        totalLiabilityDelta += liabilityDelta;
    }

    let assets = current.assets - totalAssetDelta;
    let liabilities = current.liabilities - totalLiabilityDelta;
    const points: DailyNetWorthPoint[] = [];

    for (let i = 0; i < safeDays; i++) {
        const day = new Date(start.getTime() + i * DAY_MS);
        const key = isoDay(day);
        const delta = deltas.get(key);
        if (delta) {
            assets += delta.assets;
            liabilities += delta.liabilities;
        }

        const safeLiabilities = Math.max(0, liabilities);
        points.push({
            date: key,
            label: labelForIsoDay(key),
            assets: roundedMoney(assets),
            liabilities: roundedMoney(safeLiabilities),
            netWorth: roundedMoney(assets - safeLiabilities),
        });
    }

    // Pin the last point to live current values so the chart and headline agree.
    const last = points[points.length - 1];
    if (last) {
        last.assets = roundedMoney(current.assets);
        last.liabilities = roundedMoney(Math.max(0, current.liabilities));
        last.netWorth = roundedMoney(current.netWorth);
    }

    return points;
}
