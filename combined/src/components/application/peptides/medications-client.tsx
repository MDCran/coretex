"use client";

import { useMemo, useState, useTransition } from "react";
import { Beaker02, BarChartSquare02, Calendar, CalendarCheck01, Check, CheckDone01, ChevronLeft, ChevronRight, Plus, SearchLg, SlashCircle01, Trash01, X, Zap } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Badge } from "@/components/base/badges/badges";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { Toggle } from "@/components/base/toggle/toggle";
import { Input } from "@/components/base/input/input";
import { ControlledDateInput } from "@/components/base/input/form-date-input";
import { Tooltip } from "@/components/base/tooltip/tooltip";
import { ProgressBarBase } from "@/components/base/progress-indicators/progress-indicators";
import { formatDate, formatDateTime } from "@/lib/dates";
import { cx } from "@/utils/cx";
import type { AdherenceDay, ScheduleAdherence } from "@/lib/actions/therapeutics";
import * as actions from "@/lib/actions/therapeutics";
import { Card, CardBody, CardHeader, CardTitle } from "./card";
import { EmptyState } from "./empty-state";
import { Field, FieldInput, FieldSelect, NumberInput } from "./field-controls";
import { PeptideModal } from "./peptide-modal";

// Medications UI focuses on meds + supplements (peptide-kind schedules remain
// supported in data, but aren't offered in the kind picker here).
type Kind = "MEDICATION" | "SUPPLEMENT" | "PEPTIDE" | "OTHER";
type Pattern = "DAILY" | "EVERY_N_DAYS" | "WEEKLY_DOW" | "WEEKLY_ONCE";

interface MedSup {
    id: string;
    name: string;
    dosageAmount: number | null;
    dosageUnit: string | null;
    frequency: string | null;
    notes: string | null;
    active: boolean;
}

interface Schedule {
    id: string;
    kind: Kind;
    name: string;
    dosage: string | null;
    notes: string | null;
    pattern: Pattern;
    everyN: number | null;
    daysOfWeek: string[];
    timesOfDay: string[];
    startDate: string | null;
    endDate: string | null;
}

interface Dose {
    id: string;
    scheduleName: string;
    scheduleKind: Kind;
    dosage: string | null;
    scheduledAt: string;
    loggedAt: string | null;
    skippedAt: string | null;
}

interface Log {
    id: string;
    therapeuticKind: Kind;
    name: string | null;
    doseAmount: number | null;
    doseUnit: string | null;
    notes: string | null;
    loggedAt: string;
}

interface DoseHistory {
    id: string;
    scheduleName: string;
    scheduleKind: Kind;
    dosage: string | null;
    scheduledAt: string;
    loggedAt: string | null;
    skippedAt: string | null;
}

interface Props {
    medications: MedSup[];
    supplements: MedSup[];
    schedules: Schedule[];
    doses: Dose[];
    doseHistory30: DoseHistory[];
    logs: Log[];
    adherence: ScheduleAdherence[];
}

const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

// Medications scope: only medication + supplement kinds are offered in the UI.
const KIND_OPTIONS = [
    { value: "MEDICATION", label: "Medication" },
    { value: "SUPPLEMENT", label: "Supplement" },
];

const PATTERN_OPTIONS = [
    { value: "DAILY", label: "Daily" },
    { value: "EVERY_N_DAYS", label: "Every N days" },
    { value: "WEEKLY_DOW", label: "Weekly (days of week)" },
    { value: "WEEKLY_ONCE", label: "Weekly (once)" },
];

