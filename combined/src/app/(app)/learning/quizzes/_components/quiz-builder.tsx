"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/base/buttons/button";
import { Toggle } from "@/components/base/toggle/toggle";
import { Field, NativeInput, NativeSelect, NativeTextarea } from "../../_components/learning-ui";
import { FormModal } from "../../_components/form-modal";
import { LinkPicker } from "./link-picker";
import { QuestionEditor } from "./question-editor";
import { newQuestion, runAction, serializeQuestions, type CourseOption, type PickerOption, type QuestionDraft } from "./quiz-shared";
import { createQuizFull, updateQuizFull } from "@/lib/actions/learning-quizzes";

export interface BuilderInitial {
    id?: string;
    title?: string;
    description?: string;
    topic?: string;
    courseId?: string | null;
    aiTeach?: boolean;
    flashcardIds?: string[];
    noteIds?: string[];
    questions?: QuestionDraft[];
}

interface QuizBuilderProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    initial: BuilderInitial | null;
    courses: CourseOption[];
    flashcards: PickerOption[];
    notes: PickerOption[];
}

/** Create / edit a quiz: metadata, links, teach toggle, and the full question editor. */
export function QuizBuilder({ isOpen, onOpenChange, initial, courses, flashcards, notes }: QuizBuilderProps) {
    const router = useRouter();
    const editing = Boolean(initial?.id);

    const [title, setTitle] = useState(initial?.title ?? "");
    const [description, setDescription] = useState(initial?.description ?? "");
    const [topic, setTopic] = useState(initial?.topic ?? "");
    const [courseId, setCourseId] = useState(initial?.courseId ?? "");
    const [aiTeach, setAiTeach] = useState(initial?.aiTeach ?? false);
    const [flashcardIds, setFlashcardIds] = useState<string[]>(initial?.flashcardIds ?? []);
    const [noteIds, setNoteIds] = useState<string[]>(initial?.noteIds ?? []);
    const [questions, setQuestions] = useState<QuestionDraft[]>(initial?.questions ?? [newQuestion()]);
    const [saving, setSaving] = useState(false);

    const save = async () => {
        if (!title.trim()) return;
        setSaving(true);
        const cleaned = serializeQuestions(questions);
        const fd = new FormData();
        if (initial?.id) fd.set("id", initial.id);
        fd.set("title", title.trim());
        fd.set("description", description);
        fd.set("topic", topic);
        fd.set("courseId", courseId);
        fd.set("aiTeach", aiTeach ? "true" : "false");
        fd.set("links", JSON.stringify({ flashcardIds, noteIds }));
        fd.set("questions", JSON.stringify(cleaned));

        const ok = await runAction(() => (editing ? updateQuizFull(fd) : createQuizFull(fd)), {
            ok: editing ? "Quiz updated" : "Quiz created",
            onSuccess: (res) => {
                onOpenChange(false);
                if (!editing && res?.id) router.push(`/learning/quizzes/${res.id}`);
                else router.refresh();
            },
        });
        if (!ok) setSaving(false);
    };

    return (
        <FormModal isOpen={isOpen} onOpenChange={onOpenChange} title={editing ? "Edit quiz" : "New quiz"} description="Build a quiz with rich markdown questions.">
            <div className="flex flex-col gap-4">
                <Field label="Title" htmlFor="qb-title" required>
                    <NativeInput id="qb-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Algorithms fundamentals" required />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Topic" htmlFor="qb-topic">
                        <NativeInput id="qb-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Big-O notation" />
                    </Field>
                    <Field label="Course" htmlFor="qb-course">
                        <NativeSelect id="qb-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                            <option value="">No course</option>
                            {courses.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.title}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                </div>
                <Field label="Description" htmlFor="qb-desc">
                    <NativeTextarea id="qb-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this quiz cover?" rows={2} />
                </Field>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <LinkPicker label="Linked flashcards" options={flashcards} selected={flashcardIds} onChange={setFlashcardIds} emptyHint="No flashcards yet." />
                    <LinkPicker label="Linked notes" options={notes} selected={noteIds} onChange={setNoteIds} emptyHint="No notes yet." />
                </div>

                <div className="rounded-lg bg-secondary p-3 ring-1 ring-secondary ring-inset">
                    <Toggle
                        size="sm"
                        isSelected={aiTeach}
                        onChange={setAiTeach}
                        label="AI quiz & teach"
                        hint="Show explanations after each answer during the take-flow."
                    />
                </div>

                <div className="border-t border-secondary pt-4">
                    <QuestionEditor questions={questions} onChange={setQuestions} />
                </div>

                <div className="flex justify-end gap-2 border-t border-secondary pt-4">
                    <Button color="secondary" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={save} isLoading={saving} isDisabled={!title.trim()}>
                        {editing ? "Save changes" : "Create quiz"}
                    </Button>
                </div>
            </div>
        </FormModal>
    );
}
