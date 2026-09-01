"use client";

import { useEffect, useMemo, useState, type FC } from "react";
import { CheckCircle, Edit01, Flag05, Play, Plus, Star01, Target04, Trash02, Trophy01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/utils/cx";
import { formatDate } from "@/lib/dates";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { Card, Field, FormModal, NativeInput, SectionHeader, Stat } from "@/components/life/life-ui";
import {
    createPeriod,
    createPriority,
    createReward,
    createSprint,
    deletePeriod,
    deletePriority,
    deleteReward,
    deleteSprint,
    finishSprint,
    startSprint,
    togglePriority,
    toggleReward,
    updatePeriod,
    updatePriority,
    updateReward,
    updateSprint,
} from "@/lib/actions/focus";

interface SprintRow {
    id: string;
    title: string;
    durationMinutes: number | null;
    startedAt: string | null;
    finishedAt: string | null;
    completed: boolean;
}
interface PriorityRow {
    id: string;
    priorityText: string;
    weekOf: string;
    order: number;
    completed: boolean;
}
interface RewardRow {
    id: string;
    description: string;
    points: number;
    earned: boolean;
}
interface PeriodRow {
    id: string;
    periodName: string;
    startDate: string;
    endDate: string;
}

/** Polished inline empty state: featured icon, heading, helper copy, primary CTA. */
function EmptyState({
    icon,
    title,
    description,
    actionLabel,
    onAction,
    actionIcon = Plus,
}: {
    icon: FC<{ className?: string }>;
    title: string;
    description: string;
    actionLabel: string;
    onAction: () => void;
    actionIcon?: FC<{ className?: string }>;
}) {
    return (
        <div className="flex flex-col items-center gap-3 rounded-xl px-6 py-8 text-center ring-1 ring-secondary ring-inset">
            <FeaturedIcon icon={icon} color="brand" theme="light" size="lg" />
            <div className="flex max-w-xs flex-col gap-1">
                <p className="text-sm font-semibold text-primary">{title}</p>
                <p className="text-sm text-tertiary">{description}</p>
            </div>
            <Button size="sm" iconLeading={actionIcon} onClick={onAction}>
                {actionLabel}
            </Button>
        </div>
    );
}

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

function delById(action: (fd: FormData) => Promise<void>, id: string) {
    const fd = new FormData();
    fd.set("id", id);
    run(action, fd, "Deleted");
}

/** Live countdown for an active sprint. */
function SprintTimer({ sprint }: { sprint: SprintRow }) {
    const endMs = useMemo(() => {
        if (!sprint.startedAt || !sprint.durationMinutes) return null;
        return new Date(sprint.startedAt).getTime() + sprint.durationMinutes * 60_000;
    }, [sprint.startedAt, sprint.durationMinutes]);

    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);

    if (!endMs) return <span className="font-mono text-2xl text-primary">running…</span>;
    const remaining = Math.max(0, endMs - now);
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    const over = remaining === 0;
    return <span className={cx("font-mono text-3xl font-semibold tabular-nums", over ? "text-success-primary" : "text-primary")}>{over ? "Time's up!" : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`}</span>;
}

export function FocusClient({ weekOf, sprints, priorities, rewards, periods }: { weekOf: string; sprints: SprintRow[]; priorities: PriorityRow[]; rewards: RewardRow[]; periods: PeriodRow[] }) {
    const [sprintOpen, setSprintOpen] = useState(false);
    const [priorityOpen, setPriorityOpen] = useState(false);
    const [rewardOpen, setRewardOpen] = useState(false);
    const [periodOpen, setPeriodOpen] = useState(false);
    const [editingSprint, setEditingSprint] = useState<SprintRow | null>(null);
    const [editingPriority, setEditingPriority] = useState<PriorityRow | null>(null);
    const [editingReward, setEditingReward] = useState<RewardRow | null>(null);
    const [editingPeriod, setEditingPeriod] = useState<PeriodRow | null>(null);

    const active = sprints.find((s) => s.startedAt && !s.finishedAt) ?? null;
    const earnedPoints = rewards.filter((r) => r.earned).reduce((sum, r) => sum + r.points, 0);
    const totalPoints = rewards.reduce((sum, r) => sum + r.points, 0);

    // Group priorities by week.
    const weeks = useMemo(() => {
        const map = new Map<string, PriorityRow[]>();
        for (const p of priorities) {
            const arr = map.get(p.weekOf) ?? [];
            arr.push(p);
            map.set(p.weekOf, arr);
        }
        return Array.from(map.entries());
    }, [priorities]);

    return (
        <div className="page-shell">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex flex-col gap-0.5 sm:gap-1">
                    <h1 className="module-title">Focus</h1>
                    <p className="text-sm text-tertiary sm:text-md">Run deep-work sprints, set the week&apos;s priorities, and reward the wins.</p>
                </div>
                {!active && (
                    <Button color="primary" iconLeading={Play} onClick={() => { setEditingSprint(null); setSprintOpen(true); }}>
                        Start a sprint
                    </Button>
                )}
            </div>

            <div className="flex flex-col gap-6">
                <div className="grid grid-cols-1 gap-4 xs:grid-cols-2 lg:grid-cols-4">
                    <Stat label="Sprints completed" value={sprints.filter((s) => s.completed).length} />
                    <Stat label="Open priorities" value={priorities.filter((p) => !p.completed).length} />
                    <Stat label="Reward points" value={`${earnedPoints}/${totalPoints}`} />
                    <Stat label="Goal periods" value={periods.length} />
                </div>

                {/* Active sprint banner */}
                {active && (
                    <Card className="flex flex-wrap items-center justify-between gap-4 ring-brand">
                        <div className="flex flex-col gap-1">
                            <span className="text-sm text-tertiary">Active sprint</span>
                            <span className="text-lg font-semibold text-primary">{active.title}</span>
                            <SprintTimer sprint={active} />
                        </div>
                        <Button color="primary" iconLeading={CheckCircle} onClick={() => { const fd = new FormData(); fd.set("id", active.id); run(finishSprint, fd, "Sprint complete!"); }}>
                            Finish
                        </Button>
                    </Card>
                )}

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {/* Sprints */}
                    <Card>
                        <SectionHeader title="Focus sprints" description="Timed deep-work blocks to get into flow." action={<Button size="sm" iconLeading={Plus} onClick={() => { setEditingSprint(null); setSprintOpen(true); }}>New sprint</Button>} />
                        <div className="mt-4 flex flex-col gap-2">
                            {sprints.length === 0 ? (
                                <EmptyState
                                    icon={Play}
                                    title="Start your first sprint"
                                    description="Pick a duration, hit start, and protect a block of focused time."
                                    actionLabel="Start a sprint"
                                    actionIcon={Play}
                                    onAction={() => { setEditingSprint(null); setSprintOpen(true); }}
                                />
                            ) : sprints.map((s) => (
                                <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-primary">{s.title}</p>
                                        <p className="text-xs text-tertiary">
                                            {s.durationMinutes ? `${s.durationMinutes} min` : "No duration"}
                                            {s.completed ? " · done" : s.startedAt ? " · running" : " · not started"}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {s.completed ? (
                                            <Badge color="success" size="sm">Completed</Badge>
                                        ) : s.startedAt ? (
                                            <Button size="sm" color="secondary" iconLeading={CheckCircle} onClick={() => { const fd = new FormData(); fd.set("id", s.id); run(finishSprint, fd, "Done"); }}>Finish</Button>
                                        ) : (
                                            <Button size="sm" color="secondary" iconLeading={Play} onClick={() => { const fd = new FormData(); fd.set("id", s.id); run(startSprint, fd, "Started"); }}>Start</Button>
                                        )}
                                        <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit" onClick={() => { setEditingSprint(s); setSprintOpen(true); }} />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Delete" onClick={() => delById(deleteSprint, s.id)} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>

                    {/* Reward goals */}
                    <Card>
                        <SectionHeader title="Reward goals" description="Earn points for hitting your goals." action={<Button size="sm" iconLeading={Plus} onClick={() => { setEditingReward(null); setRewardOpen(true); }}>Add reward</Button>} />
                        <div className="mt-4 flex flex-col gap-2">
                            {rewards.length === 0 ? (
                                <EmptyState
                                    icon={Trophy01}
                                    title="Motivate yourself with rewards"
                                    description="Turn milestones into points you can cash in when you hit them."
                                    actionLabel="Add a reward"
                                    onAction={() => { setEditingReward(null); setRewardOpen(true); }}
                                />
                            ) : rewards.map((r) => (
                                <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                                    <button type="button" onClick={() => { const fd = new FormData(); fd.set("id", r.id); run(toggleReward, fd, r.earned ? "Reset" : "Earned!"); }} className="flex min-w-0 items-center gap-2 text-left">
                                        <Star01 className={cx("size-5 shrink-0", r.earned ? "text-warning-primary" : "text-fg-quaternary")} />
                                        <span className={cx("truncate text-sm", r.earned ? "text-tertiary line-through" : "text-primary")}>{r.description}</span>
                                    </button>
                                    <div className="flex items-center gap-1">
                                        <Badge color={r.earned ? "warning" : "gray"} size="sm">{r.points} pts</Badge>
                                        <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit" onClick={() => { setEditingReward(r); setRewardOpen(true); }} />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Delete" onClick={() => delById(deleteReward, r.id)} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>

                {/* Weekly priorities */}
                <Card>
                    <SectionHeader title="Weekly priorities" description="The few things that matter most this week." action={<Button size="sm" iconLeading={Plus} onClick={() => { setEditingPriority(null); setPriorityOpen(true); }}>Add priority</Button>} />
                    <div className="mt-4 flex flex-col gap-5">
                        {weeks.length === 0 ? (
                            <EmptyState
                                icon={Flag05}
                                title="Set this week's priorities"
                                description="Name the handful of outcomes that will make the week a win."
                                actionLabel="Add a priority"
                                onAction={() => { setEditingPriority(null); setPriorityOpen(true); }}
                            />
                        ) : weeks.map(([week, list]) => (
                            <div key={week}>
                                <p className="mb-2 text-xs font-semibold tracking-wide text-tertiary uppercase">Week of {formatDate(week + "T00:00:00")}</p>
                                <ul className="flex flex-col gap-2">
                                    {list.map((p) => (
                                        <li key={p.id} className="flex items-center gap-3 rounded-lg p-2 ring-1 ring-secondary ring-inset">
                                            <button
                                                type="button"
                                                aria-label="Toggle"
                                                onClick={() => { const fd = new FormData(); fd.set("id", p.id); run(togglePriority, fd, p.completed ? "Reopened" : "Done"); }}
                                                className={cx("flex size-5 shrink-0 items-center justify-center rounded-md text-xs ring-1 ring-inset transition", p.completed ? "bg-brand-solid text-white ring-transparent" : "bg-primary ring-primary hover:ring-brand")}
                                            >
                                                {p.completed && "✓"}
                                            </button>
                                            <span className={cx("flex-1 text-sm", p.completed ? "text-tertiary line-through" : "text-primary")}>{p.priorityText}</span>
                                            <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit" onClick={() => { setEditingPriority(p); setPriorityOpen(true); }} />
                                            <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Delete" onClick={() => delById(deletePriority, p.id)} />
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </Card>

                {/* Goal periods */}
                <Card>
                    <SectionHeader title="Goal periods" description="Quarters, sprints, seasons — whatever framing you use." action={<Button size="sm" iconLeading={Target04} onClick={() => { setEditingPeriod(null); setPeriodOpen(true); }}>Add period</Button>} />
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {periods.length === 0 ? (
                            <div className="sm:col-span-2 lg:col-span-3">
                                <EmptyState
                                    icon={Target04}
                                    title="Frame your goals in time"
                                    description="Group your priorities into a quarter, season, or sprint to track progress."
                                    actionLabel="Add a period"
                                    actionIcon={Target04}
                                    onAction={() => { setEditingPeriod(null); setPeriodOpen(true); }}
                                />
                            </div>
                        ) : periods.map((p) => (
                            <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-primary">{p.periodName}</p>
                                    <p className="text-xs text-tertiary">{formatDate(p.startDate + "T00:00:00")} – {formatDate(p.endDate + "T00:00:00")}</p>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button size="sm" color="tertiary" iconLeading={Target04} aria-label="Edit" onClick={() => { setEditingPeriod(p); setPeriodOpen(true); }} />
                                    <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Delete" onClick={() => delById(deletePeriod, p.id)} />
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>

            {/* Modals */}
            <FormModal isOpen={sprintOpen} onOpenChange={setSprintOpen} title={editingSprint ? "Edit focus sprint" : "New focus sprint"}>
                <form key={editingSprint?.id ?? "new"} action={async (fd) => { if (await run(editingSprint ? updateSprint : createSprint, fd, editingSprint ? "Updated" : "Created")) setSprintOpen(false); }} className="flex flex-col gap-4">
                    {editingSprint && <input type="hidden" name="id" value={editingSprint.id} />}
                    <Field label="Title" htmlFor="title"><NativeInput id="title" name="title" defaultValue={editingSprint?.title} required /></Field>
                    <Field label="Duration (minutes)" htmlFor="durationMinutes"><NativeInput id="durationMinutes" name="durationMinutes" type="number" min={1} defaultValue={editingSprint?.durationMinutes ?? 25} /></Field>
                    {!editingSprint && <Checkbox name="start" value="true" defaultSelected label="Start immediately" />}
                    <div className="flex justify-end gap-2 pt-2"><Button color="secondary" type="button" onClick={() => setSprintOpen(false)}>Cancel</Button><Button type="submit">{editingSprint ? "Save" : "Create"}</Button></div>
                </form>
            </FormModal>

            <FormModal isOpen={priorityOpen} onOpenChange={setPriorityOpen} title={editingPriority ? "Edit weekly priority" : "Add weekly priority"}>
                <form key={editingPriority?.id ?? "new"} action={async (fd) => { if (await run(editingPriority ? updatePriority : createPriority, fd, editingPriority ? "Updated" : "Added")) setPriorityOpen(false); }} className="flex flex-col gap-4">
                    {editingPriority && <input type="hidden" name="id" value={editingPriority.id} />}
                    <Field label="Priority" htmlFor="priorityText"><NativeInput id="priorityText" name="priorityText" defaultValue={editingPriority?.priorityText} required /></Field>
                    <FormDateInput name="weekOf" label="Week of" hint="Monday of the target week." defaultValue={editingPriority?.weekOf ?? weekOf} />
                    <div className="flex justify-end gap-2 pt-2"><Button color="secondary" type="button" onClick={() => setPriorityOpen(false)}>Cancel</Button><Button type="submit">{editingPriority ? "Save" : "Add"}</Button></div>
                </form>
            </FormModal>

            <FormModal isOpen={rewardOpen} onOpenChange={setRewardOpen} title={editingReward ? "Edit reward goal" : "Add reward goal"}>
                <form key={editingReward?.id ?? "new"} action={async (fd) => { if (await run(editingReward ? updateReward : createReward, fd, editingReward ? "Updated" : "Added")) setRewardOpen(false); }} className="flex flex-col gap-4">
                    {editingReward && <input type="hidden" name="id" value={editingReward.id} />}
                    <Field label="Description" htmlFor="description"><NativeInput id="description" name="description" defaultValue={editingReward?.description} required /></Field>
                    <Field label="Points" htmlFor="points"><NativeInput id="points" name="points" type="number" min={0} defaultValue={editingReward?.points ?? 10} /></Field>
                    <div className="flex justify-end gap-2 pt-2"><Button color="secondary" type="button" onClick={() => setRewardOpen(false)}>Cancel</Button><Button type="submit">{editingReward ? "Save" : "Add"}</Button></div>
                </form>
            </FormModal>

            <FormModal isOpen={periodOpen} onOpenChange={setPeriodOpen} title={editingPeriod ? "Edit goal period" : "Add goal period"}>
                <form key={editingPeriod?.id ?? "new"} action={async (fd) => { if (await run(editingPeriod ? updatePeriod : createPeriod, fd, editingPeriod ? "Updated" : "Added")) setPeriodOpen(false); }} className="flex flex-col gap-4">
                    {editingPeriod && <input type="hidden" name="id" value={editingPeriod.id} />}
                    <Field label="Name" htmlFor="periodName"><NativeInput id="periodName" name="periodName" defaultValue={editingPeriod?.periodName} placeholder="Q3 2026" required /></Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FormDateInput name="startDate" label="Start" isRequired defaultValue={editingPeriod?.startDate ?? new Date().toISOString().slice(0, 10)} />
                        <FormDateInput name="endDate" label="End" isRequired defaultValue={editingPeriod?.endDate} />
                    </div>
                    <div className="flex justify-end gap-2 pt-2"><Button color="secondary" type="button" onClick={() => setPeriodOpen(false)}>Cancel</Button><Button type="submit">{editingPeriod ? "Save" : "Add"}</Button></div>
                </form>
            </FormModal>
        </div>
    );
}
