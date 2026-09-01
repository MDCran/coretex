// @ts-nocheck
import { resolveIcon } from "@/components/application/icon-picker/icon-registry";
import { BadgeColors } from "@/components/base/badges/badge-types";
import { Badge } from "@/components/base/badges/badges";
import FormDateInput from "@/components/base/input/form-date-input";
import { IconPicker } from "@/coretex/ui/icon-picker";
import { cx } from "@/utils/cx";
import { Plus, Target04, Link03, Flag01, Edit01, Trash02, Trophy01, TrendUp01, Lightning01, SlashCircle01, ChevronDown, ChevronRight, Check } from "@untitledui/icons";
import { formatDate } from "../../personal/personal-ui";
import { useState, useMemo } from "react";
import { Button, Select } from "react-aria-components";
import { toast } from "sonner";
import { HealthEmptyState } from "../_components/empty-state";
import { FormModal } from "../_components/form-modal";
import { SectionHeader, Card, Field, NativeInput, NativeTextarea } from "../_components/health-ui";
import { HabitHeatmap } from "./habit-heatmap";
import { breakStreak, buildStreak, bestBreakStreak, bestBuildStreak, HABIT_CATEGORIES, reachedMilestone, habitColor, HABIT_COLOR_NAMES } from "./habits-ui";



export interface MilestoneRow {
    id: string;
    milestoneDate: string;
    description: string | null;
}
export interface HabitRow {
    id: string;
    name: string;
    description: string | null;
    habitType: string | null;
    frequency: string | null;
    targetCount: number | null;
    targetDays: number | null;
    daysOfWeek: string[];
    color: string | null;
    icon: string | null;
    category: string | null;
    cue: string | null;
    routine: string | null;
    reward: string | null;
    stackAfterHabitId: string | null;
    difficulty: string | null;
    priority: string | null;
    reminderTime: string | null;
    active: boolean;
    createdAt: string;
    logDates: string[];
    milestones: MilestoneRow[];
}

const DOW = [
    { v: "MON", l: "Mon" },
    { v: "TUE", l: "Tue" },
    { v: "WED", l: "Wed" },
    { v: "THU", l: "Thu" },
    { v: "FRI", l: "Fri" },
    { v: "SAT", l: "Sat" },
    { v: "SUN", l: "Sun" },
];

const DIFFICULTIES: { id: string; label: string; color: BadgeColors }[] = [
    { id: "easy", label: "Easy", color: "success" },
    { id: "medium", label: "Medium", color: "warning" },
    { id: "hard", label: "Hard", color: "error" },
];
const PRIORITIES: { id: string; label: string; color: BadgeColors }[] = [
    { id: "low", label: "Low", color: "gray" },
    { id: "medium", label: "Medium", color: "brand" },
    { id: "high", label: "High", color: "error" },
];
const DOW_BY_JS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
type FreqMode = "daily" | "weekly" | "count";

function isDueToday(h: HabitRow, dateStr: string) {
    if (h.frequency === "weekly" && h.daysOfWeek.length > 0) {
        const dow = DOW_BY_JS[new Date(`${dateStr}T12:00:00`).getDay()];
        return h.daysOfWeek.includes(dow);
    }
    return true;
}

interface EnrichedHabit extends HabitRow {
    set: Set<string>;
    isBreak: boolean;
    streak: number;
    best: number;
    doneToday: boolean;
}

