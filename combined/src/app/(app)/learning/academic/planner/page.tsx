import Link from "next/link";
import { ArrowLeft } from "@untitledui/icons";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Card, SectionHeader } from "../../_components/learning-ui";
import { formatDate, formatMonthYear } from "@/lib/dates";

interface PlannerItem {
    key: string;
    classId: string;
    className: string;
    color: string | null;
    title: string;
    type: "Homework" | "Test";
    date: Date;
    done: boolean;
}

export default async function PlannerPage() {
    const user = await requireUser();
    const classes = await db.learningClass.findMany({
        where: { userId: user.id, status: { not: "DROPPED" } },
        include: {
            assignments: { where: { dueDate: { not: null } } },
            tests: { where: { date: { not: null } } },
        },
    });

    const items: PlannerItem[] = [];
    for (const c of classes) {
        for (const a of c.assignments) {
            if (!a.dueDate) continue;
            items.push({
                key: `a-${a.id}`,
                classId: c.id,
                className: c.name,
                color: c.color,
                title: a.title,
                type: "Homework",
                date: a.dueDate,
                done: a.status === "GRADED" || a.status === "SUBMITTED",
            });
        }
        for (const t of c.tests) {
            if (!t.date) continue;
            items.push({
                key: `t-${t.id}`,
                classId: c.id,
                className: c.name,
                color: c.color,
                title: t.title,
                type: "Test",
                date: t.date,
                done: t.score != null,
            });
        }
    }

    items.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Group chronologically by month.
    const groups: { label: string; items: PlannerItem[] }[] = [];
    for (const it of items) {
        const label = formatMonthYear(it.date);
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.items.push(it);
        else groups.push({ label, items: [it] });
    }

    const now = Date.now();

    return (
        <div className="flex flex-col gap-6">
            <Button size="sm" color="link-gray" iconLeading={<ArrowLeft className="size-4" data-icon />} href="/learning/academic">
                Back to academic
            </Button>

            <SectionHeader title="Semester planner" description="Every assignment due-date and test across your classes, in order." />

            {groups.length === 0 ? (
                <Card>
                    <p className="py-6 text-center text-sm text-tertiary">No dated assignments or tests yet. Add due dates to build your timeline.</p>
                </Card>
            ) : (
                <div className="flex flex-col gap-6">
                    {groups.map((g) => (
                        <div key={g.label} className="flex flex-col gap-3">
                            <h3 className="text-sm font-semibold tracking-wide text-tertiary uppercase">{g.label}</h3>
                            <div className="relative flex flex-col gap-3 border-l border-secondary pl-5">
                                {g.items.map((it) => {
                                    const overdue = !it.done && it.date.getTime() < now;
                                    return (
                                        <Link
                                            key={it.key}
                                            href={`/learning/academic/${it.classId}`}
                                            className="relative rounded-lg p-3 ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover"
                                        >
                                            <span
                                                aria-hidden="true"
                                                className={"absolute top-4 -left-[1.4rem] size-3 rounded-full ring-4 ring-primary " + (it.color ? "" : "bg-brand-solid")}
                                                style={it.color ? { backgroundColor: it.color } : undefined}
                                            />
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <Badge color={it.type === "Test" ? "indigo" : "blue"} size="sm">{it.type}</Badge>
                                                        <p className={"text-sm font-medium " + (it.done ? "text-tertiary line-through" : "text-primary")}>{it.title}</p>
                                                        {overdue && <Badge color="error" size="sm">Overdue</Badge>}
                                                    </div>
                                                    <p className="mt-0.5 text-xs text-tertiary">{it.className}</p>
                                                </div>
                                                <span className="shrink-0 text-xs text-tertiary">{formatDate(it.date)}</span>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
