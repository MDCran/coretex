"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { JobStatus, WorkType } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { uploadUserMediaFile } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";
import { validateUploadBatch } from "@/lib/upload-limits";
import { STATUS_LABELS, WORK_TYPE_LABELS } from "@/lib/jobs/enums";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function str(formData: FormData, k: string) {
    const v = formData.get(k);
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
}

function int(formData: FormData, k: string) {
    const s = str(formData, k);
    if (s == null) return null;
    const n = parseInt(s.replace(/[^0-9.-]/g, ""), 10);
    return Number.isNaN(n) ? null : n;
}

/** Parse a <input type="date"> value as local midnight (avoids TZ day-shift). */
function dateField(formData: FormData, k: string) {
    const s = str(formData, k);
    if (!s) return null;
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
}

async function logEvent(
    applicationId: string,
    type: "created" | "updated" | "status" | "meeting" | "attachment",
    message: string,
    fromStatus?: JobStatus,
    toStatus?: JobStatus,
) {
    // Every logged event counts as activity — keep lastActivityAt fresh for the
    // ghosting auto-flag and the AI application-health score.
    await db.jobApplication.update({ where: { id: applicationId }, data: { lastActivityAt: new Date() } }).catch(() => {});
    return db.jobApplicationEvent.create({
        data: { applicationId, type, message, fromStatus, toStatus },
    });
}

/** Verify an application belongs to the user; returns it or throws. */
async function ownedApplication(userId: string, id: string) {
    const app = await db.jobApplication.findFirst({ where: { id, userId } });
    if (!app) throw new Error("Application not found");
    return app;
}

function dtEq(a: Date | null, b: Date | null) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.getTime() === b.getTime();
}
function dstr(d: Date | null) {
    return d ? d.toISOString().slice(0, 10) : "none";
}

// ------------------------------------------------------------------
// Applications
// ------------------------------------------------------------------

function parseApplication(formData: FormData) {
    const companyId = str(formData, "companyId");
    const role = str(formData, "role");
    if (!companyId) throw new Error("Company is required");
    if (!role) throw new Error("Role is required");

    return {
        companyId,
        role,
        applicationUrl: str(formData, "applicationUrl"),
        dateApplied: dateField(formData, "dateApplied"),
        status: (str(formData, "status") ?? "NOT_STARTED") as JobStatus,
        salaryMin: int(formData, "salaryMin"),
        salaryMax: int(formData, "salaryMax"),
        salaryCurrency: str(formData, "salaryCurrency") ?? "USD",
        location: str(formData, "location"),
        workType: (str(formData, "workType") ?? "NA") as WorkType,
        heardFrom: str(formData, "heardFrom"),
        deadline: dateField(formData, "deadline"),
        resumeVersionId: str(formData, "resumeVersionId"),
        coverLetterVersionId: str(formData, "coverLetterVersionId"),
        phaseId: str(formData, "phaseId"),
        notesMarkdown: str(formData, "notesMarkdown"),
        priority: Math.max(0, Math.min(3, int(formData, "priority") ?? 0)),
        referredByName: str(formData, "referredByName"),
        referredByRelationship: str(formData, "referredByRelationship"),
        targetId: str(formData, "targetId"),
    };
}

type AppData = ReturnType<typeof parseApplication>;

/**
 * Validate every user-selectable relation before an application write. Foreign
 * keys alone only prove that a row exists; they do not prove that it belongs to
 * the signed-in user.
 */
async function validateApplicationRelations(userId: string, data: AppData) {
    const [company, resumeVersion, coverLetterVersion, phase, target] = await Promise.all([
        db.company.findFirst({ where: { id: data.companyId, userId }, select: { id: true } }),
        data.resumeVersionId
            ? db.jobDocumentVersion.findFirst({
                  where: { id: data.resumeVersionId, document: { userId, kind: "RESUME" } },
                  select: { id: true },
              })
            : Promise.resolve(null),
        data.coverLetterVersionId
            ? db.jobDocumentVersion.findFirst({
                  where: { id: data.coverLetterVersionId, document: { userId, kind: "COVER_LETTER" } },
                  select: { id: true },
              })
            : Promise.resolve(null),
        data.phaseId
            ? db.jobPhase.findFirst({ where: { id: data.phaseId, userId }, select: { id: true } })
            : Promise.resolve(null),
        data.targetId
            ? db.careerTarget.findFirst({ where: { id: data.targetId, userId }, select: { id: true } })
            : Promise.resolve(null),
    ]);

    if (!company) throw new Error("Company not found");
    if (data.resumeVersionId && !resumeVersion) throw new Error("Resume version not found");
    if (data.coverLetterVersionId && !coverLetterVersion) throw new Error("Cover letter version not found");
    if (data.phaseId && !phase) throw new Error("Phase not found");
    if (data.targetId && !target) throw new Error("Target not found");
}

