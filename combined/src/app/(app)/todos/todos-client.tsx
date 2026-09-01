"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useHotkeys } from "react-hotkeys-hook";
import {
    BarChartSquare02,
    Calendar,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Clock,
    Download01,
    Edit01,
    FilterLines,
    FlipBackward,
    Lock01,
    MagicWand02,
    Microphone01,
    Plus,
    PlayCircle,
    Repeat04,
    SearchLg,
    Settings01,
    SkipForward,
    Stars01,
    Target04,
    Trash02,
    XClose,
} from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { Card, Field, FormModal, NativeInput, NativeSelect, NativeTextarea, runAction } from "@/components/life/life-ui";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { formatTime } from "@/lib/dates";
import { cx } from "@/utils/cx";
import {
    cleanTags,
    formatDuration,
    formatHHMM,
    summarizeCapacity,
    TIME_OF_DAY_LABEL,
    TIME_ZONES,
    TODO_CATEGORY_PRESETS,
    TODO_ENERGY_ICON,
    TODO_ENERGY_LABEL,
    TODO_ENERGY_ORDER,
    TODO_PRIORITY_LABEL,
    TODO_PRIORITY_ORDER,
    TODO_PRIORITY_RANK,
    type TimeOfDayValue,
    type TodoEnergyValue,
    type TodoPriorityValue,
} from "@/lib/todos-shared";
import {
    addSubtask,
    bulkDeleteTodos,
    bulkSetStatus,
    createTodo,
    deleteRoutine,
    deleteSubtask,
    deleteTodo,
    duplicateTodo,
    reorderTodos,
    rescheduleTodo,
    setBlockedBy,
    setTodoStatus,
    toggleRoutineActive,
    toggleSubtask,
    updateRoutine,
    updateTodo,
} from "@/lib/actions/todos";
import { breakdownTodo } from "@/lib/actions/todos";
import { parseNaturalTodo } from "@/lib/todos-nl";
import type { WeeklyDigest } from "@/lib/todo-analytics";
import type { RoutineDTO, TodoItemDTO } from "@/lib/todos";

type Status = "PLANNED" | "IN_PROGRESS" | "DONE" | "SKIPPED";
type Cadence = "NONE" | "DAILY" | "EVERY_N_DAYS" | "WEEKLY_DOW" | "YEARLY";

/** Tag colors for the part-of-day badge (Untitled UI Badge palette). */
const TIME_OF_DAY_BADGE: Record<TimeOfDayValue, "orange" | "blue" | "purple" | "indigo"> = {
    MORNING: "orange",
    AFTERNOON: "blue",
    EVENING: "purple",
    NIGHT: "indigo",
};

/** Common duration presets (minutes) for the quick picker. */
const DURATION_PRESETS = [15, 30, 45, 60, 90, 120, 180, 240];

type BadgeColor = "gray" | "error" | "warning" | "blue" | "orange" | "success" | "pink" | "brand" | "indigo";

/** Priority → badge color + left-border accent class. NONE renders no accent. */
const PRIORITY_BADGE: Record<TodoPriorityValue, BadgeColor> = {
    URGENT: "error",
    HIGH: "orange",
    MEDIUM: "blue",
    LOW: "gray",
    NONE: "gray",
};
const PRIORITY_BORDER: Record<TodoPriorityValue, string> = {
    URGENT: "border-l-utility-red-500",
    HIGH: "border-l-utility-orange-500",
    MEDIUM: "border-l-utility-blue-500",
    LOW: "border-l-utility-gray-400",
    NONE: "border-l-transparent",
};

/** Deterministic category → badge color (presets get fixed hues). */
const CATEGORY_BADGE: Record<string, BadgeColor> = {
    Personal: "pink",
    Work: "blue",
    Finance: "success",
    Health: "orange",
};
function categoryColor(cat: string | null): BadgeColor {
    if (!cat) return "gray";
    return CATEGORY_BADGE[cat] ?? "indigo";
}

const COLUMNS: { status: Status; label: string }[] = [
    { status: "PLANNED", label: "Planned" },
    { status: "IN_PROGRESS", label: "In progress" },
    { status: "DONE", label: "Done" },
    { status: "SKIPPED", label: "Skipped" },
];

const STATUS_BADGE: Record<Status, "gray" | "brand" | "success" | "warning"> = {
    PLANNED: "gray",
    IN_PROGRESS: "brand",
    DONE: "success",
    SKIPPED: "warning",
};

const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Date helpers (operate on YYYY-MM-DD strings, UTC-safe) ───

function todayKey(): string {
    const n = new Date();
    // Use UTC components: the per-day model stores `date` as @db.Date (UTC midnight),
    // so "today" must be derived in UTC to stay consistent with the server.
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
}

