import { toast } from "sonner";

export interface ChoiceDraft {
    text: string;
    correct: boolean;
}
export interface QuestionDraft {
    /** Local id for React keys only — never sent to the server. */
    key: string;
    prompt: string;
    choices: ChoiceDraft[];
    explanation: string;
}

export interface PickerOption {
    id: string;
    label: string;
}

export interface CourseOption {
    id: string;
    title: string;
}

export function newChoice(correct = false): ChoiceDraft {
    return { text: "", correct };
}

export function newQuestion(): QuestionDraft {
    return {
        key: Math.random().toString(36).slice(2),
        prompt: "",
        choices: [newChoice(true), newChoice(false)],
        explanation: "",
    };
}

/** Strip the local `key` and drop empty/invalid questions before sending to the server. */
export function serializeQuestions(questions: QuestionDraft[]) {
    return questions
        .map((q) => ({
            prompt: q.prompt.trim(),
            choices: q.choices.map((c) => ({ text: c.text.trim(), correct: c.correct })).filter((c) => c.text),
            explanation: q.explanation.trim() || undefined,
        }))
        .filter((q) => q.prompt && q.choices.length >= 2 && q.choices.some((c) => c.correct));
}

/** Run a server action with a try/catch + toast. Returns true on success. */
export async function runAction<T>(
    fn: () => Promise<T>,
    { ok, onSuccess }: { ok?: string; onSuccess?: (result: T) => void } = {},
): Promise<boolean> {
    try {
        const result = await fn();
        if (ok) toast.success(ok);
        onSuccess?.(result);
        return true;
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        return false;
    }
}
