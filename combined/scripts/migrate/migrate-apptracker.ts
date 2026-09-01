/**
 * Migrate application_tracker -> LifeOS Jobs module.
 *
 * Source: postgresql://apptracker:apptracker@localhost:5440/apptracker
 * Source S3: MinIO localhost:9300 bucket "attachments" (minioadmin/minioadmin)
 *
 * Model mapping (1:1 unless noted):
 *   Company             -> Company            (S3: logoKey, module "jobs")
 *   Phase               -> JobPhase
 *   Application         -> JobApplication
 *   ApplicationEvent    -> JobApplicationEvent
 *   Document            -> JobDocument
 *   DocumentVersion     -> JobDocumentVersion (S3: fileKey, module "jobs")
 *   Meeting             -> JobMeeting         (+ MeetingParticipants m2m)
 *   Person              -> JobContact
 *   ContactInteraction  -> JobContactInteraction
 *   Attachment          -> JobAttachment      (S3: fileKey, module "jobs")
 *
 * Status enum: source ApplicationStatus values are a SUBSET of the target
 * JobStatus enum with identical names (NOT_STARTED, APPLIED, INTERVIEWING,
 * OFFERED, OFFER_ACCEPTED, OFFER_DECLINED, REJECTED, GHOSTED) — 1:1 passthrough.
 * WorkType / HeardFrom / ContactMethod / DocumentKind enums are identical.
 *
 * Order honors FKs: Phase, Company, Document+Version, Person first; then
 * Application (needs company/phase/resumeVersion/coverLetterVersion); then
 * Meeting (needs application) + participants (needs person); then events,
 * interactions, attachments.
 */

import { Prisma } from "@prisma/client";
import {
    alreadyMigrated,
    CliArgs,
    copyObject,
    IdMap,
    parseArgs,
    prisma,
    printCounts,
    resolveUserId,
    safeDisconnect,
    SOURCES,
    sourcePrisma,
    toDate,
    writeMarker,
} from "./shared";

const MODULE = "jobs";
const src = SOURCES.apptracker;

