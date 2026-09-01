import type { FC } from "react";
import Link from "next/link";
import { cx } from "@/utils/cx";
import { MarqueeScroller } from "./marquee-scroller";

export interface TickerItem {
    id: string;
    label: string;
    href?: string;
    icon?: FC<{ className?: string }>;
    tone?: "default" | "brand" | "success" | "warning" | "error";
}

const TONE_DOT: Record<NonNullable<TickerItem["tone"]>, string> = {
    default: "bg-fg-quaternary",
    brand: "bg-brand-solid",
    success: "bg-success-solid",
    warning: "bg-warning-solid",
    error: "bg-error-solid",
};

/**
 * Breaking-news style ticker. Server-safe component (no "use client") so the dashboard
 * Server Component can pass item.icon as React function components — icons render in the
 * RSC tree. MarqueeTicker builds a SINGLE rendered copy of the item group and delegates
 * scroll/measure to the client {@link MarqueeScroller}, which is overflow-aware: a
 * non-overflowing (or reduced-motion) ticker shows each item exactly once, statically;
 * only when content overflows does it duplicate the group and scroll (seamless
 * render-twice trick). Pauses on hover, edge-masked, respects prefers-reduced-motion.
 */
export function MarqueeTicker({
    items,
    label,
    durationSec = 40,
    className,
}: {
    items: TickerItem[];
    label?: string;
    durationSec?: number;
    className?: string;
}) {
    if (items.length === 0) return null;

    const Item = ({ item }: { item: TickerItem }) => {
        const Icon = item.icon;
        const inner = (
            <span className="flex shrink-0 items-center gap-2 text-sm text-secondary transition-colors duration-100 ease-linear group-hover/item:text-primary">
                <span className={cx("size-1.5 rounded-full", TONE_DOT[item.tone ?? "default"])} aria-hidden="true" />
                {Icon && <Icon className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />}
                {item.label}
            </span>
        );
        return item.href ? (
            <Link href={item.href} className="group/item shrink-0">
                {inner}
            </Link>
        ) : (
            <span className="group/item shrink-0">{inner}</span>
        );
    };

    // One rendered copy of the item group. The client scroller duplicates this node
    // only when it measures the content as overflowing.
    const group = (
        <div className="flex shrink-0 items-center gap-8 pr-8">
            {items.map((item) => (
                <Item key={item.id} item={item} />
            ))}
        </div>
    );

    return (
        <div className={cx("group flex items-center gap-3 overflow-hidden rounded-xl bg-primary px-3 py-2.5 ring-1 ring-secondary ring-inset", className)}>
            {label && (
                <span className="z-10 flex shrink-0 items-center gap-1.5 rounded-md bg-brand-solid px-2 py-1 text-xs font-semibold tracking-wide text-white uppercase">
                    <span className="size-1.5 animate-pulse rounded-full bg-white motion-reduce:animate-none" aria-hidden="true" />
                    {label}
                </span>
            )}
            <MarqueeScroller durationSec={durationSec} className="[mask-image:linear-gradient(to_right,transparent,black_4%,black_96%,transparent)]">
                {group}
            </MarqueeScroller>
        </div>
    );
}
