"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle, RefreshCw01, XCircle } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { Markdown } from "../../_components/markdown";
import { ProgressBar } from "../../_components/learning-ui";
import { runAction } from "../_components/quiz-shared";
import { saveQuizAttempt, type AttemptAnswer } from "@/lib/actions/learning-quizzes";

export interface TakeChoice {
    text: string;
    correct: boolean;
}
export interface TakeQuestion {
    id: string;
    prompt: string;
    choices: TakeChoice[];
    explanation: string | null;
}

interface TakeFlowProps {
    quizId: string;
    title: string;
    questions: TakeQuestion[];
    teach: boolean;
    onExit: () => void;
}

type Phase = "answering" | "revealed" | "done";

/** Interactive question-by-question take flow with optional teach explanations. */
export function TakeFlow({ quizId, title, questions, teach, onExit }: TakeFlowProps) {
    const router = useRouter();
    const [index, setIndex] = useState(0);
    const [selected, setSelected] = useState<number | null>(null);
    const [phase, setPhase] = useState<Phase>("answering");
    const [answers, setAnswers] = useState<AttemptAnswer[]>([]);
    const [saving, setSaving] = useState(false);

    const q = questions[index];
    const total = questions.length;
    const correctIndex = useMemo(() => q?.choices.findIndex((c) => c.correct) ?? -1, [q]);

    const score = useMemo(() => {
        if (answers.length === 0) return 0;
        const right = answers.filter((a) => a.correct).length;
        return Math.round((right / total) * 100);
    }, [answers, total]);

    const submitAnswer = () => {
        if (selected === null) return;
        const correct = selected === correctIndex;
        const answer: AttemptAnswer = { questionId: q.id, selectedIndex: selected, correct };
        const nextAnswers = [...answers, answer];
        setAnswers(nextAnswers);
        if (teach && q.explanation) {
            setPhase("revealed");
        } else {
            advance(nextAnswers);
        }
    };

    const advance = (currentAnswers: AttemptAnswer[]) => {
        if (index + 1 >= total) {
            setPhase("done");
            persist(currentAnswers);
        } else {
            setIndex((i) => i + 1);
            setSelected(null);
            setPhase("answering");
        }
    };

    const persist = async (finalAnswers: AttemptAnswer[]) => {
        const right = finalAnswers.filter((a) => a.correct).length;
        const finalScore = total ? Math.round((right / total) * 100) : 0;
        setSaving(true);
        const fd = new FormData();
        fd.set("quizId", quizId);
        fd.set("score", String(finalScore));
        fd.set("answers", JSON.stringify(finalAnswers));
        await runAction(() => saveQuizAttempt(fd), { ok: `Saved — ${finalScore}%`, onSuccess: () => router.refresh() });
        setSaving(false);
    };

    const restart = () => {
        setIndex(0);
        setSelected(null);
        setPhase("answering");
        setAnswers([]);
    };

    if (phase === "done") {
        const right = answers.filter((a) => a.correct).length;
        return (
            <div className="flex flex-col gap-5">
                <div className="flex flex-col items-center gap-2 rounded-xl bg-secondary p-6 text-center ring-1 ring-secondary ring-inset">
                    <p className="text-sm text-tertiary">Your score</p>
                    <p className={cx("text-display-md font-semibold", score >= 70 ? "text-success-primary" : score >= 40 ? "text-warning-primary" : "text-error-primary")}>{score}%</p>
                    <p className="text-sm text-tertiary">
                        {right} of {total} correct
                    </p>
                </div>

                <div className="flex flex-col gap-3">
                    <h3 className="text-md font-semibold text-primary">Review</h3>
                    {questions.map((rq, i) => {
                        const a = answers[i];
                        const ci = rq.choices.findIndex((c) => c.correct);
                        return (
                            <div key={rq.id} className="flex flex-col gap-2 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
                                <div className="flex items-start gap-2">
                                    {a?.correct ? (
                                        <CheckCircle className="mt-0.5 size-4 shrink-0 text-fg-success-primary" aria-hidden="true" />
                                    ) : (
                                        <XCircle className="mt-0.5 size-4 shrink-0 text-fg-error-primary" aria-hidden="true" />
                                    )}
                                    <div className="flex-1">
                                        <Markdown>{rq.prompt}</Markdown>
                                    </div>
                                </div>
                                <ul className="ml-6 flex flex-col gap-1">
                                    {rq.choices.map((c, idx) => {
                                        const isCorrect = idx === ci;
                                        const isChosen = a?.selectedIndex === idx;
                                        return (
                                            <li
                                                key={idx}
                                                className={cx(
                                                    "rounded-md px-2 py-1 text-sm",
                                                    isCorrect && "bg-success-primary text-success-primary",
                                                    !isCorrect && isChosen && "bg-error-primary text-error-primary",
                                                    !isCorrect && !isChosen && "text-tertiary",
                                                )}
                                            >
                                                {isCorrect ? "✓ " : isChosen ? "✗ " : "• "}
                                                {c.text}
                                            </li>
                                        );
                                    })}
                                </ul>
                                {rq.explanation && (
                                    <div className="ml-6 rounded-lg bg-secondary p-3 ring-1 ring-secondary ring-inset">
                                        <Markdown>{rq.explanation}</Markdown>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="flex justify-end gap-2">
                    <Button color="secondary" onClick={onExit} isDisabled={saving}>
                        Done
                    </Button>
                    <Button iconLeading={RefreshCw01} onClick={restart} isDisabled={saving}>
                        Retake
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-secondary">{title}</span>
                    <span className="text-tertiary">
                        Question {index + 1} of {total}
                    </span>
                </div>
                <ProgressBar value={index + (phase === "revealed" ? 1 : 0)} max={total} />
            </div>

            <div className="rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset">
                <Markdown>{q.prompt}</Markdown>
            </div>

            <div className="flex flex-col gap-2">
                {q.choices.map((c, idx) => {
                    const isSelected = selected === idx;
                    const revealed = phase === "revealed";
                    const isCorrect = idx === correctIndex;
                    return (
                        <button
                            key={idx}
                            type="button"
                            disabled={revealed}
                            onClick={() => setSelected(idx)}
                            className={cx(
                                "flex items-start gap-3 rounded-xl p-4 text-left ring-1 transition duration-100 ease-linear ring-inset",
                                !revealed && isSelected && "bg-brand-primary ring-brand",
                                !revealed && !isSelected && "bg-primary ring-secondary hover:bg-primary_hover hover:ring-primary",
                                revealed && isCorrect && "bg-success-primary ring-success",
                                revealed && !isCorrect && isSelected && "bg-error-primary ring-error",
                                revealed && !isCorrect && !isSelected && "bg-primary opacity-60 ring-secondary",
                            )}
                        >
                            <span
                                className={cx(
                                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset",
                                    !revealed && isSelected && "bg-brand-solid text-white ring-transparent",
                                    !revealed && !isSelected && "text-tertiary ring-primary",
                                    revealed && isCorrect && "bg-success-solid text-white ring-transparent",
                                    revealed && !isCorrect && isSelected && "bg-error-solid text-white ring-transparent",
                                    revealed && !isCorrect && !isSelected && "text-tertiary ring-primary",
                                )}
                            >
                                {String.fromCharCode(65 + idx)}
                            </span>
                            <div className="flex-1">
                                <Markdown>{c.text}</Markdown>
                            </div>
                        </button>
                    );
                })}
            </div>

            {phase === "revealed" && q.explanation && (
                <div className={cx("rounded-xl p-4 ring-1 ring-inset", selected === correctIndex ? "bg-success-primary ring-success" : "bg-secondary ring-secondary")}>
                    <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-primary">
                        {selected === correctIndex ? (
                            <CheckCircle className="size-4 text-fg-success-primary" aria-hidden="true" />
                        ) : (
                            <XCircle className="size-4 text-fg-error-primary" aria-hidden="true" />
                        )}
                        {selected === correctIndex ? "Correct" : "Not quite"}
                    </p>
                    <Markdown>{q.explanation}</Markdown>
                </div>
            )}

            <div className="flex items-center justify-between">
                <Button color="link-gray" onClick={onExit}>
                    Exit
                </Button>
                {phase === "answering" ? (
                    <Button iconTrailing={ArrowRight} onClick={submitAnswer} isDisabled={selected === null}>
                        {teach ? "Check answer" : index + 1 >= total ? "Finish" : "Next"}
                    </Button>
                ) : (
                    <Button iconTrailing={ArrowRight} onClick={() => advance(answers)} isLoading={saving}>
                        {index + 1 >= total ? "See results" : "Next question"}
                    </Button>
                )}
            </div>
        </div>
    );
}
