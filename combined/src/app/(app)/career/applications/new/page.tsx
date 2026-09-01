import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/jobs/page-header";
import { ApplicationForm } from "@/components/jobs/application-form";
import { createApplication } from "@/lib/actions/jobs";
import { companyLogoSrc } from "@/lib/jobs/logos";
import { companyOptions, pickerDocs, allPhases, currentPhase } from "@/lib/jobs/queries";

export const dynamic = "force-dynamic";

export default async function NewApplicationPage({ searchParams }: { searchParams: Promise<{ companyId?: string }> }) {
    const user = await requireUser();
    const { companyId } = await searchParams;
    const [companies, resumeDocs, coverLetterDocs, phases, current, targets, savedLocations] = await Promise.all([
        companyOptions(user.id),
        pickerDocs(user.id, "RESUME"),
        pickerDocs(user.id, "COVER_LETTER"),
        allPhases(user.id),
        currentPhase(user.id),
        db.careerTarget.findMany({ where: { userId: user.id }, orderBy: { sortOrder: "asc" }, select: { id: true, title: true } }),
        db.jobSearchLocation.findMany({ where: { userId: user.id }, orderBy: [{ priority: "asc" }, { label: "asc" }], select: { id: true, label: true, shortLabel: true } }),
    ]);

    return (
        <div className="w-full">
            <PageHeader title="New application" />
            <ApplicationForm
                action={createApplication}
                companies={companies.map((c) => ({ id: c.id, name: c.name, logo: companyLogoSrc(c) }))}
                savedLocations={savedLocations}
                resumeDocs={resumeDocs}
                coverLetterDocs={coverLetterDocs}
                phases={phases.map((p) => ({ id: p.id, name: p.name, archived: p.archived }))}
                targets={targets}
                defaults={{ companyId, phaseId: current?.id }}
                submitLabel="Create application"
                cancelHref="/career/applications"
            />
        </div>
    );
}
