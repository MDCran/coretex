// @ts-nocheck
import FormDateInput from "@/components/base/input/form-date-input";
import { formatDateShort } from "@/lib/dates";
import { cx } from "@/utils/cx";
import { HelpCircle, ChevronDown, Plus, Moon01, Edit01, Trash02, X } from "@untitledui/icons";
import { formatDate } from "../../personal/personal-ui";
import { ReactNode, useState, useMemo } from "react";
import { Tooltip, TooltipTrigger, Button, Slider } from "react-aria-components";
import { toast } from "sonner";
import { HealthEmptyState } from "../_components/empty-state";
import { FormModal } from "../_components/form-modal";
import { Field, NativeInput, SectionHeader, Card, NativeTextarea } from "../_components/health-ui";
import { TrendPoint, TrendChart } from "../_components/trend-chart";



/** Field label with an inline help tooltip (explains confusing sleep metrics). */
function TipField({ label, htmlFor, tip, children }: { label: string; htmlFor?: string; tip: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
                <label htmlFor={htmlFor} className="text-sm font-medium text-secondary">
                    {label}
                </label>
                <Tooltip title={tip} placement="top">
                    <TooltipTrigger aria-label={`Help: ${label}`}>
                        <HelpCircle className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                    </TooltipTrigger>
                </Tooltip>
            </div>
            {children}
        </div>
    );
}

/** A collapsible form group. */
function Group({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="rounded-lg ring-1 ring-secondary ring-inset">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold text-secondary"
                aria-expanded={open}
            >
                {title}
                <ChevronDown className={cx("size-4 text-fg-quaternary transition", open && "rotate-180")} aria-hidden="true" />
            </button>
            {open && <div className="flex flex-col gap-4 border-t border-secondary p-3">{children}</div>}
        </div>
    );
}

function toTimeInput(iso: string | null) {
    if (!iso) return "";
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(11, 16);
}

/** Labeled add-new interruption row: Time | Duration | Reason (wide) | Notes + add. */
function NewInterruption({ onAdd }: { onAdd: (it: Interruption) => void }) {
    const [time, setTime] = useState("");
    const [duration, setDuration] = useState("");
    const [reason, setReason] = useState("");
    const [notes, setNotes] = useState("");

    const add = () => {
        if (!time && !duration && !reason) return;
        // Encode the HH:mm time against today's date as an ISO string for storage.
        let iso: string | null = null;
        if (time) {
            const d = new Date();
            const [h, m] = time.split(":").map(Number);
            d.setHours(h, m, 0, 0);
            iso = d.toISOString();
        }
        onAdd({ time: iso, durationMinutes: duration ? Number(duration) : null, reason: reason || null, notes: notes || null });
        setTime("");
        setDuration("");
        setReason("");
        setNotes("");
    };

    return (
        <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,6rem)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
            <Field label="Time">
                <NativeInput type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <Field label="Duration (min)">
                <NativeInput type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </Field>
            <Field label="Reason">
                <NativeInput placeholder="e.g. bathroom" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Field label="Notes">
                <NativeInput placeholder="optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Button type="button" size="sm" color="secondary" iconLeading={Plus} aria-label="Add interruption" onClick={add}>
                Add
            </Button>
        </div>
    );
}

export interface Interruption {
    time: string | null;
    durationMinutes: number | null;
    reason: string | null;
    notes: string | null;
}
export interface SleepRow {
    id: string;
    date: string; // YYYY-MM-DD
    bedtime: string | null;
    wakeTime: string | null;
    totalMinutes: number | null;
    sleepQuality: number | null;
    feelRested: number | null;
    sleepLatencyMin: number | null;
    restingHrBpm: number | null;
    hrvMs: number | null;
    notes: string | null;
    interruptions: Interruption[];
}