/** Small segmented control. */
function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: string; icon?: React.FC<{ className?: string }> }[] }) {
    return (
        <div className="flex gap-1 rounded-lg bg-secondary p-1">
            {options.map((o) => {
                const Icon = o.icon;
                const selected = value === o.v;
                return (
                    <button
                        key={o.v}
                        type="button"
                        onClick={() => onChange(o.v)}
                        aria-pressed={selected}
                        className={cx(
                            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition duration-100 ease-linear",
                            selected ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-tertiary hover:text-secondary",
                        )}
                    >
                        {Icon && <Icon className="size-4" aria-hidden="true" />}
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

/** Badge single-select for difficulty / priority. */
function BadgeChips({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { id: string; label: string; color: BadgeColors }[] }) {
    return (
        <div className="flex flex-wrap gap-2">
            {options.map((o) => {
                const selected = value === o.id;
                return (
                    <button
                        key={o.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onChange(selected ? "" : o.id)}
                        className={cx("rounded-full transition duration-100 ease-linear", selected ? "ring-2 ring-brand ring-offset-2 ring-offset-primary" : "opacity-70 hover:opacity-100")}
                    >
                        <Badge color={o.color} size="md">
                            {o.label}
                        </Badge>
                    </button>
                );
            })}
        </div>
    );
}

export function HabitsClient({ habits }: { habits: HabitRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<HabitRow | null>(null);
    const [milestoneFor, setMilestoneFor] = useState<HabitRow | null>(null);
    const today = new Date().toISOString().slice(0, 10);

    // --- form state ---
    const [mode, setMode] = useState<"build" | "break">("build");
    const [color, setColor] = useState("brand");
    const [icon, setIcon] = useState("Target04");
    const [freq, setFreq] = useState<FreqMode>("daily");
    const [days, setDays] = useState<string[]>([]);
    const [category, setCategory] = useState("");
    const [customCategory, setCustomCategory] = useState(false);
    const [difficulty, setDifficulty] = useState("");
    const [priority, setPriority] = useState("");
    const [stackAfter, setStackAfter] = useState("");
    const [motivationOpen, setMotivationOpen] = useState(false);

    const enriched: EnrichedHabit[] = useMemo(
        () =>
            habits.map((h) => {
                const set = new Set(h.logDates);
                const isBreak = h.habitType === "bad";
                return {
                    ...h,
                    set,
                    isBreak,
                    streak: isBreak ? breakStreak(set) : buildStreak(set),
                    best: isBreak ? bestBreakStreak(set) : bestBuildStreak(set),
                    doneToday: h.logDates.includes(today),
                };
            }),
        [habits, today],
    );
    const active = enriched.filter((h) => h.active);
    const dueToday = active.filter((h) => isDueToday(h, today));

    // Group today's checklist: anchors first, with stacked children indented under them.
    const checklistGroups = useMemo(() => {
        const byId = new Map(dueToday.map((h) => [h.id, h]));
        const childrenOf = new Map<string, EnrichedHabit[]>();
        const roots: EnrichedHabit[] = [];
        for (const h of dueToday) {
            const anchorId = h.stackAfterHabitId;
            if (anchorId && byId.has(anchorId)) {
                const arr = childrenOf.get(anchorId) ?? [];
                arr.push(h);
                childrenOf.set(anchorId, arr);
            } else {
                roots.push(h);
            }
        }
        return { roots, childrenOf };
    }, [dueToday]);

    function resetForm(h: HabitRow | null) {
        setMode(h?.habitType === "bad" ? "break" : "build");
        setColor(h?.color ?? "brand");
        setIcon(h?.icon ?? "Target04");
        const f = h?.frequency;
        setFreq(f === "weekly" ? "weekly" : f === "count" ? "count" : "daily");
        setDays(h?.daysOfWeek ?? []);
        const cat = h?.category ?? "";
        const isPreset = !cat || HABIT_CATEGORIES.includes(cat);
        setCustomCategory(!!cat && !isPreset);
        setCategory(cat);
        setDifficulty(h?.difficulty ?? "");
        setPriority(h?.priority ?? "");
        setStackAfter(h?.stackAfterHabitId ?? "");
        setMotivationOpen(!!(h?.cue || h?.routine || h?.reward));
    }

    function openCreate() {
        setEditing(null);
        resetForm(null);
        setOpen(true);
    }
    function openEdit(h: HabitRow) {
        setEditing(h);
        resetForm(h);
        setOpen(true);
    }

    async function onToggle(h: EnrichedHabit) {
        const fd = new FormData();
        fd.set("habitId", h.id);
        fd.set("logDate", today);
        const wasDone = h.doneToday;
        try {
            await toggleHabitLog(fd);
            if (h.isBreak) {
                if (!wasDone) toast("Logged a slip — clean streak reset. Tomorrow is day one.", { icon: "🫧" });
            } else if (!wasDone) {
                // build habit just completed today -> recompute streak incl. today
                const next = new Set(h.set);
                next.add(today);
                const m = reachedMilestone(buildStreak(next));
                if (m) toast.success(`🎉 ${m}-day streak on "${h.name}"! Keep it going.`);
            }
        } catch {
            toast.error("Failed");
        }
    }

    async function onSubmit(fd: FormData) {
        fd.set("habitType", mode === "break" ? "bad" : "good");
        fd.set("color", color);
        fd.set("icon", icon);
        fd.set("frequency", freq);
        fd.set("category", category);
        fd.set("difficulty", difficulty);
        fd.set("priority", priority);
        fd.set("stackAfterHabitId", stackAfter);
        fd.delete("daysOfWeek");
        if (freq === "weekly") for (const d of days) fd.append("daysOfWeek", d);
        try {
            if (editing) await updateHabit(fd);
            else await createHabit(fd);
            toast.success(editing ? "Habit updated" : mode === "break" ? "Habit to break created" : "Habit created");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    async function onDelete(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteHabit(fd);
            toast.success("Deleted");
        } catch {
            toast.error("Failed");
        }
    }

    function toggleDay(v: string) {
        setDays((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
    }

    const stackOptions = habits.filter((h) => h.active && h.id !== editing?.id);
    const anchorName = (id: string | null) => habits.find((h) => h.id === id)?.name ?? null;

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Habits"
                description="Build good habits and break the ones holding you back."
                action={
                    <Button size="md" iconLeading={Plus} onClick={openCreate}>
                        New habit
                    </Button>
                }
            />

            {/* Today's checklist — hidden entirely when there are no habits yet so the
                full-page empty state below is the single, focused call-to-action. */}
            {active.length > 0 && (
                <Card>
                    <h3 className="mb-4 text-md font-semibold text-primary">Today</h3>
                    {dueToday.length === 0 ? (
                        <p className="text-sm text-tertiary">Nothing scheduled for today — enjoy the rest, your next check-in is on its scheduled day.</p>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {checklistGroups.roots.map((h) => (
                                <ChecklistGroup key={h.id} habit={h} childrenOf={checklistGroups.childrenOf} onToggle={onToggle} depth={0} />
                            ))}
                        </div>
                    )}
                </Card>
            )}

            {/* Habit cards */}
            {enriched.length === 0 ? (
                <Card className="p-0">
                    <HealthEmptyState
                        icon={Target04}
                        title="Start your first habit"
                        description="Build a habit you want more of, or break one you want gone. Check in each day and watch your streak grow."
                        actionLabel="New habit"
                        onAction={openCreate}
                    />
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {enriched.map((h) => {
                        const Icon = resolveIcon(h.icon);
                        const col = habitColor(h.color);
                        const streakLabel = h.isBreak ? "days clean" : "day streak";
                        return (
                            <Card key={h.id} className="flex flex-col">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex min-w-0 items-start gap-3">
                                        <span className={cx("mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg", col.tile)}>
                                            <Icon className="size-5" aria-hidden="true" />
                                        </span>
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-md font-semibold text-primary">{h.name}</p>
                                                {h.isBreak ? (
                                                    <Badge color="error" size="sm" type="pill-color">
                                                        Breaking
                                                    </Badge>
                                                ) : (
                                                    <Badge color="success" size="sm" type="pill-color">
                                                        Building
                                                    </Badge>
                                                )}
                                                {!h.active && (
                                                    <Badge color="gray" size="sm">
                                                        Archived
                                                    </Badge>
                                                )}
                                                {h.priority && (
                                                    <Badge color={PRIORITIES.find((p) => p.id === h.priority)?.color ?? "brand"} size="sm">
                                                        {PRIORITIES.find((p) => p.id === h.priority)?.label ?? h.priority}
                                                    </Badge>
                                                )}
                                                {h.difficulty && (
                                                    <Badge color={DIFFICULTIES.find((d) => d.id === h.difficulty)?.color ?? "gray"} size="sm">
                                                        {DIFFICULTIES.find((d) => d.id === h.difficulty)?.label ?? h.difficulty}
                                                    </Badge>
                                                )}
                                            </div>
                                            {h.description && <p className="mt-0.5 text-sm text-tertiary">{h.description}</p>}
                                            {h.stackAfterHabitId && anchorName(h.stackAfterHabitId) && (
                                                <p className="mt-1 flex items-center gap-1 text-xs text-tertiary">
                                                    <Link03 className="size-3.5" aria-hidden="true" /> after {anchorName(h.stackAfterHabitId)}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 gap-1">
                                        <Button size="sm" color="tertiary" iconLeading={Flag01} onClick={() => setMilestoneFor(h)} aria-label="Milestones" />
                                        <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(h)} aria-label="Edit" />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(h.id)} aria-label="Delete" />
                                    </div>
                                </div>

                                {(h.cue || h.routine || h.reward) && (
                                    <p className="mt-2 text-xs text-tertiary">
                                        {h.cue && (
                                            <span>
                                                <span className="font-medium text-secondary">Cue:</span> {h.cue}{" "}
                                            </span>
                                        )}
                                        {h.routine && (
                                            <span>
                                                <span className="font-medium text-secondary">Routine:</span> {h.routine}{" "}
                                            </span>
                                        )}
                                        {h.reward && (
                                            <span>
                                                <span className="font-medium text-secondary">Reward:</span> {h.reward}
                                            </span>
                                        )}
                                    </p>
                                )}

                                <div className="mt-4 flex flex-wrap items-center gap-2">
                                    <span className={cx("flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold", h.isBreak ? "bg-utility-green-50 text-utility-green-700" : "bg-utility-orange-50 text-utility-orange-700")}>
                                        <Flame01 className="size-4" aria-hidden="true" /> {h.streak} {streakLabel}
                                    </span>
                                    <span className="flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-sm font-medium text-secondary">
                                        <Trophy01 className="size-4" aria-hidden="true" /> best {h.best}
                                    </span>
                                    <span className="flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-sm font-medium text-secondary">
                                        <TrendUp01 className="size-4" aria-hidden="true" /> {h.logDates.length} {h.isBreak ? "slips" : "total"}
                                    </span>
                                </div>

                                <div className="mt-3">
                                    <HabitHeatmap logDates={h.set} color={h.color ?? "brand"} variant={h.isBreak ? "break" : "build"} sinceKey={h.createdAt.slice(0, 10)} />
                                </div>

                                {h.milestones.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {h.milestones.map((m) => (
                                            <Badge key={m.id} color="success" size="sm">
                                                {formatDate(m.milestoneDate)} {m.description ? `· ${m.description}` : ""}
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Create / edit habit modal */}
            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit habit" : "New habit"}>
                <form action={onSubmit} className="flex flex-col gap-5">
                    {editing && <input type="hidden" name="id" value={editing.id} />}

                    {/* Build vs Break */}
                    <Segmented
                        value={mode}
                        onChange={setMode}
                        options={[
                            { v: "build", label: "Build a habit", icon: Lightning01 },
                            { v: "break", label: "Break a habit", icon: SlashCircle01 },
                        ]}
                    />
                    <p className="-mt-3 text-xs text-tertiary">
                        {mode === "build"
                            ? "Something you want more of — meditate, read, exercise. Checking in each day grows your streak."
                            : "Something you want gone — smoking, doomscrolling. Your streak counts days clean; log a slip if it happens."}
                    </p>

                    {/* Basics */}
                    <Section title="Basics">
                        <Field label="Name" htmlFor="name">
                            <NativeInput id="name" name="name" required defaultValue={editing?.name ?? ""} placeholder={mode === "build" ? "e.g. Read 20 minutes" : "e.g. No doomscrolling"} />
                        </Field>
                        <Field label="Description" htmlFor="description">
                            <NativeTextarea id="description" name="description" defaultValue={editing?.description ?? ""} placeholder="Optional note about why this matters" />
                        </Field>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label="Color">
                                <div className="flex flex-wrap gap-2">
                                    {HABIT_COLOR_NAMES.map((co) => (
                                        <button
                                            key={co}
                                            type="button"
                                            aria-label={co}
                                            aria-pressed={color === co}
                                            onClick={() => setColor(co)}
                                            className={cx(
                                                "flex size-8 items-center justify-center rounded-full ring-2 ring-inset transition duration-100 ease-linear",
                                                color === co ? "ring-brand" : "ring-transparent hover:ring-secondary",
                                            )}
                                        >
                                            <span className={cx("size-5 rounded-full", habitColor(co).dot)} />
                                        </button>
                                    ))}
                                </div>
                            </Field>
                            <Field label="Category">
                                {customCategory ? (
                                    <div className="flex gap-2">
                                        <NativeInput id="category-custom" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Custom category" />
                                        <Button color="secondary" size="sm" type="button" onClick={() => { setCustomCategory(false); setCategory(""); }}>
                                            Presets
                                        </Button>
                                    </div>
                                ) : (
                                    <Select
                                        selectedKey={category || "__none"}
                                        onSelectionChange={(k) => {
                                            const v = String(k);
                                            if (v === "__custom") {
                                                setCustomCategory(true);
                                                setCategory("");
                                            } else setCategory(v === "__none" ? "" : v);
                                        }}
                                        items={[
                                            { id: "__none", label: "No category" },
                                            ...HABIT_CATEGORIES.map((c) => ({ id: c, label: c })),
                                            { id: "__custom", label: "Custom…" },
                                        ]}
                                        size="sm"
                                        aria-label="Category"
                                    >
                                        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                                    </Select>
                                )}
                            </Field>
                        </div>
                        <Field label="Icon" hint="Shown on the card and today's checklist.">
                            <IconPicker value={icon} onChange={setIcon} />
                        </Field>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label="Difficulty">
                                <BadgeChips value={difficulty} onChange={setDifficulty} options={DIFFICULTIES} />
                            </Field>
                            <Field label="Priority">
                                <BadgeChips value={priority} onChange={setPriority} options={PRIORITIES} />
                            </Field>
                        </div>
                    </Section>

                    {/* Schedule */}
                    <Section title="Schedule">
                        <Field label="Frequency">
                            <Segmented
                                value={freq}
                                onChange={setFreq}
                                options={[
                                    { v: "daily", label: "Daily" },
                                    { v: "weekly", label: "Weekdays" },
                                    { v: "count", label: "X / week" },
                                ]}
                            />
                        </Field>
                        {freq === "weekly" && (
                            <div className="flex flex-wrap gap-1.5">
                                {DOW.map((d) => {
                                    const sel = days.includes(d.v);
                                    return (
                                        <button
                                            key={d.v}
                                            type="button"
                                            aria-pressed={sel}
                                            onClick={() => toggleDay(d.v)}
                                            className={cx(
                                                "rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition duration-100 ease-linear",
                                                sel ? "bg-brand-primary text-brand-secondary ring-brand" : "bg-primary text-tertiary ring-secondary hover:bg-secondary_hover",
                                            )}
                                        >
                                            {d.l}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {freq === "count" && (
                            <Field label="Times per week" htmlFor="targetCount">
                                <NativeInput id="targetCount" name="targetCount" type="number" min={1} max={7} defaultValue={editing?.targetCount ?? 3} />
                            </Field>
                        )}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <FormDateInput name="reminderTime" variant="time" label="Reminder time" defaultValue={editing?.reminderTime ?? ""} />
                            <Field label={mode === "break" ? "Goal: days clean" : "Goal: target days"} htmlFor="targetDays">
                                <NativeInput id="targetDays" name="targetDays" type="number" min={1} defaultValue={editing?.targetDays ?? ""} placeholder="e.g. 30" />
                            </Field>
                        </div>
                    </Section>

                    {/* Stacking */}
                    <Section title="Habit stacking — do it after…">
                        <Field label="Anchor habit" hint="Stack this habit after an existing one to build a routine chain.">
                            <Select
                                selectedKey={stackAfter || null}
                                onSelectionChange={(k) => setStackAfter(k ? String(k) : "")}
                                items={[{ id: "", label: "Not stacked" }, ...stackOptions.map((h) => ({ id: h.id, label: `After ${h.name}` }))]}
                                size="sm"
                                aria-label="Anchor habit"
                            >
                                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                            </Select>
                        </Field>
                    </Section>

                    {/* Motivation (collapsible) */}
                    <div className="rounded-lg ring-1 ring-secondary ring-inset">
                        <button
                            type="button"
                            onClick={() => setMotivationOpen((o) => !o)}
                            aria-expanded={motivationOpen}
                            className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-semibold text-secondary"
                        >
                            Motivation (cue → routine → reward)
                            <ChevronDown aria-hidden="true" className={cx("size-4 text-fg-quaternary transition duration-100", motivationOpen && "rotate-180")} />
                        </button>
                        {motivationOpen && (
                            <div className="flex flex-col gap-4 border-t border-secondary p-3">
                                <Field label="Cue" htmlFor="cue" hint="What triggers it?">
                                    <NativeInput id="cue" name="cue" defaultValue={editing?.cue ?? ""} placeholder="e.g. After morning coffee" />
                                </Field>
                                <Field label="Routine" htmlFor="routine" hint="What you do.">
                                    <NativeInput id="routine" name="routine" defaultValue={editing?.routine ?? ""} />
                                </Field>
                                <Field label="Reward" htmlFor="reward" hint="What you get.">
                                    <NativeInput id="reward" name="reward" defaultValue={editing?.reward ?? ""} />
                                </Field>
                            </div>
                        )}
                    </div>

                    {editing && (
                        <label className="flex items-center gap-2 text-sm text-secondary">
                            <input type="checkbox" name="active" defaultChecked={editing.active} className="size-4 rounded accent-[var(--color-brand-600)]" />
                            Active
                        </label>
                    )}

                    <div className="flex justify-end gap-2 pt-1">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Create"}</Button>
                    </div>
                </form>
            </FormModal>

            {/* Milestones modal */}
            <FormModal isOpen={!!milestoneFor} onOpenChange={(o) => !o && setMilestoneFor(null)} title={milestoneFor ? `Milestones · ${milestoneFor.name}` : "Milestones"}>
                {milestoneFor && (
                    <div className="flex flex-col gap-4">
                        <form
                            action={async (fd) => {
                                try {
                                    await addHabitMilestone(fd);
                                    toast.success("Milestone added");
                                } catch {
                                    toast.error("Failed");
                                }
                            }}
                            className="flex flex-col gap-3"
                        >
                            <input type="hidden" name="habitId" value={milestoneFor.id} />
                            <div className="grid grid-cols-2 gap-3">
                                <FormDateInput name="milestoneDate" label="Date" defaultValue={today} isRequired />
                                <Field label="Description" htmlFor="m-description">
                                    <NativeInput id="m-description" name="description" placeholder="e.g. 30 day streak" />
                                </Field>
                            </div>
                            <Button type="submit" iconLeading={Plus} className="self-start">
                                Add milestone
                            </Button>
                        </form>
                        <div className="flex flex-col gap-2">
                            {milestoneFor.milestones.length === 0 && <p className="text-sm text-tertiary">No milestones yet.</p>}
                            {milestoneFor.milestones.map((m) => (
                                <div key={m.id} className="flex items-center justify-between rounded-lg px-3 py-2 ring-1 ring-secondary ring-inset">
                                    <span className="text-sm text-primary">
                                        {formatDate(m.milestoneDate)} {m.description ? `· ${m.description}` : ""}
                                    </span>
                                    <form
                                        action={async (fd) => {
                                            try {
                                                await deleteHabitMilestone(fd);
                                            } catch {
                                                toast.error("Failed");
                                            }
                                        }}
                                    >
                                        <input type="hidden" name="id" value={m.id} />
                                        <Button type="submit" size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Delete" />
                                    </form>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </FormModal>
        </div>
    );
}

/** Collapsible-section heading used inside the modal. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-4">
            <p className="text-xs font-semibold tracking-wide text-quaternary uppercase">{title}</p>
            {children}
        </div>
    );
}

/** One checklist row plus its stacked children rendered recursively. */
function ChecklistGroup({
    habit,
    childrenOf,
    onToggle,
    depth,
}: {
    habit: EnrichedHabit;
    childrenOf: Map<string, EnrichedHabit[]>;
    onToggle: (h: EnrichedHabit) => void;
    depth: number;
}) {
    const kids = childrenOf.get(habit.id) ?? [];
    return (
        <div className="flex flex-col gap-2">
            <ChecklistRow habit={habit} onToggle={onToggle} stacked={depth > 0} />
            {kids.length > 0 && (
                <div className="ml-4 flex flex-col gap-2 border-l-2 border-secondary pl-3">
                    {kids.map((k) => (
                        <ChecklistGroup key={k.id} habit={k} childrenOf={childrenOf} onToggle={onToggle} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
}

function ChecklistRow({ habit: h, onToggle, stacked }: { habit: EnrichedHabit; onToggle: (h: EnrichedHabit) => void; stacked: boolean }) {
    const Icon = resolveIcon(h.icon);
    const col = habitColor(h.color);

    return (
        <div className="flex items-center justify-between gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover">
            <div className="flex min-w-0 items-center gap-3">
                {stacked && <ChevronRight className="size-3.5 shrink-0 text-fg-quaternary" aria-hidden="true" />}
                <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-lg", col.tile)}>
                    <Icon className="size-4.5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-primary">{h.name}</p>
                    {h.isBreak ? (
                        <p className="text-xs font-medium text-utility-green-700">{h.streak} days clean</p>
                    ) : h.category ? (
                        <p className="truncate text-xs text-tertiary">{h.category}</p>
                    ) : null}
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                {h.streak > 0 && !h.isBreak && (
                    <span className="flex items-center gap-1 text-xs font-medium text-utility-orange-700">
                        <Flame01 className="size-4" aria-hidden="true" /> {h.streak}
                    </span>
                )}
                {h.isBreak ? (
                    <Button size="sm" color={h.doneToday ? "secondary-destructive" : "secondary"} onClick={() => onToggle(h)}>
                        {h.doneToday ? "Slipped today" : "I slipped"}
                    </Button>
                ) : (
                    <button
                        type="button"
                        aria-label={h.doneToday ? "Mark not done" : "Mark done"}
                        aria-pressed={h.doneToday}
                        onClick={() => onToggle(h)}
                        className={cx(
                            "flex size-7 items-center justify-center rounded-full transition duration-100 ease-linear",
                            h.doneToday ? "bg-utility-green-500 text-white" : "text-fg-quaternary ring-1 ring-secondary ring-inset hover:bg-secondary_hover",
                        )}
                    >
                        <Check className="size-4" aria-hidden="true" />
                    </button>
                )}
            </div>
        </div>
    );
}
