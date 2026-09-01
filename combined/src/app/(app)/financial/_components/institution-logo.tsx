"use client";

import { CompanyLogo } from "@/components/jobs/company-logo";
import type { CompanyLogoSources } from "@/lib/jobs/logos";
import { cx } from "@/utils/cx";

/** Institution logo with upload → remote (LogoKit, favicon, etc.) → monogram fallback. */
export function InstitutionLogo({
    src,
    name,
    size = "sm",
    className,
}: {
    src: CompanyLogoSources | null;
    name: string;
    size?: "sm" | "md";
    className?: string;
}) {
    const dim = size === "md" ? "size-10" : "size-8";
    return (
        <span className={cx(dim, "inline-flex shrink-0 overflow-hidden rounded-lg ring-1 ring-secondary ring-inset", className)} aria-hidden="true">
            <CompanyLogo src={src} alt={name} name={name} className="size-full object-contain" iconClassName="text-[10px]" />
        </span>
    );
}
