// @ts-nocheck
// Coretex — model / agent "strengths" heuristic. A pure, dependency-free classifier
// that answers "what is this agent good at?" from its role + model, so the Agents
// roster can group, filter, and route work by capability (coding / writing / …).
// No backend call — this is a presentation-layer heuristic over data we already have.

import type { BadgeColor } from "@repo/coretex/types";
import {
    Code02,
    Lightbulb02,
    PenTool02,
    SearchLg,
    BarChartSquare02,
    Image01,
    Tool02,
    Zap,
    CpuChip01,
} from "@untitledui/icons";

export type StrengthKey =
    | "coding"
    | "reasoning"
    | "writing"
    | "research"
    | "analysis"
    | "vision"
    | "automation"
    | "fast"
    | "local";

export interface StrengthMeta {
    key: StrengthKey;
    label: string;
    /** Untitled UI badge color token. */
    color: BadgeColor;
    icon: typeof Code02;
    /** One-line explanation shown in tooltips + the capability filter. */
    hint: string;
}

// Canonical display order (also used to trim a long strength list down to the top few).
export const STRENGTH_ORDER: StrengthKey[] = [
    "coding",
    "reasoning",
    "writing",
    "research",
    "analysis",
    "vision",
    "automation",
    "fast",
    "local",
];

export const STRENGTHS: Record<StrengthKey, StrengthMeta> = {
    coding: { key: "coding", label: "Coding", color: "indigo", icon: Code02, hint: "Writes, edits, and reviews code" },
    reasoning: { key: "reasoning", label: "Reasoning", color: "purple", icon: Lightbulb02, hint: "Deep, step-by-step problem solving" },
    writing: { key: "writing", label: "Writing", color: "pink", icon: PenTool02, hint: "Long-form drafting and copy" },
    research: { key: "research", label: "Research", color: "blue", icon: SearchLg, hint: "Gathers and synthesizes information" },
    analysis: { key: "analysis", label: "Analysis", color: "sky", icon: BarChartSquare02, hint: "Data, metrics, and structured thinking" },
    vision: { key: "vision", label: "Vision", color: "orange", icon: Image01, hint: "Understands images and screenshots" },
    automation: { key: "automation", label: "Automation", color: "warning", icon: Tool02, hint: "Tools, shell, and workflows" },
    fast: { key: "fast", label: "Fast", color: "success", icon: Zap, hint: "Quick, low-latency responses" },
    local: { key: "local", label: "Local", color: "gray", icon: CpuChip01, hint: "Runs privately on your machine" },
};

const ROLE_STRENGTHS: Record<string, StrengthKey[]> = {
    orchestrator: ["reasoning"],
    planner: ["reasoning"],
    researcher: ["research"],
    developer: ["coding"],
    reviewer: ["coding", "reasoning"],
    writer: ["writing"],
    analyst: ["analysis"],
    devops: ["automation"],
    qa: ["automation"],
    custom: [],
};

const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "openclaw"]);

const RE_CODING = /cod(e|er|ing)|codestral|starcoder|deepseek[-_ ]?coder|qwen.*cod|codellama|codex|granite[-_ ]?code/;
const RE_REASONING = /opus|sonnet|gpt-?4|gpt-?5|o1|o3|o4|deepseek[-_ ]?r1|\br1\b|qwq|reason|think|magistral|grok/;
const RE_VISION = /vision|vl\b|llava|gpt-?4o|omni|gemini|pixtral|qwen.*vl|internvl|moondream|minicpm-?v|phi.*vision/;
const RE_WRITING = /claude|gpt-?4|gpt-?5|opus|sonnet|gemini|mistral[-_ ]?large|command[-_ ]?r|llama-?3|qwen2?\.?5|nemotron/;
const RE_FAST = /mini|nano|haiku|flash|lite|turbo|small|1\.5b|0\.5b|\b1b\b|\b3b\b|\b7b\b|\b8b\b|tiny|gemma-?2b|phi-?3/;

/** Input shape — an AgentConfig-ish object, or anything with role/provider/model. */
export interface StrengthInput {
    role?: string;
    provider?: string;
    model?: string;
    capabilities?: string[];
}

/**
 * Classify what an agent/model is good at. Combines its role (baseline intent) with
 * heuristics over the model id/family and any known capability flags. Deterministic,
 * deduped, and ordered by STRENGTH_ORDER.
 */
export function agentStrengths(input: StrengthInput): StrengthKey[] {
    const set = new Set<StrengthKey>();
    for (const k of ROLE_STRENGTHS[input.role ?? "custom"] ?? []) set.add(k);

    const hay = `${input.model ?? ""}`.toLowerCase();
    if (RE_CODING.test(hay)) set.add("coding");
    if (RE_REASONING.test(hay)) set.add("reasoning");
    if (RE_WRITING.test(hay)) set.add("writing");
    if (RE_VISION.test(hay)) set.add("vision");
    if (RE_FAST.test(hay)) set.add("fast");

    const caps = (input.capabilities ?? []).map((c) => c.toLowerCase());
    if (caps.includes("vision") || caps.includes("image")) set.add("vision");
    if (caps.includes("tools")) set.add("automation");

    if (input.provider && LOCAL_PROVIDERS.has(input.provider)) set.add("local");

    return STRENGTH_ORDER.filter((k) => set.has(k));
}

/** The top N strengths (for compact chip rows). */
export function topStrengths(input: StrengthInput, n = 3): StrengthKey[] {
    return agentStrengths(input).slice(0, n);
}

/** Does this agent/model have a given strength? (drives the capability filter). */
export function hasStrength(input: StrengthInput, key: StrengthKey): boolean {
    return agentStrengths(input).includes(key);
}
