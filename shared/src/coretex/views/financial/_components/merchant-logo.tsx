// @ts-nocheck

import { cx } from "@/utils/cx";
import { BrandLogo, brandDomain } from "../../../ui/brand-logo";

/** Best-effort domain for a merchant name, for LogoKit lookups. */
export function merchantDomain(merchant: string | null | undefined): string {
    const cleaned = (merchant ?? "").trim().toLowerCase().replace(/[^a-z0-9.\s-]/g, "").replace(/\s+/g, "");
    if (!cleaned) return "";
    if (cleaned.includes(".")) return cleaned;
    return brandDomain(cleaned);
}

/** Merchant logo via LogoKit with a monogram-tile fallback for unknown brands. */
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
    const dim = size === "md" ? 40 : size === "xs" ? 24 : 32;

    return (
        <span className={cx("inline-flex shrink-0 overflow-hidden rounded-lg ring-1 ring-secondary ring-inset", className)} aria-hidden="true">
            <BrandLogo domain={merchantDomain(name)} name={name} size={dim} />
        </span>
    );
}
