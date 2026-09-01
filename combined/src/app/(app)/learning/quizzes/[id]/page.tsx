import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConfigured } from "@/lib/ai/claude";
import { QuizDetailClient, type DetailChoice, type DetailQuestion } from "./quiz-detail-client";

function readLinks(value: unknown): { flashcardIds: string[]; noteIds: string[] } {
    const v = (value ?? {}) as Record<string, unknown>;
    const ids = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    return { flashcardIds: ids(v.flashcardIds), noteIds: ids(v.noteIds) };
}

function readChoices(value: unknown): DetailChoice[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((c) => {
            const o = (c ?? {}) as Record<string, unknown>;
            const text = typeof o.text === "string" ? o.text : "";
            return text ? { text, correct: o.correct === true } : null;
        })
        .filter((c): c is DetailChoice => c !== null);
}

export default async function QuizDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const user = await requireUser();

    const quiz = await db.quiz.findFirst({
        where: { id, userId: user.id },
        include: {
            course: { select: { id: true, title: true } },
            questions: { orderBy: { order: "asc" } },
            attempts: { orderBy: { createdAt: "asc" }, select: { id: true, score: true, createdAt: true } },
        },
    });
    if (!quiz) notFound();

    const links = readLinks(quiz.links);

    const [courses, flashcards, notes, linkedFlashcards, linkedNotes] = await Promise.all([
        db.learningCourse.findMany({ where: { userId: user.id }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
        db.flashcard.findMany({ where: { userId: user.id }, select: { id: true, front: true }, orderBy: { createdAt: "desc" } }),
        db.learningNote.findMany({ where: { userId: user.id }, select: { id: true, title: true }, orderBy: { createdAt: "desc" } }),
        links.flashcardIds.length ? db.flashcard.findMany({ where: { id: { in: links.flashcardIds }, userId: user.id }, select: { id: true, front: true } }) : Promise.resolve([]),
        links.noteIds.length ? db.learningNote.findMany({ where: { id: { in: links.noteIds }, userId: user.id }, select: { id: true, title: true } }) : Promise.resolve([]),
    ]);

    const questions: DetailQuestion[] = quiz.questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        choices: readChoices(q.choices),
        explanation: q.explanation,
    }));

    return (
        <QuizDetailClient
            quiz={{
                id: quiz.id,
                title: quiz.title,
                description: quiz.description,
                topic: quiz.topic,
                courseId: quiz.courseId,
                courseTitle: quiz.course?.title ?? null,
                aiGenerated: quiz.aiGenerated,
                aiTeach: quiz.aiTeach,
                flashcardIds: links.flashcardIds,
                noteIds: links.noteIds,
                questions,
                attempts: quiz.attempts.map((a) => ({ id: a.id, score: a.score, createdAt: a.createdAt.toISOString() })),
            }}
            linkedFlashcardLabels={linkedFlashcards.map((f) => f.front)}
            linkedNoteLabels={linkedNotes.map((n) => n.title)}
            courses={courses}
            flashcards={flashcards.map((f) => ({ id: f.id, label: f.front }))}
            notes={notes.map((n) => ({ id: n.id, label: n.title }))}
            aiEnabled={aiConfigured()}
        />
    );
}
