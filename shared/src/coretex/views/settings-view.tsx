// @ts-nocheck
"use client";

// Coretex Relay — global Settings view.
// Surfaces provider health, connected models, appearance hint, and the global
// daily cost limit. Read-mostly: actions stay informational here.

import { CheckCircle, AlertTriangle, Cube01, Wallet02 } from "@untitledui/icons";
import type { CostSummary, ModelInfo, ProviderHealth, ProviderType } from "@repo/coretex/types";

import { ProviderHealthStrip } from "../panels/provider-health";
import { providerLabel, modelLabel } from "../labels";
import { formatUSD } from "../use-coretex";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { BadgeWithDot } from "@/components/base/badges/badges";

const surface = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;

export const SettingsView = ({ state, actions }: { state: CoretexState; actions: CoretexActions }) => {
    const cost: CostSummary | null = state.cost;
    const hasLimit = !!cost && cost.dailyLimit > 0;

    // Group connected models by provider for the Models section.
    const modelsByProvider = new Map<ProviderType, ModelInfo[]>();
    for (const m of state.models) {
        const list = modelsByProvider.get(m.provider) ?? [];
        list.push(m);
        modelsByProvider.set(m.provider, list);
    }
    const modelGroups = Array.from(modelsByProvider.entries());

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-1">
                <h1 className="text-display-xs font-semibold text-primary">Coretex Settings</h1>
                <p className="text-xs text-tertiary">
                    {state.connected ? "Connected to the Brain" : "Disconnected — settings reflect the last snapshot"}
                </p>
            </header>

            {/* ── Providers ─────────────────────────────────────────────── */}
            <section className="flex flex-col gap-3">
                <ProviderHealthStrip state={state} actions={actions} />

                {state.health.length > 0 && (
                    <div className="rounded-xl p-5" style={surface}>
                        <h2 className="text-sm font-semibold text-primary">Provider details</h2>
                        <div className="mt-4 flex flex-col gap-2">
                            {state.health.map((h: ProviderHealth) => (
                                <div
                                    key={h.provider}
                                    className="flex items-center justify-between gap-3 rounded-lg border border-secondary bg-secondary px-3 py-2"
                                >
                                    <div className="flex items-center gap-2">
                                        <BadgeWithDot type="pill-color" size="md" color={h.healthy ? "success" : "error"}>
                                            {providerLabel(h.provider)}
                                        </BadgeWithDot>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-tertiary">
                                        {h.healthy ? (
                                            <>
                                                <span>{Math.round(h.latencyMs)}ms</span>
                                                <span className="text-secondary">{h.models.length} models</span>
                                            </>
                                        ) : (
                                            <span className="text-error-primary">{h.error ?? "unreachable"}</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            {/* ── Models ────────────────────────────────────────────────── */}
            <section className="rounded-xl p-5" style={surface}>
                <div className="flex items-center gap-2">
                    <Cube01 className="size-4 text-tertiary" />
                    <h2 className="text-sm font-semibold text-primary">Models</h2>
                </div>
                <p className="mt-1 text-xs text-tertiary">Models currently connected through the Brain.</p>

                {modelGroups.length === 0 ? (
                    <p className="mt-4 text-sm text-tertiary">No models reporting yet.</p>
                ) : (
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                        {modelGroups.map(([provider, models]) => (
                            <div key={provider} className="rounded-lg border border-secondary bg-secondary p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium text-primary">{providerLabel(provider)}</span>
                                    <span className="text-xs text-tertiary">{models.length}</span>
                                </div>
                                <ul className="mt-2 flex flex-col gap-1">
                                    {models.map((m: ModelInfo) => (
                                        <li key={m.id} className="truncate text-xs text-secondary" title={m.id}>
                                            {modelLabel(m.id)}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* ── Appearance ────────────────────────────────────────────── */}
            <section className="rounded-xl p-5" style={surface}>
                <h2 className="text-sm font-semibold text-primary">Appearance</h2>
                <p className="mt-2 text-sm text-secondary">
                    The theme can be changed from the sidebar footer — choose Light, Dark, or System.
                </p>
            </section>

            {/* ── Cost ──────────────────────────────────────────────────── */}
            <section className="rounded-xl p-5" style={surface}>
                <div className="flex items-center gap-2">
                    <Wallet02 className="size-4 text-tertiary" />
                    <h2 className="text-sm font-semibold text-primary">Cost</h2>
                </div>
                <p className="mt-1 text-xs text-tertiary">Global daily spend limit across all providers.</p>

                {cost === null ? (
                    <p className="mt-4 text-sm text-tertiary">No cost data reporting yet.</p>
                ) : (
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="rounded-lg border border-secondary bg-secondary p-3">
                            <p className="text-xs text-tertiary">Daily limit</p>
                            <p className="mt-1 text-sm font-semibold text-primary">
                                {hasLimit ? formatUSD(cost.dailyLimit) : "None"}
                            </p>
                        </div>
                        <div className="rounded-lg border border-secondary bg-secondary p-3">
                            <p className="text-xs text-tertiary">Remaining today</p>
                            <p className="mt-1 text-sm font-semibold text-primary">
                                {hasLimit ? formatUSD(cost.dailyLimitRemaining) : "Unlimited"}
                            </p>
                        </div>
                        <div className="rounded-lg border border-secondary bg-secondary p-3">
                            <p className="text-xs text-tertiary">Spent today</p>
                            <p className="mt-1 text-sm font-semibold text-primary">{formatUSD(cost.totalCostToday)}</p>
                        </div>
                    </div>
                )}

                {hasLimit && cost !== null && (
                    <div className="mt-3 flex items-center gap-2 text-xs">
                        {cost.dailyLimitRemaining > 0 ? (
                            <>
                                <CheckCircle className="size-4 text-success-primary" />
                                <span className="text-tertiary">Within the daily budget.</span>
                            </>
                        ) : (
                            <>
                                <AlertTriangle className="size-4 text-warning-primary" />
                                <span className="text-tertiary">Daily limit reached.</span>
                            </>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
};
