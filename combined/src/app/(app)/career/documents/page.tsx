import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fileUrl } from "@/lib/files";
import { PageHeader } from "@/components/jobs/page-header";
import { NewDocumentDialog } from "@/components/jobs/document-dialogs";
import { DocumentsExplorer } from "@/components/jobs/documents-explorer";
import type { DocumentCardData } from "@/components/jobs/document-card";

export const dynamic = "force-dynamic";

export default async function CareerDocumentsPage() {
    const user = await requireUser();
    const documents = await db.jobDocument.findMany({
        where: { userId: user.id },
        orderBy: { name: "asc" },
        include: {
            versions: {
                orderBy: { versionNumber: "desc" },
                include: {
                    usedAsResume: { select: { id: true, role: true, company: { select: { name: true } } } },
                    usedAsCoverLetter: { select: { id: true, role: true, company: { select: { name: true } } } },
                },
            },
        },
    });

    const docs: DocumentCardData[] = documents.map((doc) => ({
        id: doc.id,
        name: doc.name,
        kind: doc.kind,
        versions: doc.versions.map((v) => ({
            id: v.id,
            versionNumber: v.versionNumber,
            label: v.label,
            fileName: v.fileName,
            fileSize: v.fileSize,
            mimeType: v.mimeType,
            createdAt: v.createdAt.toISOString(),
            previewUrl: fileUrl(v.fileKey),
            downloadUrl: fileUrl(v.fileKey, { download: true, name: v.fileName }),
            usedAsResumeCount: v.usedAsResume.length,
            usedAsCoverLetterCount: v.usedAsCoverLetter.length,
            apps: [...v.usedAsResume, ...v.usedAsCoverLetter].map((a) => ({
                id: a.id,
                role: a.role,
                companyName: a.company.name,
            })),
        })),
    }));

    return (
        <div className="w-full">
            <PageHeader
                title="Documents"
                description="Resumes, cover letters, certifications, education files, and other career documents."
            >
                <NewDocumentDialog />
            </PageHeader>
            <DocumentsExplorer docs={docs} />
        </div>
    );
}
