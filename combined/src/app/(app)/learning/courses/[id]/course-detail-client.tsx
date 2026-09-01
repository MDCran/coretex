"use client";

import { useState } from "react";
import {
    ArrowLeft,
    Award02,
    Clock,
    Edit01,
    HelpCircle,
    LinkExternal01,
    PlayCircle,
    Plus,
    Star01,
    Trash02,
    UploadCloud01,
} from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { fileUrl } from "@/lib/files";
import { formatDuration } from "@/lib/learning/youtube-shared";
import { Card, Field, NativeInput, NativeSelect, NativeTextarea, ProgressBar, SectionHeader } from "../../_components/learning-ui";
import { FormModal } from "../../_components/form-modal";
import {
    addSection,
    deleteSection,
    logCourseTime,
    rateCourse,
    setCourseStatus,
    setLinkedGoal,
    toggleSection,
    updateSection,
    uploadCertificate,
} from "@/lib/actions/learning-courses";

interface CourseInfo {
    id: string;
    title: string;
    provider: string;
    url: string | null;
    thumbnailUrl: string | null;
    description: string | null;
    status: string;
    rating: number | null;
    review: string | null;
    certificateKey: string | null;
    timeInvestedMinutes: number;
    totalDurationSeconds: number | null;
    linkedGoalId: string | null;
}
interface SectionRow {
    id: string;
    title: string;
    description: string | null;
    completed: boolean;
    estimatedMinutes: number | null;
    order: number;
}
interface GoalOption {
    id: string;
    label: string;
}
interface QuizRow {
    id: string;
    title: string;
}

const PROVIDER_LABEL: Record<string, string> = { youtube: "YouTube", udemy: "Udemy", coursera: "Coursera", other: "Other" };
const PROVIDER_COLOR: Record<string, "error" | "purple" | "blue" | "gray"> = { youtube: "error", udemy: "purple", coursera: "blue", other: "gray" };
const STATUS_COLOR: Record<string, "gray" | "brand" | "success"> = { planned: "gray", in_progress: "brand", completed: "success" };

async function run(action: (fd: FormData) => Promise<void>, fd: FormData, ok = "Saved") {
    try {
        await action(fd);
        toast.success(ok);
        return true;
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        return false;
    }
}

