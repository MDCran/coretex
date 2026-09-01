"use client";

import { useEffect, useMemo, useState } from "react";
import { logoCandidateUrls, type CompanyLogoSources } from "@/lib/jobs/logos";
import { cx } from "@/utils/cx";

/**
 * Company logo with a multi-step client fallback chain:
 *   uploaded logo → Clearbit → Google favicon → DuckDuckGo → LogoKit → black box
 *
 * Advancing happens on `<img>` `onError` and on `onLoad` when `naturalWidth === 0`.
 * When every candidate fails, a plain black box is shown (no text/initials).
 */
export function CompanyLogo({
    src,
    alt,
    className,
    iconClassName,
}: {
    src: CompanyLogoSources | string | null;
    alt: string;
    /** Accepted for API compatibility; no longer rendered (fallback is a black box). */
    name?: string;
    className?: string;
    /** Extra classes for the black-box fallback (e.g. sizing). */
    iconClassName?: string;
}) {
    const candidates = useMemo(() => logoCandidateUrls(src), [src]);
    const [index, setIndex] = useState(0);

    // Reset when the candidate list changes (e.g. different company row).
    useEffect(() => {
        setIndex(0);
    }, [candidates.join("|")]);

    const current = candidates[index];

    if (!current) {
        return <span aria-hidden="true" className={cx("block size-full rounded-[inherit] bg-black", iconClassName)} />;
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            key={current}
            src={current}
            alt={alt}
            className={className}
            loading="lazy"
            onError={() => setIndex((i) => i + 1)}
            onLoad={(e) => {
                if (e.currentTarget.naturalWidth === 0) setIndex((i) => i + 1);
            }}
        />
    );
}
