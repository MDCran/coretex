import {
    Activity,
    BookOpen01,
    CheckDone01,
    Droplets01,
    Heart,
    Moon01,
    Scales01,
    Target04,
} from "@untitledui/icons";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/base/buttons/button";
import { ModuleHero } from "@/components/app-shell/module-hero";
import { AiSuggestionCard } from "@/components/app-shell/ai-suggestion-card";
import { ProgressBar, Card } from "./_components/health-ui";
import { OverviewCharts } from "./overview-client";
import { OverviewActionCard } from "./_components/overview-action-card";
import { StatWithUnit } from "./_components/stat-with-unit";
import type { TrendPoint } from "./_components/trend-chart";
import { volumeToDisplay, volumeUnit, weightToDisplay, weightUnit } from "@/lib/units";
import { formatDate, formatDateShort } from "@/lib/dates";

function fmtHours(mins: number | null | undefined) {
    if (mins == null) return "—";
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const QUICK_LINKS = [
    { label: "Log metric", href: "/health/metrics", icon: Scales01 },
    { label: "Log vital", href: "/health/vitals", icon: Activity },
    { label: "Nutrition", href: "/nutrition", icon: Target04 },
    { label: "Log sleep", href: "/health/sleep", icon: Moon01 },
    { label: "Habits", href: "/health/habits", icon: CheckDone01 },
    { label: "Journal", href: "/health/journal", icon: BookOpen01 },
] as const;

export default async function HealthOverviewPage() {
    const user = await requireUser();
    const today = new Date();
    const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    const [latestWeight, weightHistory, lastSleep, sleepHistory, water, profile, goal, todayDay, habits, sobrietyCounters, settings] = await Promise.all([
        db.bodyMetric.findFirst({ where: { userId: user.id, metricType: "weight" }, orderBy: { measuredAt: "desc" } }),
        db.bodyMetric.findMany({ where: { userId: user.id, metricType: "weight" }, orderBy: { measuredAt: "asc" }, take: 60 }),
        db.sleepEntry.findFirst({ where: { userId: user.id }, orderBy: { date: "desc" } }),
        db.sleepEntry.findMany({ where: { userId: user.id }, orderBy: { date: "asc" }, take: 30 }),
        db.waterLog.findUnique({ where: { userId_date: { userId: user.id, date: todayDate } } }),
        db.userProfile.findUnique({ where: { userId: user.id } }),
        db.nutritionGoal.findUnique({ where: { userId: user.id } }),
        db.nutritionDay.findUnique({ where: { userId_date: { userId: user.id, date: todayDate } }, include: { meals: { include: { entries: true } } } }),
        db.habit.findMany({ where: { userId: user.id, active: true }, include: { logs: { where: { logDate: todayDate } } } }),
        db.sobrietyCounter.findMany({ where: { userId: user.id, archived: false }, orderBy: { startedAt: "asc" } }),
        db.settings.findUnique({ where: { userId: user.id } }),
    ]);

    const unitSystem = settings?.unitSystem ?? "IMPERIAL";
    const wUnit = weightUnit(unitSystem);
    const waterGoal = profile?.waterGoalMl ?? 2500;
    const waterMl = water?.amountMl ?? 0;
    const caloriesToday = (todayDay?.meals ?? []).flatMap((m) => m.entries).reduce((acc, e) => acc + (e.calories ?? 0), 0);
    const habitsDone = habits.filter((h) => h.logs.length > 0).length;

    const longestSoberDays = sobrietyCounters.reduce((max, c) => {
        const days = Math.floor((Date.now() - new Date(c.startedAt).getTime()) / 86_400_000);
        return Math.max(max, days);
    }, 0);
    const longestSoberCounter = sobrietyCounters.length
        ? sobrietyCounters.reduce((best, c) => (new Date(c.startedAt).getTime() < new Date(best.startedAt).getTime() ? c : best))
        : null;

    const weightData: TrendPoint[] = weightHistory.map((m) => ({ label: formatDateShort(m.measuredAt), value: weightToDisplay(m.value, unitSystem) }));
    const sleepData: TrendPoint[] = sleepHistory.map((s) => ({ label: formatDateShort(s.date), hours: s.totalMinutes != null ? Math.round((s.totalMinutes / 60) * 10) / 10 : null }));

    return (
        <div className="flex flex-col gap-6">
            <ModuleHero
                theme="emerald"
                icon={Heart}
                eyebrow="How are you feeling?"
                title="Stay on top of your health"
                description="Log your metrics, vitals, sleep and habits — then watch the trends move in the right direction."
                actions={[
                    { label: "Log a metric", href: "/health/metrics", icon: Scales01 },
                    { label: "Track nutrition", href: "/nutrition", icon: Target04, color: "secondary" },
                ]}
            />

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatWithUnit
                    label="Latest weight"
                    value={latestWeight ? `${weightToDisplay(latestWeight.value, unitSystem)} ${wUnit}` : "—"}
                    sub={latestWeight ? formatDate(latestWeight.measuredAt) : "Log your first"}
                    unitHint={wUnit}
                />
                <StatWithUnit label="Last sleep" value={fmtHours(lastSleep?.totalMinutes)} sub={lastSleep ? formatDate(lastSleep.date) : "Log your first"} />
                <StatWithUnit label="Calories today" value={String(Math.round(caloriesToday))} sub={goal?.calories ? `of ${Math.round(goal.calories)} kcal` : "No goal set"} unitHint="kcal" />
                <StatWithUnit label="Habits done" value={`${habitsDone}/${habits.length}`} sub="today" />
            </div>

            {habits.length > 0 && habitsDone < habits.length && (
                <AiSuggestionCard
                    tone="brand"
                    iconName="check"
                    confidence="medium"
                    title={`${habits.length - habitsDone} habit${habits.length - habitsDone === 1 ? "" : "s"} still open today`}
                    body={`You've checked off ${habitsDone} of ${habits.length} active habits. Knock out the rest before the day ends to keep your streaks alive.`}
                    href="/health/habits"
                    ctaLabel="Open habits"
                />
            )}

            <div className="grid gap-6 lg:grid-cols-3">
                <OverviewActionCard icon={Droplets01} title="Water today" actionLabel="Log water" actionHref="/nutrition" actionIcon={Droplets01}>
                    <p className="mb-3 text-sm text-tertiary">
                        {volumeToDisplay(waterMl, unitSystem)} / {volumeToDisplay(waterGoal, unitSystem)} {volumeUnit(unitSystem)}
                    </p>
                    <ProgressBar value={waterMl} max={waterGoal} />
                </OverviewActionCard>

                <OverviewActionCard icon={Heart} title="Longest sober streak" actionLabel="Open sobriety" actionHref="/health/sobriety" actionIcon={Heart}>
                    {longestSoberCounter ? (
                        <>
                            <p className="text-display-xs font-semibold text-primary">
                                {longestSoberDays} <span className="text-sm font-medium text-tertiary">day{longestSoberDays === 1 ? "" : "s"}</span>
                            </p>
                            <p className="mt-1 text-sm text-tertiary">{longestSoberCounter.name}</p>
                        </>
                    ) : (
                        <p className="text-sm text-tertiary">Start a counter and watch the days add up.</p>
                    )}
                </OverviewActionCard>

                <OverviewActionCard icon={CheckDone01} title="Habits due today" actionLabel="Open habits" actionHref="/health/habits" actionIcon={CheckDone01}>
                    {habits.length === 0 ? (
                        <p className="text-sm text-tertiary">Build a daily habit and check it off here.</p>
                    ) : (
                        <ul className="flex flex-col gap-1.5">
                            {habits.slice(0, 5).map((h) => (
                                <li key={h.id} className="flex items-center gap-2 text-sm">
                                    <span className={h.logs.length > 0 ? "text-success-primary" : "text-tertiary"}>{h.logs.length > 0 ? "✓" : "○"}</span>
                                    <span className={h.logs.length > 0 ? "text-tertiary line-through" : "text-secondary"}>{h.name}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </OverviewActionCard>
            </div>

            <OverviewCharts weight={weightData} sleep={sleepData} />

            <Card>
                <h3 className="mb-3 text-md font-semibold text-primary">Quick log</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    {QUICK_LINKS.map((q) => {
                        const Icon = q.icon;
                        return (
                            <Button
                                key={q.href}
                                href={q.href}
                                size="sm"
                                color="secondary"
                                iconLeading={<Icon data-icon className="size-4" />}
                                className="justify-start"
                            >
                                {q.label}
                            </Button>
                        );
                    })}
                </div>
            </Card>
        </div>
    );
}
