"use client";

import { useState } from "react";
import Link from "next/link";
import { Award02, BookOpen01, LinkExternal01, Plus, PlayCircle, Star01, Trash02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { fileUrl } from "@/lib/files";
import { formatDuration } from "@/lib/learning/youtube-shared";
import { Card, EmptyState, Field, NativeInput, NativeTextarea, ProgressBar, SectionHeader, Stat } from "../_components/learning-ui";
import { FormModal } from "../_components/form-modal";
import { addCourse, deleteCourse } from "@/lib/actions/learning-courses";

export interface CourseRow {
    id: string;
    title: string;
    provider: string;
    url: string | null;
    thumbnailUrl: string | null;
    status: string;
    rating: number | null;
    certificateKey: string | null;
    timeInvestedMinutes: number;
    totalDurationSeconds: number | null;
    sectionsTotal: number;
    sectionsDone: number;
}

const STATUS_LABEL: Record<string, string> = { planned: "Planned", in_progress: "In progress", completed: "Completed" };
const STATUS_COLOR: Record<string, "gray" | "brand" | "success"> = { planned: "gray", in_progress: "brand", completed: "success" };
const PROVIDER_LABEL: Record<string, string> = { youtube: "YouTube", udemy: "Udemy", coursera: "Coursera", other: "Other" };
const PROVIDER_COLOR: Record<string, "error" | "purple" | "blue" | "gray"> = { youtube: "error", udemy: "purple", coursera: "blue", other: "gray" };

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

/** Inline read-only star rating. */
function Stars({ value }: { value: number }) {
    return (
        <div className="flex items-center gap-0.5" aria-label={`${value} out of 5`}>
            {[1, 2, 3, 4, 5].map((n) => (
                <Star01
                    key={n}
                    aria-hidden="true"
                    className={cx("size-3.5", n <= value ? "fill-current text-fg-warning-primary" : "text-fg-quaternary")}
                />
            ))}
        </div>
    );
}

/** Thumbnail image with a colored fallback block. */
function Thumb({ src, title, provider }: { src: string | null; title: string; provider: string }) {
    if (src) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={src} alt={title} className="aspect-video w-full rounded-lg object-cover ring-1 ring-secondary ring-inset" />;
    }
    return (
        <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-brand-secondary ring-1 ring-secondary ring-inset">
            <PlayCircle aria-hidden="true" className="size-8 text-fg-brand-primary" />
            <span className="sr-only">{PROVIDER_LABEL[provider] ?? provider}</span>
        </div>
    );
}

