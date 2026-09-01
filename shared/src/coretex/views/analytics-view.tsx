// @ts-nocheck
"use client";

// Coretex Relay — Analytics view. A real observability surface over live
// orchestrator + cost data: KPI cards, cost-by-provider and tokens-by-agent bar
// charts, success/utilization/budget gauges, and an agent leaderboard. Derived
// purely from state (cost.byProvider/byAgent, agents, tasks) — no synthetic data.
// The deeper time-series event log (ActivityTracker + rollups) is a later layer.

import { type ComponentType, useEffect, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Activity, CheckCircle, Coins01, CpuChip01, Target04, Zap, Edit01, BarChartSquare02, Copy01, CurrencyDollarCircle, RefreshCcw01 } from "@untitledui/icons";





import type { CoretexActions, CoretexState } from "../use-coretex";
import { formatUSD, formatTokens } from "../use-coretex";
import { providerLabel } from "../labels";
import { providerLogoDomain } from "../provider-meta";
import { BrandLogo } from "../ui/brand-logo";
import type { NavTarget } from "../nav";
import { ContextMenu, type MenuItem } from "../ui/context-menu";
import { ChartTooltipContent } from "@/components/application/charts/charts-base";
import { Badge } from "@/components/base/badges/badges";
import { ProgressBarCircle } from "@/components/base/progress-indicators/progress-circles";
import { Input } from "@/components/base/input/input";
import { Button } from "@/components/base/buttons/button";

const cardStyle = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;

const copyText = (text: string) => void navigator.clipboard?.writeText(text);

interface Kpi {
    label: string;
    value: string;
    sub?: string;
    icon: ComponentType<{ className?: string }>;
    accent: string;
}

