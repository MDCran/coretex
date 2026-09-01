"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Edit01, GraduationHat02, Link01, PlayCircle, Stars02, Trash02 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Tooltip } from "@/components/base/tooltip/tooltip";
import { Card } from "../../_components/learning-ui";
import { formatDateTime } from "@/lib/dates";
import { Markdown } from "../../_components/markdown";
import { TrendChart, type TrendPoint } from "../../_components/trend-chart";
import { QuizBuilder } from "../_components/quiz-builder";
import { newQuestion, runAction, type CourseOption, type PickerOption, type QuestionDraft } from "../_components/quiz-shared";
import { deleteQuizAttempt, deleteQuizFull } from "@/lib/actions/learning-quizzes";
import { AiAssist, RewriteButton } from "./ai-assist";
import { TakeFlow } from "./take-flow";

export interface DetailChoice {
    text: string;
    correct: boolean;
}
export interface DetailQuestion {
    id: string;
    prompt: string;
    choices: DetailChoice[];
    explanation: string | null;
}
interface AttemptRow {
    id: string;
    score: number | null;
    createdAt: string;
}
export interface QuizDetail {
    id: string;
    title: string;
    description: string | null;
    topic: string | null;
    courseId: string | null;
    courseTitle: string | null;
    aiGenerated: boolean;
    aiTeach: boolean;
    flashcardIds: string[];
    noteIds: string[];
    questions: DetailQuestion[];
    attempts: AttemptRow[];
}

interface QuizDetailClientProps {
    quiz: QuizDetail;
    linkedFlashcardLabels: string[];
    linkedNoteLabels: string[];
    courses: CourseOption[];
    flashcards: PickerOption[];
    notes: PickerOption[];
    aiEnabled: boolean;
}

