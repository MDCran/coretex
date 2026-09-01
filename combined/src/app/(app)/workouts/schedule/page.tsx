import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "../_components/workouts-ui";
import { AdherenceStats } from "./_components/adherence-stats";
import { ScheduleManager } from "./_components/schedule-manager";

export default async function SchedulePage() {
    const user = await requireUser();

    const schedules = await db.workoutSchedule.findMany({
        where: { userId: user.id },
        orderBy: { date: "desc" },
        include: { template: { select: { name: true } } },
    });

    // Determine, per schedule date, whether a non-deleted workout exists (implicit fulfillment).
    const dates = [...new Set(schedules.map((s) => s.date.getTime()))].map((t) => new Date(t));
    const workouts = dates.length
        ? await db.workout.findMany({
              where: { userId: user.id, deletedAt: null, date: { in: dates } },
              select: { date: true },
          })
        : [];
    const datesWithWorkout = new Set(workouts.map((w) => w.date.toISOString().slice(0, 10)));

    const plans = schedules.map((s) => {
        const dateKey = s.date.toISOString().slice(0, 10);
        return {
            id: s.id,
            date: dateKey,
            templateId: s.templateId,
            templateName: s.template?.name ?? null,
            name: s.name,
            notes: s.notes,
            workoutId: s.workoutId,
            skipped: s.skipped,
            hasWorkoutOnDate: datesWithWorkout.has(dateKey),
        };
    });

    const templates = await db.template.findMany({
        where: { userId: user.id, archived: false },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
    });

    const statsPlans = plans.map((p) => ({ date: p.date, skipped: p.skipped, workoutId: p.workoutId, hasWorkoutOnDate: p.hasWorkoutOnDate }));

    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                title="Training schedule"
                description="Plan your week ahead, build an unbroken streak, and keep your adherence honest. The button lives in the planner below."
            />

            <AdherenceStats plans={statsPlans} />

            <ScheduleManager plans={plans} templates={templates} showHeaderButton />
        </div>
    );
}
