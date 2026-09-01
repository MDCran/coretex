// @ts-nocheck
"use client";

// Cross-link strip between Settings → AI providers and Settings → Agents.
// Same LogoKit marks + shared readiness so the two pages feel like one flow.

import { ArrowRight, Stars01, Users01 } from "@untitledui/icons";
import type { CoretexConfig, ProviderHealth } from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import type { NavTarget } from "../nav";
import { providerLabel } from "../labels";
import { BrandLogo } from "../ui/brand-logo";
import { EXECUTABLE_CODING_ASSISTANT_IDS, isCodingAssistantReady, isProviderReady, providerLogoDomain, providerReadyDetail } from "../provider-meta";
import { SETTINGS_SURFACE } from "./settings-shell";

type Variant = "to-agents" | "to-providers";

export function AiSettingsLinkCard({
    settings,
    health,
    variant,
    onNavigate,
    /** Live agent pool size (state.agents). Config `settings.agents` is a seed list and is often empty. */
    agentCount = 0,
}: {
    settings: CoretexConfig;
    health: ProviderHealth[];
    variant: Variant;
    onNavigate?: (t: NavTarget) => void;
    agentCount?: number;
}) {
    const providers = settings.aiProviders ?? [];
    const healthFor = (provider: string) => health.find((item) => item.provider === provider);
    const ready = providers.filter((p) => isProviderReady(p, healthFor(p.provider)));
    const harnesses = (settings.codingAgents ?? []).filter((h) =>
        EXECUTABLE_CODING_ASSISTANT_IDS.has(h.id) && isCodingAssistantReady(settings, h, healthFor(h.provider)),
    );

    if (variant === "to-agents") {
        return (
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3.5 sm:px-5" style={SETTINGS_SURFACE}>
                <div className="flex min-w-0 flex-1 basis-[20rem] items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)]" style={{ border: "1px solid var(--c-border)" }}>
                        <Users01 className="size-5 text-secondary" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-semibold text-primary [overflow-wrap:anywhere]">Agents use these providers</p>
                        <p className="mt-0.5 break-words text-xs text-tertiary [overflow-wrap:anywhere]">
                            {ready.length === 0
                                ? "Connect a provider below, then create agents and turn on coding assistants."
                                : `${ready.length} live providers · ${harnesses.length} coding assistants on · ${agentCount} agents`}
                        </p>
                        {ready.length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {ready.slice(0, 8).map((p) => (
                                    <span
                                        key={p.provider}
                                        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5"
                                        style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                                        title={providerReadyDetail(p, healthFor(p.provider))}
                                    >
                                        <BrandLogo domain={providerLogoDomain(p.provider)} name={providerLabel(p.provider)} size={14} chip={false} />
                                        <span className="text-[11px] font-medium text-secondary">{providerLabel(p.provider)}</span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                {onNavigate && (
                    <Button size="sm" color="secondary" iconTrailing={ArrowRight} onClick={() => onNavigate({ kind: "settings", page: "agents" })}>
                        Agents & assistants
                    </Button>
                )}
            </div>
        );
    }

    return (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3.5 sm:px-5" style={SETTINGS_SURFACE}>
            <div className="flex min-w-0 flex-1 basis-[20rem] items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)]" style={{ border: "1px solid var(--c-border)" }}>
                    <Stars01 className="size-5 text-secondary" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold text-primary [overflow-wrap:anywhere]">Powered by AI providers</p>
                    <p className="mt-0.5 break-words text-xs text-tertiary [overflow-wrap:anywhere]">
                        {ready.length === 0
                            ? "Configure Ollama, Claude, OpenAI, Gemini, and more — agents pick models from ready providers."
                            : `${ready.length} of ${providers.length} providers ready · same logos and names as AI providers`}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {providers.map((p) => {
                            const ok = isProviderReady(p, healthFor(p.provider));
                            return (
                                <span
                                    key={p.provider}
                                    className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5"
                                    style={{
                                        background: "var(--surface-2)",
                                        border: "1px solid var(--c-border)",
                                        opacity: ok ? 1 : 0.55,
                                    }}
                                    title={providerReadyDetail(p, healthFor(p.provider))}
                                >
                                    <BrandLogo domain={providerLogoDomain(p.provider)} name={providerLabel(p.provider)} size={14} chip={false} />
                                    <span className="text-[11px] font-medium text-secondary">{providerLabel(p.provider)}</span>
                                    <span
                                        className="size-1.5 shrink-0 rounded-full"
                                        style={{
                                            background: ok
                                                ? "var(--c-success, #22c55e)"
                                                : p.enabled
                                                  ? "var(--c-warning, #f59e0b)"
                                                  : "var(--c-text-muted)",
                                        }}
                                    />
                                </span>
                            );
                        })}
                    </div>
                </div>
            </div>
            {onNavigate && (
                <Button size="sm" color="secondary" iconTrailing={ArrowRight} onClick={() => onNavigate({ kind: "settings", page: "ai-providers" })}>
                    AI providers
                </Button>
            )}
        </div>
    );
}
