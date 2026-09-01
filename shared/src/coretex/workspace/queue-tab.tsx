// @ts-nocheck
"use client";

// Coretex Relay — Project-scoped execution Queue tab.
// A LINEAR run-order view (distinct from the Kanban state columns): it shows the
// project's still-runnable tasks sorted exactly the way the Brain will pull them —
// priority weight DESC, then createdAt ASC (FIFO). Each row exposes the dependency
// readiness plus inline "Bump"/"Cancel" controls.

import { useMemo } from "react";
import { ArrowRight, Trash01 } from "@untitledui/icons";
import type { Project, Task, TaskPriority } from "@repo/coretex/types";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { priorityColor, roleColor } from "../use-coretex";
import { roleLabel, statusLabel, titleCase } from "../labels";

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
};

// Bump ladder: low -> medium -> high -> critical (saturates at critical).
const PRIORITY_LADDER: TaskPriority[] = ["low", "medium", "high", "critical"];

function nextPriority(priority: TaskPriority): TaskPriority {
    const idx = PRIORITY_LADDER.indexOf(priority);
    if (idx === -1 || idx >= PRIORITY_LADDER.length - 1) return priority;
    return PRIORITY_LADDER[idx + 1] as TaskPriority;
}

const RUNNABLE: ReadonlySet<string> = new Set(["pending", "in_progress"]);

export const QueueTab = ({
    project,
    state,
    actions,
}: {
    project: Project;
    state: CoretexState;
    actions: CoretexActions;
}) => {
    // Completed-task lookup, used to resolve dependency readiness per row.
    const completedIds = useMemo<Set<string>>(() => {
        const set = new Set<string>();
        for (const t of state.tasks) {
            if (t.status === "completed") set.add(t.id);
        }
        return set;
    }, [state.tasks]);

    // This project's runnable tasks, ordered the way the Brain executes them:
    // priority weight DESC, then createdAt ASC (FIFO) as the stable tiebreak.
    const queue = useMemo<Task[]>(() => {
        return state.tasks
            .filter((t: Task) => t.projectId === project.id && RUNNABLE.has(t.status))
            .slice()
            .sort((a: Task, b: Task) => {
                const pw = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
                if (pw !== 0) return pw;
                return a.createdAt.localeCompare(b.createdAt);
            });
    }, [state.tasks, project.id]);

    // The "Next up" badge belongs to the first PENDING task in run order
    // (an already-running task is not the one the Brain will pick up next).
    const nextUpId = useMemo<string | undefined>(
        () => queue.find((t: Task) => t.status === "pending")?.id,
        [queue],
    );

    return (
        <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h2 className="text-sm font-semibold text-primary">Execution queue</h2>
                <p className="text-xs text-tertiary">Order the Brain will execute — priority, then FIFO.</p>
            </div>

            {queue.length === 0 ? (
                <div
                    className="rounded-xl p-5 text-sm text-tertiary"
                    style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                >
                    Queue is empty.
                </div>
            ) : (
                <ol className="flex flex-col gap-3">
                    {queue.map((task: Task, index: number) => {
                        const deps: string[] = task.dependencies ?? [];
                        const pendingDeps = deps.filter((id: string) => !completedIds.has(id)).length;
                        const isRunning = task.status === "in_progress";
                        const isNextUp = task.id === nextUpId;
                        const canBump = nextPriority(task.priority) !== task.priority;

                        return (
                            <li
                                key={task.id}
                                className="flex flex-col gap-3 rounded-xl p-4"
                                style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                            >
                                <div className="flex items-start gap-3">
                                    {/* Run-order number */}
                                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold text-secondary tabular-nums">
                                        {index + 1}
                                    </span>

                                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="truncate text-sm font-medium text-primary">{task.title}</span>
                                            {isNextUp ? (
                                                <BadgeWithDot type="pill-color" size="sm" color="brand">
                                                    Next up
                                                </BadgeWithDot>
                                            ) : null}
                                            {isRunning ? (
                                                <BadgeWithDot type="pill-color" size="sm" color="success">
                                                    Running
                                                </BadgeWithDot>
                                            ) : null}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge type="color" size="sm" color={priorityColor(task.priority, state.settings)}>
                                                {titleCase(task.priority)}
                                            </Badge>
                                            <Badge type="color" size="sm" color="gray">
                                                {statusLabel(task.status)}
                                            </Badge>
                                            {task.requiredRole ? (
                                                <Badge type="color" size="sm" color={roleColor(task.requiredRole, state.settings)}>
                                                    {roleLabel(task.requiredRole)}
                                                </Badge>
                                            ) : null}
                                            {deps.length > 0 ? (
                                                <Badge
                                                    type="pill-color"
                                                    size="sm"
                                                    color={pendingDeps > 0 ? "warning" : "success"}
                                                >
                                                    {pendingDeps > 0 ? `Waiting on ${pendingDeps}` : "Deps ready"}
                                                </Badge>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-end gap-1">
                                    <Button
                                        size="sm"
                                        color="link-gray"
                                        iconLeading={ArrowRight}
                                        isDisabled={!canBump}
                                        onClick={() => actions.reprioritizeTask(task.id, nextPriority(task.priority))}
                                    >
                                        Bump
                                    </Button>
                                    <Button
                                        size="sm"
                                        color="link-destructive"
                                        iconLeading={Trash01}
                                        onClick={() => actions.cancelTask(task.id)}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
};
