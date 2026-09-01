import Link from "next/link";
import type { FC } from "react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/claude";
import { PageHeader } from "@/components/jobs/page-header";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { ActivityHeatmap } from "@/components/jobs/activity-heatmap";
import { Activity, BarChartSquare02, Clock, Coins01 } from "@untitledui/icons";
import { fmtDate } from "@/lib/jobs/format";
import { HEARD_FROM_LABELS, STATUS_LABELS } from "@/lib/jobs/enums";
import { bySource, funnel, heatmap, timeToStage, type AnalyticsApp } from "@/lib/jobs/analytics";
import { SalaryBenchmarkPanel } from "@/components/career/analytics-ai";

export const dynamic = "force-dynamic";

interface Stat {
    label: string;
    value: string;
    /** When true, render value as a muted phrase rather than the hero number. */
    empty: boolean;
    sub: string;
    icon: FC<{ className?: string }>;
}

export default async function CareerAnalyticsPage() {
    const user = await requireUser();
    const [rawApps, recentEvents, lastApp] = await Promise.all([
        db.jobApplication.findMany({
            where: { userId: user.id },
            select: {
                status: true,
                heardFrom: true,
                createdAt: true,
                dateApplied: true,
                events: { where: { type: { in: ["created", "status"] } }, select: { toStatus: true, createdAt: true } },
            },
        }),
        db.jobApplicationEvent.findMany({
            where: { application: { userId: user.id }, type: { in: ["created", "status", "meeting"] } },
            orderBy: { createdAt: "desc" },
            take: 25,
            include: { application: { select: { id: true, role: true, company: { select: { name: true } } } } },
        }),
        db.jobApplication.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { role: true, location: true } }),
    ]);

    const apps: AnalyticsApp[] = rawApps;
    const f = funnel(apps);
    const tts = timeToStage(apps);
    const sources = bySource(apps, (s) => (s ? (HEARD_FROM_LABELS[s] ?? s) : "Other"));
    const heat = heatmap(apps, 26);

    const stat: Stat[] = [
        {
            label: "Response rate",
            value: f.total === 0 ? "No applications yet" : `${f.responseRate}%`,
            empty: f.total === 0,
            sub: `${f.responded}/${f.total} replied`,
            icon: BarChartSquare02,
        },
        {
            label: "Interview rate",
            value: f.total === 0 ? "No applications yet" : `${f.interviewRate}%`,
            empty: f.total === 0,
            sub: `${f.interviewed} reached interview`,
            icon: Activity,
        },
        {
            label: "Avg days to response",
            value: tts.toResponse != null ? `${tts.toResponse}d` : "Awaiting first reply",
            empty: tts.toResponse == null,
            sub: "Applied → first reply",
            icon: Clock,
        },
        {
            label: "Avg days to offer",
            value: tts.toOffer != null ? `${tts.toOffer}d` : "No offers yet",
            empty: tts.toOffer == null,
            sub: `${f.offered} offers`,
            icon: Coins01,
        },
    ];

    return (
        <div className="flex w-full flex-col gap-6">
            <PageHeader title="Career analytics" description="Conversion, timing, and activity across your whole search." />

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {stat.map((s) => (
                    <Card key={s.label}>
                        <CardBody className="flex items-center justify-between gap-3">
                            <div>
                                {s.empty ? (
                                    <div className="text-sm font-medium text-tertiary">{s.value}</div>
                                ) : (
                                    <div className="text-display-sm font-semibold text-primary">{s.value}</div>
                                )}
                                <div className="text-sm text-tertiary">{s.label}</div>
                                <div className="text-xs text-quaternary">{s.sub}</div>
                            </div>
                            <FeaturedIcon icon={s.icon} color="gray" theme="modern" size="md" />
                        </CardBody>
                    </Card>
                ))}
            </div>

            <Card>
                <CardHeader title="Application activity" />
                <CardBody>
                    {heat.max === 0 ? (
                        <p className="text-sm text-tertiary">No applications in the last 26 weeks.</p>
                    ) : (
                        <ActivityHeatmap cells={heat.cells} max={heat.max} />
                    )}
                </CardBody>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader title="Response rate by source" />
                    <CardBody>
                        {sources.length === 0 ? (
                            <p className="text-sm text-tertiary">No applications yet.</p>
                        ) : (
                            <div className="flex flex-col gap-3">
                                {sources.map((s) => (
                                    <div key={s.source} className="flex flex-col gap-1">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-secondary">{s.source}</span>
                                            <span className="tabular-nums text-tertiary">
                                                {s.responseRate}% · {s.responded}/{s.total}
                                                {s.responseRate === 0 && <span className="text-quaternary"> · No responses yet</span>}
                                            </span>
                                        </div>
                                        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                                            {s.responseRate > 0 && (
                                                <div
                                                    className="h-full rounded-full bg-brand-solid"
                                                    style={{ width: `max(0.5rem, ${s.responseRate}%)` }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title="Recent timeline" />
                    <CardBody>
                        {recentEvents.length === 0 ? (
                            <p className="text-sm text-tertiary">No activity yet.</p>
                        ) : (
                            <ol className="relative flex flex-col gap-3 border-l border-secondary pl-4">
                                {recentEvents.map((e) => {
                                    const label =
                                        e.type === "status" && e.fromStatus && e.toStatus
                                            ? `${STATUS_LABELS[e.fromStatus]} → ${STATUS_LABELS[e.toStatus]}`
                                            : e.message;
                                    return (
                                        <li key={e.id} className="relative">
                                            <span className="absolute -left-[1.32rem] top-1 size-2 rounded-full bg-fg-quaternary ring-2 ring-bg-primary" />
                                            <Link href={`/career/applications/${e.application.id}`} className="text-sm text-secondary hover:underline">
                                                {label}
                                            </Link>
                                            <div className="text-xs text-tertiary">
                                                {e.application.company.name} · {e.application.role} · {fmtDate(e.createdAt)}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </CardBody>
                </Card>
            </div>

            <Card>
                <CardHeader title="Salary benchmark" action={<Coins01 className="size-5 text-fg-quaternary" />} />
                <CardBody>
                    <SalaryBenchmarkPanel enabled={aiConfigured()} defaultRole={lastApp?.role ?? ""} defaultLocation={lastApp?.location ?? ""} />
                </CardBody>
            </Card>
        </div>
    );
}
