// @ts-nocheck
"use client";

// Coretex Relay — Usage & Billing view.
// Global, all-projects spend overview: top-line totals, a per-provider
// breakdown, and a per-agent breakdown. Reads purely from state.cost.

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Copy01, BarChartSquare02, CurrencyDollarCircle, RefreshCcw01, Settings01 } from "@untitledui/icons";
import type { CostBucket, CostAgentBucket } from "@repo/coretex/types";


import type { CoretexActions, CoretexState } from "../use-coretex";
import { formatUSD, formatTokens } from "../use-coretex";
import { providerLabel } from "../labels";
import { providerLogoDomain } from "../provider-meta";
import { BrandLogo } from "../ui/brand-logo";
import type { NavTarget } from "../nav";
import { ContextMenu, useContextMenu, type MenuItem } from "../ui/context-menu";
import { ChartTooltipContent } from "@/components/application/charts/charts-base";
import { Badge } from "@/components/base/badges/badges";

const cardStyle = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;

const copyText = (text: string) => void navigator.clipboard?.writeText(text);

interface Stat {
    label: string;
    value: string;
}

export const UsageView = ({ state, actions, onNavigate }: { state: CoretexState; actions?: CoretexActions; onNavigate?: (t: NavTarget) => void }) => {
    const c = state.cost;
    // List rows are <li> inside <ul>, so attach the menu via the hook (a wrapping
    // <div> would be invalid markup) and render its node once below.
    const rowMenu = useContextMenu();

    const stats: Stat[] = [
        { label: "Total spend today", value: formatUSD(c?.totalCostToday ?? 0) },
        { label: "All-time spend", value: formatUSD(c?.totalCostAllTime ?? 0) },
        { label: "Tokens today", value: formatTokens(c?.totalTokensToday ?? 0) },
        { label: "Daily limit", value: c && c.dailyLimit > 0 ? formatUSD(c.dailyLimit) : "none" },
    ];

    // Shared right-click menu for the KPI stat cards.
    const statMenu = (s: Stat): MenuItem[] => [
        { header: s.label },
        { key: "copy", label: "Copy value", icon: Copy01, onClick: () => copyText(s.value) },
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

    const providerMenu = (provider: string, bucket: CostBucket | undefined): MenuItem[] => [
        { header: providerLabel(provider) },
        {
            key: "copy",
            label: "Copy value",
            icon: Copy01,
            onClick: () => copyText(`${providerLabel(provider)}: ${formatUSD(bucket?.cost ?? 0)} · ${formatTokens(bucket?.tokens ?? 0)} tokens`),
        },
        {
            key: "refresh",
            label: "Refresh providers",
            icon: RefreshCcw01,
            disabled: !actions,
            onClick: () => actions?.healthCheck(),
        },
        {
            key: "settings",
            label: "Open AI providers settings",
            icon: Settings01,
            disabled: !onNavigate,
            onClick: () => onNavigate?.({ kind: "settings", page: "ai-providers" }),
        },
    ];

    const providerEntries = Object.entries(c?.byProvider ?? {}) as [string, CostBucket | undefined][];
    const agentEntries = Object.entries(c?.byAgent ?? {}) as [string, CostAgentBucket][];

    const spendByProvider = Object.entries(c?.byProvider ?? {}).map(([provider, bucket]) => ({
        name: providerLabel(provider),
        cost: Number((bucket?.cost ?? 0).toFixed(4)),
    }));

    return (
        <div className="flex flex-col gap-5">
            <header className="flex flex-col gap-1">
                <h1 className="text-display-xs font-semibold text-primary">Usage &amp; Billing</h1>
                <p className="text-sm text-tertiary">Global spend and token usage across every project.</p>
            </header>

            {/* Top stat row */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {stats.map((stat) => (
                    <ContextMenu key={stat.label} items={statMenu(stat)} asBlock>
                        <div className="rounded-xl p-4" style={cardStyle}>
                            <p className="text-xs text-tertiary">{stat.label}</p>
                            <p className="mt-1 text-display-xs font-semibold text-primary">{stat.value}</p>
                        </div>
                    </ContextMenu>
                ))}
            </div>

            {/* Spend by provider chart */}
            <ContextMenu
                asBlock
                items={[
                    { header: "Spend by provider" },
                    {
                        key: "copy-data",
                        label: "Copy as data",
                        icon: Copy01,
                        disabled: spendByProvider.length === 0,
                        onClick: () => copyText("provider,cost\n" + spendByProvider.map((d) => `${d.name},${d.cost}`).join("\n")),
                    },
                    {
                        key: "open-analytics",
                        label: "Open full analytics",
                        icon: BarChartSquare02,
                        disabled: !onNavigate,
                        onClick: () => onNavigate?.({ kind: "analytics" }),
                    },
                ]}
            >
            <section className="rounded-xl p-5" style={cardStyle}>
                <h2 className="text-sm font-semibold text-primary">Spend by provider</h2>
                {spendByProvider.length === 0 ? (
                    <p className="mt-3 text-xs text-tertiary">No spend recorded yet.</p>
                ) : (
                    <div className="mt-4">
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={spendByProvider}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" vertical={false} />
                                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="var(--c-border)" />
                                <YAxis tick={{ fontSize: 12 }} />
                                <Tooltip content={(<ChartTooltipContent />) as never} />
                                <Bar dataKey="cost" fill="var(--brand)" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </section>
            </ContextMenu>

            {/* By provider */}
            <section className="rounded-xl p-5" style={cardStyle}>
                <h2 className="text-sm font-semibold text-primary">By provider</h2>
                {providerEntries.length === 0 ? (
                    <p className="mt-3 text-xs text-tertiary">No provider spend recorded yet.</p>
                ) : (
                    <ul className="mt-4 flex flex-col gap-1">
                        {providerEntries.map(([provider, bucket]) => (
                            <li
                                key={provider}
                                onContextMenu={(e) => rowMenu.open(e, providerMenu(provider, bucket))}
                                className="flex items-center justify-between gap-3 rounded-lg border-b border-secondary py-2 last:border-b-0"
                            >
                                <span className="flex min-w-0 items-center gap-2">
                                    <BrandLogo domain={providerLogoDomain(provider)} name={providerLabel(provider)} size={22} chip={false} />
                                    <span className="truncate text-sm font-medium text-primary">{providerLabel(provider)}</span>
                                </span>
                                <div className="flex items-center gap-4">
                                    <span className="text-sm font-semibold text-primary">{formatUSD(bucket?.cost ?? 0)}</span>
                                    <span className="text-xs text-tertiary">{formatTokens(bucket?.tokens ?? 0)} tokens</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* By agent */}
            <section className="rounded-xl p-5" style={cardStyle}>
                <h2 className="text-sm font-semibold text-primary">By agent</h2>
                {agentEntries.length === 0 ? (
                    <p className="mt-3 text-xs text-tertiary">No agent spend recorded yet.</p>
                ) : (
                    <ul className="mt-4 flex flex-col gap-1">
                        {agentEntries.map(([id, bucket]) => {
                            const agentCfg = state.agents.find((a) => a.id === id)?.config;
                            const name = agentCfg?.name ?? id;
                            const items: MenuItem[] = [
                                { header: name },
                                {
                                    key: "copy",
                                    label: "Copy value",
                                    icon: Copy01,
                                    onClick: () => copyText(`${name}: ${formatUSD(bucket.cost)} · ${formatTokens(bucket.tokens)} tokens`),
                                },
                                {
                                    key: "open-analytics",
                                    label: "Open full analytics",
                                    icon: BarChartSquare02,
                                    disabled: !onNavigate,
                                    onClick: () => onNavigate?.({ kind: "analytics" }),
                                },
                            ];
                            return (
                                <li
                                    key={id}
                                    onContextMenu={(e) => rowMenu.open(e, items)}
                                    className="flex items-center justify-between gap-3 border-b border-secondary py-2 last:border-b-0"
                                >
                                    <span className="flex min-w-0 items-center gap-2">
                                        {agentCfg?.provider && <BrandLogo domain={providerLogoDomain(agentCfg.provider)} name={agentCfg.provider} size={20} chip={false} />}
                                        <span className="min-w-0 truncate text-sm font-medium text-primary">{name}</span>
                                    </span>
                                    <div className="flex items-center gap-4">
                                        <span className="text-sm font-semibold text-primary">{formatUSD(bucket.cost)}</span>
                                        <span className="text-xs text-tertiary">{formatTokens(bucket.tokens)} tokens</span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
            {rowMenu.node}
        </div>
    );
};
