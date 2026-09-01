"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { aiConfigured, runClaude, runClaudeWithWebSearch } from "@/lib/ai/claude";
import { getObjectStream } from "@/lib/s3";

/**
 * Career AI: ATS keyword match, tailored cover-letter drafting, and a skills-gap
 * analysis across saved job descriptions. All go through the central Claude client
 * (logged to AiCall) and reuse the application's archived JD + linked resume.
 */

type ContentPart =
    | { type: "text"; text: string }
    | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

/** Load a linked resume version as a Claude PDF document part (PDF only). */
async function resumeDocPart(fileKey: string, mimeType: string): Promise<ContentPart | null> {
    if (mimeType !== "application/pdf") return null;
    const obj = await getObjectStream(fileKey);
    const bytes = await obj.Body!.transformToByteArray();
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } };
}

export interface AtsResult {
    score: number;
    summary: string;
    missingKeywords: string[];
    presentKeywords: string[];
    suggestions: string[];
}

const ATS_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        score: { type: "number", description: "0-100 match between the resume and the job description (keyword + relevance)." },
        summary: { type: "string", description: "One or two sentences on overall fit." },
        missingKeywords: { type: "array", items: { type: "string" }, description: "Important JD keywords/skills NOT found in the resume." },
        presentKeywords: { type: "array", items: { type: "string" }, description: "Important JD keywords/skills that ARE present in the resume." },
        suggestions: { type: "array", items: { type: "string" }, description: "Concrete edits to raise the match score." },
    },
    required: ["score", "summary", "missingKeywords", "presentKeywords", "suggestions"],
};

export async function analyzeAts(applicationId: string): Promise<AtsResult> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const app = await db.jobApplication.findFirst({
        where: { id: applicationId, userId: user.id },
        include: { resumeVersion: true },
    });
    if (!app) throw new Error("Application not found");
    if (!app.jdText?.trim()) throw new Error("Archive the job description first (paste it into the JD box).");
    if (!app.resumeVersion) throw new Error("Link a resume version to this application first (on the edit screen).");

    const doc = await resumeDocPart(app.resumeVersion.fileKey, app.resumeVersion.mimeType);
    if (!doc) throw new Error("ATS analysis needs a PDF resume — upload your resume as a PDF version.");

    const settings = await db.settings.findUnique({ where: { userId: user.id } });

    const { data } = await runClaude<AtsResult>({
        purpose: "career-ats",
        userId: user.id,
        model: settings?.aiModel ?? undefined,
        schema: ATS_SCHEMA,
        content: [
            doc,
            {
                type: "text",
                text: `You are an ATS (applicant tracking system) screening engine. Compare the attached resume against this job description and score how well it matches. Identify the most important required skills/keywords that are missing from the resume, those present, and concrete suggestions.\n\nJOB DESCRIPTION:\n${app.jdText.slice(0, 12000)}`,
            },
        ],
    });

    const result: AtsResult = {
        score: Math.max(0, Math.min(100, Math.round(data.score ?? 0))),
        summary: data.summary ?? "",
        missingKeywords: Array.isArray(data.missingKeywords) ? data.missingKeywords.slice(0, 40) : [],
        presentKeywords: Array.isArray(data.presentKeywords) ? data.presentKeywords.slice(0, 40) : [],
        suggestions: Array.isArray(data.suggestions) ? data.suggestions.slice(0, 20) : [],
    };

    await db.jobApplication.update({ where: { id: applicationId }, data: { atsScore: result.score, atsMissingKeywords: result.missingKeywords } });
    revalidatePath(`/career/applications/${applicationId}`);
    return result;
}

export async function generateCoverLetter(applicationId: string): Promise<string> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const app = await db.jobApplication.findFirst({
        where: { id: applicationId, userId: user.id },
        include: { resumeVersion: true, company: true },
    });
    if (!app) throw new Error("Application not found");
    if (!app.jdText?.trim()) throw new Error("Archive the job description first (paste it into the JD box).");

    const settings = await db.settings.findUnique({ where: { userId: user.id } });
    const content: ContentPart[] = [];
    if (app.resumeVersion) {
        const doc = await resumeDocPart(app.resumeVersion.fileKey, app.resumeVersion.mimeType);
        if (doc) content.push(doc);
    }
    content.push({
        type: "text",
        text: `Write a tailored, professional cover letter for the role of "${app.role}" at ${app.company.name}. ${
            content.length > 0 ? "Use the attached resume to ground specific, truthful achievements." : "Base it on the job description only."
        } Keep it to 3–4 short paragraphs, confident but not boastful, no clichés, and end with a clear call to action. Return ONLY the letter body (no placeholders like [Your Name] beyond a sign-off line).\n\nJOB DESCRIPTION:\n${app.jdText.slice(0, 12000)}`,
    });

    const { data } = await runClaude<string>({
        purpose: "career-cover-letter",
        userId: user.id,
        model: settings?.aiModel ?? undefined,
        content,
    });
    return data;
}

