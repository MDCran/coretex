import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConfigured } from "@/lib/ai/claude";
import { GENERIC_TOTAL_CATEGORY } from "@/lib/financial/category-data";
import { backfillCategoryColors, seedDefaultCategoriesIfEmpty } from "@/lib/financial/seed";
import type { TrendPoint } from "../_components/trend-chart";
import { BudgetClient, type CategoryRow } from "./budget-client";

export default async function BudgetPage() {
    const user = await requireUser();

    await seedDefaultCategoriesIfEmpty(user.id);
    await backfillCategoryColors(user.id);

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const twelveMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

    const allCategories = await db.budgetCategory.findMany({
        where: { userId: user.id },
        orderBy: { name: "asc" },
    });
    const genericCat = allCategories.find((c) => c.name === GENERIC_TOTAL_CATEGORY);
    const categories = allCategories.filter((c) => c.name !== GENERIC_TOTAL_CATEGORY);
    const genericTotal = genericCat?.monthlyBudget != null ? Number(genericCat.monthlyBudget) : null;

    const grouped = await db.finTransaction.groupBy({
        by: ["categoryId"],
        where: { userId: user.id, date: { gte: monthStart, lt: monthEnd }, amount: { lt: 0 } },
        _sum: { amount: true },
    });
    const spentByCat = new Map<string, number>();
    let uncategorizedSpend = 0;
    const addSpend = (catId: string | null, amt: number) => {
        if (catId) spentByCat.set(catId, (spentByCat.get(catId) ?? 0) + amt);
        else uncategorizedSpend += amt;
    };
    for (const g of grouped) {
        const amt = Math.abs(Number(g._sum.amount ?? 0));
        if (g.categoryId) spentByCat.set(g.categoryId, amt);
        else uncategorizedSpend += amt;
    }

    // Honor split transactions: the groupBy above attributed each split txn's full amount to
    // its single category — reallocate it to the split slices instead.
    const splitTxns = await db.finTransaction.findMany({
        where: { userId: user.id, date: { gte: monthStart, lt: monthEnd }, amount: { lt: 0 }, splits: { some: {} } },
        select: { amount: true, categoryId: true, splits: { select: { categoryId: true, amount: true } } },
    });
    for (const t of splitTxns) {
        addSpend(t.categoryId, -Math.abs(Number(t.amount)));
        for (const s of t.splits) addSpend(s.categoryId, Math.abs(Number(s.amount)));
    }
    for (const [k, v] of spentByCat) if (v < 0) spentByCat.set(k, 0);
    if (uncategorizedSpend < 0) uncategorizedSpend = 0;

    const rows: CategoryRow[] = categories.map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parentId,
        monthlyBudget: c.monthlyBudget != null ? Number(c.monthlyBudget) : null,
        color: c.color ?? null,
        spent: spentByCat.get(c.id) ?? 0,
    }));

    const monthTxns = await db.finTransaction.findMany({
        where: { userId: user.id, date: { gte: monthStart, lt: monthEnd }, amount: { lt: 0 } },
        orderBy: { date: "desc" },
        select: { id: true, date: true, amount: true, merchant: true, rawDescription: true, categoryId: true },
    });
    const transactionsByCategory: Record<string, { id: string; date: string; amount: number; merchant: string }[]> = {};
    for (const t of monthTxns) {
        const key = t.categoryId ?? "__none__";
        const list = transactionsByCategory[key] ?? [];
        list.push({
            id: t.id,
            date: t.date.toISOString().slice(0, 10),
            amount: Number(t.amount),
            merchant: t.merchant || t.rawDescription || "Transaction",
        });
        transactionsByCategory[key] = list;
    }

    // 12-month spending trend per category (all historical txns, not just this month).
    const trendTxns = await db.finTransaction.findMany({
        where: { userId: user.id, date: { gte: twelveMonthsAgo }, amount: { lt: 0 }, categoryId: { not: null } },
        select: { categoryId: true, date: true, amount: true },
    });
    const trendByCatMonth = new Map<string, Map<string, number>>();
    for (const t of trendTxns) {
        if (!t.categoryId) continue;
        const monthKey = t.date.toISOString().slice(0, 7);
        const catMap = trendByCatMonth.get(t.categoryId) ?? new Map<string, number>();
        catMap.set(monthKey, (catMap.get(monthKey) ?? 0) + Math.abs(Number(t.amount)));
        trendByCatMonth.set(t.categoryId, catMap);
    }
    const spendingTrends: Record<string, TrendPoint[]> = {};
    for (const [catId, months] of trendByCatMonth.entries()) {
        spendingTrends[catId] = [...months.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([key, value]) => ({
                label: new Date(`${key}-01T12:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
                Spending: Math.round(value * 100) / 100,
            }));
    }

    const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();
    const monthPace = now.getUTCDate() / daysInMonth;

    return (
        <BudgetClient
            categories={rows}
            uncategorizedSpend={uncategorizedSpend}
            monthPace={monthPace}
            genericTotal={genericTotal}
            aiConfigured={aiConfigured()}
            transactionsByCategory={transactionsByCategory}
            spendingTrends={spendingTrends}
        />
    );
}
