"use client";

import { CompanyLogo } from "@/components/jobs/company-logo";
import { merchantLogoSrc } from "@/lib/financial/merchant-logos";
import { cx } from "@/utils/cx";

/** Merchant logo with LogoKit-first remote candidates and monogram fallback. */
export function MerchantLogo({
    merchant,
    size = "sm",
    className,
}: {
    merchant: string | null | undefined;
    size?: "xs" | "sm" | "md";
    className?: string;
}) {
    const name = (merchant ?? "").trim() || "Merchant";
    const dim = size === "md" ? "size-10" : size === "xs" ? "size-6" : "size-8";

    return (
        <span className={cx(dim, "inline-flex shrink-0 overflow-hidden rounded-lg ring-1 ring-secondary ring-inset", className)} aria-hidden="true">
            <CompanyLogo src={merchantLogoSrc(name)} alt="" name={name} className="size-full object-contain" iconClassName={size === "xs" ? "text-[9px]" : "text-[10px]"} />
        </span>
    );
}
