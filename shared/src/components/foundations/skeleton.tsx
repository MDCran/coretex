import type { ComponentPropsWithRef } from "react";
import { cx } from "@/utils/cx";

/**
 * Base shimmer block. Compose these into page-shaped skeletons so loading states
 * mirror the real layout instead of a generic spinner.
 */
export function Skeleton({ className, ...props }: ComponentPropsWithRef<"div">) {
    return <div aria-hidden="true" className={cx("animate-pulse rounded-md bg-secondary motion-reduce:animate-none", className)} {...props} />;
}

/** A few lines of text; the last line is shorter for realism. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
    return (
        <div className={cx("flex flex-col gap-2", className)}>
            {Array.from({ length: lines }).map((_, i) => (
                <Skeleton key={i} className={cx("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} />
            ))}
        </div>
    );
}

/** Stat tile placeholder (label + big value). */
export function SkeletonStat({ className }: { className?: string }) {
    return (
        <div className={cx("flex flex-col gap-3 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset", className)}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-16" />
        </div>
    );
}

/** Grid of stat tiles. */
export function SkeletonStatGrid({ count = 4, className }: { count?: number; className?: string }) {
    return (
        <div className={cx("grid grid-cols-2 gap-4 lg:grid-cols-4", className)}>
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonStat key={i} />
            ))}
        </div>
    );
}

/** Generic card placeholder (header + body). */
export function SkeletonCard({ className, lines = 4 }: { className?: string; lines?: number }) {
    return (
        <div className={cx("flex flex-col gap-4 rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset", className)}>
            <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
            <SkeletonText lines={lines} />
        </div>
    );
}

/** List of rows (avatar + two lines). */
export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
    return (
        <div className={cx("flex flex-col divide-y divide-secondary rounded-xl bg-primary ring-1 ring-secondary ring-inset", className)}>
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-4">
                    <Skeleton className="size-10 shrink-0 rounded-full" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <Skeleton className="h-3.5 w-1/3" />
                        <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-8 w-16 rounded-lg" />
                </div>
            ))}
        </div>
    );
}

/** Chart placeholder with faux bars. */
export function SkeletonChart({ className, height = 240 }: { className?: string; height?: number }) {
    return (
        <div className={cx("rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset", className)}>
            <Skeleton className="mb-4 h-4 w-40" />
            <div className="flex items-end gap-2" style={{ height }}>
                {[60, 80, 45, 95, 70, 55, 88, 40, 75, 90, 50, 65].map((h, i) => (
                    <Skeleton key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%` }} />
                ))}
            </div>
        </div>
    );
}

/** Table placeholder (header + rows). */
export function SkeletonTable({ rows = 6, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
    return (
        <div className={cx("overflow-hidden rounded-xl bg-primary ring-1 ring-secondary ring-inset", className)}>
            <div className="flex gap-4 border-b border-secondary p-4">
                {Array.from({ length: cols }).map((_, i) => (
                    <Skeleton key={i} className="h-3.5 flex-1" />
                ))}
            </div>
            {Array.from({ length: rows }).map((_, r) => (
                <div key={r} className="flex gap-4 border-b border-secondary p-4 last:border-0">
                    {Array.from({ length: cols }).map((_, c) => (
                        <Skeleton key={c} className={cx("h-3.5 flex-1", c === 0 && "max-w-40")} />
                    ))}
                </div>
            ))}
        </div>
    );
}
