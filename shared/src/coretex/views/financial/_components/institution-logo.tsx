// @ts-nocheck

import { cx } from "@/utils/cx";
import { BrandLogo, brandDomain } from "../../../ui/brand-logo";

/** Best-effort domain for an institution — its website if recorded, else a guess from its name. */
export function institutionDomain(institution: { name: string; website?: string | null } | null | undefined): string {
    if (!institution) return "";
    if (institution.website) {
        try {
            return new URL(institution.website.startsWith("http") ? institution.website : `https://${institution.website}`).hostname.replace(/^www\./, "");
        } catch {
            // fall through to the name-based guess below
        }
    }
    return brandDomain(institution.name.toLowerCase().replace(/[^a-z0-9]+/g, ""));
}

/** Institution logo via LogoKit (falls back to a monogram tile when the mark can't be found). */
export function InstitutionLogo({
    institution,
    name,
    size = "sm",
    className,
}: {
    institution?: { name: string; website?: string | null } | null;
    /** Fallback label when no institution record is available. */
    name?: string;
    size?: "sm" | "md";
    className?: string;
}) {
    const dim = size === "md" ? 40 : 32;
    const label = institution?.name ?? name ?? "Institution";
    return (
        <span className={cx("inline-flex shrink-0 overflow-hidden rounded-lg ring-1 ring-secondary ring-inset", className)} aria-hidden="true">
            <BrandLogo domain={institutionDomain(institution)} name={label} size={dim} />
        </span>
    );
}
