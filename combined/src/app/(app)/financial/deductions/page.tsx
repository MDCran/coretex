import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { cleanNotes, parseDeductible } from "@/lib/financial/deductions";
import { DeductionsClient, type DeductionRow } from "./deductions-client";

export const dynamic = "force-dynamic";

export default async function TaxDeductionsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
    const user = await requireUser();
    const sp = await searchParams;

    const nowYear = new Date().getUTCFullYear();
    const year = Number(sp.year) || nowYear;
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

    const txns = await db.finTransaction.findMany({
        where: { userId: user.id, date: { gte: yearStart, lt: yearEnd }, amount: { lt: 0 } },
        orderBy: { date: "desc" },
        take: 1000,
        include: { category: { select: { name: true } } },
    });

    const rows: DeductionRow[] = txns.map((t) => {
        const d = parseDeductible(t.notes);
        return {
            id: t.id,
            date: t.date.toISOString().slice(0, 10),
            merchant: t.merchant || t.rawDescription || "—",
            category: t.category?.name ?? null,
            amount: Number(t.amount),
            deductible: d.deductible,
            deductionCategory: d.category,
            note: cleanNotes(t.notes),
        };
    });

    const years = Array.from({ length: 4 }, (_, i) => nowYear - i);

    return <DeductionsClient rows={rows} year={year} years={years} />;
}
