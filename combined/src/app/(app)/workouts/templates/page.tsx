import Link from "next/link";
import { Activity, Calendar, Clock, Plus } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { estimateTemplateMinutes, timeAgo } from "@/lib/workouts";
import { Card, EmptyState, PageHeader } from "../_components/workouts-ui";
import { GenerateTemplateButton } from "./_components/generate-template-button";

const SCHEME_LABEL: Record<string, string> = { NONE: "No progression", LINEAR: "Linear", DOUBLE: "Double progression", FIVETHREEONE: "5/3/1" };

export default async function TemplatesPage() {
    const user = await requireUser();
    const templates = await db.template.findMany({
        where: { userId: user.id, archived: false },
        orderBy: { updatedAt: "desc" },
        include: {
            _count: { select: { exercises: true } },
            exercises: { select: { targetSets: true, restSec: true, perSetMode: true, _count: { select: { sets: true } } } },
            workouts: {
                where: { deletedAt: null },
                orderBy: { date: "desc" },
                take: 1,
                select: { date: true },
            },
        },
    });

    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                title="Templates"
                description="Build reusable workout blueprints with set targets and progression so every session starts in one tap."
                actions={
                    <div className="flex items-center gap-2">
                        <GenerateTemplateButton size="md" />
                        <Button size="md" color="primary" iconLeading={<Plus data-icon className="size-4" />} href="/workouts/templates/new">
                            New template
                        </Button>
                    </div>
                }
            />

            {templates.length === 0 ? (
                <Card>
                    <EmptyState
                        iconName="template"
                        title="Create your first template"
                        description="Save your go-to routines once — pre-loaded exercises, target sets and progression — and start them with a single tap."
                        action={
                            <Button size="md" color="primary" iconLeading={<Plus data-icon className="size-4" />} href="/workouts/templates/new">
                                New template
                            </Button>
                        }
                    />
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {templates.map((t) => {
                        const minutes = estimateTemplateMinutes(
                            t.exercises.map((te) => ({ targetSets: te.targetSets, restSec: te.restSec, perSetMode: te.perSetMode, setCount: te._count.sets })),
                        );
                        const lastUsed = t.workouts[0]?.date ?? null;
                        return (
                            <Link key={t.id} href={`/workouts/templates/${t.id}`}>
                                <Card className="flex h-full flex-col transition duration-100 ease-linear hover:bg-secondary_hover">
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="text-sm font-semibold text-primary">{t.name}</p>
                                        <Badge color={t.progression === "NONE" ? "gray" : "brand"} size="sm">
                                            {SCHEME_LABEL[t.progression]}
                                        </Badge>
                                    </div>
                                    {t.note && <p className="mt-1 line-clamp-2 text-xs text-tertiary">{t.note}</p>}
                                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tertiary">
                                        <span className="inline-flex items-center gap-1">
                                            <Activity className="size-3.5" aria-hidden="true" /> {t._count.exercises} exercises
                                        </span>
                                        {minutes > 0 && (
                                            <span className="inline-flex items-center gap-1">
                                                <Clock className="size-3.5" aria-hidden="true" /> ~{minutes} min
                                            </span>
                                        )}
                                        {t.progression === "FIVETHREEONE" && t.cycleWeek ? <span>week {t.cycleWeek}</span> : null}
                                    </div>
                                    <div className="mt-2 inline-flex items-center gap-1 text-xs text-quaternary">
                                        <Calendar className="size-3.5" aria-hidden="true" />
                                        {lastUsed ? `Last used ${timeAgo(lastUsed)}` : "Never used"}
                                    </div>
                                </Card>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
