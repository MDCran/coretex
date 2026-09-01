"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarCheck01, GraduationHat02, Plus } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Card, ProgressBar, SectionHeader, Stat } from "../_components/learning-ui";
import { FormModal } from "../_components/form-modal";
import { formatDate } from "@/lib/dates";
import { createClass } from "@/lib/actions/learning-academic";
import { ClassFormFields, ColorDot, StatusBadge, gradeColor, gradeTextClass, HOMEWORK_STATUS_LABEL, run } from "./_components/shared";

export interface ClassCard {
    id: string;
    name: string;
    term: string | null;
    status: string;
    creditHours: number | null;
    color: string | null;
    percent: number | null;
    letter: string | null;
    finalGrade: number | null;
    absenceCount: number;
    absenceLimit: number | null;
    nextExamTitle: string | null;
    nextExamDays: number | null;
}

export interface HomeworkRow {
    id: string;
    classId: string;
    className: string;
    classColor: string | null;
    title: string;
    status: string;
    dueDate: string | null;
}

export function AcademicClient({
    classes,
    homework,
    gpa,
    totalCredits,
    classCount,
}: {
    classes: ClassCard[];
    homework: HomeworkRow[];
    gpa: number | null;
    totalCredits: number;
    classCount: number;
}) {
    const [open, setOpen] = useState(false);
    const now = Date.now();

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Academic"
                description="Track classes, grades, GPA and attendance across the semester."
                action={
                    <div className="flex items-center gap-2">
                        <Button size="md" color="secondary" iconLeading={CalendarCheck01} href="/learning/academic/planner">
                            Semester planner
                        </Button>
                        <Button size="md" iconLeading={Plus} onClick={() => setOpen(true)}>
                            Add class
                        </Button>
                    </div>
                }
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat label="Cumulative GPA" value={gpa == null ? "—" : gpa.toFixed(2)} sub="Credit-weighted, 4.0 scale" />
                <Stat label="Total credits" value={totalCredits || "—"} sub="Active + completed classes" />
                <Stat label="Classes" value={classCount} sub="Not counting dropped" />
            </div>

            {/* Class cards */}
            {classes.length === 0 ? (
                <Card>
                    <p className="py-6 text-center text-sm text-tertiary">No classes yet. Add your first class to start tracking grades.</p>
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {classes.map((c) => {
                        const atLimit = c.absenceLimit != null && c.absenceCount >= c.absenceLimit;
                        const nearLimit = c.absenceLimit != null && !atLimit && c.absenceCount >= c.absenceLimit - 1;
                        return (
                            <Card key={c.id} className="flex flex-col gap-3">
                                <div className="flex items-start justify-between gap-2">
                                    <Link href={`/learning/academic/${c.id}`} className="flex min-w-0 items-center gap-2">
                                        <ColorDot color={c.color} />
                                        <span className="min-w-0">
                                            <h3 className="truncate text-md font-semibold text-primary hover:text-brand-secondary">{c.name}</h3>
                                            {c.term && <p className="text-xs text-tertiary">{c.term}</p>}
                                        </span>
                                    </Link>
                                    <StatusBadge status={c.status} />
                                </div>

                                <div className="flex items-end justify-between gap-2">
                                    <div>
                                        <p className={"text-display-xs font-semibold " + gradeTextClass(c.percent)}>
                                            {c.percent == null ? "—" : `${c.percent.toFixed(1)}%`}
                                        </p>
                                        <p className="text-xs text-tertiary">
                                            {c.letter ?? "No grades yet"}
                                            {c.creditHours != null && ` · ${c.creditHours} cr`}
                                        </p>
                                    </div>
                                    {c.nextExamDays != null && (
                                        <Badge color={c.nextExamDays <= 3 ? "warning" : "gray"} size="sm">
                                            {c.nextExamDays === 0 ? "Exam today" : `Next exam in ${c.nextExamDays}d`}
                                        </Badge>
                                    )}
                                </div>

                                {/* Attendance meter */}
                                {c.absenceLimit != null && (
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center justify-between text-xs text-tertiary">
                                            <span className="flex items-center gap-1">
                                                {(atLimit || nearLimit) && <AlertTriangle aria-hidden="true" className={atLimit ? "size-3.5 text-error-primary" : "size-3.5 text-warning-primary"} />}
                                                Absences
                                            </span>
                                            <span className={atLimit ? "font-medium text-error-primary" : nearLimit ? "font-medium text-warning-primary" : ""}>
                                                {c.absenceCount}/{c.absenceLimit}
                                            </span>
                                        </div>
                                        <ProgressBar value={c.absenceCount} max={c.absenceLimit} color={atLimit ? "error" : nearLimit ? "warning" : "brand"} />
                                        {atLimit && <p className="text-xs text-error-primary">At/over absence limit — at risk of being dropped.</p>}
                                    </div>
                                )}

                                <div className="mt-auto pt-1">
                                    <Button size="sm" color="link-color" href={`/learning/academic/${c.id}`}>
                                        Open class
                                    </Button>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Homework urgency queue */}
            <Card className="flex flex-col gap-4">
                <SectionHeader title="Homework queue" description="Outstanding work across active classes, soonest due first." />
                {homework.length === 0 ? (
                    <p className="py-4 text-center text-sm text-tertiary">Nothing outstanding. You're all caught up.</p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {homework.map((h) => {
                            const due = h.dueDate ? new Date(h.dueDate).getTime() : null;
                            const overdue = due != null && due < now;
                            const soon = due != null && !overdue && due - now <= 2 * 86_400_000;
                            return (
                                <Link
                                    key={h.id}
                                    href={`/learning/academic/${h.classId}`}
                                    className="flex items-center justify-between gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover"
                                >
                                    <div className="flex min-w-0 items-center gap-2">
                                        <ColorDot color={h.classColor} />
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-primary">{h.title}</p>
                                            <p className="truncate text-xs text-tertiary">
                                                {h.className} · {HOMEWORK_STATUS_LABEL[h.status] ?? h.status}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <span className={"text-xs " + (overdue ? "text-error-primary" : soon ? "text-warning-primary" : "text-tertiary")}>
                                            {h.dueDate ? formatDate(h.dueDate) : "No due date"}
                                        </span>
                                        {overdue && <Badge color="error" size="sm">Overdue</Badge>}
                                        {soon && <Badge color="warning" size="sm">Due soon</Badge>}
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </Card>

            <FormModal isOpen={open} onOpenChange={setOpen} title="Add class" description="Set up a class with a weighted grade tracker.">
                <form
                    action={async (fd) => {
                        const ok = await run(createClass, fd, "Class added");
                        if (ok) setOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    <ClassFormFields />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" iconLeading={GraduationHat02}>
                            Add class
                        </Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
