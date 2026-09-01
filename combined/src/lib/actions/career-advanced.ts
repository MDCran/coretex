"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
    ContactMethod,
    InterviewFormat,
    JobContactKind,
    NegotiationKind,
    OfferStatus,
    RoundOutcome,
} from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { uploadUserMediaFile } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";

/**
 * CRUD for the career "power features": interview rounds, prep checklists,
 * interview-question bank, STAR stories, offers + negotiation, networking
 * outreach, and the career-goals board. All ownership-checked by userId.
 */

// ------------------------------------------------------------------
// Form helpers
// ------------------------------------------------------------------

function str(fd: FormData, k: string) {
    const v = fd.get(k);
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
}
function int(fd: FormData, k: string) {
    const s = str(fd, k);
    if (s == null) return null;
    const n = parseInt(s.replace(/[^0-9.-]/g, ""), 10);
    return Number.isNaN(n) ? null : n;
}
function bool(fd: FormData, k: string) {
    const v = fd.get(k);
    return v === "on" || v === "true" || v === "1";
}
function dt(fd: FormData, k: string) {
    const s = str(fd, k);
    if (!s) return null;
    const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
    return Number.isNaN(d.getTime()) ? null : d;
}
function listOf(fd: FormData, k: string): string[] {
    return (str(fd, k) ?? "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
}
function enumOf<T extends Record<string, string>>(e: T, v: string | null, fallback: T[keyof T]): T[keyof T] {
    return v && Object.values(e).includes(v) ? (v as T[keyof T]) : fallback;
}

/** Bump an application's lastActivityAt so ghosting/health stay accurate. */
async function touch(applicationId: string) {
    await db.jobApplication.update({ where: { id: applicationId }, data: { lastActivityAt: new Date() } }).catch(() => {});
}

async function ownedApplication(userId: string, id: string) {
    const app = await db.jobApplication.findFirst({ where: { id, userId }, select: { id: true } });
    if (!app) throw new Error("Application not found");
    return app;
}

async function validateQuestionRelations(
    userId: string,
    data: { applicationId: string | null; companyId: string | null; roundId: string | null },
) {
    const [application, company, round] = await Promise.all([
        data.applicationId
            ? db.jobApplication.findFirst({ where: { id: data.applicationId, userId }, select: { id: true } })
            : Promise.resolve(null),
        data.companyId
            ? db.company.findFirst({ where: { id: data.companyId, userId }, select: { id: true } })
            : Promise.resolve(null),
        data.roundId
            ? db.interviewRound.findFirst({ where: { id: data.roundId, userId }, select: { id: true, applicationId: true } })
            : Promise.resolve(null),
    ]);

    if (data.applicationId && !application) throw new Error("Application not found");
    if (data.companyId && !company) throw new Error("Company not found");
    if (data.roundId && !round) throw new Error("Round not found");
    if (round && data.applicationId && round.applicationId !== data.applicationId) {
        throw new Error("Round does not belong to the selected application");
    }
}

async function validateOutreachRelations(userId: string, data: { contactId: string | null; companyId: string | null }) {
    const [contact, company] = await Promise.all([
        data.contactId
            ? db.jobContact.findFirst({ where: { id: data.contactId, userId }, select: { id: true } })
            : Promise.resolve(null),
        data.companyId
            ? db.company.findFirst({ where: { id: data.companyId, userId }, select: { id: true } })
            : Promise.resolve(null),
    ]);

    if (data.contactId && !contact) throw new Error("Contact not found");
    if (data.companyId && !company) throw new Error("Company not found");
}

function appPath(id: string) {
    return `/career/applications/${id}`;
}

// ==================================================================
// Application extras: priority, JD archive, referral, target, thank-you
// ==================================================================

export async function setApplicationPriority(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    await ownedApplication(user.id, id);
    const priority = Math.max(0, Math.min(3, int(fd, "priority") ?? 0));
    await db.jobApplication.update({ where: { id }, data: { priority } });
    revalidatePath(appPath(id));
    revalidatePath("/career/applications");
}

export async function updateApplicationJd(id: string, fd: FormData) {
    const user = await requireUser();
    await ownedApplication(user.id, id);
    await db.jobApplication.update({ where: { id }, data: { jdText: str(fd, "jdText") } });
    revalidatePath(appPath(id));
}

export async function setApplicationThankYou(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    await ownedApplication(user.id, id);
    await db.jobApplication.update({ where: { id }, data: { thankYouSent: bool(fd, "thankYouSent") } });
    revalidatePath(appPath(id));
}

export async function updateApplicationReferral(id: string, fd: FormData) {
    const user = await requireUser();
    await ownedApplication(user.id, id);
    const referredByContactId = str(fd, "referredByContactId");
    if (referredByContactId) {
        const contact = await db.jobContact.findFirst({ where: { id: referredByContactId, userId: user.id }, select: { id: true } });
        if (!contact) throw new Error("Contact not found");
    }
    await db.jobApplication.update({
        where: { id },
        data: {
            referredByName: str(fd, "referredByName"),
            referredByRelationship: str(fd, "referredByRelationship"),
            referredByContactId,
        },
    });
    revalidatePath(appPath(id));
}

export async function setApplicationTarget(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    await ownedApplication(user.id, id);
    const targetId = str(fd, "targetId");
    if (targetId) {
        const target = await db.careerTarget.findFirst({ where: { id: targetId, userId: user.id }, select: { id: true } });
        if (!target) throw new Error("Target not found");
    }
    await db.jobApplication.update({ where: { id }, data: { targetId } });
    revalidatePath(appPath(id));
    revalidatePath("/career/goals");
}

// ==================================================================
// Interview rounds
// ==================================================================

function parseRound(fd: FormData) {
    return {
        roundNumber: int(fd, "roundNumber") ?? 1,
        name: str(fd, "name"),
        format: enumOf(InterviewFormat, str(fd, "format"), InterviewFormat.VIDEO),
        scheduledAt: dt(fd, "scheduledAt"),
        durationMinutes: int(fd, "durationMinutes"),
        outcome: enumOf(RoundOutcome, str(fd, "outcome"), RoundOutcome.PENDING),
        selfRating: (() => {
            const r = int(fd, "selfRating");
            return r == null ? null : Math.max(1, Math.min(5, r));
        })(),
        interviewerNames: listOf(fd, "interviewerNames"),
        notesMarkdown: str(fd, "notesMarkdown"),
        thankYouSent: bool(fd, "thankYouSent"),
    };
}

export async function createRound(applicationId: string, fd: FormData) {
    const user = await requireUser();
    await ownedApplication(user.id, applicationId);
    const data = parseRound(fd);
    await db.interviewRound.create({
        data: { ...data, applicationId, userId: user.id, thankYouSentAt: data.thankYouSent ? new Date() : null },
    });
    await db.jobApplicationEvent.create({
        data: { applicationId, type: "meeting", message: `Logged interview ${data.name ?? `round ${data.roundNumber}`}` },
    });
    await touch(applicationId);
    revalidatePath(appPath(applicationId));
}

export async function updateRound(id: string, fd: FormData) {
    const user = await requireUser();
    const round = await db.interviewRound.findFirst({ where: { id, userId: user.id }, select: { applicationId: true, thankYouSent: true } });
    if (!round) throw new Error("Round not found");
    const data = parseRound(fd);
    await db.interviewRound.update({
        where: { id },
        data: { ...data, thankYouSentAt: data.thankYouSent ? new Date() : null },
    });
    await touch(round.applicationId);
    revalidatePath(appPath(round.applicationId));
}

export async function deleteRound(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const round = await db.interviewRound.findFirst({ where: { id, userId: user.id }, select: { applicationId: true } });
    if (!round) throw new Error("Round not found");
    await db.interviewRound.delete({ where: { id } });
    revalidatePath(appPath(round.applicationId));
}

export async function toggleRoundThankYou(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const round = await db.interviewRound.findFirst({ where: { id, userId: user.id }, select: { applicationId: true, thankYouSent: true } });
    if (!round) throw new Error("Round not found");
    const next = !round.thankYouSent;
    await db.interviewRound.update({ where: { id }, data: { thankYouSent: next, thankYouSentAt: next ? new Date() : null } });
    revalidatePath(appPath(round.applicationId));
}

// ==================================================================
// Prep checklist
// ==================================================================

const DEFAULT_PREP = [
    "Research the company & product",
    "Review the job description & requirements",
    "Prepare 3–4 STAR stories",
    "Prepare questions to ask them",
    "Test tech setup (camera/mic/links)",
    "Review your resume & projects",
];

export async function seedPrepChecklist(fd: FormData) {
    const user = await requireUser();
    const applicationId = String(fd.get("applicationId"));
    await ownedApplication(user.id, applicationId);
    const existing = await db.prepChecklistItem.count({ where: { applicationId } });
    if (existing > 0) return;
    await db.prepChecklistItem.createMany({
        data: DEFAULT_PREP.map((label, i) => ({ applicationId, userId: user.id, label, sortOrder: i })),
    });
    revalidatePath(appPath(applicationId));
}

export async function addPrepItem(applicationId: string, fd: FormData) {
    const user = await requireUser();
    await ownedApplication(user.id, applicationId);
    const label = str(fd, "label");
    if (!label) return;
    const max = await db.prepChecklistItem.aggregate({ where: { applicationId }, _max: { sortOrder: true } });
    await db.prepChecklistItem.create({ data: { applicationId, userId: user.id, label, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    revalidatePath(appPath(applicationId));
}

export async function togglePrepItem(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const item = await db.prepChecklistItem.findFirst({ where: { id, userId: user.id }, select: { applicationId: true, done: true } });
    if (!item) throw new Error("Item not found");
    await db.prepChecklistItem.update({ where: { id }, data: { done: !item.done } });
    revalidatePath(appPath(item.applicationId));
}

export async function deletePrepItem(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const item = await db.prepChecklistItem.findFirst({ where: { id, userId: user.id }, select: { applicationId: true } });
    if (!item) throw new Error("Item not found");
    await db.prepChecklistItem.delete({ where: { id } });
    revalidatePath(appPath(item.applicationId));
}

// ==================================================================
// Interview question bank
// ==================================================================

function parseQuestion(fd: FormData) {
    return {
        question: str(fd, "question") ?? "",
        answer: str(fd, "answer"),
        category: str(fd, "category"),
        applicationId: str(fd, "applicationId"),
        companyId: str(fd, "companyId"),
        roundId: str(fd, "roundId"),
    };
}

export async function createQuestion(fd: FormData) {
    const user = await requireUser();
    const data = parseQuestion(fd);
    if (!data.question) throw new Error("Question text is required");
    await validateQuestionRelations(user.id, data);
    await db.interviewQuestion.create({ data: { ...data, userId: user.id } });
    if (data.applicationId) revalidatePath(appPath(data.applicationId));
    revalidatePath("/career/prep");
}

export async function updateQuestion(id: string, fd: FormData) {
    const user = await requireUser();
    const existing = await db.interviewQuestion.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Question not found");
    const data = parseQuestion(fd);
    if (!data.question) throw new Error("Question text is required");
    await validateQuestionRelations(user.id, data);
    await db.interviewQuestion.update({ where: { id }, data });
    if (data.applicationId) revalidatePath(appPath(data.applicationId));
    revalidatePath("/career/prep");
}

export async function deleteQuestion(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const q = await db.interviewQuestion.findFirst({ where: { id, userId: user.id }, select: { applicationId: true } });
    if (!q) throw new Error("Question not found");
    await db.interviewQuestion.delete({ where: { id } });
    if (q.applicationId) revalidatePath(appPath(q.applicationId));
    revalidatePath("/career/prep");
}

// ==================================================================
// STAR story library
// ==================================================================

function parseStar(fd: FormData) {
    return {
        title: str(fd, "title") ?? "",
        situation: str(fd, "situation"),
        task: str(fd, "task"),
        action: str(fd, "action"),
        result: str(fd, "result"),
        tags: listOf(fd, "tags"),
    };
}

export async function createStarStory(fd: FormData) {
    const user = await requireUser();
    const data = parseStar(fd);
    if (!data.title) throw new Error("Give the story a title");
    await db.starStory.create({ data: { ...data, userId: user.id } });
    revalidatePath("/career/prep");
}

export async function updateStarStory(id: string, fd: FormData) {
    const user = await requireUser();
    const existing = await db.starStory.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Story not found");
    const data = parseStar(fd);
    if (!data.title) throw new Error("Give the story a title");
    await db.starStory.update({ where: { id }, data });
    revalidatePath("/career/prep");
}

export async function deleteStarStory(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const s = await db.starStory.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!s) throw new Error("Story not found");
    await db.starStory.delete({ where: { id } });
    revalidatePath("/career/prep");
}

// ==================================================================
// Offers + negotiation
// ==================================================================

function parseOffer(fd: FormData) {
    return {
        status: enumOf(OfferStatus, str(fd, "status"), OfferStatus.RECEIVED),
        baseSalary: int(fd, "baseSalary"),
        bonus: int(fd, "bonus"),
        equityValue: int(fd, "equityValue"),
        equityDescription: str(fd, "equityDescription"),
        signOnBonus: int(fd, "signOnBonus"),
        ptoDays: int(fd, "ptoDays"),
        currency: str(fd, "currency") ?? "USD",
        benefits: str(fd, "benefits"),
        location: str(fd, "location"),
        remote: fd.has("remote") ? bool(fd, "remote") : null,
        startDate: dt(fd, "startDate"),
        decisionDeadline: dt(fd, "decisionDeadline"),
        notesMarkdown: str(fd, "notesMarkdown"),
        receivedAt: dt(fd, "receivedAt"),
    };
}

export async function createOffer(applicationId: string, fd: FormData) {
    const user = await requireUser();
    await ownedApplication(user.id, applicationId);
    const data = parseOffer(fd);
    const letter = fd.get("letter") as File | null;
    let letterFileKey: string | null = null;
    let letterFileName: string | null = null;
    if (letter && letter.size > 0) {
        const stored = await uploadUserMediaFile(user.id, "jobs", letter);
        letterFileKey = stored.fileKey;
        letterFileName = stored.fileName;
    }
    try {
        await db.$transaction([
            db.offer.create({ data: { ...data, applicationId, userId: user.id, letterFileKey, letterFileName, receivedAt: data.receivedAt ?? new Date() } }),
            db.jobApplicationEvent.create({ data: { applicationId, type: "updated", message: "Offer logged" } }),
        ]);
    } catch (error) {
        if (letterFileKey) await deleteObject(letterFileKey).catch(() => {});
        throw error;
    }
    await touch(applicationId);
    revalidatePath(appPath(applicationId));
    revalidatePath("/career/offers");
}

export async function updateOffer(id: string, fd: FormData) {
    const user = await requireUser();
    const offer = await db.offer.findFirst({ where: { id, userId: user.id }, select: { applicationId: true, letterFileKey: true } });
    if (!offer) throw new Error("Offer not found");
    const data = parseOffer(fd);
    const letter = fd.get("letter") as File | null;
    let letterUpdate: { letterFileKey?: string; letterFileName?: string } = {};
    let uploadedLetterFileKey: string | null = null;
    if (letter && letter.size > 0) {
        const stored = await uploadUserMediaFile(user.id, "jobs", letter);
        letterUpdate = { letterFileKey: stored.fileKey, letterFileName: stored.fileName };
        uploadedLetterFileKey = stored.fileKey;
    }
    try {
        await db.offer.update({ where: { id }, data: { ...data, ...letterUpdate } });
    } catch (error) {
        if (uploadedLetterFileKey) await deleteObject(uploadedLetterFileKey).catch(() => {});
        throw error;
    }
    if (uploadedLetterFileKey && offer.letterFileKey && offer.letterFileKey !== uploadedLetterFileKey) {
        await deleteObject(offer.letterFileKey).catch(() => {});
    }
    revalidatePath(appPath(offer.applicationId));
    revalidatePath("/career/offers");
}

export async function deleteOffer(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const offer = await db.offer.findFirst({ where: { id, userId: user.id }, select: { applicationId: true, letterFileKey: true } });
    if (!offer) throw new Error("Offer not found");
    await db.offer.delete({ where: { id } });
    if (offer.letterFileKey) await deleteObject(offer.letterFileKey).catch(() => {});
    revalidatePath(appPath(offer.applicationId));
    revalidatePath("/career/offers");
}

export async function addNegotiationStep(offerId: string, fd: FormData) {
    const user = await requireUser();
    const offer = await db.offer.findFirst({ where: { id: offerId, userId: user.id }, select: { applicationId: true } });
    if (!offer) throw new Error("Offer not found");
    await db.negotiationStep.create({
        data: {
            offerId,
            userId: user.id,
            kind: enumOf(NegotiationKind, str(fd, "kind"), NegotiationKind.COUNTER),
            date: dt(fd, "date") ?? new Date(),
            baseSalary: int(fd, "baseSalary"),
            bonus: int(fd, "bonus"),
            equityValue: int(fd, "equityValue"),
            rationale: str(fd, "rationale"),
            outcome: str(fd, "outcome"),
        },
    });
    // Reflect that we are actively negotiating.
    await db.offer.update({ where: { id: offerId }, data: { status: OfferStatus.NEGOTIATING } }).catch(() => {});
    revalidatePath(appPath(offer.applicationId));
    revalidatePath("/career/offers");
}

export async function deleteNegotiationStep(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const step = await db.negotiationStep.findFirst({ where: { id, userId: user.id }, include: { offer: { select: { applicationId: true } } } });
    if (!step) throw new Error("Step not found");
    await db.negotiationStep.delete({ where: { id } });
    revalidatePath(appPath(step.offer.applicationId));
    revalidatePath("/career/offers");
}

// ==================================================================
// Networking outreach
// ==================================================================

function parseOutreach(fd: FormData) {
    return {
        personName: str(fd, "personName") ?? "",
        contactId: str(fd, "contactId"),
        companyId: str(fd, "companyId"),
        channel: str(fd, "channel") ? enumOf(ContactMethod, str(fd, "channel"), ContactMethod.LINKEDIN) : null,
        sentAt: dt(fd, "sentAt"),
        responded: bool(fd, "responded"),
        respondedAt: dt(fd, "respondedAt"),
        converted: bool(fd, "converted"),
        notesMarkdown: str(fd, "notesMarkdown"),
    };
}

export async function createOutreach(fd: FormData) {
    const user = await requireUser();
    const data = parseOutreach(fd);
    if (!data.personName) throw new Error("Who did you reach out to?");
    await validateOutreachRelations(user.id, data);
    await db.networkingOutreach.create({
        data: { ...data, userId: user.id, sentAt: data.sentAt ?? new Date(), respondedAt: data.responded ? (data.respondedAt ?? new Date()) : null },
    });
    revalidatePath("/career/networking");
}

export async function updateOutreach(id: string, fd: FormData) {
    const user = await requireUser();
    const existing = await db.networkingOutreach.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Outreach not found");
    const data = parseOutreach(fd);
    if (!data.personName) throw new Error("Who did you reach out to?");
    await validateOutreachRelations(user.id, data);
    await db.networkingOutreach.update({
        where: { id },
        data: { ...data, respondedAt: data.responded ? (data.respondedAt ?? new Date()) : null },
    });
    revalidatePath("/career/networking");
}

export async function toggleOutreachResponded(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const o = await db.networkingOutreach.findFirst({ where: { id, userId: user.id }, select: { responded: true } });
    if (!o) throw new Error("Outreach not found");
    const next = !o.responded;
    await db.networkingOutreach.update({ where: { id }, data: { responded: next, respondedAt: next ? new Date() : null } });
    revalidatePath("/career/networking");
}

export async function deleteOutreach(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const o = await db.networkingOutreach.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!o) throw new Error("Outreach not found");
    await db.networkingOutreach.delete({ where: { id } });
    revalidatePath("/career/networking");
}

// ==================================================================
// Career targets (goals board)
// ==================================================================

function parseTarget(fd: FormData) {
    return {
        title: str(fd, "title") ?? "",
        targetRole: str(fd, "targetRole"),
        targetCompanyType: str(fd, "targetCompanyType"),
        targetSalary: int(fd, "targetSalary"),
        targetLocation: str(fd, "targetLocation"),
        notesMarkdown: str(fd, "notesMarkdown"),
        isPrimary: bool(fd, "isPrimary"),
    };
}

export async function createTarget(fd: FormData) {
    const user = await requireUser();
    const data = parseTarget(fd);
    if (!data.title) throw new Error("Give the target a title");
    const max = await db.careerTarget.aggregate({ where: { userId: user.id }, _max: { sortOrder: true } });
    await db.careerTarget.create({ data: { ...data, userId: user.id, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    revalidatePath("/career/goals");
}

export async function updateTarget(id: string, fd: FormData) {
    const user = await requireUser();
    const existing = await db.careerTarget.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Target not found");
    const data = parseTarget(fd);
    if (!data.title) throw new Error("Give the target a title");
    await db.careerTarget.update({ where: { id }, data });
    revalidatePath("/career/goals");
}

export async function deleteTarget(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const t = await db.careerTarget.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!t) throw new Error("Target not found");
    await db.careerTarget.delete({ where: { id } });
    revalidatePath("/career/goals");
}

// ==================================================================
// Contact CRM kind
// ==================================================================

export async function setContactKind(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const c = await db.jobContact.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!c) throw new Error("Contact not found");
    const kind = str(fd, "kind");
    await db.jobContact.update({ where: { id }, data: { kind: kind ? enumOf(JobContactKind, kind, JobContactKind.OTHER) : null } });
    revalidatePath(`/career/contacts/${id}`);
    revalidatePath("/career/contacts");
}
