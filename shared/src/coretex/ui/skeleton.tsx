// @ts-nocheck
"use client";

// Coretex — soft, theme-aware skeleton primitives. Uses surface/muted mixes
// (never harsh white) plus a gentle shimmer so loading states feel premium.

import type { CSSProperties } from "react";
import { cx } from "@/utils/cx";

type SkeletonProps = {
    className?: string;
    style?: CSSProperties;
    /** Optional fixed size helpers. */
    w?: number | string;
    h?: number | string;
    rounded?: "sm" | "md" | "lg" | "xl" | "full";
};

const RADIUS: Record<NonNullable<SkeletonProps["rounded"]>, string> = {
    sm: "4px",
    md: "8px",
    lg: "12px",
    xl: "16px",
    full: "9999px",
};

/** A single shimmer bone. Color comes from --skeleton-* tokens in globals.css. */
export const Skeleton = ({ className, style, w, h, rounded = "md" }: SkeletonProps) => (
    <div
        aria-hidden
        className={cx("coretex-skeleton shrink-0", className)}
        style={{
            width: w,
            height: h,
            borderRadius: RADIUS[rounded],
            ...style,
        }}
    />
);

/** A short text-line skeleton. */
export const SkeletonLine = ({ className, w = "100%" }: { className?: string; w?: number | string }) => (
    <Skeleton className={cx("h-3", className)} w={w} rounded="full" />
);

/** Circular avatar placeholder. */
export const SkeletonAvatar = ({ size = 40, className }: { size?: number; className?: string }) => (
    <Skeleton className={className} w={size} h={size} rounded="full" />
);

/** Card-shaped block with optional inner lines. */
export const SkeletonCard = ({
    className,
    lines = 3,
    withAvatar = false,
}: {
    className?: string;
    lines?: number;
    withAvatar?: boolean;
}) => (
    <div
        className={cx("flex flex-col gap-3 rounded-xl p-4", className)}
        style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
    >
        <div className="flex items-center gap-3">
            {withAvatar && <SkeletonAvatar size={36} />}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
                <SkeletonLine w="42%" />
                <SkeletonLine w="28%" />
            </div>
            <Skeleton w={64} h={22} rounded="full" />
        </div>
        <div className="flex flex-col gap-2 pt-1">
            {Array.from({ length: lines }, (_, i) => (
                <SkeletonLine key={i} w={i === lines - 1 ? "55%" : "100%"} />
            ))}
        </div>
    </div>
);

/** Full page loading scaffold used while the Brain connects / first paint. */
export const PageSkeleton = ({ variant = "dashboard" }: { variant?: "dashboard" | "list" | "settings" }) => {
    if (variant === "settings") {
        return (
            <div className="flex h-full w-full" aria-busy aria-label="Loading">
                <div className="flex w-64 shrink-0 flex-col gap-3 p-4" style={{ background: "var(--surface)", borderRight: "1px solid var(--c-border)" }}>
                    <SkeletonLine w="40%" />
                    <Skeleton h={36} rounded="lg" />
                    {Array.from({ length: 8 }, (_, i) => (
                        <Skeleton key={i} h={32} rounded="md" />
                    ))}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-4 p-8">
                    <SkeletonLine w="20%" />
                    <SkeletonCard lines={4} />
                    <SkeletonCard lines={3} />
                    <SkeletonCard lines={5} />
                </div>
            </div>
        );
    }

    if (variant === "list") {
        return (
            <div className="flex w-full flex-col gap-4 p-4 sm:p-6 lg:p-8" aria-busy aria-label="Loading">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-2">
                        <SkeletonLine w={160} />
                        <SkeletonLine w={240} />
                    </div>
                    <Skeleton w={120} h={36} rounded="lg" />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 6 }, (_, i) => (
                        <SkeletonCard key={i} withAvatar lines={2} />
                    ))}
                </div>
            </div>
        );
    }

    // dashboard
    return (
        <div className="flex w-full flex-col gap-5 p-4 sm:p-6 lg:p-8" aria-busy aria-label="Loading">
            <Skeleton className="h-36 w-full" rounded="xl" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={i} className="h-24 w-full" rounded="xl" />
                ))}
            </div>
            <Skeleton className="h-12 w-full" rounded="lg" />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-40 w-full" rounded="xl" />
                ))}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }, (_, i) => (
                    <SkeletonCard key={i} withAvatar lines={3} />
                ))}
            </div>
        </div>
    );
};
