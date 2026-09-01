import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/jobs/page-header";
import { ApplicationForm } from "@/components/jobs/application-form";
import { updateApplication } from "@/lib/actions/jobs";
import { companyLogoSrc } from "@/lib/jobs/logos";
import { companyOptions, pickerDocs, allPhases } from "@/lib/jobs/queries";
import { toDateInput } from "@/lib/jobs/format";

export const dynamic = "force-dynamic";

export default async function EditApplicationPage({ params }: { params: Promise<{ id: string }> }) {
    const user = await requireUser();
    const { id } = await params;
    const [application, companies, resumeDocs, coverLetterDocs, phases, targets, savedLocations] = await Promise.all([
        db.jobApplication.findFirst({ where: { id, userId: user.id } }),
        companyOptions(user.id),
        pickerDocs(user.id, "RESUME"),
        pickerDocs(user.id, "COVER_LETTER"),
        allPhases(user.id),
        db.careerTarget.findMany({ where: { userId: user.id }, orderBy: { sortOrder: "asc" }, select: { id: true, title: true } }),
        db.jobSearchLocation.findMany({ where: { userId: user.id }, orderBy: [{ priority: "asc" }, { label: "asc" }], select: { id: true, label: true, shortLabel: true } }),
    ]);
    if (!application) notFound();

    return (
        <div className="w-full">
            <PageHeader title={`Edit · ${application.role}`} />
            <ApplicationForm
                action={updateApplication.bind(null, id)}
                companies={companies.map((c) => ({ id: c.id, name: c.name, logo: companyLogoSrc(c) }))}
                savedLocations={savedLocations}
                resumeDocs={resumeDocs}
                coverLetterDocs={coverLetterDocs}
                phases={phases.map((p) => ({ id: p.id, name: p.name, archived: p.archived }))}
                targets={targets}
                cancelHref={`/career/applications/${id}`}
                submitLabel="Save changes"
                defaults={{
                    companyId: application.companyId,
                    role: application.role,
                    applicationUrl: application.applicationUrl,
                    status: application.status,
                    workType: application.workType,
                    heardFrom: application.heardFrom,
                    location: application.location,
                    dateApplied: toDateInput(application.dateApplied),
                    deadline: toDateInput(application.deadline),
                    salaryMin: application.salaryMin,
                    salaryMax: application.salaryMax,
                    salaryCurrency: application.salaryCurrency,
                    resumeVersionId: application.resumeVersionId,
                    coverLetterVersionId: application.coverLetterVersionId,
                    phaseId: application.phaseId,
                    targetId: application.targetId,
                    notesMarkdown: application.notesMarkdown,
                    priority: application.priority,
                    referredByName: application.referredByName,
                    referredByRelationship: application.referredByRelationship,
                }}
            />
        </div>
    );
}
