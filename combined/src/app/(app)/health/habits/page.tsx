import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { HabitsClient, type HabitRow } from "./habits-client";

export default async function HabitsPage() {
    const user = await requireUser();
    const since = new Date();
    since.setDate(since.getDate() - 200);

    const habits = await db.habit.findMany({
        where: { userId: user.id },
        orderBy: [{ active: "desc" }, { createdAt: "asc" }],
        include: {
            logs: { where: { logDate: { gte: since } }, select: { logDate: true } },
            milestones: { orderBy: { milestoneDate: "desc" } },
        },
    });

    const rows: HabitRow[] = habits.map((h) => ({
        id: h.id,
        name: h.name,
        description: h.description,
        habitType: h.habitType,
        frequency: h.frequency,
        targetCount: h.targetCount,
        targetDays: h.targetDays,
        daysOfWeek: h.daysOfWeek,
        color: h.color,
        icon: h.icon,
        category: h.category,
        cue: h.cue,
        routine: h.routine,
        reward: h.reward,
        stackAfterHabitId: h.stackAfterHabitId,
        difficulty: h.difficulty,
        priority: h.priority,
        reminderTime: h.reminderTime,
        active: h.active,
        createdAt: h.createdAt.toISOString(),
        logDates: h.logs.map((l) => l.logDate.toISOString().slice(0, 10)),
        milestones: h.milestones.map((m) => ({ id: m.id, milestoneDate: m.milestoneDate.toISOString().slice(0, 10), description: m.description })),
    }));

    return <HabitsClient habits={rows} />;
}