async function validateApplicationDocuments(userId: string, resumeVersionId: string | null, coverLetterVersionId: string | null) {
    const [resumeVersion, coverLetterVersion] = await Promise.all([
        resumeVersionId
            ? db.jobDocumentVersion.findFirst({
                  where: { id: resumeVersionId, document: { userId, kind: "RESUME" } },
                  select: { id: true },
              })
            : Promise.resolve(null),
        coverLetterVersionId
            ? db.jobDocumentVersion.findFirst({
                  where: { id: coverLetterVersionId, document: { userId, kind: "COVER_LETTER" } },
                  select: { id: true },
              })
            : Promise.resolve(null),
    ]);

    if (resumeVersionId && !resumeVersion) throw new Error("Resume version not found");
    if (coverLetterVersionId && !coverLetterVersion) throw new Error("Cover letter version not found");
}

function diffApplication(
    existing: {
        status: JobStatus;
        role: string;
        applicationUrl: string | null;
        dateApplied: Date | null;
        deadline: Date | null;
        salaryMin: number | null;
        salaryMax: number | null;
        location: string | null;
        workType: WorkType;
        heardFrom: string | null;
        phaseId: string | null;
        companyId: string;
        resumeVersionId: string | null;
        coverLetterVersionId: string | null;
        notesMarkdown: string | null;
    },
    data: AppData,
): { message: string; statusChanged: boolean; from: JobStatus; to: JobStatus } | null {
    const parts: string[] = [];
    let statusChanged = false;

    if (existing.status !== data.status) {
        parts.push(`status ${STATUS_LABELS[existing.status]} → ${STATUS_LABELS[data.status]}`);
        statusChanged = true;
    }
    if (existing.role !== data.role) parts.push("role");
    if ((existing.applicationUrl ?? null) !== data.applicationUrl) parts.push("link");
    if (!dtEq(existing.dateApplied, data.dateApplied)) parts.push(`date applied → ${dstr(data.dateApplied)}`);
    if (!dtEq(existing.deadline, data.deadline)) parts.push(`deadline → ${dstr(data.deadline)}`);
    if (existing.salaryMin !== data.salaryMin || existing.salaryMax !== data.salaryMax) parts.push("salary");
    if ((existing.location ?? null) !== data.location) parts.push("location");
    if (existing.workType !== data.workType) parts.push(`work type → ${WORK_TYPE_LABELS[data.workType]}`);
    if ((existing.heardFrom ?? null) !== data.heardFrom) parts.push("source");
    if ((existing.phaseId ?? null) !== data.phaseId) parts.push("phase");
    if (existing.companyId !== data.companyId) parts.push("company");
    if ((existing.resumeVersionId ?? null) !== data.resumeVersionId) parts.push("resume");
    if ((existing.coverLetterVersionId ?? null) !== data.coverLetterVersionId) parts.push("cover letter");
    if ((existing.notesMarkdown ?? null) !== data.notesMarkdown) parts.push("notes");

    if (parts.length === 0) return null;
    return { message: `Updated ${parts.join(", ")}`, statusChanged, from: existing.status, to: data.status };
}

export async function createApplication(formData: FormData) {
    const user = await requireUser();
    const data = parseApplication(formData);

    // Default to the current (most recent non-archived) phase if none chosen.
    if (!data.phaseId) {
        const current = await db.jobPhase.findFirst({
            where: { userId: user.id, archived: false },
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
            select: { id: true },
        });
        data.phaseId = current?.id ?? null;
    }

    await validateApplicationRelations(user.id, data);

    const app = await db.jobApplication.create({ data: { ...data, userId: user.id } });
    await logEvent(
        app.id,
        "created",
        `Application created${data.status !== "NOT_STARTED" ? ` as ${STATUS_LABELS[data.status]}` : ""}`,
        undefined,
        data.status,
    );
    revalidatePath("/career/applications");
    redirect(`/career/applications/${app.id}`);
}

