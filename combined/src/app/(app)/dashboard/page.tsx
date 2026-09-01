import type { FC } from "react";
import {
    Activity,
    ActivityHeart,
    BankNote03,
    Beaker02,
    BookOpen01,
    Briefcase01,
    Calendar,
    CheckDone01,
    Moon01,
    Scales01,
    Users01,
} from "@untitledui/icons";
import { eachDayOfInterval, endOfDay, format, startOfDay, startOfWeek, subDays } from "date-fns";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseHiddenAreas, isHrefEnabled } from "@/lib/areas";
import { listPeptides } from "@/lib/actions/peptides";
import { generateSchedule } from "@/lib/peptides/schedule";
import { isOccurrenceTaken } from "@/lib/peptides/admin";
import { peptideColor } from "@/lib/peptides/peptide-color";
import { todayISO } from "@/lib/peptides/date";
import { formatDateShort } from "@/lib/dates";
import { formatWeight, weightToDisplay, weightUnit } from "@/lib/units";
import { materializeDay } from "@/lib/todos";
import { materializeDueReminders } from "@/lib/reminders-materialize";
import { QuickActions } from "./_components/quick-actions";
import { OnboardingChecklist } from "@/components/app-shell/onboarding-checklist";
import { LiveRefresh } from "@/components/app-shell/live-refresh";
import { MarqueeTicker, type TickerItem } from "@/components/app-shell/marquee-ticker";
import { Reveal } from "@/components/foundations/reveal";
import { getOnboardingSteps } from "@/lib/onboarding";
import { DashboardCta, type CtaDef } from "./_components/dashboard-cta";
import { DashboardPromos } from "./_components/dashboard-promos";
import { DashboardModules, type ModuleCard } from "./_components/dashboard-modules";
import { DashboardCharts, type BillDue } from "./_components/dashboard-charts";
import { DashboardStats, type DashboardStat } from "./_components/dashboard-stats";
import { DosesCard, type PeptideDoseItem, type TherapeuticDoseItem } from "./_components/doses-card";
import { TodosCard, type TodoRow } from "./_components/todos-card";
import { TodayCard, type EventItem, type ReminderItem } from "./_components/today-card";
import type { TrendPoint } from "@/app/(app)/health/_components/trend-chart";
import { fetchUpcomingBills } from "@/lib/financial/upcoming-bills";
import { buildDailyNetWorthHistory, getCurrentNetWorthTotals } from "@/lib/financial/net-worth-history";

