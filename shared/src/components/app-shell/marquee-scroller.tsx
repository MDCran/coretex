// @ts-nocheck
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cx } from "@/utils/cx";

/**
 * Overflow-aware scroller for the marquee ticker. Receives ONE rendered copy of the
 * item group (built server-side so item.icon function components render in the RSC
 * tree). Measures whether that single copy overflows its container:
 *   - Not overflowing (also the SSR / pre-measure default): render the group ONCE,
 *     static, left-aligned — no animation, no duplicate flash.
 *   - Overflowing: render the group TWICE inside an animated track (animate-marquee),
 *     reproducing the seamless render-twice scroll. The duplicate copy is aria-hidden.
 * Re-measures on resize via ResizeObserver, cleaned up on unmount.
 */
export function MarqueeScroller({
    children,
    durationSec,
    className,
}: {
    children: ReactNode;
    durationSec: number;
    className?: string;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const [isOverflowing, setIsOverflowing] = useState(false);

    useEffect(() => {
        const container = containerRef.current;
        const track = trackRef.current;
        if (!container || !track) return;

        const measure = () => {
            // The track holds a single copy when not overflowing; compare its content
            // width against the visible container width.
            const overflow = track.scrollWidth > container.clientWidth + 1;
            setIsOverflowing((prev) => (prev === overflow ? prev : overflow));
        };

        measure();

        const observer = new ResizeObserver(measure);
        observer.observe(container);
        observer.observe(track);

        return () => observer.disconnect();
    }, [children]);

    return (
        <div
            ref={containerRef}
            className={cx("flex min-w-0 flex-1 overflow-hidden", className)}
        >
            <div
                ref={trackRef}
                className={cx(
                    "flex shrink-0 items-center",
                    isOverflowing && "animate-marquee group-hover:[animation-play-state:paused] motion-reduce:animate-none",
                )}
                style={isOverflowing ? { animationDuration: `${durationSec}s` } : undefined}
            >
                {children}
            </div>
            {isOverflowing && (
                <div
                    aria-hidden="true"
                    className="flex shrink-0 items-center animate-marquee group-hover:[animation-play-state:paused] motion-reduce:animate-none"
                    style={{ animationDuration: `${durationSec}s` }}
                >
                    {children}
                </div>
            )}
        </div>
    );
}
