// @ts-nocheck
// Coretex — model capability resolver for the AI chat UI.
//
// The composer gates its controls (image attach, web search, reasoning effort) on
// what the selected model can actually do. Provider APIs are inconsistent about
// reporting this, so we resolve from the ModelInfo.capabilities array first and
// fall back to a small, conservative id/provider heuristic for reasoning (which is
// not yet a first-class ModelCapability). Everything defaults to false when the
// model is unknown, and this never throws.

import type { ModelInfo } from "@repo/coretex/types";

export interface ResolvedModelCaps {
    /** Model accepts image input (capabilities include "vision" or "image"). */
    vision: boolean;
    /** Model supports tool/function calling — used to gate the web-search toggle. */
    tools: boolean;
    /** Model has a reasoning/extended-thinking mode — used to gate the effort toggle. */
    reasoning: boolean;
    /** Max context window in tokens, when known. */
    contextLength?: number;
}

// Conservative reasoning heuristic: OpenAI o-series, gpt-5, and explicit
// extended-thinking / thinking model ids. Matches the spirit of the Brain's
// detectCapabilities without overreaching.
const REASONING_ID = /\bo1\b|\bo3\b|\bo4\b|o1-|o3-|o4-|gpt-?5|extended-?thinking|thinking|reasoner|deepseek-?r1|\bqwq\b/;

const has = (caps: ModelInfo["capabilities"], cap: string): boolean =>
    Array.isArray(caps) && caps.includes(cap as NonNullable<ModelInfo["capabilities"]>[number]);

/**
 * Resolve the UI-relevant capabilities of a model. Safe with an undefined model
 * (returns all-false). Never throws.
 */
export function modelCaps(model?: ModelInfo): ResolvedModelCaps {
    if (!model) return { vision: false, tools: false, reasoning: false };

    const caps = model.capabilities;
    const id = (model.id ?? "").toLowerCase();

    const vision = has(caps, "vision") || has(caps, "image");
    const tools = has(caps, "tools");

    // Reasoning isn't a declared ModelCapability, so derive it: a forward-compatible
    // capability marker if a provider ever sets one, OR the id/provider heuristic.
    const reasoning =
        has(caps, "reasoning") ||
        has(caps, "thinking") ||
        REASONING_ID.test(id) ||
        (model.provider === "gemini" && /thinking/.test(id));

    return {
        vision,
        tools,
        reasoning,
        contextLength: typeof model.contextLength === "number" ? model.contextLength : undefined,
    };
}