function fmtDuration(mins: number | null) {
    if (mins == null) return "—";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
}
function toLocalInput(iso: string | null) {
    if (!iso) return "";
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function SleepClient({ entries }: { entries: SleepRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<SleepRow | null>(null);
    const [interruptions, setInterruptions] = useState<Interruption[]>([]);
    const [sleepQuality, setSleepQuality] = useState(7);
    const [feelRested, setFeelRested] = useState(7);

    const durationData: TrendPoint[] = useMemo(
        () =>
            entries
                .slice()
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((e) => ({
                    label: formatDateShort(e.date),
                    hours: e.totalMinutes != null ? Math.round((e.totalMinutes / 60) * 10) / 10 : null,
                    quality: e.sleepQuality,
                })),
        [entries],
    );

    function openCreate() {
        setEditing(null);
        setInterruptions([]);
        setSleepQuality(7);
        setFeelRested(7);
        setOpen(true);
    }
    function openEdit(row: SleepRow) {
        setEditing(row);
        setInterruptions(row.interruptions.map((i) => ({ ...i })));
        setSleepQuality(row.sleepQuality ?? 7);
        setFeelRested(row.feelRested ?? 7);
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        fd.set("interruptions", JSON.stringify(interruptions.filter((i) => i.time || i.reason || i.durationMinutes)));
        try {
            await upsertSleepEntry(fd);
            toast.success("Sleep saved");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    async function onDelete(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteSleepEntry(fd);
            toast.success("Deleted");
        } catch {
            toast.error("Failed to delete");
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader title="Sleep" description="Log nightly sleep, quality and interruptions." action={<Button size="md" iconLeading={Plus} onClick={openCreate}>Log sleep</Button>} />

            <div className="grid gap-6 lg:grid-cols-2">
                <Card className="overflow-hidden">
                    <h3 className="mb-4 text-md font-semibold text-primary">Duration (hours)</h3>
                    <TrendChart data={durationData} series={[{ key: "hours", name: "Hours" }]} type="area" fitDomain emptyLabel="No sleep logged" />
                </Card>
                <Card className="overflow-hidden">
                    <h3 className="mb-4 text-md font-semibold text-primary">Quality (1-10)</h3>
                    <TrendChart data={durationData} series={[{ key: "quality", name: "Quality", color: "var(--color-utility-pink-500)" }]} fitDomain emptyLabel="No sleep logged" />
                </Card>
            </div>

            {entries.length === 0 ? (
                <Card className="p-0">
                    <HealthEmptyState
                        icon={Moon01}
                        title="Log your first night"
                        description="Track duration, quality and what wakes you up. A few nights in, your sleep patterns become clear."
                        actionLabel="Log sleep"
                        onAction={openCreate}
                    />
                </Card>
            ) : (
            <Card className="flex flex-col gap-3">
                <h3 className="text-md font-semibold text-primary">History</h3>
                {entries.map((e) => (
                    <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                        <div className="flex items-center gap-3">
                            <Moon01 className="size-5 text-fg-quaternary" />
                            <div>
                                <p className="text-sm font-semibold text-primary">{formatDate(e.date)}</p>
                                <p className="text-xs text-tertiary">
                                    {fmtDuration(e.totalMinutes)}
                                    {e.sleepQuality != null && ` · quality ${e.sleepQuality}/10`}
                                    {e.feelRested != null && ` · rested ${e.feelRested}/10`}
                                    {e.interruptions.length > 0 && ` · ${e.interruptions.length} interruption(s)`}
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-1">
                            <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(e)} aria-label="Edit" />
                            <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(e.id)} aria-label="Delete" />
                        </div>
                    </div>
                ))}
            </Card>
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit sleep" : "Log sleep"}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}

                    <Group title="Times">
                        <FormDateInput name="date" label="Date" isRequired defaultValue={editing?.date ?? new Date().toISOString().slice(0, 10)} />
                        <div className="grid grid-cols-2 gap-4">
                            <FormDateInput name="bedtime" label="Bedtime" variant="datetime" defaultValue={toLocalInput(editing?.bedtime ?? null)} />
                            <FormDateInput name="wakeTime" label="Wake time" variant="datetime" defaultValue={toLocalInput(editing?.wakeTime ?? null)} />
                        </div>
                    </Group>

                    <Group title="Quality">
                        <input type="hidden" name="sleepQuality" value={sleepQuality} />
                        <input type="hidden" name="feelRested" value={feelRested} />
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <Field label={`Sleep quality: ${sleepQuality}/10`}>
                                <Slider
                                    aria-label="Sleep quality"
                                    minValue={1}
                                    maxValue={10}
                                    value={sleepQuality}
                                    onChange={(v) => setSleepQuality(Array.isArray(v) ? v[0] : v)}
                                    labelPosition="bottom"
                                    formatOptions={{ style: "decimal", maximumFractionDigits: 0 }}
                                    labelFormatter={(v) => `${v}/10`}
                                />
                            </Field>
                            <TipField label={`Feel rested: ${feelRested}/10`} tip="How rested you felt on waking, 1 (exhausted) to 10 (fully refreshed).">
                                <Slider
                                    aria-label="Feel rested"
                                    minValue={1}
                                    maxValue={10}
                                    value={feelRested}
                                    onChange={(v) => setFeelRested(Array.isArray(v) ? v[0] : v)}
                                    labelPosition="bottom"
                                    formatOptions={{ style: "decimal", maximumFractionDigits: 0 }}
                                    labelFormatter={(v) => `${v}/10`}
                                />
                            </TipField>
                            <TipField label="Sleep latency (min)" htmlFor="sleepLatencyMin" tip="Minutes it took you to fall asleep after getting into bed.">
                                <NativeInput id="sleepLatencyMin" name="sleepLatencyMin" type="number" min={0} defaultValue={editing?.sleepLatencyMin ?? ""} />
                            </TipField>
                        </div>
                    </Group>

                    <Group title="Biometrics" defaultOpen={false}>
                        <div className="grid grid-cols-2 gap-4">
                            <TipField label="Resting HR (bpm)" htmlFor="restingHrBpm" tip="Lowest sleeping heart rate (beats per minute), typically from a wearable.">
                                <NativeInput id="restingHrBpm" name="restingHrBpm" type="number" min={0} defaultValue={editing?.restingHrBpm ?? ""} />
                            </TipField>
                            <TipField label="HRV (ms)" htmlFor="hrvMs" tip="Heart-rate variability in milliseconds. Higher is generally better recovery.">
                                <NativeInput id="hrvMs" name="hrvMs" type="number" min={0} defaultValue={editing?.hrvMs ?? ""} />
                            </TipField>
                        </div>
                    </Group>

                    <Group title="Interruptions" defaultOpen={interruptions.length > 0}>
                        {/* Existing interruptions as readable chips. */}
                        {interruptions.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {interruptions.map((it, i) => (
                                    <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary">
                                        {[toTimeInput(it.time), it.durationMinutes != null ? `${it.durationMinutes} min` : null, it.reason || null].filter(Boolean).join(" • ") || "Interruption"}
                                        <button
                                            type="button"
                                            aria-label="Remove interruption"
                                            className="text-fg-quaternary hover:text-error-primary"
                                            onClick={() => setInterruptions((p) => p.filter((_, j) => j !== i))}
                                        >
                                            <X className="size-3.5" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Add-new row: labeled grid (Time | Duration | Reason | Notes). */}
                        <NewInterruption onAdd={(it) => setInterruptions((p) => [...p, it])} />
                    </Group>

                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">Save</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
