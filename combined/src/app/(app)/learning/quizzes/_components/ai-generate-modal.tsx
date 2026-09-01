"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Stars02 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Toggle } from "@/components/base/toggle/toggle";
import { Field, NativeInput, NativeSelect } from "../../_components/learning-ui";
import { FormModal } from "../../_components/form-modal";
import { Markdown } from "../../_components/markdown";
import { LinkPicker } from "./link-picker";
import { runAction, type CourseOption, type PickerOption } from "./quiz-shared";
import { generateQuiz, saveGeneratedQuiz, type GeneratedQuiz } from "@/lib/actions/learning-quizzes";

interface AiGenerateModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    courses: CourseOption[];
    flashcards: PickerOption[];
    notes: PickerOption[];
}

/** "Create with AI" flow: configure → generate → preview → save (aiGenerated). */
export function AiGenerateModal({ isOpen, onOpenChange, courses, flashcards, notes }: AiGenerateModalProps) {
    const router = useRouter();
    const [topic, setTopic] = useState("");
    const [count, setCount] = useState(8);
    const [difficulty, setDifficulty] = useState("mixed");
    const [tone, setTone] = useState("");
    const [courseId, setCourseId] = useState("");
    const [flashcardIds, setFlashcardIds] = useState<string[]>([]);
    const [noteIds, setNoteIds] = useState<string[]>([]);
    const [aiTeach, setAiTeach] = useState(true);

    const [generating, setGenerating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [preview, setPreview] = useState<GeneratedQuiz | null>(null);

    const hasLinks = flashcardIds.length > 0 || noteIds.length > 0 || Boolean(courseId);

    const reset = () => {
        setPreview(null);
        setTopic("");
        setTone("");
        setFlashcardIds([]);
        setNoteIds([]);
        setCourseId("");
    };

    const close = (open: boolean) => {
        onOpenChange(open);
        if (!open) reset();
    };

    const generate = async () => {
        if (!topic.trim()) return;
        setGenerating(true);
        const fd = new FormData();
        fd.set("topic", topic.trim());
        fd.set("count", String(count));
        fd.set("difficulty", difficulty);
        fd.set("tone", tone);
        fd.set("courseId", courseId);
        fd.set("links", JSON.stringify({ flashcardIds, noteIds }));
        await runAction(() => generateQuiz(fd), {
            onSuccess: (res) => setPreview(res),
        });
        setGenerating(false);
    };

    const save = async () => {
        if (!preview) return;
        setSaving(true);
        const fd = new FormData();
        fd.set("title", preview.title);
        fd.set("description", preview.description ?? "");
        fd.set("topic", topic.trim());
        fd.set("courseId", courseId);
        fd.set("aiTeach", aiTeach ? "true" : "false");
        fd.set("links", JSON.stringify({ flashcardIds, noteIds }));
        fd.set("questions", JSON.stringify(preview.questions));
        const ok = await runAction(() => saveGeneratedQuiz(fd), {
            ok: "AI quiz saved",
            onSuccess: (res) => {
                close(false);
                if (res?.id) router.push(`/learning/quizzes/${res.id}`);
            },
        });
        if (!ok) setSaving(false);
    };

    return (
        <FormModal
            isOpen={isOpen}
            onOpenChange={close}
            title={preview ? "Review AI quiz" : "Create with AI"}
            description={preview ? "Check the questions, then save." : "Describe a topic and Claude will write a quiz."}
        >
            {preview ? (
                <div className="flex flex-col gap-4">
                    <div>
                        <h3 className="text-md font-semibold text-primary">{preview.title}</h3>
                        {preview.description && <p className="mt-0.5 text-sm text-tertiary">{preview.description}</p>}
                        <p className="mt-1 text-xs text-tertiary">{preview.questions.length} questions</p>
                    </div>
                    <div className="flex flex-col gap-3">
                        {preview.questions.map((q, i) => (
                            <div key={i} className="rounded-lg bg-secondary p-3 ring-1 ring-secondary ring-inset">
                                <div className="flex gap-2">
                                    <span className="text-xs font-semibold text-tertiary">{i + 1}.</span>
                                    <div className="flex-1">
                                        <Markdown>{q.prompt}</Markdown>
                                        <ul className="mt-2 flex flex-col gap-1">
                                            {q.choices.map((c, ci) => (
                                                <li key={ci} className="flex items-start gap-2 text-sm">
                                                    <span className={c.correct ? "font-semibold text-success-primary" : "text-tertiary"}>{c.correct ? "✓" : "○"}</span>
                                                    <span className={c.correct ? "text-primary" : "text-secondary"}>{c.text}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <Toggle size="sm" isSelected={aiTeach} onChange={setAiTeach} label="AI quiz & teach" hint="Show explanations during the take-flow." />
                    <div className="flex justify-between gap-2 border-t border-secondary pt-4">
                        <Button color="secondary" iconLeading={ArrowLeft} onClick={() => setPreview(null)}>
                            Back
                        </Button>
                        <div className="flex gap-2">
                            <Button color="secondary" onClick={generate} isLoading={generating}>
                                Regenerate
                            </Button>
                            <Button onClick={save} isLoading={saving}>
                                Save quiz
                            </Button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <Field label="Topic" htmlFor="ai-topic" required>
                        <NativeInput id="ai-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="React hooks, the French Revolution, SQL joins…" required />
                    </Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <Field label="Questions" htmlFor="ai-count">
                            <NativeInput id="ai-count" type="number" min={5} max={20} value={count} onChange={(e) => setCount(Math.min(20, Math.max(5, Number(e.target.value) || 8)))} />
                        </Field>
                        <Field label="Difficulty" htmlFor="ai-diff">
                            <NativeSelect id="ai-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                                <option value="easy">Easy</option>
                                <option value="medium">Medium</option>
                                <option value="hard">Hard</option>
                                <option value="mixed">Mixed</option>
                            </NativeSelect>
                        </Field>
                        <Field label="Tone" htmlFor="ai-tone">
                            <NativeInput id="ai-tone" value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Optional" />
                        </Field>
                    </div>

                    <Field label="Ground in a course (optional)" htmlFor="ai-course">
                        <NativeSelect id="ai-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                            <option value="">None</option>
                            {courses.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.title}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <LinkPicker label="From flashcards" options={flashcards} selected={flashcardIds} onChange={setFlashcardIds} emptyHint="No flashcards yet." />
                        <LinkPicker label="From notes" options={notes} selected={noteIds} onChange={setNoteIds} emptyHint="No notes yet." />
                    </div>
                    {hasLinks && <p className="text-xs text-tertiary">Linked content will be used as source material and saved with the quiz.</p>}

                    <div className="flex justify-end gap-2 border-t border-secondary pt-4">
                        <Button color="secondary" onClick={() => close(false)}>
                            Cancel
                        </Button>
                        <Button iconLeading={Stars02} onClick={generate} isLoading={generating} isDisabled={!topic.trim()}>
                            Generate
                        </Button>
                    </div>
                </div>
            )}
        </FormModal>
    );
}
