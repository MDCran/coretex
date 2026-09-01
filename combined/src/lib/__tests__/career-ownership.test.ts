import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    requireUser: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn(),
    uploadUserMediaFile: vi.fn(),
    deleteObject: vi.fn(),
    db: {
        company: { findFirst: vi.fn() },
        careerTarget: { findFirst: vi.fn() },
        interviewQuestion: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
        interviewRound: { findFirst: vi.fn() },
        jobApplication: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
        jobAttachment: { findUnique: vi.fn(), delete: vi.fn() },
        jobContact: { findFirst: vi.fn(), findMany: vi.fn() },
        jobDocumentVersion: { findFirst: vi.fn() },
        jobMeeting: { findUnique: vi.fn() },
        jobPhase: { findFirst: vi.fn() },
        networkingOutreach: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    },
}));

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/uploads", () => ({ uploadUserMediaFile: mocks.uploadUserMediaFile }));
vi.mock("@/lib/s3", () => ({ deleteObject: mocks.deleteObject }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
    createQuestion,
    createOutreach,
    updateApplicationReferral,
} from "@/lib/actions/career-advanced";
import { createApplication, deleteAttachment, updateApplicationDocuments } from "@/lib/actions/jobs";

function form(values: Record<string, string>) {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
}

describe("career relation ownership", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.requireUser.mockResolvedValue({ id: "user-1" });
        mocks.db.jobPhase.findFirst.mockResolvedValue(null);
    });

    it("rejects a foreign company before creating an application", async () => {
        mocks.db.company.findFirst.mockResolvedValue(null);

        await expect(createApplication(form({ companyId: "company-2", role: "Engineer" }))).rejects.toThrow("Company not found");

        expect(mocks.db.company.findFirst).toHaveBeenCalledWith({
            where: { id: "company-2", userId: "user-1" },
            select: { id: true },
        });
        expect(mocks.db.jobApplication.create).not.toHaveBeenCalled();
    });

    it("rejects a foreign resume version before updating application documents", async () => {
        mocks.db.jobApplication.findFirst.mockResolvedValue({ id: "application-1" });
        mocks.db.jobDocumentVersion.findFirst.mockResolvedValue(null);

        await expect(
            updateApplicationDocuments("application-1", form({ resumeVersionId: "resume-version-2" })),
        ).rejects.toThrow("Resume version not found");

        expect(mocks.db.jobDocumentVersion.findFirst).toHaveBeenCalledWith({
            where: { id: "resume-version-2", document: { userId: "user-1", kind: "RESUME" } },
            select: { id: true },
        });
        expect(mocks.db.jobApplication.update).not.toHaveBeenCalled();
    });

    it("does not delete an attachment whose owning application is foreign", async () => {
        mocks.db.jobAttachment.findUnique.mockResolvedValue({
            id: "attachment-2",
            applicationId: "application-2",
            meetingId: null,
            fileKey: "users/user-2/jobs/private.pdf",
            fileName: "private.pdf",
        });
        mocks.db.jobApplication.findFirst.mockResolvedValue(null);

        await expect(deleteAttachment(form({ id: "attachment-2" }))).rejects.toThrow("Application not found");

        expect(mocks.db.jobAttachment.delete).not.toHaveBeenCalled();
        expect(mocks.deleteObject).not.toHaveBeenCalled();
    });

    it("rejects a foreign referral contact before updating an application", async () => {
        mocks.db.jobApplication.findFirst.mockResolvedValue({ id: "application-1" });
        mocks.db.jobContact.findFirst.mockResolvedValue(null);

        await expect(
            updateApplicationReferral("application-1", form({ referredByContactId: "contact-2" })),
        ).rejects.toThrow("Contact not found");

        expect(mocks.db.jobApplication.update).not.toHaveBeenCalled();
    });

    it("rejects a question linked to another user's application", async () => {
        mocks.db.jobApplication.findFirst.mockResolvedValue(null);

        await expect(
            createQuestion(form({ question: "Tell me about yourself", applicationId: "application-2" })),
        ).rejects.toThrow("Application not found");

        expect(mocks.db.interviewQuestion.create).not.toHaveBeenCalled();
    });

    it("rejects a question whose round belongs to a different selected application", async () => {
        mocks.db.jobApplication.findFirst.mockResolvedValue({ id: "application-1" });
        mocks.db.interviewRound.findFirst.mockResolvedValue({ id: "round-1", applicationId: "application-3" });

        await expect(
            createQuestion(
                form({ question: "System design", applicationId: "application-1", roundId: "round-1" }),
            ),
        ).rejects.toThrow("Round does not belong to the selected application");

        expect(mocks.db.interviewQuestion.create).not.toHaveBeenCalled();
    });

    it("rejects a foreign outreach contact before creating an outreach record", async () => {
        mocks.db.jobContact.findFirst.mockResolvedValue(null);

        await expect(createOutreach(form({ personName: "Recruiter", contactId: "contact-2" }))).rejects.toThrow(
            "Contact not found",
        );

        expect(mocks.db.networkingOutreach.create).not.toHaveBeenCalled();
    });
});