export async function migrateApptracker(args: CliArgs): Promise<void> {
    const userId = await resolveUserId(args.userEmail);
    if (!args.force && (await alreadyMigrated(userId, "apptracker"))) {
        console.log("[apptracker] already migrated (marker present) — skipping. Use --force to re-run.");
        return;
    }

    const db = sourcePrisma(src.db);
    const counts: Record<string, number> = {};
    try {
        console.log("[apptracker] connecting to source…");

        // ---- read everything up front (raw SQL, camelCase columns quoted) ----
        const companies = await db.$queryRawUnsafe<CompanyRow[]>(
            `SELECT id,name,"logoKey","hqLocation","officeLocations","websiteDomain","linkedinUrl",industry,size,"notesMarkdown","createdAt","updatedAt" FROM "Company"`,
        );
        const phases = await db.$queryRawUnsafe<PhaseRow[]>(
            `SELECT id,name,archived,"startedAt","createdAt","updatedAt" FROM "Phase"`,
        );
        const documents = await db.$queryRawUnsafe<DocumentRow[]>(
            `SELECT id,name,kind,"createdAt","updatedAt" FROM "Document"`,
        );
        const versions = await db.$queryRawUnsafe<VersionRow[]>(
            `SELECT id,"documentId","versionNumber",label,"fileKey","fileName","fileSize","mimeType","createdAt","updatedAt" FROM "DocumentVersion"`,
        );
        const people = await db.$queryRawUnsafe<PersonRow[]>(
            `SELECT id,name,"companyId",role,"preferredContactMethod",email,phone,"linkedinUrl",discord,pronouns,location,timezone,"lastContactedAt","notesMarkdown","createdAt","updatedAt" FROM "Person"`,
        );
        const applications = await db.$queryRawUnsafe<ApplicationRow[]>(
            `SELECT id,"companyId","applicationUrl",role,"dateApplied",status,"salaryMin","salaryMax","salaryCurrency",location,"workType","heardFrom",deadline,"notesMarkdown","resumeVersionId","coverLetterVersionId","phaseId","createdAt","updatedAt" FROM "Application"`,
        );
        const appEvents = await db.$queryRawUnsafe<AppEventRow[]>(
            `SELECT id,"applicationId",type,message,"createdAt" FROM "ApplicationEvent"`,
        );
        const meetings = await db.$queryRawUnsafe<MeetingRow[]>(
            `SELECT id,"applicationId",type,"durationMinutes","dateTime",location,"notesMarkdown","participantNames","createdAt","updatedAt" FROM "Meeting"`,
        );
        const interactions = await db.$queryRawUnsafe<InteractionRow[]>(
            `SELECT id,"personId",date,channel,note,"createdAt" FROM "ContactInteraction"`,
        );
        const attachments = await db.$queryRawUnsafe<AttachmentRow[]>(
            `SELECT id,"fileKey","fileName","fileSize","mimeType","createdAt","applicationId","meetingId" FROM "Attachment"`,
        );
        // m2m join table for Meeting<->Person.
        const meetingParticipants = await db.$queryRawUnsafe<JoinRow[]>(
            `SELECT "A" as a,"B" as b FROM "_MeetingParticipants"`,
        ).catch(() => [] as JoinRow[]);

        counts.Company = companies.length;
        counts.JobPhase = phases.length;
        counts.JobDocument = documents.length;
        counts.JobDocumentVersion = versions.length;
        counts.JobContact = people.length;
        counts.JobApplication = applications.length;
        counts.JobApplicationEvent = appEvents.length;
        counts.JobMeeting = meetings.length;
        counts.JobContactInteraction = interactions.length;
        counts.JobAttachment = attachments.length;

        if (args.dryRun) {
            printCounts("apptracker DRY-RUN", counts);
            return;
        }

        const companyMap = new IdMap("company");
        const phaseMap = new IdMap("phase");
        const docMap = new IdMap("document");
        const versionMap = new IdMap("version");
        const personMap = new IdMap("person");
        const appMap = new IdMap("application");
        const meetingMap = new IdMap("meeting");

        // ---- Company (+ logo S3) ----
        for (const c of companies) {
            const logoKey = await copyObject(src.s3!, c.logoKey, userId, MODULE, {
                originalName: c.name ? `${c.name}-logo` : null,
            });
            const created = await prisma.company.create({
                data: {
                    userId,
                    name: c.name,
                    logoKey,
                    hqLocation: c.hqLocation,
                    officeLocations: c.officeLocations ?? [],
                    websiteDomain: c.websiteDomain,
                    linkedinUrl: c.linkedinUrl,
                    industry: c.industry,
                    size: c.size,
                    notesMarkdown: c.notesMarkdown,
                    createdAt: toDate(c.createdAt) ?? undefined,
                    updatedAt: toDate(c.updatedAt) ?? undefined,
                },
            });
            companyMap.set(c.id, created.id);
        }

        // ---- JobPhase ----
        for (const p of phases) {
            const created = await prisma.jobPhase.create({
                data: {
                    userId,
                    name: p.name,
                    archived: p.archived,
                    startedAt: toDate(p.startedAt),
                    createdAt: toDate(p.createdAt) ?? undefined,
                    updatedAt: toDate(p.updatedAt) ?? undefined,
                },
            });
            phaseMap.set(p.id, created.id);
        }

        // ---- JobDocument ----
        for (const d of documents) {
            const created = await prisma.jobDocument.create({
                data: {
                    userId,
                    name: d.name,
                    kind: d.kind as Prisma.JobDocumentCreateInput["kind"],
                    createdAt: toDate(d.createdAt) ?? undefined,
                    updatedAt: toDate(d.updatedAt) ?? undefined,
                },
            });
            docMap.set(d.id, created.id);
        }

        // ---- JobDocumentVersion (+ file S3) ----
        for (const v of versions) {
            const fileKey = await copyObject(src.s3!, v.fileKey, userId, MODULE, {
                originalName: v.fileName,
            });
            const created = await prisma.jobDocumentVersion.create({
                data: {
                    documentId: docMap.require(v.documentId),
                    versionNumber: v.versionNumber,
                    label: v.label,
                    fileKey: fileKey ?? v.fileKey,
                    fileName: v.fileName,
                    fileSize: v.fileSize,
                    mimeType: v.mimeType,
                    createdAt: toDate(v.createdAt) ?? undefined,
                    updatedAt: toDate(v.updatedAt) ?? undefined,
                },
            });
            versionMap.set(v.id, created.id);
        }

        // ---- JobContact (Person) ----
        for (const p of people) {
            const created = await prisma.jobContact.create({
                data: {
                    userId,
                    name: p.name,
                    companyId: companyMap.get(p.companyId) ?? null,
                    role: p.role,
                    preferredContactMethod:
                        (p.preferredContactMethod as Prisma.JobContactCreateInput["preferredContactMethod"]) ??
                        null,
                    email: p.email,
                    phone: p.phone,
                    linkedinUrl: p.linkedinUrl,
                    discord: p.discord,
                    pronouns: p.pronouns,
                    location: p.location,
                    timezone: p.timezone,
                    lastContactedAt: toDate(p.lastContactedAt),
                    notesMarkdown: p.notesMarkdown,
                    createdAt: toDate(p.createdAt) ?? undefined,
                    updatedAt: toDate(p.updatedAt) ?? undefined,
                },
            });
            personMap.set(p.id, created.id);
        }

        // ---- JobApplication ----
        for (const a of applications) {
            const created = await prisma.jobApplication.create({
                data: {
                    userId,
                    companyId: companyMap.require(a.companyId),
                    applicationUrl: a.applicationUrl,
                    role: a.role,
                    dateApplied: toDate(a.dateApplied),
                    status: a.status as Prisma.JobApplicationCreateInput["status"],
                    salaryMin: a.salaryMin,
                    salaryMax: a.salaryMax,
                    salaryCurrency: a.salaryCurrency ?? "USD",
                    location: a.location,
                    workType: a.workType as Prisma.JobApplicationCreateInput["workType"],
                    heardFrom: (a.heardFrom as Prisma.JobApplicationCreateInput["heardFrom"]) ?? null,
                    deadline: toDate(a.deadline),
                    notesMarkdown: a.notesMarkdown,
                    resumeVersionId: versionMap.get(a.resumeVersionId) ?? null,
                    coverLetterVersionId: versionMap.get(a.coverLetterVersionId) ?? null,
                    phaseId: phaseMap.get(a.phaseId) ?? null,
                    createdAt: toDate(a.createdAt) ?? undefined,
                    updatedAt: toDate(a.updatedAt) ?? undefined,
                },
            });
            appMap.set(a.id, created.id);
        }

        // ---- JobApplicationEvent (target adds fromStatus/toStatus — left null
        //      since source only carried a free-text type/message) ----
        for (const e of appEvents) {
            await prisma.jobApplicationEvent.create({
                data: {
                    applicationId: appMap.require(e.applicationId),
                    type: e.type,
                    message: e.message,
                    createdAt: toDate(e.createdAt) ?? undefined,
                },
            });
        }

        // ---- JobMeeting ----
        for (const m of meetings) {
            const created = await prisma.jobMeeting.create({
                data: {
                    applicationId: appMap.require(m.applicationId),
                    type: m.type,
                    durationMinutes: m.durationMinutes,
                    dateTime: toDate(m.dateTime),
                    location: m.location,
                    notesMarkdown: m.notesMarkdown,
                    participantNames: m.participantNames ?? [],
                    createdAt: toDate(m.createdAt) ?? undefined,
                    updatedAt: toDate(m.updatedAt) ?? undefined,
                },
            });
            meetingMap.set(m.id, created.id);
        }

        // ---- MeetingParticipants m2m (A=Meeting, B=Person per Prisma alpha order) ----
        for (const link of meetingParticipants) {
            const meetingId = meetingMap.get(link.a);
            const contactId = personMap.get(link.b);
            if (!meetingId || !contactId) continue;
            await prisma.jobMeeting.update({
                where: { id: meetingId },
                data: { participants: { connect: { id: contactId } } },
            });
        }

        // ---- JobContactInteraction ----
        for (const it of interactions) {
            await prisma.jobContactInteraction.create({
                data: {
                    contactId: personMap.require(it.personId),
                    date: toDate(it.date) ?? new Date(),
                    channel: (it.channel as Prisma.JobContactInteractionCreateInput["channel"]) ?? null,
                    note: it.note,
                    createdAt: toDate(it.createdAt) ?? undefined,
                },
            });
        }

        // ---- JobAttachment (+ file S3) ----
        for (const at of attachments) {
            const fileKey = await copyObject(src.s3!, at.fileKey, userId, MODULE, {
                originalName: at.fileName,
            });
            await prisma.jobAttachment.create({
                data: {
                    fileKey: fileKey ?? at.fileKey,
                    fileName: at.fileName,
                    fileSize: at.fileSize,
                    mimeType: at.mimeType,
                    applicationId: appMap.get(at.applicationId) ?? null,
                    meetingId: meetingMap.get(at.meetingId) ?? null,
                    createdAt: toDate(at.createdAt) ?? undefined,
                },
            });
        }

        printCounts("apptracker", counts);
        await writeMarker(userId, "apptracker", counts, args.dryRun);
        console.log("[apptracker] done.");
    } finally {
        await safeDisconnect(db);
    }
}

