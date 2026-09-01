"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    BookOpen01,
    Check,
    CheckCircle,
    Circle,
    Clock,
    Edit01,
    FileX02,
    LinkExternal01,
    Lightbulb02,
    Plus,
    Snowflake01,
    StickerSquare,
    Trash02,
    VideoRecorder,
    Zap,
} from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { Card, EmptyState, Field, NativeInput, NativeSelect, NativeTextarea, ProgressBar, SectionHeader } from "../../_components/learning-ui";
import { FormModal } from "../../_components/form-modal";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { formatDate } from "@/lib/dates";
import { generateLearningPath } from "@/lib/actions/learning-ai";
import {
    addMilestone,
    addResource,
    checkInGoal,
    completeGoal,
    deleteGoal,
    deleteMilestone,
    deleteResource,
    logGoalSession,
    setMilestoneStatus,
    updateGoal,
    updateMilestone,
    updateResource,
} from "@/lib/actions/learning-goals";
import { countdown, countdownClass } from "../countdown";

type MilestoneStatus = "NOT_STARTED" | "IN_PROGRESS" | "DONE";

interface GoalData {
    id: string;
    title: string | null;
    description: string;
    goalType: string | null;
    color: string | null;
    targetDate: string | null;
    completed: boolean;
    streakCount: number;
    freezeTokens: number;
    lastStudiedOn: string | null;
}
interface MilestoneRow {
    id: string;
    title: string;
    dueDate: string | null;
    status: MilestoneStatus;
    order: number;
}
interface ResourceRow {
    id: string;
    title: string;
    resourceType: string | null;
    url: string | null;
    notes: string | null;
}
interface SessionRow {
    id: string;
    sessionDate: string;
    durationMinutes: number | null;
    notes: string | null;
}

const STATUS_META: Record<MilestoneStatus, { label: string; color: "gray" | "brand" | "success"; icon: typeof Circle }> = {
    NOT_STARTED: { label: "Not started", color: "gray", icon: Circle },
    IN_PROGRESS: { label: "In progress", color: "brand", icon: Clock },
    DONE: { label: "Done", color: "success", icon: CheckCircle },
};

const RESOURCE_COLUMNS: { type: string; label: string; icon: typeof BookOpen01 }[] = [
    { type: "link", label: "Links", icon: LinkExternal01 },
    { type: "video", label: "Videos", icon: VideoRecorder },
    { type: "book", label: "Books", icon: BookOpen01 },
    { type: "note", label: "Notes", icon: StickerSquare },
];

async function run(action: (fd: FormData) => Promise<unknown>, fd: FormData, ok = "Saved") {
    try {
        await action(fd);
        toast.success(ok);
        return true;
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        return false;
    }
}

function goalLabel(g: GoalData) {
    return g.title?.trim() || g.description;
}

