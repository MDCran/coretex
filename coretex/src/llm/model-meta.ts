// Coretex — model capability detection + display helpers. Provider model APIs rarely
// say what a model can do, so we derive capabilities from the id/family. Used to
// filter pickers (agents/chat need "chat"; RAG needs "embedding") and to label models.

import type { ModelCapability, ProviderType } from "../types.js";

/** Best-effort capability set from a model id + provider. Errs toward "chat". */
export function detectCapabilities(provider: ProviderType, id: string): ModelCapability[] {
    const s = id.toLowerCase();
    const caps = new Set<ModelCapability>();

    // Embeddings (no chat).
    if (/embed|embedding|bge|e5|nomic-embed|text-embedding|gte/.test(s)) {
        caps.add("embedding");
        return [...caps];
    }
    // Image generation (no chat).
    if (/dall-e|dalle|stable-diffusion|sdxl|flux|image-1|gpt-image/.test(s)) {
        caps.add("image");
        return [...caps];
    }
    // Audio / speech / transcription.
    if (/whisper|tts|audio|speech|transcribe|voice/.test(s)) {
        caps.add("audio");
        return [...caps];
    }

    // Otherwise it's a chat model.
    caps.add("chat");
    // Vision: model families known to accept images.
    if (/vision|llava|llama-?3\.2|llama4|qwen2?-?vl|qwen2\.5-?vl|gemma3|gpt-4o|gpt-4\.1|gpt-5|o1|o3|o4|claude|gemini|pixtral|moondream|minicpm-?v/.test(s)) {
        caps.add("vision");
    }
    // Tools / function-calling: cloud + most modern local instruct models.
    if (provider !== "ollama" && provider !== "lmstudio") caps.add("tools");
    if (/llama3|llama-?3|qwen2|qwen2\.5|qwen3|mistral|mixtral|firefunction|command-?r|hermes|functionary/.test(s)) caps.add("tools");
    return [...caps];
}

type Price = { inputPer1M?: number; outputPer1M?: number; cacheReadPer1M?: number; cacheWritePer1M?: number; embeddingPer1M?: number };
const r2 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Derive cache + embedding prices from the base input/output price using each provider's
 * DOCUMENTED ratio (not fabricated): Anthropic prompt cache = 0.1× read / 1.25× write of
 * input; OpenAI cached input = 0.5× input; embedding models price embeddings at the input rate.
 */
export function enrichPricing(provider: ProviderType, base: Price | undefined, caps: ModelCapability[]): Price | undefined {
    if (!base) return base;
    const out: Price = { ...base };
    const input = base.inputPer1M;
    if (input != null) {
        if (provider === "anthropic") {
            out.cacheReadPer1M = r2(input * 0.1);
            out.cacheWritePer1M = r2(input * 1.25);
        } else if (provider === "openai") {
            out.cacheReadPer1M = r2(input * 0.5);
        }
    }
    if (caps.includes("embedding") && input != null) out.embeddingPer1M = input;
    return out;
}

/** Family bucket from a model id (llama/qwen/gpt/claude/…). */
export function detectFamily(id: string): string | undefined {
    const s = id.toLowerCase();
    const m = s.match(/llama|qwen|mistral|mixtral|gemma|gemini|phi|deepseek|gpt|claude|command-?r|dolphin|hermes|yi|codestral|nomic|bge|whisper|grok/);
    return m ? m[0].replace("-r", "") : undefined;
}