// --- minimal row types for raw queries ---
interface CompanyRow {
    id: string;
    name: string;
    logoKey: string | null;
    hqLocation: string | null;
    officeLocations: string[] | null;
    websiteDomain: string | null;
    linkedinUrl: string | null;
    industry: string | null;
    size: string | null;
    notesMarkdown: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}
interface PhaseRow {
    id: string;
    name: string;
    archived: boolean;
    startedAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}
interface DocumentRow {
    id: string;
    name: string;
    kind: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}
interface VersionRow {
    id: string;
    documentId: string;
    versionNumber: number;
    label: string | null;
    fileKey: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}
interface PersonRow {
    id: string;
    name: string;
    companyId: string | null;
    role: string | null;
    preferredContactMethod: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    discord: string | null;
    pronouns: string | null;
    location: string | null;
    timezone: string | null;
    lastContactedAt: Date | null;
    notesMarkdown: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}
interface ApplicationRow {
    id: string;
    companyId: string;
    applicationUrl: string | null;
    role: string;
    dateApplied: Date | null;
    status: string;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    location: string | null;
    workType: string;
    heardFrom: string | null;
    deadline: Date | null;
    notesMarkdown: string | null;
    resumeVersionId: string | null;
    coverLetterVersionId: string | null;
    phaseId: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}
interface AppEventRow {
    id: string;
    applicationId: string;
    type: string;
    message: string;
    createdAt: Date | null;
}
interface MeetingRow {
    id: string;
    applicationId: string;
    type: string | null;
    durationMinutes: number | null;
    dateTime: Date | null;
    location: string | null;
    notesMarkdown: string | null;
    participantNames: string[] | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}
interface InteractionRow {
    id: string;
    personId: string;
    date: Date | null;
    channel: string | null;
    note: string | null;
    createdAt: Date | null;
}
interface AttachmentRow {
    id: string;
    fileKey: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    createdAt: Date | null;
    applicationId: string | null;
    meetingId: string | null;
}
interface JoinRow {
    a: string;
    b: string;
}

// allow standalone execution
if (import.meta.url === `file://${process.argv[1]}`) {
    migrateApptracker(parseArgs())
        .then(() => prisma.$disconnect())
        .catch(async (e) => {
            console.error(e);
            await prisma.$disconnect();
            process.exit(1);
        });
}
