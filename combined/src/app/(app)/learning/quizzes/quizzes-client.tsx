"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen01, Edit01, FileQuestion02, Link01, Plus, Stars02, Trash02 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Tooltip } from "@/components/base/tooltip/tooltip";
import { Card, EmptyState, NativeSelect, SectionHeader } from "../_components/learning-ui";
import { AiGenerateModal } from "./_components/ai-generate-modal";
import { QuizBuilder, type BuilderInitial } from "./_components/quiz-builder";
import { runAction, type CourseOption, type PickerOption } from "./_components/quiz-shared";
import { deleteQuizFull } from "@/lib/actions/learning-quizzes";

export interface QuizCard {
    id: string;
    title: string;
    description: string | null;
    topic: string | null;
    courseId: string | null;
    courseTitle: string | null;
    aiGenerated: boolean;
    aiTeach: boolean;
    questionCount: number;
    attemptCount: number;
    bestScore: number | null;
    linkedFlashcards: number;
    linkedNotes: number;
}

interface QuizzesClientProps {
    quizzes: QuizCard[];
    courses: CourseOption[];
    flashcards: PickerOption[];
    notes: PickerOption[];
    aiEnabled: boolean;
}

export function QuizzesClient({ quizzes, courses, flashcards, notes, aiEnabled }: QuizzesClientProps) {
    const router = useRouter();
    const [builder, setBuilder] = useState<{ open: boolean; initial: BuilderInitial | null }>({ open: false, initial: null });
    const [aiOpen, setAiOpen] = useState(false);
    const [courseFilter, setCourseFilter] = useState("");
    const [sourceFilter, setSourceFilter] = useState("");

    const filtered = useMemo(
        () =>
            quizzes.filter((q) => {
                if (courseFilter && q.courseId !== courseFilter) return false;
                if (sourceFilter === "ai" && !q.aiGenerated) return false;
                if (sourceFilter === "manual" && q.aiGenerated) return false;
                return true;
            }),
        [quizzes, courseFilter, sourceFilter],
    );

    const aiButton = (
        <Button size="md" color="secondary" iconLeading={Stars02} onClick={() => setAiOpen(true)} isDisabled={!aiEnabled}>
            Create with AI
        </Button>
    );

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Quizzes"
                description="Build, take, and master quizzes with rich markdown and AI-powered question writing."
                action={
                    <div className="flex flex-wrap items-center gap-2">
                        {aiEnabled ? aiButton : <Tooltip title="Add ANTHROPIC_API_KEY">{aiButton}</Tooltip>}
                        <Button size="md" iconLeading={Plus} onClick={() => setBuilder({ open: true, initial: null })}>
                            New quiz
                        </Button>
                    </div>
                }
            />

            <div className="flex flex-wrap items-center gap-3">
                <div className="w-48">
                    <NativeSelect aria-label="Filter by course" value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}>
                        <option value="">All courses</option>
                        {courses.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.title}
                            </option>
                        ))}
                    </NativeSelect>
                </div>
                <div className="w-40">
                    <NativeSelect aria-label="Filter by source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                        <option value="">All quizzes</option>
                        <option value="ai">AI-generated</option>
                        <option value="manual">Manual</option>
                    </NativeSelect>
                </div>
            </div>

            {filtered.length === 0 ? (
                <Card>
                    {quizzes.length === 0 ? (
                        <EmptyState
                            icon={FileQuestion02}
                            title="Create your first quiz"
                            description="Write questions by hand or let AI draft a full quiz from a topic — then test yourself and track your scores over time."
                            action={
                                <>
                                    <Button size="md" iconLeading={Plus} onClick={() => setBuilder({ open: true, initial: null })}>
                                        New quiz
                                    </Button>
                                    {aiEnabled && (
                                        <Button size="md" color="secondary" iconLeading={Stars02} onClick={() => setAiOpen(true)}>
                                            Create with AI
                                        </Button>
                                    )}
                                </>
                            }
                        />
                    ) : (
                        <EmptyState
                            icon={FileQuestion02}
                            title="No quizzes match your filters"
                            description="Try a different course or source, or clear your filters to see everything."
                            action={
                                <Button size="md" color="secondary" onClick={() => { setCourseFilter(""); setSourceFilter(""); }}>
                                    Clear filters
                                </Button>
                            }
                            compact
                        />
                    )}
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((q) => (
                        <Card key={q.id} className="flex flex-col gap-3 transition duration-100 ease-linear hover:ring-brand">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {q.topic && (
                                        <Badge color="brand" size="sm">
                                            {q.topic}
                                        </Badge>
                                    )}
                                    {q.aiGenerated && (
                                        <Badge color="purple" size="sm" type="pill-color">
                                            AI
                                        </Badge>
                                    )}
                                    {q.aiTeach && (
                                        <Badge color="indigo" size="sm">
                                            Teach
                                        </Badge>
                                    )}
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit quiz" href={`/learning/quizzes/${q.id}?edit=1`} />
                                    <Button
                                        size="sm"
                                        color="tertiary-destructive"
                                        iconLeading={Trash02}
                                        aria-label="Delete quiz"
                                        onClick={() =>
                                            runAction(
                                                () => {
                                                    const fd = new FormData();
                                                    fd.set("id", q.id);
                                                    return deleteQuizFull(fd);
                                                },
                                                { ok: "Quiz deleted", onSuccess: () => router.refresh() },
                                            )
                                        }
                                    />
                                </div>
                            </div>

                            <Link href={`/learning/quizzes/${q.id}`} className="group flex flex-col gap-1">
                                <h3 className="text-md font-semibold text-primary group-hover:text-brand-secondary">{q.title}</h3>
                                {q.description && <p className="line-clamp-2 text-sm text-tertiary">{q.description}</p>}
                            </Link>

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tertiary">
                                <span className="flex items-center gap-1">
                                    <FileQuestion02 className="size-3.5" aria-hidden="true" />
                                    {q.questionCount} question{q.questionCount === 1 ? "" : "s"}
                                </span>
                                {q.courseTitle && (
                                    <span className="flex items-center gap-1">
                                        <BookOpen01 className="size-3.5" aria-hidden="true" />
                                        {q.courseTitle}
                                    </span>
                                )}
                                {(q.linkedFlashcards > 0 || q.linkedNotes > 0) && (
                                    <span className="flex items-center gap-1">
                                        <Link01 className="size-3.5" aria-hidden="true" />
                                        {[q.linkedFlashcards && `${q.linkedFlashcards} cards`, q.linkedNotes && `${q.linkedNotes} notes`].filter(Boolean).join(", ")}
                                    </span>
                                )}
                            </div>

                            <div className="mt-auto flex items-center justify-between border-t border-secondary pt-3">
                                <span className="text-xs text-tertiary">
                                    {q.attemptCount > 0 ? `${q.attemptCount} attempt${q.attemptCount === 1 ? "" : "s"}` : "Not attempted"}
                                    {q.bestScore !== null && <span className="ml-1 font-medium text-success-primary">· best {Math.round(q.bestScore)}%</span>}
                                </span>
                                <Button size="sm" href={`/learning/quizzes/${q.id}`}>
                                    {q.questionCount > 0 ? "Take quiz" : "Open"}
                                </Button>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            <QuizBuilder
                key={builder.initial?.id ?? "new"}
                isOpen={builder.open}
                onOpenChange={(o) => setBuilder((b) => ({ ...b, open: o }))}
                initial={builder.initial}
                courses={courses}
                flashcards={flashcards}
                notes={notes}
            />
            <AiGenerateModal isOpen={aiOpen} onOpenChange={setAiOpen} courses={courses} flashcards={flashcards} notes={notes} />
        </div>
    );
}
