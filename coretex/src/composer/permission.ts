// Coretex — how the permission mode + global tool-access posture combine to govern
// whether an attached integration/tool may be called. Stricter wins; Auto/Bypass are
// admin-gated. Pure functions so both the Brain and the manifest text agree.

import type { PermissionMode } from "../types.js";

export type ToolAccessMode = "ask" | "auto-safe" | "read-only" | "full" | "plan";
/** confirm = ask per call; plan-only = plan but execute nothing; auto = call within policy; bypass = call freely (flagged). */
export type EffectivePolicy = "plan-only" | "confirm" | "auto" | "bypass";

// Lower rank = stricter.
const RANK: Record<EffectivePolicy, number> = { "plan-only": 0, confirm: 1, auto: 2, bypass: 3 };
function stricter(a: EffectivePolicy, b: EffectivePolicy): EffectivePolicy {
    return RANK[a] <= RANK[b] ? a : b;
}

/**
 * Resolve how integration/tool calls are governed for a given permission mode + global
 * tool-access mode. Plan anywhere → plan-only. Auto/Bypass require `allowAutoBypass`
 * (admin gate), else they degrade to confirm. The stricter of the two axes wins.
 */
export function effectivePolicy(mode: PermissionMode, toolAccess: ToolAccessMode, allowAutoBypass: boolean): EffectivePolicy {
    if (mode === "plan" || toolAccess === "plan") return "plan-only";
    const fromMode: EffectivePolicy = mode === "ask" || mode === "accept-edits" ? "confirm" : mode === "auto" ? "auto" : "bypass";
    const fromTool: EffectivePolicy = toolAccess === "ask" || toolAccess === "read-only" ? "confirm" : "auto"; // auto-safe / full → auto
    let policy = stricter(fromMode, fromTool);
    if ((policy === "auto" || policy === "bypass") && !allowAutoBypass) policy = "confirm";
    return policy;
}

/** One-line, model-facing description of a policy. */
export function policyText(p: EffectivePolicy): string {
    switch (p) {
        case "plan-only": return "PLAN ONLY — plan which integrations you would use, but execute NONE.";
        case "confirm": return "ASK — confirm with the user before any integration/tool call.";
        case "auto": return "AUTO — call within the security policy without per-call prompts.";
        case "bypass": return "BYPASS — call freely (admin-gated; all calls are flagged + audited).";
    }
}
