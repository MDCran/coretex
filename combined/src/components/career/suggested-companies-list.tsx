import { Building07 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { CompanyLogo } from "@/components/jobs/company-logo";
import { companyLogoSrc } from "@/lib/jobs/logos";
import { CompanySuggestionButtons } from "@/components/career/job-search-actions";
import { EmptyState } from "@/components/career/career-ui";

export interface SuggestedCompanyRow {
    id: string;
    name: string;
    websiteDomain: string | null;
    industry: string | null;
    hqLocation: string | null;
    leadCount: number;
}

/** AI-discovered companies you don't track yet — add to your list or dismiss. */
export function SuggestedCompaniesList({ companies }: { companies: SuggestedCompanyRow[] }) {
    if (companies.length === 0) {
        return (
            <EmptyState icon={Building07} title="Discover companies worth chasing">
                Turn on “Suggest new companies” in search settings, then run a search — Claude will surface employers hiring for roles that fit you.
            </EmptyState>
        );
    }

    return (
        <ul className="divide-y divide-secondary">
            {companies.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary p-1 ring-1 ring-secondary">
                            <CompanyLogo
                                src={companyLogoSrc({ logoKey: null, websiteDomain: c.websiteDomain, name: c.name })}
                                alt={c.name}
                                name={c.name}
                                className="size-full object-contain"
                                iconClassName="text-xs"
                            />
                        </span>
                        <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-primary">{c.name}</div>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-tertiary">
                                {c.industry && <span className="truncate">{c.industry}</span>}
                                {c.hqLocation && <span className="truncate">· {c.hqLocation}</span>}
                                <Badge color="gray" size="sm" type="modern">
                                    <Building07 className="size-3" /> {c.leadCount} role{c.leadCount === 1 ? "" : "s"}
                                </Badge>
                            </div>
                        </div>
                    </div>
                    <CompanySuggestionButtons id={c.id} />
                </li>
            ))}
        </ul>
    );
}