export async function updateApplication(id: string, formData: FormData) {
    const user = await requireUser();
    const existing = await ownedApplication(user.id, id);
    const data = parseApplication(formData);
    await validateApplicationRelations(user.id, data);
    await db.jobApplication.update({ where: { id }, data });

    const diff = diffApplication(existing, data);
    if (diff) {
        await logEvent(
            id,
            diff.statusChanged ? "status" : "updated",
            diff.message,
            diff.statusChanged ? diff.from : undefined,
            diff.statusChanged ? diff.to : undefined,
        );
    }
    revalidatePath("/career/applications");
    revalidatePath(`/career/applications/${id}`);
    redirect(`/career/applications/${id}`);
}

export async function deleteApplication(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    await ownedApplication(user.id, id);
    const attachments = await db.jobAttachment.findMany({
        where: {
            OR: [{ applicationId: id }, { meeting: { is: { applicationId: id } } }],
        },
        select: { fileKey: true },
    });
    await db.jobApplication.delete({ where: { id } });
    await Promise.all(attachments.map(({ fileKey }) => deleteObject(fileKey).catch(() => {})));
    revalidatePath("/career/applications");
    redirect("/career/applications");
}

export async function updateStatus(id: string, status: JobStatus) {
    const user = await requireUser();
    const existing = await ownedApplication(user.id, id);
    await db.jobApplication.update({ where: { id }, data: { status } });
    if (existing.status !== status) {
        await logEvent(id, "status", `Status ${STATUS_LABELS[existing.status]} → ${STATUS_LABELS[status]}`, existing.status, status);
    }
    revalidatePath("/career/applications");
    revalidatePath(`/career/applications/${id}`);
    revalidatePath("/career");
}

/** Move several applications to a new status at once (logs a status event each). */
export async function bulkUpdateApplicationStatus(ids: string[], status: JobStatus) {
    const user = await requireUser();
    if (!ids.length) return;
    const apps = await db.jobApplication.findMany({ where: { id: { in: ids }, userId: user.id }, select: { id: true, status: true } });
    for (const app of apps) {
        if (app.status === status) continue;
        await db.jobApplication.update({ where: { id: app.id }, data: { status } });
        await logEvent(app.id, "status", `Status ${STATUS_LABELS[app.status]} → ${STATUS_LABELS[status]}`, app.status, status);
    }
    revalidatePath("/career/applications");
    revalidatePath("/career");
    revalidatePath("/career/companies", "layout");
}

/** Delete several applications at once. */
export async function bulkDeleteApplications(ids: string[]) {
    const user = await requireUser();
    if (!ids.length) return;
    const applications = await db.jobApplication.findMany({
        where: { id: { in: ids }, userId: user.id },
        select: { id: true },
    });
    const applicationIds = applications.map(({ id }) => id);
    if (applicationIds.length) {
        const attachments = await db.jobAttachment.findMany({
            where: {
                OR: [
                    { applicationId: { in: applicationIds } },
                    { meeting: { is: { applicationId: { in: applicationIds } } } },
                ],
            },
            select: { fileKey: true },
        });
        await db.jobApplication.deleteMany({ where: { id: { in: applicationIds }, userId: user.id } });
        await Promise.all(attachments.map(({ fileKey }) => deleteObject(fileKey).catch(() => {})));
    }
    revalidatePath("/career/applications");
    revalidatePath("/career");
    revalidatePath("/career/companies", "layout");
}

/** Update resume / cover letter version from the application detail page. */
export async function updateApplicationDocuments(id: string, formData: FormData) {
    const user = await requireUser();
    await ownedApplication(user.id, id);
    const resumeVersionId = str(formData, "resumeVersionId");
    const coverLetterVersionId = str(formData, "coverLetterVersionId");
    await validateApplicationDocuments(user.id, resumeVersionId, coverLetterVersionId);
    await db.jobApplication.update({ where: { id }, data: { resumeVersionId, coverLetterVersionId } });
    revalidatePath(`/career/applications/${id}`);
}