export function CoursesClient({ courses }: { courses: CourseRow[] }) {
    const [open, setOpen] = useState(false);

    const active = courses.filter((c) => c.status === "in_progress").length;
    const completed = courses.filter((c) => c.status === "completed").length;
    const totalHours = courses.reduce((sum, c) => sum + c.timeInvestedMinutes, 0) / 60;
    const rated = courses.filter((c) => c.rating != null);
    const avgRating = rated.length ? rated.reduce((s, c) => s + (c.rating ?? 0), 0) / rated.length : 0;

    const certificates = courses.filter((c) => c.status === "completed" && c.certificateKey);

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Self-directed courses"
                description="Track every course, your section progress, time invested, ratings, and the certificates you earn."
                action={<Button size="md" iconLeading={Plus} onClick={() => setOpen(true)}>Add course</Button>}
            />

            {courses.length > 0 && (
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <Stat label="Active courses" value={active} />
                    <Stat label="Completed" value={completed} />
                    <Stat label="Hours invested" value={totalHours.toFixed(1)} />
                    <Stat label="Avg rating" value={avgRating ? avgRating.toFixed(1) : "—"} sub={rated.length ? `${rated.length} rated` : undefined} />
                </div>
            )}

            {courses.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={BookOpen01}
                        title="Build your course library"
                        description="Paste a YouTube, Udemy, or Coursera link to start tracking lessons, time invested, and certificates in one place."
                        action={<Button size="md" iconLeading={Plus} onClick={() => setOpen(true)}>Add your first course</Button>}
                    />
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {courses.map((c) => {
                        const pct = c.sectionsTotal ? Math.round((c.sectionsDone / c.sectionsTotal) * 100) : 0;
                        const allDone = c.sectionsTotal > 0 && c.sectionsDone === c.sectionsTotal;
                        return (
                            <Card key={c.id} className="flex flex-col gap-3 transition duration-100 ease-linear hover:ring-brand">
                                <Link href={`/learning/courses/${c.id}`} className="block">
                                    <Thumb src={c.thumbnailUrl} title={c.title} provider={c.provider} />
                                </Link>
                                <div className="flex items-start justify-between gap-2">
                                    <Link href={`/learning/courses/${c.id}`} className="min-w-0">
                                        <h3 className="line-clamp-2 text-md font-semibold text-primary transition duration-100 ease-linear hover:text-brand-secondary">{c.title}</h3>
                                    </Link>
                                    <Badge color={STATUS_COLOR[c.status] ?? "gray"} size="sm">{STATUS_LABEL[c.status] ?? c.status}</Badge>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge color={PROVIDER_COLOR[c.provider] ?? "gray"} size="sm">{PROVIDER_LABEL[c.provider] ?? c.provider}</Badge>
                                    {c.rating != null && <Stars value={c.rating} />}
                                </div>

                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between text-xs text-tertiary">
                                        <span>{c.sectionsTotal ? `${c.sectionsDone}/${c.sectionsTotal} sections` : "No sections"}</span>
                                        <span>{c.sectionsTotal ? `${pct}%` : ""}</span>
                                    </div>
                                    <ProgressBar value={c.sectionsDone} max={c.sectionsTotal} color={allDone ? "success" : "brand"} />
                                </div>

                                <p className="text-xs text-tertiary">
                                    <span className="font-medium text-secondary">{formatDuration(c.timeInvestedMinutes * 60)}</span> invested
                                    {c.totalDurationSeconds ? <> of {formatDuration(c.totalDurationSeconds)}</> : null}
                                </p>

                                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                                    <Button size="sm" color="link-color" href={`/learning/courses/${c.id}`}>Open course</Button>
                                    <div className="flex items-center gap-1">
                                        {c.url && <Button size="sm" color="tertiary" iconLeading={LinkExternal01} href={c.url} target="_blank" rel="noreferrer" aria-label="Open source link" />}
                                        <Button
                                            size="sm"
                                            color="tertiary-destructive"
                                            iconLeading={Trash02}
                                            aria-label="Delete course"
                                            onClick={() => {
                                                if (!confirm("Delete this course and all its sections?")) return;
                                                const fd = new FormData();
                                                fd.set("id", c.id);
                                                run(deleteCourse, fd, "Deleted");
                                            }}
                                        />
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {certificates.length > 0 && (
                <Card className="flex flex-col gap-4">
                    <SectionHeader title="Certificate vault" description="Your trophy shelf of completed courses with certificates." />
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {certificates.map((c) => (
                            <a
                                key={c.id}
                                href={fileUrl(c.certificateKey!)}
                                target="_blank"
                                rel="noreferrer"
                                className="group flex flex-col items-center gap-2 rounded-xl bg-secondary p-4 text-center ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:ring-brand"
                            >
                                <div className="flex size-12 items-center justify-center rounded-full bg-warning-secondary">
                                    <Award02 aria-hidden="true" className="size-6 text-fg-warning-primary" />
                                </div>
                                <p className="line-clamp-2 text-xs font-medium text-secondary group-hover:text-brand-secondary">{c.title}</p>
                            </a>
                        ))}
                    </div>
                </Card>
            )}

            <FormModal
                isOpen={open}
                onOpenChange={setOpen}
                title="Add course"
                description="Paste a YouTube/Udemy/Coursera link. YouTube auto-fills title & thumbnail; for others enter the title."
            >
                <form
                    action={async (fd) => {
                        // Form collects duration in minutes for convenience; the action stores seconds.
                        const mins = fd.get("durationMinutes");
                        fd.delete("durationMinutes");
                        if (typeof mins === "string" && mins.trim()) {
                            const n = Number(mins);
                            if (Number.isFinite(n) && n > 0) fd.set("totalDurationSeconds", String(Math.round(n * 60)));
                        }
                        const ok = await run(addCourse, fd, "Added");
                        if (ok) setOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    <Field label="URL" htmlFor="url" hint="YouTube links auto-fill the title and thumbnail.">
                        <NativeInput id="url" name="url" type="url" placeholder="https://" />
                    </Field>
                    <Field label="Title" htmlFor="title" hint="Required for non-YouTube courses.">
                        <NativeInput id="title" name="title" placeholder="Course title" />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Duration (minutes)" htmlFor="durationMinutes" hint="Optional total length.">
                            <NativeInput id="durationMinutes" name="durationMinutes" type="number" min={0} placeholder="e.g. 240" />
                        </Field>
                        <Field label="Thumbnail URL" htmlFor="thumbnailUrl" hint="Optional, for non-YouTube.">
                            <NativeInput id="thumbnailUrl" name="thumbnailUrl" type="url" placeholder="https://" />
                        </Field>
                    </div>
                    <Field label="Description" htmlFor="description">
                        <NativeTextarea id="description" name="description" />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit">Add</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
