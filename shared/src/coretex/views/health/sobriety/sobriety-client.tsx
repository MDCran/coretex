// @ts-nocheck
import { Badge } from "@/components/base/badges/badges";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import FormDateInput from "@/components/base/input/form-date-input";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { formatDateTime } from "@/coretex/use-coretex";
import { ChevronUp, ChevronDown, Trash02, Settings01, RefreshCcw01, Plus, Heart, Edit01, Archive, Trophy01, BarChart03 } from "@untitledui/icons";
import { useMemo, useState, useEffect } from "react";
import { ProgressBar, Button, Input, TextArea } from "react-aria-components";
import { toast } from "sonner";
import { FormModal } from "../_components/form-modal";
import { SectionHeader, Card, Field, NativeInput, NativeSelect, NativeTextarea } from "../_components/health-ui";
import { TrendPoint, TrendChart } from "../_components/trend-chart";



export interface RelapseRow {
    id: string;
    relapsedAt: string;
    notes: string | null;
}
export interface CounterRow {
    id: string;
    name: string;
    description: string | null;
    color: string | null;
    icon: string | null;
    startedAt: string;
    archived: boolean;
    createdAt: string;
    bestStreakMs: number;
    relapses: RelapseRow[];
}
export interface SubstanceRow {
    id: string;
    substanceType: string;
    amount: number | null;
    unit: string | null;
    loggedAt: string;
    notes: string | null;
}
export interface CustomType {
    id: string;
    name: string;
}

const PRESETS = ["Alcohol", "Drugs", "Nicotine", "Weed", "Masturbation", "Porn", "Gambling", "Sugar"];

const BUILTIN = [
    { value: "alcohol", label: "Alcohol", unit: "drinks" },
    { value: "caffeine", label: "Caffeine", unit: "mg" },
    { value: "nicotine", label: "Nicotine", unit: "mg" },
    { value: "marijuana", label: "Marijuana", unit: "g" },
];

const MILESTONES = [7, 30, 90, 180, 365];
const DAY_MS = 86_400_000;
const THIRTY_DAYS_MS = 30 * DAY_MS;

function toLocalInput(iso: string) {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fmtDuration(ms: number) {
    const totalDays = Math.floor(ms / DAY_MS);
    return `${totalDays} day${totalDays === 1 ? "" : "s"}`;
}

function fmtAmount(l: SubstanceRow) {
    return l.amount != null ? `${l.amount}${l.unit ? ` ${l.unit}` : ""}` : null;
}

/** Pretty label for a stored substanceType value (handles legacy `custom:` and builtin keys). */
function typeLabel(t: string) {
    if (t.startsWith("custom:")) return t.slice(7);
    return BUILTIN.find((b) => b.value === t)?.label ?? t;
}

/** Build a 7-day bar series of use counts for the given logs. */
function weeklySeries(logs: SubstanceRow[]): TrendPoint[] {
    const days: TrendPoint[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const count = logs.filter((l) => l.loggedAt.slice(0, 10) === key).length;
        days.push({ label: d.toLocaleDateString(undefined, { weekday: "short" }), entries: count });
    }
    return days;
}

/** Live, ticking streak readout: "X days" + HH:MM:SS since start. */
function LiveStreak({ startedAt }: { startedAt: string }) {
    const start = useMemo(() => new Date(startedAt).getTime(), [startedAt]);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const elapsed = Math.max(0, now - start);
    const days = Math.floor(elapsed / DAY_MS);
    const rem = elapsed - days * DAY_MS;
    const hh = Math.floor(rem / 3_600_000);
    const mm = Math.floor((rem % 3_600_000) / 60_000);
    const ss = Math.floor((rem % 60_000) / 1000);
    const pad = (n: number) => String(n).padStart(2, "0");

    return (
        <div className="flex flex-col gap-1">
            <p className="text-display-sm font-semibold text-primary">
                {days} <span className="text-lg font-medium text-tertiary">day{days === 1 ? "" : "s"}</span>
            </p>
            <p className="font-mono text-sm tabular-nums text-tertiary">
                {pad(hh)}:{pad(mm)}:{pad(ss)}
            </p>
        </div>
    );
}

function Milestones({ startedAt }: { startedAt: string }) {
    const days = Math.floor((Date.now() - new Date(startedAt).getTime()) / DAY_MS);
    const next = MILESTONES.find((m) => days < m);
    const prev = next ? MILESTONES.filter((m) => m < next).pop() ?? 0 : MILESTONES[MILESTONES.length - 1];

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
                {MILESTONES.map((m) => {
                    const achieved = days >= m;
                    return (
                        <Badge key={m} size="sm" color={achieved ? "success" : "gray"} type={achieved ? "pill-color" : "modern"}>
                            {m}d
                        </Badge>
                    );
                })}
            </div>
            {next != null ? (
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs text-tertiary">
                        <span>Next: {next} days</span>
                        <span>{Math.max(0, next - days)} to go</span>
                    </div>
                    <ProgressBar value={days - prev} max={next - prev} color="success" />
                </div>
            ) : (
                <p className="text-xs font-medium text-success-primary">All milestones reached. Incredible work.</p>
            )}
        </div>
    );
}

