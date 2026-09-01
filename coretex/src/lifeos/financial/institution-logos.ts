// @ts-nocheck
import { cleanDomain, companyLogoSrc, type CompanyLogoSources } from "@/lib/jobs/logos";

/** Resolve logo candidates for a financial institution (upload → Clearbit → favicon → LogoKit). */
export function institutionLogoSrc(inst: { logoKey?: string | null; website?: string | null; name: string }): CompanyLogoSources {
    return companyLogoSrc({
        logoKey: inst.logoKey,
        websiteDomain: inst.website ? cleanDomain(inst.website) : null,
        name: inst.name,
    });
}
