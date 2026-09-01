import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { GoalsClient, type GoalRow } from "./goals-client";

export default async function GoalsPage() {
    const user = await requireUser();

    const goals = await db.financialGoal.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
    });

    const rows: GoalRow[] = goals.map((g) => ({
        id: g.id,
        title: g.title,
        targetAmount: g.targetAmount != null ? Number(g.targetAmount) : null,
        currentAmount: Number(g.currentAmount),
        targetDate: g.targetDate?.toISOString() ?? null,
    }));

    return <GoalsClient goals={rows} />;
}
