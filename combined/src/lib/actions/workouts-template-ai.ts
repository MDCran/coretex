"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConfigured, runClaude } from "@/lib/ai/claude";

/**
 * AI workout-template generator.
 *
 * Schema-constrained, hallucination-proof (mirrors generateMoodPlaylist in
 * spotify.ts): we gather the user's exercises as candidates, hand the model ONLY
 * their ids, force a strict JSON schema, then DROP any returned exerciseId that
 * isn't in the candidate set. The persisted Template is written through the same
 * Prisma shape as createTemplate in workouts-templates.ts.
 */

/** Cap how many exercises we send to the model (keeps the prompt bounded). */
const CANDIDATE_CAP = 600;

interface AiTemplateResult {
    name: string;
    description?: string;
    exercises: Array<{
        exerciseId: string;
        sets?: number;
        reps?: number;
        restSeconds?: number;
    }>;
}

const TEMPLATE_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        name: { type: "string", description: "A short, descriptive template name (max ~40 chars)." },
        description: { type: "string", description: "A one-sentence note describing the template's focus." },
        exercises: {
            type: "array",
            description: "The ordered exercises for this workout, chosen ONLY from the provided candidate list.",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    exerciseId: {
                        type: "string",
                        description: "An exercise id copied VERBATIM from a candidate. Never invent ids.",
                    },
                    sets: { type: "integer", description: "Target number of working sets (1-10).", minimum: 1, maximum: 10 },
                    reps: { type: "integer", description: "Target reps per set (1-50).", minimum: 1, maximum: 50 },
                    restSeconds: { type: "integer", description: "Rest between sets in seconds (0-600).", minimum: 0, maximum: 600 },
                },
                required: ["exerciseId", "sets", "reps"],
            },
        },
    },
    required: ["name", "exercises"],
};

const TEMPLATE_SYSTEM = `You are an expert strength & conditioning coach building a single reusable workout template.
You will receive the user's request and a list of candidate exercises (each with an id, name, primary muscle/category, and equipment).
Design a coherent, well-ordered workout (compounds first, then accessories) that fits the request, choosing 4-8 exercises with sensible sets, reps, and rest.
CRITICAL: only output exerciseId values that appear VERBATIM in the candidate list — never invent exercises or ids.`;

export async function generateAiTemplate(input: { prompt: string }): Promise<{ id: string }> {
    const user = await requireUser();
    const prompt = input.prompt?.trim();
    if (!prompt) throw new Error("Describe the workout you want first.");
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    // Gather the user's exercise candidates (their own + global catalog), excluding archived.
    const candidateExercises = await db.exercise.findMany({
        where: {
            archived: false,
            OR: [{ userId: user.id }, { userId: null }],
        },
        select: { id: true, name: true, muscles: true, category: true, equipment: true },
        orderBy: { name: "asc" },
        take: CANDIDATE_CAP,
    });

    if (candidateExercises.length === 0) {
        throw new Error("You have no exercises to build from. Add some exercises first.");
    }

    const candidateIds = new Set(candidateExercises.map((e) => e.id));

    const candidateLines = candidateExercises
        .map((e) => {
            const muscle = e.muscles[0] ?? e.category ?? "general";
            const gear = e.equipment.length > 0 ? ` [${e.equipment.join(", ")}]` : "";
            return `${e.id} | ${e.name} — ${muscle}${gear}`;
        })
        .join("\n");

    const content = `User request: "${prompt}".

Candidate exercises (id | name — primary muscle/category [equipment]):
${candidateLines}

Build one workout template that fits the request. Pick 4-8 exercises by their ids (verbatim), set target sets/reps, and rest where appropriate. Return a name, a short description, and the exercise list in performance order.`;

    const result = await runClaude<AiTemplateResult>({
        purpose: "workout-template-generate",
        userId: user.id,
        system: TEMPLATE_SYSTEM,
        content,
        schema: TEMPLATE_SCHEMA,
        maxTokens: 4000,
    });

    // Drop any hallucinated ids; de-dupe while preserving model order.
    const seen = new Set<string>();
    const chosen = result.data.exercises.filter((ex) => {
        if (!ex || typeof ex.exerciseId !== "string") return false;
        if (!candidateIds.has(ex.exerciseId) || seen.has(ex.exerciseId)) return false;
        seen.add(ex.exerciseId);
        return true;
    });

    if (chosen.length === 0) {
        throw new Error("The AI didn't pick any exercises from your library. Try rephrasing your request.");
    }

    // Persist via the same Prisma shape as createTemplate / writeExercises.
    const template = await db.template.create({
        data: {
            userId: user.id,
            name: result.data.name?.trim() || "AI workout",
            note: result.data.description?.trim() || null,
            progression: "NONE",
        },
    });

    for (let i = 0; i < chosen.length; i++) {
        const ex = chosen[i];
        await db.templateExercise.create({
            data: {
                templateId: template.id,
                exerciseId: ex.exerciseId,
                order: i,
                targetSets: typeof ex.sets === "number" ? ex.sets : null,
                targetReps: typeof ex.reps === "number" ? ex.reps : null,
                restSec: typeof ex.restSeconds === "number" ? ex.restSeconds : null,
            },
        });
    }

    revalidatePath("/workouts/templates");
    return { id: template.id };
}
