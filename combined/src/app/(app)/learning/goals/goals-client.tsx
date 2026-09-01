"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Snowflake01, Target04 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { Card, EmptyState, Field, NativeInput, NativeTextarea, ProgressBar, SectionHeader, Stat } from "../_components/learning-ui";
import { FormModal } from "../_components/form-modal";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { formatDate } from "@/lib/dates";
import { createGoal } from "@/lib/actions/learning-goals";
import { countdown, countdownClass } from "./countdown";

export interface GoalRow {
    id: string;
    title: string | null;
    description: string;
    goalType: string | null;
    color: string | null;
    targetDate: string | null;
    completed: boolean;
    streakCount: number;
    freezeTokens: number;
    milestonesTotal: number;
    milestonesDone: number;
}

/** Preset accent swatches offered in the goal form. */
const COLOR_PRESETS = ["#7F56D9", "#2E90FA", "#12B76A", "#F79009", "#F04438", "#EE46BC", "#6172F3", "#475467"];

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

function label(g: GoalRow) {
    return g.title?.trim() || g.description;
}

function GoalCard({ g }: { g: GoalRow }) {
    const cd = countdown(g.targetDate);
    const accent = g.color ?? undefined;
    const allDone = g.milestonesTotal > 0 && g.milestonesDone === g.milestonesTotal;

    return (
        <Link href={`/learning/goals/${g.id}`} className="group block">
            <Card
                className={cx(
                    "flex h-full flex-col gap-3 border-l-4 transition duration-100 ease-linear hover:ring-brand",
                    g.completed && "opacity-70",
                )}
            >
                {/* Accent stripe via inline style (goal's chosen color). */}
                <div className="-mt-5 -mr-5 -ml-5 h-1 rounded-t-xl" style={accent ? { backgroundColor: accent } : undefined} />

                <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 text-md font-semibold text-primary transition duration-100 ease-linear group-hover:text-brand-secondary">
                        {label(g)}
                    </h3>
                    {g.goalType && (
                        <Badge color="gray" size="sm" type="modern">
                            {g.goalType}
                        </Badge>
                    )}
                </div>

                {g.title && g.description && g.description !== g.title && (
                    <p className="line-clamp-2 text-sm text-tertiary">{g.description}</p>
                )}

                {/* Milestone progress */}
                <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs text-tertiary">
                        <span>{g.milestonesTotal ? `${g.milestonesDone}/${g.milestonesTotal} milestones` : "No milestones yet"}</span>
                        {g.milestonesTotal > 0 && <span>{Math.round((g.milestonesDone / g.milestonesTotal) * 100)}%</span>}
                    </div>
                    <ProgressBar value={g.milestonesDone} max={g.milestonesTotal} color={allDone ? "success" : "brand"} />
                </div>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-3 text-xs">
                        <span className="inline-flex items-center gap-1 font-medium text-secondary" title={`${g.streakCount} day streak`}>
                            <span aria-hidden="true">🔥</span>
                            {g.streakCount} day{g.streakCount === 1 ? "" : "s"}
                        </span>
                        {g.freezeTokens > 0 && (
                            <span className="inline-flex items-center gap-1 text-tertiary" title={`${g.freezeTokens} freeze tokens`}>
                                <Snowflake01 aria-hidden="true" className="size-3.5" />
                                {g.freezeTokens}
                            </span>
                        )}
                    </div>
                    {cd && (
                        <span className={cx("text-xs font-medium", g.completed ? "text-success-primary" : countdownClass(cd.tone))}>
                            {g.completed ? "Completed" : cd.label}
                        </span>
                    )}
                </div>
                {g.targetDate && !g.completed && <p className="text-xs text-tertiary">Target {formatDate(g.targetDate)}</p>}
            </Card>
        </Link>
    );
}

export function GoalsClient({ goals }: { goals: GoalRow[] }) {
    const [open, setOpen] = useState(false);
    const [color, setColor] = useState<string>(COLOR_PRESETS[0]);

    const active = goals.filter((g) => !g.completed);
    const completed = goals.filter((g) => g.completed);
    const longestStreak = goals.reduce((m, g) => Math.max(m, g.streakCount), 0);

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Goal-based learning"
                description="Set goals, break them into weekly milestones, gather resources, and keep a daily study streak."
                action={
                    <Button size="md" iconLeading={Plus} onClick={() => { setColor(COLOR_PRESETS[0]); setOpen(true); }}>
                        New goal
                    </Button>
                }
            />

            {goals.length > 0 && (
                <div className="grid grid-cols-3 gap-4">
                    <Stat label="Active goals" value={active.length} />
                    <Stat label="Completed" value={completed.length} />
                    <Stat label="Longest streak" value={longestStreak} sub={longestStreak === 1 ? "day" : "days"} />
                </div>
            )}

            {goals.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={Target04}
                        title="Set your first goal"
                        description="Define what you want to learn, then build a milestone roadmap and track a daily streak toward it."
                        action={
                            <Button size="md" iconLeading={Plus} onClick={() => { setColor(COLOR_PRESETS[0]); setOpen(true); }}>
                                New goal
                            </Button>
                        }
                    />
                </Card>
            ) : (
                <>
                    {active.length > 0 && (
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {active.map((g) => (
                                <GoalCard key={g.id} g={g} />
                            ))}
                        </div>
                    )}

                    {completed.length > 0 && (
                        <div className="flex flex-col gap-3">
                            <h2 className="text-sm font-semibold text-tertiary">Completed</h2>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {completed.map((g) => (
                                    <GoalCard key={g.id} g={g} />
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title="New goal" description="Give your goal a title and an optional target date.">
                <form
                    action={async (fd) => {
                        fd.set("color", color);
                        if (await run(createGoal, fd, "Goal created")) setOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    <Field label="Title" htmlFor="title" required>
                        <NativeInput id="title" name="title" placeholder="e.g. Learn TypeScript" required />
                    </Field>
                    <Field label="Description" htmlFor="description" hint="What does success look like?">
                        <NativeTextarea id="description" name="description" placeholder="Optional detail" />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Type" htmlFor="goalType">
                            <NativeInput id="goalType" name="goalType" placeholder="e.g. skill, certification" />
                        </Field>
                        <FormDateInput name="targetDate" label="Target date" />
                    </div>
                    <Field label="Accent color">
                        <div className="flex flex-wrap gap-2">
                            {COLOR_PRESETS.map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    aria-label={`Use color ${c}`}
                                    onClick={() => setColor(c)}
                                    className={cx(
                                        "size-7 rounded-full ring-1 ring-secondary ring-inset transition duration-100 ease-linear",
                                        color === c && "ring-2 ring-brand ring-offset-2 ring-offset-primary",
                                    )}
                                    style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">Create goal</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
