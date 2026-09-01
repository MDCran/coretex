"use client";

import { useMemo, useState } from "react";
import { Plus, Edit01, Trash02, Flag01, CheckCircle, Target04 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Select } from "@/components/base/select/select";
import { Card, CardBody } from "@/components/jobs/card";
import { TextInput, TextareaInput, DateInput } from "@/components/jobs/fields";
import { FormModal } from "@/app/(app)/health/_components/form-modal";
import { EmptyState, StatusChip } from "@/components/career/career-ui";
import { fmtDate, toDateInput } from "@/lib/jobs/format";
import { createGoal, updateGoal, deleteGoal } from "@/lib/actions/career";

export interface GoalRow {
    id: string;
    title: string;
    description: string | null;
    targetDate: string | null;
    status: string | null;
}

const STATUSES = [
    { value: "active", label: "Active" },
    { value: "completed", label: "Completed" },
    { value: "abandoned", label: "Abandoned" },
];

type FilterKey = "all" | "active" | "completed" | "abandoned";

function daysUntil(iso: string): number {
    const ms = new Date(iso).getTime() - Date.now();
    return Math.ceil(ms / 86_400_000);
}

export function GoalsClient({ goals }: { goals: GoalRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<GoalRow | null>(null);
    const [status, setStatus] = useState<string>("active");
    const [filter, setFilter] = useState<FilterKey>("all");

    const counts = useMemo(() => {
        const active = goals.filter((g) => (g.status ?? "active") === "active").length;
        const completed = goals.filter((g) => g.status === "completed").length;
        return { total: goals.length, active, completed };
    }, [goals]);

    const visible = useMemo(() => {
        const list = filter === "all" ? goals : goals.filter((g) => (g.status ?? "active") === filter);
        // Active first, then by nearest target date.
        return list.slice().sort((a, b) => {
            const aActive = (a.status ?? "active") === "active" ? 0 : 1;
            const bActive = (b.status ?? "active") === "active" ? 0 : 1;
            if (aActive !== bActive) return aActive - bActive;
            const at = a.targetDate ? new Date(a.targetDate).getTime() : Infinity;
            const bt = b.targetDate ? new Date(b.targetDate).getTime() : Infinity;
            return at - bt;
        });
    }, [goals, filter]);

    function openCreate() {
        setEditing(null);
        setStatus("active");
        setOpen(true);
    }
    function openEdit(row: GoalRow) {
        setEditing(row);
        setStatus(row.status ?? "active");
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        try {
            if (editing) await updateGoal(fd);
            else await createGoal(fd);
            toast.success(editing ? "Goal updated" : "Goal added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    async function onDelete(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteGoal(fd);
            toast.success("Goal deleted");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to delete");
        }
    }

    const summaryCards = [
        { label: "Total goals", value: counts.total, icon: Flag01 },
        { label: "Active", value: counts.active, icon: Target04 },
        { label: "Completed", value: counts.completed, icon: CheckCircle },
    ];

    const filters: { key: FilterKey; label: string }[] = [
        { key: "all", label: "All" },
        { key: "active", label: "Active" },
        { key: "completed", label: "Completed" },
        { key: "abandoned", label: "Abandoned" },
    ];

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-primary">Career goals</h2>
                    <p className="text-sm text-tertiary">Set goals with target dates and track progress over time.</p>
                </div>
                <Button iconLeading={Plus} onClick={openCreate}>
                    Add goal
                </Button>
            </div>

            <div className="grid gap-4 grid-cols-3">
                {summaryCards.map((c) => (
                    <Card key={c.label}>
                        <CardBody className="flex items-center justify-between gap-2 p-4">
                            <div className="min-w-0">
                                <p className="text-display-xs font-semibold text-primary">{c.value}</p>
                                <p className="truncate text-xs text-tertiary">{c.label}</p>
                            </div>
                            <c.icon aria-hidden="true" className="size-5 shrink-0 text-fg-quaternary" />
                        </CardBody>
                    </Card>
                ))}
            </div>

            <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
                {filters.map((f) => (
                    <Button key={f.key} size="sm" color={filter === f.key ? "secondary" : "tertiary"} onClick={() => setFilter(f.key)}>
                        {f.label}
                    </Button>
                ))}
            </div>

            {visible.length === 0 ? (
                <Card>
                    {goals.length === 0 ? (
                        <EmptyState
                            icon={Flag01}
                            title="Set your first career goal"
                            action={
                                <Button iconLeading={Plus} onClick={openCreate}>
                                    Add a goal
                                </Button>
                            }
                        >
                            Define where you want to be, give it a target date, and track your progress so every application moves you closer.
                        </EmptyState>
                    ) : (
                        <EmptyState>No goals match this filter.</EmptyState>
                    )}
                </Card>
            ) : (
                <ul className="flex flex-col gap-3">
                    {visible.map((g) => {
                        const days = g.targetDate ? daysUntil(g.targetDate) : null;
                        const overdue = days != null && days < 0 && (g.status ?? "active") === "active";
                        return (
                            <li key={g.id}>
                                <Card className="transition hover:bg-secondary_hover">
                                    <CardBody className="flex items-start justify-between gap-4">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="text-sm font-semibold text-primary">{g.title}</h3>
                                                <StatusChip status={g.status ?? "active"} />
                                            </div>
                                            {g.description && <p className="mt-1 text-sm text-tertiary">{g.description}</p>}
                                            {g.targetDate && (
                                                <p className={overdue ? "mt-2 text-xs font-medium text-error-primary" : "mt-2 text-xs text-tertiary"}>
                                                    Target {fmtDate(g.targetDate)}
                                                    {(g.status ?? "active") === "active" &&
                                                        days != null &&
                                                        (overdue ? ` · ${Math.abs(days)}d overdue` : days === 0 ? " · due today" : ` · ${days}d left`)}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex shrink-0 gap-1">
                                            <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(g)} aria-label="Edit goal" />
                                            <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(g.id)} aria-label="Delete goal" />
                                        </div>
                                    </CardBody>
                                </Card>
                            </li>
                        );
                    })}
                </ul>
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit goal" : "Add goal"}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    {/* Controlled select posts via a hidden input (works in server-action forms). */}
                    <input type="hidden" name="status" value={status} />

                    <TextInput label="Title" name="title" id="title" isRequired defaultValue={editing?.title ?? ""} placeholder="e.g. Get promoted to Senior" />
                    <TextareaInput
                        label="Description"
                        name="description"
                        id="description"
                        rows={3}
                        defaultValue={editing?.description ?? ""}
                        placeholder="What does success look like?"
                    />
                    <div className="grid grid-cols-2 gap-4">
                        <DateInput label="Target date" name="targetDate" id="targetDate" defaultValue={editing?.targetDate ? toDateInput(editing.targetDate) : null} />
                        <Select
                            label="Status"
                            placeholder="Select status"
                            selectedKey={status || null}
                            onSelectionChange={(key) => setStatus(key ? String(key) : "active")}
                            items={STATUSES.map((s) => ({ id: s.value, label: s.label }))}
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
