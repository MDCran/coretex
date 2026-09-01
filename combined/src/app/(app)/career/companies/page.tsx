import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Building07, LinkExternal01, Plus } from "@untitledui/icons";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { companyLogoSrc } from "@/lib/jobs/logos";
import { CompanyLogo } from "@/components/jobs/company-logo";
import { CompaniesFilter } from "@/components/jobs/companies-filter";
import { PageHeader } from "@/components/jobs/page-header";
import { ExportPdfButton } from "@/components/jobs/export-pdf-button";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Card, CardBody } from "@/components/jobs/card";
import { Badge } from "@/components/base/badges/badges";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; industry?: string }> }) {
    const user = await requireUser();
    const { q, industry } = await searchParams;

    const where: Prisma.CompanyWhereInput = { userId: user.id };
    if (q) where.name = { contains: q, mode: "insensitive" };
    if (industry) where.industry = industry;

    const [companies, distinctIndustries] = await Promise.all([
        db.company.findMany({ where, orderBy: { name: "asc" }, include: { _count: { select: { applications: true, contacts: true } } } }),
        db.company.findMany({
            where: { userId: user.id, industry: { not: null } },
            distinct: ["industry"],
            select: { industry: true },
            orderBy: { industry: "asc" },
        }),
    ]);

    const industries = distinctIndustries.map((c) => c.industry).filter((i): i is string => !!i);
    const filtered = !!q || !!industry;

    return (
        <div>
            <PageHeader title="Companies" description={`${companies.length} compan${companies.length === 1 ? "y" : "ies"}${filtered ? " match" : ""}`}>
                <ExportPdfButton />
                <Button href="/career/companies/new" color="primary" iconLeading={<Plus data-icon className="size-4" />}>
                    Add company
                </Button>
            </PageHeader>

            <div className="mb-4">
                <CompaniesFilter industries={industries} />
            </div>

            {companies.length === 0 ? (
                <Card>
                    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                        <FeaturedIcon icon={Building07} color="brand" theme="light" size="lg" />
                        {filtered ? (
                            <>
                                <p className="text-sm font-semibold text-primary">No companies match your filters</p>
                                <p className="max-w-sm text-sm text-tertiary">Try a different search term or industry to see more of your list.</p>
                            </>
                        ) : (
                            <>
                                <p className="text-sm font-semibold text-primary">Build your target company list</p>
                                <p className="max-w-sm text-sm text-tertiary">
                                    Save the companies you want to work for, keep their details and contacts in one place, and tie applications back to each one.
                                </p>
                                <Button href="/career/companies/new" color="primary" size="md" iconLeading={<Plus data-icon className="size-4" />} className="mt-1">
                                    Add company
                                </Button>
                            </>
                        )}
                    </div>
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {companies.map((c) => (
                        <Link key={c.id} href={`/career/companies/${c.id}`}>
                            <Card className="h-full transition hover:bg-secondary_hover">
                                <CardBody className="flex items-start gap-3">
                                    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary p-1 ring-1 ring-secondary">
                                        <CompanyLogo src={companyLogoSrc(c)} alt={c.name} name={c.name} className="size-full object-contain" iconClassName="text-sm" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <h3 className="truncate font-medium text-primary">{c.name}</h3>
                                            {c.websiteDomain && <LinkExternal01 className="size-3 text-fg-quaternary" />}
                                        </div>
                                        {c.industry && <p className="truncate text-sm text-tertiary">{c.industry}</p>}
                                        {c.hqLocation && <p className="truncate text-xs text-tertiary">{c.hqLocation}</p>}
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            <Badge color="gray" size="sm" type="modern">
                                                {c._count.applications} application{c._count.applications === 1 ? "" : "s"}
                                            </Badge>
                                            {c._count.contacts > 0 && (
                                                <Badge color="gray" size="sm" type="modern">
                                                    {c._count.contacts} contact{c._count.contacts === 1 ? "" : "s"}
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                </CardBody>
                            </Card>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
