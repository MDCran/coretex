// @ts-nocheck
"use client";

// Coretex Relay — Providers strip. Shows only CONNECTED providers (healthy).
// Providers that are enabled-but-unreachable, or not configured, are managed in
// Settings → AI providers rather than cluttering Home.

import { RefreshCcw01, Settings01, Copy01 } from "@untitledui/icons";
import type { ProviderHealth } from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import { providerLabel } from "../labels";
import { BrandLogo, PROVIDER_DOMAIN } from "../ui/brand-logo";
import { CLAUDE_TIERS, CLAUDE_TIER_ORDER, tierAvailability } from "../claude-tiers";
import type { CoretexActions, CoretexState } from "../use-coretex";
import type { NavTarget } from "../nav";
import { ContextMenu, type MenuItem } from "../ui/context-menu";

const copyText = (text: string) => void navigator.clipboard?.writeText(text);

/**
 * Claude tiers availability row — the 3 execution tiers (conversational / assisted /
 * autonomous) as compact pills. Each shows the tier icon + label, a status dot
 * (success when tierAvailability(state).available, gray otherwise), and an
 * "Active" / "Not configured" sub-label. ADDITIVE — surfaced inside the Providers
 * strip and reusable on the AI providers settings page. Brand RED accent only.
 */
export const ClaudeTiersRow = ({ state, onNavigate }: { state: CoretexState; onNavigate?: (t: NavTarget) => void }) => {
    // Execution tiers are Claude-specific runtimes (Agent SDK / Claude Code), so this
    // row only makes sense when Claude (Anthropic) is actually connected — otherwise it
    // reads as arbitrary favoritism in what is a centralized, provider-agnostic hub.
    const claudeConnected = state.health.some((h) => h.provider === "anthropic" && h.healthy);
    if (!claudeConnected) return null;

    const availability = tierAvailability(state);
    const toProviders = () => onNavigate?.({ kind: "settings", page: "ai-providers" });

    return (
        <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-tertiary">Claude tiers</h3>
            <div className="flex flex-wrap items-center gap-2.5">
                {CLAUDE_TIER_ORDER.map((mode) => {
                    const tier = CLAUDE_TIERS[mode];
                    const { available, detail } = availability[mode];
                    const Icon = tier.icon;
                    return (
                        <button
                            key={mode}
                            type="button"
                            onClick={toProviders}
                            disabled={!onNavigate}
                            title={detail}
                            className="group inline-flex items-center gap-2 rounded-lg border border-secondary bg-primary px-2.5 py-1.5 text-left transition enabled:cursor-pointer enabled:hover:border-primary enabled:hover:shadow-xs"
                        >
                            <Icon className="size-4 shrink-0 text-quaternary" />
                            <span className="flex flex-col">
                                <span className="text-xs font-medium leading-tight text-primary">{tier.label}</span>
                                <span className="text-xs leading-tight text-tertiary">{available ? "Active" : "Not configured"}</span>
                            </span>
                            <span
                                aria-hidden="true"
                                className={`ml-0.5 size-2 shrink-0 rounded-full ${available ? "bg-success-solid" : "bg-quaternary"}`}
                            />
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export const ProviderHealthStrip = ({ state, actions, onNavigate }: { state: CoretexState; actions: CoretexActions; onNavigate?: (t: NavTarget) => void }) => {
    const connected = state.health.filter((h) => h.healthy);
    const toProviders = () => onNavigate?.({ kind: "settings", page: "ai-providers" });

    return (
        <section>
            <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary">Providers</h2>
                <div className="flex items-center gap-2">
                    <Button size="sm" color="secondary" iconLeading={RefreshCcw01} onClick={() => actions.requestHealthCheck()}>
                        Refresh
                    </Button>
                    {onNavigate && (
                        <Button size="sm" color="link-color" iconLeading={Settings01} onClick={toProviders}>
                            Manage
                        </Button>
                    )}
                </div>
            </div>

            {connected.length === 0 ? (
                <button
                    type="button"
                    onClick={toProviders}
                    disabled={!onNavigate}
                    className="flex w-full items-center gap-3 rounded-xl border border-secondary bg-primary p-4 text-left transition enabled:hover:border-primary"
                >
                    <Settings01 className="size-5 text-quaternary" />
                    <p className="text-sm text-tertiary">
                        No providers connected. Add and enable one in <span className="font-medium text-secondary">Settings → AI providers</span>.
                    </p>
                </button>
            ) : (
                <div className="flex flex-wrap items-center gap-3">
                    {connected.map((h: ProviderHealth) => {
                        const items: MenuItem[] = [
                            { header: providerLabel(h.provider) },
                            { key: "refresh", label: "Refresh providers", icon: RefreshCcw01, onClick: () => actions.requestHealthCheck() },
                            {
                                key: "settings",
                                label: "Open AI providers settings",
                                icon: Settings01,
                                disabled: !onNavigate,
                                onClick: toProviders,
                            },
                            { separator: true },
                            {
                                key: "copy",
                                label: "Copy provider details",
                                icon: Copy01,
                                onClick: () => copyText(`${providerLabel(h.provider)} · ${Math.round(h.latencyMs)}ms · ${h.models.length} models`),
                            },
                        ];
                        return (
                            <ContextMenu key={h.provider} items={items} className="inline-flex">
                                <button
                                    type="button"
                                    onClick={toProviders}
                                    disabled={!onNavigate}
                                    className="group inline-flex items-center gap-2.5 rounded-lg border border-secondary bg-primary px-3 py-2 text-left transition enabled:cursor-pointer enabled:hover:border-primary enabled:hover:shadow-xs"
                                >
                                    <BrandLogo domain={PROVIDER_DOMAIN[h.provider] ?? h.provider} name={providerLabel(h.provider)} size={28} />
                                    <span className="flex flex-col">
                                        <span className="text-sm font-medium leading-tight text-primary">{providerLabel(h.provider)}</span>
                                        <span className="text-xs leading-tight text-tertiary">
                                            {Math.round(h.latencyMs)}ms · {h.models.length} models
                                        </span>
                                    </span>
                                    <span className="ml-1 size-2 shrink-0 rounded-full bg-success-solid" />
                                </button>
                            </ContextMenu>
                        );
                    })}
                </div>
            )}

            <div className="mt-5 border-t border-secondary pt-4">
                <ClaudeTiersRow state={state} onNavigate={onNavigate} />
            </div>
        </section>
    );
};
