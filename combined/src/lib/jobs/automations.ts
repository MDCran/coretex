import "server-only";

import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Career automations run on page load (no worker): auto-flag silent applications
 * as ghosted past the threshold, and surface ones due for a follow-up nudge.
 * Thresholds live on JobSearchProfile.
 */

const DAY = 86_400_000;

export interface FollowUp {
    id: string;
    role: string;
    company: string;
    daysSince: number;
}

export async function runCareerAutomations(userId: string): Promise<{ ghosted: number; followUps: FollowUp[] }> {
    const profile = await db.jobSearchProfile.findUnique({ where: { userId } });
    const ghostDays = profile?.ghostAfterDays ?? 21;
    const followDays = profile?.followUpAfterDays ?? 7;
    const now = Date.now();

    let ghosted = 0;
    if (profile?.autoGhost) {
        const cutoff = new Date(now - ghostDays * DAY);
        const stale = await db.jobApplication.findMany({
            where: {
                userId,
                status: { in: [JobStatus.APPLIED, JobStatus.UNDER_REVIEW] },
                OR: [{ lastActivityAt: { lt: cutoff } }, { lastActivityAt: null, dateApplied: { lt: cutoff } }],
            },
            select: { id: true, status: true },
        });
        for (const a of stale) {
            await db.jobApplication.update({ where: { id: a.id }, data: { status: JobStatus.GHOSTED } });
            await db.jobApplicationEvent.create({
                data: {
                    applicationId: a.id,
                    type: "status",
                    message: `Auto-flagged as ghosted after ${ghostDays} days of silence`,
                    fromStatus: a.status,
                    toStatus: JobStatus.GHOSTED,
                },
            });
            ghosted++;
        }
    }

    const candidates = await db.jobApplication.findMany({
        where: { userId, status: { in: [JobStatus.APPLIED, JobStatus.UNDER_REVIEW] } },
        select: { id: true, role: true, dateApplied: true, lastActivityAt: true, company: { select: { name: true } } },
    });
    const followUps: FollowUp[] = candidates
        .map((a) => {
            const last = a.lastActivityAt ?? a.dateApplied;
            if (!last) return null;
            const daysSince = Math.floor((now - last.getTime()) / DAY);
            return daysSince >= followDays ? { id: a.id, role: a.role, company: a.company?.name ?? "—", daysSince } : null;
        })
        .filter((x): x is FollowUp => x != null)
        .sort((x, y) => y.daysSince - x.daysSince)
        .slice(0, 20);

    return { ghosted, followUps };
}
