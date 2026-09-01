import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConfigured } from "@/lib/ai/claude";
import { QuizzesClient, type QuizCard } from "./quizzes-client";

function readLinks(value: unknown): { flashcardIds: string[]; noteIds: string[] } {
    const v = (value ?? {}) as Record<string, unknown>;
    const ids = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    return { flashcardIds: ids(v.flashcardIds), noteIds: ids(v.noteIds) };
}

export default async function QuizzesPage() {
    const user = await requireUser();
    const [quizzes, courses, flashcards, notes] = await Promise.all([
        db.quiz.findMany({
            where: { userId: user.id },
            include: {
                course: { select: { title: true } },
                attempts: { orderBy: { createdAt: "asc" }, select: { id: true, score: true, createdAt: true } },
                _count: { select: { questions: true } },
            },
            orderBy: { createdAt: "desc" },
        }),
        db.learningCourse.findMany({ where: { userId: user.id }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
        db.flashcard.findMany({ where: { userId: user.id }, select: { id: true, front: true }, orderBy: { createdAt: "desc" } }),
        db.learningNote.findMany({ where: { userId: user.id }, select: { id: true, title: true }, orderBy: { createdAt: "desc" } }),
    ]);

    const cards: QuizCard[] = quizzes.map((q) => {
        const links = readLinks(q.links);
        const scores = q.attempts.map((a) => a.score).filter((s): s is number => s !== null);
        return {
            id: q.id,
            title: q.title,
            description: q.description,
            topic: q.topic,
            courseId: q.courseId,
            courseTitle: q.course?.title ?? null,
            aiGenerated: q.aiGenerated,
            aiTeach: q.aiTeach,
            questionCount: q._count.questions,
            attemptCount: q.attempts.length,
            bestScore: scores.length ? Math.max(...scores) : null,
            linkedFlashcards: links.flashcardIds.length,
            linkedNotes: links.noteIds.length,
        };
    });

    return (
        <QuizzesClient
            quizzes={cards}
            courses={courses}
            flashcards={flashcards.map((f) => ({ id: f.id, label: f.front }))}
            notes={notes.map((n) => ({ id: n.id, label: n.title }))}
            aiEnabled={aiConfigured()}
        />
    );
}
