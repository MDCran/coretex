import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { STATUS_LABELS } from "@/lib/jobs/enums";
import { companyLogoSrc } from "@/lib/jobs/logos";
import { SalaryClient, type SalaryRow, type CompanyOption } from "./salary-client";

export const dynamic = "force-dynamic";

export default async function CareerSalaryPage() {
    const user = await requireUser();
    const [entries, companies] = await Promise.all([
        db.careerSalaryEntry.findMany({
            where: { userId: user.id },
            orderBy: { date: "desc" },
            include: {
                companyRef: { select: { name: true, logoKey: true, websiteDomain: true } },
                application: { select: { id: true, role: true, status: true } },
            },
        }),
        db.company.findMany({
            where: { userId: user.id },
            orderBy: { name: "asc" },
            select: {
                id: true,
                name: true,
                logoKey: true,
                websiteDomain: true,
                applications: {
                    orderBy: { createdAt: "desc" },
                    select: { id: true, role: true, status: true },
                },
            },
        }),
    ]);

    const rows: SalaryRow[] = entries.map((e) => ({
        id: e.id,
        date: e.date.toISOString(),
        company: e.company,
        companyId: e.companyId,
        companyName: e.companyRef?.name ?? null,
        companyLogo: e.companyRef ? companyLogoSrc(e.companyRef) : null,
        applicationId: e.applicationId,
        applicationRole: e.application?.role ?? null,
        applicationStatus: e.application ? STATUS_LABELS[e.application.status] : null,
        title: e.title,
        baseSalary: Number(e.baseSalary),
        bonus: Number(e.bonus),
        equity: Number(e.equity),
        totalComp: Number(e.totalComp),
        currency: e.currency,
    }));

    const companyOptions: CompanyOption[] = companies.map((c) => ({
        id: c.id,
        name: c.name,
        logo: companyLogoSrc(c),
        applications: c.applications.map((a) => ({
            id: a.id,
            role: a.role,
            status: STATUS_LABELS[a.status],
        })),
    }));

    return <SalaryClient entries={rows} companies={companyOptions} />;
}
