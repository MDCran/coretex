"use server";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ACTIVE_STATUSES, PRIORITY_LABELS, STATUS_LABELS, STATUS_ORDER, WORK_TYPE_LABELS } from "@/lib/jobs/enums";
import { applicationHealth } from "@/lib/jobs/health";
import { fmtDate, fmtSalary } from "@/lib/jobs/format";
import type { CareerPdfData } from "@/lib/jobs/pdf";

/**
 * Build the full, display-ready career export payload (every application + every
 * company for the user — ignores any list filters). Consumed by the client-side
 * PDF builder in `lib/jobs/pdf.ts`.
 */
export async function getCareerPdfData(): Promise<CareerPdfData> {
    const user = await requireUser();

    const [applications, companies] = await Promise.all([
        db.jobApplication.findMany({
            where: { userId: user.id },
            include: { company: { select: { name: true } } },
        }),
        db.company.findMany({
            where: { userId: user.id },
            orderBy: { name: "asc" },
            include: { _count: { select: { applications: true, contacts: true } } },
        }),
    ]);

    // Active applications per company, for the companies table.
    const activeByCompany = new Map<string, number>();
    for (const a of applications) {
        if (ACTIVE_STATUSES.includes(a.status)) {
            activeByCompany.set(a.companyId, (activeByCompany.get(a.companyId) ?? 0) + 1);
        }
    }

    // Pipeline order first, then company, then role.
    const sortedApps = [...applications].sort(
        (a, b) =>
            STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
            a.company.name.localeCompare(b.company.name) ||
            a.role.localeCompare(b.role),
    );

    const statusCounts = STATUS_ORDER.map((s) => ({
        label: STATUS_LABELS[s],
        count: applications.filter((a) => a.status === s).length,
    })).filter((s) => s.count > 0);

    return {
        generatedOn: new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
        counts: {
            applications: applications.length,
            companies: companies.length,
            active: applications.filter((a) => ACTIVE_STATUSES.includes(a.status)).length,
            offers: applications.filter((a) => a.status === "OFFERED" || a.status === "OFFER_ACCEPTED").length,
            rejected: applications.filter((a) => a.status === "REJECTED").length,
        },
        statusCounts,
        applications: sortedApps.map((a) => {
            const h = applicationHealth(a);
            return {
                company: a.company.name,
                role: a.role,
                status: STATUS_LABELS[a.status],
                workType: WORK_TYPE_LABELS[a.workType],
                location: a.location ?? (a.workType === "REMOTE" ? "Remote" : "—"),
                dateApplied: fmtDate(a.dateApplied),
                deadline: fmtDate(a.deadline),
                salary: fmtSalary(a.salaryMin, a.salaryMax, a.salaryCurrency),
                priority: PRIORITY_LABELS[a.priority] ?? "—",
                health: `${h.label} (${h.score})`,
            };
        }),
        companies: companies.map((c) => ({
            name: c.name,
            industry: c.industry ?? "—",
            hqLocation: c.hqLocation ?? "—",
            website: c.websiteDomain ?? "—",
            applications: c._count.applications,
            active: activeByCompany.get(c.id) ?? 0,
            contacts: c._count.contacts,
        })),
    };
}