export function CourseDetailClient({
    course,
    sections,
    goals,
    quizzes,
}: {
    course: CourseInfo;
    sections: SectionRow[];
    goals: GoalOption[];
    quizzes: QuizRow[];
}) {
    const [sectionOpen, setSectionOpen] = useState(false);
    const [editing, setEditing] = useState<SectionRow | null>(null);
    const [rating, setRating] = useState(course.rating ?? 0);

    const total = sections.length;
    const done = sections.filter((s) => s.completed).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const remainingMinutes = sections.filter((s) => !s.completed).reduce((sum, s) => sum + (s.estimatedMinutes ?? 0), 0);

    const investedSeconds = course.timeInvestedMinutes * 60;
    const totalSeconds = course.totalDurationSeconds ?? 0;

    return (
        <div className="flex flex-col gap-6">
            <Button size="sm" color="link-gray" iconLeading={ArrowLeft} href="/learning/courses">Back to courses</Button>

            {/* Header */}
            <Card className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="w-full sm:w-56 sm:shrink-0">
                    {course.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={course.thumbnailUrl} alt={course.title} className="aspect-video w-full rounded-lg object-cover ring-1 ring-secondary ring-inset" />
                    ) : (
                        <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-brand-secondary ring-1 ring-secondary ring-inset">
                            <PlayCircle aria-hidden="true" className="size-8 text-fg-brand-primary" />
                        </div>
                    )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h1 className="text-xl font-semibold text-primary">{course.title}</h1>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Badge color={PROVIDER_COLOR[course.provider] ?? "gray"} size="sm">{PROVIDER_LABEL[course.provider] ?? course.provider}</Badge>
                                <Badge color={STATUS_COLOR[course.status] ?? "gray"} size="sm">{course.status.replace("_", " ")}</Badge>
                            </div>
                        </div>
                        {course.url && <Button size="sm" color="secondary" iconLeading={LinkExternal01} href={course.url} target="_blank" rel="noreferrer">Open</Button>}
                    </div>
                    {course.description && <p className="text-sm text-tertiary">{course.description}</p>}
                    <div className="max-w-xs">
                        <Field label="Status" htmlFor="status">
                            <NativeSelect
                                id="status"
                                defaultValue={course.status}
                                onChange={(e) => {
                                    const fd = new FormData();
                                    fd.set("id", course.id);
                                    fd.set("status", e.target.value);
                                    run(setCourseStatus, fd, "Status updated");
                                }}
                            >
                                <option value="planned">Planned</option>
                                <option value="in_progress">In progress</option>
                                <option value="completed">Completed</option>
                            </NativeSelect>
                        </Field>
                    </div>
                </div>
            </Card>

            {/* Sections checklist */}
            <Card className="flex flex-col gap-4">
                <SectionHeader
                    title="Sections"
                    description={
                        total
                            ? `${done}/${total} complete · ${pct}%` + (remainingMinutes > 0 ? ` · ${formatDuration(remainingMinutes * 60)} remaining` : "")
                            : "Break the course into sections/modules to track progress."
                    }
                    action={<Button size="sm" iconLeading={Plus} onClick={() => { setEditing(null); setSectionOpen(true); }}>Add section</Button>}
                />
                <ProgressBar value={done} max={total} color={total && done === total ? "success" : "brand"} />
                <div className="flex flex-col gap-2">
                    {sections.length === 0 && <p className="text-sm text-tertiary">No sections yet.</p>}
                    {sections.map((s) => (
                        <div key={s.id} className="flex items-start gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                            <button
                                type="button"
                                aria-label={s.completed ? "Mark incomplete" : "Mark complete"}
                                onClick={() => {
                                    const fd = new FormData();
                                    fd.set("id", s.id);
                                    run(toggleSection, fd, s.completed ? "Reopened" : "Completed");
                                }}
                                className={cx(
                                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-xs ring-1 ring-inset transition duration-100 ease-linear",
                                    s.completed ? "bg-brand-solid text-white ring-transparent" : "bg-primary ring-primary hover:ring-brand",
                                )}
                            >
                                {s.completed && "✓"}
                            </button>
                            <div className="min-w-0 flex-1">
                                <p className={cx("text-sm font-medium", s.completed ? "text-tertiary line-through" : "text-primary")}>{s.title}</p>
                                {s.description && <p className="text-xs text-tertiary">{s.description}</p>}
                                {s.estimatedMinutes != null && (
                                    <p className="mt-0.5 flex items-center gap-1 text-xs text-tertiary">
                                        <Clock aria-hidden="true" className="size-3" /> {formatDuration(s.estimatedMinutes * 60)}
                                    </p>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit section" onClick={() => { setEditing(s); setSectionOpen(true); }} />
                                <Button
                                    size="sm"
                                    color="tertiary-destructive"
                                    iconLeading={Trash02}
                                    aria-label="Delete section"
                                    onClick={() => {
                                        const fd = new FormData();
                                        fd.set("id", s.id);
                                        run(deleteSection, fd, "Deleted");
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </Card>

            {/* Time invested */}
            <Card className="flex flex-col gap-4">
                <SectionHeader title="Time invested" description="Log study time against this course." />
                <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-sm text-tertiary">
                        <span className="font-medium text-secondary">{formatDuration(investedSeconds)} invested</span>
                        <span>{totalSeconds ? `of ${formatDuration(totalSeconds)}` : "no total set"}</span>
                    </div>
                    <ProgressBar value={investedSeconds} max={totalSeconds} color={totalSeconds && investedSeconds >= totalSeconds ? "success" : "brand"} />
                </div>
                <form
                    action={async (fd) => {
                        fd.set("id", course.id);
                        const ok = await run(logCourseTime, fd, "Time logged");
                        if (ok) (document.getElementById("log-time-form") as HTMLFormElement | null)?.reset();
                    }}
                    id="log-time-form"
                    className="flex flex-wrap items-end gap-3"
                >
                    <Field label="Log time (minutes)" htmlFor="minutes" className="w-40">
                        <NativeInput id="minutes" name="minutes" type="number" min={1} placeholder="e.g. 45" required />
                    </Field>
                    <Button type="submit" iconLeading={Plus}>Log time</Button>
                </form>
            </Card>

            {/* Rating & review */}
            <Card className="flex flex-col gap-4">
                <SectionHeader title="Rating & review" description="Your private rating and notes after completing the course." />
                <form
                    action={async (fd) => {
                        fd.set("id", course.id);
                        fd.set("rating", String(rating || course.rating || 0));
                        await run(rateCourse, fd, "Saved review");
                    }}
                    className="flex flex-col gap-4"
                >
                    <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                            <button key={n} type="button" aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setRating(n)}>
                                <Star01 className={cx("size-6 transition duration-100 ease-linear", n <= rating ? "fill-current text-fg-warning-primary" : "text-fg-quaternary hover:text-fg-warning-secondary")} />
                            </button>
                        ))}
                        {rating > 0 && (
                            <button type="button" className="ml-2 text-xs text-tertiary hover:text-secondary" onClick={() => setRating(0)}>Clear</button>
                        )}
                    </div>
                    <Field label="Review" htmlFor="review">
                        <NativeTextarea id="review" name="review" defaultValue={course.review ?? ""} placeholder="What did you think of this course?" />
                    </Field>
                    <div className="flex justify-end">
                        <Button type="submit" isDisabled={rating < 1}>Save review</Button>
                    </div>
                </form>
            </Card>

            {/* Certificate */}
            <Card className="flex flex-col gap-4">
                <SectionHeader title="Certificate" description="Upload a certificate of completion for your trophy shelf." />
                {course.certificateKey ? (
                    <div className="flex items-center gap-3 rounded-lg bg-secondary p-4 ring-1 ring-secondary ring-inset">
                        <div className="flex size-10 items-center justify-center rounded-full bg-warning-secondary">
                            <Award02 aria-hidden="true" className="size-5 text-fg-warning-primary" />
                        </div>
                        <p className="flex-1 text-sm font-medium text-secondary">Certificate uploaded</p>
                        <Button size="sm" color="secondary" iconLeading={LinkExternal01} href={fileUrl(course.certificateKey)} target="_blank" rel="noreferrer">View</Button>
                    </div>
                ) : null}
                <form
                    action={async (fd) => {
                        fd.set("id", course.id);
                        await run(uploadCertificate, fd, "Certificate uploaded");
                    }}
                    className="flex flex-wrap items-end gap-3"
                >
                    <Field label={course.certificateKey ? "Replace certificate" : "Upload certificate"} htmlFor="file" className="min-w-60 flex-1">
                        <input
                            id="file"
                            name="file"
                            type="file"
                            accept="image/*,application/pdf"
                            className="block w-full text-sm text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary hover:file:bg-secondary_hover"
                        />
                    </Field>
                    <Button type="submit" color="secondary" iconLeading={UploadCloud01}>Upload</Button>
                </form>
            </Card>

            {/* Linked goal */}
            <Card className="flex flex-col gap-4">
                <SectionHeader title="Linked goal" description="Connect this course to a learning goal." />
                {goals.length === 0 ? (
                    <p className="text-sm text-tertiary">No learning goals yet. Create one on the Goals page to link it here.</p>
                ) : (
                    <form
                        action={async (fd) => {
                            fd.set("id", course.id);
                            await run(setLinkedGoal, fd, "Goal updated");
                        }}
                        className="flex flex-wrap items-end gap-3"
                    >
                        <Field label="Goal" htmlFor="linkedGoalId" className="min-w-60 flex-1">
                            <NativeSelect id="linkedGoalId" name="linkedGoalId" defaultValue={course.linkedGoalId ?? ""}>
                                <option value="">None</option>
                                {goals.map((g) => (
                                    <option key={g.id} value={g.id}>{g.label}</option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Button type="submit" color="secondary">Save</Button>
                    </form>
                )}
                {course.linkedGoalId && (
                    <Button size="sm" color="link-color" iconLeading={LinkExternal01} href="/learning/goals">View linked goal</Button>
                )}
            </Card>

            {/* Linked quizzes (lightweight; full management lives on the quizzes page) */}
            {quizzes.length > 0 && (
                <Card className="flex flex-col gap-3">
                    <SectionHeader title="Quizzes" description="Quizzes linked to this course." />
                    <div className="flex flex-col gap-2">
                        {quizzes.map((q) => (
                            <div key={q.id} className="flex items-center gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                                <HelpCircle aria-hidden="true" className="size-4 text-fg-quaternary" />
                                <p className="min-w-0 flex-1 truncate text-sm font-medium text-primary">{q.title}</p>
                                <Button size="sm" color="link-color" href="/learning/quizzes">Open</Button>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Section add/edit modal */}
            <FormModal isOpen={sectionOpen} onOpenChange={setSectionOpen} title={editing ? "Edit section" : "Add section"}>
                <form
                    action={async (fd) => {
                        const ok = await run(editing ? updateSection : addSection, fd, editing ? "Updated" : "Added");
                        if (ok) setSectionOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    {editing ? <input type="hidden" name="id" value={editing.id} /> : <input type="hidden" name="courseId" value={course.id} />}
                    <Field label="Title" htmlFor="section-title"><NativeInput id="section-title" name="title" defaultValue={editing?.title} required /></Field>
                    <Field label="Estimated minutes" htmlFor="section-minutes">
                        <NativeInput id="section-minutes" name="estimatedMinutes" type="number" min={0} defaultValue={editing?.estimatedMinutes ?? ""} placeholder="e.g. 30" />
                    </Field>
                    <Field label="Description" htmlFor="section-description"><NativeTextarea id="section-description" name="description" defaultValue={editing?.description ?? ""} /></Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setSectionOpen(false)}>Cancel</Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
