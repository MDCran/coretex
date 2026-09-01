import { cx } from "@/utils/cx";

/**
 * GitHub-style activity heatmap.
 *
 * Renders a contribution-graph-style grid of fixed-size squares: columns are
 * weeks and the 7 rows are days of the week (Sunday top → Saturday bottom).
 * Intensity is mapped from each day's `count` relative to `max`, day-of-week
 * labels sit on the left, abbreviated month labels sit on top, and a Less→More
 * legend sits at the bottom. Purely presentational and server-safe — no client
 * directive, no hooks.
 *
 * The `cells` prop must be chronological (oldest first) with length = weeks * 7,
 * each `day` formatted as "yyyy-MM-dd". `max` is the peak daily count.
 */

interface HeatCell {
    /** Calendar day formatted as "yyyy-MM-dd". */
    day: string;
    /** Number of events on that day. */
    count: number;
}

interface ActivityHeatmapProps {
    cells: HeatCell[];
    max: number;
}

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""] as const;

/** Map an intensity (count relative to max) to a semantic background token. */
function intensityClass(count: number, max: number): string {
    if (max <= 0 || count <= 0) return "bg-secondary";

    const ratio = count / max;
    if (ratio <= 0.33) return "bg-brand-solid opacity-40";
    if (ratio <= 0.66) return "bg-brand-solid opacity-70";
    return "bg-brand-solid";
}

/** Parse a "yyyy-MM-dd" day into a local Date at midnight. */
function parseDay(day: string): Date {
    return new Date(`${day}T00:00:00`);
}

export function ActivityHeatmap({ cells, max }: ActivityHeatmapProps) {
    // Determine how many empty placeholders to prepend so the first real cell
    // lands in its correct weekday row (Sun=0 .. Sat=6).
    const leadingOffset = cells.length > 0 ? parseDay(cells[0]!.day).getDay() : 0;
    const totalCells = leadingOffset + cells.length;
    const columnCount = Math.ceil(totalCells / 7);

    // Compute the month label for each column. A label is shown only on the
    // first column whose representative (top-row) date enters a new month.
    const monthLabels: string[] = new Array(columnCount).fill("");
    let previousMonth = -1;
    for (let col = 0; col < columnCount; col++) {
        // The top-row cell of this column is at grid index col * 7.
        const cellIndex = col * 7 - leadingOffset;
        const cell = cellIndex >= 0 ? cells[cellIndex] : undefined;
        if (!cell) continue;

        const month = parseDay(cell.day).getMonth();
        if (month !== previousMonth) {
            monthLabels[col] = parseDay(cell.day).toLocaleDateString("en-US", { month: "short" });
            previousMonth = month;
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-start gap-[3px]">
                {/* Day-of-week labels (left, fixed width) */}
                <div className="shrink-0 pt-[19px]">
                    <div className="grid grid-rows-7 gap-[3px]">
                        {DAY_LABELS.map((label, index) => (
                            <div key={index} className="flex h-3 items-center justify-end pr-1 text-xs text-tertiary">
                                {label}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Scrollable month labels + week columns */}
                <div className="scrollbar-hide flex-1 overflow-x-auto">
                    <div className="inline-flex flex-col gap-[3px]">
                        {/* Month labels (top) */}
                        <div className="grid grid-flow-col gap-[3px]" style={{ gridAutoColumns: "12px" }}>
                            {monthLabels.map((label, col) => (
                                <div key={col} className="h-4 whitespace-nowrap text-xs text-tertiary">
                                    {label}
                                </div>
                            ))}
                        </div>

                        {/* Week columns: 7 rows = days, columns flow left→right */}
                        <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
                            {Array.from({ length: leadingOffset }).map((_, index) => (
                                <div key={`pad-${index}`} aria-hidden className="size-3" />
                            ))}
                            {cells.map((c) => {
                                const date = parseDay(c.day);
                                const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                                const unit = c.count === 1 ? "application" : "applications";
                                return (
                                    <div
                                        key={c.day}
                                        title={`${label} — ${c.count} ${unit}`}
                                        className={cx("size-3 rounded-[2px]", intensityClass(c.count, max))}
                                    />
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-end gap-1 text-xs text-tertiary">
                Less
                <span className="size-3 rounded-[2px] bg-secondary" />
                <span className="size-3 rounded-[2px] bg-brand-solid opacity-40" />
                <span className="size-3 rounded-[2px] bg-brand-solid opacity-70" />
                <span className="size-3 rounded-[2px] bg-brand-solid" />
                More
            </div>
        </div>
    );
}