/** Inline notes edit from the application detail page. */
export async function updateApplicationNotes(id: string, formData: FormData) {
    const user = await requireUser();
    await ownedApplication(user.id, id);
    await db.jobApplication.update({ where: { id }, data: { notesMarkdown: str(formData, "notes") } });
    await logEvent(id, "updated", "Notes updated");
    revalidatePath(`/career/applications/${id}`);
}

// ------------------------------------------------------------------
// Phases
// ------------------------------------------------------------------

function revalidatePhases() {
    revalidatePath("/career/applications");
    revalidatePath("/career");
}

export async function createPhase(formData: FormData) {
    const user = await requireUser();
    const name = str(formData, "name");
    if (!name) throw new Error("Phase name is required");
    const startedStr = str(formData, "startedAt");
    await db.jobPhase.create({
        data: { userId: user.id, name, startedAt: startedStr ? new Date(`${startedStr}T00:00:00`) : null },
    });
    revalidatePhases();
}

export async function renamePhase(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const name = str(formData, "name");
    if (!name) throw new Error("Name is required");
    const phase = await db.jobPhase.findFirst({ where: { id, userId: user.id } });
    if (!phase) throw new Error("Phase not found");
    await db.jobPhase.update({ where: { id }, data: { name } });
    revalidatePhases();
}

export async function setPhaseArchived(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const archived = String(formData.get("archived")) === "1";
    const phase = await db.jobPhase.findFirst({ where: { id, userId: user.id } });
    if (!phase) throw new Error("Phase not found");
    await db.jobPhase.update({ where: { id }, data: { archived } });
    revalidatePhases();
}

export async function deletePhase(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const phase = await db.jobPhase.findFirst({ where: { id, userId: user.id } });
    if (!phase) throw new Error("Phase not found");
    // Applications keep their data; their phaseId is set null (relation onDelete: SetNull).
    await db.jobPhase.delete({ where: { id } });
    revalidatePhases();
}

// ------------------------------------------------------------------
// Attachments
// ------------------------------------------------------------------

/** Resolve the owning application id for an attachment owner. */
async function resolveApplicationId(owner: { applicationId?: string; meetingId?: string }) {
    if (owner.applicationId) return owner.applicationId;
    if (owner.meetingId) {
        const m = await db.jobMeeting.findUnique({ where: { id: owner.meetingId }, select: { applicationId: true } });
        return m?.applicationId ?? null;
    }
    return null;
}

type StagedAttachment = Awaited<ReturnType<typeof uploadUserMediaFile>>;

async function deleteStagedAttachments(files: StagedAttachment[]) {
    await Promise.allSettled(files.map(({ fileKey }) => deleteObject(fileKey)));
}

async function stageAttachments(userId: string, files: File[]): Promise<StagedAttachment[]> {
    validateUploadBatch(files);
    const staged: StagedAttachment[] = [];
    try {
        for (const file of files) staged.push(await uploadUserMediaFile(userId, "jobs", file));
        return staged;
    } catch (error) {
        await deleteStagedAttachments(staged);
        throw error;
    }
}

async function saveAttachments(userId: string, files: File[], owner: { applicationId?: string; meetingId?: string }) {
    const applicationId = await resolveApplicationId(owner);
    if (!applicationId) throw new Error("Attachment owner not found");
    await ownedApplication(userId, applicationId);
    const staged = await stageAttachments(userId, files);
    if (!staged.length) return;
    try {
        await db.jobAttachment.createMany({ data: staged.map((stored) => ({ ...stored, ...owner })) });
    } catch (error) {
        await deleteStagedAttachments(staged);
        throw error;
    }
    if (applicationId) {
        const suffix = owner.meetingId ? " to a meeting" : "";
        const message = staged.length === 1
            ? `Attached ${staged[0]?.fileName ?? "file"}${suffix}`
            : `Attached ${staged.length} files${suffix}`;
        await logEvent(applicationId, "attachment", message).catch(() => {});
    }
}

export async function uploadApplicationAttachments(applicationId: string, formData: FormData) {
    const user = await requireUser();
    await ownedApplication(user.id, applicationId);
    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    await saveAttachments(user.id, files, { applicationId });
    revalidatePath(`/career/applications/${applicationId}`);
}

