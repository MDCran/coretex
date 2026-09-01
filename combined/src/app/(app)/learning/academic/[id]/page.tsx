import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_WEIGHTS, type GradeWeight } from "@/lib/learning/grades";
import { ClassDetailClient, type AbsenceRow, type AssignmentRow, type ClassInfo, type TestRow } from "./class-detail-client";

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

export default async function ClassDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const user = await requireUser();
    const cls = await db.learningClass.findFirst({
        where: { id, userId: user.id },
        include: {
            assignments: { orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }] },
            tests: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
            absences: { orderBy: { date: "desc" } },
        },
    });
    if (!cls) notFound();

    const info: ClassInfo = {
        id: cls.id,
        name: cls.name,
        gradeLevel: cls.gradeLevel,
        creditHours: cls.creditHours,
        term: cls.term,
        instructor: cls.instructor,
        color: cls.color,
        status: cls.status,
        finalGrade: cls.finalGrade,
        absenceLimit: cls.absenceLimit,
        weights: normalizeWeights(cls.gradeWeights),
    };

    const assignments: AssignmentRow[] = cls.assignments.map((a) => ({
        id: a.id,
        title: a.title,
        category: a.category,
        dueDate: a.dueDate ? a.dueDate.toISOString() : null,
        status: a.status,
        pointsEarned: a.pointsEarned,
        pointsPossible: a.pointsPossible,
        extraCredit: a.extraCredit,
        notes: a.notes,
    }));

    const tests: TestRow[] = cls.tests.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        date: t.date ? t.date.toISOString() : null,
        score: t.score,
        maxScore: t.maxScore,
        curveAdjustment: t.curveAdjustment,
    }));

    const absences: AbsenceRow[] = cls.absences.map((ab) => ({
        id: ab.id,
        date: ab.date.toISOString(),
        reason: ab.reason,
        excused: ab.excused,
    }));

    return <ClassDetailClient cls={info} assignments={assignments} tests={tests} absences={absences} />;
}
