import Link from "next/link";
import { notFound } from "next/navigation";
import { Edit01, Globe01, LinkExternal01, MarkerPin01, Plus, Tag01, Users01 } from "@untitledui/icons";
import { SuggestionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/claude";
import { CompanyJobScan } from "@/components/career/company-job-scan";
import { type LeadRow } from "@/components/career/suggested-roles-table";
import { companyLogoSrc } from "@/lib/jobs/logos";
import { CompanyLogo } from "@/components/jobs/company-logo";
import { StatusFlowSankey } from "@/components/jobs/charts";
import { CompanyApplicationsList } from "@/components/jobs/company-applications";
import { buildStatusFlow } from "@/lib/jobs/sankey";
import { CONTACT_METHOD_LABELS } from "@/lib/jobs/enums";
import { PageHeader } from "@/components/jobs/page-header";
import { Button } from "@/components/base/buttons/button";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { Badge } from "@/components/base/badges/badges";
import { Avatar } from "@/components/base/avatar/avatar";
import { DeleteButton } from "@/components/jobs/delete-button";
import { deleteCompany, updateCompanyNotes } from "@/lib/actions/jobs-companies";
import { NotesEditor } from "@/components/jobs/notes-editor";

export const dynamic = "force-dynamic";

function domainUrl(domain: string) {
    return domain.startsWith("http") ? domain : `https://${domain}`;
}

function Row({ icon, label, children, className }: { icon: React.ReactNode; label: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={`flex items-start gap-2 ${className ?? ""}`}>
            <span className="mt-0.5 text-fg-quaternary">{icon}</span>
            <div className="min-w-0">
                <div className="text-sm font-medium text-secondary">{label}</div>
                <div className="break-words text-sm text-tertiary">{children}</div>
            </div>
        </div>
    );
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const user = await requireUser();
    const { id } = await params;
    const company = await db.company.findFirst({
        where: { id, userId: user.id },
        include: {
            applications: {
                orderBy: { createdAt: "desc" },
                include: { events: { where: { type: "status" }, select: { fromStatus: true, toStatus: true } } },
            },
            contacts: { orderBy: { name: "asc" } },
            leads: {
                where: { status: SuggestionStatus.NEW },
                orderBy: [{ matchScore: "desc" }, { createdAt: "desc" }],
                include: { nearestLocation: { select: { shortLabel: true, label: true } } },
            },
        },
    });
    if (!company) notFound();

    // AI is "active" unless the key is missing OR the user has explicitly turned AI off
    // (mirrors career/search/page.tsx + the backend gating).
    const settings = await db.settings.findUnique({ where: { userId: user.id }, select: { aiEnabled: true } });
    const aiActive = aiConfigured() && !(settings?.aiEnabled === false);

    const flowData = buildStatusFlow(company.applications.map((a) => ({ status: a.status, events: a.events, isAi: a.heardFrom === "AIApply" })));

    const leadRows: LeadRow[] = company.leads.map((l) => ({
        id: l.id,
        title: l.title,
        level: l.level,
        companyId: company.id,
        companyName: company.name,
        companyDomain: l.companyDomain,
        applicationUrl: l.applicationUrl,
        salaryMin: l.salaryMin,
        salaryMax: l.salaryMax,
        salaryCurrency: l.salaryCurrency,
        deadline: l.deadline,
        locationText: l.locationText,
        isRemote: l.isRemote,
        nearestLabel: l.nearestLocation ? l.nearestLocation.shortLabel || l.nearestLocation.label : null,
        distanceMiles: l.distanceMiles,
        matchScore: l.matchScore,
        matchReason: l.matchReason,
    }));

    return (
        <div className="w-full">
            <PageHeader title={company.name}>
                <Button href={`/career/companies/${id}/edit`} color="secondary" iconLeading={<Edit01 data-icon className="size-4" />}>
                    Edit
                </Button>
                <DeleteButton action={deleteCompany} id={id} title="Delete company?" description="Deleting this company also deletes its applications and meetings." />
            </PageHeader>

            <div className="grid gap-6 md:grid-cols-3">
                <Card className="md:col-span-1">
                    <CardBody className="flex flex-col items-center gap-3 text-center">
                        <div className="flex size-28 items-center justify-center overflow-hidden rounded-xl bg-primary p-2 ring-1 ring-secondary">
                            <CompanyLogo src={companyLogoSrc(company)} alt={company.name} name={company.name} className="size-full object-contain" iconClassName="text-3xl" />
                        </div>
                        <h2 className="text-xl font-semibold text-primary">{company.name}</h2>
                        {company.industry && <p className="text-sm text-tertiary">{company.industry}</p>}
                        {company.websiteDomain && (
                            <a href={domainUrl(company.websiteDomain)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-brand-secondary hover:underline">
                                <Globe01 className="size-3.5" />
                                {company.websiteDomain}
                            </a>
                        )}
                        {company.size && (
                            <Badge color="gray" size="sm" type="modern">
                                {company.size} employees
                            </Badge>
                        )}
                    </CardBody>
                </Card>

                <Card className="md:col-span-2">
                    <CardHeader title="Details" />
                    <CardBody className="grid gap-4 sm:grid-cols-2">
                        <Row icon={<Globe01 className="size-4" />} label="Website">
                            {company.websiteDomain ? (
                                <a href={domainUrl(company.websiteDomain)} target="_blank" rel="noreferrer" className="text-brand-secondary hover:underline">
                                    {company.websiteDomain}
                                </a>
                            ) : (
                                "—"
                            )}
                        </Row>
                        <Row icon={<LinkExternal01 className="size-4" />} label="LinkedIn">
                            {company.linkedinUrl ? (
                                <a href={company.linkedinUrl} target="_blank" rel="noreferrer" className="text-brand-secondary hover:underline">
                                    LinkedIn profile
                                </a>
                            ) : (
                                "—"
                            )}
                        </Row>
                        <Row icon={<Tag01 className="size-4" />} label="Industry">
                            {company.industry ?? "—"}
                        </Row>
                        <Row icon={<Users01 className="size-4" />} label="Company size">
                            {company.size ? `${company.size} employees` : "—"}
                        </Row>
                        <Row icon={<MarkerPin01 className="size-4" />} label="Headquarters">
                            {company.hqLocation ?? "—"}
                        </Row>
                        <Row icon={<MarkerPin01 className="size-4" />} label="Office locations" className="sm:col-span-2">
                            {company.officeLocations.length ? (
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                    {company.officeLocations.map((loc) => (
                                        <Badge key={loc} color="gray" size="sm">
                                            {loc}
                                        </Badge>
                                    ))}
                                </div>
                            ) : (
                                "—"
                            )}
                        </Row>
                    </CardBody>
                </Card>
            </div>

            <Card className="mt-6">
                <CardHeader title="Notes" />
                <CardBody>
                    <NotesEditor action={updateCompanyNotes.bind(null, id)} defaultValue={company.notesMarkdown ?? ""} />
                </CardBody>
            </Card>

            {company.applications.length > 0 && (
                <Card className="mt-6">
                    <CardHeader title="Status flow" />
                    <CardBody>
                        <StatusFlowSankey data={flowData} />
                    </CardBody>
                </Card>
            )}

            <Card className="mt-6">
                <CardHeader
                    title={`Applications (${company.applications.length})`}
                    action={
                        <Button href={`/career/applications/new?companyId=${id}`} color="secondary" size="sm" iconLeading={<Plus data-icon className="size-4" />}>
                            New application
                        </Button>
                    }
                />
                <CardBody>
                    {company.applications.length === 0 ? (
                        <p className="text-sm text-tertiary">No applications yet.</p>
                    ) : (
                        <CompanyApplicationsList
                            companyLogo={companyLogoSrc(company)}
                            companyName={company.name}
                            rows={company.applications.map((a) => ({ id: a.id, role: a.role, status: a.status, workType: a.workType, dateApplied: a.dateApplied }))}
                        />
                    )}
                </CardBody>
            </Card>

            <Card className="mt-6">
                <CardHeader title="AI job scan" />
                <CardBody>
                    <CompanyJobScan companyId={company.id} companyName={company.name} initialLeads={leadRows} disabled={!aiActive} />
                </CardBody>
            </Card>

            <Card className="mt-6">
                <CardHeader
                    title={`Contacts (${company.contacts.length})`}
                    action={
                        <Button href={`/career/contacts/new?companyId=${id}`} color="secondary" size="sm" iconLeading={<Plus data-icon className="size-4" />}>
                            New contact
                        </Button>
                    }
                />
                <CardBody>
                    {company.contacts.length === 0 ? (
                        <p className="text-sm text-tertiary">No contacts linked to this company yet.</p>
                    ) : (
                        <ul className="flex flex-col divide-y divide-secondary">
                            {company.contacts.map((p) => (
                                <li key={p.id}>
                                    <Link href={`/career/contacts/${p.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                                        <div className="flex items-center gap-3">
                                            <Avatar size="sm" initials={p.name.slice(0, 2).toUpperCase()} alt={p.name} />
                                            <div>
                                                <div className="text-sm font-medium text-primary">{p.name}</div>
                                                {p.role && <div className="text-xs text-tertiary">{p.role}</div>}
                                            </div>
                                        </div>
                                        {p.preferredContactMethod && (
                                            <Badge color="gray" size="sm">
                                                {CONTACT_METHOD_LABELS[p.preferredContactMethod]}
                                            </Badge>
                                        )}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>
        </div>
    );
}
