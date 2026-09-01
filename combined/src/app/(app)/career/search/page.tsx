import { AlertTriangle, Building07, Lock01, MarkerPin01, Settings01 } from "@untitledui/icons";
import { SuggestionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/claude";
import { getOrCreateProfile } from "@/lib/actions/job-search";
import { Button } from "@/components/base/buttons/button";
import { PageHeader } from "@/components/jobs/page-header";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { GenerateExistingCompaniesButton } from "@/components/career/job-search-actions";
import { LocationManager } from "@/components/career/location-manager";
import { JobSearchSettingsForm } from "@/components/career/job-search-settings-form";
import { type LeadRow } from "@/components/career/suggested-roles-table";
import { JobSearchPanel } from "@/components/career/job-search-panel";
import { SuggestedCompaniesList } from "@/components/career/suggested-companies-list";

export const dynamic = "force-dynamic";

export default async function JobSearchPage() {
    const user = await requireUser();
    const configured = aiConfigured();

    const [profile, locations, leads, suggestedCompanies, companyCount, settings] = await Promise.all([
        getOrCreateProfile(user.id),
        db.jobSearchLocation.findMany({ where: { userId: user.id }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] }),
        db.jobLead.findMany({
            where: { userId: user.id, status: SuggestionStatus.NEW },
            orderBy: [{ matchScore: "desc" }, { createdAt: "desc" }],
        }),
        db.suggestedCompany.findMany({
            where: { userId: user.id, status: SuggestionStatus.NEW },
            orderBy: { name: "asc" },
            include: { _count: { select: { leads: true } } },
        }),
        db.company.count({ where: { userId: user.id } }),
        db.settings.findUnique({ where: { userId: user.id }, select: { aiEnabled: true } }),
    ]);

    // AI is "active" unless the key is missing OR the user has explicitly turned AI off.
    // When inactive the search area locks down (matches the backend gating).
    const aiDisabled = !!settings && settings.aiEnabled === false;
    const aiActive = configured && !aiDisabled;

    const locLabel = new Map(locations.map((l) => [l.id, l.shortLabel || l.label]));

    const leadRows: LeadRow[] = leads.map((l) => ({
        id: l.id,
        title: l.title,
        level: l.level,
        companyId: l.companyId,
        companyName: l.companyName,
        companyDomain: l.companyDomain,
        applicationUrl: l.applicationUrl,
        salaryMin: l.salaryMin,
        salaryMax: l.salaryMax,
        salaryCurrency: l.salaryCurrency,
        deadline: l.deadline,
        locationText: l.locationText,
        isRemote: l.isRemote,
        nearestLabel: l.nearestLocationId ? locLabel.get(l.nearestLocationId) ?? null : null,
        distanceMiles: l.distanceMiles,
        matchScore: l.matchScore,
        matchReason: l.matchReason,
    }));

    const companyRows = suggestedCompanies.map((c) => ({
        id: c.id,
        name: c.name,
        websiteDomain: c.websiteDomain,
        industry: c.industry,
        hqLocation: c.hqLocation,
        leadCount: c._count.leads,
    }));

    return (
        <div className="flex flex-col gap-6">
            <PageHeader title="Job Search" description="Let Claude search the live web for roles that fit you, near your locations.">
                <GenerateExistingCompaniesButton disabled={!aiActive} companyCount={companyCount} />
            </PageHeader>

            {!configured && (
                <Card>
                    <CardBody className="flex items-start gap-3">
                        <FeaturedIcon icon={AlertTriangle} color="warning" theme="light" size="md" />
                        <div>
                            <h3 className="text-sm font-semibold text-primary">AI is not configured</h3>
                            <p className="text-sm text-tertiary">Set <code>ANTHROPIC_API_KEY</code> on the server to enable live job searches.</p>
                        </div>
                    </CardBody>
                </Card>
            )}

            {configured && aiDisabled && (
                <Card>
                    <CardBody className="flex items-start gap-3">
                        <FeaturedIcon icon={Lock01} color="gray" theme="modern" size="md" />
                        <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-semibold text-primary">Job search is locked down</h3>
                            <p className="text-sm text-tertiary">AI features are turned off, so searches and search settings are read-only. Turn them back on in Settings → AI.</p>
                        </div>
                        <Button href="/settings/ai" size="sm" color="secondary">Open AI settings</Button>
                    </CardBody>
                </Card>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader title="Search locations" action={<MarkerPin01 className="size-5 text-fg-quaternary" />} />
                    <CardBody>
                        <LocationManager
                            disabled={!aiActive}
                            locations={locations.map((l) => ({
                                id: l.id,
                                label: l.label,
                                shortLabel: l.shortLabel,
                                enabled: l.enabled,
                                placeType: l.placeType,
                            }))}
                        />
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title="Search settings" action={<Settings01 className="size-5 text-fg-quaternary" />} />
                    <CardBody>
                        <JobSearchSettingsForm
                            aiEnabled={aiActive}
                            profile={{
                                profileText: profile.profileText,
                                keywords: profile.keywords,
                                excludeKeywords: profile.excludeKeywords,
                                levels: profile.levels,
                                distanceMiles: profile.distanceMiles,
                                allowRemote: profile.allowRemote,
                                includeNewCompanies: profile.includeNewCompanies,
                                minSalary: profile.minSalary,
                                autoGhost: profile.autoGhost,
                                ghostAfterDays: profile.ghostAfterDays,
                                followUpAfterDays: profile.followUpAfterDays,
                            }}
                        />
                    </CardBody>
                </Card>
            </div>

            {companyRows.length > 0 && (
                <Card>
                    <CardHeader title={`Suggested companies (${companyRows.length})`} action={<Building07 className="size-5 text-fg-quaternary" />} />
                    <CardBody>
                        <SuggestedCompaniesList companies={companyRows} />
                    </CardBody>
                </Card>
            )}

            <JobSearchPanel initialRows={leadRows} configured={aiActive} />
        </div>
    );
}
