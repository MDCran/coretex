// @ts-nocheck
import { companyLogoSrc, type CompanyLogoSources } from "@/lib/jobs/logos";

const GENERIC_MERCHANTS = new Set(["merchant", "unknown merchant", "deposit", "payment", "transfer", "withdrawal"]);

/** Resolve LogoKit-first logo candidates for a transaction merchant name. */
export function merchantLogoSrc(merchant: string | null | undefined): CompanyLogoSources | null {
    const name = (merchant ?? "").trim();
    if (!name || GENERIC_MERCHANTS.has(name.toLowerCase())) return null;
    return companyLogoSrc({ logoKey: null, websiteDomain: null, name });
}
