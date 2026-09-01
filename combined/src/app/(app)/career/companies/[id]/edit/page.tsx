import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/jobs/page-header";
import { CompanyForm } from "@/components/jobs/company-form";
import { updateCompany } from "@/lib/actions/jobs-companies";

export const dynamic = "force-dynamic";

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
    const user = await requireUser();
    const { id } = await params;
    const company = await db.company.findFirst({ where: { id, userId: user.id } });
    if (!company) notFound();

    return (
        <div className="w-full">
            <PageHeader title={`Edit ${company.name}`} />
            <CompanyForm
                action={updateCompany.bind(null, id)}
                submitLabel="Save changes"
                cancelHref={`/career/companies/${id}`}
                defaults={{
                    name: company.name,
                    websiteDomain: company.websiteDomain,
                    linkedinUrl: company.linkedinUrl,
                    hqLocation: company.hqLocation,
                    officeLocations: company.officeLocations,
                    industry: company.industry,
                    size: company.size,
                    hasLogo: !!company.logoKey,
                }}
            />
        </div>
    );
}