export function QuizDetailClient({ quiz, linkedFlashcardLabels, linkedNoteLabels, courses, flashcards, notes, aiEnabled }: QuizDetailClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [taking, setTaking] = useState(false);
    const [editing, setEditing] = useState(false);

    useEffect(() => {
        if (searchParams.get("edit") === "1") setEditing(true);
    }, [searchParams]);

    const hasQuestions = quiz.questions.length > 0;
    const hasMissingExplanations = quiz.questions.some((q) => !q.explanation || !q.explanation.trim());

    const builderInitial = {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description ?? "",
        topic: quiz.topic ?? "",
        courseId: quiz.courseId,
        aiTeach: quiz.aiTeach,
        flashcardIds: quiz.flashcardIds,
        noteIds: quiz.noteIds,
        questions: (quiz.questions.length
            ? quiz.questions.map<QuestionDraft>((q) => ({
                  key: q.id,
                  prompt: q.prompt,
                  choices: q.choices.map((c) => ({ text: c.text, correct: c.correct })),
                  explanation: q.explanation ?? "",
              }))
            : [newQuestion()]),
    };

    const scores = quiz.attempts.map((a) => a.score).filter((s): s is number => s !== null);
    const best = scores.length ? Math.max(...scores) : null;
    const chart: TrendPoint[] = quiz.attempts.map((a, i) => ({ label: `#${i + 1}`, score: a.score ?? 0 }));

    if (taking) {
        return (
            <Card>
                <TakeFlow
                    quizId={quiz.id}
                    title={quiz.title}
                    teach={quiz.aiTeach}
                    questions={quiz.questions.map((q) => ({ id: q.id, prompt: q.prompt, choices: q.choices, explanation: q.explanation }))}
                    onExit={() => {
                        setTaking(false);
                        router.refresh();
                    }}
                />
            </Card>
        );
    }

    const aiAddButton = <AiAssist quizId={quiz.id} hasMissingExplanations={hasMissingExplanations} />;

    return (
        <div className="flex flex-col gap-6">
            <Button color="link-gray" size="sm" iconLeading={ArrowLeft} href="/learning/quizzes" className="self-start">
                Back to quizzes
            </Button>

            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {quiz.topic && (
                            <Badge color="brand" size="sm">
                                {quiz.topic}
                            </Badge>
                        )}
                        {quiz.aiGenerated && (
                            <Badge color="purple" size="sm" type="pill-color">
                                AI generated
                            </Badge>
                        )}
                        {quiz.aiTeach && (
                            <Badge color="indigo" size="sm">
                                <GraduationHat02 className="size-3" aria-hidden="true" /> Teach
                            </Badge>
                        )}
                        {quiz.courseTitle && (
                            <Badge color="gray" size="sm">
                                {quiz.courseTitle}
                            </Badge>
                        )}
                    </div>
                    <h2 className="text-display-xs font-semibold text-primary">{quiz.title}</h2>
                    {quiz.description && <p className="max-w-2xl text-sm text-tertiary">{quiz.description}</p>}
                    {(linkedFlashcardLabels.length > 0 || linkedNoteLabels.length > 0) && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <Link01 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                            {linkedFlashcardLabels.map((l, i) => (
                                <Badge key={`f${i}`} color="blue" size="sm">
                                    {l.length > 40 ? l.slice(0, 40) + "…" : l}
                                </Badge>
                            ))}
                            {linkedNoteLabels.map((l, i) => (
                                <Badge key={`n${i}`} color="orange" size="sm">
                                    {l.length > 40 ? l.slice(0, 40) + "…" : l}
                                </Badge>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => setEditing(true)}>
                        Edit
                    </Button>
                    <Button
                        size="sm"
                        color="tertiary-destructive"
                        iconLeading={Trash02}
                        aria-label="Delete quiz"
                        onClick={() =>
                            runAction(
                                () => {
                                    const fd = new FormData();
                                    fd.set("id", quiz.id);
                                    return deleteQuizFull(fd);
                                },
                                { ok: "Quiz deleted", onSuccess: () => router.push("/learning/quizzes") },
                            )
                        }
                    />
                    <Button size="sm" iconLeading={PlayCircle} onClick={() => setTaking(true)} isDisabled={!hasQuestions}>
                        Take quiz
                    </Button>
                </div>
            </div>

            {/* AI assist row */}
            <Card className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Stars02 className="size-4 text-fg-brand-primary" aria-hidden="true" />
                    <span className="text-sm font-medium text-secondary">AI assist</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {aiEnabled ? aiAddButton : <Tooltip title="Add ANTHROPIC_API_KEY">{aiAddButton}</Tooltip>}
                </div>
            </Card>

            {/* Attempts + trend */}
            <Card className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-md font-semibold text-primary">Attempts</h3>
                    <span className="text-xs text-tertiary">
                        {quiz.attempts.length} total{best !== null && <span className="ml-1 text-success-primary">· best {Math.round(best)}%</span>}
                    </span>
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <TrendChart data={chart} series={[{ key: "score", name: "Score %" }]} type="line" fitDomain height={180} emptyLabel="No attempts yet" />
                    <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                        {quiz.attempts.length === 0 && <p className="text-sm text-tertiary">Take the quiz to record your first attempt.</p>}
                        {quiz.attempts
                            .slice()
                            .reverse()
                            .map((a) => (
                                <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 ring-1 ring-secondary ring-inset">
                                    <span className="text-sm text-tertiary">{formatDateTime(a.createdAt)}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-primary tabular-nums">{a.score !== null ? `${Math.round(a.score)}%` : "—"}</span>
                                        <Button
                                            size="sm"
                                            color="tertiary-destructive"
                                            iconLeading={Trash02}
                                            aria-label="Delete attempt"
                                            onClick={() =>
                                                runAction(
                                                    () => {
                                                        const fd = new FormData();
                                                        fd.set("id", a.id);
                                                        return deleteQuizAttempt(fd);
                                                    },
                                                    { ok: "Attempt deleted", onSuccess: () => router.refresh() },
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                            ))}
                    </div>
                </div>
            </Card>

            {/* Questions */}
            <div className="flex flex-col gap-3">
                <h3 className="text-md font-semibold text-primary">
                    Questions <span className="text-tertiary">({quiz.questions.length})</span>
                </h3>
                {!hasQuestions && (
                    <Card>
                        <p className="py-4 text-center text-sm text-tertiary">No questions yet. Edit the quiz to add some, or use AI assist.</p>
                    </Card>
                )}
                {quiz.questions.map((q, i) => {
                    const correctIndex = q.choices.findIndex((c) => c.correct);
                    return (
                        <Card key={q.id} className="flex flex-col gap-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-1 items-start gap-2">
                                    <span className="text-sm font-semibold text-tertiary">{i + 1}.</span>
                                    <div className="flex-1">
                                        <Markdown>{q.prompt}</Markdown>
                                    </div>
                                </div>
                                {aiEnabled && <RewriteButton questionId={q.id} />}
                            </div>
                            <ul className="ml-6 flex flex-col gap-1.5">
                                {q.choices.map((c, ci) => (
                                    <li
                                        key={ci}
                                        className={ci === correctIndex ? "rounded-md bg-success-primary px-2 py-1 ring-1 ring-success ring-inset" : "px-2 py-1"}
                                    >
                                        <div className="flex items-start gap-2">
                                            <span className={ci === correctIndex ? "text-sm font-semibold text-success-primary" : "text-sm text-tertiary"}>{String.fromCharCode(65 + ci)}</span>
                                            <div className="flex-1">
                                                <Markdown>{c.text}</Markdown>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                            {q.explanation && (
                                <div className="ml-6 rounded-lg bg-secondary p-3 ring-1 ring-secondary ring-inset">
                                    <p className="mb-1 text-xs font-semibold text-tertiary">Explanation</p>
                                    <Markdown>{q.explanation}</Markdown>
                                </div>
                            )}
                        </Card>
                    );
                })}
            </div>

            {editing && (
                <QuizBuilder
                    key={quiz.id + quiz.questions.length}
                    isOpen={editing}
                    onOpenChange={(o) => {
                        setEditing(o);
                        if (!o && searchParams.get("edit") === "1") router.replace(`/learning/quizzes/${quiz.id}`);
                    }}
                    initial={builderInitial}
                    courses={courses}
                    flashcards={flashcards}
                    notes={notes}
                />
            )}
        </div>
    );
}
