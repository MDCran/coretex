import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { GoalDetailClient } from "./goal-detail-client";

export default async function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const user = await requireUser();

    const goal = await db.learningGoal.findFirst({
        where: { id, userId: user.id },
        include: {
            milestones: { orderBy: { order: "asc" } },
            resources: { orderBy: { createdAt: "desc" } },
        },
    });
    if (!goal) notFound();

    const sessions = await db.learningSession.findMany({
        where: { userId: user.id, goalId: id },
        orderBy: { sessionDate: "desc" },
        take: 20,
    });

    return (
        <GoalDetailClient
            goal={{
                id: goal.id,
                title: goal.title,
                description: goal.description,
                goalType: goal.goalType,
                color: goal.color,
                targetDate: goal.targetDate?.toISOString() ?? null,
                completed: goal.completed,
                streakCount: goal.streakCount,
                freezeTokens: goal.freezeTokens,
                lastStudiedOn: goal.lastStudiedOn?.toISOString() ?? null,
            }}
            milestones={goal.milestones.map((m) => ({
                id: m.id,
                title: m.title,
                dueDate: m.dueDate?.toISOString() ?? null,
                status: m.status,
                order: m.order,
            }))}
            resources={goal.resources.map((r) => ({
                id: r.id,
                title: r.title,
                resourceType: r.resourceType,
                url: r.url,
                notes: r.notes,
            }))}
            sessions={sessions.map((s) => ({
                id: s.id,
                sessionDate: s.sessionDate.toISOString(),
                durationMinutes: s.durationMinutes,
                notes: s.notes,
            }))}
        />
    );
}
