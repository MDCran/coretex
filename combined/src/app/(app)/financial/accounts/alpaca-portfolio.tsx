"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, LinkExternal01, RefreshCw01, TrendUp01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { LoadingIndicator } from "@/components/application/loading-indicator/loading-indicator";
import { fetchAlpacaHistory, type AlpacaHistoryPoint, type AlpacaPortfolioData } from "@/lib/actions/financial-alpaca";
import type { AlpacaRange } from "@/lib/financial/alpaca";
import { formatCurrency, formatPercent } from "@/lib/financial/format";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Card, EmptyRow } from "../_components/financial-ui";
import { TrendChart, type TrendPoint } from "../_components/trend-chart";

const RANGES: { id: AlpacaRange; label: string }[] = [
    { id: "1D", label: "1D" },
    { id: "1W", label: "7D" },
    { id: "1M", label: "30D" },
    { id: "6M", label: "6M" },
    { id: "1A", label: "1Y" },
    { id: "ALL", label: "All" },
];

/** Format a chart x-axis label from an epoch ms value, scaled to the active range. */
function pointLabel(t: number, range: AlpacaRange): string {
    return range === "1D" ? formatDateTime(t).replace(/^.*?, /, "") : formatDate(t);
}

/**
 * Live Alpaca portfolio panel: current equity + day change, a value chart with
 * range tabs, and a positions table. All data is fetched through server actions
 * (keys never reach the client); the parent passes the initial server-rendered
 * snapshot, and range changes / refresh re-fetch on demand.
 */
