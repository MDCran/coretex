import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getGoalCalcData } from "@/lib/actions/health-nutrition";
import { GoalsClient } from "@/app/(app)/health/goals/goals-client";

export const dynamic = "force-dynamic";

export default async function SettingsGoalsPage() {
    const user = await requireUser();
    const [data, settings] = await Promise.all([
        getGoalCalcData(),
        db.settings.findUnique({ where: { userId: user.id } }),
    ]);

    return (
        <div className="flex flex-col gap-4">
            <p className="text-sm text-tertiary">
                Nutrition and body-composition targets shared across Health, Nutrition and Workouts. Changes here apply everywhere.
            </p>
            <GoalsClient unitSystem={settings?.unitSystem ?? "IMPERIAL"} data={data} />
        </div>
    );
}
