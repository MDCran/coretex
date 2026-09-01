import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { FocusClient } from "./focus-client";

function startOfWeek(d: Date) {
    const r = new Date(d);
    const day = (r.getDay() + 6) % 7;
    r.setDate(r.getDate() - day);
    r.setHours(0, 0, 0, 0);
    return r;
}

export default async function FocusPage() {
    const user = await requireUser();
    const weekOf = startOfWeek(new Date());

    const [sprints, priorities, rewards, periods] = await Promise.all([
        db.focusSprint.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
        db.weeklyPriority.findMany({ where: { userId: user.id }, orderBy: [{ weekOf: "desc" }, { order: "asc" }] }),
        db.rewardGoal.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
        db.goalPeriod.findMany({ where: { userId: user.id }, orderBy: { startDate: "desc" } }),
    ]);

    return (
        <FocusClient
            weekOf={weekOf.toISOString().slice(0, 10)}
            sprints={sprints.map((s) => ({
                id: s.id,
                title: s.title,
                durationMinutes: s.durationMinutes,
                startedAt: s.startedAt?.toISOString() ?? null,
                finishedAt: s.finishedAt?.toISOString() ?? null,
                completed: s.completed,
            }))}
            priorities={priorities.map((p) => ({ id: p.id, priorityText: p.priorityText, weekOf: p.weekOf.toISOString().slice(0, 10), order: p.order, completed: p.completed }))}
            rewards={rewards.map((r) => ({ id: r.id, description: r.description, points: r.points, earned: r.earned }))}
            periods={periods.map((p) => ({ id: p.id, periodName: p.periodName, startDate: p.startDate.toISOString().slice(0, 10), endDate: p.endDate.toISOString().slice(0, 10) }))}
        />
    );
}