export const AnalyticsView = ({ state, actions, onOpenPricing, onNavigate }: { state: CoretexState; actions?: CoretexActions; onOpenPricing?: () => void; onNavigate?: (t: NavTarget) => void }) => {
    const c = state.cost;
    const agents = state.agents ?? [];
    const tasks = state.tasks ?? [];

    const providerEntries = Object.entries(c?.byProvider ?? {});
    const agentEntries = Object.entries(c?.byAgent ?? {});
    const modelEntries = Object.entries(c?.byModel ?? {});

    const completed = tasks.filter((t) => t.status === "completed").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const cancelled = tasks.filter((t) => t.status === "cancelled").length;
    const inProgress = tasks.filter((t) => t.status === "in_progress" || t.status === "assigned").length;
    const pending = tasks.filter((t) => t.status === "pending").length;
    const finished = completed + failed + cancelled;
    const successRate = finished > 0 ? Math.round((completed / finished) * 100) : 0;

    const activeAgents = agents.filter((a) => a.status === "working" || a.status === "thinking").length;
    const utilization = agents.length > 0 ? Math.round((activeAgents / agents.length) * 100) : 0;

    const dailyLimit = c?.dailyLimit ?? 0;
    const costToday = c?.totalCostToday ?? 0;
    const budgetPct = dailyLimit > 0 ? Math.min(100, Math.round((costToday / dailyLimit) * 100)) : 0;

    const totalTokens = c?.totalTokensAllTime ?? 0;
    const tokensPerTask = completed > 0 ? Math.round(totalTokens / completed) : 0;

    const kpis: Kpi[] = [
        { label: "Total cost", value: formatUSD(c?.totalCostAllTime ?? 0), sub: `${formatUSD(costToday)} today`, icon: Coins01, accent: "#ef4444" },
        { label: "Total tokens", value: formatTokens(totalTokens), sub: `${formatTokens(c?.totalTokensToday ?? 0)} today`, icon: Zap, accent: "#f59e0b" },
        { label: "Tasks completed", value: `${completed}`, sub: failed > 0 ? `${failed} failed` : "no failures", icon: CheckCircle, accent: "#22c55e" },
        { label: "Success rate", value: `${successRate}%`, sub: `${finished} finished`, icon: Target04, accent: "#3b82f6" },
        { label: "Active agents", value: `${activeAgents}/${agents.length}`, sub: `${utilization}% utilization`, icon: Activity, accent: "#8b5cf6" },
        { label: "Tokens / task", value: tokensPerTask > 0 ? formatTokens(tokensPerTask) : "—", sub: "avg completed", icon: CpuChip01, accent: "#14b8a6" },
    ];

    // ---- chart data (real) ----
    const costByProvider = Object.entries(c?.byProvider ?? {}).map(([provider, bucket]) => ({
        name: providerLabel(provider),
        cost: Number((bucket?.cost ?? 0).toFixed(4)),
        tokens: bucket?.tokens ?? 0,
    }));

    /** Prefer live agent display names; never show raw ids like agent_17… */
    const agentName = (id: string) => {
        const live = agents.find((a) => a.id === id);
        if (live?.config?.name?.trim()) return live.config.name.trim();
        // Hub / system callers often use synthetic ids — map them to readable labels.
        const system: Record<string, string> = {
            hub: "AI Chat",
            system: "System",
            buddy: "Terminal Buddy",
            planner: "Planner",
            orchestrator: "Orchestrator",
        };
        if (system[id]) return system[id];
        if (id.startsWith("agent_")) return "Retired agent";
        if (id.length > 18) return `${id.slice(0, 12)}…`;
        return id;
    };
    const agentDetail = (id: string) => {
        const live = agents.find((a) => a.id === id);
        if (!live) return id.startsWith("agent_") ? "Removed from pool" : id;
        return `${providerLabel(live.config.provider)} · ${live.config.model}`;
    };

    const tokensByAgent = Object.entries(c?.byAgent ?? {})
        .map(([id, bucket]) => ({ id, name: agentName(id), tokens: bucket?.tokens ?? 0, cost: bucket?.cost ?? 0 }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 8);

    const leaderboard = Object.entries(c?.byAgent ?? {})
        .map(([id, bucket]) => ({
            id,
            name: agentName(id),
            detail: agentDetail(id),
            provider: agents.find((a) => a.id === id)?.config.provider,
            tokens: bucket?.tokens ?? 0,
            cost: bucket?.cost ?? 0,
        }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 8);

    const costByModel = modelEntries
        .map(([, bucket]) => ({
            name: bucket.model.length > 28 ? `${bucket.model.slice(0, 26)}…` : bucket.model,
            fullName: bucket.model,
            provider: providerLabel(bucket.provider),
            providerKey: bucket.provider,
            cost: Number((bucket.cost ?? 0).toFixed(4)),
            tokens: bucket.tokens ?? 0,
            calls: bucket.calls ?? 0,
        }))
        .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
        .slice(0, 12);

    const recentTasks = [...tasks]
        .filter((t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled")
        .sort((a, b) => String(b.updatedAt ?? b.completedAt ?? "").localeCompare(String(a.updatedAt ?? a.completedAt ?? "")))
        .slice(0, 12);

    return (
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 lg:gap-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-display-sm font-semibold text-primary">Usage &amp; Analytics</h1>
                    <p className="mt-1 text-sm text-tertiary">Spend, tokens, agent effectiveness, and utilization across the whole workspace.</p>
                </div>
                {onOpenPricing && (
                    <button type="button" onClick={onOpenPricing} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-secondary transition hover:text-primary" style={cardStyle}>
                        <Coins01 className="size-4 text-brand-secondary" /> Model pricing
                    </button>
                )}
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                {kpis.map((k) => {
                    const Icon = k.icon;
                    // Right-click: copy the metric, jump to Usage & Analytics / model pricing,
                    // and refresh provider health. Mirrors the page's own actions/links.
                    const items: MenuItem[] = [
                        { header: k.label },
                        { key: "copy", label: "Copy value", icon: Copy01, onClick: () => copyText(k.value) },
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
                            disabled: !onOpenPricing && !onNavigate,
                            onClick: () => (onOpenPricing ? onOpenPricing() : onNavigate?.({ kind: "settings", page: "model-pricing" })),
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
                        <ContextMenu key={k.label} items={items} asBlock>
                            <div className="rounded-xl p-4" style={cardStyle}>
                                <div className="flex items-center gap-2">
                                    <span className="flex size-7 items-center justify-center rounded-lg" style={{ background: k.accent + "1f", color: k.accent }}>
                                        <Icon className="size-4" />
                                    </span>
                                    <span className="truncate text-xs font-medium text-tertiary">{k.label}</span>
                                </div>
                                <p className="mt-2 text-display-xs font-semibold text-primary tabular-nums">{k.value}</p>
                                {k.sub && <p className="mt-0.5 truncate text-xs text-quaternary">{k.sub}</p>}
                            </div>
                        </ContextMenu>
                    );
                })}
            </div>

            {/* Daily spend limit — editable here (linked to the orchestrator budget) */}
            {actions && <DailyLimitCard limit={dailyLimit} costToday={costToday} budgetPct={budgetPct} onSave={(usd) => actions.setDailyLimit(usd)} />}

            {/* Charts */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <ChartCard
                    title="Cost by provider"
                    empty={costByProvider.length === 0}
                    emptyText="No spend recorded yet."
                    menuItems={[
                        { header: "Cost by provider" },
                        {
                            key: "copy-data",
                            label: "Copy as data",
                            icon: Copy01,
                            disabled: costByProvider.length === 0,
                            onClick: () => copyText("provider,cost\n" + costByProvider.map((d) => `${d.name},${d.cost}`).join("\n")),
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
                    <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={costByProvider} margin={{ top: 8, right: 8, bottom: 8, left: 8 }} className="text-tertiary [&_.recharts-text]:text-xs">
                            <CartesianGrid vertical={false} className="stroke-utility-gray-200" strokeOpacity={0.4} />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} fill="currentColor" />
                            <YAxis axisLine={false} tickLine={false} fill="currentColor" tickFormatter={(v) => formatUSD(Number(v))} />
                            <Tooltip content={<ChartTooltipContent />} formatter={(v) => formatUSD(Number(v))} cursor={{ className: "fill-utility-gray-200/20" }} />
                            <Bar dataKey="cost" name="Cost" className="text-utility-brand-600" fill="currentColor" radius={[6, 6, 0, 0]} maxBarSize={48} isAnimationActive={false} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard
                    title="Tokens by agent"
                    empty={tokensByAgent.length === 0}
                    emptyText="No agent usage yet."
                    menuItems={[
                        { header: "Tokens by agent" },
                        {
                            key: "copy-data",
                            label: "Copy as data",
                            icon: Copy01,
                            disabled: tokensByAgent.length === 0,
                            onClick: () => copyText("agent,tokens\n" + tokensByAgent.map((d) => `${d.name},${d.tokens}`).join("\n")),
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
                    <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={tokensByAgent} margin={{ top: 8, right: 8, bottom: 8, left: 8 }} className="text-tertiary [&_.recharts-text]:text-xs">
                            <CartesianGrid vertical={false} className="stroke-utility-gray-200" strokeOpacity={0.4} />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} fill="currentColor" />
                            <YAxis axisLine={false} tickLine={false} fill="currentColor" tickFormatter={(v) => formatTokens(Number(v))} />
                            <Tooltip content={<ChartTooltipContent />} formatter={(v) => `${formatTokens(Number(v))} tokens`} cursor={{ className: "fill-utility-gray-200/20" }} />
                            <Bar dataKey="tokens" name="Tokens" className="text-utility-brand-500" fill="currentColor" radius={[6, 6, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
            </div>

            {/* Gauges + task outcomes */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="flex flex-wrap items-center justify-center gap-6 rounded-xl p-5" style={cardStyle}>
                    <Gauge label="Success" value={successRate} suffix="%" />
                    <Gauge label="Utilization" value={utilization} suffix="%" />
                    <Gauge label="Budget" value={budgetPct} suffix="%" />
                </div>

                <div className="rounded-xl p-5 lg:col-span-2" style={cardStyle}>
                    <h2 className="text-sm font-semibold text-primary">Task outcomes</h2>
                    <p className="mt-0.5 text-xs text-tertiary">How work across the fleet finished — not just raw counts.</p>
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                        <Outcome label="Completed" value={completed} color="success" hint="Finished successfully" />
                        <Outcome label="In progress" value={inProgress} color="blue" hint="Assigned or running" />
                        <Outcome label="Queued" value={pending} color="gray" hint="Waiting for an agent" />
                        <Outcome label="Failed" value={failed} color="error" hint="Stopped with an error" />
                        <Outcome label="Cancelled" value={cancelled} color="gray" hint="Stopped by you" />
                    </div>
                    {recentTasks.length > 0 && (
                        <ul className="mt-5 flex flex-col divide-y divide-[var(--c-border)]">
                            {recentTasks.map((t) => {
                                const agent = t.assignedAgentId ? agents.find((a) => a.id === t.assignedAgentId) : undefined;
                                const tone = t.status === "completed" ? "success" : t.status === "failed" ? "error" : "gray";
                                return (
                                    <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                                        <div className="flex min-w-0 items-start gap-2">
                                            {agent && <BrandLogo domain={providerLogoDomain(agent.config.provider)} name={agent.config.provider} size={20} chip={false} className="mt-0.5" />}
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-primary">{t.title}</p>
                                                <p className="mt-0.5 text-xs text-tertiary">
                                                    {agent?.config.name ?? "Unassigned"}
                                                    {agent ? ` · ${providerLabel(agent.config.provider)} · ${agent.config.model}` : ""}
                                                </p>
                                            </div>
                                        </div>
                                        <Badge size="sm" color={tone} type="pill-color">{t.status.replace(/_/g, " ")}</Badge>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>

            {/* Leaderboard */}
            <div className="rounded-xl p-5" style={cardStyle}>
                <h2 className="text-sm font-semibold text-primary">Top agents by usage</h2>
                {leaderboard.length === 0 ? (
                    <p className="mt-3 text-sm text-tertiary">No agent usage recorded yet.</p>
                ) : (
                    <ul className="mt-3 flex flex-col divide-y divide-[var(--c-border)]">
                        {leaderboard.map((row, i) => (
                            <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                                <span className="flex min-w-0 items-center gap-3">
                                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-tertiary" style={{ background: "var(--surface-2)" }}>
                                        {i + 1}
                                    </span>
                                    {row.provider && <BrandLogo domain={providerLogoDomain(row.provider)} name={row.provider} size={22} chip={false} />}
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm font-medium text-primary">{row.name}</span>
                                        <span className="block truncate text-[11px] text-quaternary">{row.detail}</span>
                                    </span>
                                </span>
                                <span className="shrink-0 text-xs text-tertiary tabular-nums">
                                    {formatTokens(row.tokens)} tokens · {formatUSD(row.cost)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Detailed spend breakdown */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="rounded-xl p-5" style={cardStyle}>
                    <h2 className="text-sm font-semibold text-primary">By AI provider</h2>
                    <p className="mt-0.5 text-xs text-tertiary">Anthropic, OpenAI, Gemini, local…</p>
                    {providerEntries.length === 0 ? (
                        <p className="mt-3 text-xs text-tertiary">No provider spend recorded yet.</p>
                    ) : (
                        <ul className="mt-3 flex flex-col">
                            {providerEntries
                                .sort((a, b) => (b[1]?.cost ?? 0) - (a[1]?.cost ?? 0))
                                .map(([provider, bucket]) => (
                                <li key={provider} className="flex items-center justify-between gap-3 border-b border-secondary py-2.5 last:border-0">
                                    <span className="flex min-w-0 items-center gap-2">
                                        <BrandLogo domain={providerLogoDomain(provider)} name={providerLabel(provider)} size={22} chip={false} />
                                        <span className="truncate text-sm font-medium text-primary">{providerLabel(provider)}</span>
                                    </span>
                                    <span className="flex flex-col items-end gap-0.5">
                                        <span className="text-sm font-semibold text-primary tabular-nums">{formatUSD(bucket?.cost ?? 0)}</span>
                                        <span className="text-xs text-tertiary tabular-nums">{formatTokens(bucket?.tokens ?? 0)} tokens</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="rounded-xl p-5" style={cardStyle}>
                    <h2 className="text-sm font-semibold text-primary">By AI model</h2>
                    <p className="mt-0.5 text-xs text-tertiary">Which models actually spent tokens.</p>
                    {costByModel.length === 0 ? (
                        <p className="mt-3 text-xs text-tertiary">No model usage recorded yet.</p>
                    ) : (
                        <ul className="mt-3 flex flex-col">
                            {costByModel.map((row) => (
                                <li key={`${row.provider}-${row.fullName}`} className="flex items-start justify-between gap-3 border-b border-secondary py-2.5 last:border-0">
                                    <span className="flex min-w-0 items-start gap-2">
                                        <BrandLogo domain={providerLogoDomain(row.providerKey)} name={row.provider} size={20} chip={false} className="mt-0.5" />
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-medium text-primary" title={row.fullName}>{row.name}</span>
                                            <span className="text-[11px] text-quaternary">{row.provider} · {row.calls} call{row.calls === 1 ? "" : "s"}</span>
                                        </span>
                                    </span>
                                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                                        <span className="text-sm font-semibold text-primary tabular-nums">{formatUSD(row.cost)}</span>
                                        <span className="text-xs text-tertiary tabular-nums">{formatTokens(row.tokens)}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="rounded-xl p-5" style={cardStyle}>
                    <h2 className="text-sm font-semibold text-primary">By agent</h2>
                    <p className="mt-0.5 text-xs text-tertiary">Named agents — never raw IDs.</p>
                    {agentEntries.length === 0 ? (
                        <p className="mt-3 text-xs text-tertiary">No agent spend recorded yet.</p>
                    ) : (
                        <ul className="mt-3 flex flex-col">
                            {agentEntries
                                .sort((a, b) => (b[1]?.tokens ?? 0) - (a[1]?.tokens ?? 0))
                                .map(([id, bucket]) => {
                                const provider = agents.find((a) => a.id === id)?.config.provider;
                                return (
                                <li key={id} className="flex items-start justify-between gap-3 border-b border-secondary py-2.5 last:border-0">
                                    <span className="flex min-w-0 items-start gap-2">
                                        {provider && <BrandLogo domain={providerLogoDomain(provider)} name={provider} size={20} chip={false} className="mt-0.5" />}
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-medium text-primary">{agentName(id)}</span>
                                            <span className="block truncate text-[11px] text-quaternary">{agentDetail(id)}</span>
                                        </span>
                                    </span>
                                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                                        <span className="text-sm font-semibold text-primary tabular-nums">{formatUSD(bucket?.cost ?? 0)}</span>
                                        <span className="text-xs text-tertiary tabular-nums">{formatTokens(bucket?.tokens ?? 0)}</span>
                                    </span>
                                </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>

            {costByModel.length > 0 && (
                <ChartCard
                    title="Cost by model"
                    empty={false}
                    emptyText=""
                    menuItems={[
                        { header: "Cost by model" },
                        {
                            key: "copy-data",
                            label: "Copy as data",
                            icon: Copy01,
                            onClick: () => copyText("provider,model,cost,tokens,calls\n" + costByModel.map((d) => `${d.provider},${d.fullName},${d.cost},${d.tokens},${d.calls}`).join("\n")),
                        },
                    ]}
                >
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={costByModel} margin={{ top: 8, right: 8, bottom: 48, left: 8 }} className="text-tertiary [&_.recharts-text]:text-xs">
                            <CartesianGrid vertical={false} className="stroke-utility-gray-200" strokeOpacity={0.4} />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} fill="currentColor" interval={0} angle={-28} textAnchor="end" height={60} />
                            <YAxis axisLine={false} tickLine={false} fill="currentColor" tickFormatter={(v) => formatUSD(Number(v))} />
                            <Tooltip content={<ChartTooltipContent />} formatter={(v) => formatUSD(Number(v))} cursor={{ className: "fill-utility-gray-200/20" }} />
                            <Bar dataKey="cost" name="Cost" className="text-utility-brand-600" fill="currentColor" radius={[6, 6, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
            )}
        </div>
    );
};

const DailyLimitCard = ({ limit, costToday, budgetPct, onSave }: { limit: number; costToday: number; budgetPct: number; onSave: (usd: number) => void }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(String(limit || ""));
    useEffect(() => setDraft(String(limit || "")), [limit]);
    const over = limit > 0 && costToday >= limit;
    const parsedDraft = Number(draft);
    const draftValid = draft.trim().length > 0 && Number.isFinite(parsedDraft) && parsedDraft >= 0;
    return (
        <div className="rounded-xl p-5" style={cardStyle}>
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                    <Coins01 className="size-4 text-brand-secondary" />
                    <h2 className="text-sm font-semibold text-primary">Daily spend limit</h2>
                </div>
                <span className="text-xs text-tertiary">{limit > 0 ? <>{formatUSD(costToday)} of {formatUSD(limit)} today{over ? " · limit reached" : ""}</> : "No limit set — agents run unconstrained by budget."}</span>
                <div className="ml-auto flex items-center gap-2">
                    {editing ? (
                        <>
                            <div className="w-28"><Input aria-label="Daily spend limit" type="number" min="0" step="0.01" value={draft} onChange={setDraft} placeholder="0 = none" size="sm" /></div>
                            <Button size="sm" color="primary" isDisabled={!draftValid} onClick={() => { if (!draftValid) return; onSave(parsedDraft); setEditing(false); }}>Save</Button>
                            <Button size="sm" color="secondary" onClick={() => { setDraft(String(limit || "")); setEditing(false); }}>Cancel</Button>
                        </>
                    ) : (
                        <Button size="sm" color="secondary" iconLeading={Edit01} onClick={() => setEditing(true)}>{limit > 0 ? "Edit limit" : "Set limit"}</Button>
                    )}
                </div>
            </div>
            {limit > 0 && (
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${budgetPct}%`, background: over ? "var(--c-error)" : budgetPct > 80 ? "var(--c-warning)" : "var(--c-success)" }} />
                </div>
            )}
        </div>
    );
};

const ChartCard = ({ title, empty, emptyText, children, menuItems }: { title: string; empty: boolean; emptyText: string; children: React.ReactNode; menuItems?: MenuItem[] }) => {
    const body = (
        <div className="rounded-xl p-5" style={cardStyle}>
            <h2 className="text-sm font-semibold text-primary">{title}</h2>
            <div className="mt-4">
                {empty ? <p className="py-16 text-center text-sm text-tertiary">{emptyText}</p> : children}
            </div>
        </div>
    );
    // Right-click the chart area to copy its underlying data or jump to full analytics.
    return menuItems && menuItems.length > 0 ? (
        <ContextMenu items={menuItems} asBlock>
            {body}
        </ContextMenu>
    ) : (
        body
    );
};

const Gauge = ({ label, value, suffix }: { label: string; value: number; suffix: string }) => (
    <div className="flex flex-col items-center gap-2">
        <ProgressBarCircle size="sm" value={value} min={0} max={100} valueFormatter={(v) => `${Math.round(v)}${suffix}`} />
        <span className="text-xs font-medium text-tertiary">{label}</span>
    </div>
);

const Outcome = ({ label, value, color, hint }: { label: string; value: number; color: "success" | "blue" | "gray" | "error"; hint?: string }) => (
    <div className="rounded-lg px-3 py-3" style={{ background: "var(--surface-2)" }} title={hint}>
        <p className="text-display-xs font-semibold text-primary tabular-nums">{value}</p>
        <Badge size="sm" color={color} className="mt-1.5">{label}</Badge>
        {hint && <p className="mt-1 text-[10px] leading-snug text-quaternary">{hint}</p>}
    </div>
);