export function MedicationsClient({ medications, supplements, schedules, doses, doseHistory30, logs, adherence }: Props) {
    const [, startTransition] = useTransition();
    const run = (fn: () => Promise<void>, ok?: string) =>
        startTransition(async () => {
            try {
                await fn();
                if (ok) toast.success(ok);
            } catch {
                toast.error("Something went wrong.");
            }
        });

    const adherenceById = useMemo(() => new Map(adherence.map((a) => [a.scheduleId, a])), [adherence]);

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                    <h2 className="text-lg font-semibold text-primary">Medications &amp; Supplements</h2>
                    <p className="mt-0.5 text-sm text-tertiary">Quick logging, schedules and adherence at a glance.</p>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <MedLookup medications={medications} supplements={supplements} logs={logs} doseHistory30={doseHistory30} />
                <ThirtyDayReport logs={logs} doseHistory30={doseHistory30} />
            </div>

            <CurrentlyTaking
                medications={medications}
                supplements={supplements}
                schedules={schedules}
                adherenceById={adherenceById}
                onQuickLog={(input) => run(() => actions.createTherapeuticLog(input), "Logged")}
            />

            <TherapeuticCalendar schedules={schedules} adherence={adherence} />

            <QuickLog
                medications={medications}
                supplements={supplements}
                logs={logs}
                onCreate={(input) => run(() => actions.createTherapeuticLog(input), "Logged")}
            />

            <UpcomingDoses
                doses={doses}
                onLog={(id) => run(() => actions.logDose(id), "Logged")}
                onSkip={(id) => run(() => actions.skipDose(id), "Skipped")}
                onReset={(id) => run(() => actions.resetDose(id))}
            />

            <div className="grid gap-6 xl:grid-cols-2">
                <MedSupSection
                    title="Medications"
                    icon={Beaker02}
                    items={medications}
                    onCreate={(input) => run(() => actions.createMedication(input), "Medication added")}
                    onUpdate={(id, input) => run(() => actions.updateMedication(id, input))}
                    onDelete={(id) => run(() => actions.deleteMedication(id), "Deleted")}
                />
                <MedSupSection
                    title="Supplements"
                    icon={Beaker02}
                    items={supplements}
                    onCreate={(input) => run(() => actions.createSupplement(input), "Supplement added")}
                    onUpdate={(id, input) => run(() => actions.updateSupplement(id, input))}
                    onDelete={(id) => run(() => actions.deleteSupplement(id), "Deleted")}
                />
            </div>

            <SchedulesSection
                schedules={schedules}
                adherenceById={adherenceById}
                onCreate={(input) => run(() => actions.createSchedule(input), "Schedule added")}
                onDelete={(id) => run(() => actions.deleteSchedule(id), "Deleted")}
            />

            <RecentLogs logs={logs} onDelete={(id) => run(() => actions.deleteTherapeuticLog(id), "Deleted")} />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Quick log — pick a med/supplement, log it in one click. Recent items as chips.
// ---------------------------------------------------------------------------

function QuickLog({
    medications,
    supplements,
    logs,
    onCreate,
}: {
    medications: MedSup[];
    supplements: MedSup[];
    logs: Log[];
    onCreate: (input: actions.TherapeuticLogInput) => void;
}) {
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<Kind>("MEDICATION");
    const [name, setName] = useState("");
    const [amount, setAmount] = useState(0);
    const [unit, setUnit] = useState("");
    const [notes, setNotes] = useState("");

    // Recent distinct items (by name) for one-click re-logging.
    const recent = useMemo(() => {
        const seen = new Set<string>();
        const out: { name: string; kind: Kind; amount: number | null; unit: string | null }[] = [];
        for (const l of logs) {
            const key = `${l.therapeuticKind}|${l.name ?? ""}`;
            if (!l.name || seen.has(key)) continue;
            seen.add(key);
            out.push({ name: l.name, kind: l.therapeuticKind, amount: l.doseAmount, unit: l.doseUnit });
            if (out.length >= 8) break;
        }
        return out;
    }, [logs]);

    const active = useMemo(
        () => [
            ...medications.filter((m) => m.active).map((m) => ({ ...m, kind: "MEDICATION" as Kind })),
            ...supplements.filter((s) => s.active).map((s) => ({ ...s, kind: "SUPPLEMENT" as Kind })),
        ],
        [medications, supplements],
    );

    const logQuick = (item: { name: string; kind: Kind; amount?: number | null; dosageAmount?: number | null; unit?: string | null; dosageUnit?: string | null }) => {
        onCreate({
            therapeuticKind: item.kind,
            name: item.name,
            doseAmount: item.amount ?? item.dosageAmount ?? null,
            doseUnit: item.unit ?? item.dosageUnit ?? null,
            notes: null,
        });
    };

    const reset = () => {
        setKind("MEDICATION");
        setName("");
        setAmount(0);
        setUnit("");
        setNotes("");
        setOpen(false);
    };

    const submit = () => {
        if (!name.trim()) return;
        onCreate({ therapeuticKind: kind, name: name.trim(), doseAmount: amount || null, doseUnit: unit, notes });
        reset();
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <span className="flex items-center gap-2">
                        <Zap className="size-4 text-brand-secondary" aria-hidden="true" /> Quick log
                    </span>
                </CardTitle>
                <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => setOpen(true)}>
                    Custom log
                </Button>
            </CardHeader>
            <CardBody className="space-y-4">
                {recent.length > 0 && (
                    <div>
                        <p className="mb-1.5 text-xs font-medium text-tertiary">Recent — tap to log again</p>
                        <div className="flex flex-wrap gap-2">
                            {recent.map((r) => (
                                <button
                                    key={`${r.kind}-${r.name}`}
                                    type="button"
                                    onClick={() => logQuick(r)}
                                    className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary ring-1 ring-secondary transition duration-100 ease-linear hover:bg-secondary_hover hover:text-primary"
                                >
                                    <Check className="size-3 text-fg-success-secondary" aria-hidden="true" />
                                    {r.name}
                                    {r.amount != null && <span className="text-tertiary">{r.amount}{r.unit ? ` ${r.unit}` : ""}</span>}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div>
                    <p className="mb-1.5 text-xs font-medium text-tertiary">From your list</p>
                    {active.length === 0 ? (
                        <p className="text-sm text-tertiary italic">Add a medication or supplement below, then log it here in one tap.</p>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {active.map((item) => (
                                <button
                                    key={`${item.kind}-${item.id}`}
                                    type="button"
                                    onClick={() => logQuick(item)}
                                    className="flex items-center gap-1.5 rounded-full bg-brand-primary/5 px-3 py-1.5 text-xs font-medium text-brand-secondary ring-1 ring-brand_alt transition duration-100 ease-linear hover:bg-brand-primary/10"
                                >
                                    <Plus className="size-3" aria-hidden="true" />
                                    {item.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </CardBody>

            <PeptideModal isOpen={open} onOpenChange={(o) => (o ? setOpen(true) : reset())} title="Log a dose" description="Record a medication or supplement you've taken.">
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Kind">
                            <FieldSelect value={kind} onChange={(v) => setKind(v as Kind)} size="md" options={KIND_OPTIONS} aria-label="Log kind" />
                        </Field>
                        <Field label="Name">
                            <FieldInput value={name} onChange={setName} size="md" placeholder="e.g. Ibuprofen" aria-label="Log name" />
                        </Field>
                        <Field label="Amount">
                            <NumberInput value={amount} min={0} size="md" onChange={setAmount} aria-label="Log amount" />
                        </Field>
                        <Field label="Unit">
                            <FieldInput value={unit} onChange={setUnit} size="md" placeholder="mg, IU…" aria-label="Log unit" />
                        </Field>
                    </div>
                    <Input label="Notes" placeholder="optional" value={notes} onChange={setNotes} />
                    <div className="flex justify-end gap-2">
                        <Button color="secondary" onClick={reset}>
                            Cancel
                        </Button>
                        <Button onClick={submit} isDisabled={!name.trim()}>
                            Log dose
                        </Button>
                    </div>
                </div>
            </PeptideModal>
        </Card>
    );
}

// ---------------------------------------------------------------------------

function MedSupSection({
    title,
    icon: Icon,
    items,
    onCreate,
    onUpdate,
    onDelete,
}: {
    title: string;
    icon: typeof Beaker02;
    items: MedSup[];
    onCreate: (input: actions.MedSupInput) => void;
    onUpdate: (id: string, input: Partial<actions.MedSupInput>) => void;
    onDelete: (id: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [amount, setAmount] = useState(0);
    const [unit, setUnit] = useState("");
    const [frequency, setFrequency] = useState("");
    const [notes, setNotes] = useState("");

    const reset = () => {
        setName("");
        setAmount(0);
        setUnit("");
        setFrequency("");
        setNotes("");
        setOpen(false);
    };

    const submit = () => {
        if (!name.trim()) return;
        onCreate({ name: name.trim(), dosageAmount: amount || null, dosageUnit: unit, frequency, notes, active: true });
        reset();
    };

    const singular = title.replace(/s$/, "");

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <span className="flex items-center gap-2">
                        <Icon className="size-4 text-fg-quaternary" aria-hidden="true" /> {title}
                    </span>
                </CardTitle>
                <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => setOpen(true)}>
                    Add
                </Button>
            </CardHeader>
            <CardBody className="space-y-2">
                {items.length === 0 && (
                    <EmptyState
                        icon={Icon}
                        title={`No ${title.toLowerCase()} yet`}
                        description={`Add a ${singular.toLowerCase()} to track its dosage, schedule and adherence over time.`}
                        actionLabel={`Add ${singular.toLowerCase()}`}
                        actionIcon={Plus}
                        onAction={() => setOpen(true)}
                        size="sm"
                    />
                )}

                {items.map((m) => (
                    <div key={m.id} className={cx("flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 ring-1 ring-secondary", !m.active && "opacity-60")}>
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-primary">{m.name}</p>
                            <p className="truncate text-xs text-tertiary">
                                {[m.dosageAmount != null ? `${m.dosageAmount}${m.dosageUnit ? ` ${m.dosageUnit}` : ""}` : null, m.frequency]
                                    .filter(Boolean)
                                    .join(" · ") || "—"}
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <Toggle size="sm" isSelected={m.active} onChange={(v) => onUpdate(m.id, { active: v })} aria-label="Active" />
                            <ButtonUtility size="xs" color="tertiary" icon={Trash01} tooltip="Delete" onClick={() => onDelete(m.id)} />
                        </div>
                    </div>
                ))}
            </CardBody>

            <PeptideModal isOpen={open} onOpenChange={(o) => (o ? setOpen(true) : reset())} title={`Add ${singular.toLowerCase()}`}>
                <div className="flex flex-col gap-4">
                    <Input label="Name" placeholder="e.g. Metformin" value={name} onChange={setName} isRequired />
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Dosage amount">
                            <NumberInput value={amount} min={0} size="md" onChange={setAmount} aria-label="Dosage amount" />
                        </Field>
                        <Field label="Dosage unit">
                            <FieldInput value={unit} onChange={setUnit} size="md" placeholder="mg, IU…" aria-label="Dosage unit" />
                        </Field>
                    </div>
                    <Input label="Frequency" placeholder="e.g. twice daily" value={frequency} onChange={setFrequency} />
                    <Input label="Notes" placeholder="optional" value={notes} onChange={setNotes} />
                    <div className="flex justify-end gap-2">
                        <Button color="secondary" onClick={reset}>
                            Cancel
                        </Button>
                        <Button onClick={submit} isDisabled={!name.trim()}>
                            Save
                        </Button>
                    </div>
                </div>
            </PeptideModal>
        </Card>
    );
}

// ---------------------------------------------------------------------------

function UpcomingDoses({
    doses,
    onLog,
    onSkip,
    onReset,
}: {
    doses: Dose[];
    onLog: (id: string) => void;
    onSkip: (id: string) => void;
    onReset: (id: string) => void;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Upcoming doses — next 7 days</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
                {doses.length === 0 && (
                    <EmptyState
                        icon={CalendarCheck01}
                        title="You're all caught up"
                        description="No scheduled doses in the next 7 days. Add a schedule below and upcoming doses will appear here to take or skip in one tap."
                        size="sm"
                    />
                )}
                {doses.map((d) => {
                    const status = d.loggedAt ? "logged" : d.skippedAt ? "skipped" : "pending";
                    return (
                        <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 ring-1 ring-secondary">
                            <div className="min-w-0">
                                <p className="flex items-center gap-2 truncate text-sm font-medium text-primary">
                                    {d.scheduleName}
                                    {d.dosage && <span className="text-xs font-normal text-tertiary">{d.dosage}</span>}
                                </p>
                                <p className="truncate text-xs text-tertiary">{formatDateTime(d.scheduledAt)}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                {status === "logged" && (
                                    <Badge color="success" size="sm">
                                        Logged
                                    </Badge>
                                )}
                                {status === "skipped" && (
                                    <Badge color="gray" size="sm">
                                        Skipped
                                    </Badge>
                                )}
                                {status === "pending" ? (
                                    <ButtonGroup size="sm" selectedKeys={[]}>
                                        <ButtonGroupItem id={`take-${d.id}`} iconLeading={Check} onClick={() => onLog(d.id)}>
                                            Take
                                        </ButtonGroupItem>
                                        <ButtonGroupItem id={`skip-${d.id}`} iconLeading={SlashCircle01} onClick={() => onSkip(d.id)}>
                                            Skip
                                        </ButtonGroupItem>
                                    </ButtonGroup>
                                ) : (
                                    <ButtonUtility size="xs" color="tertiary" icon={X} tooltip="Reset" onClick={() => onReset(d.id)} />
                                )}
                            </div>
                        </div>
                    );
                })}
            </CardBody>
        </Card>
    );
}

// ---------------------------------------------------------------------------

function SchedulesSection({
    schedules,
    adherenceById,
    onCreate,
    onDelete,
}: {
    schedules: Schedule[];
    adherenceById: Map<string, ScheduleAdherence>;
    onCreate: (input: actions.ScheduleInput) => void;
    onDelete: (id: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<Kind>("MEDICATION");
    const [name, setName] = useState("");
    const [dosage, setDosage] = useState("");
    const [pattern, setPattern] = useState<Pattern>("DAILY");
    const [everyN, setEveryN] = useState(2);
    const [days, setDays] = useState<string[]>([]);
    const [times, setTimes] = useState("09:00");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [notes, setNotes] = useState("");

    const reset = () => {
        setKind("MEDICATION");
        setName("");
        setDosage("");
        setPattern("DAILY");
        setEveryN(2);
        setDays([]);
        setTimes("09:00");
        setStartDate("");
        setEndDate("");
        setNotes("");
        setOpen(false);
    };

    const submit = () => {
        if (!name.trim()) return;
        onCreate({
            kind,
            name: name.trim(),
            dosage,
            notes,
            pattern,
            everyN: pattern === "EVERY_N_DAYS" ? everyN : null,
            daysOfWeek: pattern === "WEEKLY_DOW" ? days : [],
            timesOfDay: times
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            startDate: startDate || null,
            endDate: endDate || null,
        });
        reset();
    };

    const patternLabel = (s: Schedule) => {
        switch (s.pattern) {
            case "DAILY":
                return "Daily";
            case "EVERY_N_DAYS":
                return `Every ${s.everyN ?? "?"} days`;
            case "WEEKLY_DOW":
                return s.daysOfWeek.join(", ") || "Weekly";
            case "WEEKLY_ONCE":
                return "Weekly";
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Schedules &amp; adherence</CardTitle>
                <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => setOpen(true)}>
                    Add schedule
                </Button>
            </CardHeader>
            {/* space-y-2 matches other med sections; each row's AdherencePanel adds its own internal mt-2.5 rhythm. */}
            <CardBody className="space-y-2">
                {schedules.length === 0 && (
                    <EmptyState
                        icon={Calendar}
                        title="Build a dosing schedule"
                        description="Set a pattern once and we'll generate upcoming doses, track adherence and surface your streaks automatically."
                        actionLabel="Add schedule"
                        actionIcon={Plus}
                        onAction={() => setOpen(true)}
                        size="sm"
                    />
                )}

                {schedules.map((s) => (
                    <div key={s.id} className="rounded-lg px-3 py-2.5 ring-1 ring-secondary">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="flex items-center gap-2 truncate text-sm font-medium text-primary">
                                    <Badge color="gray" size="sm">
                                        {s.kind === "MEDICATION" ? "Med" : s.kind === "SUPPLEMENT" ? "Supp" : s.kind}
                                    </Badge>
                                    {s.name}
                                    {s.dosage && <span className="text-xs font-normal text-tertiary">{s.dosage}</span>}
                                </p>
                                <p className="truncate text-xs text-tertiary">
                                    {patternLabel(s)}
                                    {s.timesOfDay.length > 0 ? ` · ${s.timesOfDay.join(", ")}` : ""}
                                </p>
                            </div>
                            <ButtonUtility size="xs" color="tertiary" icon={Trash01} tooltip="Delete schedule" onClick={() => onDelete(s.id)} />
                        </div>
                        <AdherencePanel adherence={adherenceById.get(s.id)} />
                    </div>
                ))}
            </CardBody>

            <PeptideModal isOpen={open} onOpenChange={(o) => (o ? setOpen(true) : reset())} title="Add schedule">
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Kind">
                            <FieldSelect value={kind} onChange={(v) => setKind(v as Kind)} size="md" options={KIND_OPTIONS} aria-label="Kind" />
                        </Field>
                        <Field label="Name">
                            <FieldInput value={name} onChange={setName} size="md" placeholder="e.g. Vitamin D" aria-label="Schedule name" />
                        </Field>
                        <Field label="Dosage">
                            <FieldInput value={dosage} onChange={setDosage} size="md" placeholder="e.g. 2000 IU" aria-label="Dosage" />
                        </Field>
                        <Field label="Pattern">
                            <FieldSelect value={pattern} onChange={(v) => setPattern(v as Pattern)} size="md" options={PATTERN_OPTIONS} aria-label="Pattern" />
                        </Field>
                    </div>

                    {pattern === "EVERY_N_DAYS" && (
                        <Field label="Every N days" className="w-32">
                            <NumberInput value={everyN} min={1} step={1} size="md" onChange={setEveryN} aria-label="Every N days" />
                        </Field>
                    )}

                    {pattern === "WEEKLY_DOW" && (
                        <Field label="Days of week">
                            <div className="flex flex-wrap gap-1.5">
                                {DOW.map((d) => (
                                    <button
                                        key={d}
                                        type="button"
                                        onClick={() => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))}
                                        className={cx(
                                            "rounded-md px-2 py-1 text-xs font-medium ring-1 transition duration-100 ease-linear",
                                            days.includes(d) ? "bg-brand-solid text-white ring-transparent" : "bg-primary text-secondary ring-primary hover:bg-primary_hover",
                                        )}
                                    >
                                        {d}
                                    </button>
                                ))}
                            </div>
                        </Field>
                    )}

                    <div className="grid grid-cols-3 gap-3">
                        <Field label="Times (HH:mm)">
                            <FieldInput value={times} onChange={setTimes} size="md" placeholder="09:00, 21:00" aria-label="Times of day" />
                        </Field>
                        <Field label="Start date">
                            <ControlledDateInput size="md" value={startDate || null} onChange={setStartDate} />
                        </Field>
                        <Field label="End date">
                            <ControlledDateInput size="md" value={endDate || null} onChange={setEndDate} />
                        </Field>
                    </div>
                    <Input label="Notes" placeholder="optional" value={notes} onChange={setNotes} />
                    <div className="flex justify-end gap-2">
                        <Button color="secondary" onClick={reset}>
                            Cancel
                        </Button>
                        <Button onClick={submit} isDisabled={!name.trim()}>
                            Save
                        </Button>
                    </div>
                </div>
            </PeptideModal>
        </Card>
    );
}

const DOT_COLOR: Record<AdherenceDay["status"], string> = {
    taken: "bg-fg-success-secondary",
    skipped: "bg-fg-warning-secondary",
    missed: "bg-fg-error-secondary",
    none: "bg-bg-quaternary",
};

const DOT_LABEL: Record<AdherenceDay["status"], string> = {
    taken: "Taken",
    skipped: "Skipped",
    missed: "Missed",
    none: "No dose",
};

function AdherencePanel({ adherence }: { adherence?: ScheduleAdherence }) {
    if (!adherence) return null;
    const { taken, skipped, missed, rate, streak, days } = adherence;
    const total = taken + skipped + missed;
    const pct = Math.round(rate * 100);

    if (total === 0) {
        return <p className="mt-2.5 border-t border-secondary pt-2.5 text-xs text-tertiary">No doses tracked in the last 30 days yet.</p>;
    }

    return (
        <div className="mt-2.5 flex flex-col gap-2 border-t border-secondary pt-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-3">
                    <span className="text-success-primary">{taken} taken</span>
                    <span className="text-warning-primary">{skipped} skipped</span>
                    <span className="text-error-primary">{missed} missed</span>
                </span>
                <span className="flex items-center gap-2">
                    {streak > 0 && (
                        <Badge color="success" size="sm" type="pill-color">
                            {streak}-day streak
                        </Badge>
                    )}
                    <span className="font-mono font-medium text-secondary tabular-nums">{pct}%</span>
                </span>
            </div>

            <ProgressBarBase
                value={pct}
                className="h-2"
                progressClassName={pct >= 80 ? "bg-fg-success-primary" : pct >= 50 ? "bg-fg-warning-primary" : "bg-fg-error-primary"}
            />

            {/* 30-day calendar strip */}
            <div className="flex flex-wrap gap-0.5" aria-label="Last 30 days adherence">
                {days.map((d) => (
                    <Tooltip key={d.date} title={d.date} description={DOT_LABEL[d.status]} placement="top">
                        <button type="button" className="inline-flex cursor-default" aria-label={`${d.date}: ${DOT_LABEL[d.status]}`}>
                            <span className={cx("size-2.5 rounded-[3px]", DOT_COLOR[d.status])} />
                        </button>
                    </Tooltip>
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Lookup — search any med/supplement and see when you last took it
// ---------------------------------------------------------------------------

function MedLookup({
    medications,
    supplements,
    logs,
    doseHistory30,
}: {
    medications: MedSup[];
    supplements: MedSup[];
    logs: Log[];
    doseHistory30: DoseHistory[];
}) {
    const [query, setQuery] = useState("");
    const catalog = useMemo(
        () => [
            ...medications.map((m) => ({ name: m.name, kind: "MEDICATION" as Kind, active: m.active })),
            ...supplements.map((s) => ({ name: s.name, kind: "SUPPLEMENT" as Kind, active: s.active })),
        ],
        [medications, supplements],
    );

    const lastTaken = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return null;
        let best: { at: string; source: string; dose?: string } | null = null;
        for (const l of logs) {
            if (!l.name?.toLowerCase().includes(q)) continue;
            const at = l.loggedAt;
            if (!best || at > best.at) {
                best = {
                    at,
                    source: "Quick log",
                    dose: l.doseAmount != null ? `${l.doseAmount}${l.doseUnit ? ` ${l.doseUnit}` : ""}` : undefined,
                };
            }
        }
        for (const d of doseHistory30) {
            if (!d.loggedAt || !d.scheduleName.toLowerCase().includes(q)) continue;
            if (!best || d.loggedAt > best.at) {
                best = { at: d.loggedAt, source: "Scheduled dose", dose: d.dosage ?? undefined };
            }
        }
        return best;
    }, [query, logs, doseHistory30]);

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        return catalog.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6);
    }, [query, catalog]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <span className="flex items-center gap-2">
                        <SearchLg className="size-4 text-fg-quaternary" aria-hidden="true" /> Find medication
                    </span>
                </CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
                <Input placeholder="Search by name…" value={query} onChange={setQuery} icon={SearchLg} size="md" aria-label="Search medications" />
                {query.trim() && (
                    <div className="rounded-lg bg-secondary_subtle px-3 py-2.5 ring-1 ring-secondary ring-inset">
                        {lastTaken ? (
                            <p className="text-sm text-secondary">
                                Last taken <span className="font-medium text-primary">{formatDateTime(lastTaken.at)}</span>
                                {lastTaken.dose && <span className="text-tertiary"> · {lastTaken.dose}</span>}
                                <span className="text-tertiary"> · {lastTaken.source}</span>
                            </p>
                        ) : (
                            <p className="text-sm text-tertiary">No recorded doses for &ldquo;{query.trim()}&rdquo; in the last 30 days.</p>
                        )}
                    </div>
                )}
                {matches.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {matches.map((m) => (
                            <button
                                key={`${m.kind}-${m.name}`}
                                type="button"
                                onClick={() => setQuery(m.name)}
                                className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-secondary ring-1 ring-secondary transition duration-100 ease-linear hover:bg-secondary_hover"
                            >
                                {m.name}
                                {!m.active && <span className="text-tertiary"> (inactive)</span>}
                            </button>
                        ))}
                    </div>
                )}
            </CardBody>
        </Card>
    );
}

// ---------------------------------------------------------------------------
// 30-day report — aggregated counts per medication/supplement
// ---------------------------------------------------------------------------

interface ReportRow {
    name: string;
    kind: Kind;
    count: number;
    lastAt: string;
    occurrences: { at: string; label: string }[];
}

function buildThirtyDayReport(logs: Log[], doseHistory30: DoseHistory[]): ReportRow[] {
    const map = new Map<string, ReportRow>();
    const key = (name: string, kind: Kind) => `${kind}|${name}`;

    for (const l of logs) {
        if (!l.name) continue;
        const k = key(l.name, l.therapeuticKind);
        const row = map.get(k) ?? { name: l.name, kind: l.therapeuticKind, count: 0, lastAt: l.loggedAt, occurrences: [] };
        row.count++;
        const dose = l.doseAmount != null ? `${l.doseAmount}${l.doseUnit ? ` ${l.doseUnit}` : ""}` : "logged";
        row.occurrences.push({ at: l.loggedAt, label: `Quick log · ${dose}` });
        if (l.loggedAt > row.lastAt) row.lastAt = l.loggedAt;
        map.set(k, row);
    }

    for (const d of doseHistory30) {
        if (!d.loggedAt) continue;
        const k = key(d.scheduleName, d.scheduleKind);
        const row = map.get(k) ?? { name: d.scheduleName, kind: d.scheduleKind, count: 0, lastAt: d.loggedAt, occurrences: [] };
        row.count++;
        row.occurrences.push({ at: d.loggedAt, label: `Scheduled · ${d.dosage ?? "dose"}` });
        if (d.loggedAt > row.lastAt) row.lastAt = d.loggedAt;
        map.set(k, row);
    }

    return Array.from(map.values())
        .map((r) => ({ ...r, occurrences: r.occurrences.sort((a, b) => b.at.localeCompare(a.at)) }))
        .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

function ThirtyDayReport({ logs, doseHistory30 }: { logs: Log[]; doseHistory30: DoseHistory[] }) {
    const [open, setOpen] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);
    const rows = useMemo(() => buildThirtyDayReport(logs, doseHistory30), [logs, doseHistory30]);
    const total = rows.reduce((s, r) => s + r.count, 0);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Last 30 days</CardTitle>
                <Button size="sm" color="secondary" onClick={() => setOpen(true)}>
                    View report
                </Button>
            </CardHeader>
            <CardBody>
                {rows.length === 0 ? (
                    <p className="text-sm text-tertiary italic">No doses logged in the last 30 days.</p>
                ) : (
                    <div className="space-y-2">
                        {rows.slice(0, 5).map((r) => (
                            <div key={`${r.kind}-${r.name}`} className="flex items-center justify-between gap-2 text-sm">
                                <span className="truncate font-medium text-primary">{r.name}</span>
                                <Badge color="brand" size="sm">
                                    {r.count}×
                                </Badge>
                            </div>
                        ))}
                        {rows.length > 5 && <p className="text-xs text-tertiary">+{rows.length - 5} more in full report</p>}
                    </div>
                )}
            </CardBody>

            <PeptideModal isOpen={open} onOpenChange={setOpen} title="30-day medication report" description={`${total} doses across ${rows.length} items`} className="max-w-lg">
                <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
                    {rows.map((r) => {
                        const id = `${r.kind}-${r.name}`;
                        const isOpen = expanded === id;
                        return (
                            <div key={id} className="rounded-lg ring-1 ring-secondary ring-inset">
                                <button
                                    type="button"
                                    onClick={() => setExpanded(isOpen ? null : id)}
                                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                                >
                                    <span className="flex min-w-0 items-center gap-2">
                                        <Badge color="gray" size="sm">
                                            {r.kind === "MEDICATION" ? "Med" : r.kind === "SUPPLEMENT" ? "Supp" : r.kind}
                                        </Badge>
                                        <span className="truncate text-sm font-medium text-primary">{r.name}</span>
                                    </span>
                                    <span className="shrink-0 text-xs text-tertiary">
                                        {r.count}× · last {formatDate(r.lastAt)}
                                    </span>
                                </button>
                                {isOpen && (
                                    <ul className="border-t border-secondary px-3 py-2.5 text-xs text-tertiary">
                                        {r.occurrences.map((o, i) => (
                                            <li key={i} className="flex justify-between gap-2 py-1">
                                                <span>{o.label}</span>
                                                <span className="shrink-0 font-mono tabular-nums">{formatDateTime(o.at)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        );
                    })}
                </div>
            </PeptideModal>
        </Card>
    );
}

// ---------------------------------------------------------------------------
// Currently taking — active catalog + one-tap log + adherence sparkline
// ---------------------------------------------------------------------------

function CurrentlyTaking({
    medications,
    supplements,
    schedules,
    adherenceById,
    onQuickLog,
}: {
    medications: MedSup[];
    supplements: MedSup[];
    schedules: Schedule[];
    adherenceById: Map<string, ScheduleAdherence>;
    onQuickLog: (input: actions.TherapeuticLogInput) => void;
}) {
    const active = useMemo(
        () => [
            ...medications.filter((m) => m.active).map((m) => ({ ...m, kind: "MEDICATION" as Kind })),
            ...supplements.filter((s) => s.active).map((s) => ({ ...s, kind: "SUPPLEMENT" as Kind })),
        ],
        [medications, supplements],
    );

    const scheduleFor = (name: string) => schedules.find((s) => s.name.toLowerCase() === name.toLowerCase());

    return (
        <Card>
            <CardHeader>
                <CardTitle>Currently taking</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
                {active.length === 0 && (
                    <EmptyState
                        icon={CheckDone01}
                        title="Nothing active right now"
                        description="Add a medication or supplement and switch it on — it'll show here for one-tap Took it / Skipped logging with live adherence."
                        size="sm"
                    />
                )}
                {active.map((item) => {
                    const sched = scheduleFor(item.name);
                    const adh = sched ? adherenceById.get(sched.id) : undefined;
                    const pct = adh ? Math.round(adh.rate * 100) : null;
                    return (
                        <div key={`${item.kind}-${item.id}`} className="flex flex-col gap-2 rounded-lg px-3 py-2.5 ring-1 ring-secondary sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <p className="flex items-center gap-2 truncate text-sm font-medium text-primary">
                                    <Badge color={item.kind === "MEDICATION" ? "sky" : "purple"} size="sm">
                                        {item.kind === "MEDICATION" ? "Med" : "Supp"}
                                    </Badge>
                                    {item.name}
                                </p>
                                <p className="truncate text-xs text-tertiary">
                                    {[item.dosageAmount != null ? `${item.dosageAmount}${item.dosageUnit ? ` ${item.dosageUnit}` : ""}` : null, item.frequency, sched ? "On schedule" : "Ad-hoc only"]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </p>
                                {adh && pct != null && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <ProgressBarBase value={pct} className="h-1.5 flex-1" progressClassName={pct >= 80 ? "bg-fg-success-primary" : pct >= 50 ? "bg-fg-warning-primary" : "bg-fg-error-primary"} />
                                        <span className="text-xs font-mono text-tertiary tabular-nums">{pct}%</span>
                                    </div>
                                )}
                            </div>
                            <div className="flex shrink-0 gap-2">
                                <Button
                                    size="sm"
                                    color="primary"
                                    iconLeading={Check}
                                    onClick={() =>
                                        onQuickLog({
                                            therapeuticKind: item.kind,
                                            name: item.name,
                                            doseAmount: item.dosageAmount,
                                            doseUnit: item.dosageUnit,
                                            notes: null,
                                        })
                                    }
                                >
                                    Took it
                                </Button>
                                <Button
                                    size="sm"
                                    color="secondary"
                                    iconLeading={SlashCircle01}
                                    onClick={() =>
                                        onQuickLog({
                                            therapeuticKind: item.kind,
                                            name: item.name,
                                            doseAmount: null,
                                            doseUnit: null,
                                            notes: "Did not take",
                                        })
                                    }
                                >
                                    Skipped
                                </Button>
                            </div>
                        </div>
                    );
                })}
            </CardBody>
        </Card>
    );
}

// ---------------------------------------------------------------------------
// Calendar — month view of adherence across all schedules
// ---------------------------------------------------------------------------

function TherapeuticCalendar({ schedules, adherence }: { schedules: Schedule[]; adherence: ScheduleAdherence[] }) {
    const [cursor, setCursor] = useState(() => new Date().toISOString().slice(0, 10));
    const monthStart = useMemo(() => {
        const d = new Date(cursor + "T12:00:00");
        return new Date(d.getFullYear(), d.getMonth(), 1);
    }, [cursor]);

    const label = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const today = new Date().toISOString().slice(0, 10);

    const dayStatus = useMemo(() => {
        const map = new Map<string, AdherenceDay["status"]>();
        const rank: Record<AdherenceDay["status"], number> = { missed: 4, skipped: 3, taken: 2, none: 1 };
        for (const a of adherence) {
            for (const d of a.days) {
                const prev = map.get(d.date);
                if (!prev || rank[d.status] > rank[prev]) map.set(d.date, d.status);
            }
        }
        return map;
    }, [adherence]);

    const cells = useMemo(() => {
        const start = new Date(monthStart);
        const startDow = start.getDay();
        const gridStart = new Date(start);
        gridStart.setDate(start.getDate() - startDow);
        return Array.from({ length: 42 }, (_, i) => {
            const d = new Date(gridStart);
            d.setDate(gridStart.getDate() + i);
            const iso = d.toISOString().slice(0, 10);
            return { iso, inMonth: d.getMonth() === monthStart.getMonth(), status: dayStatus.get(iso) ?? "none" };
        });
    }, [monthStart, dayStatus]);

    const stepMonth = (dir: number) => {
        const d = new Date(cursor + "T12:00:00");
        d.setMonth(d.getMonth() + dir);
        setCursor(d.toISOString().slice(0, 10));
    };

    if (schedules.length === 0) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <span className="flex items-center gap-2">
                        <Calendar className="size-4 text-fg-quaternary" aria-hidden="true" /> Adherence calendar
                    </span>
                </CardTitle>
                <div className="flex items-center gap-2">
                    <Button size="sm" color="secondary" iconLeading={ChevronLeft} onClick={() => stepMonth(-1)} aria-label="Previous month" />
                    <span className="text-sm font-medium text-secondary">{label}</span>
                    <Button size="sm" color="secondary" iconLeading={ChevronRight} onClick={() => stepMonth(1)} aria-label="Next month" />
                </div>
            </CardHeader>
            <CardBody>
                <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] font-medium tracking-wide text-tertiary uppercase">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                        <span key={d}>{d}</span>
                    ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {cells.map(({ iso, inMonth, status }) => (
                        <Tooltip key={iso} title={iso} description={DOT_LABEL[status]} placement="top">
                            <div
                                className={cx(
                                    "flex min-h-10 flex-col items-center justify-center rounded-md p-1 text-center ring-1 ring-secondary",
                                    !inMonth && "opacity-40",
                                    iso === today && "ring-2 ring-brand",
                                )}
                            >
                                <span className="text-[11px] font-mono text-secondary tabular-nums">{Number(iso.slice(8))}</span>
                                <span className={cx("mt-0.5 size-2 rounded-full", DOT_COLOR[status])} />
                            </div>
                        </Tooltip>
                    ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-tertiary">
                    {schedules.slice(0, 4).map((s) => (
                        <span key={s.id}>{s.name}</span>
                    ))}
                    {schedules.length > 4 && <span>+{schedules.length - 4} schedules</span>}
                </div>
            </CardBody>
        </Card>
    );
}

function RecentLogs({ logs, onDelete }: { logs: Log[]; onDelete: (id: string) => void }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Recent logs</CardTitle>
            </CardHeader>
            <CardBody>
                {logs.length === 0 ? (
                    <EmptyState
                        icon={CheckDone01}
                        title="No doses logged yet"
                        description="Every dose you log from Quick log or Currently taking lands here, so you always have a clear record of what you took and when."
                        size="sm"
                    />
                ) : (
                    <div className="overflow-x-auto rounded-lg ring-1 ring-secondary ring-inset">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-secondary text-left text-xs font-semibold tracking-wider text-tertiary uppercase">
                                    <th className="px-3 py-2.5">When</th>
                                    <th className="px-3 py-2.5">Kind</th>
                                    <th className="px-3 py-2.5">Name</th>
                                    <th className="px-3 py-2.5 text-right">Dose</th>
                                    <th className="px-3 py-2.5">Notes</th>
                                    <th className="px-3 py-2.5" />
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((l) => (
                                    <tr key={l.id} className="border-b border-secondary last:border-0">
                                        <td className="px-3 py-2.5 text-xs text-tertiary">{formatDateTime(l.loggedAt)}</td>
                                        <td className="px-3 py-2.5">
                                            <Badge color="gray" size="sm">
                                                {l.therapeuticKind === "MEDICATION" ? "Med" : l.therapeuticKind === "SUPPLEMENT" ? "Supp" : l.therapeuticKind}
                                            </Badge>
                                        </td>
                                        <td className="px-3 py-2.5 text-secondary">{l.name ?? "—"}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-secondary tabular-nums">
                                            {l.doseAmount != null ? `${l.doseAmount}${l.doseUnit ? ` ${l.doseUnit}` : ""}` : "—"}
                                        </td>
                                        <td className="px-3 py-2.5 text-tertiary">{l.notes ?? ""}</td>
                                        <td className="px-3 py-2.5 text-right">
                                            <ButtonUtility size="xs" color="tertiary" icon={X} tooltip="Delete log" onClick={() => onDelete(l.id)} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardBody>
        </Card>
    );
}