export default async function DashboardPage() {
    const user = await requireUser();
    const firstName = user.name?.split(" ")[0] ?? "there";

    const now = new Date();
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);
    const tomorrowStart = startOfDay(subDays(now, -1));
    const tomorrowEnd = endOfDay(subDays(now, -1));
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const sevenDaysAgo = startOfDay(subDays(now, 6));
    // Monday of 5 weeks ago → six weekly buckets (this week + the prior five).
    const sixWeeksAgo = startOfWeek(subDays(now, 35), { weekStartsOn: 1 });
    const iso = todayISO();

    // Per-day todos: materialize today (routines + sweep) before querying.
    const todayDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await materializeDay(user.id, todayDate);
    // Surface due/overdue recurring reminders as notifications (no worker).
    await materializeDueReminders(user.id);

    const [
        peptides,
        therapeuticDoseRows,
        todoRows,
        todosOpenCount,
        eventRows,
        reminderRows,
        tomorrowEventCount,
        tomorrowReminderCount,
        activeApplications,
        upcomingDeadlines,
        habitsActive,
        habitsLoggedToday,
        workoutsThisWeek,
        contactCount,
        coursesInProgress,
        latestWeight,
        unitSettings,
        sleepLast,
        unreadNotifications,
        weekTransactionRows,
        habitLogsWeek,
        todosDoneWeek,
        todosTotalWeek,
        sleepEntriesWeek,
        weightRows,
        workoutRows,
    ] = await Promise.all([
        listPeptides(),
        db.therapeuticDose.findMany({
            where: { userId: user.id, scheduledAt: { gte: dayStart, lte: dayEnd } },
            orderBy: { scheduledAt: "asc" },
            include: { schedule: true },
        }),
        db.todoItem.findMany({
            where: { userId: user.id, date: todayDate, status: { in: ["PLANNED", "IN_PROGRESS", "DRIPPED"] } },
            orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
            take: 8,
            select: { id: true, title: true, dueAt: true, status: true },
        }),
        db.todoItem.count({ where: { userId: user.id, date: todayDate, status: { in: ["PLANNED", "IN_PROGRESS", "DRIPPED"] } } }),
        db.calendarEvent.findMany({
            where: { userId: user.id, startsAt: { gte: dayStart, lte: dayEnd } },
            orderBy: [{ allDay: "desc" }, { startsAt: "asc" }],
            take: 8,
            select: { id: true, title: true, allDay: true, startsAt: true },
        }),
        db.recurringReminder.findMany({
            where: { userId: user.id, archived: false, nextDueAt: { lte: dayEnd } },
            orderBy: { nextDueAt: "asc" },
            take: 8,
            select: { id: true, title: true, icon: true, nextDueAt: true },
        }),
        db.calendarEvent.count({ where: { userId: user.id, startsAt: { gte: tomorrowStart, lte: tomorrowEnd } } }),
        db.recurringReminder.count({ where: { userId: user.id, archived: false, nextDueAt: { gte: tomorrowStart, lte: tomorrowEnd } } }),
        db.jobApplication.count({ where: { userId: user.id, status: { in: ["APPLIED", "UNDER_REVIEW", "ASSESSMENT", "INTERVIEWING", "OFFERED"] } } }),
        db.jobApplication.count({ where: { userId: user.id, deadline: { gte: now, lte: subDays(now, -7) } } }),
        db.habit.count({ where: { userId: user.id, active: true } }),
        db.habitLog.count({ where: { habit: { userId: user.id }, logDate: { gte: dayStart, lte: dayEnd } } }),
        db.workout.count({ where: { userId: user.id, date: { gte: weekStart }, deletedAt: null } }),
        db.socialContact.count({ where: { userId: user.id, active: true } }),
        db.learningCourse.count({ where: { userId: user.id, status: "in_progress" } }),
        db.bodyMetric.findFirst({ where: { userId: user.id, metricType: "weight" }, orderBy: { measuredAt: "desc" } }),
        db.settings.findUnique({ where: { userId: user.id }, select: { unitSystem: true, sidebarConfig: true } }),
        db.sleepEntry.findFirst({ where: { userId: user.id }, orderBy: { date: "desc" } }),
        db.notification.count({ where: { userId: user.id, readAt: null } }),
        db.finTransaction.findMany({
            where: { userId: user.id, date: { gte: sevenDaysAgo, lte: dayEnd } },
            select: { date: true, amount: true },
        }),
        db.habitLog.findMany({
            where: { habit: { userId: user.id }, logDate: { gte: sevenDaysAgo, lte: dayEnd } },
            select: { logDate: true },
        }),
        db.todoItem.count({
            where: { userId: user.id, date: { gte: sevenDaysAgo, lte: dayEnd }, status: "DONE" },
        }),
        db.todoItem.count({
            where: { userId: user.id, date: { gte: sevenDaysAgo, lte: dayEnd } },
        }),
        db.sleepEntry.findMany({
            where: { userId: user.id, date: { gte: sevenDaysAgo, lte: dayEnd } },
            orderBy: { date: "asc" },
            select: { date: true, totalMinutes: true },
        }),
        db.bodyMetric.findMany({
            where: { userId: user.id, metricType: "weight" },
            orderBy: { measuredAt: "desc" },
            take: 14,
            select: { measuredAt: true, value: true },
        }),
        db.workout.findMany({
            where: { userId: user.id, deletedAt: null, date: { gte: sixWeeksAgo, lte: dayEnd } },
            select: { date: true },
        }),
    ]);

    const upcomingBills = await fetchUpcomingBills(user.id, now);
    const onboardingSteps = await getOnboardingSteps(user.id);
    const currentNetWorth = await getCurrentNetWorthTotals(user.id);
    const dailyNetWorthHistory = await buildDailyNetWorthHistory({ userId: user.id, current: currentNetWorth, days: 30 });

    // ── Peptide adherence: expand each peptide's cycle, keep today's occurrence,
    //    and mark it taken when a fulfilling log exists (same logic as the
    //    peptides overview's "today's dose"). ───────────────────────────────
    const peptideDoses: PeptideDoseItem[] = [];
    peptides.forEach((p, i) => {
        const todays = generateSchedule(p).filter((occ) => occ.date === iso);
        for (const occ of todays) {
            peptideDoses.push({ peptide: p, color: peptideColor(i), occ, taken: isOccurrenceTaken(p, occ) });
        }
    });
    const peptideTaken = peptideDoses.filter((d) => d.taken).length;

    const therapeuticDoses: TherapeuticDoseItem[] = therapeuticDoseRows.map((d) => ({
        id: d.id,
        name: d.schedule?.name ?? "Dose",
        kind: d.schedule?.kind ?? "OTHER",
        dosage: d.schedule?.dosage ?? null,
        scheduledAt: d.scheduledAt.toISOString(),
        status: d.loggedAt ? "logged" : d.skippedAt ? "skipped" : "pending",
    }));
    const therapeuticTaken = therapeuticDoses.filter((d) => d.status !== "pending").length;

    const totalDosesDue = peptideDoses.length + therapeuticDoses.length;
    const totalDosesDone = peptideTaken + therapeuticTaken;

    const todos: TodoRow[] = todoRows.map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt ? t.dueAt.toISOString() : null,
        // Map legacy DRIPPED → PLANNED for the UI.
        status: t.status === "DONE" ? "DONE" : t.status === "IN_PROGRESS" ? "IN_PROGRESS" : "PLANNED",
    }));

    const events: EventItem[] = eventRows.map((e) => ({
        id: e.id,
        title: e.title,
        allDay: e.allDay,
        startsAt: e.startsAt.toISOString(),
    }));

    const reminders: ReminderItem[] = reminderRows.map((r) => ({
        id: r.id,
        title: r.title,
        icon: r.icon,
        nextDueAt: r.nextDueAt.toISOString(),
        overdue: r.nextDueAt < dayStart,
    }));

    const tomorrowCount = tomorrowEventCount + tomorrowReminderCount;

    const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

    const last7Days = eachDayOfInterval({ start: sevenDaysAgo, end: dayStart });
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);

    const spendingTrend: TrendPoint[] = last7Days.map((d) => {
        const key = dayKey(d);
        const spent = weekTransactionRows
            .filter((t) => t.date.toISOString().slice(0, 10) === key && Number(t.amount) < 0)
            .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
        return { label: format(d, "EEE"), spent };
    });
    const weekSpending = spendingTrend.reduce((s, p) => s + Number(p.spent ?? 0), 0);

    const habitTrend: TrendPoint[] = last7Days.map((d) => {
        const key = dayKey(d);
        const habits = habitLogsWeek.filter((h) => h.logDate.toISOString().slice(0, 10) === key).length;
        return { label: format(d, "EEE"), habits };
    });

    const netWorthTrend: TrendPoint[] = dailyNetWorthHistory.map((point) => ({
        label: point.label,
        netWorth: point.netWorth,
    }));

    const billsDue: BillDue[] = upcomingBills.map((b) => ({
        id: b.id,
        label: b.label,
        dueAt: b.dueAt,
        minimumPayment: b.amount,
        overdue: b.overdue,
    }));

    const habitPct = habitsActive > 0 ? Math.round((habitsLoggedToday / habitsActive) * 100) : 0;
    const dosePct = totalDosesDue > 0 ? Math.round((totalDosesDone / totalDosesDue) * 100) : 100;

    const unit = unitSettings?.unitSystem ?? "IMPERIAL";

    // Sleep — hours per night over the last 7 days.
    const sleepTrend: TrendPoint[] = last7Days.map((d) => {
        const key = dayKey(d);
        const entry = sleepEntriesWeek.find((s) => s.date.toISOString().slice(0, 10) === key);
        const mins = entry?.totalMinutes ?? 0;
        return { label: format(d, "EEE"), hours: mins > 0 ? Math.round((mins / 60) * 10) / 10 : 0 };
    });
    const avgSleepHours = (() => {
        const nights = sleepEntriesWeek.filter((s) => (s.totalMinutes ?? 0) > 0);
        if (nights.length === 0) return null;
        return Math.round((nights.reduce((sum, s) => sum + (s.totalMinutes ?? 0), 0) / nights.length / 60) * 10) / 10;
    })();

    // Weight — most recent entries (oldest → newest), in the user's unit.
    const weightTrend: TrendPoint[] = [...weightRows]
        .reverse()
        .map((m) => ({ label: formatDateShort(m.measuredAt), weight: Math.round(weightToDisplay(Number(m.value), unit) * 10) / 10 }));

    // Workouts — count per week across the last six weeks.
    const workoutTrend: TrendPoint[] = Array.from({ length: 6 }, (_, i) => {
        const wkStart = startOfWeek(subDays(now, (5 - i) * 7), { weekStartsOn: 1 });
        const wkEndExclusive = subDays(wkStart, -7);
        const count = workoutRows.filter((w) => w.date >= wkStart && w.date < wkEndExclusive).length;
        return { label: format(wkStart, "MMM d"), workouts: count };
    });

    // Contextual hero CTA: surface the single most useful next action.
    const dosesRemaining = totalDosesDue - totalDosesDone;
    const habitsRemaining = habitsActive - habitsLoggedToday;
    let primaryCta: CtaDef;
    if (dosesRemaining > 0) {
        primaryCta = {
            title: `${dosesRemaining} dose${dosesRemaining === 1 ? "" : "s"} still due today`,
            description: "Stay on track with your protocol.",
            href: "/health/medications",
            ctaLabel: "Log doses",
            icon: Beaker02,
            tone: "warning",
        };
    } else if (todosOpenCount > 0) {
        primaryCta = {
            title: `${todosOpenCount} to-do${todosOpenCount === 1 ? "" : "s"} open today`,
            description: "Clear what's left on today's list.",
            href: "/todos",
            ctaLabel: "Review to-dos",
            icon: CheckDone01,
            tone: "brand",
        };
    } else if (habitsActive > 0 && habitsRemaining > 0) {
        primaryCta = {
            title: `${habitsRemaining} habit${habitsRemaining === 1 ? "" : "s"} left to log`,
            description: "Keep your streak alive — log today's habits.",
            href: "/health/habits",
            ctaLabel: "Log habits",
            icon: ActivityHeart,
            tone: "brand",
        };
    } else if (currentNetWorth.assets === 0 && currentNetWorth.liabilities === 0) {
        primaryCta = {
            title: "Set up your net worth",
            description: "Connect accounts and start tracking your finances.",
            href: "/financial",
            ctaLabel: "Open Financial",
            icon: BankNote03,
            tone: "brand",
        };
    } else {
        primaryCta = {
            title: "You're all caught up for today",
            description: "Nice work. Plan ahead or log something new below.",
            href: "/calendar",
            ctaLabel: "Plan ahead",
            icon: Calendar,
            tone: "success",
        };
    }

    const stats: DashboardStat[] = [
        {
            label: "Doses today",
            value: totalDosesDue > 0 ? `${totalDosesDone}/${totalDosesDue}` : "—",
            detail: totalDosesDue > 0 ? `${dosePct}% complete` : "Nothing due",
            href: "/health/medications",
            icon: Beaker02,
            tone: dosePct === 100 && totalDosesDue > 0 ? "success" : "default",
        },
        {
            label: "Todos open",
            value: String(todosOpenCount),
            detail: todosOpenCount === 0 ? "All clear" : "Due today",
            href: "/todos",
            icon: CheckDone01,
        },
        {
            label: "Today",
            value: String(events.length + reminders.length),
            detail: `${events.length} events · ${reminders.length} reminders`,
            href: "/calendar",
            icon: Calendar,
        },
        {
            label: "Habits",
            value: habitsActive > 0 ? `${habitPct}%` : "—",
            detail: `${habitsLoggedToday}/${habitsActive} logged today`,
            href: "/health",
            icon: ActivityHeart,
            tone: habitPct >= 80 ? "success" : habitPct < 50 && habitsActive > 0 ? "warning" : "default",
        },
        {
            label: "Spending",
            value: currency.format(weekSpending),
            detail: "Last 7 days",
            href: "/financial/transactions",
            icon: BankNote03,
        },
        {
            label: "Net worth",
            value: currency.format(currentNetWorth.netWorth),
            detail: "Live estimate today",
            href: "/financial",
            icon: BankNote03,
            tone: "brand",
        },
    ];

    const modules: ModuleCard[] = [
        {
            label: "Career",
            href: "/career",
            icon: Briefcase01,
            color: "blue",
            stat: `${activeApplications} active`,
            detail: upcomingDeadlines > 0 ? `${upcomingDeadlines} deadline${upcomingDeadlines === 1 ? "" : "s"} this week` : "No deadlines this week",
        },
        {
            label: "Health",
            href: "/health",
            icon: ActivityHeart,
            color: "green",
            stat: habitsActive > 0 ? `${habitsLoggedToday}/${habitsActive}` : "—",
            detail: latestWeight ? `Last weight ${formatWeight(latestWeight.value, unitSettings?.unitSystem ?? "IMPERIAL")}` : "Log your first metric",
        },
        {
            label: "Peptides",
            href: "/health/peptides",
            icon: Beaker02,
            color: "purple",
            stat: totalDosesDue > 0 ? `${totalDosesDone}/${totalDosesDue}` : `${peptides.length}`,
            detail: totalDosesDue > 0 ? (totalDosesDone === totalDosesDue ? "All doses done today" : "Doses due today") : "Nothing due today",
        },
        {
            label: "Workouts",
            href: "/workouts",
            icon: Activity,
            color: "orange",
            stat: `${workoutsThisWeek} this week`,
            detail: sleepLast?.totalMinutes ? `Last sleep ${Math.floor(sleepLast.totalMinutes / 60)}h ${sleepLast.totalMinutes % 60}m` : "Track your recovery",
        },
        {
            label: "Financial",
            href: "/financial",
            icon: BankNote03,
            color: "indigo",
            stat: currency.format(currentNetWorth.netWorth),
            detail: "Live net worth estimate",
        },
        {
            label: "Social",
            href: "/social",
            icon: Users01,
            color: "pink",
            stat: `${contactCount}`,
            detail: contactCount === 1 ? "1 contact" : `${contactCount} contacts & relationships`,
        },
        {
            label: "Learning",
            href: "/learning",
            icon: BookOpen01,
            color: "yellow",
            stat: `${coursesInProgress}`,
            detail: coursesInProgress > 0 ? `${coursesInProgress} course${coursesInProgress === 1 ? "" : "s"} in progress` : "Courses, notes & flashcards",
        },
        {
            label: "Todos",
            href: "/todos",
            icon: CheckDone01,
            color: "fuchsia",
            stat: `${todosOpenCount} open`,
            detail: unreadNotifications > 0 ? `${unreadNotifications} unread notification${unreadNotifications === 1 ? "" : "s"}` : "All caught up",
        },
    ];

    // Only surface areas the user is actively tracking (Settings → Tracking).
    const hiddenAreas = parseHiddenAreas(unitSettings?.sidebarConfig);
    const visibleModules = modules.filter((m) => isHrefEnabled(m.href, hiddenAreas));

    // Live "at a glance" ticker — only the items that are actually relevant today.
    const tickerItems: TickerItem[] = [
        todosOpenCount > 0 && { id: "todos", label: `${todosOpenCount} to-do${todosOpenCount === 1 ? "" : "s"} due today`, href: "/todos", icon: CheckDone01, tone: "warning" as const },
        dosesRemaining > 0 && { id: "doses", label: `${dosesRemaining} dose${dosesRemaining === 1 ? "" : "s"} still due`, href: "/health/medications", icon: Beaker02, tone: "warning" as const },
        (events.length > 0 || reminders.length > 0) && { id: "today", label: `${events.length} event${events.length === 1 ? "" : "s"} · ${reminders.length} reminder${reminders.length === 1 ? "" : "s"} today`, href: "/calendar", icon: Calendar, tone: "brand" as const },
        habitsActive > 0 && { id: "habits", label: `Habits ${habitPct}% logged`, href: "/health", icon: ActivityHeart, tone: habitPct >= 80 ? ("success" as const) : ("default" as const) },
        weekSpending > 0 && { id: "spend", label: `${currency.format(weekSpending)} spent this week`, href: "/financial/transactions", icon: BankNote03, tone: "default" as const },
        (currentNetWorth.assets > 0 || currentNetWorth.liabilities > 0) && { id: "networth", label: `Net worth ${currency.format(currentNetWorth.netWorth)}`, href: "/financial", icon: BankNote03, tone: "brand" as const },
        tomorrowCount > 0 && { id: "tomorrow", label: `${tomorrowCount} on your plate tomorrow`, href: "/calendar", icon: Calendar, tone: "default" as const },
    ].filter(Boolean) as TickerItem[];

    return (
        <div className="page-shell">
            <LiveRefresh intervalMs={300000} />
            <div className="flex flex-col gap-0.5 sm:gap-1">
                <h1 className="module-title">Welcome back, {firstName}</h1>
                <p className="text-sm text-tertiary sm:text-md">{format(now, "EEEE, MMMM d")} — here's what's happening across your life.</p>
            </div>

            {tickerItems.length > 0 && <MarqueeTicker label="Today" items={tickerItems} className="mt-4 sm:mt-5" />}

            <Reveal className="mt-5 sm:mt-6">
                <DashboardStats stats={stats} />
            </Reveal>

            <div className="mt-5 sm:mt-6">
                <DashboardCta {...primaryCta} />
            </div>

            <div className="mt-5 sm:mt-6">
                <OnboardingChecklist steps={onboardingSteps} />
            </div>

            <div className="mt-5 sm:mt-6">
                <QuickActions hiddenAreas={hiddenAreas} />
            </div>

            <div className="mt-6 sm:mt-8">
                <DashboardPromos hiddenAreas={hiddenAreas} />
            </div>

            <Reveal className="mt-6 sm:mt-8">
                <DashboardCharts
                    netWorthTrend={netWorthTrend}
                    spendingTrend={spendingTrend}
                    habitTrend={habitTrend}
                    sleepTrend={sleepTrend}
                    weightTrend={weightTrend}
                    workoutTrend={workoutTrend}
                    weekSpending={weekSpending}
                    avgSleepHours={avgSleepHours}
                    weightUnitLabel={weightUnit(unit)}
                    todosDoneWeek={todosDoneWeek}
                    todosTotalWeek={todosTotalWeek}
                    billsDue={billsDue}
                />
            </Reveal>

            <div className="mt-6 grid grid-cols-1 gap-5 lg:mt-8 lg:grid-cols-3">
                <DosesCard peptideDoses={peptideDoses} therapeuticDoses={therapeuticDoses} />
                <TodosCard todos={todos} openCount={todosOpenCount} />
                <TodayCard events={events} reminders={reminders} tomorrowCount={tomorrowCount} />
            </div>

            {visibleModules.length > 0 && (
                <div className="mt-8 flex flex-col gap-3">
                    <h2 className="text-xs font-semibold tracking-wide text-tertiary uppercase">Jump to</h2>
                    <DashboardModules modules={visibleModules} />
                </div>
            )}
        </div>
    );
}
