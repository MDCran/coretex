import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { GoalsClient } from "./goals-client";

export default async function LearningGoalsPage() {
    const user = await requireUser();

    const goals = await db.learningGoal.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        include: {
            milestones: { select: { status: true } },
        },
    });

    return (
        <GoalsClient
            goals={goals.map((g) => ({
                id: g.id,
                title: g.title,
                description: g.description,
                goalType: g.goalType,
                color: g.color,
                targetDate: g.targetDate?.toISOString() ?? null,
                completed: g.completed,
                streakCount: g.streakCount,
                freezeTokens: g.freezeTokens,
                milestonesTotal: g.milestones.length,
                milestonesDone: g.milestones.filter((m) => m.status === "DONE").length,
            }))}
        />
    );
}
