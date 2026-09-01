"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConfigured, runClaude } from "@/lib/ai/claude";
import { num, str } from "./health-shared";

/**
 * Quiz builder + AI ("AI quiz & teach") server actions for the Learning module.
 *
 * Covers manual quiz/question CRUD with rich-markdown content, linking to the
 * user's flashcards/notes/course, interactive take-flow attempts (with per-question
 * answers stored as JSON), and Claude-backed generation / extension / rewriting /
 * explanation-filling. All AI calls are schema-constrained via runClaude and emit
 * markdown so the take-flow can render code blocks, quotes, links and tables.
 */

// ── Shared shapes ────────────────────────────────────────────

export interface QuizChoice {
    text: string; // markdown
    correct: boolean;
}
export interface QuizQuestionInput {
    prompt: string; // markdown
    choices: QuizChoice[];
    explanation?: string | null; // markdown
}
export interface QuizLinks {
    flashcardIds: string[];
    noteIds: string[];
}

function rl(...paths: string[]) {
    for (const p of paths) revalidatePath(p);
    revalidatePath("/learning/quizzes");
    revalidatePath("/learning");
}

/** Normalise a links object from arbitrary input. */
function normalizeLinks(value: unknown): QuizLinks {
    const v = (value ?? {}) as Record<string, unknown>;
    const ids = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    return { flashcardIds: ids(v.flashcardIds), noteIds: ids(v.noteIds) };
}

/** Sanitise a single AI/manual question into a storable shape. */
function cleanQuestion(q: unknown): QuizQuestionInput | null {
    if (!q || typeof q !== "object") return null;
    const o = q as Record<string, unknown>;
    const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
    if (!prompt) return null;
    const rawChoices = Array.isArray(o.choices) ? o.choices : [];
    const choices: QuizChoice[] = rawChoices
        .map((c) => {
            const co = (c ?? {}) as Record<string, unknown>;
            const text = typeof co.text === "string" ? co.text.trim() : "";
            return text ? { text, correct: co.correct === true } : null;
        })
        .filter((c): c is QuizChoice => c !== null)
        .slice(0, 6);
    if (choices.length < 2) return null;
    // Guarantee exactly one correct answer survives.
    if (!choices.some((c) => c.correct)) choices[0].correct = true;
    const explanation = typeof o.explanation === "string" && o.explanation.trim() ? o.explanation.trim() : null;
    return { prompt, choices, explanation };
}

/** Parse the JSON `questions` field a client form submits for the manual editor. */
function parseQuestionsField(fd: FormData): QuizQuestionInput[] {
    const raw = str(fd, "questions");
    if (!raw) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error("Could not read the quiz questions.");
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.map(cleanQuestion).filter((q): q is QuizQuestionInput => q !== null);
}

/** Parse the JSON `links` field, returning a normalised links object. */
function parseLinksField(fd: FormData): QuizLinks {
    const raw = str(fd, "links");
    if (!raw) return { flashcardIds: [], noteIds: [] };
    try {
        return normalizeLinks(JSON.parse(raw));
    } catch {
        return { flashcardIds: [], noteIds: [] };
    }
}

/** Replace all questions of a quiz with the provided set (ordered). */
async function replaceQuestions(quizId: string, questions: QuizQuestionInput[]) {
    await db.quizQuestion.deleteMany({ where: { quizId } });
    if (questions.length === 0) return;
    await db.quizQuestion.createMany({
        data: questions.map((q, i) => ({
            quizId,
            order: i,
            prompt: q.prompt,
            choices: q.choices as unknown as object,
            explanation: q.explanation ?? null,
        })),
    });
}

async function assertQuizOwner(id: string, userId: string) {
    const owned = await db.quiz.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error("Quiz not found");
    return owned;
}

// ── Manual quiz CRUD ─────────────────────────────────────────

