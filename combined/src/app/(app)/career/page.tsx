import Link from "next/link";
import { Award04, Briefcase01, Building07, CalendarDate, ClockFastForward, File02, Flag01, Plus, Star01, Users01 } from "@untitledui/icons";
import type { JobStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/jobs/format";
import { STATUS_LABELS, STATUS_ORDER, STATUS_HEX, ACTIVE_STATUSES } from "@/lib/jobs/enums";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { Badge } from "@/components/base/badges/badges";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { StatusBadge } from "@/components/jobs/status-badge";
import { StatusBarChart, TrendChart, StatusFlowSankey } from "@/components/jobs/charts";
import { buildStatusFlow } from "@/lib/jobs/sankey";
import { CompanyLogo } from "@/components/jobs/company-logo";
import { companyLogoSrc } from "@/lib/jobs/logos";
import { CompChart, StatusJourneyChart, type JourneySeries } from "@/components/career/charts";
import { ModuleHero } from "@/components/app-shell/module-hero";

/** Y level for the journey chart = position in the canonical pipeline order. */
const STATUS_LEVEL: Record<JobStatus, number> = Object.fromEntries(STATUS_ORDER.map((s, i) => [s, i])) as Record<JobStatus, number>;

export const dynamic = "force-dynamic";

export default async function CareerDashboardPage() {
    const user = await requireUser();
    const now = new Date();

    // Active pipeline = unassigned or in a non-archived phase.
    const active: Prisma.JobApplicationWhereInput = {
        userId: user.id,
        OR: [{ phaseId: null }, { phase: { archived: false } }],
    };

    const [
        appCount,
        companyCount,
        contactCount,
        documentCount,
        byStatus,
        upcomingDeadlines,
        upcomingMeetings,
        recent,
        appDates,
        flowApps,
        journeyApps,
        salaryEntries,
        skills,
        activeGoalCount,
    ] = await Promise.all([
        db.jobApplication.count({ where: active }),
        db.company.count({ where: { userId: user.id } }),
        db.jobContact.count({ where: { userId: user.id } }),
        db.jobDocument.count({ where: { userId: user.id } }),
        db.jobApplication.groupBy({ by: ["status"], where: active, _count: { _all: true } }),
        db.jobApplication.findMany({
            where: { ...active, deadline: { gte: now } },
            orderBy: { deadline: "asc" },
            take: 5,
            include: { company: { select: { name: true } } },
        }),
        db.jobMeeting.findMany({
            where: { dateTime: { gte: now }, application: active },
            orderBy: { dateTime: "asc" },
            take: 5,
            include: { application: { include: { company: true } } },
        }),
        db.jobApplication.findMany({
            where: active,
            orderBy: { createdAt: "desc" },
            take: 5,
            include: {
                company: { select: { name: true, logoKey: true, websiteDomain: true } },
                phase: { select: { name: true, archived: true } },
            },
        }),
        db.jobApplication.findMany({ where: active, select: { dateApplied: true, createdAt: true } }),
        db.jobApplication.findMany({
            where: { userId: user.id },
            select: { status: true, heardFrom: true, events: { where: { type: "status" }, select: { fromStatus: true, toStatus: true } } },
        }),
        db.jobApplication.findMany({
            where: { userId: user.id },
            select: {
                id: true,
                role: true,
                status: true,
                createdAt: true,
                company: { select: { name: true } },
                events: {
                    where: { type: { in: ["created", "status"] }, toStatus: { not: null } },
                    orderBy: { createdAt: "asc" },
                    select: { toStatus: true, createdAt: true },
                },
            },
        }),
        db.careerSalaryEntry.findMany({ where: { userId: user.id }, orderBy: { date: "asc" }, take: 100 }),
        db.careerSkill.findMany({
            where: { userId: user.id },
            orderBy: [{ proficiency: "desc" }, { name: "asc" }],
            select: { id: true, name: true, category: true, proficiency: true, targetProficiency: true },
        }),
        db.careerGoal.count({ where: { userId: user.id, OR: [{ status: "active" }, { status: null }] } }),
    ]);

    const skillCount = skills.length;
    const skillsBelowTarget = skills.filter((s) => s.targetProficiency != null && (s.proficiency ?? 0) < s.targetProficiency).length;
    const topSkills = skills.slice(0, 5);

    const statusCount = (s: JobStatus) => byStatus.find((g) => g.status === s)?._count._all ?? 0;
    const activeCount = ACTIVE_STATUSES.reduce((sum, s) => sum + statusCount(s), 0);

    const statusData = STATUS_ORDER.map((s) => ({ key: s, status: STATUS_LABELS[s], count: statusCount(s), fill: STATUS_HEX[s] }));
    const trendPoints = appDates.map((a) => (a.dateApplied ?? a.createdAt).getTime());
    const flowData = buildStatusFlow(flowApps.map((a) => ({ status: a.status, events: a.events, isAi: a.heardFrom === "AIApply" })));

    // One journey series per application: a point per status change (or just its
    // current status when it has no recorded transitions yet).
    const journeySeries: JourneySeries[] = journeyApps
        .map((a): JourneySeries => {
            const company = a.company?.name ?? "—";
            const raw = a.events
                .filter((e): e is { toStatus: JobStatus; createdAt: Date } => e.toStatus != null)
                .map((e) => ({ status: e.toStatus, t: e.createdAt.getTime() }));
            const source = raw.length > 0 ? raw : [{ status: a.status, t: a.createdAt.getTime() }];
            return {
                id: a.id,
                role: a.role,
                company,
                points: source.map((p) => ({
                    t: p.t,
                    level: STATUS_LEVEL[p.status],
                    status: p.status,
                    statusLabel: STATUS_LABELS[p.status],
                    role: a.role,
                    company,
                    color: STATUS_HEX[p.status],
                })),
            };
        })
        .filter((s) => s.points.length > 0);

    const compData = salaryEntries.map((e) => ({
        label: new Date(e.date).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        base: Number(e.baseSalary),
        bonus: Number(e.bonus),
        equity: Number(e.equity),
    }));

    const stats = [
        { label: "Applications", value: appCount, icon: Briefcase01, href: "/career/applications" },
        { label: "Companies", value: companyCount, icon: Building07, href: "/career/companies" },
        { label: "Documents", value: documentCount, icon: File02, href: "/career/documents" },
        { label: "Contacts", value: contactCount, icon: Users01, href: "/career/contacts" },
    ];

    return (
        <div className="flex flex-col gap-6">
            <ModuleHero
                theme="blue"
                icon={Briefcase01}
                eyebrow="Land your next role"
                title="Grow your career"
                description={`${activeCount} active application${activeCount === 1 ? "" : "s"} in your pipeline — keep the momentum going.`}
                actions={[
                    { label: "New application", href: "/career/applications/new", icon: Plus },
                    { label: "View pipeline", href: "/career/applications", color: "secondary" },
                ]}
            />

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {stats.map((s) => (
                    <Link key={s.label} href={s.href}>
                        <Card className="transition hover:bg-secondary_hover">
                            <CardBody className="flex items-center justify-between">
                                <div>
                                    <div className="text-display-sm font-semibold text-primary">{s.value}</div>
                                    <div className="text-sm text-tertiary">{s.label}</div>
                                </div>
                                <FeaturedIcon icon={s.icon} color="brand" theme="light" size="lg" />
                            </CardBody>
                        </Card>
                    </Link>
                ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader title="Pipeline by status" />
                    <CardBody>
                        <StatusBarChart data={statusData} />
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader title="Applications over time" />
                    <CardBody>
                        <TrendChart points={trendPoints} />
                    </CardBody>
                </Card>
            </div>

            <Card>
                <CardHeader title="Status flow" />
                <CardBody>
                    <StatusFlowSankey data={flowData} />
                </CardBody>
            </Card>

            <Card>
                <CardHeader title="Status journey over time" action={<span className="text-xs text-quaternary max-sm:hidden">Hover a dot for the application</span>} />
                <CardBody>
                    <StatusJourneyChart series={journeySeries} />
                </CardBody>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader title="Upcoming deadlines" action={<ClockFastForward className="size-5 text-fg-quaternary" />} />
                    <CardBody>
                        {upcomingDeadlines.length === 0 ? (
                            <p className="text-sm text-tertiary">No upcoming deadlines.</p>
                        ) : (
                            <ul className="flex flex-col divide-y divide-secondary">
                                {upcomingDeadlines.map((a) => (
                                    <li key={a.id}>
                                        <Link href={`/career/applications/${a.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium text-primary">{a.role}</div>
                                                <div className="truncate text-xs text-tertiary">{a.company.name}</div>
                                            </div>
                                            <span className="shrink-0 text-sm text-tertiary">{fmtDate(a.deadline)}</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title="Upcoming meetings" action={<CalendarDate className="size-5 text-fg-quaternary" />} />
                    <CardBody>
                        {upcomingMeetings.length === 0 ? (
                            <p className="text-sm text-tertiary">No upcoming meetings.</p>
                        ) : (
                            <ul className="flex flex-col divide-y divide-secondary">
                                {upcomingMeetings.map((m) => (
                                    <li key={m.id}>
                                        <Link href={`/career/applications/${m.applicationId}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium text-primary">{m.type ?? "Meeting"}</div>
                                                <div className="truncate text-xs text-tertiary">
                                                    {m.application.company.name} · {m.application.role}
                                                </div>
                                            </div>
                                            <span className="shrink-0 text-sm text-tertiary">{fmtDateTime(m.dateTime)}</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardBody>
                </Card>
            </div>

            <Card>
                <CardHeader title="Recently added" />
                <CardBody>
                    {recent.length === 0 ? (
                        <p className="text-sm text-tertiary">Nothing yet.</p>
                    ) : (
                        <ul className="flex flex-col divide-y divide-secondary">
                            {recent.map((a) => (
                                <li key={a.id}>
                                    <Link href={`/career/applications/${a.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                                        <div className="flex min-w-0 items-center gap-3">
                                            <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary p-1 ring-1 ring-secondary">
                                                <CompanyLogo src={companyLogoSrc(a.company, { fallbackUrl: a.applicationUrl })} alt={a.company.name} name={a.company.name} className="size-full object-contain" iconClassName="text-xs" />
                                            </span>
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium text-primary">{a.role}</div>
                                                <div className="truncate text-xs text-tertiary">
                                                    {a.company.name}
                                                    {a.dateApplied ? ` · applied ${fmtDate(a.dateApplied)}` : ` · added ${fmtDate(a.createdAt)}`}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            {a.phase && (
                                                <Badge color={a.phase.archived ? "gray" : "brand"} size="sm" type="color" className="max-sm:hidden">
                                                    {a.phase.name}
                                                </Badge>
                                            )}
                                            <StatusBadge status={a.status} />
                                        </div>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>

            <div className="flex items-center gap-3 pt-2">
                <FeaturedIcon icon={Award04} color="brand" theme="light" size="md" />
                <div>
                    <h2 className="text-lg font-semibold text-primary">Career development</h2>
                    <p className="text-sm text-tertiary">Track compensation, sharpen skills, and work toward your goals.</p>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader title="Compensation trend" action={<Link href="/career/salary" className="text-sm text-brand-secondary hover:underline">View all</Link>} />
                    <CardBody>
                        <CompChart data={compData} />
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader
                        title="Skills"
                        action={
                            <Link href="/career/skills" className="text-sm text-brand-secondary hover:underline">
                                Manage
                            </Link>
                        }
                    />
                    <CardBody className="flex flex-col gap-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg bg-secondary_subtle p-3">
                                <p className="text-display-xs font-semibold text-primary">{skillCount}</p>
                                <p className="text-xs text-tertiary">Tracked</p>
                            </div>
                            <div className="rounded-lg bg-secondary_subtle p-3">
                                <p className="text-display-xs font-semibold text-primary">{skillsBelowTarget}</p>
                                <p className="text-xs text-tertiary">Below target</p>
                            </div>
                        </div>
                        {topSkills.length === 0 ? (
                            <div className="flex flex-col items-start gap-2">
                                <p className="text-sm text-tertiary">No skills tracked yet.</p>
                                <Link href="/career/skills" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-secondary hover:underline">
                                    <Plus aria-hidden="true" className="size-4" />
                                    Add a skill
                                </Link>
                            </div>
                        ) : (
                            <ul className="flex flex-col gap-2.5">
                                {topSkills.map((s) => (
                                    <li key={s.id} className="flex items-center justify-between gap-3">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <Star01 aria-hidden="true" className="size-3.5 shrink-0 text-fg-quaternary" />
                                            <span className="truncate text-sm text-secondary">{s.name}</span>
                                        </div>
                                        <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
                                            {[1, 2, 3, 4, 5].map((n) => (
                                                <span key={n} className={(s.proficiency ?? 0) >= n ? "size-1.5 rounded-full bg-brand-solid" : "size-1.5 rounded-full bg-quaternary"} />
                                            ))}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <Link
                            href="/career/goals"
                            className="flex items-center justify-between gap-2 rounded-lg bg-secondary_subtle px-3 py-2.5 transition hover:bg-secondary_hover"
                        >
                            <span className="flex items-center gap-2">
                                <Flag01 aria-hidden="true" className="size-4 text-fg-quaternary" />
                                <span className="text-sm font-medium text-secondary">Active goals</span>
                            </span>
                            <span className="text-sm font-semibold text-primary">{activeGoalCount}</span>
                        </Link>
                    </CardBody>
                </Card>
            </div>
        </div>
    );
}
