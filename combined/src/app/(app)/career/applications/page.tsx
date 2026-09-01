import { Briefcase01, Plus } from "@untitledui/icons";
import type { Prisma, JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { companyLogoSrc } from "@/lib/jobs/logos";
import { applicationHealth } from "@/lib/jobs/health";
import { companyOptions, allPhases } from "@/lib/jobs/queries";
import { PageHeader } from "@/components/jobs/page-header";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Card } from "@/components/jobs/card";
import { ApplicationsFilter } from "@/components/jobs/applications-filter";
import { ManagePhasesDialog } from "@/components/jobs/manage-phases-dialog";
import { ApplicationsTable } from "@/components/jobs/applications-table";
import { ExportPdfButton } from "@/components/jobs/export-pdf-button";

export const dynamic = "force-dynamic";

function phaseWhere(phase: string | undefined): Prisma.JobApplicationWhereInput {
    switch (phase) {
        case undefined:
        case "":
        case "active":
            return { OR: [{ phaseId: null }, { phase: { archived: false } }] };
        case "archived":
            return { phase: { archived: true } };
        case "none":
            return { phaseId: null };
        case "all":
            return {};
        default:
            return { phaseId: phase };
    }
}

function orderBy(sort?: string): Prisma.JobApplicationOrderByWithRelationInput {
    switch (sort) {
        case "applied":
            return { dateApplied: "desc" };
        case "deadline":
            return { deadline: "asc" };
        case "role":
            return { role: "asc" };
        default:
            return { createdAt: "desc" };
    }
}

export default async function ApplicationsPage({
    searchParams,
}: {
    searchParams: Promise<{ status?: string; companyId?: string; sort?: string; phase?: string; location?: string; q?: string }>;
}) {
    const user = await requireUser();
    const sp = await searchParams;

    const where: Prisma.JobApplicationWhereInput = { userId: user.id, ...phaseWhere(sp.phase) };
    if (sp.status) where.status = sp.status as JobStatus;
    if (sp.companyId) where.companyId = sp.companyId;
    if (sp.location === "remote") where.workType = "REMOTE";
    else if (sp.location === "none") where.nearestLocationId = null;
    else if (sp.location) where.nearestLocationId = sp.location;
    if (sp.q) {
        const q = sp.q.trim();
        where.AND = [{ OR: [{ role: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }, { location: { contains: q, mode: "insensitive" } }] }];
    }

    const [applications, companies, phases, locations] = await Promise.all([
        db.jobApplication.findMany({
            where,
            orderBy: orderBy(sp.sort),
            include: {
                company: { select: { name: true, logoKey: true, websiteDomain: true } },
                phase: { select: { name: true, archived: true } },
            },
        }),
        companyOptions(user.id),
        allPhases(user.id),
        db.jobSearchLocation.findMany({ where: { userId: user.id }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }], select: { id: true, label: true, shortLabel: true } }),
    ]);

    const phaseRows = phases.map((p) => ({ id: p.id, name: p.name, archived: p.archived, count: p._count.applications }));
    const phaseOptions = phases.map((p) => ({ id: p.id, name: p.name, archived: p.archived }));
    const companyOpts = companies.map((c) => ({ id: c.id, name: c.name, logo: companyLogoSrc(c) }));
    const locationOpts = locations.map((l) => ({ id: l.id, name: l.shortLabel || l.label }));

    const rows = applications.map((a) => ({
        id: a.id,
        role: a.role,
        status: a.status,
        workType: a.workType,
        companyName: a.company.name,
        companyLogo: companyLogoSrc(a.company, { fallbackUrl: a.applicationUrl }),
        location: a.location,
        dateApplied: a.dateApplied,
        deadline: a.deadline,
        salaryMin: a.salaryMin,
        salaryMax: a.salaryMax,
        salaryCurrency: a.salaryCurrency,
        phaseName: a.phase?.name ?? null,
        phaseArchived: a.phase?.archived ?? false,
        priority: a.priority,
        health: applicationHealth(a),
    }));

    return (
        <div>
            <PageHeader title="Applications" description={`${applications.length} application${applications.length === 1 ? "" : "s"}`}>
                <ManagePhasesDialog phases={phaseRows} />
                <ExportPdfButton />
                <Button href="/career/applications/new" color="primary" iconLeading={<Plus data-icon className="size-4" />}>
                    New application
                </Button>
            </PageHeader>

            <div className="mb-4">
                <ApplicationsFilter companies={companyOpts} phases={phaseOptions} locations={locationOpts} />
            </div>

            {rows.length === 0 ? (
                <Card>
                    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                        <FeaturedIcon icon={Briefcase01} color="brand" theme="light" size="lg" />
                        {applications.length === 0 && !sp.status && !sp.companyId && !sp.location && !sp.q ? (
                            <>
                                <p className="text-sm font-semibold text-primary">Track your first application</p>
                                <p className="max-w-sm text-sm text-tertiary">
                                    Log every role you apply to, watch it move through your pipeline, and never lose track of a deadline again.
                                </p>
                                <Button href="/career/applications/new" color="primary" size="md" iconLeading={<Plus data-icon className="size-4" />} className="mt-1">
                                    New application
                                </Button>
                            </>
                        ) : (
                            <>
                                <p className="text-sm font-semibold text-primary">No applications match your filters</p>
                                <p className="max-w-sm text-sm text-tertiary">Try clearing a filter or search term to see more of your pipeline.</p>
                            </>
                        )}
                    </div>
                </Card>
            ) : (
                <Card className="overflow-hidden">
                    <ApplicationsTable rows={rows} />
                </Card>
            )}
        </div>
    );
}
