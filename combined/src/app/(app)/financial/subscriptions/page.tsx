import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SubscriptionsClient, type SubRow } from "./subscriptions-client";

export default async function SubscriptionsPage() {
    const user = await requireUser();
    const [subs, settings] = await Promise.all([
        db.finSubscription.findMany({
            where: { userId: user.id },
            orderBy: [{ status: "asc" }, { nextChargeOn: "asc" }],
            include: { _count: { select: { transactions: true } } },
        }),
        db.settings.findUnique({ where: { userId: user.id }, select: { lastSubscriptionScanAt: true } }),
    ]);

    const lastScanAt = settings?.lastSubscriptionScanAt ?? null;

    // Hide internal dismissal markers from the visible list.
    const visible = subs.filter((s) => !(s.notes ?? "").includes("[[detect-dismissed:"));

    const rows: SubRow[] = visible.map((s) => ({
        id: s.id,
        name: s.name,
        merchant: s.merchant,
        cadence: s.cadence,
        amount: Number(s.amount),
        status: s.status,
        startedOn: s.startedOn?.toISOString() ?? null,
        nextChargeOn: s.nextChargeOn?.toISOString() ?? null,
        notes: s.notes,
        transactionCount: s._count.transactions,
    }));

    return (
        <SubscriptionsClient subscriptions={rows} lastScanAt={lastScanAt?.toISOString() ?? null} />
    );
}