export async function createQuizFull(fd: FormData): Promise<{ id: string }> {
    const user = await requireUser();
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    const links = parseLinksField(fd);
    const questions = parseQuestionsField(fd);

    const quiz = await db.quiz.create({
        data: {
            userId: user.id,
            title,
            description: str(fd, "description"),
            topic: str(fd, "topic"),
            courseId: str(fd, "courseId"),
            aiTeach: fd.get("aiTeach") === "true" || fd.get("aiTeach") === "on",
            aiGenerated: fd.get("aiGenerated") === "true",
            links: links as unknown as object,
        },
    });
    if (questions.length) await replaceQuestions(quiz.id, questions);
    rl();
    return { id: quiz.id };
}

export async function updateQuizFull(fd: FormData): Promise<{ id: string }> {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await assertQuizOwner(id, user.id);
    const links = parseLinksField(fd);

    await db.quiz.update({
        where: { id },
        data: {
            title: str(fd, "title") ?? undefined,
            description: str(fd, "description"),
            topic: str(fd, "topic"),
            courseId: str(fd, "courseId"),
            aiTeach: fd.get("aiTeach") === "true" || fd.get("aiTeach") === "on",
            links: links as unknown as object,
        },
    });

    // Only replace questions when the form actually carried them (full builder save).
    if (fd.has("questions")) {
        await replaceQuestions(id, parseQuestionsField(fd));
    }
    rl(`/learning/quizzes/${id}`);
    return { id };
}

export async function deleteQuizFull(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.quiz.deleteMany({ where: { id, userId: user.id } });
    rl();
}

// ── Attempts (interactive take-flow) ─────────────────────────

export interface AttemptAnswer {
    questionId: string;
    selectedIndex: number;
    correct: boolean;
}

export async function saveQuizAttempt(fd: FormData) {
    const user = await requireUser();
    const quizId = str(fd, "quizId");
    if (!quizId) throw new Error("Missing quiz");
    await assertQuizOwner(quizId, user.id);

    const score = num(fd, "score");
    let answers: AttemptAnswer[] = [];
    const rawAnswers = str(fd, "answers");
    if (rawAnswers) {
        try {
            const parsed = JSON.parse(rawAnswers);
            if (Array.isArray(parsed)) {
                answers = parsed
                    .map((a) => {
                        const o = (a ?? {}) as Record<string, unknown>;
                        if (typeof o.questionId !== "string") return null;
                        return {
                            questionId: o.questionId,
                            selectedIndex: typeof o.selectedIndex === "number" ? o.selectedIndex : -1,
                            correct: o.correct === true,
                        };
                    })
                    .filter((a): a is AttemptAnswer => a !== null);
            }
        } catch {
            /* ignore malformed answers — still save the score */
        }
    }

    await db.quizAttempt.create({
        data: { quizId, score, answers: answers as unknown as object },
    });
    rl(`/learning/quizzes/${quizId}`);
}

/** Legacy manual score logging (kept for quizzes without questions). */
export async function logQuizScore(fd: FormData) {
    const user = await requireUser();
    const quizId = str(fd, "quizId");
    if (!quizId) throw new Error("Missing quiz");
    await assertQuizOwner(quizId, user.id);
    await db.quizAttempt.create({ data: { quizId, score: num(fd, "score") } });
    rl(`/learning/quizzes/${quizId}`);
}

export async function deleteQuizAttempt(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const attempt = await db.quizAttempt.findFirst({ where: { id, quiz: { userId: user.id } }, select: { quizId: true } });
    if (!attempt) throw new Error("Attempt not found");
    await db.quizAttempt.delete({ where: { id } });
    rl(`/learning/quizzes/${attempt.quizId}`);
}

// ── AI: schema + prompts ─────────────────────────────────────

const QUESTION_ITEM_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        prompt: { type: "string", description: "The question, in GitHub-flavored markdown. Use fenced code blocks for code, blockquotes for cited passages, and links where helpful." },
        choices: {
            type: "array",
            description: "Between 2 and 6 answer choices. Exactly one must be correct.",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    text: { type: "string", description: "Choice text in markdown (inline code allowed)." },
                    correct: { type: "boolean", description: "True for the single correct choice." },
                },
                required: ["text", "correct"],
            },
        },
        explanation: { type: "string", description: "A teaching explanation in markdown of why the correct answer is right and the others are wrong." },
    },
    required: ["prompt", "choices", "explanation"],
} as const;

