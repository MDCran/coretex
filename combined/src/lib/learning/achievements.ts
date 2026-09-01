import "server-only";

import { db } from "@/lib/db";
import { cumulativeGpa, runningGrade, type GradeItem, type GradeWeight } from "./grades";

/**
 * Achievement engine. Evaluates streak, GPA, and completion milestones and
 * awards any that are newly earned (idempotent per `achievementType`).
 * Cheap enough to call on dashboard load and after relevant mutations.
 */

export interface AwardDef {
    type: string;
    title: string;
}

const STREAK_TIERS = [
    { days: 7, type: "streak-7", title: "🔥 7-day study streak" },
    { days: 30, type: "streak-30", title: "🔥 30-day study streak" },
    { days: 100, type: "streak-100", title: "🔥 100-day study streak" },
];
const GPA_TIERS = [
    { min: 3.5, type: "gpa-3.5", title: "🎓 3.5 GPA" },
    { min: 3.8, type: "gpa-3.8", title: "🎓 3.8 GPA" },
    { min: 4.0, type: "gpa-4.0", title: "🏆 4.0 GPA" },
];
const COURSE_TIERS = [
    { n: 1, type: "courses-1", title: "✅ First course completed" },
    { n: 5, type: "courses-5", title: "✅ 5 courses completed" },
    { n: 10, type: "courses-10", title: "🌟 10 courses completed" },
];

/** Current consecutive-day study streak from a set of YYYY-MM-DD study dates. */
export function currentStreak(dateKeys: Set<string>, today: Date = new Date()): number {
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const cursor = new Date(today);
    cursor.setHours(0, 0, 0, 0);
    // Allow the streak to count if studied today OR yesterday (today still open).
    if (!dateKeys.has(ymd(cursor))) {
        cursor.setDate(cursor.getDate() - 1);
        if (!dateKeys.has(ymd(cursor))) return 0;
    }
    let streak = 0;
    while (dateKeys.has(ymd(cursor))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

/** Compute the user's cumulative GPA from their classes. */
export async function computeCumulativeGpa(userId: string): Promise<number | null> {
    const classes = await db.learningClass.findMany({
        where: { userId },
        include: { assignments: true, tests: true },
    });
    const rows = classes.map((c) => {
        const weights = (Array.isArray(c.gradeWeights) ? c.gradeWeights : []) as unknown as GradeWeight[];
        const items: GradeItem[] = [
            ...c.assignments
                .filter((a) => a.status === "GRADED" && a.pointsPossible != null)
                .map((a) => ({ category: a.category, earned: a.pointsEarned, possible: a.pointsPossible, extraCredit: a.extraCredit })),
            ...c.tests.map((t) => ({
                category: t.category,
                earned: t.score == null ? null : t.score + (t.curveAdjustment ?? 0),
                possible: t.maxScore,
            })),
        ];
        const result = runningGrade(weights, items);
        return { creditHours: c.creditHours, finalGrade: c.finalGrade, runningPercent: result.percent };
    });
    return cumulativeGpa(rows);
}

/**
 * Evaluate and persist any newly earned achievements. Returns the list of
 * achievements awarded on this call (empty when nothing new).
 */
export async function evaluateAchievements(userId: string): Promise<AwardDef[]> {
    const [sessions, existing, completedCourses, gpa] = await Promise.all([
        db.learningSession.findMany({ where: { userId }, select: { sessionDate: true } }),
        db.learningAchievement.findMany({ where: { userId }, select: { achievementType: true } }),
        db.learningCourse.count({ where: { userId, status: "completed" } }),
        computeCumulativeGpa(userId),
    ]);

    const have = new Set(existing.map((a) => a.achievementType));
    const dateKeys = new Set(sessions.map((s) => s.sessionDate.toISOString().slice(0, 10)));
    const streak = currentStreak(dateKeys);

    const toAward: AwardDef[] = [];
    for (const t of STREAK_TIERS) if (streak >= t.days && !have.has(t.type)) toAward.push({ type: t.type, title: t.title });
    for (const t of COURSE_TIERS) if (completedCourses >= t.n && !have.has(t.type)) toAward.push({ type: t.type, title: t.title });
    if (gpa != null) for (const t of GPA_TIERS) if (gpa >= t.min && !have.has(t.type)) toAward.push({ type: t.type, title: t.title });

    if (toAward.length) {
        const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
        await db.learningAchievement.createMany({
            data: toAward.map((a) => ({ userId, achievementType: a.type, title: a.title, earnedOn: today })),
            skipDuplicates: true,
        });
    }
    return toAward;
}
