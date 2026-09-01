// @ts-nocheck
import { cx } from "@/utils/cx";

/**
 * Tiny inline bar sparkline (server-renderable, no client JS). Visualizes a
 * series of weekly activity counts as the "monitor" for a connection.
 */
export function Sparkline({ data, className }: { data: number[]; className?: string }) {
    const max = Math.max(1, ...data);
    return (
        <div className={cx("flex h-8 items-end gap-0.5", className)} aria-hidden="true">
            {data.map((v, i) => (
                <div
                    key={i}
                    className={cx("min-h-px flex-1 rounded-sm", v > 0 ? "bg-fg-brand-primary" : "bg-quaternary")}
                    style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
                />
            ))}
        </div>
    );
}
