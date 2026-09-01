// @ts-nocheck
// import "server-only";

import { startOfDay, subDays } from "date-fns";
import { db } from "../../db/prisma.js";

export interface UpcomingBill {
    id: string;
    label: string;
    dueAt: string;
    amount: number | null;
    overdue: boolean;
    kind: "subscription" | "card";
}

/** Upcoming subscriptions + credit-card payment due dates (Plaid liabilities). */
export async function fetchUpcomingBills(userId: string, now = new Date(), limit = 4): Promise<UpcomingBill[]> {
    const dayStart = startOfDay(now);
    const horizon = subDays(now, -21);
    const bills: UpcomingBill[] = [];

    const subs = await db.finSubscription.findMany({
        where: {
            userId,
            status: "ACTIVE",
            nextChargeOn: { not: null, lte: horizon },
        },
        orderBy: { nextChargeOn: "asc" },
        take: limit,
        select: { id: true, merchant: true, name: true, nextChargeOn: true, amount: true },
    });

    for (const s of subs) {
        if (!s.nextChargeOn) continue;
        bills.push({
            id: `sub-${s.id}`,
            label: s.name ?? s.merchant,
            dueAt: s.nextChargeOn.toISOString(),
            amount: Number(s.amount),
            overdue: s.nextChargeOn < dayStart,
            kind: "subscription",
        });
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- optional Plaid liability columns; safe when client is stale
        const cards = await (db.creditCard as any).findMany({
            where: {
                userId,
                archived: false,
                paymentDueAt: { not: null, lte: horizon },
            },
            orderBy: { paymentDueAt: "asc" },
            take: limit,
            select: {
                id: true,
                nickname: true,
                productName: true,
                paymentDueAt: true,
                minimumPayment: true,
                paymentOverdue: true,
            },
        }) as Array<{
            id: string;
            nickname: string | null;
            productName: string | null;
            paymentDueAt: Date | null;
            minimumPayment: unknown;
            paymentOverdue: boolean;
        }>;

        for (const c of cards) {
            if (!c.paymentDueAt) continue;
            bills.push({
                id: `card-${c.id}`,
                label: c.nickname ?? c.productName ?? "Credit card",
                dueAt: c.paymentDueAt.toISOString(),
                amount: c.minimumPayment != null ? Number(c.minimumPayment) : null,
                overdue: c.paymentOverdue,
                kind: "card",
            });
        }
    } catch {
        // CreditCard.paymentDueAt requires migrated schema + regenerated Prisma client.
    }

    return bills
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
        .slice(0, limit);
}
