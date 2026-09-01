import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getGoalCalcData } from "@/lib/actions/health-nutrition";
import { GoalsClient } from "./goals-client";

export const dynamic = "force-dynamic";

export default async function HealthGoalsPage() {
    const user = await requireUser();
    const [data, settings] = await Promise.all([
        getGoalCalcData(),
        db.settings.findUnique({ where: { userId: user.id } }),
    ]);

    return <GoalsClient unitSystem={settings?.unitSystem ?? "IMPERIAL"} data={data} />;
}
