"use client";

import { ArrowDown, ArrowUp, Plus, Trash02 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { MarkdownField } from "./markdown-field";
import { newChoice, newQuestion, type QuestionDraft } from "./quiz-shared";

interface QuestionEditorProps {
    questions: QuestionDraft[];
    onChange: (questions: QuestionDraft[]) => void;
}

/** Full manual question editor: add / edit / reorder / delete, with markdown fields. */
export function QuestionEditor({ questions, onChange }: QuestionEditorProps) {
    const update = (i: number, patch: Partial<QuestionDraft>) => {
        onChange(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
    };
    const move = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= questions.length) return;
        const next = [...questions];
        [next[i], next[j]] = [next[j], next[i]];
        onChange(next);
    };
    const remove = (i: number) => onChange(questions.filter((_, idx) => idx !== i));

    const setChoiceText = (qi: number, ci: number, text: string) => {
        update(qi, { choices: questions[qi].choices.map((c, idx) => (idx === ci ? { ...c, text } : c)) });
    };
    const setCorrect = (qi: number, ci: number) => {
        update(qi, { choices: questions[qi].choices.map((c, idx) => ({ ...c, correct: idx === ci })) });
    };
    const addChoice = (qi: number) => {
        if (questions[qi].choices.length >= 6) return;
        update(qi, { choices: [...questions[qi].choices, newChoice(false)] });
    };
    const removeChoice = (qi: number, ci: number) => {
        const q = questions[qi];
        if (q.choices.length <= 2) return;
        const removingCorrect = q.choices[ci].correct;
        const choices = q.choices.filter((_, idx) => idx !== ci);
        if (removingCorrect && !choices.some((c) => c.correct)) choices[0].correct = true;
        update(qi, { choices });
    };

    return (
        <div className="flex flex-col gap-4">
            {questions.length === 0 && (
                <p className="rounded-lg bg-secondary py-4 text-center text-sm text-tertiary">No questions yet. Add one below.</p>
            )}
            {questions.map((q, qi) => (
                <div key={q.key} className="flex flex-col gap-3 rounded-xl bg-secondary p-4 ring-1 ring-secondary ring-inset">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-tertiary">Question {qi + 1}</span>
                        <div className="flex items-center gap-1">
                            <Button size="sm" color="tertiary" iconLeading={ArrowUp} aria-label="Move up" isDisabled={qi === 0} onClick={() => move(qi, -1)} />
                            <Button size="sm" color="tertiary" iconLeading={ArrowDown} aria-label="Move down" isDisabled={qi === questions.length - 1} onClick={() => move(qi, 1)} />
                            <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Delete question" onClick={() => remove(qi)} />
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-secondary">Prompt (markdown)</span>
                        <MarkdownField aria-label={`Question ${qi + 1} prompt`} value={q.prompt} onChange={(v) => update(qi, { prompt: v })} placeholder="What is the time complexity of binary search?" />
                    </div>

                    <div className="flex flex-col gap-2">
                        <span className="text-xs font-medium text-secondary">Choices — tap the circle to mark the correct one</span>
                        {q.choices.map((c, ci) => (
                            <div key={ci} className="flex items-start gap-2">
                                <button
                                    type="button"
                                    aria-label={c.correct ? "Correct answer" : "Mark as correct"}
                                    onClick={() => setCorrect(qi, ci)}
                                    className={cx(
                                        "mt-1.5 size-4 shrink-0 rounded-full ring-1 transition duration-100 ease-linear ring-inset",
                                        c.correct ? "bg-success-solid ring-transparent" : "bg-primary ring-primary hover:ring-brand",
                                    )}
                                />
                                <div className="flex-1">
                                    <MarkdownField aria-label={`Choice ${ci + 1}`} value={c.text} onChange={(v) => setChoiceText(qi, ci, v)} placeholder={`Choice ${ci + 1}`} rows={2} />
                                </div>
                                <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Remove choice" isDisabled={q.choices.length <= 2} onClick={() => removeChoice(qi, ci)} />
                            </div>
                        ))}
                        {q.choices.length < 6 && (
                            <Button size="sm" color="link-color" iconLeading={Plus} onClick={() => addChoice(qi)} className="self-start">
                                Add choice
                            </Button>
                        )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-secondary">Explanation (optional, markdown)</span>
                        <MarkdownField aria-label={`Question ${qi + 1} explanation`} value={q.explanation} onChange={(v) => update(qi, { explanation: v })} placeholder="Shown after answering when teach mode is on." rows={2} />
                    </div>
                </div>
            ))}

            <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => onChange([...questions, newQuestion()])} className="self-start">
                Add question
            </Button>
        </div>
    );
}
