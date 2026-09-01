"use client";

import { useState, useTransition } from "react";
import { CheckDone01, ChevronRight, Plus } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { CheckboxBase } from "@/components/base/checkbox/checkbox";
import { Card, NativeInput } from "@/components/life/life-ui";
import { createTodo, setTodoStatus } from "@/lib/actions/todos";
import { formatTime } from "@/lib/dates";
import { cx } from "@/utils/cx";

type Status = "PLANNED" | "IN_PROGRESS" | "DONE";

export interface TodoRow {
    id: string;
    title: string;
    dueAt: string | null;
    status: Status;
}

/** YYYY-MM-DD for today (UTC day key, matching the per-day model). */
function todayKey(): string {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
}

function timeBadge(dueAt: string): string {
    return formatTime(dueAt);
}

const NEXT: Record<Status, Status> = { PLANNED: "IN_PROGRESS", IN_PROGRESS: "DONE", DONE: "PLANNED" };
const STATUS_LABEL: Record<Status, string> = { PLANNED: "Planned", IN_PROGRESS: "In progress", DONE: "Done" };
const STATUS_COLOR: Record<Status, "gray" | "brand" | "success"> = { PLANNED: "gray", IN_PROGRESS: "brand", DONE: "success" };

export function TodosCard({ todos, openCount }: { todos: TodoRow[]; openCount: number }) {
    const [isPending, startTransition] = useTransition();
    const [busyId, setBusyId] = useState<string | null>(null);
    const [title, setTitle] = useState("");

    function cycle(id: string, status: Status) {
        setBusyId(id);
        startTransition(async () => {
            const fd = new FormData();
            fd.set("id", id);
            fd.set("status", NEXT[status]);
            try {
                await setTodoStatus(fd);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't update task.");
            } finally {
                setBusyId(null);
            }
        });
    }

    function add() {
        const trimmed = title.trim();
        if (!trimmed) return;
        startTransition(async () => {
            const fd = new FormData();
            fd.set("title", trimmed);
            fd.set("cadence", "NONE");
            fd.set("date", todayKey());
            try {
                await createTodo(fd);
                toast.success("Task added.");
                setTitle("");
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't add task.");
            }
        });
    }

    return (
        <Card className="flex h-full flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <CheckDone01 className="size-5 text-brand-secondary" aria-hidden="true" />
                    <h2 className="text-md font-semibold text-primary">To-dos today</h2>
                </div>
                {openCount > 0 && <span className="text-sm font-medium text-tertiary">{openCount} open</span>}
            </div>

            <div id="dashboard-quick-add-todo" className="scroll-mt-24">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        add();
                    }}
                    className="flex items-center gap-2"
                >
                    <NativeInput
                        aria-label="Add a task for today"
                        placeholder="Add a task for today…"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        disabled={isPending}
                    />
                    <Button type="submit" size="md" color="primary" iconLeading={Plus} isDisabled={isPending || !title.trim()} aria-label="Add task" />
                </form>
            </div>

            {todos.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
                    <CheckDone01 className="size-8 text-fg-quaternary" aria-hidden="true" />
                    <p className="text-sm text-tertiary">No open tasks today. Nicely done.</p>
                </div>
            ) : (
                <ul className="flex flex-col gap-1">
                    {todos.map((t) => {
                        const busy = isPending && busyId === t.id;
                        return (
                            <li key={t.id} className="flex items-center gap-3 rounded-lg p-2 transition duration-100 ease-linear hover:bg-secondary_hover">
                                <button
                                    type="button"
                                    aria-label={`Cycle status of ${t.title} (currently ${STATUS_LABEL[t.status]})`}
                                    onClick={() => cycle(t.id, t.status)}
                                    disabled={isPending}
                                    className={cx("shrink-0", busy && "animate-pulse")}
                                >
                                    <CheckboxBase isSelected={t.status === "DONE"} isIndeterminate={t.status === "IN_PROGRESS"} />
                                </button>
                                <span className={cx("min-w-0 flex-1 truncate text-sm font-medium", t.status === "DONE" ? "text-tertiary line-through" : "text-secondary")}>
                                    {t.title}
                                </span>
                                {t.status === "IN_PROGRESS" && (
                                    <Badge size="sm" color={STATUS_COLOR[t.status]}>
                                        {STATUS_LABEL[t.status]}
                                    </Badge>
                                )}
                                {t.dueAt && (
                                    <Badge size="sm" color="gray">
                                        {timeBadge(t.dueAt)}
                                    </Badge>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <Button href="/todos" color="link-color" size="sm" iconTrailing={ChevronRight} className="mt-auto self-start">
                View all to-dos
            </Button>
        </Card>
    );
}