export interface SkillsGapResult {
    strong: string[];
    missing: { skill: string; importance: string; note: string }[];
    recommendations: string[];
    jdsAnalyzed: number;
}

const SKILLS_GAP_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        strong: { type: "array", items: { type: "string" }, description: "Skills the candidate already has that match demand well." },
        missing: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    skill: { type: "string" },
                    importance: { type: "string", enum: ["high", "medium", "low"] },
                    note: { type: "string", description: "Why it matters / where it appeared." },
                },
                required: ["skill", "importance", "note"],
            },
        },
        recommendations: { type: "array", items: { type: "string" }, description: "Concrete next steps to close the gaps." },
    },
    required: ["strong", "missing", "recommendations"],
};

export async function analyzeSkillsGap(): Promise<SkillsGapResult> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const [skills, apps, settings] = await Promise.all([
        db.careerSkill.findMany({ where: { userId: user.id }, select: { name: true, category: true, proficiency: true } }),
        db.jobApplication.findMany({ where: { userId: user.id, jdText: { not: null } }, select: { role: true, jdText: true }, take: 40 }),
        db.settings.findUnique({ where: { userId: user.id } }),
    ]);
    if (apps.length === 0) throw new Error("Archive a few job descriptions first (paste JDs into your applications).");

    const skillList = skills.length
        ? skills.map((s) => `${s.name}${s.proficiency != null ? ` (${s.proficiency}/10)` : ""}`).join(", ")
        : "(none recorded yet)";
    const jdBlob = apps
        .map((a, i) => `--- JD ${i + 1}: ${a.role} ---\n${(a.jdText ?? "").slice(0, 3000)}`)
        .join("\n\n")
        .slice(0, 40000);

    const { data } = await runClaude<Omit<SkillsGapResult, "jdsAnalyzed">>({
        purpose: "career-skills-gap",
        userId: user.id,
        model: settings?.aiModel ?? undefined,
        schema: SKILLS_GAP_SCHEMA,
        system: "You are a career coach. Compare a candidate's skills against the skills demanded across the job descriptions they're targeting. Be specific and practical.",
        content: `Candidate's current skills: ${skillList}\n\nTarget job descriptions:\n${jdBlob}\n\nIdentify which in-demand skills they're missing or weak in (ranked by importance), which they already have, and concrete recommendations to close the gaps.`,
    });

    return {
        strong: Array.isArray(data.strong) ? data.strong : [],
        missing: Array.isArray(data.missing) ? data.missing : [],
        recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
        jdsAnalyzed: apps.length,
    };
}

export interface SalaryBenchmark {
    role: string;
    location: string;
    low: number | null;
    median: number | null;
    high: number | null;
    currency: string;
    notes: string;
}

const BENCHMARK_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        low: { type: "number", description: "10th–25th percentile annual base salary." },
        median: { type: "number", description: "Median annual base salary." },
        high: { type: "number", description: "75th–90th percentile annual base salary." },
        currency: { type: "string", description: "ISO currency code, e.g. USD." },
        notes: { type: "string", description: "One or two sentences citing the sources/ranges found." },
    },
    required: ["low", "median", "high", "currency", "notes"],
};

/** Live market salary benchmark for a role + location via web search. */
export async function benchmarkSalary(role: string, location: string): Promise<SalaryBenchmark> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");
    if (!role.trim()) throw new Error("Enter a role to benchmark.");

    const settings = await db.settings.findUnique({ where: { userId: user.id } });
    const { data } = await runClaudeWithWebSearch<Omit<SalaryBenchmark, "role" | "location">>({
        purpose: "career-salary-benchmark",
        userId: user.id,
        model: settings?.aiModel ?? undefined,
        maxSearches: 5,
        system: "You are a compensation analyst. Use live web search (Levels.fyi, Glassdoor, Payscale, BLS, recent postings) to find current market annual BASE salary ranges. Return ONLY a JSON object matching the schema.",
        content: `Find the current market base-salary range for "${role}"${location.trim() ? ` in ${location}` : " (US national)"}. Report low, median, and high annual base in local currency, and cite what you found.`,
    });

    return {
        role,
        location: location.trim() || "US",
        low: typeof data.low === "number" ? Math.round(data.low) : null,
        median: typeof data.median === "number" ? Math.round(data.median) : null,
        high: typeof data.high === "number" ? Math.round(data.high) : null,
        currency: data.currency || "USD",
        notes: data.notes ?? "",
    };
}
