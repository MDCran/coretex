import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SectionHeader } from "../_components/financial-ui";
import { ReportsClient, type ReportRow } from "./reports-client";

export const dynamic = "force-dynamic";

export default async function FinancialReportsPage() {
    const user = await requireUser();
    const since = new Date();
    since.setUTCFullYear(since.getUTCFullYear() - 1);

    const txns = await db.finTransaction.findMany({
        where: { userId: user.id, date: { gte: since } },
        orderBy: { date: "desc" },
        include: {
            category: { select: { name: true } },
            finAccount: { select: { nickname: true, last4: true } },
            creditCard: { select: { nickname: true, productName: true, last4: true } },
        },
    });

    const rows: ReportRow[] = txns.map((t) => ({
        id: t.id,
        date: t.date.toISOString().slice(0, 10),
        merchant: t.merchant || t.rawDescription || "—",
        category: t.category?.name ?? "Uncategorized",
        account: t.finAccount
            ? t.finAccount.nickname || `Account ••${t.finAccount.last4 ?? ""}`
            : t.creditCard
              ? t.creditCard.nickname || t.creditCard.productName || `Card ••${t.creditCard.last4 ?? ""}`
              : "—",
        amount: Number(t.amount),
    }));

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader title="Financial reports" description="Filter your transactions by date, category or account and export to CSV or PDF for taxes and records." />
            <ReportsClient rows={rows} />
        </div>
    );
}
