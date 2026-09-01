import Link from "next/link";
import { Award01, BookOpen01, Clock, GraduationHat01, LayersThree01, Target04 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { cumulativeGpa, runningGrade, DEFAULT_WEIGHTS, type GradeItem, type GradeWeight } from "@/lib/learning/grades";
import { evaluateAchievements } from "@/lib/learning/achievements";
import { Card, ProgressBar, SectionHeader, Stat } from "./_components/learning-ui";
import { TrendChart, type TrendPoint } from "./_components/trend-chart";
import { ReportCardButton, type ReportCardData } from "./_components/report-card-button";
import { GradientCtaBanner } from "@/components/app-shell/gradient-cta-banner";
import { AiSuggestionCard } from "@/components/app-shell/ai-suggestion-card";

function startOfWeek(d: Date) {
    const r = new Date(d);
    const day = (r.getDay() + 6) % 7; // Monday = 0
    r.setDate(r.getDate() - day);
    r.setHours(0, 0, 0, 0);
    return r;
}
function startOfDay(d: Date) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
}
function ymd(d: Date) {
    return d.toISOString().slice(0, 10);
}
function gradeTone(percent: number | null): "success" | "warning" | "error" | "gray" {
    if (percent == null) return "gray";
    if (percent >= 87) return "success";
    if (percent >= 70) return "warning";
    return "error";
}