/**
 * Per-counter expandable history: the slip/use list for the last 30 days plus a
 * weekly use-count chart. Uses are matched to this counter by name.
 */
function CounterHistory({ counterName, logs, onDeleteLog }: { counterName: string; logs: SubstanceRow[]; onDeleteLog: (id: string) => void }) {
    const [open, setOpen] = useState(false);

    const recent = useMemo(() => {
        const cutoff = Date.now() - THIRTY_DAYS_MS;
        return logs
            .filter((l) => l.substanceType.toLowerCase() === counterName.toLowerCase())
            .filter((l) => new Date(l.loggedAt).getTime() >= cutoff);
    }, [logs, counterName]);

    const weekly = useMemo(
        () => weeklySeries(logs.filter((l) => l.substanceType.toLowerCase() === counterName.toLowerCase())),
        [logs, counterName],
    );

    return (
        <div className="flex flex-col gap-2">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-max items-center gap-1 text-xs font-semibold text-secondary transition duration-100 ease-linear hover:text-secondary_hover"
            >
                History — {recent.length} use{recent.length === 1 ? "" : "s"} in 30 days
                {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
            {open && (
                <div className="flex flex-col gap-4 border-l border-secondary pl-3">
                    <TrendChart data={weekly} series={[{ key: "entries", name: "Uses" }]} type="bar" height={140} emptyLabel="No uses logged" />
                    {recent.length === 0 ? (
                        <p className="text-xs text-tertiary">No uses logged in the last 30 days.</p>
                    ) : (
                        <ol className="flex flex-col gap-2">
                            {recent.map((l) => (
                                <li key={l.id} className="flex items-start justify-between gap-2">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-xs font-medium text-secondary">
                                            {formatDateTime(l.loggedAt)}
                                            {fmtAmount(l) && <span className="text-tertiary"> · {fmtAmount(l)}</span>}
                                        </span>
                                        {l.notes && <span className="text-xs text-tertiary">{l.notes}</span>}
                                    </div>
                                    <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDeleteLog(l.id)} aria-label="Delete use" />
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            )}
        </div>
    );
}

export function SobrietyClient({ counters, substanceLogs, customTypes }: { counters: CounterRow[]; substanceLogs: SubstanceRow[]; customTypes: CustomType[] }) {
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<CounterRow | null>(null);
    const [nameValue, setNameValue] = useState("");
    const [relapseFor, setRelapseFor] = useState<CounterRow | null>(null);
    const [useOpen, setUseOpen] = useState(false);
    const [manageOpen, setManageOpen] = useState(false);
    const [useType, setUseType] = useState("");

    const active = counters.filter((c) => !c.archived);
    const archived = counters.filter((c) => c.archived);

    // Type options for the "Log use" picker: active counters first, then custom
    // types, then built-ins (deduped, case-insensitive on the displayed label).
    const useTypeOptions = useMemo(() => {
        const opts: { value: string; label: string; unit: string }[] = [];
        const seen = new Set<string>();
        const add = (value: string, label: string, unit: string) => {
            const key = label.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            opts.push({ value, label, unit });
        };
        active.forEach((c) => add(c.name, c.name, ""));
        customTypes.forEach((c) => add(c.name, c.name, ""));
        BUILTIN.forEach((b) => add(b.label, b.label, b.unit));
        return opts;
    }, [active, customTypes]);

    const combinedWeekly = useMemo(() => weeklySeries(substanceLogs), [substanceLogs]);
    const recentCombined = useMemo(() => {
        const cutoff = Date.now() - THIRTY_DAYS_MS;
        return substanceLogs.filter((l) => new Date(l.loggedAt).getTime() >= cutoff);
    }, [substanceLogs]);

    function openCreate(preset?: string) {
        setEditing(null);
        setNameValue(preset ?? "");
        setFormOpen(true);
    }
    function openEdit(c: CounterRow) {
        setEditing(c);
        setNameValue(c.name);
        setFormOpen(true);
    }
    function openUse() {
        setUseType(useTypeOptions[0]?.value ?? "");
        setUseOpen(true);
    }

    async function onSubmitForm(fd: FormData) {
        try {
            if (editing) {
                fd.set("id", editing.id);
                await updateCounter(fd);
                toast.success("Counter updated");
            } else {
                await createCounter(fd);
                toast.success("Counter started");
            }
            setFormOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    async function onLogRelapse(fd: FormData) {
        if (!relapseFor) return;
        fd.set("counterId", relapseFor.id);
        try {
            await logRelapse(fd);
            toast.success("Logged. Your streak restarts now — be kind to yourself.");
            setRelapseFor(null);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    async function onLogUse(fd: FormData) {
        try {
            await logUse(fd);
            const matched = active.some((c) => c.name.toLowerCase() === (fd.get("substanceType") as string)?.toLowerCase());
            toast.success(matched ? "Use logged — matching streak restarted." : "Use logged.");
            setUseOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    async function onDeleteLog(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteSubstanceLog(fd);
            toast.success("Use deleted");
        } catch {
            toast.error("Failed to delete");
        }
    }

    async function onArchive(c: CounterRow) {
        const fd = new FormData();
        fd.set("id", c.id);
        fd.set("archived", c.archived ? "false" : "true");
        try {
            await archiveCounter(fd);
            toast.success(c.archived ? "Restored" : "Archived");
        } catch {
            toast.error("Failed");
        }
    }
    async function onDelete(c: CounterRow) {
        const fd = new FormData();
        fd.set("id", c.id);
        try {
            await deleteCounter(fd);
            toast.success("Deleted");
        } catch {
            toast.error("Failed");
        }
    }

    const selectedUseUnit = useTypeOptions.find((o) => o.value === useType)?.unit ?? "";

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Sobriety"
                description="Track sober streaks, log uses, celebrate milestones, and stay accountable."
                action={
                    <div className="flex flex-wrap gap-2">
                        <Button size="md" color="secondary" iconLeading={Settings01} onClick={() => setManageOpen(true)}>
                            Types
                        </Button>
                        <Button size="md" color="secondary" iconLeading={RefreshCcw01} onClick={openUse}>
                            Log use
                        </Button>
                        <Button size="md" iconLeading={Plus} onClick={() => openCreate()}>
                            New counter
                        </Button>
                    </div>
                }
            />

            {active.length === 0 && archived.length === 0 ? (
                <Card className="flex flex-col items-center gap-4 py-12 text-center">
                    <FeaturedIcon icon={Heart} color="brand" theme="light" size="lg" />
                    <div className="flex flex-col gap-1">
                        <h3 className="text-lg font-semibold text-primary">Start your first streak</h3>
                        <p className="max-w-sm text-sm text-tertiary">Pick what you want to stay sober from. Every day counts — we will track it to the second.</p>
                    </div>
                    <div className="flex max-w-md flex-wrap justify-center gap-2">
                        {PRESETS.map((p) => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => openCreate(p)}
                                className="rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-secondary ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover"
                            >
                                {p}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => openCreate()}
                            className="rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-brand-secondary ring-1 ring-brand ring-inset transition duration-100 ease-linear hover:bg-secondary_hover"
                        >
                            Custom…
                        </button>
                    </div>
                </Card>
            ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                    {active.map((c) => (
                        <Card key={c.id} className="flex flex-col gap-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <FeaturedIcon icon={Heart} color="brand" theme="light" size="md" />
                                    <div className="flex flex-col gap-0.5">
                                        <h3 className="text-md font-semibold text-primary">{c.name}</h3>
                                        {c.description && <p className="text-xs text-tertiary">{c.description}</p>}
                                    </div>
                                </div>
                                <Dropdown.Root>
                                    <Dropdown.DotsButton />
                                    <Dropdown.Popover>
                                        <Dropdown.Menu>
                                            <Dropdown.Item icon={Edit01} label="Edit" onAction={() => openEdit(c)} />
                                            <Dropdown.Item icon={Archive} label="Archive" onAction={() => onArchive(c)} />
                                            <Dropdown.Item icon={Trash02} label="Delete" onAction={() => onDelete(c)} />
                                        </Dropdown.Menu>
                                    </Dropdown.Popover>
                                </Dropdown.Root>
                            </div>

                            <div className="flex items-end justify-between gap-3">
                                <LiveStreak startedAt={c.startedAt} />
                                <div className="flex items-center gap-1.5 text-xs text-tertiary">
                                    <Trophy01 className="size-4 text-fg-warning-secondary" />
                                    <span>Best: {fmtDuration(c.bestStreakMs)}</span>
                                </div>
                            </div>

                            <Milestones startedAt={c.startedAt} />

                            <RelapseHistory relapses={c.relapses} />

                            <CounterHistory counterName={c.name} logs={substanceLogs} onDeleteLog={onDeleteLog} />

                            <Button color="secondary-destructive" iconLeading={RefreshCcw01} onClick={() => setRelapseFor(c)} className="w-full">
                                I slipped / used
                            </Button>
                        </Card>
                    ))}
                </div>
            )}

            {archived.length > 0 && (
                <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-tertiary">Archived</h3>
                    <div className="grid gap-3 lg:grid-cols-2">
                        {archived.map((c) => (
                            <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-sm font-medium text-secondary">{c.name}</span>
                                    <span className="text-xs text-tertiary">Best: {fmtDuration(c.bestStreakMs)}</span>
                                </div>
                                <div className="flex gap-1.5">
                                    <Button size="sm" color="secondary" onClick={() => onArchive(c)}>
                                        Restore
                                    </Button>
                                    <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(c)} aria-label="Delete" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Combined use history across all types */}
            <Card className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                    <FeaturedIcon icon={BarChart03} color="gray" theme="modern" size="sm" />
                    <h3 className="text-md font-semibold text-primary">All use history</h3>
                </div>
                <TrendChart data={combinedWeekly} series={[{ key: "entries", name: "Uses" }]} type="bar" height={180} emptyLabel="No uses logged yet" />
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                        <thead>
                            <tr className="border-b border-secondary text-left text-tertiary">
                                <th className="py-2 pr-3 font-medium">Type</th>
                                <th className="py-2 pr-3 font-medium">Amount</th>
                                <th className="py-2 pr-3 font-medium">When</th>
                                <th className="py-2 pr-3 font-medium">Notes</th>
                                <th className="py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {recentCombined.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="py-8 text-center text-tertiary">
                                        Nothing logged in the last 30 days.
                                    </td>
                                </tr>
                            )}
                            {recentCombined.map((l) => (
                                <tr key={l.id} className="border-b border-secondary last:border-0">
                                    <td className="py-2.5 pr-3">
                                        <Badge color="gray" size="sm">
                                            {typeLabel(l.substanceType)}
                                        </Badge>
                                    </td>
                                    <td className="py-2.5 pr-3 text-secondary">{fmtAmount(l) ?? "—"}</td>
                                    <td className="py-2.5 pr-3 text-tertiary">{formatDateTime(l.loggedAt)}</td>
                                    <td className="max-w-[200px] truncate py-2.5 pr-3 text-tertiary">{l.notes}</td>
                                    <td className="py-2.5 text-right">
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDeleteLog(l.id)} aria-label="Delete" />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-tertiary">Showing the last 30 days. Older history is preserved.</p>
            </Card>

            {/* Create / edit modal */}
            <FormModal isOpen={formOpen} onOpenChange={setFormOpen} title={editing ? "Edit counter" : "New sobriety counter"}>
                <form action={onSubmitForm} className="flex flex-col gap-4">
                    {!editing && (
                        <div className="flex flex-wrap gap-1.5">
                            {PRESETS.map((p) => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => setNameValue(p)}
                                    className={
                                        nameValue === p
                                            ? "rounded-full bg-brand-primary px-3 py-1 text-sm font-semibold text-brand-secondary ring-1 ring-brand ring-inset"
                                            : "rounded-full bg-primary px-3 py-1 text-sm font-medium text-secondary ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover"
                                    }
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    )}
                    <Input isRequired label="Name" name="name" placeholder="e.g. Alcohol" value={nameValue} onChange={setNameValue} />
                    <TextArea label="Description" name="description" placeholder="Why this matters to you (optional)" defaultValue={editing?.description ?? ""} rows={2} />
                    <FormDateInput
                        name="startedAt"
                        label="Sober since"
                        variant="datetime"
                        hint="When did this streak begin?"
                        defaultValue={toLocalInput(editing ? editing.startedAt : new Date().toISOString())}
                    />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setFormOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Start counter"}</Button>
                    </div>
                </form>
            </FormModal>

            {/* Relapse / slip modal (also records a use) */}
            <FormModal
                isOpen={relapseFor != null}
                onOpenChange={(o) => !o && setRelapseFor(null)}
                title="Log a slip"
                description="Setbacks happen. Logging honestly is part of recovery — your best streak is still yours. This also records a use in your history."
            >
                <form action={onLogRelapse} className="flex flex-col gap-4">
                    <FormDateInput name="relapsedAt" label="When did it happen?" variant="datetime" defaultValue={toLocalInput(new Date().toISOString())} />
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Amount" htmlFor="relapse-amount">
                            <NativeInput id="relapse-amount" name="amount" type="number" step="any" placeholder="optional" />
                        </Field>
                        <Field label="Unit" htmlFor="relapse-unit">
                            <NativeInput id="relapse-unit" name="unit" placeholder="e.g. drinks" />
                        </Field>
                    </div>
                    <TextArea label="Notes" name="notes" placeholder="What led to it? What will you do differently? (optional)" rows={3} />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setRelapseFor(null)}>
                            Cancel
                        </Button>
                        <Button color="primary-destructive" type="submit">
                            Log &amp; restart streak
                        </Button>
                    </div>
                </form>
            </FormModal>

            {/* Quick "Log use" modal */}
            <FormModal
                isOpen={useOpen}
                onOpenChange={setUseOpen}
                title="Log a use"
                description="Record a use of any substance. If it matches an active counter, that streak restarts."
            >
                <form action={onLogUse} className="flex flex-col gap-4">
                    <Field label="Type" htmlFor="use-type">
                        <NativeSelect id="use-type" name="substanceType" value={useType} onChange={(e) => setUseType(e.target.value)}>
                            {useTypeOptions.length === 0 && <option value="">No types yet</option>}
                            {useTypeOptions.map((t) => (
                                <option key={t.value} value={t.value}>
                                    {t.label}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Amount" htmlFor="use-amount">
                            <NativeInput id="use-amount" name="amount" type="number" step="any" placeholder="optional" />
                        </Field>
                        <Field label="Unit" htmlFor="use-unit">
                            <NativeInput id="use-unit" name="unit" defaultValue={selectedUseUnit} key={useType} placeholder="e.g. drinks" />
                        </Field>
                    </div>
                    <FormDateInput name="loggedAt" label="When" variant="datetime" defaultValue={toLocalInput(new Date().toISOString())} />
                    <Field label="Notes" htmlFor="use-notes">
                        <NativeTextarea id="use-notes" name="notes" />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setUseOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" isDisabled={useTypeOptions.length === 0}>
                            Log use
                        </Button>
                    </div>
                </form>
            </FormModal>

            {/* Manage custom substance types */}
            <FormModal isOpen={manageOpen} onOpenChange={setManageOpen} title="Custom substance types">
                <div className="flex flex-col gap-4">
                    <form
                        action={async (fd) => {
                            try {
                                await createCustomSubstanceType(fd);
                                toast.success("Added");
                            } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Failed");
                            }
                        }}
                        className="flex items-end gap-2"
                    >
                        <Field label="New type" htmlFor="custom-type-name" className="flex-1">
                            <NativeInput id="custom-type-name" name="name" placeholder="e.g. Kratom" required />
                        </Field>
                        <Button type="submit" iconLeading={Plus}>
                            Add
                        </Button>
                    </form>
                    <div className="flex flex-col gap-2">
                        {customTypes.length === 0 && <p className="text-sm text-tertiary">No custom types yet.</p>}
                        {customTypes.map((c) => (
                            <div key={c.id} className="flex items-center justify-between rounded-lg px-3 py-2 ring-1 ring-secondary ring-inset">
                                <span className="text-sm text-primary">{c.name}</span>
                                <form
                                    action={async (fd) => {
                                        try {
                                            await deleteCustomSubstanceType(fd);
                                            toast.success("Removed");
                                        } catch {
                                            toast.error("Failed");
                                        }
                                    }}
                                >
                                    <input type="hidden" name="id" value={c.id} />
                                    <Button type="submit" size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Delete" />
                                </form>
                            </div>
                        ))}
                    </div>
                </div>
            </FormModal>
        </div>
    );
}

function RelapseHistory({ relapses }: { relapses: RelapseRow[] }) {
    const [open, setOpen] = useState(false);

    async function onDelete(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteRelapse(fd);
            toast.success("Relapse removed");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
        }
    }

    if (relapses.length === 0) {
        return <p className="text-xs text-tertiary">No relapses logged — a clean record.</p>;
    }

    return (
        <div className="flex flex-col gap-2">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-max items-center gap-1 text-xs font-semibold text-secondary transition duration-100 ease-linear hover:text-secondary_hover"
            >
                {relapses.length} relapse{relapses.length === 1 ? "" : "s"}
                {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
            {open && (
                <ol className="flex flex-col gap-2 border-l border-secondary pl-3">
                    {relapses.map((r) => (
                        <li key={r.id} className="flex items-start justify-between gap-2">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-xs font-medium text-secondary">{formatDateTime(r.relapsedAt)}</span>
                                {r.notes && <span className="text-xs text-tertiary">{r.notes}</span>}
                            </div>
                            <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(r.id)} aria-label="Delete relapse" />
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}