const QUIZ_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        title: { type: "string", description: "A concise, specific quiz title." },
        description: { type: "string", description: "One-sentence description of what the quiz covers." },
        questions: { type: "array", items: QUESTION_ITEM_SCHEMA },
    },
    required: ["title", "description", "questions"],
};

const QUESTIONS_ONLY_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: { questions: { type: "array", items: QUESTION_ITEM_SCHEMA } },
    required: ["questions"],
};

const SINGLE_QUESTION_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: QUESTION_ITEM_SCHEMA.properties,
    required: ["prompt", "choices", "explanation"],
};

const SYSTEM_PROMPT = `You are an expert quiz author and teacher who writes rigorous, fair multiple-choice questions.
Rules:
- Each question has 2-6 choices with EXACTLY ONE correct answer. Make distractors plausible, not throwaway.
- Vary difficulty and cover the topic broadly; never repeat a question already provided as context.
- Write prompts, choices and explanations in GitHub-flavored markdown.
- For technical topics, prefer fenced code blocks (\`\`\`lang) in prompts and inline code in choices.
- Use blockquotes for quoted passages and markdown links when referencing standards/docs.
- Explanations should TEACH: state why the correct answer is right and briefly why each wrong option is wrong.
- Return ONLY data matching the provided JSON schema.`;

interface QuizGenResult {
    title?: string;
    description?: string;
    questions?: unknown[];
}

function cleanQuestionList(value: unknown): QuizQuestionInput[] {
    if (!Array.isArray(value)) return [];
    return value.map(cleanQuestion).filter((q): q is QuizQuestionInput => q !== null);
}

/** Build a context block from linked flashcards / notes / course for grounded generation. */
async function buildLinkContext(userId: string, links: QuizLinks, courseId: string | null): Promise<string> {
    const parts: string[] = [];
    if (courseId) {
        const course = await db.learningCourse.findFirst({
            where: { id: courseId, userId },
            select: { title: true, description: true, lessons: { select: { title: true }, orderBy: { order: "asc" } } },
        });
        if (course) {
            parts.push(`COURSE: ${course.title}${course.description ? `\n${course.description}` : ""}`);
            if (course.lessons.length) parts.push(`Lessons: ${course.lessons.map((l) => l.title).join(", ")}`);
        }
    }
    if (links.flashcardIds.length) {
        const cards = await db.flashcard.findMany({
            where: { id: { in: links.flashcardIds }, userId },
            select: { front: true, back: true },
        });
        if (cards.length) parts.push("FLASHCARDS:\n" + cards.map((c) => `- Q: ${c.front}\n  A: ${c.back}`).join("\n"));
    }
    if (links.noteIds.length) {
        const notes = await db.learningNote.findMany({
            where: { id: { in: links.noteIds }, userId },
            select: { title: true, content: true },
        });
        if (notes.length) parts.push("NOTES:\n" + notes.map((n) => `### ${n.title}\n${n.content ?? ""}`).join("\n\n"));
    }
    return parts.join("\n\n");
}

function aiModelFor(settings: { aiModel: string | null } | null): string | undefined {
    return settings?.aiModel ?? undefined;
}

// ── AI: generate a brand-new quiz (preview, not yet saved) ───

export interface GeneratedQuiz {
    title: string;
    description: string | null;
    questions: QuizQuestionInput[];
}