function shiftKey(key: string, days: number): string {
    const d = new Date(key + "T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function prettyDate(key: string): string {
    const d = new Date(key + "T00:00:00.000Z");
    return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

function cadenceLabel(c: RoutineDTO["cadence"], r?: RoutineDTO): string {
    switch (c) {
        case "DAILY":
            return "Daily";
        case "EVERY_N_DAYS":
            return r?.intervalN ? `Every ${r.intervalN} days` : "Every N days";
        case "WEEKLY_DOW":
            return r?.daysOfWeek?.length ? r.daysOfWeek.map((d) => d[0] + d.slice(1).toLowerCase()).join("-") : "Weekly";
        case "YEARLY":
            return r?.yearlyMonth && r?.yearlyDay ? `Yearly ${MONTHS[r.yearlyMonth - 1]} ${r.yearlyDay}` : "Yearly";
        default:
            return "Repeats";
    }
}

function shortCadence(c: NonNullable<TodoItemDTO["routineCadence"]>): string {
    return { DAILY: "Daily", EVERY_N_DAYS: "Repeats", WEEKLY_DOW: "Weekly", YEARLY: "Yearly" }[c];
}

function timeBadge(dueAt: string | null): string | null {
    if (!dueAt) return null;
    return formatTime(dueAt);
}

// Minimal Web Speech API shapes (not in the standard TS DOM lib).
type SpeechResultLike = { results?: Record<number, Record<number, { transcript?: string }>> };
type SpeechRecognitionLike = {
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: (e: SpeechResultLike) => void;
    onerror: () => void;
    onend: () => void;
    start: () => void;
};

// ── Component ────────────────────────────────────────────────

export function TodosClient({ date, todos, routines, digest }: { date: string; todos: TodoItemDTO[]; routines: RoutineDTO[]; digest: WeeklyDigest }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [focusTodo, setFocusTodo] = useState<TodoItemDTO | null>(null);

    // Quick-add bar state
    const [title, setTitle] = useState("");
    const [cadence, setCadence] = useState<Cadence>("NONE");
    const [intervalN, setIntervalN] = useState(2);
    const [selectedDows, setSelectedDows] = useState<string[]>([]);
    const [yearlyMonth, setYearlyMonth] = useState(new Date().getMonth() + 1);
    const [yearlyDay, setYearlyDay] = useState(new Date().getDate());

    // Expandable scheduling options for the quick-add bar.
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [body, setBody] = useState("");
    const [addDate, setAddDate] = useState(date);
    const [timeOfDay, setTimeOfDay] = useState<TimeOfDayValue | "">("");
    const [startTime, setStartTime] = useState("");
    const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
    const [priority, setPriority] = useState<TodoPriorityValue>("NONE");
    const [category, setCategory] = useState("");
    const [energy, setEnergy] = useState<TodoEnergyValue | "">("");
    const [tagsInput, setTagsInput] = useState("");
    const [listening, setListening] = useState(false);

    // Keep the quick-add date aligned with the day being viewed.
    useEffect(() => setAddDate(date), [date]);

    // Estimated load vs capacity for the viewed day.
    const capacity = useMemo(() => summarizeCapacity(todos), [todos]);

    // Search + filter + multi-select state.
    const [query, setQuery] = useState("");
    const [fPriorities, setFPriorities] = useState<Set<string>>(new Set());
    const [fCategories, setFCategories] = useState<Set<string>>(new Set());
    const [fTags, setFTags] = useState<Set<string>>(new Set());
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    // Reset selection when the viewed day changes.
    useEffect(() => setSelected(new Set()), [date]);

    // Keyboard shortcut: "N" focuses the quick-add title input.
    useHotkeys("n", (e) => {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[aria-label="Task title"]')?.focus();
    });

    // Modals
    const [editing, setEditing] = useState<TodoItemDTO | null>(null);
    const [skipFor, setSkipFor] = useState<TodoItemDTO | null>(null);
    const [routinesOpen, setRoutinesOpen] = useState(false);
    const [draggingId, setDraggingId] = useState<string | null>(null);

    const isToday = date === todayKey();
    const isPast = date < todayKey();

    // All distinct tags + categories present today (for the filter chips).
    const allTags = useMemo(() => {
        const s = new Set<string>();
        for (const t of todos) for (const tag of t.tags) s.add(tag);
        return [...s].sort((a, b) => a.localeCompare(b));
    }, [todos]);
    const allCategories = useMemo(() => {
        const s = new Set<string>();
        for (const t of todos) if (t.category) s.add(t.category);
        return [...s].sort((a, b) => a.localeCompare(b));
    }, [todos]);

    const filterCount = fPriorities.size + fCategories.size + fTags.size + (query.trim() ? 1 : 0);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return todos.filter((t) => {
            if (fPriorities.size && !fPriorities.has(t.priority)) return false;
            if (fCategories.size && !(t.category && fCategories.has(t.category))) return false;
            if (fTags.size && !t.tags.some((tag) => fTags.has(tag))) return false;
            if (q) {
                const hay = `${t.title} ${t.body ?? ""} ${t.tags.join(" ")} ${t.category ?? ""}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [todos, query, fPriorities, fCategories, fTags]);

    const byColumn = useMemo(() => {
        const map: Record<Status, TodoItemDTO[]> = { PLANNED: [], IN_PROGRESS: [], DONE: [], SKIPPED: [] };
        for (const t of filtered) map[t.status].push(t);
        // Manual sortOrder wins so drag-reorder sticks; priority breaks ties, so a
        // never-reordered column (all sortOrder 0) still shows urgent-first.
        for (const k of Object.keys(map) as Status[]) {
            map[k].sort((a, b) => a.sortOrder - b.sortOrder || TODO_PRIORITY_RANK[a.priority] - TODO_PRIORITY_RANK[b.priority]);
        }
        return map;
    }, [filtered]);

    function toggleSetItem(setter: (fn: (s: Set<string>) => Set<string>) => void, key: string) {
        setter((cur) => {
            const next = new Set(cur);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }
    function clearFilters() {
        setQuery("");
        setFPriorities(new Set());
        setFCategories(new Set());
        setFTags(new Set());
    }

    function toggleSelect(id: string) {
        toggleSetItem(setSelected, id);
    }

    function runFd(action: (fd: FormData) => Promise<unknown>, fd: FormData, ok: string) {
        startTransition(() => {
            runAction(action, fd, toast, ok).then((done) => done && router.refresh());
        });
    }

    function moveToTomorrow(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        fd.set("days", "1");
        runFd(rescheduleTodo, fd, "Moved to tomorrow");
    }
    function duplicate(id: string, toTomorrow: boolean) {
        const fd = new FormData();
        fd.set("id", id);
        if (toTomorrow) fd.set("date", shiftKey(date, 1));
        runFd(duplicateTodo, fd, "Duplicated");
    }
    function bulk(action: "DONE" | "SKIPPED" | "DELETE") {
        if (!selected.size) return;
        const ids = [...selected].join(",");
        const fd = new FormData();
        fd.set("ids", ids);
        if (action === "DELETE") {
            runFd(bulkDeleteTodos, fd, "Deleted");
        } else {
            fd.set("status", action);
            runFd(bulkSetStatus, fd, action === "DONE" ? "Marked done" : "Skipped");
        }
        setSelected(new Set());
    }

    // routineId → current streak, for the flame badge on recurring cards.
    const routineStreaks = useMemo(() => {
        const m = new Map<string, number>();
        for (const r of routines) m.set(r.id, r.streak);
        return m;
    }, [routines]);

    function breakdown(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        startTransition(() => {
            runAction(breakdownTodo, fd, toast, "AI added subtasks").then((ok) => ok && router.refresh());
        });
    }

    /** Drop the dragged card onto `targetId`: reorder within a column, or move
     *  it across columns when dropped onto a card in a different status. */
    function dropOnCard(status: Status, targetId: string) {
        if (!draggingId || draggingId === targetId) return;
        const dragging = todos.find((x) => x.id === draggingId);
        setDraggingId(null);
        if (!dragging) return;
        if (dragging.status !== status) {
            setStatus(draggingId, status);
            return;
        }
        const ids = byColumn[status].map((x) => x.id).filter((id) => id !== draggingId);
        const idx = ids.indexOf(targetId);
        ids.splice(idx < 0 ? ids.length : idx, 0, draggingId);
        const fd = new FormData();
        fd.set("ids", ids.join(","));
        runFd(reorderTodos, fd, "Reordered");
    }

    function go(key: string) {
        router.push(`/todos?date=${key}`);
    }

    function setStatus(id: string, status: Status, hindrance?: string) {
        const fd = new FormData();
        fd.set("id", id);
        fd.set("status", status);
        if (hindrance) fd.set("hindrance", hindrance);
        startTransition(() => {
            runAction(setTodoStatus, fd, toast, "Updated").then((ok) => ok && router.refresh());
        });
    }

    function add() {
        const trimmed = title.trim();
        if (!trimmed) return;
        const fd = new FormData();
        fd.set("title", trimmed);
        fd.set("date", addDate || date);
        fd.set("cadence", cadence);
        if (body.trim()) fd.set("body", body.trim());
        if (timeOfDay) fd.set("timeOfDay", timeOfDay);
        if (startTime) fd.set("startTime", startTime);
        if (durationMinutes) fd.set("durationMinutes", String(durationMinutes));
        if (priority !== "NONE") fd.set("priority", priority);
        if (category.trim()) fd.set("category", category.trim());
        if (energy) fd.set("energy", energy);
        if (tagsInput.trim()) fd.set("tags", tagsInput.trim());
        if (cadence === "EVERY_N_DAYS") fd.set("intervalN", String(intervalN));
        if (cadence === "WEEKLY_DOW") fd.set("daysOfWeek", selectedDows.join(","));
        if (cadence === "YEARLY") {
            fd.set("yearlyMonth", String(yearlyMonth));
            fd.set("yearlyDay", String(yearlyDay));
        }
        startTransition(() => {
            runAction(createTodo, fd, toast, cadence === "NONE" ? "Task added" : "Routine created").then((ok) => {
                if (ok) {
                    setTitle("");
                    setCadence("NONE");
                    setSelectedDows([]);
                    setBody("");
                    setAddDate(date);
                    setTimeOfDay("");
                    setStartTime("");
                    setDurationMinutes(null);
                    setPriority("NONE");
                    setCategory("");
                    setEnergy("");
                    setTagsInput("");
                    router.refresh();
                }
            });
        });
    }

    function remove(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        startTransition(() => {
            runAction(deleteTodo, fd, toast, "Deleted").then((ok) => ok && router.refresh());
        });
    }

    /** Parse the title's natural language into the option fields. */
    function applyParse() {
        if (!title.trim()) return;
        const p = parseNaturalTodo(title, new Date());
        if (!p.matched) {
            toast.message("Nothing to parse — try “tomorrow at 3pm for 30 min #tag high priority”.");
            return;
        }
        setTitle(p.title);
        if (p.date) setAddDate(p.date);
        if (p.startTime) setStartTime(p.startTime);
        if (p.durationMinutes) setDurationMinutes(p.durationMinutes);
        if (p.priority) setPriority(p.priority);
        if (p.energy) setEnergy(p.energy);
        if (p.tags.length) setTagsInput(p.tags.join(", "));
        setOptionsOpen(true);
        toast.success("Parsed — review the details below.");
    }

    /** Suggest the earliest free slot today that fits the task's duration. */
    function suggestTime() {
        const dur = durationMinutes ?? 30;
        const busy = todos
            .filter((t) => t.startTime && t.status !== "SKIPPED")
            .map((t) => {
                const sm = (Number(t.startTime!.slice(0, 2)) || 0) * 60 + (Number(t.startTime!.slice(3, 5)) || 0);
                return [sm, sm + (t.durationMinutes ?? 30)] as [number, number];
            })
            .sort((a, b) => a[0] - b[0]);
        const dayWindowEnd = 22 * 60;
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        // Start at 9:00, or the next 15-min boundary after now when viewing today.
        let cursor = addDate === todayKey() ? Math.max(9 * 60, Math.ceil(nowMin / 15) * 15) : 9 * 60;
        for (const [bs, be] of busy) {
            if (cursor + dur <= bs) break; // fits before this block
            if (be > cursor) cursor = be; // overlaps — jump past it
        }
        if (cursor + dur > dayWindowEnd) {
            toast.message("No free slot left today — try another day.");
            return;
        }
        const hh = String(Math.floor(cursor / 60)).padStart(2, "0");
        const mm = String(cursor % 60).padStart(2, "0");
        setStartTime(`${hh}:${mm}`);
        if (!durationMinutes) setDurationMinutes(dur);
        setOptionsOpen(true);
        toast.success(`Suggested ${formatHHMM(`${hh}:${mm}`)}.`);
    }

    /** Voice-to-todo via the Web Speech API (no extra services). */
    function startVoice() {
        const w = window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike; SpeechRecognition?: new () => SpeechRecognitionLike };
        const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
        if (!SR) {
            toast.error("Voice input isn't supported in this browser.");
            return;
        }
        const rec = new SR();
        rec.lang = "en-US";
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onresult = (e: SpeechResultLike) => {
            const text = e.results?.[0]?.[0]?.transcript ?? "";
            if (text) setTitle((cur) => (cur ? `${cur} ${text}` : text));
        };
        rec.onerror = () => {
            setListening(false);
            toast.error("Couldn't capture audio.");
        };
        rec.onend = () => setListening(false);
        setListening(true);
        rec.start();
    }

    function toggleDow(d: string) {
        setSelectedDows((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
    }

    const cadenceValid =
        cadence !== "WEEKLY_DOW" || selectedDows.length > 0;

    return (
        <div className="page-shell">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex flex-col gap-0.5 sm:gap-1">
                    <h1 className="module-title">To-dos</h1>
                    <p className="text-sm text-tertiary sm:text-md">Plan your day. Routines materialize automatically.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        color="secondary"
                        size="md"
                        iconLeading={Plus}
                        onClick={() => {
                            const el = document.querySelector<HTMLInputElement>('input[aria-label="Task title"]');
                            el?.focus();
                        }}
                    >
                        Add todo
                    </Button>
                    <Button color="secondary" size="md" iconLeading={Settings01} onClick={() => setRoutinesOpen(true)}>
                        Routines
                    </Button>
                    <Button href="/todos/analytics" color="secondary" size="md" iconLeading={BarChartSquare02}>
                        Analytics
                    </Button>
                    <Button href="/api/todos/ical" color="secondary" size="md" iconLeading={Download01}>
                        Export .ics
                    </Button>
                </div>
            </div>

            {/* Day navigation */}
            <div className="mb-5 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                    <Button color="secondary" size="md" iconLeading={ChevronLeft} aria-label="Previous day" onClick={() => go(shiftKey(date, -1))} />
                    <Button color="secondary" size="md" iconLeading={ChevronRight} aria-label="Next day" onClick={() => go(shiftKey(date, 1))} />
                </div>
                <div className="flex items-center gap-2">
                    <Calendar className="size-5 text-fg-quaternary" aria-hidden="true" />
                    <h2 className="text-lg font-semibold text-primary">{prettyDate(date)}</h2>
                </div>
                <input
                    type="date"
                    aria-label="Pick a date"
                    value={date}
                    onChange={(e) => e.target.value && go(e.target.value)}
                    className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary shadow-xs ring-1 ring-primary ring-inset focus:outline-2 focus:-outline-offset-2 focus:outline-brand"
                />
                {!isToday && (
                    <Button color="link-color" size="md" onClick={() => go(todayKey())}>
                        Today
                    </Button>
                )}
                {isPast && <Badge color="gray" size="sm">Past day</Badge>}
            </div>

            {/* Quick-add bar */}
            <Card className="mb-6 flex flex-col gap-3">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        add();
                    }}
                    className="flex flex-wrap items-end gap-3"
                >
                    <div className="flex min-w-0 w-full flex-1 items-center gap-1 sm:min-w-[12rem]">
                        <div className="min-w-0 flex-1">
                            <NativeInput
                                aria-label="Task title"
                                placeholder="Add a task… e.g. “Call client tomorrow at 3pm for 30 min #Client high priority”"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                disabled={isPending}
                            />
                        </div>
                        <Button type="button" size="md" color="tertiary" iconLeading={MagicWand02} aria-label="Parse natural language" onClick={applyParse} isDisabled={isPending || !title.trim()} />
                        <Button type="button" size="md" color={listening ? "primary" : "tertiary"} iconLeading={Microphone01} aria-label="Voice input" onClick={startVoice} isDisabled={isPending} />
                    </div>
                    <div className="w-full sm:w-44">
                        <NativeSelect aria-label="Frequency" value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)} disabled={isPending}>
                            <option value="NONE">One-off (this day)</option>
                            <option value="DAILY">Every day</option>
                            <option value="EVERY_N_DAYS">Every N days</option>
                            <option value="WEEKLY_DOW">Specific weekdays</option>
                            <option value="YEARLY">Every year</option>
                        </NativeSelect>
                    </div>
                    <Button
                        type="button"
                        size="md"
                        color="secondary"
                        iconTrailing={<ChevronDown data-icon className={cx("size-4 transition", optionsOpen && "rotate-180")} />}
                        onClick={() => setOptionsOpen((o) => !o)}
                        aria-expanded={optionsOpen}
                    >
                        Options
                    </Button>
                    <Button type="submit" size="md" color="primary" iconLeading={Plus} isDisabled={isPending || !title.trim() || !cadenceValid}>
                        Add
                    </Button>
                </form>

                {/* Inline-expandable scheduling options */}
                {optionsOpen && (
                    <div className="grid grid-cols-1 gap-4 rounded-lg bg-secondary/40 p-4 ring-1 ring-secondary ring-inset sm:grid-cols-2">
                        <Field label="Description" htmlFor="qa-body" className="sm:col-span-2">
                            <NativeTextarea
                                id="qa-body"
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                placeholder="Add details… (markdown supported)"
                                disabled={isPending}
                            />
                        </Field>
                        <Field label="Scheduled date" htmlFor="qa-date" hint="Defaults to the day you're viewing.">
                            <NativeInput id="qa-date" type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} disabled={isPending} />
                        </Field>
                        <Field label="Start time" htmlFor="qa-time" hint="Optional — places a block on the calendar.">
                            <div className="flex items-center gap-2">
                                <NativeInput id="qa-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={isPending} className="flex-1" />
                                <Button type="button" size="sm" color="secondary" iconLeading={MagicWand02} onClick={suggestTime} isDisabled={isPending}>
                                    Suggest
                                </Button>
                            </div>
                        </Field>
                        <Field label="Time of day" className="sm:col-span-2">
                            <TimeOfDayPicker value={timeOfDay} onChange={setTimeOfDay} disabled={isPending} />
                        </Field>
                        <Field label="Estimated duration" className="sm:col-span-2" hint="Sizes the calendar block and counts toward your daily capacity.">
                            <DurationPicker value={durationMinutes} onChange={setDurationMinutes} disabled={isPending} />
                        </Field>
                        <Field label="Priority" htmlFor="qa-priority">
                            <NativeSelect id="qa-priority" value={priority} onChange={(e) => setPriority(e.target.value as TodoPriorityValue)} disabled={isPending}>
                                {(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"] as TodoPriorityValue[]).map((p) => (
                                    <option key={p} value={p}>
                                        {TODO_PRIORITY_LABEL[p]}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Energy" htmlFor="qa-energy">
                            <NativeSelect id="qa-energy" value={energy} onChange={(e) => setEnergy(e.target.value as TodoEnergyValue | "")} disabled={isPending}>
                                <option value="">No energy tag</option>
                                {TODO_ENERGY_ORDER.map((en) => (
                                    <option key={en} value={en}>
                                        {TODO_ENERGY_ICON[en]} {TODO_ENERGY_LABEL[en]}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Category" htmlFor="qa-category" hint="A color-coded grouping.">
                            <NativeInput id="qa-category" list="qa-category-presets" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Personal, Work…" disabled={isPending} />
                            <datalist id="qa-category-presets">
                                {TODO_CATEGORY_PRESETS.map((c) => (
                                    <option key={c} value={c} />
                                ))}
                            </datalist>
                        </Field>
                        <Field label="Tags" htmlFor="qa-tags" hint="Comma-separated, e.g. CoreMarketing, Admin.">
                            <NativeInput id="qa-tags" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="#tag, #tag" disabled={isPending} />
                        </Field>
                    </div>
                )}

                {/* Frequency detail row */}
                {cadence === "EVERY_N_DAYS" && (
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-tertiary">Every</span>
                        <Button color="secondary" size="sm" onClick={() => setIntervalN((n) => Math.max(1, n - 1))} aria-label="Decrease interval">
                            –
                        </Button>
                        <span className="w-8 text-center text-sm font-semibold text-primary">{intervalN}</span>
                        <Button color="secondary" size="sm" onClick={() => setIntervalN((n) => n + 1)} aria-label="Increase interval">
                            +
                        </Button>
                        <span className="text-sm text-tertiary">days</span>
                    </div>
                )}
                {cadence === "WEEKLY_DOW" && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        {DOW.map((d) => (
                            <button
                                key={d}
                                type="button"
                                onClick={() => toggleDow(d)}
                                className={cx(
                                    "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition duration-100 ease-linear",
                                    selectedDows.includes(d) ? "bg-brand-primary text-brand-secondary ring-brand" : "text-tertiary ring-secondary hover:bg-secondary_hover",
                                )}
                            >
                                {d[0] + d.slice(1).toLowerCase()}
                            </button>
                        ))}
                    </div>
                )}
                {cadence === "YEARLY" && (
                    <div className="flex items-center gap-2">
                        <div className="w-32">
                            <NativeSelect aria-label="Month" value={yearlyMonth} onChange={(e) => setYearlyMonth(Number(e.target.value))}>
                                {MONTHS.map((m, i) => (
                                    <option key={m} value={i + 1}>
                                        {m}
                                    </option>
                                ))}
                            </NativeSelect>
                        </div>
                        <div className="w-20">
                            <NativeInput aria-label="Day" type="number" min={1} max={31} value={yearlyDay} onChange={(e) => setYearlyDay(Number(e.target.value))} />
                        </div>
                    </div>
                )}
            </Card>

            {/* Daily capacity indicator */}
            {capacity.estimatedCount > 0 && <CapacityBar summary={capacity} />}

            {/* Weekly review digest */}
            <WeeklyDigestCard digest={digest} />

            {/* Search + filters + bulk actions */}
            <div className="mb-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-0 flex-1 sm:max-w-xs">
                        <SearchLg className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-quaternary" aria-hidden="true" />
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search tasks…"
                            aria-label="Search tasks"
                            className="w-full rounded-lg bg-primary py-2 pr-3 pl-9 text-sm text-primary shadow-xs ring-1 ring-primary ring-inset focus:outline-2 focus:-outline-offset-2 focus:outline-brand"
                        />
                    </div>
                    <Button color="secondary" size="md" iconLeading={FilterLines} onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
                        Filters{filterCount > 0 ? ` · ${filterCount}` : ""}
                    </Button>
                    {filterCount > 0 && (
                        <Button color="link-gray" size="md" onClick={clearFilters}>
                            Clear
                        </Button>
                    )}
                </div>

                {filtersOpen && (
                    <div className="flex flex-col gap-2.5 rounded-lg bg-secondary/40 p-3 ring-1 ring-secondary ring-inset">
                        <FilterRow label="Priority">
                            {(["URGENT", "HIGH", "MEDIUM", "LOW"] as TodoPriorityValue[]).map((p) => (
                                <FilterChip key={p} active={fPriorities.has(p)} color={PRIORITY_BADGE[p]} onClick={() => toggleSetItem(setFPriorities, p)}>
                                    {TODO_PRIORITY_LABEL[p]}
                                </FilterChip>
                            ))}
                        </FilterRow>
                        {allCategories.length > 0 && (
                            <FilterRow label="Category">
                                {allCategories.map((c) => (
                                    <FilterChip key={c} active={fCategories.has(c)} color={categoryColor(c)} onClick={() => toggleSetItem(setFCategories, c)}>
                                        {c}
                                    </FilterChip>
                                ))}
                            </FilterRow>
                        )}
                        {allTags.length > 0 && (
                            <FilterRow label="Tags">
                                {allTags.map((t) => (
                                    <FilterChip key={t} active={fTags.has(t)} color="gray" onClick={() => toggleSetItem(setFTags, t)}>
                                        #{t}
                                    </FilterChip>
                                ))}
                            </FilterRow>
                        )}
                    </div>
                )}

                {selected.size > 0 && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-primary/40 p-2.5 ring-1 ring-brand ring-inset">
                        <span className="text-sm font-medium text-brand-secondary">{selected.size} selected</span>
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                            <Button size="sm" color="secondary" iconLeading={Check} onClick={() => bulk("DONE")} isDisabled={isPending}>
                                Done
                            </Button>
                            <Button size="sm" color="secondary" iconLeading={SkipForward} onClick={() => bulk("SKIPPED")} isDisabled={isPending}>
                                Skip
                            </Button>
                            <Button size="sm" color="secondary-destructive" iconLeading={Trash02} onClick={() => bulk("DELETE")} isDisabled={isPending}>
                                Delete
                            </Button>
                            <Button size="sm" color="link-gray" onClick={() => setSelected(new Set())}>
                                Clear
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Kanban */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {COLUMNS.map((col) => {
                    const list = byColumn[col.status];
                    return (
                        <div
                            key={col.status}
                            onDragOver={(e) => {
                                if (draggingId) e.preventDefault();
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                if (draggingId) {
                                    setStatus(draggingId, col.status);
                                    setDraggingId(null);
                                }
                            }}
                            className={cx(
                                "flex flex-col gap-3 rounded-xl bg-secondary/40 p-3 ring-1 ring-secondary ring-inset transition duration-100 ease-linear",
                                draggingId && "ring-brand/40",
                            )}
                        >
                            <div className="flex items-center justify-between px-1">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-sm font-semibold text-primary">{col.label}</h3>
                                    <Badge color={STATUS_BADGE[col.status]} size="sm">
                                        {list.length}
                                    </Badge>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                {list.map((t) => (
                                    <div
                                        key={t.id}
                                        onDragOver={(e) => {
                                            if (draggingId && draggingId !== t.id) e.preventDefault();
                                        }}
                                        onDrop={(e) => {
                                            if (!draggingId) return;
                                            e.preventDefault();
                                            e.stopPropagation();
                                            dropOnCard(col.status, t.id);
                                        }}
                                    >
                                    <TodoCard
                                        todo={t}
                                        today={date}
                                        isPending={isPending}
                                        selected={selected.has(t.id)}
                                        onToggleSelect={() => toggleSelect(t.id)}
                                        onDragStart={() => setDraggingId(t.id)}
                                        onDragEnd={() => setDraggingId(null)}
                                        onStatus={(s) => setStatus(t.id, s)}
                                        onSkip={() => setSkipFor(t)}
                                        onEdit={() => setEditing(t)}
                                        onDelete={() => remove(t.id)}
                                        onMoveTomorrow={() => moveToTomorrow(t.id)}
                                        onDuplicate={(tom) => duplicate(t.id, tom)}
                                        onRefresh={() => router.refresh()}
                                        streak={t.routineId ? routineStreaks.get(t.routineId) ?? 0 : 0}
                                        onFocus={() => setFocusTodo(t)}
                                        onBreakdown={() => breakdown(t.id)}
                                    />
                                    </div>
                                ))}
                                {list.length === 0 && <p className="px-1 py-4 text-center text-xs text-tertiary">Nothing here</p>}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Edit modal */}
            <FormModal isOpen={!!editing} onOpenChange={(o) => !o && setEditing(null)} title="Edit task">
                {editing && (
                    <TodoEditForm
                        key={editing.id}
                        todo={editing}
                        siblings={todos.filter((x) => x.id !== editing.id).map((x) => ({ id: x.id, title: x.title }))}
                        isPending={isPending}
                        onCancel={() => setEditing(null)}
                        onSave={(fd) => {
                            startTransition(() => {
                                runAction(updateTodo, fd, toast, "Updated").then((ok) => {
                                    if (ok) {
                                        setEditing(null);
                                        router.refresh();
                                    }
                                });
                            });
                        }}
                        onSetBlockedBy={(blockedById) => {
                            const fd = new FormData();
                            fd.set("id", editing.id);
                            fd.set("blockedById", blockedById);
                            runFd(setBlockedBy, fd, blockedById ? "Dependency set" : "Dependency cleared");
                        }}
                    />
                )}
            </FormModal>

            {/* Skip modal */}
            <FormModal isOpen={!!skipFor} onOpenChange={(o) => !o && setSkipFor(null)} title="Skip task" description={skipFor?.title}>
                <form
                    action={(fd) => {
                        if (!skipFor) return;
                        setStatus(skipFor.id, "SKIPPED", (fd.get("hindrance") as string) || undefined);
                        setSkipFor(null);
                    }}
                    className="flex flex-col gap-4"
                >
                    <Field label="What got in the way?" htmlFor="hindrance" hint="Optional — helps spot patterns.">
                        <NativeTextarea id="hindrance" name="hindrance" />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setSkipFor(null)}>
                            Cancel
                        </Button>
                        <Button type="submit" color="primary">
                            Skip task
                        </Button>
                    </div>
                </form>
            </FormModal>

            {/* Routines modal */}
            <RoutinesModal isOpen={routinesOpen} onOpenChange={setRoutinesOpen} routines={routines} onChange={() => router.refresh()} />

            {/* Focus-mode Pomodoro */}
            {focusTodo && (
                <FocusTimerModal
                    todo={focusTodo}
                    onClose={() => setFocusTodo(null)}
                    onStatus={(s) => setStatus(focusTodo.id, s)}
                />
            )}
        </div>
    );
}

// ── Card ─────────────────────────────────────────────────────

function TodoCard({
    todo,
    today,
    isPending,
    selected,
    onToggleSelect,
    onDragStart,
    onDragEnd,
    onStatus,
    onSkip,
    onEdit,
    onDelete,
    onMoveTomorrow,
    onDuplicate,
    onRefresh,
    streak,
    onFocus,
    onBreakdown,
}: {
    todo: TodoItemDTO;
    today: string;
    isPending: boolean;
    selected: boolean;
    onToggleSelect: () => void;
    onDragStart: () => void;
    onDragEnd: () => void;
    onStatus: (s: Status) => void;
    onSkip: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onMoveTomorrow: () => void;
    onDuplicate: (toTomorrow: boolean) => void;
    onRefresh: () => void;
    streak: number;
    onFocus: () => void;
    onBreakdown: () => void;
}) {
    const t = todo;
    const [subOpen, setSubOpen] = useState(false);
    const [newSub, setNewSub] = useState("");
    // Prefer the explicit start time; fall back to the legacy "due" time badge.
    const time = t.startTime ? formatHHMM(t.startTime) : timeBadge(t.dueAt);
    const isOpen = t.status === "PLANNED" || t.status === "IN_PROGRESS";
    // One-off (no routine) items from a past day that are still open are "overdue".
    const overdue = !t.routineId && isOpen && t.date !== null && t.date < today;
    const blocked = t.blockedById != null && t.blockedByDone === false;
    const subDone = t.subtasks.filter((s) => s.done).length;
    const subPct = t.subtasks.length ? Math.round((subDone / t.subtasks.length) * 100) : 0;

    function subAction(action: (fd: FormData) => Promise<unknown>, fd: FormData, ok: string) {
        runAction(action, fd, toast, ok).then((done) => done && onRefresh());
    }

    return (
        <div
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            className={cx(
                "flex cursor-grab flex-col gap-2 rounded-lg border-l-4 bg-primary p-3 shadow-xs ring-1 ring-inset transition duration-100 ease-linear active:cursor-grabbing",
                PRIORITY_BORDER[t.priority],
                selected ? "ring-2 ring-brand" : overdue ? "ring-error_subtle" : "ring-secondary",
            )}
        >
            <div className="flex items-start gap-2">
                <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={selected ? "Deselect task" : "Select task"}
                    onClick={onToggleSelect}
                    className={cx(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] ring-1 ring-inset transition",
                        selected ? "bg-brand-solid text-white ring-brand" : "ring-primary hover:ring-brand",
                    )}
                >
                    {selected && <Check className="size-3" aria-hidden="true" />}
                </button>
                <span className={cx("min-w-0 flex-1 text-sm font-medium", t.status === "DONE" ? "text-tertiary line-through" : "text-primary")}>{t.title}</span>
                <div className="flex shrink-0 items-center gap-0.5">
                    <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit" onClick={onEdit} isDisabled={isPending} />
                    <Dropdown.Root>
                        <Dropdown.DotsButton />
                        <Dropdown.Popover>
                            <Dropdown.Menu>
                                <Dropdown.Item label="Move to tomorrow" selectionIndicator="none" onAction={onMoveTomorrow} />
                                <Dropdown.Item label="Duplicate here" selectionIndicator="none" onAction={() => onDuplicate(false)} />
                                <Dropdown.Item label="Duplicate to tomorrow" selectionIndicator="none" onAction={() => onDuplicate(true)} />
                                <Dropdown.Item label="Delete" selectionIndicator="none" onAction={onDelete} />
                            </Dropdown.Menu>
                        </Dropdown.Popover>
                    </Dropdown.Root>
                </div>
            </div>

            {t.body && <p className="line-clamp-2 text-xs text-tertiary">{t.body}</p>}

            {(t.projectRef || t.links.length > 0) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tertiary">
                    {t.projectRef &&
                        (t.projectUrl ? (
                            <a href={t.projectUrl} target="_blank" rel="noreferrer" className="text-brand-secondary hover:underline">
                                ↪ {t.projectRef}
                            </a>
                        ) : (
                            <span>↪ {t.projectRef}</span>
                        ))}
                    {t.links.map((l, i) => (
                        <a key={i} href={l} target="_blank" rel="noreferrer" className="truncate text-brand-secondary hover:underline">
                            🔗 {l.replace(/^https?:\/\//, "").slice(0, 28)}
                        </a>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
                {t.priority !== "NONE" && (
                    <Badge color={PRIORITY_BADGE[t.priority]} size="sm" type="pill-color">
                        {TODO_PRIORITY_LABEL[t.priority]}
                    </Badge>
                )}
                {t.category && (
                    <Badge color={categoryColor(t.category)} size="sm" type="pill-color">
                        {t.category}
                    </Badge>
                )}
                {t.energy && (
                    <Badge color="gray" size="sm" type="modern">
                        {TODO_ENERGY_ICON[t.energy]} {TODO_ENERGY_LABEL[t.energy]}
                    </Badge>
                )}
                {t.timeOfDay && (
                    <Badge color={TIME_OF_DAY_BADGE[t.timeOfDay]} size="sm" type="pill-color">
                        {TIME_OF_DAY_LABEL[t.timeOfDay]}
                    </Badge>
                )}
                {time && (
                    <Badge color="gray" size="sm" type="modern" className="gap-1">
                        <Clock className="size-3" aria-hidden="true" /> {time}
                    </Badge>
                )}
                {t.durationMinutes != null && (
                    <Badge color="gray" size="sm" type="modern" className="tabular-nums">
                        ≈ {formatDuration(t.durationMinutes)}
                    </Badge>
                )}
                {t.routineCadence && (
                    <Badge color="brand" size="sm" type="pill-color" className="gap-1">
                        <Repeat04 className="size-3" aria-hidden="true" /> {shortCadence(t.routineCadence)}
                    </Badge>
                )}
                {streak >= 2 && (
                    <Badge color="orange" size="sm" type="pill-color" className="tabular-nums">
                        🔥 {streak}
                    </Badge>
                )}
                {t.rolledOver && (
                    <Badge color="warning" size="sm" type="pill-color" className="gap-1">
                        <FlipBackward className="size-3" aria-hidden="true" /> Rolled over
                    </Badge>
                )}
                {overdue && <Badge color="error" size="sm">Overdue</Badge>}
                {t.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-tertiary">
                        #{tag}
                    </span>
                ))}
                {t.status === "SKIPPED" && t.hindrance && <span className="text-xs text-warning-primary">{t.hindrance}</span>}
            </div>

            {blocked && (
                <div className="flex items-center gap-1.5 rounded-md bg-warning-secondary px-2 py-1 text-xs text-warning-primary">
                    <Lock01 className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">Blocked by: {t.blockedByTitle}</span>
                </div>
            )}

            {/* Subtasks */}
            {(t.subtasks.length > 0 || subOpen) && (
                <div className="flex flex-col gap-1.5 rounded-md bg-secondary/40 p-2">
                    {t.subtasks.length > 0 && (
                        <button type="button" onClick={() => setSubOpen((o) => !o)} className="flex items-center gap-2 text-left">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-quaternary">
                                <div className="h-full rounded-full bg-brand-solid transition-all" style={{ width: `${subPct}%` }} />
                            </div>
                            <span className="shrink-0 text-[11px] tabular-nums text-tertiary">
                                {subDone}/{t.subtasks.length}
                            </span>
                            <ChevronDown className={cx("size-3.5 shrink-0 text-fg-quaternary transition", subOpen && "rotate-180")} aria-hidden="true" />
                        </button>
                    )}
                    {subOpen &&
                        t.subtasks.map((s) => (
                            <div key={s.id} className="flex items-center gap-2">
                                <button
                                    type="button"
                                    aria-label={s.done ? "Mark subtask undone" : "Mark subtask done"}
                                    onClick={() => {
                                        const fd = new FormData();
                                        fd.set("id", s.id);
                                        subAction(toggleSubtask, fd, "Updated");
                                    }}
                                    className={cx(
                                        "flex size-4 shrink-0 items-center justify-center rounded-[5px] ring-1 ring-inset transition",
                                        s.done ? "bg-brand-solid text-white ring-brand" : "ring-primary hover:ring-brand",
                                    )}
                                >
                                    {s.done && <Check className="size-3" aria-hidden="true" />}
                                </button>
                                <span className={cx("min-w-0 flex-1 truncate text-xs", s.done ? "text-quaternary line-through" : "text-secondary")}>{s.title}</span>
                                <button
                                    type="button"
                                    aria-label="Delete subtask"
                                    onClick={() => {
                                        const fd = new FormData();
                                        fd.set("id", s.id);
                                        subAction(deleteSubtask, fd, "Deleted");
                                    }}
                                    className="shrink-0 text-fg-quaternary transition hover:text-error-primary"
                                >
                                    <XClose className="size-3.5" aria-hidden="true" />
                                </button>
                            </div>
                        ))}
                    {subOpen && (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (!newSub.trim()) return;
                                const fd = new FormData();
                                fd.set("todoId", t.id);
                                fd.set("title", newSub.trim());
                                subAction(addSubtask, fd, "Subtask added");
                                setNewSub("");
                            }}
                        >
                            <input
                                value={newSub}
                                onChange={(e) => setNewSub(e.target.value)}
                                placeholder="Add subtask…"
                                aria-label="Add subtask"
                                className="w-full rounded-md bg-primary px-2 py-1 text-xs text-primary ring-1 ring-secondary ring-inset focus:outline-1 focus:outline-brand"
                            />
                        </form>
                    )}
                </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-1 border-t border-secondary pt-2">
                {t.status === "PLANNED" && (
                    <Button size="sm" color="secondary" iconLeading={PlayCircle} onClick={() => onStatus("IN_PROGRESS")} isDisabled={isPending}>
                        Start
                    </Button>
                )}
                {t.status === "IN_PROGRESS" && (
                    <Button size="sm" color="secondary" iconLeading={FlipBackward} aria-label="Back to planned" onClick={() => onStatus("PLANNED")} isDisabled={isPending} />
                )}
                {t.status !== "DONE" && (
                    <Button size="sm" color="primary" iconLeading={Check} onClick={() => onStatus("DONE")} isDisabled={isPending || blocked}>
                        Done
                    </Button>
                )}
                {t.status === "DONE" && (
                    <Button size="sm" color="secondary" iconLeading={FlipBackward} onClick={() => onStatus("PLANNED")} isDisabled={isPending}>
                        Reopen
                    </Button>
                )}
                {isOpen && <Button size="sm" color="tertiary" iconLeading={SkipForward} aria-label="Skip" onClick={onSkip} isDisabled={isPending} />}
                {isOpen && <Button size="sm" color="tertiary" iconLeading={Calendar} aria-label="Move to tomorrow" onClick={onMoveTomorrow} isDisabled={isPending} />}
                {isOpen && <Button size="sm" color="tertiary" iconLeading={Target04} aria-label="Focus timer" onClick={onFocus} isDisabled={isPending} />}
                {t.subtasks.length === 0 && (
                    <Button size="sm" color="tertiary" iconLeading={Stars01} aria-label="AI: break into subtasks" onClick={onBreakdown} isDisabled={isPending} />
                )}
                {!subOpen && t.subtasks.length === 0 && (
                    <Button size="sm" color="link-gray" iconLeading={Plus} onClick={() => setSubOpen(true)} isDisabled={isPending}>
                        Subtask
                    </Button>
                )}
                {t.status === "SKIPPED" && (
                    <Button size="sm" color="secondary" iconLeading={FlipBackward} onClick={() => onStatus("PLANNED")} isDisabled={isPending}>
                        Restore
                    </Button>
                )}
            </div>
        </div>
    );
}

// ── Filter chips ─────────────────────────────────────────────

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-xs font-medium text-tertiary">{label}</span>
            {children}
        </div>
    );
}

const FILTER_CHIP_DOT: Record<BadgeColor, string> = {
    gray: "bg-fg-quaternary",
    error: "bg-utility-red-500",
    warning: "bg-utility-amber-500",
    blue: "bg-utility-blue-500",
    orange: "bg-utility-orange-500",
    success: "bg-utility-green-500",
    pink: "bg-utility-pink-500",
    indigo: "bg-utility-indigo-500",
    brand: "bg-brand-solid",
};

function FilterChip({ active, color, onClick, children }: { active: boolean; color: BadgeColor; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cx(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition duration-100 ease-linear",
                active ? "bg-brand-primary text-brand-secondary ring-brand" : "text-tertiary ring-secondary hover:bg-secondary_hover",
            )}
        >
            <span className={cx("size-2 rounded-full", FILTER_CHIP_DOT[color])} />
            {children}
        </button>
    );
}

// ── Scheduling option controls ───────────────────────────────

/** Segmented part-of-day picker (controlled). Click the active chip to clear it. */
function TimeOfDayPicker({
    value,
    onChange,
    disabled,
}: {
    value: TimeOfDayValue | "";
    onChange: (v: TimeOfDayValue | "") => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {TIME_ZONES.map((z) => {
                const active = value === z.value;
                return (
                    <button
                        key={z.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(active ? "" : z.value)}
                        aria-pressed={active}
                        className={cx(
                            "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition duration-100 ease-linear disabled:opacity-50",
                            active ? "bg-brand-primary text-brand-secondary ring-brand" : "text-tertiary ring-secondary hover:bg-secondary_hover",
                        )}
                    >
                        {z.label}
                        <span className="ml-1 tabular-nums opacity-60">
                            {z.startHour}–{z.endHour}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

/** Duration preset chips + a custom-minutes input (controlled, value in minutes). */
function DurationPicker({
    value,
    onChange,
    disabled,
}: {
    value: number | null;
    onChange: (v: number | null) => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
                {DURATION_PRESETS.map((m) => {
                    const active = value === m;
                    return (
                        <button
                            key={m}
                            type="button"
                            disabled={disabled}
                            onClick={() => onChange(active ? null : m)}
                            aria-pressed={active}
                            className={cx(
                                "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition duration-100 ease-linear disabled:opacity-50",
                                active ? "bg-brand-primary text-brand-secondary ring-brand" : "text-tertiary ring-secondary hover:bg-secondary_hover",
                            )}
                        >
                            {formatDuration(m)}
                        </button>
                    );
                })}
            </div>
            <div className="flex items-center gap-2">
                <NativeInput
                    type="number"
                    min={1}
                    max={1440}
                    step={5}
                    placeholder="Custom minutes"
                    value={value ?? ""}
                    onChange={(e) => {
                        if (e.target.value === "") return onChange(null);
                        const n = Math.round(Number(e.target.value));
                        onChange(Number.isFinite(n) ? Math.max(1, Math.min(1440, n)) : null);
                    }}
                    disabled={disabled}
                    className="w-40"
                    aria-label="Custom duration in minutes"
                />
                <span className="text-xs text-tertiary">minutes{value != null ? ` · ${formatDuration(value)}` : ""}</span>
            </div>
        </div>
    );
}

/** Daily capacity indicator — scheduled estimate vs. an 8h planning budget. */
function CapacityBar({ summary }: { summary: ReturnType<typeof summarizeCapacity> }) {
    const pct = Math.min(100, Math.round(summary.ratio * 100));
    const tone: "ok" | "warning" | "error" = summary.over ? "error" : summary.ratio > 0.85 ? "warning" : "ok";
    const barColor = { ok: "bg-brand-solid", warning: "bg-warning-solid", error: "bg-error-solid" }[tone];
    return (
        <Card className="flex flex-col gap-2 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Clock className="size-4 text-fg-quaternary" aria-hidden="true" />
                    <span className="text-sm font-medium text-secondary">Daily capacity</span>
                    <Badge size="sm" color={summary.over ? "error" : summary.ratio > 0.85 ? "warning" : "gray"} className="tabular-nums">
                        {formatDuration(summary.scheduledMinutes) || "0m"} / {formatDuration(summary.capacityMinutes)}
                    </Badge>
                </div>
                {summary.over ? (
                    <span className="text-xs font-medium text-error-primary">
                        Over by {formatDuration(summary.scheduledMinutes - summary.capacityMinutes)} — consider moving a task.
                    </span>
                ) : (
                    <span className="text-xs text-tertiary">
                        {formatDuration(summary.capacityMinutes - summary.scheduledMinutes)} of headroom left
                    </span>
                )}
            </div>
            <div
                className="h-2 w-full overflow-hidden rounded-full bg-quaternary"
                role="progressbar"
                aria-valuenow={summary.scheduledMinutes}
                aria-valuemin={0}
                aria-valuemax={summary.capacityMinutes}
                aria-label="Scheduled load vs daily capacity"
            >
                <div className={cx("h-full rounded-full transition-all duration-200", barColor)} style={{ width: `${pct}%` }} />
            </div>
        </Card>
    );
}

// ── Weekly review digest ─────────────────────────────────────

function WeeklyDigestCard({ digest }: { digest: WeeklyDigest }) {
    const [open, setOpen] = useState(false);
    const rate = Math.round(digest.completionRate * 100);
    const maxDay = Math.max(1, ...digest.perDayDone.map((d) => d.done));
    return (
        <Card className="mb-4 flex flex-col gap-3 py-4">
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center justify-between gap-2 text-left">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-primary">This week</span>
                    <Badge color="success" size="sm">{digest.done} done</Badge>
                    <Badge color="warning" size="sm">{digest.skipped} skipped</Badge>
                    <Badge color="gray" size="sm">{rate}% completion</Badge>
                    {digest.topCategory && <Badge color="brand" size="sm" type="pill-color">Top: {digest.topCategory.category}</Badge>}
                </div>
                <ChevronDown className={cx("size-4 shrink-0 text-fg-quaternary transition", open && "rotate-180")} aria-hidden="true" />
            </button>
            {open && (
                <div className="flex items-end justify-between gap-1 border-t border-secondary pt-3">
                    {digest.perDayDone.map((d) => {
                        const label = new Date(d.day + "T00:00:00.000Z").toLocaleDateString([], { weekday: "narrow", timeZone: "UTC" });
                        return (
                            <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.done} done`}>
                                <span className="text-[10px] tabular-nums text-tertiary">{d.done}</span>
                                <div className="flex h-16 w-full items-end justify-center">
                                    <div className="w-3 rounded-t bg-brand-solid transition-all" style={{ height: `${Math.round((d.done / maxDay) * 100)}%` }} />
                                </div>
                                <span className="text-[10px] text-quaternary">{label}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

// ── Focus-mode Pomodoro timer ────────────────────────────────

const FOCUS_PRESETS = [15, 25, 50];

function FocusTimerModal({ todo, onClose, onStatus }: { todo: TodoItemDTO; onClose: () => void; onStatus: (s: Status) => void }) {
    const initial = (todo.durationMinutes && todo.durationMinutes <= 120 ? todo.durationMinutes : 25) * 60;
    const [total, setTotal] = useState(initial);
    const [left, setLeft] = useState(initial);
    const [running, setRunning] = useState(false);
    const [started, setStarted] = useState(false);
    const [completed, setCompleted] = useState(false);

    // Tick: a pure decrement, so no side effects run inside the state updater.
    useEffect(() => {
        if (!running) return;
        const iv = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
        return () => clearInterval(iv);
    }, [running]);

    // Auto-complete exactly once when the countdown reaches zero.
    useEffect(() => {
        if (left === 0 && started && !completed) {
            setCompleted(true);
            setRunning(false);
            onStatus("DONE");
        }
    }, [left, started, completed, onStatus]);

    function start() {
        if (!started) {
            onStatus("IN_PROGRESS");
            setStarted(true);
        }
        setRunning(true);
    }
    function setPreset(min: number) {
        setTotal(min * 60);
        setLeft(min * 60);
        setRunning(false);
        setCompleted(false);
    }

    const mm = String(Math.floor(left / 60)).padStart(2, "0");
    const ss = String(left % 60).padStart(2, "0");
    const pct = total ? Math.round(((total - left) / total) * 100) : 0;

    return (
        <FormModal isOpen onOpenChange={(o) => !o && onClose()} title="Focus" description={todo.title}>
            <div className="flex flex-col items-center gap-5 py-2">
                <div className="text-display-md font-semibold tabular-nums text-primary">
                    {mm}:{ss}
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-quaternary">
                    <div className="h-full rounded-full bg-brand-solid transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {FOCUS_PRESETS.map((m) => (
                        <button
                            key={m}
                            type="button"
                            onClick={() => setPreset(m)}
                            className={cx(
                                "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition",
                                total === m * 60 ? "bg-brand-primary text-brand-secondary ring-brand" : "text-tertiary ring-secondary hover:bg-secondary_hover",
                            )}
                        >
                            {m}m
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    {running ? (
                        <Button color="secondary" onClick={() => setRunning(false)}>
                            Pause
                        </Button>
                    ) : (
                        <Button iconLeading={PlayCircle} onClick={start} isDisabled={left === 0}>
                            {started ? "Resume" : "Start"}
                        </Button>
                    )}
                    <Button color="secondary" iconLeading={FlipBackward} onClick={() => setPreset(total / 60)} aria-label="Reset" />
                    <Button
                        color="primary"
                        iconLeading={Check}
                        onClick={() => {
                            onStatus("DONE");
                            onClose();
                        }}
                    >
                        Mark done
                    </Button>
                </div>
            </div>
        </FormModal>
    );
}

// ── Edit modal form ──────────────────────────────────────────

function TodoEditForm({
    todo,
    siblings,
    isPending,
    onCancel,
    onSave,
    onSetBlockedBy,
}: {
    todo: TodoItemDTO;
    siblings: { id: string; title: string }[];
    isPending: boolean;
    onCancel: () => void;
    onSave: (fd: FormData) => void;
    onSetBlockedBy: (blockedById: string) => void;
}) {
    const [timeOfDay, setTimeOfDay] = useState<TimeOfDayValue | "">(todo.timeOfDay ?? "");
    const [durationMinutes, setDurationMinutes] = useState<number | null>(todo.durationMinutes);

    return (
        <form
            action={(fd) => {
                // Mirror controlled pickers into the posted form data.
                fd.set("timeOfDay", timeOfDay);
                fd.set("durationMinutes", durationMinutes != null ? String(durationMinutes) : "");
                onSave(fd);
            }}
            className="flex flex-col gap-4"
        >
            <input type="hidden" name="id" value={todo.id} />
            <Field label="Title" htmlFor="e-title" required>
                <NativeInput id="e-title" name="title" defaultValue={todo.title} required />
            </Field>
            <Field label="Description" htmlFor="e-body" hint="Markdown supported.">
                <NativeTextarea id="e-body" name="body" defaultValue={todo.body ?? ""} placeholder="Add details…" />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormDateInput name="startTime" label="Start time" variant="time" hint="Places a block on the calendar." defaultValue={todo.startTime ?? ""} />
                <FormDateInput name="dueAt" label="Due (deadline)" variant="datetime" hint="Optional deadline." defaultValue={toLocalInput(todo.dueAt ?? null)} />
            </div>
            <Field label="Time of day">
                <TimeOfDayPicker value={timeOfDay} onChange={setTimeOfDay} disabled={isPending} />
            </Field>
            <Field label="Estimated duration">
                <DurationPicker value={durationMinutes} onChange={setDurationMinutes} disabled={isPending} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Priority" htmlFor="e-priority">
                    <NativeSelect id="e-priority" name="priority" defaultValue={todo.priority}>
                        {(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"] as TodoPriorityValue[]).map((p) => (
                            <option key={p} value={p}>
                                {TODO_PRIORITY_LABEL[p]}
                            </option>
                        ))}
                    </NativeSelect>
                </Field>
                <Field label="Energy" htmlFor="e-energy">
                    <NativeSelect id="e-energy" name="energy" defaultValue={todo.energy ?? ""}>
                        <option value="">No energy tag</option>
                        {TODO_ENERGY_ORDER.map((en) => (
                            <option key={en} value={en}>
                                {TODO_ENERGY_ICON[en]} {TODO_ENERGY_LABEL[en]}
                            </option>
                        ))}
                    </NativeSelect>
                </Field>
                <Field label="Category" htmlFor="e-category">
                    <NativeInput id="e-category" name="category" list="e-category-presets" defaultValue={todo.category ?? ""} placeholder="Personal, Work…" />
                    <datalist id="e-category-presets">
                        {TODO_CATEGORY_PRESETS.map((c) => (
                            <option key={c} value={c} />
                        ))}
                    </datalist>
                </Field>
                <Field label="Tags" htmlFor="e-tags" hint="Comma-separated.">
                    <NativeInput id="e-tags" name="tags" defaultValue={todo.tags.join(", ")} placeholder="#tag, #tag" />
                </Field>
            </div>
            <Field label="Project / client" htmlFor="e-project" hint="Link this task to a project or client.">
                <NativeInput id="e-project" name="projectRef" defaultValue={todo.projectRef ?? ""} placeholder="e.g. Core Marketing — Acme" />
            </Field>
            <Field label="Project URL" htmlFor="e-projecturl">
                <NativeInput id="e-projecturl" name="projectUrl" type="url" defaultValue={todo.projectUrl ?? ""} placeholder="https://…" />
            </Field>
            <Field label="Links / attachments" htmlFor="e-links" hint="One URL per line.">
                <NativeTextarea id="e-links" name="links" defaultValue={todo.links.join("\n")} placeholder="https://…" />
            </Field>
            {/* Dependency: applied immediately (separate from Save). */}
            <Field label="Blocked by" htmlFor="e-blocked" hint="This task can't be completed until the blocker is done.">
                <NativeSelect id="e-blocked" defaultValue={todo.blockedById ?? ""} onChange={(e) => onSetBlockedBy(e.target.value)}>
                    <option value="">Nothing — not blocked</option>
                    {siblings.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.title}
                        </option>
                    ))}
                </NativeSelect>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
                <Button color="secondary" type="button" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" isDisabled={isPending}>
                    Save
                </Button>
            </div>
        </form>
    );
}

// ── Routines modal ───────────────────────────────────────────

function RoutinesModal({
    isOpen,
    onOpenChange,
    routines,
    onChange,
}: {
    isOpen: boolean;
    onOpenChange: (o: boolean) => void;
    routines: RoutineDTO[];
    onChange: () => void;
}) {
    const [editing, setEditing] = useState<RoutineDTO | null>(null);

    function run(action: (fd: FormData) => Promise<unknown>, fd: FormData, ok: string) {
        runAction(action, fd, toast, ok).then((done) => done && onChange());
    }

    return (
        <FormModal isOpen={isOpen} onOpenChange={(o) => { if (!o) setEditing(null); onOpenChange(o); }} title="Routines" description="Recurring tasks that materialize into your days.">
            {editing ? (
                <RoutineEditForm
                    routine={editing}
                    onCancel={() => setEditing(null)}
                    onSave={(fd) => {
                        fd.set("id", editing.id);
                        runAction(updateRoutine, fd, toast, "Routine updated").then((done) => {
                            if (done) {
                                setEditing(null);
                                onChange();
                            }
                        });
                    }}
                />
            ) : (
                <div className="flex flex-col gap-2">
                    {routines.length === 0 && <p className="py-6 text-center text-sm text-tertiary">No routines yet. Create one from the quick-add bar with a frequency.</p>}
                    {routines.map((r) => (
                        <div key={r.id} className={cx("flex items-start gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset", !r.active && "opacity-60")}>
                            <Repeat04 className="mt-0.5 size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <p className="text-sm font-medium text-primary">{r.title}</p>
                                    {r.streak >= 2 && (
                                        <Badge color="orange" size="sm" type="pill-color" className="tabular-nums">
                                            🔥 {r.streak}
                                        </Badge>
                                    )}
                                </div>
                                <p className="text-xs text-tertiary">{cadenceLabel(r.cadence, r)}</p>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-quaternary">
                                    {r.nextOccurrence && <span>Next: {prettyDate(r.nextOccurrence)}</span>}
                                    {r.endDate && <span>Ends: {prettyDate(r.endDate)}</span>}
                                </div>
                                {r.body && <p className="mt-0.5 text-xs text-tertiary">{r.body}</p>}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <Button
                                    size="sm"
                                    color={r.active ? "secondary" : "primary"}
                                    onClick={() => {
                                        const fd = new FormData();
                                        fd.set("id", r.id);
                                        run(toggleRoutineActive, fd, r.active ? "Paused" : "Activated");
                                    }}
                                >
                                    {r.active ? "Pause" : "Activate"}
                                </Button>
                                <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit routine" onClick={() => setEditing(r)} />
                                <Button
                                    size="sm"
                                    color="tertiary-destructive"
                                    iconLeading={Trash02}
                                    aria-label="Delete routine"
                                    onClick={() => {
                                        const fd = new FormData();
                                        fd.set("id", r.id);
                                        run(deleteRoutine, fd, "Routine deleted");
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </FormModal>
    );
}

function RoutineEditForm({ routine, onSave, onCancel }: { routine: RoutineDTO; onSave: (fd: FormData) => void; onCancel: () => void }) {
    const [cadence, setCadence] = useState<RoutineDTO["cadence"]>(routine.cadence);
    const [dows, setDows] = useState<string[]>(routine.daysOfWeek);
    const [timeOfDay, setTimeOfDay] = useState<TimeOfDayValue | "">(routine.timeOfDay ?? "");
    const [durationMinutes, setDurationMinutes] = useState<number | null>(routine.durationMinutes);

    return (
        <form
            action={(fd) => {
                fd.set("cadence", cadence);
                fd.set("daysOfWeek", dows.join(","));
                fd.set("timeOfDay", timeOfDay);
                fd.set("durationMinutes", durationMinutes != null ? String(durationMinutes) : "");
                onSave(fd);
            }}
            className="flex flex-col gap-4"
        >
            <Field label="Title" htmlFor="r-title" required>
                <NativeInput id="r-title" name="title" defaultValue={routine.title} required />
            </Field>
            <Field label="Details" htmlFor="r-body">
                <NativeTextarea id="r-body" name="body" defaultValue={routine.body ?? ""} />
            </Field>
            <Field label="Frequency" htmlFor="r-cadence">
                <NativeSelect id="r-cadence" value={cadence} onChange={(e) => setCadence(e.target.value as RoutineDTO["cadence"])}>
                    <option value="DAILY">Every day</option>
                    <option value="EVERY_N_DAYS">Every N days</option>
                    <option value="WEEKLY_DOW">Specific weekdays</option>
                    <option value="YEARLY">Every year</option>
                </NativeSelect>
            </Field>
            {cadence === "EVERY_N_DAYS" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Interval (days)" htmlFor="r-interval">
                        <NativeInput id="r-interval" name="intervalN" type="number" min={1} defaultValue={routine.intervalN ?? 2} />
                    </Field>
                    <Field label="Starting from" htmlFor="r-anchor" hint="Counts the interval from this day.">
                        <NativeInput id="r-anchor" name="anchorDate" type="date" defaultValue={routine.anchorDate ?? ""} />
                    </Field>
                </div>
            )}
            {cadence === "WEEKLY_DOW" && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {DOW.map((d) => (
                        <button
                            key={d}
                            type="button"
                            onClick={() => setDows((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
                            className={cx(
                                "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition duration-100 ease-linear",
                                dows.includes(d) ? "bg-brand-primary text-brand-secondary ring-brand" : "text-tertiary ring-secondary hover:bg-secondary_hover",
                            )}
                        >
                            {d[0] + d.slice(1).toLowerCase()}
                        </button>
                    ))}
                </div>
            )}
            {cadence === "YEARLY" && (
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Month" htmlFor="r-month">
                        <NativeSelect id="r-month" name="yearlyMonth" defaultValue={routine.yearlyMonth ?? 1}>
                            {MONTHS.map((m, i) => (
                                <option key={m} value={i + 1}>
                                    {m}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                    <Field label="Day" htmlFor="r-day">
                        <NativeInput id="r-day" name="yearlyDay" type="number" min={1} max={31} defaultValue={routine.yearlyDay ?? 1} />
                    </Field>
                </div>
            )}
            <Field label="End date" htmlFor="r-enddate" hint="Optional — stop creating occurrences after this day.">
                <NativeInput id="r-enddate" name="endDate" type="date" defaultValue={routine.endDate ?? ""} />
            </Field>
            <FormDateInput name="startTime" label="Start time" variant="time" hint="Optional — each occurrence lands here on the calendar." defaultValue={routine.startTime ?? ""} />
            <Field label="Time of day">
                <TimeOfDayPicker value={timeOfDay} onChange={setTimeOfDay} />
            </Field>
            <Field label="Estimated duration">
                <DurationPicker value={durationMinutes} onChange={setDurationMinutes} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
                <Button color="secondary" type="button" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit">Save routine</Button>
            </div>
        </form>
    );
}

function toLocalInput(iso: string | null) {
    if (!iso) return "";
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
