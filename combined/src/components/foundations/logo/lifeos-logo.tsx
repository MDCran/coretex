"use client";

import type { SVGProps } from "react";
import { useId } from "react";
import { cx } from "@/utils/cx";

/**
 * LifeOS brand mark — rounded square with a layered orbit symbol in brand red (#ef4242).
 * Distinct from the default Untitled UI purple logo.
 */
export const LifeOSLogoMark = (props: SVGProps<SVGSVGElement>) => {
    const id = useId();

    return (
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props} className={cx("size-8 shrink-0", props.className)}>
            <rect x="1" y="1" width="30" height="30" rx="9" fill={`url(#lifeos-bg-${id})`} />
            <rect x="1" y="1" width="30" height="30" rx="9" stroke="rgb(0 0 0 / 0.08)" strokeWidth="0.5" />
            {/* Outer orbit */}
            <circle cx="16" cy="16" r="8.5" stroke="white" strokeWidth="1.75" strokeOpacity="0.9" />
            {/* Inner orbit — offset for a distinctive "life systems" look */}
            <ellipse cx="16" cy="16" rx="5.5" ry="3.25" stroke="white" strokeWidth="1.5" strokeOpacity="0.75" transform="rotate(-32 16 16)" />
            {/* Core dot */}
            <circle cx="16" cy="16" r="2.25" fill="white" />
            <defs>
                <linearGradient id={`lifeos-bg-${id}`} x1="6" y1="4" x2="26" y2="28" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#f87171" />
                    <stop offset="1" stopColor="#ef4242" />
                </linearGradient>
            </defs>
        </svg>
    );
};

/** Logo mark with optional wordmark. */
export const LifeOSLogo = ({
    showWordmark = true,
    className,
    markClassName,
}: {
    showWordmark?: boolean;
    className?: string;
    markClassName?: string;
}) => (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
        <LifeOSLogoMark className={markClassName} />
        {showWordmark && <span className="text-lg font-semibold text-primary">LifeOS</span>}
    </span>
);
