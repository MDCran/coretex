import type { JobStatus } from "@prisma/client";

/**
 * Application "health" — a composite 0-100 signal from stage progress + how
 * recently anything happened. Pure (no AI, no DB) so it's cheap to call per row.
 */

const STAGE_WEIGHT: Partial<Record<JobStatus, number>> = {
    NOT_STARTED: 0.1,
    APPLIED: 0.35,
    UNDER_REVIEW: 0.55,
    ASSESSMENT: 0.65,
    INTERVIEWING: 0.85,
    OFFERED: 0.97,
};

const DAY = 86_400_000;

export interface HealthResult {
    score: number;
    label: string;
    color: "success" | "warning" | "error" | "gray" | "brand";
}

export function applicationHealth(app: {
    status: JobStatus;
    lastActivityAt?: Date | null;
    createdAt: Date;
    dateApplied?: Date | null;
}): HealthResult {
    if (app.status === "OFFER_ACCEPTED") return { score: 100, label: "Won", color: "success" };
    if (app.status === "OFFER_DECLINED" || app.status === "REJECTED" || app.status === "WITHDRAWN" || app.status === "GHOSTED") {
        return { score: 0, label: "Closed", color: "gray" };
    }

    const stage = STAGE_WEIGHT[app.status] ?? 0.2;
    const last = (app.lastActivityAt ?? app.dateApplied ?? app.createdAt).getTime();
    const days = (Date.now() - last) / DAY;
    const recency = days < 7 ? 1 : days < 14 ? 0.7 : days < 21 ? 0.45 : days < 35 ? 0.2 : 0.05;

    const score = Math.round(60 * stage + 40 * recency);
    const label = score >= 70 ? "Healthy" : score >= 40 ? "Cooling off" : "At risk";
    const color = score >= 70 ? "success" : score >= 40 ? "warning" : "error";
    return { score, label, color };
}
