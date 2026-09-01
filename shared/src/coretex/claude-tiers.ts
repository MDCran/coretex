// @ts-nocheck
// Coretex — the shared concept of the 3 Claude execution tiers, mapped to the REAL
// Brain mechanisms that back them:
//   conversational → coretex/src/llm/hub.ts (a single LLM-hub completion turn)
//   assisted       → the "claude" codingAgents harness run in a terminal/PTY (terminal/manager.ts)
//   autonomous     → coretex/src/agents/claude-runtime.ts (@anthropic-ai/claude-agent-sdk via the pool)
//
// One source of truth for the label/description/icon/tone of each tier, plus a helper
// that derives per-tier availability from REAL relay state (provider config/health +
// the codingAgents harness registry). Pure data + a pure function — no React here.

import type { FC } from "react";
import { MessageChatCircle, Terminal, CpuChip01 } from "@untitledui/icons";
import type { ClaudeExecutionMode } from "@repo/coretex/types";
import type { CoretexState } from "./use-coretex";

export type { ClaudeExecutionMode };

/** Accent tone for a tier; maps to an Untitled UI Badge color (see claudeTierBadgeColor). */
export type ClaudeTierTone = "brand" | "success" | "warning" | "gray";

export interface ClaudeTier {
    mode: ClaudeExecutionMode;
    label: string;
    description: string;
    /** A valid @untitledui/icons component (matches the Untitled UI icon signature). */
    icon: FC<{ className?: string; strokeWidth?: string | number }>;
    tone: ClaudeTierTone;
}

/** The 3 Claude tiers, each describing its REAL Brain-side mechanism. */
export const CLAUDE_TIERS: Record<ClaudeExecutionMode, ClaudeTier> = {
    conversational: {
        mode: "conversational",
        label: "Conversational",
        description: "Direct Claude via the LLM hub — planning, reasoning, chat",
        icon: MessageChatCircle,
        tone: "brand",
    },
    assisted: {
        mode: "assisted",
        label: "Assisted",
        description: "Claude Code in a terminal — you stay in the loop",
        icon: Terminal,
        tone: "warning",
    },
    autonomous: {
        mode: "autonomous",
        label: "Autonomous",
        description: "Agent SDK — runs to completion headlessly",
        icon: CpuChip01,
        tone: "success",
    },
};

/** Ordered list of the tiers (conversational → assisted → autonomous). */
export const CLAUDE_TIER_ORDER: ClaudeExecutionMode[] = ["conversational", "assisted", "autonomous"];

export interface ClaudeTierAvailability {
    available: boolean;
    detail: string;
}

/**
 * Per-tier availability derived from REAL relay state:
 *  - conversational needs Anthropic API key (hub Messages API) or healthy hub probe.
 *  - assisted / autonomous work with Claude Pro/Max plan (Claude Code / Agent SDK)
 *    or an API key.
 *  - assisted also needs the "claude" codingAgents harness enabled.
 */
export function tierAvailability(
    state: Pick<CoretexState, "settings" | "health">,
): Record<ClaudeExecutionMode, ClaudeTierAvailability> {
    const anthropicCfg = state.settings?.aiProviders.find((p) => p.provider === "anthropic");
    const anthropicHealth = state.health.find((h) => h.provider === "anthropic");
    const keyConfigured = !!anthropicCfg?.keyConfigured;
    const planMode = anthropicCfg?.enabled && anthropicCfg.authMode !== "api-key";
    const healthy = !!anthropicHealth?.healthy;
    const planOrKey = keyConfigured || planMode || healthy;
    const chatReady = keyConfigured || healthy;

    const planDetail = healthy
        ? "Anthropic provider healthy"
        : planMode
          ? "Claude Pro/Max plan mode (subscription)"
          : keyConfigured
            ? "Anthropic API key configured"
            : "Configure Anthropic in Settings (Pro/Max plan or API key)";

    const chatDetail = chatReady
        ? healthy
            ? "Anthropic provider healthy"
            : "Anthropic API key configured"
        : planMode
          ? "Hub chat needs an API key; agents use your Pro/Max plan"
          : "Configure the Anthropic provider in Settings";

    const claudeHarness = state.settings?.codingAgents.find((h) => h.id === "claude");
    const harnessEnabled = !!claudeHarness?.enabled;
    const assistedDetail = harnessEnabled
        ? planMode || keyConfigured
            ? "Claude Code harness enabled"
            : "Claude Code harness on — configure Anthropic plan or key"
        : "Enable the Claude Code harness in Settings";

    return {
        conversational: { available: chatReady, detail: chatDetail },
        assisted: { available: harnessEnabled && planOrKey, detail: assistedDetail },
        autonomous: { available: planOrKey, detail: planDetail },
    };
}
