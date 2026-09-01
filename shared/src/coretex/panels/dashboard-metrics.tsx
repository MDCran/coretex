// @ts-nocheck
"use client";

// Coretex Relay — Home dashboard metric row. Untitled UI metric cards over live
// orchestrator + cost data (no synthetic numbers): active agents, tasks today,
// cost today vs the daily budget, tokens today, and connected providers.

import type { ComponentType } from "react";
import { Activity, CheckCircle, Coins01, CpuChip01, Zap, ArrowRight, Copy01, BarChartSquare02, RefreshCcw01, CurrencyDollarCircle } from "@untitledui/icons";
import { ProgressBarCircle } from "@/components/base/progress-indicators/progress-circles";
import { cx } from "@/utils/cx";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { formatUSD, formatTokens } from "../use-coretex";
import type { NavTarget } from "../nav";
import { ContextMenu, type MenuItem } from "../ui/context-menu";

interface MetricProps {
    state: CoretexState;
    actions?: CoretexActions;
    onNavigate?: (t: NavTarget) => void;
}

interface Card {
    label: string;
    value: string;
    sub?: string;
    icon: ComponentType<{ className?: string }>;
    accent: string;
    to?: NavTarget;
}

const todayKey = (): string => new Date().toISOString().slice(0, 10);

export const DashboardMetrics = ({ state, actions, onNavigate }: MetricProps) => {
    const agents = state.agents ?? [];
    const activeAgents = agents.filter((a) => a.status === "working" || a.status === "thinking").length;

    const tasks = state.tasks ?? [];
    const today = todayKey();
    const completedToday = tasks.filter((t) => t.status === "completed" && (t.completedAt ?? t.updatedAt ?? "").slice(0, 10) === today).length;
    const failedToday = tasks.filter((t) => t.status === "failed" && (t.updatedAt ?? "").slice(0, 10) === today).length;

    const cost = state.cost;
    const costToday = cost?.totalCostToday ?? 0;
    const dailyLimit = cost?.dailyLimit ?? 0;
    const hasLimit = dailyLimit > 0;

    const health = state.health ?? [];
    // Providers: denominator = ALL configurable providers (Settings → AI providers),
    // numerator = how many are connected/configured (live-healthy, or a local baseUrl
    // / a configured cloud key). Falls back to live-health counts before settings load.
    const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "openclaw"]);
    const allProviders = state.settings?.aiProviders ?? [];
    const providerTotal = allProviders.length || health.length;
    const providerConnected = allProviders.length
        ? allProviders.filter((p) => {
              const h = health.find((x) => x.provider === p.provider);
              if (h?.healthy) return true;
              if (p.provider === "anthropic" && p.enabled && p.authMode !== "api-key") return true;
              return LOCAL_PROVIDERS.has(p.provider) ? Boolean(p.baseUrl) || p.enabled : p.keyConfigured;
          }).length
        : health.filter((h) => h.healthy).length;

    const cards: Card[] = [
        {
            label: "Active agents",
            value: `${activeAgents}`,
            sub: `${agents.length} in pool`,
            icon: Activity,
            accent: "var(--brand)",
            to: { kind: "agents" },
        },
        {
            label: "Tasks today",
            value: `${completedToday}`,
            sub: failedToday > 0 ? `${failedToday} failed` : "completed",
            icon: CheckCircle,
            accent: "var(--c-success)",
        },
        {
            label: "Cost today",
            value: formatUSD(costToday),
            sub: hasLimit ? `of ${formatUSD(dailyLimit)} limit` : "no daily limit",
            icon: Coins01,
            accent: "var(--c-warning)",
            to: { kind: "usage" },
        },
        {
            label: "Tokens today",
            value: formatTokens(cost?.totalTokensToday ?? 0),
            sub: `${formatTokens(cost?.totalTokensAllTime ?? 0)} all-time`,
            icon: Zap,
            accent: "var(--c-text-secondary)",
            to: { kind: "usage" },
        },
        {
            label: "Providers",
            value: `${providerConnected}/${providerTotal}`,
            sub: "configured",
            icon: CpuChip01,
            accent: "var(--c-success)",
            to: { kind: "settings", page: "ai-providers" },
        },
    ];

    return (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 lg:gap-4 xl:grid-cols-5">
            {cards.map((c) => {
                const Icon = c.icon;
                const isCost = c.label === "Cost today";
                const clickable = Boolean(c.to && onNavigate);
                // Right-click items: copy the value, jump to Usage & Analytics / model pricing,
                // and refresh providers — mirroring the metrics' left-click destinations.
                const items: MenuItem[] = [
                    { header: c.label },
                    {
                        key: "copy",
                        label: "Copy value",
                        icon: Copy01,
                        onClick: () => void navigator.clipboard?.writeText(c.value),
                    },
                    {
                        key: "open-usage",
                        label: "Open Usage & Analytics",
                        icon: BarChartSquare02,
                        disabled: !onNavigate,
                        onClick: () => onNavigate?.({ kind: "usage" }),
                    },
                    {
                        key: "open-pricing",
                        label: "Open model pricing",
                        icon: CurrencyDollarCircle,
                        disabled: !onNavigate,
                        onClick: () => onNavigate?.({ kind: "settings", page: "model-pricing" }),
                    },
                    { separator: true },
                    {
                        key: "refresh-providers",
                        label: "Refresh providers",
                        icon: RefreshCcw01,
                        disabled: !actions,
                        onClick: () => actions?.healthCheck(),
                    },
                ];
                return (
                    <ContextMenu key={c.label} items={items} asBlock>
                    <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => c.to && onNavigate?.(c.to)}
                        className={cx(
                            "group flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-secondary bg-primary p-3 text-left transition sm:gap-3 sm:p-4",
                            clickable && "cursor-pointer hover:border-primary hover:shadow-xs",
                        )}
                    >
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                                <span className="relative flex size-6 shrink-0 items-center justify-center rounded-lg sm:size-7" style={{ background: `color-mix(in srgb, ${c.accent} 14%, transparent)`, color: c.accent }}>
                                    {c.label === "Active agents" && activeAgents > 0 && (
                                        <span className="absolute inline-flex size-full animate-ping rounded-lg opacity-30" style={{ background: c.accent }} />
                                    )}
                                    <Icon className="relative size-3.5 sm:size-4" />
                                </span>
                                <span className="truncate text-[11px] font-medium text-tertiary sm:text-xs">{c.label}</span>
                                {clickable && <ArrowRight className="hidden size-3.5 shrink-0 text-quaternary opacity-0 transition group-hover:opacity-100 sm:block" />}
                            </div>
                            <p className="mt-1.5 truncate text-lg font-semibold text-primary tabular-nums sm:mt-2 sm:text-display-xs">{c.value}</p>
                            {c.sub && <p className="mt-0.5 truncate text-[11px] text-quaternary sm:text-xs">{c.sub}</p>}
                        </div>
                        {isCost && hasLimit && (
                            <div className="hidden shrink-0 sm:block">
                                <ProgressBarCircle size="xxs" value={costToday} min={0} max={dailyLimit} />
                            </div>
                        )}
                    </button>
                    </ContextMenu>
                );
            })}
        </div>
    );
};
