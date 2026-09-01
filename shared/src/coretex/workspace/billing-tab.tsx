// @ts-nocheck
"use client";

// Coretex Relay — per-project billing tab. Pulls a per-project CostSummary from
// the Brain on mount, then renders spend totals, provider/agent breakdowns, a
// budget control with progress, a small recharts bar of all-time vs today, and a
// CSV export of the agent + provider breakdowns.

import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import type { CostAgentBucket, CostBucket, CostSummary, Project, ProviderType } from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Input } from "@/components/base/input/input";
import { ChartTooltipContent } from "@/components/application/charts/charts-base";
import { Wallet02, RefreshCcw01, ArrowRight } from "@untitledui/icons";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { formatTokens, formatUSD } from "../use-coretex";
import { providerLabel } from "../labels";

interface Props {
    project: Project;
    state: CoretexState;
    actions: CoretexActions;
}

interface StatCardProps {
    label: string;
    value: string;
}

const cardStyle = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;

const StatCard = ({ label, value }: StatCardProps) => (
    <div className="rounded-xl p-4" style={cardStyle}>
        <p className="text-xs text-tertiary">{label}</p>
        <p className="mt-1 text-display-xs font-semibold text-primary">{value}</p>
    </div>
);

/** Pick a budget-progress color token based on percent used. */
function budgetColor(pct: number): string {
    if (pct >= 100) return "var(--c-error)";
    if (pct >= 80) return "var(--c-warning)";
    return "var(--c-success)";
}