export async function generateQuiz(fd: FormData): Promise<GeneratedQuiz> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const topic = str(fd, "topic");
    if (!topic) throw new Error("Enter a topic to generate from.");
    const count = Math.min(20, Math.max(5, num(fd, "count") ?? 8));
    const difficulty = str(fd, "difficulty") ?? "mixed";
    const tone = str(fd, "tone");

    // Optional grounding from linked content / course.
    const links = parseLinksField(fd);
    const courseId = str(fd, "courseId");
    const context = await buildLinkContext(user.id, links, courseId);

    const settings = await db.settings.findUnique({ where: { userId: user.id }, select: { aiModel: true } });

    let content = `Create a ${count}-question multiple-choice quiz on: "${topic}".\nDifficulty: ${difficulty}.`;
    if (tone) content += `\nTone: ${tone}.`;
    if (context) content += `\n\nBase the questions on this material where relevant:\n\n${context}`;

    const { data } = await runClaude<QuizGenResult>({
        purpose: "quiz-generate",
        userId: user.id,
        system: SYSTEM_PROMPT,
        model: aiModelFor(settings),
        schema: QUIZ_SCHEMA,
        content,
    });

    const questions = cleanQuestionList(data.questions);
    if (questions.length === 0) throw new Error("The AI did not return any usable questions. Try again.");

    return {
        title: (data.title ?? topic).trim() || topic,
        description: data.description?.trim() ?? null,
        questions,
    };
}

/** Persist a previewed AI-generated quiz. */
export async function saveGeneratedQuiz(fd: FormData): Promise<{ id: string }> {
    const user = await requireUser();
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    const questions = parseQuestionsField(fd);
    if (questions.length === 0) throw new Error("No questions to save.");
    const links = parseLinksField(fd);

    const quiz = await db.quiz.create({
        data: {
            userId: user.id,
            title,
            description: str(fd, "description"),
            topic: str(fd, "topic"),
            courseId: str(fd, "courseId"),
            aiGenerated: true,
            aiTeach: fd.get("aiTeach") === "true" || fd.get("aiTeach") === "on",
            links: links as unknown as object,
        },
    });
    await replaceQuestions(quiz.id, questions);
    rl();
    return { id: quiz.id };
}

// ── AI: extend / rewrite / fill explanations on an existing quiz ─

async function loadQuizForAi(quizId: string, userId: string) {
    const quiz = await db.quiz.findFirst({
        where: { id: quizId, userId },
        include: { questions: { orderBy: { order: "asc" } } },
    });
    if (!quiz) throw new Error("Quiz not found");
    return quiz;
}

function existingQuestionsBlock(questions: { prompt: string }[]): string {
    if (!questions.length) return "";
    return "EXISTING QUESTIONS (do NOT duplicate these):\n" + questions.map((q, i) => `${i + 1}. ${q.prompt}`).join("\n");
}

/** Add N more questions to a quiz, avoiding duplicates. Appends + returns new count. */
export async function aiAddQuestions(fd: FormData): Promise<{ added: number }> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");
    const quizId = str(fd, "quizId");
    if (!quizId) throw new Error("Missing quiz");
    const quiz = await loadQuizForAi(quizId, user.id);
    const count = Math.min(20, Math.max(1, num(fd, "count") ?? 5));

    const links = normalizeLinks(quiz.links);
    const context = await buildLinkContext(user.id, links, quiz.courseId);
    const settings = await db.settings.findUnique({ where: { userId: user.id }, select: { aiModel: true } });

    let content = `Add ${count} NEW multiple-choice questions to a quiz titled "${quiz.title}"`;
    if (quiz.topic) content += ` on the topic "${quiz.topic}"`;
    content += ".\n\n" + existingQuestionsBlock(quiz.questions);
    if (context) content += `\n\nReference material:\n\n${context}`;

    const { data } = await runClaude<{ questions?: unknown[] }>({
        purpose: "quiz-extend",
        userId: user.id,
        system: SYSTEM_PROMPT,
        model: aiModelFor(settings),
        schema: QUESTIONS_ONLY_SCHEMA,
        content,
    });

    const newQuestions = cleanQuestionList(data.questions);
    if (newQuestions.length === 0) throw new Error("The AI did not return any new questions.");

    const base = quiz.questions.length;
    await db.quizQuestion.createMany({
        data: newQuestions.map((q, i) => ({
            quizId,
            order: base + i,
            prompt: q.prompt,
            choices: q.choices as unknown as object,
            explanation: q.explanation ?? null,
        })),
    });
    rl(`/learning/quizzes/${quizId}`);
    return { added: newQuestions.length };
}

