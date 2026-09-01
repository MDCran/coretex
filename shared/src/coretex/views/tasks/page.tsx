// @ts-nocheck



import { TodosClient } from "./todos-client";

export default async function TodosPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
    const user = await requireUser();
    const sp = await searchParams;
    const day = parseDateKey(sp.date);

    // Today (UTC day key), and the week containing the viewed day (Mon start).
    const todayKey = dateKey(dayOf(new Date()));
    const viewingToday = dateKey(day) === todayKey;

    // Roll unfinished one-off tasks from past days onto today (only when today is in view).
    if (viewingToday) await rolloverPastTodos(user.id, day);

    // Week (Monday) containing the viewed day, for the review digest.
    const dow = (day.getUTCDay() + 6) % 7; // 0 = Monday
    const weekStart = new Date(day.getTime() - dow * 86400000);

    const [todos, routines, digest] = await Promise.all([
        getTodosForDay(user.id, day),
        getRoutines(user.id),
        getWeeklyDigest(user.id, weekStart),
    ]);

    return <TodosClient date={dateKey(day)} todos={todos} routines={routines} digest={digest} />;
}
