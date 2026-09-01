import { requireUser } from "@/lib/auth";
import { getTodoAnalytics, getTodoLoadByDay } from "@/lib/todo-analytics";
import { dateKey, dayOf } from "@/lib/todos";
import { AnalyticsClient } from "./analytics-client";

export default async function TodoAnalyticsPage() {
    const user = await requireUser();
    const today = dayOf(new Date());
    const start30 = new Date(today.getTime() - 29 * 86400000);

    // Heatmap: 10 weeks aligned to Monday columns.
    const dow = (today.getUTCDay() + 6) % 7;
    const weekStart = new Date(today.getTime() - dow * 86400000);
    const weeks = 10;
    const heatStart = new Date(weekStart.getTime() - (weeks - 1) * 7 * 86400000);

    const [analytics, load] = await Promise.all([
        getTodoAnalytics(user.id, start30, today),
        getTodoLoadByDay(user.id, heatStart, today),
    ]);

    return <AnalyticsClient analytics={analytics} load={load} heatStart={dateKey(heatStart)} weeks={weeks} />;
}