export async function deleteAttachment(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const att = await db.jobAttachment.findUnique({ where: { id } });
    if (!att) throw new Error("Attachment not found");
    const applicationId = await resolveApplicationId({
        applicationId: att.applicationId ?? undefined,
        meetingId: att.meetingId ?? undefined,
    });
    if (!applicationId) throw new Error("Attachment not found");
    await ownedApplication(user.id, applicationId);
    await db.jobAttachment.delete({ where: { id } });
    await deleteObject(att.fileKey).catch(() => {});
    await logEvent(applicationId, "attachment", `Removed attachment ${att.fileName}`);
    revalidatePath(`/career/applications/${applicationId}`);
}

// ------------------------------------------------------------------
// Meetings
// ------------------------------------------------------------------

function parseMeeting(formData: FormData) {
    const dt = str(formData, "dateTime");
    const duration = str(formData, "durationMinutes");
    const participantNames = (str(formData, "participantNames") ?? "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    const participantIds = formData.getAll("participantIds").map(String).filter(Boolean);

    return {
        type: str(formData, "type"),
        durationMinutes: duration ? parseInt(duration, 10) || null : null,
        dateTime: dt ? new Date(dt) : null,
        location: str(formData, "location"),
        notesMarkdown: str(formData, "notesMarkdown"),
        participantNames,
        participantIds,
    };
}

async function ownedMeetingParticipantIds(userId: string, values: string[]): Promise<string[]> {
    const ids = [...new Set(values)];
    if (!ids.length) return [];
    const owned = await db.jobContact.findMany({ where: { id: { in: ids }, userId }, select: { id: true } });
    if (owned.length !== ids.length) throw new Error("One or more meeting contacts were not found");
    return ids;
}

export async function createMeeting(applicationId: string, formData: FormData) {
    const user = await requireUser();
    await ownedApplication(user.id, applicationId);
    const { participantIds: submittedParticipantIds, ...data } = parseMeeting(formData);
    const participantIds = await ownedMeetingParticipantIds(user.id, submittedParticipantIds);
    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    const staged = await stageAttachments(user.id, files);
    try {
        await db.$transaction(async (tx) => {
            const meeting = await tx.jobMeeting.create({
                data: { ...data, applicationId, participants: { connect: participantIds.map((id) => ({ id })) } },
            });
            if (staged.length) {
                await tx.jobAttachment.createMany({ data: staged.map((stored) => ({ ...stored, meetingId: meeting.id })) });
            }
        });
    } catch (error) {
        await deleteStagedAttachments(staged);
        throw error;
    }
    await logEvent(applicationId, "meeting", `Added meeting${data.type ? `: ${data.type}` : ""}`).catch(() => {});
    revalidatePath(`/career/applications/${applicationId}`);
}

export async function updateMeeting(id: string, formData: FormData) {
    const user = await requireUser();
    const meeting = await db.jobMeeting.findUnique({ where: { id }, include: { application: true } });
    if (!meeting || meeting.application.userId !== user.id) throw new Error("Meeting not found");
    const { participantIds: submittedParticipantIds, ...data } = parseMeeting(formData);
    const participantIds = await ownedMeetingParticipantIds(user.id, submittedParticipantIds);
    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    const staged = await stageAttachments(user.id, files);
    try {
        await db.$transaction(async (tx) => {
            await tx.jobMeeting.update({
                where: { id },
                data: { ...data, participants: { set: participantIds.map((pid) => ({ id: pid })) } },
            });
            if (staged.length) {
                await tx.jobAttachment.createMany({ data: staged.map((stored) => ({ ...stored, meetingId: id })) });
            }
        });
    } catch (error) {
        await deleteStagedAttachments(staged);
        throw error;
    }
    await logEvent(meeting.applicationId, "meeting", `Updated meeting${data.type ? `: ${data.type}` : ""}`).catch(() => {});
    revalidatePath(`/career/applications/${meeting.applicationId}`);
}

export async function deleteMeeting(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const meeting = await db.jobMeeting.findUnique({
        where: { id },
        include: { application: true, attachments: { select: { fileKey: true } } },
    });
    if (!meeting || meeting.application.userId !== user.id) throw new Error("Meeting not found");
    await db.jobMeeting.delete({ where: { id } });
    await Promise.all(meeting.attachments.map(({ fileKey }) => deleteObject(fileKey).catch(() => {})));
    await logEvent(meeting.applicationId, "meeting", "Removed a meeting");
    revalidatePath(`/career/applications/${meeting.applicationId}`);
}
