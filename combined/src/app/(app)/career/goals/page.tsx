import Link from "next/link";
import { AlertTriangle, Target04 } from "@untitledui/icons";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { runCareerAutomations } from "@/lib/jobs/automations";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { Badge } from "@/components/base/badges/badges";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { DeleteButton } from "@/components/jobs/delete-button";
import { Markdown } from "@/components/jobs/markdown";
import { TargetDialog } from "@/components/career/target-dialog";
import { createTarget, deleteTarget, updateTarget } from "@/lib/actions/career-advanced";
import { GoalsClient, type GoalRow } from "@/components/career/goals-client";

export const dynamic = "force-dynamic";

function money(n: number | null) {
    if (n == null) return null;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export default async function CareerGoalsPage() {
    const user = await requireUser();

    // Run ghosting auto-flag + collect follow-up nudges on load.
    const automations = await runCareerAutomations(user.id);

    const [goals, targets] = await Promise.all([
        db.careerGoal.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
        db.careerTarget.findMany({
            where: { userId: user.id },
            orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
            include: { _count: { select: { applications: true } } },
        }),
    ]);

    const rows: GoalRow[] = goals.map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        targetDate: g.targetDate ? g.targetDate.toISOString() : null,
        status: g.status,
    }));

    return (
        <div className="flex w-full flex-col gap-6">
            {automations.followUps.length > 0 && (
                <Card>
                    <CardHeader
                        title="Needs follow-up"
                        action={
                            <span className="inline-flex items-center gap-1.5 text-xs text-warning-primary">
                                <AlertTriangle className="size-4" /> {automations.followUps.length} silent
                            </span>
                        }
                    />
                    <CardBody>
                        <ul className="flex flex-col divide-y divide-secondary">
                            {automations.followUps.map((f) => (
                                <li key={f.id}>
                                    <Link href={`/career/applications/${f.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-medium text-primary">{f.role}</div>
                                            <div className="truncate text-xs text-tertiary">{f.company}</div>
                                        </div>
                                        <Badge color={f.daysSince >= 14 ? "error" : "warning"} size="sm" type="pill-color">
                                            {f.daysSince}d silent
                                        </Badge>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </CardBody>
                </Card>
            )}

            <Card>
                <CardHeader title={`Career goals board (${targets.length})`} action={<TargetDialog action={createTarget} />} />
                <CardBody>
                    {targets.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-10 text-center">
                            <FeaturedIcon icon={Target04} color="brand" theme="light" size="lg" />
                            <p className="text-sm font-semibold text-primary">Define what you're aiming for</p>
                            <p className="max-w-sm text-sm text-tertiary">
                                Set your target roles, company types, and salary, then align every application so you can see how close each one gets you.
                            </p>
                            <div className="mt-1">
                                <TargetDialog action={createTarget} />
                            </div>
                        </div>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {targets.map((t) => (
                                <div key={t.id} className="flex flex-col gap-2 rounded-xl bg-secondary p-4 transition duration-100 ease-linear hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-primary">{t.title}</span>
                                            {t.isPrimary && (
                                                <Badge color="brand" size="sm" type="pill-color">
                                                    Primary
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1">
                                            <TargetDialog
                                                mode="edit"
                                                action={updateTarget.bind(null, t.id)}
                                                defaults={{
                                                    title: t.title,
                                                    targetRole: t.targetRole,
                                                    targetCompanyType: t.targetCompanyType,
                                                    targetSalary: t.targetSalary,
                                                    targetLocation: t.targetLocation,
                                                    notesMarkdown: t.notesMarkdown,
                                                    isPrimary: t.isPrimary,
                                                }}
                                            />
                                            <DeleteButton action={deleteTarget} id={t.id} iconOnly title="Delete target?" description="Applications stay, but lose this alignment." />
                                        </div>
                                    </div>
                                    <dl className="flex flex-col gap-1 text-sm">
                                        {t.targetRole && <div className="text-secondary">{t.targetRole}</div>}
                                        {t.targetCompanyType && <div className="text-tertiary">{t.targetCompanyType}</div>}
                                        {t.targetLocation && <div className="text-tertiary">📍 {t.targetLocation}</div>}
                                        {money(t.targetSalary) && <div className="text-tertiary tabular-nums">🎯 {money(t.targetSalary)}</div>}
                                    </dl>
                                    {t.notesMarkdown?.trim() && (
                                        <div className="text-xs text-tertiary">
                                            <Markdown>{t.notesMarkdown}</Markdown>
                                        </div>
                                    )}
                                    <Link href={`/career/applications`} className="mt-auto text-xs text-brand-secondary hover:underline">
                                        {t._count.applications} aligned application{t._count.applications === 1 ? "" : "s"}
                                    </Link>
                                </div>
                            ))}
                        </div>
                    )}
                </CardBody>
            </Card>

            <GoalsClient goals={rows} />
        </div>
    );
}