/** Escape a value for inclusion in a CSV cell. */
function csvCell(value: string | number): string {
    const s = String(value);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

export const BillingTab = ({ project, state, actions }: Props) => {
    const b: CostSummary | undefined = state.projectBilling[project.id];

    const [budgetInput, setBudgetInput] = useState<string>(String(project.budgetUSD ?? ""));

    useEffect(() => {
        actions.getProjectBilling(project.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project.id]);

    const allTime = b?.totalCostAllTime ?? 0;
    const today = b?.totalCostToday ?? 0;
    const budget = project.budgetUSD ?? 0;

    const agentName = (agentId: string): string => {
        const agent = state.agents.find((a) => a.id === agentId);
        return agent?.config.name ?? agentId;
    };

    const providerRows: { provider: ProviderType; bucket: CostBucket }[] = useMemo(() => {
        if (!b) return [];
        return (Object.entries(b.byProvider) as [ProviderType, CostBucket | undefined][])
            .filter((entry): entry is [ProviderType, CostBucket] => entry[1] !== undefined)
            .map(([provider, bucket]) => ({ provider, bucket }))
            .sort((x, y) => y.bucket.cost - x.bucket.cost);
    }, [b]);

    const agentRows: { agentId: string; bucket: CostAgentBucket }[] = useMemo(() => {
        if (!b) return [];
        return Object.entries(b.byAgent)
            .map(([agentId, bucket]) => ({ agentId, bucket }))
            .sort((x, y) => y.bucket.cost - x.bucket.cost);
    }, [b]);

    // We only have aggregate summaries from the Brain (no per-day series), so the
    // chart degrades to two bars: all-time and today.
    const chartData = useMemo(
        () => [
            { label: "All-time", value: Number(allTime.toFixed(4)) },
            { label: "Today", value: Number(today.toFixed(4)) },
        ],
        [allTime, today],
    );

    const budgetPct = budget > 0 ? Math.min(100, (allTime / budget) * 100) : 0;

    const handleSetBudget = (): void => {
        actions.setProjectBudget(project.id, Number(budgetInput) || 0);
    };

    const handleExportCsv = (): void => {
        const lines: string[] = ["section,name,cost_usd,tokens"];
        for (const row of providerRows) {
            lines.push([csvCell("provider"), csvCell(providerLabel(row.provider)), csvCell(row.bucket.cost), csvCell(row.bucket.tokens)].join(","));
        }
        for (const row of agentRows) {
            lines.push([csvCell("agent"), csvCell(agentName(row.agentId)), csvCell(row.bucket.cost), csvCell(row.bucket.tokens)].join(","));
        }
        const csv = lines.join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `project-${project.id}-billing.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex flex-col gap-5">
            {/* Header + actions */}
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-primary">Billing & Usage</h2>
                <div className="flex items-center gap-2">
                    <Button size="sm" color="secondary" iconLeading={RefreshCcw01} onClick={() => actions.getProjectBilling(project.id)}>
                        Refresh
                    </Button>
                    <Button size="sm" color="secondary" iconLeading={ArrowRight} onClick={handleExportCsv}>
                        Export CSV
                    </Button>
                </div>
            </div>

            {/* Top stat cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCard label="Spend today" value={formatUSD(today)} />
                <StatCard label="Spend all-time" value={formatUSD(allTime)} />
                <StatCard label="Tokens all-time" value={formatTokens(b?.totalTokensAllTime ?? 0)} />
            </div>

            {/* By-day (aggregate) chart */}
            <div className="rounded-xl p-5" style={cardStyle}>
                <h2 className="text-sm font-semibold text-primary">Spend overview</h2>
                <p className="mt-0.5 text-xs text-tertiary">All-time vs today (USD)</p>
                <div className="mt-4" style={{ width: "100%", height: 180 }}>
                    <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={chartData}>
                            <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="var(--c-border)" />
                            <YAxis tick={{ fontSize: 12 }} stroke="var(--c-border)" />
                            <Tooltip
                                cursor={{ fill: "var(--c-border)", opacity: 0.3 }}
                                content={
                                    (
                                        <ChartTooltipContent formatter={((value: number | string) => formatUSD(Number(value))) as never} />
                                    ) as never
                                }
                            />
                            <Bar dataKey="value" fill="var(--brand)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Budget card */}
            <div className="rounded-xl p-5" style={cardStyle}>
                <div className="flex items-center gap-2">
                    <Wallet02 className="size-4 text-tertiary" />
                    <h2 className="text-sm font-semibold text-primary">Project budget</h2>
                </div>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="sm:max-w-xs sm:flex-1">
                        <Input
                            label="Budget (USD)"
                            placeholder="0"
                            value={budgetInput}
                            onChange={(value: string) => setBudgetInput(value)}
                        />
                    </div>
                    <Button size="md" color="primary" onClick={handleSetBudget}>
                        Set budget
                    </Button>
                </div>

                {budget > 0 && (
                    <div className="mt-4">
                        <div className="bg-secondary h-2 w-full overflow-hidden rounded-full">
                            <div
                                className="h-2 rounded-full transition-all"
                                style={{ width: `${budgetPct}%`, background: budgetColor(budgetPct) }}
                            />
                        </div>
                        <p className="mt-2 text-xs text-tertiary">
                            {formatUSD(allTime)} / {formatUSD(budget)}
                        </p>
                    </div>
                )}
            </div>

            {/* Breakdowns */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* By provider */}
                <div className="rounded-xl p-5" style={cardStyle}>
                    <h2 className="text-sm font-semibold text-primary">By provider</h2>
                    <div className="mt-3 flex flex-col gap-2">
                        {providerRows.length === 0 && <p className="text-xs text-tertiary">No provider usage recorded yet.</p>}
                        {providerRows.map(({ provider, bucket }) => (
                            <div key={provider} className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-2">
                                    <Badge type="pill-color" size="sm" color="brand">
                                        {providerLabel(provider)}
                                    </Badge>
                                    <span className="truncate text-xs text-tertiary">{formatTokens(bucket.tokens)} tokens</span>
                                </div>
                                <span className="shrink-0 text-sm font-medium text-primary">{formatUSD(bucket.cost)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* By agent */}
                <div className="rounded-xl p-5" style={cardStyle}>
                    <h2 className="text-sm font-semibold text-primary">By agent</h2>
                    <div className="mt-3 flex flex-col gap-2">
                        {agentRows.length === 0 && <p className="text-xs text-tertiary">No agent usage recorded yet.</p>}
                        {agentRows.map(({ agentId, bucket }) => (
                            <div key={agentId} className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-sm font-medium text-primary" title={agentName(agentId)}>{agentName(agentId)}</span>
                                    <span className="text-xs text-tertiary">{formatTokens(bucket.tokens)} tokens</span>
                                </div>
                                <span className="shrink-0 text-sm font-medium text-primary">{formatUSD(bucket.cost)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
