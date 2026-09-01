import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_WEIGHTS, runningGrade, cumulativeGpa, type GradeWeight, type GradeItem } from "@/lib/learning/grades";
import { AcademicClient, type ClassCard, type HomeworkRow } from "./academic-client";

function normalizeWeights(raw: unknown): GradeWeight[] {
    if (!Array.isArray(raw)) return DEFAULT_WEIGHTS;
    const out: GradeWeight[] = [];
    for (const w of raw) {
        if (w && typeof w === "object" && typeof (w as any).name === "string" && typeof (w as any).weight === "number") {
            out.push({ name: (w as any).name, weight: (w as any).weight });
        }
    }
    return out.length ? out : DEFAULT_WEIGHTS;
}

export default async function AcademicPage() {
    const user = await requireUser();
    const classes = await db.learningClass.findMany({
        where: { userId: user.id },
        include: {
            assignments: true,
            tests: true,
            absences: true,
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });

    const now = Date.now();

    const cards: ClassCard[] = classes.map((c) => {
        const weights = normalizeWeights(c.gradeWeights);
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
        const grade = runningGrade(weights, items);

        // Next future exam.
        const futureTests = c.tests
            .filter((t) => t.date && t.date.getTime() >= now)
            .sort((a, b) => a.date!.getTime() - b.date!.getTime());
        const nextExam = futureTests[0];
        const daysToExam = nextExam ? Math.ceil((nextExam.date!.getTime() - now) / 86_400_000) : null;

        return {
            id: c.id,
            name: c.name,
            term: c.term,
            status: c.status,
            creditHours: c.creditHours,
            color: c.color,
            percent: c.status === "COMPLETED" ? (c.finalGrade ?? grade.percent) : grade.percent,
            letter: grade.letter,
            finalGrade: c.finalGrade,
            absenceCount: c.absences.length,
            absenceLimit: c.absenceLimit,
            nextExamTitle: nextExam?.title ?? null,
            nextExamDays: daysToExam,
        };
    });

    const gpa = cumulativeGpa(
        classes.map((c) => {
            const weights = normalizeWeights(c.gradeWeights);
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
            return { creditHours: c.creditHours, finalGrade: c.finalGrade, runningPercent: runningGrade(weights, items).percent };
        }),
    );

    const totalCredits = classes
        .filter((c) => c.status !== "DROPPED")
        .reduce((s, c) => s + (c.creditHours ?? 0), 0);

    // Homework urgency queue: non-graded assignments across ACTIVE classes.
    const activeIds = new Set(classes.filter((c) => c.status === "ACTIVE").map((c) => c.id));
    const homework: HomeworkRow[] = classes
        .flatMap((c) =>
            c.assignments
                .filter((a) => activeIds.has(c.id) && a.status !== "GRADED")
                .map((a) => ({
                    id: a.id,
                    classId: c.id,
                    className: c.name,
                    classColor: c.color,
                    title: a.title,
                    status: a.status,
                    dueDate: a.dueDate ? a.dueDate.toISOString() : null,
                })),
        )
        .sort((a, b) => {
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return a.dueDate.localeCompare(b.dueDate);
        });

    return (
        <AcademicClient
            classes={cards}
            homework={homework}
            gpa={gpa}
            totalCredits={totalCredits}
            classCount={classes.filter((c) => c.status !== "DROPPED").length}
        />
    );
}
