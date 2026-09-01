"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// ---------- helpers ----------

function str(formData: FormData, key: string): string | null {
    const v = formData.get(key);
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
}

function reqStr(formData: FormData, key: string, label: string): string {
    const v = str(formData, key);
    if (!v) throw new Error(`${label} is required`);
    return v;
}

function num(formData: FormData, key: string): number | null {
    const v = str(formData, key);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function date(formData: FormData, key: string): Date | null {
    const v = str(formData, key);
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
}

function csv(formData: FormData, key: string): string[] {
    return (str(formData, key) ?? "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

const HUB = "/career";

// ============================================================
// Skills
// ============================================================

export async function createSkill(formData: FormData) {
    const user = await requireUser();
    await db.careerSkill.create({
        data: {
            userId: user.id,
            name: reqStr(formData, "name", "Skill name"),
            category: str(formData, "category"),
            proficiency: num(formData, "proficiency"),
            targetProficiency: num(formData, "targetProficiency"),
            practicePlan: str(formData, "practicePlan"),
            proofUrl: str(formData, "proofUrl"),
            hoursLogged: num(formData, "hoursLogged") ?? 0,
        },
    });
    revalidatePath("/career/skills");
    revalidatePath(HUB);
}

export async function updateSkill(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Skill");
    const existing = await db.careerSkill.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Skill not found");
    await db.careerSkill.update({
        where: { id },
        data: {
            name: reqStr(formData, "name", "Skill name"),
            category: str(formData, "category"),
            proficiency: num(formData, "proficiency"),
            targetProficiency: num(formData, "targetProficiency"),
            practicePlan: str(formData, "practicePlan"),
            proofUrl: str(formData, "proofUrl"),
            hoursLogged: num(formData, "hoursLogged") ?? 0,
        },
    });
    revalidatePath("/career/skills");
    revalidatePath(HUB);
}

export async function deleteSkill(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Skill");
    const existing = await db.careerSkill.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Skill not found");
    await db.careerSkill.delete({ where: { id } });
    revalidatePath("/career/skills");
    revalidatePath(HUB);
}

export async function createSkillEvidence(formData: FormData) {
    const user = await requireUser();
    const skillId = reqStr(formData, "skillId", "Skill");
    const skill = await db.careerSkill.findFirst({ where: { id: skillId, userId: user.id } });
    if (!skill) throw new Error("Skill not found");
    await db.careerSkillEvidence.create({
        data: {
            skillId,
            description: str(formData, "description"),
            evidenceUrl: str(formData, "evidenceUrl"),
            evidenceType: str(formData, "evidenceType"),
        },
    });
    revalidatePath("/career/skills");
}

export async function deleteSkillEvidence(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Evidence");
    const ev = await db.careerSkillEvidence.findFirst({ where: { id, skill: { userId: user.id } } });
    if (!ev) throw new Error("Evidence not found");
    await db.careerSkillEvidence.delete({ where: { id } });
    revalidatePath("/career/skills");
}

// ============================================================
// Certifications
// ============================================================

export async function createCertification(formData: FormData) {
    const user = await requireUser();
    await db.careerCertification.create({
        data: {
            userId: user.id,
            name: reqStr(formData, "name", "Certification name"),
            issuer: str(formData, "issuer"),
            status: str(formData, "status") ?? "planned",
            examDate: date(formData, "examDate"),
            completedAt: date(formData, "completedAt"),
            expiresAt: date(formData, "expiresAt"),
        },
    });
    revalidatePath("/career/certifications");
    revalidatePath(HUB);
}

export async function updateCertification(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Certification");
    const existing = await db.careerCertification.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Certification not found");
    await db.careerCertification.update({
        where: { id },
        data: {
            name: reqStr(formData, "name", "Certification name"),
            issuer: str(formData, "issuer"),
            status: str(formData, "status") ?? "planned",
            examDate: date(formData, "examDate"),
            completedAt: date(formData, "completedAt"),
            expiresAt: date(formData, "expiresAt"),
        },
    });
    revalidatePath("/career/certifications");
    revalidatePath(HUB);
}

export async function deleteCertification(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Certification");
    const existing = await db.careerCertification.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Certification not found");
    await db.careerCertification.delete({ where: { id } });
    revalidatePath("/career/certifications");
    revalidatePath(HUB);
}

// ============================================================
// Projects
// ============================================================

export async function createProject(formData: FormData) {
    const user = await requireUser();
    await db.careerProject.create({
        data: {
            userId: user.id,
            name: reqStr(formData, "name", "Project name"),
            role: str(formData, "role"),
            description: str(formData, "description"),
            technologies: csv(formData, "technologies"),
            startedOn: date(formData, "startedOn"),
            completedOn: date(formData, "completedOn"),
            impactDescription: str(formData, "impactDescription"),
            url: str(formData, "url"),
        },
    });
    revalidatePath("/career/projects");
}

export async function updateProject(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Project");
    const existing = await db.careerProject.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Project not found");
    await db.careerProject.update({
        where: { id },
        data: {
            name: reqStr(formData, "name", "Project name"),
            role: str(formData, "role"),
            description: str(formData, "description"),
            technologies: csv(formData, "technologies"),
            startedOn: date(formData, "startedOn"),
            completedOn: date(formData, "completedOn"),
            impactDescription: str(formData, "impactDescription"),
            url: str(formData, "url"),
        },
    });
    revalidatePath("/career/projects");
}

export async function deleteProject(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Project");
    const existing = await db.careerProject.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Project not found");
    await db.careerProject.delete({ where: { id } });
    revalidatePath("/career/projects");
}

// ============================================================
// Salary entries
// ============================================================

/**
 * Resolve and validate the optional company/application links for a salary entry.
 * Both must belong to the current user; an application must also belong to the chosen
 * company. Returns the legacy free-text `company` label alongside the relation ids.
 */
async function resolveSalaryLinks(userId: string, formData: FormData) {
    const companyId = str(formData, "companyId");
    let applicationId = str(formData, "applicationId");
    let company = str(formData, "company"); // legacy free-text fallback

    if (companyId) {
        const comp = await db.company.findFirst({ where: { id: companyId, userId }, select: { name: true } });
        if (!comp) throw new Error("Company not found");
        company = comp.name; // keep the free-text label in sync for display/back-compat

        if (applicationId) {
            const app = await db.jobApplication.findFirst({
                where: { id: applicationId, userId, companyId },
                select: { id: true },
            });
            if (!app) throw new Error("Application not found for this company");
        }
    } else {
        // No company selected → an application link is meaningless; drop it.
        applicationId = null;
    }

    return { companyId, applicationId, company };
}

export async function createSalaryEntry(formData: FormData) {
    const user = await requireUser();
    const base = num(formData, "baseSalary") ?? 0;
    const bonus = num(formData, "bonus") ?? 0;
    const equity = num(formData, "equity") ?? 0;
    const { companyId, applicationId, company } = await resolveSalaryLinks(user.id, formData);
    await db.careerSalaryEntry.create({
        data: {
            userId: user.id,
            date: date(formData, "date") ?? new Date(),
            company,
            companyId,
            applicationId,
            title: str(formData, "title"),
            baseSalary: base,
            bonus,
            equity,
            totalComp: base + bonus + equity,
            currency: str(formData, "currency") ?? "USD",
        },
    });
    revalidatePath("/career/salary");
    revalidatePath(HUB);
}

export async function updateSalaryEntry(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Salary entry");
    const existing = await db.careerSalaryEntry.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Salary entry not found");
    const base = num(formData, "baseSalary") ?? 0;
    const bonus = num(formData, "bonus") ?? 0;
    const equity = num(formData, "equity") ?? 0;
    const { companyId, applicationId, company } = await resolveSalaryLinks(user.id, formData);
    await db.careerSalaryEntry.update({
        where: { id },
        data: {
            date: date(formData, "date") ?? new Date(),
            company,
            companyId,
            applicationId,
            title: str(formData, "title"),
            baseSalary: base,
            bonus,
            equity,
            totalComp: base + bonus + equity,
            currency: str(formData, "currency") ?? "USD",
        },
    });
    revalidatePath("/career/salary");
    revalidatePath(HUB);
}

export async function deleteSalaryEntry(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Salary entry");
    const existing = await db.careerSalaryEntry.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Salary entry not found");
    await db.careerSalaryEntry.delete({ where: { id } });
    revalidatePath("/career/salary");
    revalidatePath(HUB);
}

// ============================================================
// Goals
// ============================================================

export async function createGoal(formData: FormData) {
    const user = await requireUser();
    await db.careerGoal.create({
        data: {
            userId: user.id,
            title: reqStr(formData, "title", "Goal title"),
            description: str(formData, "description"),
            targetDate: date(formData, "targetDate"),
            status: str(formData, "status") ?? "active",
        },
    });
    revalidatePath("/career/goals");
    revalidatePath(HUB);
}

export async function updateGoal(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Goal");
    const existing = await db.careerGoal.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Goal not found");
    await db.careerGoal.update({
        where: { id },
        data: {
            title: reqStr(formData, "title", "Goal title"),
            description: str(formData, "description"),
            targetDate: date(formData, "targetDate"),
            status: str(formData, "status") ?? "active",
        },
    });
    revalidatePath("/career/goals");
    revalidatePath(HUB);
}

export async function deleteGoal(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Goal");
    const existing = await db.careerGoal.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Goal not found");
    await db.careerGoal.delete({ where: { id } });
    revalidatePath("/career/goals");
    revalidatePath(HUB);
}

// ============================================================
// Weekly reviews
// ============================================================

export async function createWeeklyReview(formData: FormData) {
    const user = await requireUser();
    await db.careerWeeklyReview.create({
        data: {
            userId: user.id,
            weekOf: date(formData, "weekOf") ?? new Date(),
            wins: str(formData, "wins"),
            challenges: str(formData, "challenges"),
            learning: str(formData, "learning"),
        },
    });
    revalidatePath("/career/goals");
    revalidatePath(HUB);
}

export async function updateWeeklyReview(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Review");
    const existing = await db.careerWeeklyReview.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Review not found");
    await db.careerWeeklyReview.update({
        where: { id },
        data: {
            weekOf: date(formData, "weekOf") ?? new Date(),
            wins: str(formData, "wins"),
            challenges: str(formData, "challenges"),
            learning: str(formData, "learning"),
        },
    });
    revalidatePath("/career/goals");
    revalidatePath(HUB);
}

export async function deleteWeeklyReview(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Review");
    const existing = await db.careerWeeklyReview.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Review not found");
    await db.careerWeeklyReview.delete({ where: { id } });
    revalidatePath("/career/goals");
    revalidatePath(HUB);
}

// ============================================================
// Journal entries
// ============================================================

export async function createJournalEntry(formData: FormData) {
    const user = await requireUser();
    await db.careerJournalEntry.create({
        data: {
            userId: user.id,
            date: date(formData, "date") ?? new Date(),
            entry: reqStr(formData, "entry", "Entry"),
        },
    });
    revalidatePath("/career/goals");
}

export async function updateJournalEntry(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Entry");
    const existing = await db.careerJournalEntry.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Entry not found");
    await db.careerJournalEntry.update({
        where: { id },
        data: {
            date: date(formData, "date") ?? new Date(),
            entry: reqStr(formData, "entry", "Entry"),
        },
    });
    revalidatePath("/career/goals");
}

export async function deleteJournalEntry(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Entry");
    const existing = await db.careerJournalEntry.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Entry not found");
    await db.careerJournalEntry.delete({ where: { id } });
    revalidatePath("/career/goals");
}

// ============================================================
// Mentors
// ============================================================

export async function createMentor(formData: FormData) {
    const user = await requireUser();
    await db.careerMentor.create({
        data: {
            userId: user.id,
            name: reqStr(formData, "name", "Mentor name"),
            expertise: str(formData, "expertise"),
            contactInfo: str(formData, "contactInfo"),
            lastMeetingDate: date(formData, "lastMeetingDate"),
        },
    });
    revalidatePath("/career/mentors");
    revalidatePath(HUB);
}

export async function updateMentor(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Mentor");
    const existing = await db.careerMentor.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Mentor not found");
    await db.careerMentor.update({
        where: { id },
        data: {
            name: reqStr(formData, "name", "Mentor name"),
            expertise: str(formData, "expertise"),
            contactInfo: str(formData, "contactInfo"),
            lastMeetingDate: date(formData, "lastMeetingDate"),
        },
    });
    revalidatePath("/career/mentors");
    revalidatePath(HUB);
}

export async function deleteMentor(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Mentor");
    const existing = await db.careerMentor.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Mentor not found");
    await db.careerMentor.delete({ where: { id } });
    revalidatePath("/career/mentors");
    revalidatePath(HUB);
}

// ============================================================
// Performance reviews
// ============================================================

export async function createReview(formData: FormData) {
    const user = await requireUser();
    await db.careerReview.create({
        data: {
            userId: user.id,
            reviewDate: date(formData, "reviewDate") ?? new Date(),
            reviewerName: str(formData, "reviewerName"),
            rating: num(formData, "rating"),
            feedback: str(formData, "feedback"),
        },
    });
    revalidatePath("/career/mentors");
}

export async function updateReview(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Review");
    const existing = await db.careerReview.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Review not found");
    await db.careerReview.update({
        where: { id },
        data: {
            reviewDate: date(formData, "reviewDate") ?? new Date(),
            reviewerName: str(formData, "reviewerName"),
            rating: num(formData, "rating"),
            feedback: str(formData, "feedback"),
        },
    });
    revalidatePath("/career/mentors");
}

export async function deleteReview(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Review");
    const existing = await db.careerReview.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Review not found");
    await db.careerReview.delete({ where: { id } });
    revalidatePath("/career/mentors");
}

// ============================================================
// Resume + resume items
// ============================================================

import type { ResumeItemKind } from "@prisma/client";

const RESUME_KINDS: ResumeItemKind[] = [
    "EXPERIENCE",
    "PROJECT",
    "EDUCATION",
    "VOLUNTEER",
    "SKILL",
    "CERTIFICATION",
    "AWARD",
    "ORGANIZATION",
];

function parseKind(formData: FormData): ResumeItemKind {
    const v = str(formData, "kind");
    if (v && (RESUME_KINDS as string[]).includes(v)) return v as ResumeItemKind;
    throw new Error("Invalid section kind");
}

export async function createResume(formData: FormData) {
    const user = await requireUser();
    const resume = await db.resume.create({
        data: {
            userId: user.id,
            name: str(formData, "name") ?? "Resume",
            headline: str(formData, "headline"),
            summary: str(formData, "summary"),
        },
    });
    revalidatePath("/career/resume");
    return resume.id;
}

export async function updateResume(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Resume");
    const existing = await db.resume.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Resume not found");
    await db.resume.update({
        where: { id },
        data: {
            name: str(formData, "name") ?? "Resume",
            headline: str(formData, "headline"),
            summary: str(formData, "summary"),
        },
    });
    revalidatePath("/career/resume");
}

export async function deleteResume(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Resume");
    const existing = await db.resume.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Resume not found");
    await db.resume.delete({ where: { id } });
    revalidatePath("/career/resume");
}

async function ownedResume(userId: string, resumeId: string) {
    const resume = await db.resume.findFirst({ where: { id: resumeId, userId } });
    if (!resume) throw new Error("Resume not found");
    return resume;
}

export async function createResumeItem(formData: FormData) {
    const user = await requireUser();
    const resumeId = reqStr(formData, "resumeId", "Resume");
    await ownedResume(user.id, resumeId);
    const kind = parseKind(formData);
    const max = await db.resumeItem.aggregate({
        where: { resumeId, kind },
        _max: { order: true },
    });
    await db.resumeItem.create({
        data: {
            resumeId,
            kind,
            order: (max._max.order ?? -1) + 1,
            title: reqStr(formData, "title", "Title"),
            subtitle: str(formData, "subtitle"),
            location: str(formData, "location"),
            startDate: date(formData, "startDate"),
            endDate: date(formData, "endDate"),
            current: str(formData, "current") === "on" || str(formData, "current") === "true",
            description: str(formData, "description"),
            url: str(formData, "url"),
        },
    });
    revalidatePath("/career/resume");
}

export async function updateResumeItem(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Item");
    const item = await db.resumeItem.findFirst({ where: { id, resume: { userId: user.id } } });
    if (!item) throw new Error("Item not found");
    await db.resumeItem.update({
        where: { id },
        data: {
            kind: parseKind(formData),
            title: reqStr(formData, "title", "Title"),
            subtitle: str(formData, "subtitle"),
            location: str(formData, "location"),
            startDate: date(formData, "startDate"),
            endDate: date(formData, "endDate"),
            current: str(formData, "current") === "on" || str(formData, "current") === "true",
            description: str(formData, "description"),
            url: str(formData, "url"),
        },
    });
    revalidatePath("/career/resume");
}

export async function deleteResumeItem(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Item");
    const item = await db.resumeItem.findFirst({ where: { id, resume: { userId: user.id } } });
    if (!item) throw new Error("Item not found");
    await db.resumeItem.delete({ where: { id } });
    revalidatePath("/career/resume");
}

/** Move an item up/down within its (resumeId, kind) group by swapping order with its neighbour. */
export async function moveResumeItem(formData: FormData) {
    const user = await requireUser();
    const id = reqStr(formData, "id", "Item");
    const direction = str(formData, "direction"); // "up" | "down"
    const item = await db.resumeItem.findFirst({ where: { id, resume: { userId: user.id } } });
    if (!item) throw new Error("Item not found");

    const siblings = await db.resumeItem.findMany({
        where: { resumeId: item.resumeId, kind: item.kind },
        orderBy: { order: "asc" },
    });
    const idx = siblings.findIndex((s) => s.id === id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;

    const other = siblings[swapIdx];
    await db.$transaction([
        db.resumeItem.update({ where: { id: item.id }, data: { order: other.order } }),
        db.resumeItem.update({ where: { id: other.id }, data: { order: item.order } }),
    ]);
    revalidatePath("/career/resume");
}
