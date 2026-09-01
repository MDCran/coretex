// @ts-nocheck
"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  BarChartSquare02,
  Coins01,
  Users01,
  Zap,
} from "@untitledui/icons";
import type { CostAgentBucket, CostBucket } from "@repo/coretex/types";
import { ProgressBarCircle } from "@/components/base/progress-indicators/progress-circles";
import {
  ButtonGroup,
  ButtonGroupItem,
} from "@/components/base/button-group/button-group";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import type { CoretexState, CoretexActions } from "../use-coretex";
import { formatUSD, formatTokens } from "../use-coretex";
import { providerLabel } from "../labels";
import type { NavTarget } from "../nav";
import { providerLogoDomain } from "../provider-meta";
import { BrandLogo } from "../ui/brand-logo";

type Range = "today" | "all";

interface CostMeterProps {
  state: CoretexState;
  actions: CoretexActions;
  onNavigate?: (target: NavTarget) => void;
}

export const CostMeter = ({ state, onNavigate }: CostMeterProps) => {
  const [range, setRange] = useState<Range>("today");
  const c = state.cost;

  const totalCostToday = c?.totalCostToday ?? 0;
  const totalCostAllTime = c?.totalCostAllTime ?? 0;
  const totalTokensToday = c?.totalTokensToday ?? 0;
  const totalTokensAllTime = c?.totalTokensAllTime ?? 0;
  const totalCost = range === "today" ? totalCostToday : totalCostAllTime;
  const totalTokens = range === "today" ? totalTokensToday : totalTokensAllTime;
  const hasLimit = Boolean(c && c.dailyLimit > 0);
  const budgetMax = hasLimit ? c!.dailyLimit : Math.max(5, totalCostToday);
  const budgetPct = hasLimit
    ? Math.min(100, Math.round((totalCostToday / c!.dailyLimit) * 100))
    : 0;
  const limitReached = hasLimit && totalCostToday >= c!.dailyLimit;

  const providerEntries = useMemo(
    () =>
      (
        Object.entries(c?.byProvider ?? {}) as [
          string,
          CostBucket | undefined,
        ][]
      )
        .filter((entry): entry is [string, CostBucket] => Boolean(entry[1]))
        .sort((a, b) => b[1].cost - a[1].cost),
    [c?.byProvider],
  );

  const agentEntries = useMemo(
    () =>
      (Object.entries(c?.byAgent ?? {}) as [string, CostAgentBucket][])
        .map(([id, bucket]) => ({
          id,
          name:
            state.agents.find((agent) => agent.id === id)?.config.name ??
            id.slice(0, 8),
          cost: range === "today" ? bucket.costToday : bucket.cost,
          tokens: range === "today" ? bucket.tokensToday : bucket.tokens,
        }))
        .filter((row) => row.cost > 0 || row.tokens > 0)
        .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens),
    [c?.byAgent, range, state.agents],
  );

  const topAgent = agentEntries[0];
  const hasAnyUsage = totalCostAllTime > 0 || totalTokensAllTime > 0;
  const openAnalytics = () => onNavigate?.({ kind: "usage" });

  return (
    <section className="flex min-h-[25rem] flex-col rounded-xl border border-secondary bg-primary p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-secondary text-fg-quaternary">
              <Coins01 className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-primary">
                Cost &amp; usage
              </h2>
              <p className="text-xs text-tertiary">Live workspace spend</p>
            </div>
          </div>
        </div>
        {onNavigate && (
          <Button
            size="sm"
            color="link-color"
            iconTrailing={ArrowRight}
            onClick={openAnalytics}
          >
            Analytics
          </Button>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <ButtonGroup
          size="sm"
          selectedKeys={[range]}
          onSelectionChange={(keys) => {
            const next = [...keys][0] as Range | undefined;
            if (next) setRange(next);
          }}
          aria-label="Cost range"
        >
          <ButtonGroupItem id="today" className="px-3 py-1.5 text-xs">
            Today
          </ButtonGroupItem>
          <ButtonGroupItem id="all" className="px-3 py-1.5 text-xs">
            All time
          </ButtonGroupItem>
        </ButtonGroup>
        <span className="text-[11px] text-quaternary">
          Updates after every model turn
        </span>
      </div>

      {!hasAnyUsage ? (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-secondary bg-secondary/30 px-5 py-8 text-center">
          <span className="grid size-10 place-items-center rounded-lg bg-secondary text-fg-quaternary">
            <BarChartSquare02 className="size-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-secondary">
            No model usage recorded yet
          </p>
          <p className="mt-1 max-w-56 text-xs leading-relaxed text-quaternary">
            Costs and tokens will appear after an agent, chat, plan, or council
            run completes.
          </p>
          {onNavigate && (
            <Button
              size="sm"
              color="secondary"
              iconTrailing={ArrowRight}
              className="mt-4"
              onClick={openAnalytics}
            >
              Open usage analytics
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-5 rounded-xl bg-secondary/40 p-4">
            {range === "today" ? (
              <ProgressBarCircle
                size="md"
                value={totalCostToday}
                min={0}
                max={budgetMax}
                label={hasLimit ? `${budgetPct}%` : "Today"}
                valueFormatter={(value) => formatUSD(value)}
              />
            ) : (
              <span className="grid size-24 shrink-0 place-items-center rounded-2xl bg-secondary text-brand-secondary">
                <Coins01 className="size-8" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-tertiary">
                {range === "today" ? "Spent today" : "All-time spend"}
              </p>
              <p className="mt-1 text-display-sm font-semibold text-primary tabular-nums">
                {formatUSD(totalCost)}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-quaternary">
                <Zap className="size-3.5" /> {formatTokens(totalTokens)} tokens
              </p>
              {range === "today" && (
                <p
                  className={cx(
                    "mt-2 text-xs",
                    limitReached
                      ? "text-error-primary"
                      : hasLimit
                        ? "text-tertiary"
                        : "text-quaternary",
                  )}
                >
                  {hasLimit
                    ? limitReached
                      ? `Daily limit reached / ${formatUSD(c!.dailyLimit)}`
                      : `${formatUSD(c!.dailyLimitRemaining)} remaining of ${formatUSD(c!.dailyLimit)}`
                    : "No daily spend limit configured"}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={!onNavigate}
            onClick={openAnalytics}
            className={cx(
              "mt-3 flex items-center gap-3 rounded-lg border border-secondary px-3 py-2.5 text-left transition",
              onNavigate &&
                "group cursor-pointer hover:border-primary hover:bg-primary_hover",
            )}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-fg-quaternary">
              <Users01 className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium text-tertiary">
                Top agent / {range === "today" ? "today" : "all time"}
              </span>
              <span className="mt-0.5 block truncate text-sm font-semibold text-primary">
                {topAgent?.name ?? "No agent usage in this range"}
              </span>
            </span>
            {topAgent && (
              <span className="shrink-0 text-right text-xs text-tertiary tabular-nums">
                <span className="block font-medium text-primary">
                  {formatUSD(topAgent.cost)}
                </span>
                <span>{formatTokens(topAgent.tokens)} tokens</span>
              </span>
            )}
            {onNavigate && (
              <ArrowRight className="size-4 shrink-0 text-fg-quaternary transition group-hover:translate-x-0.5 group-hover:text-fg-quaternary_hover" />
            )}
          </button>

          <div className="mt-4 border-t border-secondary pt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-secondary">
                Provider totals
              </p>
              <span className="text-[11px] text-quaternary">All time</span>
            </div>
            {providerEntries.length === 0 ? (
              <p className="rounded-lg bg-secondary/40 px-3 py-3 text-xs text-tertiary">
                Tokens were recorded, but no provider spend is available yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {providerEntries.slice(0, 3).map(([provider, bucket]) => (
                  <li key={provider}>
                    <button
                      type="button"
                      disabled={!onNavigate}
                      onClick={openAnalytics}
                      className={cx(
                        "group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition",
                        onNavigate && "cursor-pointer hover:bg-primary_hover",
                      )}
                    >
                      <BrandLogo
                        domain={providerLogoDomain(provider)}
                        name={providerLabel(provider)}
                        size={24}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary">
                        {providerLabel(provider)}
                      </span>
                      <span className="text-right text-[11px] text-tertiary tabular-nums">
                        <span className="block font-medium text-primary">
                          {formatUSD(bucket.cost)}
                        </span>
                        <span>{formatTokens(bucket.tokens)} tokens</span>
                      </span>
                      {onNavigate && (
                        <ArrowRight className="size-3.5 shrink-0 text-fg-quaternary opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {providerEntries.length > 3 && onNavigate && (
              <button
                type="button"
                onClick={openAnalytics}
                className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-brand-secondary transition hover:bg-primary_hover"
              >
                View {providerEntries.length - 3} more provider
                {providerEntries.length - 3 === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
};
