// @ts-nocheck


import { Card, EmptyState, Field, NativeInput, ProgressBar, SectionHeader, Stat } from "../_components/financial-ui";
import { FormModal } from "../_components/form-modal";
import { useConfirm } from "../_components/confirm-modal";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { Plus, Flag01, Edit01, Trash02 } from "@untitledui/icons";
import { formatDate } from "../../personal/personal-ui";
import { useState } from "react";
import { Button } from "react-aria-components";
import { toast } from "sonner";
import { formatCurrency } from "../../personal/personal-ui";

export interface GoalRow {
    id: string;
    title: string;
    targetAmount: number | null;
    currentAmount: number;
    targetDate: string | null;
}

export function GoalsClient({ goals }: { goals: GoalRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<GoalRow | null>(null);
    const [contributing, setContributing] = useState<GoalRow | null>(null);
    const { confirm, dialog } = useConfirm();

    const totalSaved = goals.reduce((s, g) => s + g.currentAmount, 0);
    const totalTarget = goals.reduce((s, g) => s + (g.targetAmount ?? 0), 0);

    function openCreate() {
        setEditing(null);
        setOpen(true);
    }
    function openEdit(g: GoalRow) {
        setEditing(g);
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
    async function onContribute(fd: FormData) {
        try {
            await contributeToGoal(fd);
            toast.success("Contribution added");
            setContributing(null);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    function onDelete(id: string) {
        confirm({
            title: "Delete this goal?",
            destructive: true,
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", id);
                try {
                    await deleteGoal(fd);
                    toast.success("Deleted");
                } catch {
                    toast.error("Failed");
                }
            },
        });
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Goals"
                description="Savings targets and progress."
                action={
                    <Button size="md" iconLeading={Plus} onClick={openCreate}>
                        Add goal
                    </Button>
                }
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat label="Total saved" value={formatCurrency(totalSaved)} tone="success" />
                <Stat label="Total target" value={formatCurrency(totalTarget)} />
                <Stat label="Goals" value={goals.length} />
            </div>

            {goals.length === 0 ? (
                <Card className="p-0">
                    <EmptyState
                        icon={Flag01}
                        title="Set your first savings goal"
                        description="Name a target like an emergency fund or a trip, then track contributions and watch your progress climb."
                        action={
                            <Button size="sm" iconLeading={Plus} onClick={openCreate}>
                                Add goal
                            </Button>
                        }
                    />
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {goals.map((g) => {
                        const target = g.targetAmount ?? 0;
                        const pct = target > 0 ? g.currentAmount / target : 0;
                        const done = target > 0 && g.currentAmount >= target;
                        return (
                            <Card key={g.id} className="flex flex-col gap-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="font-semibold text-primary">{g.title}</p>
                                        {g.targetDate && <p className="text-xs text-tertiary">by {formatDate(g.targetDate)}</p>}
                                    </div>
                                    <div className="flex gap-1">
                                        <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(g)} aria-label="Edit" />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(g.id)} aria-label="Delete" />
                                    </div>
                                </div>
                                <div className="flex items-baseline justify-between text-sm">
                                    <span className="font-medium text-primary">{formatCurrency(g.currentAmount)}</span>
                                    <span className="text-tertiary">{target > 0 ? `of ${formatCurrency(target)} (${formatPercent(pct)})` : "no target"}</span>
                                </div>
                                {target > 0 && <ProgressBar value={g.currentAmount} max={target} color={done ? "success" : "brand"} />}
                                {(() => {
                                    if (done) return <p className="text-xs font-medium text-success-primary">Goal reached.</p>;
                                    if (target <= 0 || !g.targetDate) return null;
                                    const remaining = target - g.currentAmount;
                                    const monthsLeft = Math.max(0, (new Date(g.targetDate).getTime() - Date.now()) / (30 * 24 * 60 * 60 * 1000));
                                    if (monthsLeft < 0.1) return <p className="text-xs text-warning-primary">Target date has passed — {formatCurrency(remaining)} to go.</p>;
                                    const perMonth = remaining / monthsLeft;
                                    return (
                                        <p className="text-xs text-tertiary">
                                            Save <span className="font-medium text-primary">{formatCurrency(perMonth)}/mo</span> to reach this by {formatDate(g.targetDate)}.
                                        </p>
                                    );
                                })()}
                                <Button size="sm" color="secondary" iconLeading={Plus} className="self-start" onClick={() => setContributing(g)}>
                                    Add contribution
                                </Button>
                            </Card>
                        );
                    })}
                </div>
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit goal" : "Add goal"}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <Field label="Title" htmlFor="title">
                        <NativeInput id="title" name="title" required defaultValue={editing?.title ?? ""} placeholder="e.g. Emergency fund" />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Target amount" htmlFor="targetAmount">
                            <NativeInput id="targetAmount" name="targetAmount" type="number" step="0.01" defaultValue={editing?.targetAmount ?? ""} />
                        </Field>
                        <Field label="Current amount" htmlFor="currentAmount">
                            <NativeInput id="currentAmount" name="currentAmount" type="number" step="0.01" defaultValue={editing?.currentAmount ?? ""} />
                        </Field>
                    </div>
                    <FormDateInput name="targetDate" label="Target date" defaultValue={editing?.targetDate ? editing.targetDate.slice(0, 10) : ""} />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>

            <FormModal isOpen={!!contributing} onOpenChange={(o) => !o && setContributing(null)} title="Add contribution">
                {contributing && (
                    <form action={onContribute} className="flex flex-col gap-4">
                        <input type="hidden" name="id" value={contributing.id} />
                        <p className="text-sm text-tertiary">
                            {contributing.title} — currently {formatCurrency(contributing.currentAmount)}
                        </p>
                        <Field label="Amount" htmlFor="contribAmount">
                            <NativeInput id="contribAmount" name="amount" type="number" step="0.01" required autoFocus />
                        </Field>
                        <div className="flex justify-end gap-2 pt-2">
                            <Button color="secondary" type="button" onClick={() => setContributing(null)}>
                                Cancel
                            </Button>
                            <Button type="submit">Add</Button>
                        </div>
                    </form>
                )}
            </FormModal>

            {dialog}
        </div>
    );
}
