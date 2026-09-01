"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CalendarPlus01, ChevronLeft, ChevronRight, Edit01, PlayCircle, SkipForward, Trash01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { createSchedule, deleteSchedule, setScheduleSkipped, startScheduledWorkout, updateSchedule } from "@/lib/actions/workouts-schedule";
import { toDateKey } from "@/lib/workouts";
import { planStatus, STATUS_COLOR, STATUS_LABEL } from "@/lib/workouts-schedule";
import { cx } from "@/utils/cx";
import { Card, EmptyState, Field, NativeInput, NativeSelect, NativeTextarea, SectionHeader } from "../../_components/workouts-ui";
import { ControlledDateInput } from "@/components/base/input/form-date-input";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";

type Plan = {
    id: string;
    date: string; // yyyy-mm-dd
    templateId: string | null;
    templateName: string | null;
    name: string | null;
    notes: string | null;
    workoutId: string | null;
    skipped: boolean;
    hasWorkoutOnDate: boolean;
};

type TemplateOpt = { id: string; name: string };

function weekStrip(anchor: Date): Date[] {
    const monday = new Date(anchor);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(d.getDate() + i);
        return d;
    });
}

export function ScheduleManager({ plans, templates, showHeaderButton }: { plans: Plan[]; templates: TemplateOpt[]; showHeaderButton?: boolean }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [weekOffset, setWeekOffset] = useState(0);
    const [selected, setSelected] = useState<string>(() => toDateKey(new Date()));
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Plan | null>(null);
    const { confirm, dialog } = useConfirm();

    const today = useMemo(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }, []);

    const anchor = useMemo(() => {
        const d = new Date(today);
        d.setDate(d.getDate() + weekOffset * 7);
        return d;
    }, [today, weekOffset]);

    const days = useMemo(() => weekStrip(anchor), [anchor]);
    const plansByDate = useMemo(() => {
        const m = new Map<string, Plan[]>();
        for (const p of plans) {
            const arr = m.get(p.date) ?? [];
            arr.push(p);
            m.set(p.date, arr);
        }
        return m;
    }, [plans]);

    const upcoming = useMemo(
        () => plans.filter((p) => planStatus(p, today) === "upcoming").sort((a, b) => a.date.localeCompare(b.date)),
        [plans, today],
    );
    const recent = useMemo(
        () =>
            plans
                .filter((p) => planStatus(p, today) !== "upcoming")
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 12),
        [plans, today],
    );

    const openNew = (dateKey: string) => {
        setEditing(null);
        setSelected(dateKey);
        setFormOpen(true);
    };
    const openEdit = (p: Plan) => {
        setEditing(p);
        setSelected(p.date);
        setFormOpen(true);
    };

    const onDelete = (id: string) => {
        confirm({
            title: "Delete this plan?",
            destructive: true,
            confirmLabel: "Delete",
            onConfirm: () =>
                startTransition(async () => {
                    await deleteSchedule(id);
                    toast.success("Plan deleted");
                    router.refresh();
                }),
        });
    };
    const onSkip = (p: Plan) =>
        startTransition(async () => {
            await setScheduleSkipped(p.id, !p.skipped);
            toast.success(p.skipped ? "Plan un-skipped" : "Plan skipped");
            router.refresh();
        });
    const onStart = (id: string) =>
        startTransition(async () => {
            try {
                const wid = await startScheduledWorkout(id);
                router.push(`/workouts/session/${wid}`);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to start");
            }
        });

    return (
        <>
            {showHeaderButton && (
                <div className="flex justify-end">
                    <Button size="md" color="primary" iconLeading={CalendarPlus01} onClick={() => openNew(selected)}>
                        Schedule workout
                    </Button>
                </div>
            )}

            {/* Week strip */}
            <Card>
                <div className="flex items-center justify-between gap-2">
                    <SectionHeader title="Plan a workout" description="Pick a day, then add a plan." />
                    <div className="flex items-center gap-1">
                        <ButtonUtility size="sm" color="tertiary" icon={ChevronLeft} tooltip="Previous week" onClick={() => setWeekOffset((w) => w - 1)} />
                        <button type="button" onClick={() => setWeekOffset(0)} className="rounded-md px-2 py-1 text-xs font-medium text-tertiary hover:bg-secondary_hover">
                            This week
                        </button>
                        <ButtonUtility size="sm" color="tertiary" icon={ChevronRight} tooltip="Next week" onClick={() => setWeekOffset((w) => w + 1)} />
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-7 gap-1.5">
                    {days.map((d) => {
                        const key = toDateKey(d);
                        const dayPlans = plansByDate.get(key) ?? [];
                        const isToday = key === toDateKey(today);
                        const isSelected = key === selected;
                        return (
                            <button
                                key={key}
                                type="button"
                                onClick={() => openNew(key)}
                                className={cx(
                                    "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-center transition duration-100 ease-linear",
                                    isSelected ? "border-brand bg-brand-primary_alt" : "border-secondary hover:bg-secondary_hover",
                                )}
                            >
                                <span className="text-[10px] font-semibold tracking-wide text-quaternary uppercase">{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
                                <span className={cx("flex size-7 items-center justify-center rounded-full text-sm font-semibold", isToday ? "bg-brand-solid text-white" : "text-primary")}>
                                    {d.getDate()}
                                </span>
                                <div className="flex min-h-2 gap-0.5">
                                    {dayPlans.slice(0, 3).map((p) => (
                                        <span key={p.id} className={cx("size-1.5 rounded-full", planStatus(p, today) === "done" ? "bg-success-solid" : planStatus(p, today) === "missed" ? "bg-error-solid" : "bg-brand-solid")} />
                                    ))}
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div className="mt-3">
                    <Button size="sm" color="primary" iconLeading={CalendarPlus01} onClick={() => openNew(selected)}>
                        Add plan for {new Date(`${selected}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                    </Button>
                </div>
            </Card>

            {/* Upcoming */}
            <Card>
                <SectionHeader title="Upcoming plans" />
                <div className="mt-4 flex flex-col gap-2">
                    {upcoming.length === 0 ? (
                        <EmptyState
                            icon={CalendarPlus01}
                            title="No upcoming plans"
                            description="Map out your training week so every session is ready to go — and your streak keeps climbing."
                            action={
                                <Button size="md" color="primary" iconLeading={CalendarPlus01} onClick={() => openNew(selected)}>
                                    Schedule a workout
                                </Button>
                            }
                        />
                    ) : (
                        upcoming.map((p) => (
                            <PlanRow key={p.id} plan={p} today={today} pending={pending} onEdit={openEdit} onDelete={onDelete} onSkip={onSkip} onStart={onStart} />
                        ))
                    )}
                </div>
            </Card>

            {/* History */}
            {recent.length > 0 && (
                <Card>
                    <SectionHeader title="Recent plans" />
                    <div className="mt-4 flex flex-col gap-2">
                        {recent.map((p) => (
                            <PlanRow key={p.id} plan={p} today={today} pending={pending} onEdit={openEdit} onDelete={onDelete} onSkip={onSkip} onStart={onStart} />
                        ))}
                    </div>
                </Card>
            )}

            {formOpen && (
                <PlanDialog
                    key={editing?.id ?? "new"}
                    editing={editing}
                    dateKey={selected}
                    templates={templates}
                    pending={pending}
                    onClose={() => setFormOpen(false)}
                    onSubmit={(data) =>
                        startTransition(async () => {
                            try {
                                if (editing) await updateSchedule(editing.id, data);
                                else await createSchedule(data);
                                toast.success(editing ? "Plan updated" : "Plan scheduled");
                                setFormOpen(false);
                                router.refresh();
                            } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Failed to save");
                            }
                        })
                    }
                />
            )}

            {dialog}
        </>
    );
}

function PlanRow({
    plan,
    today,
    pending,
    onEdit,
    onDelete,
    onSkip,
    onStart,
}: {
    plan: Plan;
    today: Date;
    pending: boolean;
    onEdit: (p: Plan) => void;
    onDelete: (id: string) => void;
    onSkip: (p: Plan) => void;
    onStart: (id: string) => void;
}) {
    const status = planStatus(plan, today);
    const date = new Date(`${plan.date}T00:00:00`);
    const title = plan.name || plan.templateName || "Workout";
    const canStart = status === "upcoming" || status === "missed";

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-primary">{title}</p>
                    <Badge color={STATUS_COLOR[status]} size="sm">
                        {STATUS_LABEL[status]}
                    </Badge>
                    {plan.templateName && plan.name && <span className="text-xs text-tertiary">· {plan.templateName}</span>}
                </div>
                <p className="mt-0.5 text-xs text-tertiary">
                    {date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                    {plan.notes ? ` · ${plan.notes}` : ""}
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
                {plan.workoutId ? (
                    <Button size="sm" color="link-color" href={`/workouts/session/${plan.workoutId}`}>
                        View session
                    </Button>
                ) : (
                    canStart && (
                        <Button size="sm" color="secondary" iconLeading={PlayCircle} isDisabled={pending} onClick={() => onStart(plan.id)}>
                            Start
                        </Button>
                    )
                )}
                {!plan.workoutId && (
                    <ButtonUtility size="sm" color="tertiary" icon={SkipForward} tooltip={plan.skipped ? "Un-skip" : "Skip"} isDisabled={pending} onClick={() => onSkip(plan)} />
                )}
                <ButtonUtility size="sm" color="tertiary" icon={Edit01} tooltip="Edit" isDisabled={pending} onClick={() => onEdit(plan)} />
                <ButtonUtility size="sm" color="tertiary" icon={Trash01} tooltip="Delete" isDisabled={pending} onClick={() => onDelete(plan.id)} />
            </div>
        </div>
    );
}

function PlanDialog({
    editing,
    dateKey,
    templates,
    pending,
    onClose,
    onSubmit,
}: {
    editing: Plan | null;
    dateKey: string;
    templates: TemplateOpt[];
    pending: boolean;
    onClose: () => void;
    onSubmit: (data: { dateKey: string; templateId: string | null; name: string | null; notes: string | null }) => void;
}) {
    const [date, setDate] = useState(editing?.date ?? dateKey);
    const [templateId, setTemplateId] = useState(editing?.templateId ?? "");
    const [name, setName] = useState(editing?.name ?? "");
    const [notes, setNotes] = useState(editing?.notes ?? "");

    return (
        <ModalOverlay isOpen onOpenChange={(v) => !v && onClose()}>
            <Modal className="max-w-md">
                <Dialog aria-label={editing ? "Edit plan" : "Schedule a workout"}>
                    <div className="w-full rounded-2xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <h2 className="text-lg font-semibold text-primary">{editing ? "Edit plan" : "Schedule a workout"}</h2>
                        <p className="mt-1 text-sm text-tertiary">Pick a template or just give it a name.</p>
                        <div className="mt-4 flex flex-col gap-4">
                            <ControlledDateInput label="Date" value={date || null} onChange={setDate} />
                            <Field label="Template" hint="Optional — pre-fills exercises when you start it">
                                <NativeSelect value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                                    <option value="">No template</option>
                                    {templates.map((t) => (
                                        <option key={t.id} value={t.id}>
                                            {t.name}
                                        </option>
                                    ))}
                                </NativeSelect>
                            </Field>
                            <Field label="Name" hint="Optional label, e.g. “Push day”">
                                <NativeInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Workout name" />
                            </Field>
                            <Field label="Notes">
                                <NativeTextarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember" />
                            </Field>
                        </div>
                        <div className="mt-6 flex justify-end gap-2">
                            <Button color="secondary" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                color="primary"
                                isLoading={pending}
                                onClick={() => onSubmit({ dateKey: date, templateId: templateId || null, name: name.trim() || null, notes: notes.trim() || null })}
                            >
                                {editing ? "Save" : "Schedule"}
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