function studiedToday(iso: string | null): boolean {
    if (!iso) return false;
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function GoalDetailClient({
    goal,
    milestones,
    resources,
    sessions,
}: {
    goal: GoalData;
    milestones: MilestoneRow[];
    resources: ResourceRow[];
    sessions: SessionRow[];
}) {
    const router = useRouter();
    const [editOpen, setEditOpen] = useState(false);
    const [milestoneOpen, setMilestoneOpen] = useState(false);
    const [editingMilestone, setEditingMilestone] = useState<MilestoneRow | null>(null);
    const [resourceOpen, setResourceOpen] = useState(false);
    const [editingResource, setEditingResource] = useState<ResourceRow | null>(null);
    const [resourceType, setResourceType] = useState<string>("link");
    const [aiPending, startAi] = useTransition();

    const cd = countdown(goal.targetDate);
    const done = milestones.filter((m) => m.status === "DONE").length;
    const allDone = milestones.length > 0 && done === milestones.length;
    const checkedInToday = studiedToday(goal.lastStudiedOn);

    function delById(action: (fd: FormData) => Promise<unknown>, id: string) {
        const fd = new FormData();
        fd.set("id", id);
        run(action, fd, "Deleted");
    }

    function handleCheckIn() {
        const fd = new FormData();
        fd.set("goalId", goal.id);
        run(checkInGoal, fd, "Streak updated — keep it up!");
    }

    function handleGeneratePath() {
        startAi(async () => {
            try {
                const fd = new FormData();
                fd.set("goalId", goal.id);
                const { added } = await generateLearningPath(fd);
                toast.success(added > 0 ? `Added ${added} milestones` : "No milestones generated");
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "AI generation failed");
            }
        });
    }

    return (
        <div className="flex flex-col gap-6">
            <Button size="sm" color="link-gray" iconLeading={ArrowLeft} href="/learning/goals" className="self-start">
                Back to goals
            </Button>

            {/* Header */}
            <Card className="flex flex-col gap-4 border-l-4" >
                <div
                    className="-mt-5 -mr-5 -ml-5 h-1.5 rounded-t-xl"
                    style={goal.color ? { backgroundColor: goal.color } : undefined}
                />
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-xl font-semibold text-primary">{goalLabel(goal)}</h1>
                            {goal.goalType && <Badge color="gray" size="sm" type="modern">{goal.goalType}</Badge>}
                            {goal.completed && <Badge color="success" size="sm">Completed</Badge>}
                        </div>
                        {goal.title && goal.description && goal.description !== goal.title && (
                            <p className="text-sm text-tertiary">{goal.description}</p>
                        )}
                        {goal.targetDate && (
                            <p className="text-sm text-tertiary">
                                Target {formatDate(goal.targetDate)}
                                {cd && !goal.completed && (
                                    <span className={cx("ml-2 font-medium", countdownClass(cd.tone))}>· {cd.label}</span>
                                )}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="sm" color="secondary" iconLeading={Edit01} onClick={() => setEditOpen(true)}>
                            Edit
                        </Button>
                        <Button
                            size="sm"
                            color={goal.completed ? "secondary" : "primary"}
                            iconLeading={Check}
                            onClick={() => {
                                const fd = new FormData();
                                fd.set("id", goal.id);
                                run(completeGoal, fd, goal.completed ? "Reopened" : "Marked complete");
                            }}
                        >
                            {goal.completed ? "Reopen" : "Complete"}
                        </Button>
                        <Button
                            size="sm"
                            color="tertiary-destructive"
                            iconLeading={Trash02}
                            aria-label="Delete goal"
                            onClick={() => {
                                if (!confirm("Delete this goal and all its milestones, resources, and sessions?")) return;
                                const fd = new FormData();
                                fd.set("id", goal.id);
                                run(deleteGoal, fd, "Deleted").then((ok) => ok && router.push("/learning/goals"));
                            }}
                        />
                    </div>
                </div>

                {/* Streak + check-in */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary p-4 ring-1 ring-secondary ring-inset">
                    <div className="flex items-center gap-5">
                        <div className="flex items-center gap-2">
                            <span aria-hidden="true" className="text-2xl">🔥</span>
                            <div className="flex flex-col">
                                <span className="text-lg font-semibold text-primary tabular-nums">{goal.streakCount}</span>
                                <span className="text-xs text-tertiary">day streak</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Snowflake01 aria-hidden="true" className="size-5 text-fg-quaternary" />
                            <div className="flex flex-col">
                                <span className="text-lg font-semibold text-primary tabular-nums">{goal.freezeTokens}</span>
                                <span className="text-xs text-tertiary">freeze tokens</span>
                            </div>
                        </div>
                    </div>
                    <Button
                        size="md"
                        iconLeading={Zap}
                        color={checkedInToday ? "secondary" : "primary"}
                        isDisabled={checkedInToday}
                        onClick={handleCheckIn}
                    >
                        {checkedInToday ? "Studied today ✓" : "I studied today"}
                    </Button>
                </div>
            </Card>

            {/* Milestones */}
            <Card className="flex flex-col gap-4">
                <SectionHeader
                    title="Milestones"
                    description={milestones.length ? `${done} of ${milestones.length} complete` : "Break this goal into trackable steps."}
                    action={
                        <div className="flex items-center gap-2">
                            <Button
                                size="sm"
                                color="secondary"
                                iconLeading={Lightbulb02}
                                isLoading={aiPending}
                                showTextWhileLoading
                                onClick={handleGeneratePath}
                            >
                                AI learning path
                            </Button>
                            <Button size="sm" iconLeading={Plus} onClick={() => { setEditingMilestone(null); setMilestoneOpen(true); }}>
                                Add
                            </Button>
                        </div>
                    }
                />

                {milestones.length > 0 && <ProgressBar value={done} max={milestones.length} color={allDone ? "success" : "brand"} />}

                {milestones.length === 0 ? (
                    <EmptyState
                        icon={CheckCircle}
                        theme="modern"
                        compact
                        title="No milestones yet"
                        description="Add steps manually, or let AI generate a week-by-week curriculum."
                    />
                ) : (
                    <ul className="flex flex-col gap-2">
                        {milestones.map((m) => {
                            const meta = STATUS_META[m.status];
                            const StatusIcon = meta.icon;
                            const mcd = countdown(m.dueDate);
                            return (
                                <li key={m.id} className="flex items-start gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                                    <button
                                        type="button"
                                        aria-label={`Cycle status (currently ${meta.label})`}
                                        title={`Click to cycle status (currently ${meta.label})`}
                                        onClick={() => {
                                            const fd = new FormData();
                                            fd.set("id", m.id);
                                            run(setMilestoneStatus, fd, "Status updated");
                                        }}
                                        className={cx(
                                            "mt-0.5 shrink-0 transition duration-100 ease-linear",
                                            m.status === "DONE" ? "text-fg-success-primary" : m.status === "IN_PROGRESS" ? "text-fg-brand-primary" : "text-fg-quaternary hover:text-fg-tertiary",
                                        )}
                                    >
                                        <StatusIcon className="size-5" />
                                    </button>
                                    <div className="min-w-0 flex-1">
                                        <p className={cx("text-sm", m.status === "DONE" ? "text-tertiary line-through" : "text-primary")}>{m.title}</p>
                                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                            <Badge color={meta.color} size="sm">{meta.label}</Badge>
                                            {m.dueDate && (
                                                <span className={cx("text-xs", mcd && m.status !== "DONE" ? countdownClass(mcd.tone) : "text-tertiary")}>
                                                    Due {formatDate(m.dueDate)}
                                                    {mcd && m.status !== "DONE" && ` · ${mcd.label}`}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit milestone" onClick={() => { setEditingMilestone(m); setMilestoneOpen(true); }} />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Delete milestone" onClick={() => delById(deleteMilestone, m.id)} />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Card>

            {/* Resource board */}
            <Card className="flex flex-col gap-4">
                <SectionHeader
                    title="Resource board"
                    description="Organize the links, videos, books, and notes that support this goal."
                    action={
                        <Button size="sm" iconLeading={Plus} onClick={() => { setEditingResource(null); setResourceType("link"); setResourceOpen(true); }}>
                            Add resource
                        </Button>
                    }
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {RESOURCE_COLUMNS.map((col) => {
                        const Icon = col.icon;
                        const items = resources.filter((r) => (r.resourceType ?? "note") === col.type);
                        return (
                            <div key={col.type} className="flex flex-col gap-2 rounded-xl bg-secondary p-3 ring-1 ring-secondary ring-inset">
                                <div className="flex items-center gap-2 text-sm font-semibold text-secondary">
                                    <Icon aria-hidden="true" className="size-4 text-fg-quaternary" />
                                    {col.label}
                                    <span className="ml-auto text-xs font-normal text-tertiary tabular-nums">{items.length}</span>
                                </div>
                                {items.length === 0 ? (
                                    <p className="px-1 py-2 text-xs text-tertiary">Nothing here yet.</p>
                                ) : (
                                    items.map((r) => (
                                        <div key={r.id} className="group flex flex-col gap-1 rounded-lg bg-primary p-3 ring-1 ring-secondary ring-inset">
                                            <div className="flex items-start justify-between gap-1">
                                                <p className="min-w-0 flex-1 text-sm font-medium text-primary">{r.title}</p>
                                                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                                                    <button type="button" aria-label="Edit resource" onClick={() => { setEditingResource(r); setResourceType(r.resourceType ?? "note"); setResourceOpen(true); }} className="rounded p-1 text-fg-quaternary hover:text-fg-secondary">
                                                        <Edit01 className="size-3.5" />
                                                    </button>
                                                    <button type="button" aria-label="Delete resource" onClick={() => delById(deleteResource, r.id)} className="rounded p-1 text-fg-quaternary hover:text-fg-error-primary">
                                                        <Trash02 className="size-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                            {r.url && (
                                                <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 truncate text-xs text-brand-secondary hover:underline">
                                                    <LinkExternal01 className="size-3 shrink-0" aria-hidden="true" />
                                                    <span className="truncate">{r.url}</span>
                                                </a>
                                            )}
                                            {r.notes && <p className="text-xs text-tertiary">{r.notes}</p>}
                                        </div>
                                    ))
                                )}
                            </div>
                        );
                    })}
                </div>
            </Card>

            {/* Progress sessions */}
            <Card className="flex flex-col gap-4">
                <SectionHeader title="Progress sessions" description="Log study time and notes toward this goal." />
                <form
                    action={async (fd) => {
                        fd.set("goalId", goal.id);
                        const ok = await run(logGoalSession, fd, "Session logged");
                        if (ok) (document.getElementById("goal-session-form") as HTMLFormElement | null)?.reset();
                    }}
                    id="goal-session-form"
                    className="flex flex-col gap-3 sm:flex-row sm:items-end"
                >
                    <Field label="Minutes" htmlFor="durationMinutes" className="sm:w-40">
                        <NativeInput id="durationMinutes" name="durationMinutes" type="number" min={0} placeholder="e.g. 45" />
                    </Field>
                    <Field label="Notes" htmlFor="notes" className="flex-1">
                        <NativeInput id="notes" name="notes" placeholder="What did you work on?" />
                    </Field>
                    <Button type="submit" iconLeading={Plus}>Log progress</Button>
                </form>

                {sessions.length === 0 ? (
                    <EmptyState icon={FileX02} theme="modern" compact title="No sessions logged yet" description="Your study sessions for this goal will appear here." />
                ) : (
                    <ul className="flex flex-col divide-y divide-secondary">
                        {sessions.map((s) => (
                            <li key={s.id} className="flex items-start justify-between gap-3 py-2.5">
                                <div className="min-w-0">
                                    <p className="text-sm text-primary">{s.notes || "Study session"}</p>
                                    <p className="text-xs text-tertiary">{formatDate(s.sessionDate)}</p>
                                </div>
                                {s.durationMinutes != null && (
                                    <Badge color="gray" size="sm" type="modern">{s.durationMinutes} min</Badge>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {/* Edit goal modal */}
            <FormModal isOpen={editOpen} onOpenChange={setEditOpen} title="Edit goal">
                <form
                    action={async (fd) => {
                        if (await run(updateGoal, fd, "Goal updated")) setEditOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    <input type="hidden" name="id" value={goal.id} />
                    <input type="hidden" name="color" value={goal.color ?? ""} />
                    <Field label="Title" htmlFor="etitle" required>
                        <NativeInput id="etitle" name="title" defaultValue={goal.title ?? ""} required />
                    </Field>
                    <Field label="Description" htmlFor="edescription">
                        <NativeTextarea id="edescription" name="description" defaultValue={goal.description} />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Type" htmlFor="egoalType">
                            <NativeInput id="egoalType" name="goalType" defaultValue={goal.goalType ?? ""} />
                        </Field>
                        <FormDateInput name="targetDate" label="Target date" defaultValue={goal.targetDate ?? undefined} />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setEditOpen(false)}>Cancel</Button>
                        <Button type="submit">Save</Button>
                    </div>
                </form>
            </FormModal>

            {/* Milestone modal */}
            <FormModal isOpen={milestoneOpen} onOpenChange={setMilestoneOpen} title={editingMilestone ? "Edit milestone" : "Add milestone"}>
                <form
                    key={editingMilestone?.id ?? "new"}
                    action={async (fd) => {
                        if (!editingMilestone) fd.set("goalId", goal.id);
                        if (await run(editingMilestone ? updateMilestone : addMilestone, fd, editingMilestone ? "Updated" : "Added")) setMilestoneOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    {editingMilestone && <input type="hidden" name="id" value={editingMilestone.id} />}
                    <Field label="Title" htmlFor="mtitle" required>
                        <NativeInput id="mtitle" name="title" defaultValue={editingMilestone?.title ?? ""} placeholder="e.g. Complete chapters 1-5" required />
                    </Field>
                    <FormDateInput name="dueDate" label="Due date" defaultValue={editingMilestone?.dueDate ?? undefined} />
                    {editingMilestone && (
                        <p className="text-xs text-tertiary">Tip: click a milestone's status icon in the list to cycle Not started → In progress → Done.</p>
                    )}
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setMilestoneOpen(false)}>Cancel</Button>
                        <Button type="submit">{editingMilestone ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>

            {/* Resource modal */}
            <FormModal isOpen={resourceOpen} onOpenChange={setResourceOpen} title={editingResource ? "Edit resource" : "Add resource"}>
                <form
                    key={editingResource?.id ?? "new"}
                    action={async (fd) => {
                        if (!editingResource) fd.set("goalId", goal.id);
                        if (await run(editingResource ? updateResource : addResource, fd, editingResource ? "Updated" : "Added")) setResourceOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    {editingResource && <input type="hidden" name="id" value={editingResource.id} />}
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Title" htmlFor="rtitle" required>
                            <NativeInput id="rtitle" name="title" defaultValue={editingResource?.title ?? ""} required />
                        </Field>
                        <Field label="Type" htmlFor="resourceType">
                            <NativeSelect id="resourceType" name="resourceType" value={resourceType} onChange={(e) => setResourceType(e.target.value)}>
                                <option value="link">Link</option>
                                <option value="video">Video</option>
                                <option value="book">Book</option>
                                <option value="note">Note</option>
                            </NativeSelect>
                        </Field>
                    </div>
                    <Field label="URL" htmlFor="rurl">
                        <NativeInput id="rurl" name="url" type="url" defaultValue={editingResource?.url ?? ""} placeholder="https://" />
                    </Field>
                    <Field label="Notes" htmlFor="rnotes">
                        <NativeTextarea id="rnotes" name="notes" defaultValue={editingResource?.notes ?? ""} placeholder="Optional notes" />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setResourceOpen(false)}>Cancel</Button>
                        <Button type="submit">{editingResource ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