/** Rewrite/adjust a single question per a free-text instruction (e.g. "make this harder"). */
export async function aiRewriteQuestion(fd: FormData): Promise<{ ok: true }> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");
    const questionId = str(fd, "questionId");
    const instruction = str(fd, "instruction");
    if (!questionId) throw new Error("Missing question");
    if (!instruction) throw new Error("Enter an instruction.");

    const question = await db.quizQuestion.findFirst({
        where: { id: questionId, quiz: { userId: user.id } },
        include: { quiz: { select: { id: true, title: true, topic: true } } },
    });
    if (!question) throw new Error("Question not found");

    const settings = await db.settings.findUnique({ where: { userId: user.id }, select: { aiModel: true } });
    const current = {
        prompt: question.prompt,
        choices: question.choices,
        explanation: question.explanation,
    };

    const content = `Rewrite this multiple-choice question for the quiz "${question.quiz.title}"${question.quiz.topic ? ` (topic: ${question.quiz.topic})` : ""}.
Instruction: ${instruction}

Current question (JSON):
${JSON.stringify(current, null, 2)}

Keep it a single multiple-choice question with exactly one correct answer. Return the full rewritten question.`;

    const { data } = await runClaude<unknown>({
        purpose: "quiz-rewrite",
        userId: user.id,
        system: SYSTEM_PROMPT,
        model: aiModelFor(settings),
        schema: SINGLE_QUESTION_SCHEMA,
        content,
    });

    const cleaned = cleanQuestion(data);
    if (!cleaned) throw new Error("The AI returned an invalid question.");

    await db.quizQuestion.update({
        where: { id: questionId },
        data: {
            prompt: cleaned.prompt,
            choices: cleaned.choices as unknown as object,
            explanation: cleaned.explanation ?? null,
        },
    });
    rl(`/learning/quizzes/${question.quiz.id}`);
    return { ok: true };
}

/** Fill in explanations for every question missing one. */
export async function aiFillExplanations(fd: FormData): Promise<{ filled: number }> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");
    const quizId = str(fd, "quizId");
    if (!quizId) throw new Error("Missing quiz");
    const quiz = await loadQuizForAi(quizId, user.id);

    const missing = quiz.questions.filter((q) => !q.explanation || !q.explanation.trim());
    if (missing.length === 0) return { filled: 0 };

    const settings = await db.settings.findUnique({ where: { userId: user.id }, select: { aiModel: true } });

    const schema: Record<string, unknown> = {
        type: "object",
        additionalProperties: false,
        properties: {
            explanations: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        index: { type: "number", description: "0-based index of the question this explanation is for." },
                        explanation: { type: "string", description: "Teaching explanation in markdown." },
                    },
                    required: ["index", "explanation"],
                },
            },
        },
        required: ["explanations"],
    };

    const list = missing
        .map((q, i) => `Question ${i}:\nPrompt: ${q.prompt}\nChoices: ${JSON.stringify(q.choices)}`)
        .join("\n\n");
    const content = `Write a teaching explanation (markdown) for each of these multiple-choice questions. Index them 0-based as given.\n\n${list}`;

    const { data } = await runClaude<{ explanations?: { index: number; explanation: string }[] }>({
        purpose: "quiz-explanations",
        userId: user.id,
        system: SYSTEM_PROMPT,
        model: aiModelFor(settings),
        schema,
        content,
    });

    const byIndex = new Map<number, string>();
    for (const e of data.explanations ?? []) {
        if (typeof e?.index === "number" && typeof e?.explanation === "string" && e.explanation.trim()) {
            byIndex.set(e.index, e.explanation.trim());
        }
    }

    let filled = 0;
    await Promise.all(
        missing.map((q, i) => {
            const explanation = byIndex.get(i);
            if (!explanation) return Promise.resolve();
            filled++;
            return db.quizQuestion.update({ where: { id: q.id }, data: { explanation } });
        }),
    );
    rl(`/learning/quizzes/${quizId}`);
    return { filled };
}