export default async function LearningDashboardPage() {
    const user = await requireUser();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekStart = startOfWeek(now);
    const trendStart = new Date(now);
    trendStart.setDate(now.getDate() - 27);
    trendStart.setHours(0, 0, 0, 0);
    const earliest = trendStart < monthStart ? trendStart : monthStart;

    // Award any newly-earned achievements before we read them back.
    await evaluateAchievements(user.id).catch(() => []);

    const [allClasses, activeCourses, completedCourses, recentSessions, allSessionsAgg, dueFlash, openGoals, achievedGoals, achievements] =
        await Promise.all([
            db.learningClass.findMany({ where: { userId: user.id }, include: { assignments: true, tests: true } }),
            db.learningCourse.findMany({
                where: { userId: user.id, status: "in_progress" },
                include: { lessons: { select: { completed: true } } },
                orderBy: { updatedAt: "desc" },
                take: 6,
            }),
            db.learningCourse.count({ where: { userId: user.id, status: "completed" } }),
            db.learningSession.findMany({ where: { userId: user.id, sessionDate: { gte: earliest } }, select: { sessionDate: true, durationMinutes: true } }),
            db.learningSession.aggregate({ where: { userId: user.id }, _sum: { durationMinutes: true } }),
            db.flashcard.count({ where: { userId: user.id, OR: [{ dueDate: null }, { dueDate: { lte: now } }] } }),
            db.learningGoal.findMany({ where: { userId: user.id, completed: false }, include: { milestones: { select: { status: true } } }, orderBy: { createdAt: "asc" }, take: 6 }),
            db.learningGoal.count({ where: { userId: user.id, completed: true } }),
            db.learningAchievement.findMany({ where: { userId: user.id }, orderBy: { earnedOn: "desc" }, take: 12 }),
        ]);

    // ── Grades / GPA ────────────────────────────────────────────
    const classGrades = allClasses.map((c) => {
        const weights = (Array.isArray(c.gradeWeights) && c.gradeWeights.length ? c.gradeWeights : DEFAULT_WEIGHTS) as unknown as GradeWeight[];
        const items: GradeItem[] = [
            ...c.assignments
                .filter((a) => a.status === "GRADED" && a.pointsPossible != null)
                .map((a) => ({ category: a.category, earned: a.pointsEarned, possible: a.pointsPossible, extraCredit: a.extraCredit })),
            ...c.tests.map((t) => ({ category: t.category, earned: t.score == null ? null : t.score + (t.curveAdjustment ?? 0), possible: t.maxScore })),
        ];
        return { cls: c, result: runningGrade(weights, items) };
    });
    const activeClassGrades = classGrades.filter((g) => g.cls.status === "ACTIVE");
    const gpa = cumulativeGpa(classGrades.map((g) => ({ creditHours: g.cls.creditHours, finalGrade: g.cls.finalGrade, runningPercent: g.result.percent })));
    const totalCredits = classGrades.reduce((s, g) => s + (g.cls.creditHours ?? 0), 0);

    // ── Homework due today / overdue / upcoming ─────────────────
    const todayKey = ymd(now);
    const pendingHw = activeClassGrades.flatMap((g) =>
        g.cls.assignments
            .filter((a) => a.status !== "GRADED" && a.dueDate)
            .map((a) => ({ id: a.id, title: a.title, due: a.dueDate as Date })),
    );
    const dueToday = pendingHw.filter((a) => ymd(a.due) === todayKey);
    const overdue = pendingHw.filter((a) => a.due < startOfDay(now));
    const upcoming = pendingHw.filter((a) => a.due >= startOfDay(now)).sort((x, y) => x.due.getTime() - y.due.getTime()).slice(0, 6);

    // ── Study time ──────────────────────────────────────────────
    const monthMinutes = recentSessions.filter((s) => s.sessionDate >= monthStart).reduce((s, r) => s + (r.durationMinutes ?? 0), 0);
    const weekMinutes = recentSessions.filter((s) => s.sessionDate >= weekStart).reduce((s, r) => s + (r.durationMinutes ?? 0), 0);
    const allTimeMinutes = allSessionsAgg._sum.durationMinutes ?? 0;

    const weeklyTrend: TrendPoint[] = [];
    for (let w = 3; w >= 0; w--) {
        const wEnd = new Date(now);
        wEnd.setDate(now.getDate() - w * 7);
        const wStart = new Date(wEnd);
        wStart.setDate(wEnd.getDate() - 6);
        wStart.setHours(0, 0, 0, 0);
        const minutes = recentSessions.filter((s) => s.sessionDate >= wStart && s.sessionDate <= wEnd).reduce((s, r) => s + (r.durationMinutes ?? 0), 0);
        weeklyTrend.push({ label: w === 0 ? "This wk" : `${w}w ago`, hours: Math.round((minutes / 60) * 10) / 10 });
    }

    // ── Test-score trend (academic performance over time) ───────
    const allTests = allClasses
        .flatMap((c) => c.tests)
        .filter((t) => t.date && t.score != null && t.maxScore)
        .sort((a, b) => (a.date as Date).getTime() - (b.date as Date).getTime())
        .slice(-12);
    const testTrend: TrendPoint[] = allTests.map((t) => ({
        label: (t.date as Date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        score: Math.round((((t.score as number) + (t.curveAdjustment ?? 0)) / (t.maxScore as number)) * 100),
    }));

    const fmtHm = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;

    const reportData: ReportCardData = {
        generatedOn: todayKey,
        cumulativeGpa: gpa,
        totalCredits,
        classes: classGrades.map((g) => ({ name: g.cls.name, term: g.cls.term, credits: g.cls.creditHours, percent: g.result.percent, letter: g.result.letter })),
        studyHoursMonth: Math.round(monthMinutes / 60),
        studyHoursAllTime: Math.round(allTimeMinutes / 60),
        coursesCompleted: completedCourses,
        goalsAchieved: achievedGoals,
        achievements: achievements.map((a) => a.title ?? a.achievementType),
    };

    return (
        <div className="flex flex-col gap-6">
            <GradientCtaBanner
                tone="amber"
                icon={BookOpen01}
                eyebrow="Keep the streak going"
                title="Master something new today"
                description={
                    dueFlash > 0
                        ? `${dueFlash} flashcard${dueFlash === 1 ? "" : "s"} due and ${dueToday.length} assignment${dueToday.length === 1 ? "" : "s"} due today.`
                        : "Pick up a class, course, or goal — or drill your flashcards."
                }
                primary={dueFlash > 0 ? { label: "Review flashcards", href: "/learning/flashcards" } : { label: "Browse courses", href: "/learning/courses" }}
                secondary={{ label: "Academic", href: "/learning/academic" }}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-tertiary">Your unified snapshot across classes, courses, goals and study tools.</p>
                <ReportCardButton data={reportData} />
            </div>

            {/* Headline stats */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Cumulative GPA" value={gpa != null ? gpa.toFixed(2) : "—"} sub={`${totalCredits || 0} credits`} />
                <Stat label="Study this week" value={fmtHm(weekMinutes)} sub={`${fmtHm(monthMinutes)} this month`} />
                <Stat label="Flashcards due" value={dueFlash} />
                <Stat label="Homework due today" value={dueToday.length} sub={overdue.length ? `${overdue.length} overdue` : "On track"} />
            </div>

            {/* Rule-based study nudge: due flashcards first, then overdue homework. */}
            {dueFlash > 0 ? (
                <AiSuggestionCard
                    tone="amber"
                    iconName="layers"
                    confidence="high"
                    title={`${dueFlash} flashcard${dueFlash === 1 ? "" : "s"} ready for review`}
                    body="Spaced repetition works best when you stay on schedule. A short review session now locks in what you've learned before it fades."
                    href="/learning/flashcards"
                    ctaLabel="Review flashcards"
                />
            ) : overdue.length > 0 ? (
                <AiSuggestionCard
                    tone="amber"
                    iconName="clock"
                    confidence="high"
                    title={`${overdue.length} assignment${overdue.length === 1 ? "" : "s"} overdue`}
                    body="Some homework has slipped past its due date. Tackle the oldest first to protect your grades and clear the backlog."
                    href="/learning/academic"
                    ctaLabel="View homework"
                />
            ) : null}

            {/* Trends */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card>
                    <h2 className="mb-4 text-md font-semibold text-primary">Study hours (last 4 weeks)</h2>
                    <TrendChart data={weeklyTrend} series={[{ key: "hours", name: "Hours" }]} type="bar" height={200} emptyLabel="No study sessions yet" />
                </Card>
                <Card>
                    <h2 className="mb-4 text-md font-semibold text-primary">Test scores over time</h2>
                    <TrendChart data={testTrend} series={[{ key: "score", name: "Score %" }]} type="line" height={200} fitDomain emptyLabel="No graded tests yet" />
                </Card>
            </div>

            {/* Classes + homework */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <SectionHeader
                        title="Active classes"
                        description="Live grades from your weighted trackers."
                        action={<Button size="sm" color="secondary" iconLeading={<GraduationHat01 className="size-4" data-icon />} href="/learning/academic">Academic</Button>}
                    />
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {activeClassGrades.length === 0 && <p className="text-sm text-tertiary sm:col-span-2">No active classes. Add one in the Academic tab.</p>}
                        {activeClassGrades.map(({ cls, result }) => (
                            <Link key={cls.id} href={`/learning/academic/${cls.id}`} className="flex items-center justify-between gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:-translate-y-0.5 hover:bg-secondary_hover hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none">
                                <span className="min-w-0 truncate text-sm font-medium text-primary">{cls.name}</span>
                                <span className="flex shrink-0 items-center gap-2">
                                    <span className="text-xs text-tertiary tabular-nums">{result.percent != null ? `${result.percent.toFixed(1)}%` : "No grades"}</span>
                                    <Badge color={gradeTone(result.percent)} size="sm">{result.letter ?? "—"}</Badge>
                                </span>
                            </Link>
                        ))}
                    </div>
                </Card>

                <Card>
                    <SectionHeader title="Homework" action={<Button size="sm" color="link-color" href="/learning/academic">View all</Button>} />
                    <div className="mt-4 flex flex-col gap-2">
                        {overdue.slice(0, 3).map((a) => (
                            <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-error-secondary p-2.5">
                                <span className="min-w-0 truncate text-sm text-primary">{a.title}</span>
                                <Badge color="error" size="sm">Overdue</Badge>
                            </div>
                        ))}
                        {upcoming.map((a) => (
                            <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg p-2.5 ring-1 ring-secondary ring-inset">
                                <span className="min-w-0 truncate text-sm text-secondary">{a.title}</span>
                                <span className="shrink-0 text-xs text-tertiary">{ymd(a.due) === todayKey ? "Today" : formatDate(a.due.toISOString())}</span>
                            </div>
                        ))}
                        {overdue.length === 0 && upcoming.length === 0 && <p className="text-sm text-tertiary">Nothing due. Nice.</p>}
                    </div>
                </Card>
            </div>

            {/* Courses + goals */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card>
                    <SectionHeader title="Courses in progress" action={<Button size="sm" color="secondary" iconLeading={<BookOpen01 className="size-4" data-icon />} href="/learning/courses">All courses</Button>} />
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {activeCourses.length === 0 && <p className="text-sm text-tertiary sm:col-span-2">No courses in progress.</p>}
                        {activeCourses.map((c) => {
                            const total = c.lessons.length;
                            const done = c.lessons.filter((l) => l.completed).length;
                            return (
                                <Link key={c.id} href={`/learning/courses/${c.id}`} className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:-translate-y-0.5 hover:bg-secondary_hover hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="truncate text-sm font-medium text-primary">{c.title}</span>
                                        <span className="shrink-0 text-xs text-tertiary">{total ? `${done}/${total}` : "No sections"}</span>
                                    </div>
                                    <ProgressBar value={done} max={total} color={total && done === total ? "success" : "brand"} />
                                </Link>
                            );
                        })}
                    </div>
                </Card>

                <Card>
                    <SectionHeader title="Active goals" action={<Button size="sm" color="secondary" iconLeading={<Target04 className="size-4" data-icon />} href="/learning/goals">All goals</Button>} />
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {openGoals.length === 0 && <p className="text-sm text-tertiary sm:col-span-2">No open goals.</p>}
                        {openGoals.map((g) => {
                            const total = g.milestones.length;
                            const done = g.milestones.filter((m) => m.status === "DONE").length;
                            return (
                                <Link key={g.id} href={`/learning/goals/${g.id}`} className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:-translate-y-0.5 hover:bg-secondary_hover hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="truncate text-sm font-medium text-primary">{g.title ?? g.description}</span>
                                        <span className="shrink-0 text-xs text-tertiary">{total ? `${done}/${total}` : "No milestones"}</span>
                                    </div>
                                    {total > 0 && <ProgressBar value={done} max={total} color={done === total ? "success" : "brand"} />}
                                </Link>
                            );
                        })}
                    </div>
                </Card>
            </div>

            {/* Achievements */}
            <Card>
                <div className="mb-4 flex items-center gap-2">
                    <Award01 className="size-5 text-fg-brand-primary" aria-hidden="true" />
                    <h2 className="text-lg font-semibold text-primary">Achievements</h2>
                </div>
                {achievements.length === 0 ? (
                    <p className="text-sm text-tertiary">No badges yet — build a study streak, complete a course, or hit a GPA milestone to earn one.</p>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {achievements.map((a) => (
                            <Badge key={a.id} color="brand" size="lg" type="pill-color">
                                {a.title ?? a.achievementType} · {formatDate(a.earnedOn)}
                            </Badge>
                        ))}
                    </div>
                )}
            </Card>

            {/* Quick actions */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Button color="secondary" iconLeading={<LayersThree01 className="size-4" data-icon />} href="/learning/flashcards">Review flashcards</Button>
                <Button color="secondary" iconLeading={<Clock className="size-4" data-icon />} href="/learning/sessions">Log a session</Button>
                <Button color="secondary" iconLeading={<BookOpen01 className="size-4" data-icon />} href="/learning/archive">Video archive</Button>
                <Button color="secondary" iconLeading={<BookOpen01 className="size-4" data-icon />} href="/learning/notes">Open notes</Button>
            </div>
        </div>
    );
}
