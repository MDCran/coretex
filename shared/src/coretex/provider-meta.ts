// @ts-nocheck
// Shared AI provider metadata — readiness, blurbs, and LogoKit domain resolution.
// Used by Settings → AI providers, Settings → Agents, model picker, and health UI
// so logos and “configured / ready” mean the same thing everywhere.

import type { CodingAgentHarness, CoretexConfig, ProviderConfigState, ProviderHealth } from "@repo/coretex/types";
import { PROVIDER_DOMAIN, brandDomain } from "./ui/brand-logo";
import { providerLabel } from "./labels";

export const LOCAL_PROVIDER_IDS = new Set<string>(["ollama", "lmstudio", "openclaw"]);

export const PROVIDER_BLURB: Partial<Record<string, string>> = {
    ollama: "Local models via Ollama",
    lmstudio: "Local models via LM Studio",
    openai: "GPT models and embeddings",
    anthropic: "Claude — Pro/Max plan or API key",
    gemini: "Google Gemini models",
    openrouter: "Multi-provider router",
    openclaw: "Local OpenClaw gateway",
};

/** LogoKit domain for a provider id — one source of truth with BrandLogo. */
export function providerLogoDomain(provider: string): string {
    return PROVIDER_DOMAIN[provider] ?? brandDomain(provider);
}

export function providerShortBlurb(provider: string): string {
    return PROVIDER_BLURB[provider] ?? (LOCAL_PROVIDER_IDS.has(provider) ? "Local runtime" : "Cloud provider");
}

/** A provider is ready only after a successful live probe; configuration alone is not connectivity. */
export function isProviderReady(
    p: Pick<ProviderConfigState, "provider" | "enabled" | "authMode"> | undefined,
    health?: Pick<ProviderHealth, "healthy" | "status" | "channel">,
): boolean {
    if (!p?.enabled || !health?.healthy || health.status === "checking") return false;
    const subscription =
        (p.provider === "anthropic" && p.authMode !== "api-key") ||
        ((p.provider === "openai" || p.provider === "gemini") && p.authMode === "subscription");
    const expected = subscription ? "subscription" : LOCAL_PROVIDER_IDS.has(p.provider) ? "local" : "api";
    return health.channel === expected;
}

export function providerReadyDetail(p: ProviderConfigState | undefined, health?: ProviderHealth): string {
    if (!p) return "Not listed — open AI providers to add it";
    if (!p.enabled) return "Disabled — enable in AI providers";
    if (isProviderReady(p, health)) {
        const checked = health?.latencyMs != null ? ` (${Math.round(health.latencyMs)}ms)` : "";
        return `Live and ready${checked}`;
    }
    if (health?.status === "checking") return "Checking live connection…";
    if (health?.error) return `Unavailable — ${health.error}`;
    if (!LOCAL_PROVIDER_IDS.has(p.provider) && p.authMode === "api-key" && !p.keyConfigured) return "Add an API key in AI providers";
    return "Not verified — test the connection in AI providers";
}

export const EXECUTABLE_CODING_ASSISTANT_IDS = new Set(["claude", "codex", "gemini"]);

function codingAssistantRuntimeFlag(settings: CoretexConfig, id: string): boolean {
    if (id === "claude") return settings.agentRuntime.useClaudeSdkForClaude;
    if (id === "codex") return settings.agentRuntime.useCodexCliForOpenAI;
    if (id === "gemini") return settings.agentRuntime.useGeminiCliForGemini;
    return false;
}

export function isCodingAssistantEnabled(settings: CoretexConfig, harness: CodingAgentHarness): boolean {
    return EXECUTABLE_CODING_ASSISTANT_IDS.has(harness.id) && harness.enabled && codingAssistantRuntimeFlag(settings, harness.id);
}

export function codingAssistantCompatibilityDetail(settings: CoretexConfig, harness: CodingAgentHarness): string | undefined {
    const provider = settings.aiProviders.find((item) => item.provider === harness.provider);
    if (harness.id === "codex" && provider?.authMode !== "subscription") {
        return "Choose ChatGPT subscription authentication for the Codex CLI runtime";
    }
    if (harness.id === "gemini" && provider?.authMode !== "subscription") {
        return "Choose Google subscription authentication for the Gemini CLI runtime";
    }
    return undefined;
}

export function isCodingAssistantReady(
    settings: CoretexConfig,
    harness: CodingAgentHarness,
    health?: ProviderHealth,
): boolean {
    const provider = settings.aiProviders.find((item) => item.provider === harness.provider);
    return isCodingAssistantEnabled(settings, harness)
        && !codingAssistantCompatibilityDetail(settings, harness)
        && isProviderReady(provider, health);
}

export function codingAssistantReadyDetail(
    settings: CoretexConfig,
    harness: CodingAgentHarness,
    health?: ProviderHealth,
): string {
    if (!isCodingAssistantEnabled(settings, harness)) return "Off";
    const incompatible = codingAssistantCompatibilityDetail(settings, harness);
    if (incompatible) return incompatible;
    const provider = settings.aiProviders.find((item) => item.provider === harness.provider);
    return providerReadyDetail(provider, health);
}

export function codingAssistantTitle(name: string, provider: string): string {
    // Prefer harness display name; fall back to the shared provider label.
    return name.trim() || providerLabel(provider);
}
