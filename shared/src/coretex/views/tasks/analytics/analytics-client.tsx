// @ts-nocheck
import { Stat } from "@/components/life/life-ui";
import { cx } from "@/utils/cx";
import { BarChartSquare02, ArrowLeft } from "@untitledui/icons";
import { formatDuration } from "date-fns";
import { Button } from "react-aria-components";
import { Card } from "../../social/ui";



/** Bar list: label + done/total with a proportional fill. */
function RateBars({ rows, labelFor }: { rows: RateBreakdown[]; labelFor?: (k: string) => string }) {
    if (rows.length === 0) return <p className="text-sm text-tertiary">No data yet.</p>;
    return (
        <div className="flex flex-col gap-2.5">
            {rows.map((r) => (
                <div key={r.key} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-secondary">{labelFor ? labelFor(r.key) : r.key}</span>
                        <span className="tabular-nums text-tertiary">
                            {r.done}/{r.total} · {Math.round(r.rate * 100)}%
                        </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-quaternary">
                        <div className="h-full rounded-full bg-brand-solid transition-all" style={{ width: `${Math.round(r.rate * 100)}%` }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

const HEAT_LEVELS = ["bg-secondary", "bg-utility-blue-500/25", "bg-utility-blue-500/50", "bg-utility-blue-500/75", "bg-utility-blue-500"];

/** A 7×weeks workload heatmap shaded by scheduled minutes. */
function Heatmap({ load, heatStart, weeks }: { load: DayLoad[]; heatStart: string; weeks: number }) {
    const byDay = new Map(load.map((d) => [d.day, d]));
    const maxMin = Math.max(60, ...load.map((d) => d.minutes));
    const start = new Date(heatStart + "T00:00:00.000Z");
    const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];

    const level = (min: number) => {
        if (min <= 0) return 0;
        return Math.min(4, 1 + Math.floor((min / maxMin) * 3.999));
    };

    return (
        <div className="flex gap-2">
            <div className="flex flex-col gap-1 pt-0.5">
                {dayLabels.map((d, i) => (
                    <span key={i} className="h-4 text-[10px] leading-4 text-quaternary">
                        {d}
                    </span>
                ))}
            </div>
            <div className="flex gap-1 overflow-x-auto">
                {Array.from({ length: weeks }, (_, w) => (
                    <div key={w} className="flex flex-col gap-1">
                        {Array.from({ length: 7 }, (_, d) => {
                            const cell = new Date(start.getTime() + (w * 7 + d) * 86400000);
                            const key = cell.toISOString().slice(0, 10);
                            const info = byDay.get(key);
                            const min = info?.minutes ?? 0;
                            const future = cell.getTime() > Date.now();
                            return (
                                <span
                                    key={d}
                                    title={`${key}: ${info ? `${info.count} task${info.count === 1 ? "" : "s"} · ${formatDuration(min) || "0m"}` : "nothing"}`}
                                    className={cx("size-4 rounded-[3px]", future ? "bg-secondary/40" : HEAT_LEVELS[level(min)])}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function AnalyticsClient({ analytics, load, heatStart, weeks }: { analytics: TodoAnalytics; load: DayLoad[]; heatStart: string; weeks: number }) {
    const total = analytics.totalDone + analytics.totalSkipped + analytics.totalOpen;
    return (
        <div className="page-shell flex flex-col gap-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                    <h1 className="module-title flex items-center gap-2">
                        <BarChartSquare02 className="size-6 text-brand-secondary" aria-hidden="true" /> To-do analytics
                    </h1>
                    <p className="text-sm text-tertiary sm:text-md">Last 30 days · {total} tasks</p>
                </div>
                <Button href="/todos" color="secondary" size="md" iconLeading={ArrowLeft}>
                    Back to to-dos
                </Button>
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Completed" value={analytics.totalDone} sub={`${Math.round(analytics.completionRate * 100)}% completion`} />
                <Stat label="Skipped" value={analytics.totalSkipped} />
                <Stat label="Still open" value={analytics.totalOpen} />
                <Stat label="Avg estimate" value={formatDuration(analytics.avgDurationMin) || "—"} sub="per task" />
            </div>

            <Card className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold text-primary">Workload heatmap</h2>
                <p className="-mt-2 text-sm text-tertiary">Scheduled minutes per day over the last {weeks} weeks.</p>
                <Heatmap load={load} heatStart={heatStart} weeks={weeks} />
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card className="flex flex-col gap-4">
                    <h2 className="text-lg font-semibold text-primary">Completion by category</h2>
                    <RateBars rows={analytics.byCategory} />
                </Card>
                <Card className="flex flex-col gap-4">
                    <h2 className="text-lg font-semibold text-primary">Completion by priority</h2>
                    <RateBars rows={analytics.byPriority} labelFor={(k) => TODO_PRIORITY_LABEL[k as TodoPriorityValue] ?? k} />
                </Card>
            </div>

            <Card className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold text-primary">Most-skipped</h2>
                {analytics.mostSkipped.length === 0 ? (
                    <p className="text-sm text-tertiary">Nothing skipped — nice.</p>
                ) : (
                    <ul className="flex flex-col gap-1.5">
                        {analytics.mostSkipped.map((m) => (
                            <li key={m.key} className="flex items-center justify-between text-sm">
                                <span className="text-secondary">{m.key}</span>
                                <span className="tabular-nums text-warning-primary">{m.skipped} skipped</span>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
}