export function AlpacaPortfolio({ initial }: { initial: AlpacaPortfolioData | null }) {
    const [data] = useState<AlpacaPortfolioData | null>(initial);
    const [range, setRange] = useState<AlpacaRange>("1M");
    const [history, setHistory] = useState<AlpacaHistoryPoint[] | null>(null);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [loadingHistory, startHistory] = useTransition();

    useEffect(() => {
        let cancelled = false;
        setHistoryError(null);
        startHistory(async () => {
            try {
                const pts = await fetchAlpacaHistory(range);
                if (!cancelled) setHistory(pts);
            } catch (e) {
                if (!cancelled) {
                    setHistory([]);
                    setHistoryError(e instanceof Error ? e.message : "Could not load history");
                }
            }
        });
        return () => {
            cancelled = true;
        };
    }, [range]);

    if (!data) {
        return (
            <Card className="flex items-center justify-between gap-3">
                <p className="text-sm text-error-primary">Couldn’t load your live Alpaca portfolio. Check your keys in Settings → Integrations.</p>
                <Button size="sm" color="secondary" href="/settings/integrations" iconTrailing={LinkExternal01}>
                    Settings
                </Button>
            </Card>
        );
    }

    const { account, positions } = data;
    const dayChange = account.equity - account.lastEquity;
    const dayChangePct = account.lastEquity !== 0 ? dayChange / account.lastEquity : 0;
    const up = dayChange >= 0;

    const chartData: TrendPoint[] = (history ?? [])
        .filter((p) => p.equity != null)
        .map((p) => ({ label: pointLabel(p.t, range), value: p.equity as number }));

    return (
        <Card className="flex flex-col gap-5 p-0">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-secondary px-5 py-4">
                <div className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                        <h3 className="text-md font-semibold text-primary">Live portfolio</h3>
                        {data.paper ? (
                            <Badge size="sm" color="gray" type="pill-color">
                                Paper
                            </Badge>
                        ) : (
                            <Badge size="sm" color="brand" type="pill-color">
                                Live
                            </Badge>
                        )}
                        <Badge size="sm" color="success" type="pill-color">
                            <span className="inline-flex items-center gap-1">
                                <span className="size-1.5 rounded-full bg-fg-success-primary" aria-hidden="true" />
                                {account.status ? account.status.toLowerCase() : "live"}
                            </span>
                        </Badge>
                    </span>
                    <div className="flex flex-wrap items-baseline gap-3">
                        <p className="text-display-xs font-semibold text-primary">{formatCurrency(account.equity)}</p>
                        <span className={`inline-flex items-center gap-1 text-sm font-medium ${up ? "text-success-primary" : "text-error-primary"}`}>
                            {up ? <ArrowUp className="size-4" aria-hidden="true" /> : <ArrowDown className="size-4" aria-hidden="true" />}
                            {formatCurrency(Math.abs(dayChange))} ({formatPercent(Math.abs(dayChangePct), 2)}) today
                        </span>
                    </div>
                    <p className="text-xs text-tertiary">
                        Cash {formatCurrency(account.cash)} · Buying power {formatCurrency(account.buyingPower)}
                    </p>
                </div>
                <Button size="sm" color="link-color" href="/settings/integrations" iconTrailing={LinkExternal01}>
                    Manage
                </Button>
            </div>

            {/* Value chart with range tabs */}
            <div className="flex flex-col gap-3 px-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-primary">Portfolio value</h4>
                    <div className="flex items-center gap-1 rounded-lg bg-secondary p-0.5">
                        {RANGES.map((r) => (
                            <button
                                key={r.id}
                                type="button"
                                onClick={() => setRange(r.id)}
                                aria-pressed={range === r.id}
                                className={`rounded-md px-2.5 py-1 text-xs font-medium transition duration-100 ease-linear ${
                                    range === r.id ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-tertiary hover:text-secondary"
                                }`}
                            >
                                {r.label}
                            </button>
                        ))}
                        <Button
                            size="sm"
                            color="tertiary"
                            iconLeading={RefreshCw01}
                            isLoading={loadingHistory}
                            aria-label="Refresh chart"
                            onClick={() => {
                                // Re-trigger the effect by toggling state to the same range.
                                startHistory(async () => {
                                    try {
                                        setHistory(await fetchAlpacaHistory(range));
                                        setHistoryError(null);
                                    } catch (e) {
                                        toast.error(e instanceof Error ? e.message : "Refresh failed");
                                    }
                                });
                            }}
                        />
                    </div>
                </div>
                {historyError ? (
                    <div className="flex h-[220px] items-center justify-center text-sm text-error-primary">{historyError}</div>
                ) : history == null || loadingHistory ? (
                    <div className="flex h-[220px] items-center justify-center">
                        <LoadingIndicator type="line-spinner" size="md" label="Loading portfolio…" />
                    </div>
                ) : (
                    <TrendChart data={chartData} series={[{ key: "value", name: "Equity" }]} type="area" fitDomain height={220} emptyLabel="No history for this range" />
                )}
            </div>

            {/* Positions */}
            <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                    <thead>
                        <tr className="border-b border-secondary text-left text-tertiary">
                            <th className="px-5 py-3 font-medium">Symbol</th>
                            <th className="px-5 py-3 text-right font-medium">Qty</th>
                            <th className="px-5 py-3 text-right font-medium">Avg entry</th>
                            <th className="px-5 py-3 text-right font-medium">Price</th>
                            <th className="px-5 py-3 text-right font-medium">Market value</th>
                            <th className="px-5 py-3 text-right font-medium">Unrealized P/L</th>
                        </tr>
                    </thead>
                    <tbody>
                        {positions.length === 0 && (
                            <EmptyRow
                                colSpan={6}
                                icon={TrendUp01}
                                title="No open positions"
                                description="When you hold positions in this linked brokerage, they'll appear here with live prices and unrealized P/L."
                            />
                        )}
                        {positions.map((p) => {
                            const plUp = p.unrealizedPl >= 0;
                            return (
                                <tr key={p.symbol} className="border-b border-secondary last:border-0">
                                    <td className="px-5 py-3 font-medium text-primary">{p.symbol}</td>
                                    <td className="px-5 py-3 text-right text-secondary tabular-nums">{p.qty}</td>
                                    <td className="px-5 py-3 text-right text-tertiary tabular-nums">{formatCurrency(p.avgEntryPrice)}</td>
                                    <td className="px-5 py-3 text-right text-tertiary tabular-nums">{formatCurrency(p.currentPrice)}</td>
                                    <td className="px-5 py-3 text-right font-medium text-primary tabular-nums">{formatCurrency(p.marketValue)}</td>
                                    <td className={`px-5 py-3 text-right font-medium tabular-nums ${plUp ? "text-success-primary" : "text-error-primary"}`}>
                                        {plUp ? "+" : "−"}
                                        {formatCurrency(Math.abs(p.unrealizedPl))} ({formatPercent(Math.abs(p.unrealizedPlpc), 2)})
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}
