"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb02, MessageTextSquare02, Plus, Stars02 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Field, NativeInput, NativeTextarea } from "../../_components/learning-ui";
import { FormModal } from "../../_components/form-modal";
import { runAction } from "../_components/quiz-shared";
import { aiAddQuestions, aiFillExplanations, aiRewriteQuestion } from "@/lib/actions/learning-quizzes";

interface AiAssistProps {
    quizId: string;
    hasMissingExplanations: boolean;
}

/** AI assist actions on a quiz detail: add N questions, fill explanations. */
export function AiAssist({ quizId, hasMissingExplanations }: AiAssistProps) {
    const router = useRouter();
    const [addOpen, setAddOpen] = useState(false);
    const [count, setCount] = useState(5);
    const [busy, setBusy] = useState<"add" | "fill" | null>(null);

    const addQuestions = async () => {
        setBusy("add");
        const fd = new FormData();
        fd.set("quizId", quizId);
        fd.set("count", String(count));
        await runAction(() => aiAddQuestions(fd), {
            ok: "Questions added",
            onSuccess: (r) => {
                setAddOpen(false);
                if (r?.added) router.refresh();
            },
        });
        setBusy(null);
    };

    const fillExplanations = async () => {
        setBusy("fill");
        const fd = new FormData();
        fd.set("quizId", quizId);
        await runAction(() => aiFillExplanations(fd), {
            ok: "Explanations filled",
            onSuccess: () => router.refresh(),
        });
        setBusy(null);
    };

    return (
        <>
            <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => setAddOpen(true)} isDisabled={busy !== null}>
                Add questions
            </Button>
            {hasMissingExplanations && (
                <Button size="sm" color="secondary" iconLeading={Lightbulb02} onClick={fillExplanations} isLoading={busy === "fill"}>
                    Fill explanations
                </Button>
            )}

            <FormModal isOpen={addOpen} onOpenChange={setAddOpen} title="Add questions with AI" description="Claude writes new questions, avoiding duplicates of what you already have.">
                <div className="flex flex-col gap-4">
                    <Field label="How many?" htmlFor="ai-add-count">
                        <NativeInput id="ai-add-count" type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.min(20, Math.max(1, Number(e.target.value) || 5)))} />
                    </Field>
                    <div className="flex justify-end gap-2">
                        <Button color="secondary" onClick={() => setAddOpen(false)}>
                            Cancel
                        </Button>
                        <Button iconLeading={Stars02} onClick={addQuestions} isLoading={busy === "add"}>
                            Generate
                        </Button>
                    </div>
                </div>
            </FormModal>
        </>
    );
}

interface RewriteButtonProps {
    questionId: string;
}

/** Per-question AI rewrite ("make this harder", free-text instruction). */
export function RewriteButton({ questionId }: RewriteButtonProps) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [instruction, setInstruction] = useState("");
    const [busy, setBusy] = useState(false);

    const rewrite = async () => {
        if (!instruction.trim()) return;
        setBusy(true);
        const fd = new FormData();
        fd.set("questionId", questionId);
        fd.set("instruction", instruction.trim());
        const ok = await runAction(() => aiRewriteQuestion(fd), {
            ok: "Question rewritten",
            onSuccess: () => {
                setOpen(false);
                setInstruction("");
                router.refresh();
            },
        });
        setBusy(ok ? false : false);
    };

    return (
        <>
            <Button size="sm" color="tertiary" iconLeading={MessageTextSquare02} aria-label="AI rewrite this question" onClick={() => setOpen(true)} />
            <FormModal isOpen={open} onOpenChange={setOpen} title="AI rewrite question" description="Tell Claude how to adjust this question.">
                <div className="flex flex-col gap-4">
                    <Field label="Instruction" htmlFor="ai-rewrite">
                        <NativeTextarea
                            id="ai-rewrite"
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            placeholder="e.g. Make this harder, add a code snippet, fix the wording…"
                            rows={3}
                        />
                    </Field>
                    <div className="flex justify-end gap-2">
                        <Button color="secondary" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button iconLeading={Stars02} onClick={rewrite} isLoading={busy} isDisabled={!instruction.trim()}>
                            Rewrite
                        </Button>
                    </div>
                </div>
            </FormModal>
        </>
    );
}
