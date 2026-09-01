"use client";

import { useCallback, useEffect, useMemo, useState, type FC, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
    addDays,
    addMonths,
    eachDayOfInterval,
    endOfMonth,
    endOfWeek,
    format,
    isSameDay,
    isSameMonth,
    isToday,
    isWeekend,
    startOfMonth,
    startOfWeek,
} from "date-fns";
import {
    Activity,
    BatteryFull,
    Beaker02,
    Bell01,
    Briefcase01,
    CalendarHeart01,
    Gift01,
    Heart,
    Check,

    CheckSquare,
    ChevronLeft,
    ChevronRight,
    Clock,
    Coins01,
    CreditCard02,
    FileCheck02,
    LayoutRight,
    LinkExternal01,
    Plus,
    Target04,
    Trash02,
    X,
} from "@untitledui/icons";
import { reminderIcon } from "@/components/application/reminders/icon-registry";
import { resolveIcon } from "@/components/application/icon-picker/icon-registry";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import { Tabs } from "@/components/application/tabs/tabs";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger } from "react-aria-components";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Popover } from "@/components/base/select/popover";
import { cx } from "@/utils/cx";
import { Card, Field, FormModal, NativeInput, NativeSelect, NativeTextarea, categoryColor } from "./_components/calendar-ui";
import { Input } from "@/components/base/input/input";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { formatDate, formatTime } from "@/lib/dates";
import {
    formatDuration,
    formatHHMM,
    hhmmToMinutes,
    summarizeCapacity,
    TIME_OF_DAY_LABEL,
    TIME_ZONES,
    todoGridPlacement,
    type TimeOfDayValue,
} from "@/lib/todos-shared";
import { formatCurrency } from "@/lib/financial/format";
import { createEvent, deleteEvent, updateEvent } from "@/lib/actions/calendar";
import { completeReminder, snoozeReminder } from "@/lib/actions/reminders";
import { setTodoStatus } from "@/lib/actions/todos";
import { togglePeptideOccurrence } from "@/lib/actions/peptides";
import { logDose, skipDose, resetDose } from "@/lib/actions/therapeutics";

/** Stable identity for the filter bar. Events are grouped by their category id
 *  (or "uncategorized"); overlays each get a fixed source key. */
export type CalendarSource =
    | "job-meeting"
    | "job-deadline"
    | "job-update"
    | "workout"
    | "dose"
    | "reminder"
    | "todo"
    | "statement"
    | "focus"
    | "peptide"
    | "social-event"
    | "social-battery"
    | "social-birthday"
    | "contact-reminder"
    | "health-metric"
    | "health-vital"
    | "sobriety";

export interface CalendarItem {
    id: string;
    kind: "event" | "overlay";
    /** Overlay source for non-event items; null for user events. */
    source: CalendarSource | null;
    title: string;
    startsAt: string;
    endsAt: string | null;
    allDay: boolean;
    color: string;
    categoryName: string | null;
    /** Category id for user events (null = uncategorized); null for overlays. */
    categoryId: string | null;
    /** Category icon NAME for user events (resolved client-side); null otherwise. */
    iconName?: string | null;
    eventKind: "EVENT" | "APPOINTMENT" | null;
    href: string | null;
    editable: boolean;
    /** Completed/fulfilled — rendered struck-through (dose taken, deadline met, todo done, focus finished). */
    done?: boolean;
    meta: {
        description?: string | null;
        location?: string | null;
        categoryId?: string | null;
        providerId?: string | null;
        doctorId?: string | null;
        visitNotes?: string | null;
        attendees?: Array<{ contactId: string | null; name: string | null; email: string | null }>;
        reminders?: Array<{ minutesBefore: number; channel: string }>;
        /** For reminder overlays: the stored @untitledui/icons component name. */
        reminderIconName?: string | null;
        /** For reminder overlays: the underlying RecurringReminder id. */
        reminderId?: string | null;
        /** For todo overlays. */
        todoId?: string | null;
        todoStatus?: string | null;
        todoStartTime?: string | null;
        todoDurationMinutes?: number | null;
        todoTimeOfDay?: TimeOfDayValue | null;
        /** For statement overlays: "open" (period start) | "close" (period end). */
        statementMarker?: "open" | "close";
        /** For focus session overlays. */
        focusCompleted?: boolean;
        focusDuration?: number | null;
        /** For peptide dose overlays. */
        peptideColor?: string;
        peptideTaken?: boolean;
        /** For social battery overlays. */
        batteryLevel?: number;
        contactId?: string;
        metricType?: string;
        value?: number | null;
        value2?: number | null;
        unit?: string | null;
        vitalType?: string;
        doseLogged?: boolean;
        doseSkipped?: boolean;
        statementId?: string;
        peptideId?: string;
        peptideDate?: string;
        sobrietyCounterId?: string;
        sobrietyCounterName?: string;
    };
}

/** Per-day nutrition summary (calories logged + meal count) used for the day chip. */
export interface NutritionDaySummary {
    /** yyyy-MM-dd (local day). */
    day: string;
    calories: number;
    mealCount: number;
    /** User's daily calorie goal, or null when unset. */
    goal: number | null;
}

/** Per-day financial transaction rollup used for the day chip. */
export interface TxnDaySummary {
    /** yyyy-MM-dd (local day). */
    day: string;
    count: number;
    /** Net sum of the day's transaction amounts (negative = net outflow). */
    net: number;
}

/** A single transaction row surfaced in the Today panel. */
export interface TxnEntry {
    id: string;
    /** yyyy-MM-dd (local day). */
    day: string;
    merchant: string;
    amount: number;
}

/** Lightweight todo row used by the Today panel + grid badge + time-grid blocks. */
export interface TodoEntry {
    id: string;
    title: string;
    status: string;
    /** ISO of the day this todo belongs to (local). */
    day: string;
    dueAt: string | null;
    /** Part-of-day bucket (zone-band placement). */
    timeOfDay: TimeOfDayValue | null;
    /** "HH:MM" wall-clock for a positioned block; null = float into zone. */
    startTime: string | null;
    /** Estimated minutes — block height + daily capacity. */
    durationMinutes: number | null;
}
interface CategoryOption {
    id: string;
    name: string;
    color: string;
    icon: string | null;
}
interface Option {
    id: string;
    name?: string;
    displayName?: string;
}

const UNCATEGORIZED = "cat:uncategorized";

const SOURCE_META: Record<CalendarSource, { label: string; color: string; icon: FC<{ className?: string }> }> = {
    "job-meeting": { label: "Job meetings", color: "sky", icon: Briefcase01 },
    "job-deadline": { label: "Job deadlines", color: "red", icon: Briefcase01 },
    "job-update": { label: "Application updates", color: "indigo", icon: Briefcase01 },
    workout: { label: "Workouts", color: "emerald", icon: Activity },
    dose: { label: "Doses", color: "amber", icon: Beaker02 },
    reminder: { label: "Reminders", color: "violet", icon: Bell01 },
    todo: { label: "Todos", color: "indigo", icon: CheckSquare },
    statement: { label: "Statements", color: "blue", icon: FileCheck02 },
    focus: { label: "Focus", color: "rose", icon: Target04 },
    peptide: { label: "Peptides", color: "purple", icon: Beaker02 },
    "social-event": { label: "Social events", color: "pink", icon: CalendarHeart01 },
    "social-battery": { label: "Social battery", color: "brand", icon: BatteryFull },
    "social-birthday": { label: "Birthdays & dates", color: "rose", icon: Gift01 },
    "contact-reminder": { label: "Contact reminders", color: "violet", icon: Bell01 },
    "health-metric": { label: "Body metrics", color: "teal", icon: Activity },
    "health-vital": { label: "Vitals", color: "cyan", icon: Heart },
    sobriety: { label: "Sobriety", color: "red", icon: X },
};

/** Virtual filter keys for the per-day summary overlays (not CalendarItems). */
const NUTRITION_FILTER = "src:nutrition";
const TXN_FILTER = "src:transactions";

/** The filter key uniquely identifying a chip / an item's bucket. */
function filterKey(it: CalendarItem): string {
    if (it.kind === "overlay" && it.source) return `src:${it.source}`;
    return it.categoryId ? `cat:${it.categoryId}` : UNCATEGORIZED;
}

/** Icon hint shown inside a pill (event category icon or overlay source icon). */
function itemIcon(it: CalendarItem): FC<{ className?: string }> | null {
    if (it.kind === "event") return it.iconName ? resolveIcon(it.iconName) : null;
    if (it.source === "reminder") return reminderIcon(it.meta.reminderIconName);
    if (it.source) return SOURCE_META[it.source].icon;
    return null;
}

const calendarRefreshRef: { current: (() => void) | null } = { current: null };

async function run(action: (fd: FormData) => Promise<unknown>, fd: FormData, ok = "Saved") {
    try {
        await action(fd);
        toast.success(ok);
        calendarRefreshRef.current?.();
        return true;
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        return false;
    }
}

async function runVoid(action: () => Promise<void>, ok = "Saved") {
    try {
        await action();
        toast.success(ok);
        calendarRefreshRef.current?.();
        return true;
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        return false;
    }
}

function toLocalInput(iso: string) {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function timeRange(it: CalendarItem) {
    if (it.allDay) return "All day";
    const start = format(new Date(it.startsAt), "HH:mm");
    return it.endsAt ? `${start} – ${format(new Date(it.endsAt), "HH:mm")}` : start;
}

type AttendeeDraft = { contactId: string; name: string; email: string };
type ReminderDraft = { minutesBefore: string; channel: string };

const PANEL_STORAGE_KEY = "lifeos.calendar.todayPanelOpen";

/** Isolated live clock so minute ticks don't re-render the whole calendar. */
function LiveClock() {
    const clock = useLiveClock();
    return (
        <span className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm text-tertiary ring-1 ring-secondary ring-inset sm:flex" aria-live="polite" aria-atomic="true">
            <Clock className="size-3.5 text-fg-quaternary" aria-hidden="true" />
            {clock}
        </span>
    );
}

/** Returns a live-updating formatted clock string (updates every minute). */
function useLiveClock(): string {
    const fmt = useCallback(() => {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
        }).format(new Date());
    }, []);
    const [clock, setClock] = useState(fmt);
    useEffect(() => {
        const tick = () => setClock(fmt());
        // Align to the next minute boundary, then tick once a minute. Both timers are
        // cleared on unmount (the interval must be tracked in the outer scope — a
        // cleanup returned from inside setTimeout is never registered).
        const msToNext = (60 - new Date().getSeconds()) * 1000 - new Date().getMilliseconds();
        let iv: ReturnType<typeof setInterval> | undefined;
        const tid = setTimeout(() => {
            tick();
            iv = setInterval(tick, 60_000);
        }, msToNext);
        return () => {
            clearTimeout(tid);
            if (iv) clearInterval(iv);
        };
    }, [fmt]);
    return clock;
}

export function CalendarClient({
    items,
    todos,
    nutrition,
    transactions,
    transactionRows,
    categories,
    contacts,
    providers,
    doctors,
}: {
    items: CalendarItem[];
    todos: TodoEntry[];
    nutrition: NutritionDaySummary[];
    transactions: TxnDaySummary[];
    transactionRows: TxnEntry[];
    categories: CategoryOption[];
    contacts: Option[];
    providers: Option[];
    doctors: Option[];
}) {
    const router = useRouter();
    // Desktop shows the day panel inline; mobile/tablet uses the slideout. We must
    // never MOUNT the slideout (an open React Aria Modal) on desktop — even hidden
    // with `lg:hidden` it keeps its focus-scope + scroll-lock active, which thrashes
    // the main thread against a display:none subtree and freezes the page.
    const isDesktop = useBreakpoint("lg");
    const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
    const [view, setView] = useState<"month" | "week" | "today">("month");
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<CalendarItem | null>(null);
    const [defaultDate, setDefaultDate] = useState<Date | null>(null);
    const [detail, setDetail] = useState<CalendarItem | null>(null);

    // ── Today / selected-day panel ───────────────────────────
    const [panelOpen, setPanelOpen] = useState(false);
    const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());

    // Restore persisted open/closed state once on mount.
    useEffect(() => {
        try {
            if (localStorage.getItem(PANEL_STORAGE_KEY) === "1") setPanelOpen(true);
        } catch {
            /* ignore */
        }
    }, []);

    useEffect(() => {
        calendarRefreshRef.current = () => router.refresh();
        return () => {
            calendarRefreshRef.current = null;
        };
    }, [router]);
    function togglePanel() {
        setPanelOpen((v) => {
            const next = !v;
            try {
                localStorage.setItem(PANEL_STORAGE_KEY, next ? "1" : "0");
            } catch {
                /* ignore */
            }
            return next;
        });
    }
    /** Click handler for a pill: todos open the day panel, everything else the detail modal. */
    function onItemSelect(it: CalendarItem) {
        if (it.source === "todo") {
            selectDay(new Date(it.startsAt));
        } else {
            setDetail(it);
        }
    }
    /** Select a day cell and reveal the panel. */
    function selectDay(d: Date) {
        setSelectedDay(d);
        if (!panelOpen) {
            setPanelOpen(true);
            try {
                localStorage.setItem(PANEL_STORAGE_KEY, "1");
            } catch {
                /* ignore */
            }
        }
    }

    // ── Filter bar definition: one chip per source bucket ────
    const filters = useMemo(() => {
        const counts = new Map<string, number>();
        let hasUncategorized = false;
        for (const it of items) {
            const k = filterKey(it);
            counts.set(k, (counts.get(k) ?? 0) + 1);
            if (k === UNCATEGORIZED) hasUncategorized = true;
        }
        const out: Array<{ key: string; label: string; color: string; icon: FC<{ className?: string }> | null; count: number }> = [];
        for (const c of categories) {
            out.push({ key: `cat:${c.id}`, label: c.name, color: c.color, icon: null, count: counts.get(`cat:${c.id}`) ?? 0 });
        }
        if (hasUncategorized) {
            out.push({ key: UNCATEGORIZED, label: "Uncategorized", color: "neutral", icon: null, count: counts.get(UNCATEGORIZED) ?? 0 });
        }
        for (const src of Object.keys(SOURCE_META) as CalendarSource[]) {
            const m = SOURCE_META[src];
            out.push({ key: `src:${src}`, label: m.label, color: m.color, icon: m.icon, count: counts.get(`src:${src}`) ?? 0 });
        }
        // Per-day summary overlays (nutrition + transactions): count days logged in window.
        out.push({ key: NUTRITION_FILTER, label: "Nutrition", color: "green", icon: Coins01, count: nutrition.length });
        out.push({ key: TXN_FILTER, label: "Transactions", color: "blue", icon: CreditCard02, count: transactions.length });
        return out;
    }, [items, categories, nutrition.length, transactions.length]);

    // Set of currently-disabled filter keys (off = present in this set).
    const [hidden, setHidden] = useState<Set<string>>(() => new Set());

    function toggleFilter(key: string) {
        setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }
    const allOn = hidden.size === 0;
    const allOff = filters.length > 0 && hidden.size >= filters.length;
    function setAll(on: boolean) {
        setHidden(on ? new Set() : new Set(filters.map((f) => f.key)));
    }

    const visibleItems = useMemo(() => items.filter((it) => !hidden.has(filterKey(it))), [items, hidden]);

    // ── Group visible items by yyyy-MM-dd (local) ────────────
    const byDay = useMemo(() => {
        const map = new Map<string, CalendarItem[]>();
        for (const it of visibleItems) {
            const key = format(new Date(it.startsAt), "yyyy-MM-dd");
            const arr = map.get(key) ?? [];
            arr.push(it);
            map.set(key, arr);
        }
        for (const arr of map.values()) arr.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        return map;
    }, [visibleItems]);

    // Open (not-DONE) todo count per yyyy-MM-dd, for the grid count badge.
    const openTodosByDay = useMemo(() => {
        const map = new Map<string, number>();
        for (const t of todos) {
            if (t.status === "DONE") continue;
            const key = format(new Date(t.day), "yyyy-MM-dd");
            map.set(key, (map.get(key) ?? 0) + 1);
        }
        return map;
    }, [todos]);
    const todoFilterOn = !hidden.has("src:todo");
    const openTodoCount = (d: Date) => (todoFilterOn ? openTodosByDay.get(format(d, "yyyy-MM-dd")) ?? 0 : 0);

    // ── Per-day summary overlays (nutrition + transactions) ───
    const nutritionByDay = useMemo(() => {
        const map = new Map<string, NutritionDaySummary>();
        for (const n of nutrition) map.set(n.day, n);
        return map;
    }, [nutrition]);
    const txnByDay = useMemo(() => {
        const map = new Map<string, TxnDaySummary>();
        for (const t of transactions) map.set(t.day, t);
        return map;
    }, [transactions]);
    const txnRowsByDay = useMemo(() => {
        const map = new Map<string, TxnEntry[]>();
        for (const r of transactionRows) {
            const arr = map.get(r.day) ?? [];
            arr.push(r);
            map.set(r.day, arr);
        }
        return map;
    }, [transactionRows]);

    const nutritionOn = !hidden.has(NUTRITION_FILTER);
    const txnOn = !hidden.has(TXN_FILTER);
    const dayNutrition = (d: Date) => (nutritionOn ? nutritionByDay.get(format(d, "yyyy-MM-dd")) ?? null : null);
    const dayTxn = (d: Date) => (txnOn ? txnByDay.get(format(d, "yyyy-MM-dd")) ?? null : null);
    const dayTxnRows = (d: Date) => (txnOn ? txnRowsByDay.get(format(d, "yyyy-MM-dd")) ?? [] : []);

    // Todos for the currently-selected day (panel).
    const selectedDayTodos = useMemo(
        () => todos.filter((t) => isSameDay(new Date(t.day), selectedDay)).sort((a, b) => a.status.localeCompare(b.status)),
        [todos, selectedDay],
    );

    // Todos for an arbitrary day (time-grid blocks).
    const dayTodos = useCallback((d: Date) => todos.filter((t) => isSameDay(new Date(t.day), d)), [todos]);

    // Map a todo id → its overlay CalendarItem so a grid block opens the
    // detail modal (with Mark done / Skip / Reopen actions).
    const todoOverlayById = useMemo(() => {
        const m = new Map<string, CalendarItem>();
        for (const it of items) if (it.source === "todo" && it.meta.todoId) m.set(it.meta.todoId, it);
        return m;
    }, [items]);
    const onSelectTodo = useCallback(
        (t: TodoEntry) => {
            const overlay = todoOverlayById.get(t.id);
            if (overlay) setDetail(overlay);
            else selectDay(new Date(t.day));
        },
        // selectDay is stable enough for this handler's lifetime.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [todoOverlayById],
    );

    // Individual transactions for the selected day (panel section).
    const selectedDayTxns = dayTxnRows(selectedDay);

    const monthDays = useMemo(() => {
        const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
        const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
        return eachDayOfInterval({ start, end });
    }, [cursor]);

    const weekDays = useMemo(() => {
        const start = startOfWeek(cursor, { weekStartsOn: 0 });
        return eachDayOfInterval({ start, end: addDays(start, 6) });
    }, [cursor]);

    function openNew(date?: Date) {
        setEditing(null);
        setDefaultDate(date ?? new Date());
        setModalOpen(true);
    }
    function openEdit(it: CalendarItem) {
        setEditing(it);
        setDefaultDate(null);
        setModalOpen(true);
        setDetail(null);
    }

    function shift(dir: number) {
        setCursor((c) => {
            if (view === "month") return addMonths(c, dir);
            if (view === "today") return addDays(c, dir);
            return addDays(c, dir * 7);
        });
    }
    function goToday() {
        const today = new Date();
        setCursor(view === "month" ? startOfMonth(today) : today);
        setSelectedDay(today);
    }
    function setViewMode(next: "month" | "week" | "today") {
        setView(next);
        if (next === "today") {
            const today = new Date();
            setCursor(today);
            setSelectedDay(today);
            setPanelOpen(true);
        } else if (next === "month") {
            setCursor((c) => startOfMonth(c));
        }
    }

    const dayItems = (d: Date) => byDay.get(format(d, "yyyy-MM-dd")) ?? [];

    const headerLabel =
        view === "month"
            ? format(cursor, "MMMM yyyy")
            : view === "today"
              ? format(cursor, "EEEE, MMMM d, yyyy")
              : `${format(weekDays[0], "MMM d")} – ${format(weekDays[6], "MMM d, yyyy")}`;
    // Visible days that actually have items (for the mobile agenda fallback).
    const monthAgenda = useMemo(
        () => monthDays.filter((d) => isSameMonth(d, cursor) && (dayItems(d).length > 0 || dayNutrition(d) || dayTxn(d))),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [monthDays, cursor, byDay, nutritionByDay, txnByDay, hidden],
    );

    return (
        <div className="flex flex-col gap-4">
            {/* Toolbar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Button size="sm" color="secondary" iconLeading={ChevronLeft} aria-label="Previous" onClick={() => shift(-1)} />
                    <Button size="sm" color="secondary" onClick={goToday}>Today</Button>
                    <Button size="sm" color="secondary" iconLeading={ChevronRight} aria-label="Next" onClick={() => shift(1)} />
                    <h2 className="w-full text-base font-semibold text-primary sm:ml-2 sm:w-auto sm:text-lg">{headerLabel}</h2>
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    <LiveClock />
                    <Tabs selectedKey={view} onSelectionChange={(k) => setViewMode(k as "month" | "week" | "today")}>
                        <Tabs.List type="button-gray" size="sm">
                            <Tabs.Item id="month">Month</Tabs.Item>
                            <Tabs.Item id="week">Week</Tabs.Item>
                            <Tabs.Item id="today">Today</Tabs.Item>
                        </Tabs.List>
                    </Tabs>
                    <Button
                        size="sm"
                        color={panelOpen ? "primary" : "secondary"}
                        iconLeading={LayoutRight}
                        onClick={togglePanel}
                        aria-pressed={panelOpen}
                    >
                        Today panel
                    </Button>
                    <Button size="sm" iconLeading={Plus} onClick={() => openNew()} className="w-full sm:w-auto">New event</Button>
                </div>
            </div>

            {/* Interactive filter bar (replaces the static legend) */}
            <Card className="flex flex-wrap items-center gap-2 py-3">
                {filters.map((f) => {
                    const c = categoryColor(f.color);
                    const off = hidden.has(f.key);
                    const Icon = f.icon;
                    return (
                        <button
                            key={f.key}
                            type="button"
                            aria-pressed={!off}
                            onClick={() => toggleFilter(f.key)}
                            className={cx(
                                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition duration-100 ease-linear",
                                off
                                    ? "text-quaternary opacity-60 ring-secondary hover:opacity-100"
                                    : "text-secondary ring-secondary hover:bg-secondary_hover",
                            )}
                        >
                            <span className={cx("size-2 rounded-full transition", c.dot, off && "opacity-40")} />
                            {Icon && <Icon className={cx("size-3.5 text-fg-quaternary", off && "opacity-60")} aria-hidden="true" />}
                            <span className={cx(off && "line-through decoration-1")}>{f.label}</span>
                            <span className="tabular-nums text-tertiary">{f.count}</span>
                        </button>
                    );
                })}
                <div className="ml-auto flex items-center gap-1 pl-2">
                    <Button size="sm" color="link-gray" onClick={() => setAll(true)} isDisabled={allOn}>All</Button>
                    <span className="text-quaternary">·</span>
                    <Button size="sm" color="link-gray" onClick={() => setAll(false)} isDisabled={allOff}>None</Button>
                </div>
            </Card>

            <div className="flex gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-4">
            {view === "month" ? (
                <>
                    {/* Desktop / tablet month grid */}
                    <Card className="hidden p-0 sm:block">
                        <div className="grid grid-cols-7 border-b border-secondary">
                            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                                <div key={d} className={cx("px-2 py-2 text-center text-xs font-medium text-tertiary", (i === 0 || i === 6) && "bg-secondary_subtle")}>{d}</div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7">
                            {monthDays.map((d) => {
                                const list = dayItems(d);
                                const inMonth = isSameMonth(d, cursor);
                                const weekend = isWeekend(d);
                                const today = isToday(d);
                                const selected = panelOpen && isSameDay(d, selectedDay);
                                const todoCount = openTodoCount(d);
                                return (
                                    <div
                                        key={d.toISOString()}
                                        className={cx(
                                            "group relative min-h-32 border-b border-r border-secondary p-2 align-top transition [&:nth-child(7n)]:border-r-0",
                                            weekend && "bg-secondary_subtle/60",
                                            !inMonth && "bg-secondary_subtle",
                                            today && "ring-2 ring-brand ring-inset",
                                            selected && "bg-brand-primary/40 ring-2 ring-brand ring-inset",
                                        )}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => openNew(d)}
                                            aria-label={`Add event on ${format(d, "EEEE, MMMM d")}`}
                                            className="absolute inset-0 z-0 rounded-sm transition hover:bg-secondary_hover/50"
                                        />
                                        <div className="relative z-10 flex items-center justify-between">
                                            <button
                                                type="button"
                                                onClick={() => selectDay(d)}
                                                aria-label={`View ${format(d, "EEEE, MMMM d")} in panel`}
                                                className={cx(
                                                    "inline-flex size-6 items-center justify-center rounded-full text-xs transition hover:ring-2 hover:ring-brand",
                                                    today ? "bg-brand-solid font-bold text-white" : inMonth ? "text-secondary" : "text-quaternary",
                                                )}
                                            >
                                                {format(d, "d")}
                                            </button>
                                            {todoCount > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => selectDay(d)}
                                                    aria-label={`${todoCount} open todo${todoCount === 1 ? "" : "s"} on ${format(d, "MMMM d")}`}
                                                    className={cx("relative inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition hover:brightness-95", categoryColor("indigo").chip)}
                                                >
                                                    <CheckSquare className="size-2.5" aria-hidden="true" />
                                                    {todoCount}
                                                </button>
                                            )}
                                        </div>
                                        <div className="relative z-10 mt-1 flex flex-col gap-0.5">
                                            {(() => {
                                                const nut = dayNutrition(d);
                                                const tx = dayTxn(d);
                                                return (nut || tx) ? (
                                                    <div className="flex flex-col gap-0.5">
                                                        {nut && <NutritionChip summary={nut} />}
                                                        {tx && <TxnChip summary={tx} />}
                                                    </div>
                                                ) : null;
                                            })()}
                                            {list.slice(0, 3).map((it) => (
                                                <EventPill key={it.id} item={it} onSelect={() => onItemSelect(it)} />
                                            ))}
                                            {list.length > 3 && <MorePill items={list.slice(3)} date={d} onSelect={onItemSelect} />}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>

                    {/* Mobile agenda fallback */}
                    <div className="flex flex-col gap-3 sm:hidden">
                        {monthAgenda.length === 0 ? (
                            <Card className="flex flex-col items-center gap-3 py-10 text-center">
                                <FeaturedIcon icon={CalendarHeart01} color="brand" theme="light" size="lg" />
                                <div className="flex flex-col gap-1">
                                    <p className="text-md font-semibold text-primary">Nothing scheduled this month</p>
                                    <p className="text-sm text-tertiary">Tap a day or use New event to start planning.</p>
                                </div>
                                <Button size="sm" iconLeading={Plus} onClick={() => openNew()}>New event</Button>
                            </Card>
                        ) : (
                            monthAgenda.map((d) => (
                                <Card key={d.toISOString()} className={cx("flex flex-col gap-2", isToday(d) && "ring-2 ring-brand ring-inset")}>
                                    <div className="flex items-center gap-2">
                                        <span className={cx("text-sm font-semibold", isToday(d) ? "text-brand-secondary" : "text-primary")}>{format(d, "EEE")}</span>
                                        <span className="text-sm text-tertiary">{format(d, "MMM d")}</span>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        {dayNutrition(d) && <NutritionChip summary={dayNutrition(d)!} />}
                                        {dayTxn(d) && <TxnChip summary={dayTxn(d)!} />}
                                        {dayItems(d).map((it) => <EventPill key={it.id} item={it} onSelect={() => onItemSelect(it)} />)}
                                    </div>
                                </Card>
                            ))
                        )}
                    </div>
                </>
            ) : view === "week" ? (
                <>
                    <div className="hidden sm:block">
                        <WeekView weekDays={weekDays} dayItems={dayItems} dayTodos={dayTodos} dayNutrition={dayNutrition} dayTxn={dayTxn} onSelect={setDetail} onSelectTodo={onSelectTodo} onAdd={openNew} onSelectDay={selectDay} />
                    </div>
                    <div className="flex flex-col gap-3 sm:hidden">
                        {weekDays.map((d) => (
                            <Card key={d.toISOString()} className={cx("flex flex-col gap-2", isToday(d) && "ring-2 ring-brand ring-inset")}>
                                <button type="button" onClick={() => selectDay(d)} className="flex items-center justify-between text-left">
                                    <span className="text-sm font-semibold text-primary">{format(d, "EEEE, MMM d")}</span>
                                    {isToday(d) && <Badge size="sm" color="brand">Today</Badge>}
                                </button>
                                {dayNutrition(d) && <NutritionChip summary={dayNutrition(d)!} />}
                                {dayTxn(d) && <TxnChip summary={dayTxn(d)!} />}
                                {dayItems(d).length === 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => openNew(d)}
                                        className="flex items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-xs text-tertiary transition duration-100 ease-linear hover:text-secondary"
                                    >
                                        <Plus className="size-3.5" aria-hidden="true" /> Add event
                                    </button>
                                ) : (
                                    dayItems(d).map((it) => <EventPill key={it.id} item={it} onSelect={() => onItemSelect(it)} />)
                                )}
                            </Card>
                        ))}
                    </div>
                </>
            ) : (
                <div className="flex flex-col gap-4">
                    <TimeGrid
                        days={[cursor]}
                        getEvents={(d) => dayItems(d).filter((it) => it.source !== "todo")}
                        getTodos={dayTodos}
                        dayNutrition={dayNutrition}
                        dayTxn={dayTxn}
                        onSelect={setDetail}
                        onSelectTodo={onSelectTodo}
                        onAdd={openNew}
                        onSelectDay={selectDay}
                    />
                    <Card className="p-0">
                        <TodayAgendaView
                            day={cursor}
                            items={dayItems(cursor)}
                            todos={todos.filter((t) => isSameDay(new Date(t.day), cursor))}
                            transactions={dayTxnRows(cursor)}
                            onSelectItem={onItemSelect}
                            onQuickAdd={() => openNew(cursor)}
                        />
                    </Card>
                </div>
            )}
              </div>

              {/* Inline desktop panel */}
              {panelOpen && isDesktop && (
                  <div className="hidden w-90 shrink-0 lg:block">
                      <Card className="sticky top-4 flex max-h-[calc(100vh-2rem)] flex-col gap-4 overflow-y-auto p-4">
                          <DayPanel
                              day={selectedDay}
                              items={dayItems(selectedDay)}
                              todos={selectedDayTodos}
                              transactions={selectedDayTxns}
                              onSelectItem={setDetail}
                              onClose={togglePanel}
                              onQuickAdd={openNew}
                          />
                      </Card>
                  </div>
              )}
            </div>

            {/* Mobile / tablet slideout panel — only mounted off-desktop so the open
                modal's focus-scope/scroll-lock never runs behind the inline panel. */}
            {!isDesktop && (
                <SlideoutMenu isOpen={panelOpen} onOpenChange={setPanelOpen}>
                    <SlideoutMenu.Content className="py-6">
                        <DayPanel
                            day={selectedDay}
                            items={dayItems(selectedDay)}
                            todos={selectedDayTodos}
                            transactions={selectedDayTxns}
                            onSelectItem={(it) => { setPanelOpen(false); setDetail(it); }}
                            onClose={() => setPanelOpen(false)}
                            onQuickAdd={(d) => { setPanelOpen(false); openNew(d); }}
                        />
                    </SlideoutMenu.Content>
                </SlideoutMenu>
            )}

            <EventModal
                key={editing?.id ?? defaultDate?.toISOString() ?? "new"}
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                editing={editing}
                defaultDate={defaultDate}
                categories={categories}
                contacts={contacts}
                providers={providers}
                doctors={doctors}
            />

            {/* Detail popover modal */}
            <FormModal isOpen={!!detail} onOpenChange={(o) => !o && setDetail(null)} title={detail?.title ?? ""} description={detail?.categoryName ?? undefined}>
                {detail && (
                    <div className="flex flex-col gap-4 text-sm">
                        {(() => {
                            const DetailIcon = itemIcon(detail);
                            const dc = categoryColor(detail.color);
                            return DetailIcon ? (
                                <span className={cx("inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", dc.chip)}>
                                    <DetailIcon className="size-3.5" aria-hidden="true" />
                                    {detail.categoryName ?? "Event"}
                                </span>
                            ) : null;
                        })()}
                        <p className="text-secondary">
                            {detail.allDay ? formatDate(detail.startsAt) + " · All day" : `${formatDate(detail.startsAt)}, ${formatTime(detail.startsAt)}${detail.endsAt ? ` – ${formatTime(detail.endsAt)}` : ""}`}
                        </p>
                        {detail.source === "todo" && (detail.meta.todoTimeOfDay || detail.meta.todoStartTime || detail.meta.todoDurationMinutes != null) && (
                            <div className="flex flex-wrap items-center gap-1.5">
                                {detail.meta.todoTimeOfDay && (
                                    <Badge color="gray" size="sm" type="pill-color">{TIME_OF_DAY_LABEL[detail.meta.todoTimeOfDay]}</Badge>
                                )}
                                {detail.meta.todoStartTime && (
                                    <Badge color="gray" size="sm" type="modern" className="gap-1">
                                        <Clock className="size-3" aria-hidden="true" /> {formatHHMM(detail.meta.todoStartTime)}
                                    </Badge>
                                )}
                                {detail.meta.todoDurationMinutes != null && (
                                    <Badge color="gray" size="sm" type="modern">≈ {formatDuration(detail.meta.todoDurationMinutes)}</Badge>
                                )}
                            </div>
                        )}
                        {detail.meta.location && <p className="text-tertiary">📍 {detail.meta.location}</p>}
                        {detail.meta.description && <p className="whitespace-pre-wrap text-tertiary">{detail.meta.description}</p>}
                        {detail.meta.visitNotes && <p className="whitespace-pre-wrap text-tertiary">Visit notes: {detail.meta.visitNotes}</p>}
                        {!!detail.meta.attendees?.length && (
                            <div className="flex flex-wrap gap-1.5">
                                {detail.meta.attendees.map((a, i) => <Badge key={i} color="gray" size="sm">{a.name ?? a.email ?? "Guest"}</Badge>)}
                            </div>
                        )}
                        {detail.source === "dose" && detail.meta.doseLogged && (
                            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success-secondary px-2.5 py-1 text-xs font-medium text-success-primary">
                                <Check className="size-3.5" aria-hidden="true" /> Taken
                            </span>
                        )}
                        {detail.source === "dose" && detail.meta.doseSkipped && (
                            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warning-secondary px-2.5 py-1 text-xs font-medium text-warning-primary">
                                <X className="size-3.5" aria-hidden="true" /> Skipped
                            </span>
                        )}
                        {detail.source === "peptide" && detail.meta.peptideId && detail.meta.peptideDate && (
                            <span className={cx(
                                "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                                detail.meta.peptideTaken ? "bg-success-secondary text-success-primary" : "bg-secondary text-tertiary",
                            )}>
                                {detail.meta.peptideTaken ? <Check className="size-3.5" aria-hidden="true" /> : <Beaker02 className="size-3.5" aria-hidden="true" />}
                                {detail.meta.peptideTaken ? "Taken" : "Not taken"}
                            </span>
                        )}
                        {detail.done && detail.source !== "dose" && detail.source !== "peptide" && (
                            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success-secondary px-2.5 py-1 text-xs font-medium text-success-primary">
                                <Check className="size-3.5" aria-hidden="true" /> Completed
                            </span>
                        )}
                        <div className="flex flex-wrap justify-end gap-2 pt-2">
                            {/* Therapeutic dose (meds/supplements) — log / skip / reset */}
                            {detail.source === "dose" && (() => {
                                const doseId = detail.id.replace(/^td-/, "");
                                return detail.meta.doseLogged || detail.meta.doseSkipped ? (
                                    <Button size="sm" color="secondary" iconLeading={Clock} onClick={async () => { if (await run(() => resetDose(doseId), new FormData(), "Reset")) setDetail(null); }}>Reset</Button>
                                ) : (
                                    <>
                                        <Button size="sm" color="secondary" onClick={async () => { if (await run(() => skipDose(doseId), new FormData(), "Skipped")) setDetail(null); }}>Skip</Button>
                                        <Button size="sm" iconLeading={Check} onClick={async () => { if (await run(() => logDose(doseId), new FormData(), "Logged")) setDetail(null); }}>Log taken</Button>
                                    </>
                                );
                            })()}

                            {/* Peptide dose — toggle taken */}
                            {detail.source === "peptide" && detail.meta.peptideId && detail.meta.peptideDate && (
                                <Button
                                    size="sm"
                                    color={detail.meta.peptideTaken ? "secondary" : "primary"}
                                    iconLeading={detail.meta.peptideTaken ? X : Check}
                                    onClick={async () => {
                                        const pid = detail.meta.peptideId!;
                                        const date = detail.meta.peptideDate!;
                                        const ok = await runVoid(
                                            () => togglePeptideOccurrence(pid, date),
                                            detail.meta.peptideTaken ? "Dose un-logged" : "Dose logged",
                                        );
                                        if (ok) setDetail(null);
                                    }}
                                >
                                    {detail.meta.peptideTaken ? "Un-log dose" : "Log taken"}
                                </Button>
                            )}

                            {/* Todo — mark done / reopen */}
                            {detail.source === "todo" && detail.meta.todoId && (
                                detail.done ? (
                                    <Button size="sm" color="secondary" onClick={async () => { const fd = new FormData(); fd.set("id", detail.meta.todoId!); fd.set("status", "PLANNED"); if (await run(setTodoStatus, fd, "Reopened")) setDetail(null); }}>Reopen</Button>
                                ) : (
                                    <Button size="sm" iconLeading={Check} onClick={async () => { const fd = new FormData(); fd.set("id", detail.meta.todoId!); fd.set("status", "DONE"); if (await run(setTodoStatus, fd, "Completed")) setDetail(null); }}>Mark done</Button>
                                )
                            )}

                            {/* Recurring reminder — done / snooze */}
                            {detail.source === "reminder" && detail.meta.reminderId && (
                                <>
                                    <Button size="sm" color="secondary" iconLeading={Clock} onClick={async () => { const fd = new FormData(); fd.set("id", detail.meta.reminderId!); fd.set("days", "1"); if (await run(snoozeReminder, fd, "Snoozed 1 day")) setDetail(null); }}>Snooze 1d</Button>
                                    <Button size="sm" iconLeading={Check} onClick={async () => { const fd = new FormData(); fd.set("id", detail.meta.reminderId!); if (await run(completeReminder, fd, "Marked done")) setDetail(null); }}>Mark done</Button>
                                </>
                            )}

                            {detail.href && (
                                <Button
                                    size="sm"
                                    color="secondary"
                                    iconLeading={LinkExternal01}
                                    href={
                                        detail.source === "statement" && detail.meta.statementId
                                            ? `/financial/statements?highlight=${detail.meta.statementId}`
                                            : detail.href
                                    }
                                >
                                    {detail.source === "peptide"
                                        ? "Open peptide"
                                        : detail.source === "todo"
                                          ? "All todos"
                                          : detail.source === "job-deadline" || detail.source === "job-update" || detail.source === "job-meeting"
                                            ? "Open application"
                                            : detail.source === "social-event"
                                              ? "Social events"
                                              : detail.source === "sobriety"
                                                ? "Sobriety tracker"
                                                : detail.source === "statement"
                                                  ? "View statement"
                                                  : "Open source"}
                                </Button>
                            )}
                            {detail.source === "todo" && detail.meta.todoId && detail.meta.todoStatus !== "SKIPPED" && !detail.done && (
                                <Button
                                    size="sm"
                                    color="secondary"
                                    onClick={async () => {
                                        const fd = new FormData();
                                        fd.set("id", detail.meta.todoId!);
                                        fd.set("status", "SKIPPED");
                                        if (await run(setTodoStatus, fd, "Skipped")) setDetail(null);
                                    }}
                                >
                                    Skip
                                </Button>
                            )}
                            {detail.editable && (
                                <>
                                    <Button size="sm" color="secondary-destructive" iconLeading={Trash02} onClick={async () => { const fd = new FormData(); fd.set("id", detail.id); if (await run(deleteEvent, fd, "Deleted")) setDetail(null); }}>Delete</Button>
                                    <Button size="sm" onClick={() => openEdit(detail)}>Edit</Button>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </FormModal>
        </div>
    );
}

/**
 * Full-width single-day agenda used by the "Today" view mode.
 * Shows today's plans, reminders, todos, and transactions in larger cards.
 */
function TodayAgendaView({
    day,
    items,
    todos,
    transactions,
    onSelectItem,
    onQuickAdd,
}: {
    day: Date;
    items: CalendarItem[];
    todos: TodoEntry[];
    transactions: TxnEntry[];
    onSelectItem: (it: CalendarItem) => void;
    onQuickAdd: () => void;
}) {
    const router = useRouter();
    const reminders = items.filter((it) => it.source === "reminder");
    const events = items
        .filter((it) => it.kind === "event" || (it.source !== "reminder" && it.source !== "todo"))
        .sort((a, b) => Number(a.allDay) - Number(b.allDay) || a.startsAt.localeCompare(b.startsAt));
    const dayLabel = isToday(day) ? "Today" : format(day, "EEEE");

    return (
        <div className="flex flex-col gap-6 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-display-xs font-semibold text-primary">{dayLabel}</h2>
                    <p className="text-md text-tertiary">{formatDate(day)}</p>
                </div>
                <Button size="md" iconLeading={Plus} onClick={onQuickAdd}>
                    Add event
                </Button>
            </div>

            <QuickAddEvent day={day} onMore={onQuickAdd} />

            <PanelSection title="Schedule" count={events.length}>
                {events.length === 0 ? (
                    <PanelEmpty
                        icon={CalendarHeart01}
                        title="Your day is wide open"
                        description="Add an event or appointment to start shaping your day."
                        actionLabel="Add event"
                        onAction={onQuickAdd}
                    />
                ) : (
                    <div className="flex flex-col gap-2">
                        {events.map((it) => {
                            const Icon = itemIcon(it);
                            const c = categoryColor(it.color);
                            return (
                                <button
                                    key={it.id}
                                    type="button"
                                    onClick={() => onSelectItem(it)}
                                    className="flex items-center gap-3 rounded-xl px-4 py-3.5 text-left ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover"
                                >
                                    <span className={cx("flex size-10 shrink-0 items-center justify-center rounded-lg", c.chip)}>
                                        {Icon ? <Icon className="size-5" aria-hidden="true" /> : <span className={cx("size-2.5 rounded-full", c.dot)} />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className={cx("block text-sm", it.done ? "text-tertiary line-through" : "font-semibold text-primary")}>{it.title}</span>
                                        <span className="block text-xs text-tertiary">{timeRange(it)}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </PanelSection>

            <PanelSection title="Reminders" count={reminders.length}>
                {reminders.length === 0 ? (
                    <PanelEmpty
                        icon={Bell01}
                        title="No reminders due"
                        description="You're all caught up — nothing needs your attention today."
                    />
                ) : (
                    <div className="flex flex-col gap-2">
                        {reminders.map((it) => (
                            <PanelReminder key={it.id} item={it} />
                        ))}
                    </div>
                )}
            </PanelSection>

            <PanelSection title="Todos" count={todos.length}>
                {todos.length === 0 ? (
                    <PanelEmpty
                        icon={CheckSquare}
                        title="No todos for this day"
                        description="Plan tasks in To-dos and they'll show up right here."
                    />
                ) : (
                    <div className="flex flex-col gap-2">
                        {todos.map((t) => (
                            <PanelTodo key={t.id} todo={t} />
                        ))}
                    </div>
                )}
            </PanelSection>

            <PanelSection title="Transactions" count={transactions.length}>
                {transactions.length === 0 ? (
                    <PanelEmpty
                        icon={CreditCard02}
                        title="No transactions logged"
                        description="Spending synced from your accounts will appear here by day."
                    />
                ) : (
                    <div className="flex flex-col gap-2">
                        {transactions.map((t) => {
                            const out = t.amount < 0;
                            return (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => router.push(`/financial/transactions?from=${format(day, "yyyy-MM-dd")}&to=${format(day, "yyyy-MM-dd")}`)}
                                    className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left ring-1 ring-secondary ring-inset transition hover:bg-secondary_hover"
                                >
                                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-utility-blue-50 text-utility-blue-700">
                                        <CreditCard02 className="size-5" aria-hidden="true" />
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">{t.merchant}</span>
                                    <span className={cx("shrink-0 text-sm font-semibold tabular-nums", out ? "text-error-primary" : "text-success-primary")}>
                                        {out ? "-" : "+"}
                                        {formatCurrency(Math.abs(t.amount))}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </PanelSection>
        </div>
    );
}

/**
 * Right-hand panel for a single selected day: events, reminders due (with
 * inline Done/snooze), todos (with inline status controls) and a quick event
 * add. Shared between the inline desktop column and the mobile slideout.
 */
function DayPanel({
    day,
    items,
    todos,
    transactions,
    onSelectItem,
    onClose,
    onQuickAdd,
}: {
    day: Date;
    items: CalendarItem[];
    todos: TodoEntry[];
    transactions: TxnEntry[];
    onSelectItem: (it: CalendarItem) => void;
    onClose: () => void;
    onQuickAdd: (d: Date) => void;
}) {
    const router = useRouter();
    const reminders = items.filter((it) => it.source === "reminder");
    const events = items
        .filter((it) => it.kind === "event" || (it.source !== "reminder" && it.source !== "todo"))
        .sort((a, b) => Number(a.allDay) - Number(b.allDay) || a.startsAt.localeCompare(b.startsAt));
    const dayLabel = isToday(day) ? "Today" : format(day, "EEEE");

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <h2 className="text-md font-semibold text-primary">{dayLabel}</h2>
                    <p className="text-sm text-tertiary">{formatDate(day)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        aria-label="New event"
                        onClick={() => onQuickAdd(day)}
                        className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-fg-quaternary transition hover:bg-primary_hover hover:text-secondary"
                    >
                        <Plus className="size-3.5" aria-hidden="true" />
                        New
                    </button>
                    <button
                        type="button"
                        aria-label="Close panel"
                        onClick={onClose}
                        className="rounded-md p-1.5 text-fg-quaternary transition hover:bg-primary_hover hover:text-fg-quaternary_hover"
                    >
                        <X className="size-5" aria-hidden="true" />
                    </button>
                </div>
            </div>

            {/* Quick add */}
            <QuickAddEvent day={day} onMore={() => onQuickAdd(day)} />

            {/* Events */}
            <PanelSection title="Events" count={events.length}>
                {events.length === 0 ? (
                    <PanelEmpty
                        icon={CalendarHeart01}
                        title="Nothing scheduled"
                        description="Add an event to plan out this day."
                        actionLabel="Add event"
                        onAction={() => onQuickAdd(day)}
                    />
                ) : (
                    <div className="flex flex-col gap-1.5">
                        {events.map((it) => {
                            const Icon = itemIcon(it);
                            const c = categoryColor(it.color);
                            return (
                                <button
                                    key={it.id}
                                    type="button"
                                    onClick={() => onSelectItem(it)}
                                    className="flex items-center gap-3 rounded-lg px-4 py-3 text-left transition duration-100 ease-linear hover:bg-secondary_hover hover:ring-1 hover:ring-secondary hover:ring-inset"
                                >
                                    <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-md", c.chip)}>
                                        {Icon ? <Icon className="size-4" aria-hidden="true" /> : <span className={cx("size-2 rounded-full", c.dot)} />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className={cx("block truncate text-sm", it.done ? "text-tertiary line-through" : "font-medium text-primary")}>{it.title}</span>
                                        <span className="block text-xs text-tertiary">{timeRange(it)}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </PanelSection>

            {/* Reminders due */}
            <PanelSection title="Reminders" count={reminders.length}>
                {reminders.length === 0 ? (
                    <PanelEmpty icon={Bell01} title="Nothing due" description="No reminders land on this day." />
                ) : (
                    <div className="flex flex-col gap-1.5">
                        {reminders.map((it) => (
                            <PanelReminder key={it.id} item={it} />
                        ))}
                    </div>
                )}
            </PanelSection>

            {/* Todos */}
            <PanelSection title="Todos" count={todos.length}>
                {todos.length === 0 ? (
                    <PanelEmpty icon={CheckSquare} title="No todos" description="Tasks scheduled for this day show up here." />
                ) : (
                    <div className="flex flex-col gap-1.5">
                        {todos.map((t) => (
                            <PanelTodo key={t.id} todo={t} />
                        ))}
                    </div>
                )}
            </PanelSection>

            {/* Transactions */}
            <PanelSection title="Transactions" count={transactions.length}>
                {transactions.length === 0 ? (
                    <PanelEmpty icon={CreditCard02} title="No transactions" description="Spending for this day will appear here." />
                ) : (
                    <div className="flex flex-col gap-1.5">
                        {transactions.slice(0, 10).map((t) => {
                            const out = t.amount < 0;
                            return (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => router.push(`/financial/transactions?from=${format(day, "yyyy-MM-dd")}&to=${format(day, "yyyy-MM-dd")}`)}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-secondary_hover"
                                >
                                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-utility-blue-50 text-utility-blue-700">
                                        <CreditCard02 className="size-3.5" aria-hidden="true" />
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">{t.merchant}</span>
                                    <span className={cx("shrink-0 text-sm font-semibold tabular-nums", out ? "text-error-primary" : "text-success-primary")}>
                                        {out ? "-" : "+"}
                                        {formatCurrency(Math.abs(t.amount))}
                                    </span>
                                </button>
                            );
                        })}
                        <Button
                            size="sm"
                            color="link-color"
                            iconLeading={LinkExternal01}
                            href={`/financial/transactions?from=${format(day, "yyyy-MM-dd")}&to=${format(day, "yyyy-MM-dd")}`}
                            className="self-start"
                        >
                            {transactions.length > 10 ? `View all ${transactions.length}` : "View all"}
                        </Button>
                    </div>
                )}
            </PanelSection>
        </div>
    );
}

/** Compact, polished empty state for a panel/agenda section. */
function PanelEmpty({
    icon,
    title,
    description,
    actionLabel,
    onAction,
}: {
    icon: FC<{ className?: string }>;
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
}) {
    return (
        <div className="flex flex-col items-center gap-2.5 rounded-xl px-4 py-6 text-center ring-1 ring-secondary ring-inset">
            <FeaturedIcon icon={icon} color="brand" theme="light" size="md" />
            <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-primary">{title}</p>
                <p className="text-xs text-tertiary">{description}</p>
            </div>
            {actionLabel && onAction && (
                <Button size="sm" color="secondary" iconLeading={Plus} onClick={onAction}>
                    {actionLabel}
                </Button>
            )}
        </div>
    );
}

function PanelSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-tertiary uppercase">
                {title}
                {count > 0 && <span className="ml-1.5 font-normal text-quaternary">{count}</span>}
            </h3>
            {children}
        </section>
    );
}

/** Reminder row in the panel with inline Done + snooze. */
function PanelReminder({ item }: { item: CalendarItem }) {
    const Icon = reminderIcon(item.meta.reminderIconName);
    const reminderId = item.meta.reminderId ?? null;
    return (
        <div className="flex items-center gap-2 rounded-lg bg-secondary px-2 py-1.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-primary text-brand-secondary">
                <Icon className="size-3.5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-primary">{item.title.replace(/^Reminder · /, "")}</span>
                <span className="block text-xs text-tertiary">{format(new Date(item.startsAt), "HH:mm")}</span>
            </span>
            {reminderId && (
                <div className="flex shrink-0 items-center gap-1">
                    <Button
                        size="sm"
                        color="secondary"
                        iconLeading={Check}
                        aria-label="Mark done"
                        onClick={async () => {
                            const fd = new FormData();
                            fd.set("id", reminderId);
                            await run(completeReminder, fd, "Marked done");
                        }}
                    />
                    <Button
                        size="sm"
                        color="tertiary"
                        iconLeading={Clock}
                        aria-label="Snooze 1 day"
                        onClick={async () => {
                            const fd = new FormData();
                            fd.set("id", reminderId);
                            fd.set("days", "1");
                            await run(snoozeReminder, fd, "Snoozed 1 day");
                        }}
                    />
                </div>
            )}
        </div>
    );
}

/** Todo row in the panel with inline status toggle (Done / reopen). */
function PanelTodo({ todo }: { todo: TodoEntry }) {
    const done = todo.status === "DONE";
    const skipped = todo.status === "SKIPPED";
    async function setStatus(status: "DONE" | "PLANNED") {
        const fd = new FormData();
        fd.set("id", todo.id);
        fd.set("status", status);
        await run(setTodoStatus, fd, status === "DONE" ? "Completed" : "Reopened");
    }
    return (
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-secondary_hover">
            <button
                type="button"
                aria-label={done ? "Reopen todo" : "Complete todo"}
                aria-pressed={done}
                onClick={() => setStatus(done ? "PLANNED" : "DONE")}
                className={cx(
                    "flex size-5 shrink-0 items-center justify-center rounded-md ring-1 ring-inset transition",
                    done ? "bg-brand-solid text-white ring-brand" : "ring-primary hover:ring-brand",
                    skipped && "opacity-50",
                )}
            >
                {done && <Check className="size-3.5" aria-hidden="true" />}
            </button>
            <span className="min-w-0 flex-1">
                <span className={cx("block truncate text-sm", done || skipped ? "text-tertiary line-through" : "font-medium text-primary")}>{todo.title}</span>
                {todo.dueAt && !done && !skipped && (
                    <span className="block text-xs text-tertiary">{formatTime(todo.dueAt)}</span>
                )}
            </span>
        </div>
    );
}

/** Inline title + time event quick-add inside the panel. */
function QuickAddEvent({ day, onMore }: { day: Date; onMore: () => void }) {
    const [title, setTitle] = useState("");
    const [time, setTime] = useState("09:00");
    const [busy, setBusy] = useState(false);

    async function submit() {
        if (!title.trim() || busy) return;
        setBusy(true);
        const [h, m] = time.split(":").map(Number);
        const start = new Date(day);
        start.setHours(h || 0, m || 0, 0, 0);
        const fd = new FormData();
        fd.set("title", title.trim());
        fd.set("kind", "EVENT");
        fd.set("allDay", "false");
        fd.set("startsAt", toLocalInput(start.toISOString()));
        const ok = await run(createEvent, fd, "Event added");
        setBusy(false);
        if (ok) setTitle("");
    }

    return (
        <div className="flex flex-col gap-2 rounded-lg bg-secondary p-2.5">
            <NativeInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
                placeholder="Quick add event…"
                aria-label="Quick add event title"
            />
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Input type="time" value={time} onChange={setTime} aria-label="Event time" size="sm" className="w-28" />
                    <Button size="sm" iconLeading={Plus} onClick={() => void submit()} isDisabled={!title.trim() || busy}>Add</Button>
                </div>
                <Button size="sm" color="link-gray" onClick={onMore}>More</Button>
            </div>
        </div>
    );
}

/** Single coloured event pill with icon hint. */
function EventPill({ item, onSelect, showTime = true }: { item: CalendarItem; onSelect: () => void; showTime?: boolean }) {
    const c = categoryColor(item.color);
    const Icon = itemIcon(item);
    const statusHint =
        item.source === "dose" && item.meta.doseSkipped
            ? " · Skipped"
            : item.source === "dose" && item.meta.doseLogged
              ? " · Taken"
              : item.source === "peptide" && item.meta.peptideTaken
                ? " · Taken"
                : "";
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onSelect();
            }}
            title={`${item.title} · ${timeRange(item)}${statusHint}`}
            className={cx("relative z-10 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition hover:brightness-95", c.chip)}
        >
            {Icon ? (
                <Icon className="size-3 shrink-0 opacity-80" aria-hidden="true" />
            ) : (
                <span className={cx("size-1.5 shrink-0 rounded-full", c.dot)} />
            )}
            <span className={cx("truncate", item.done && "line-through opacity-70")}>
                {showTime && !item.allDay && <span className="tabular-nums opacity-80">{format(new Date(item.startsAt), "HH:mm")} </span>}
                {item.title}
            </span>
        </button>
    );
}

/** Compact "kcal · N meals" calorie chip, coloured against the user's goal. */
function NutritionChip({ summary }: { summary: NutritionDaySummary }) {
    const router = useRouter();
    // Goal comparison: under = success, near (>goal..110%) = warning, >110% = error, no goal = neutral.
    let tone: "success" | "warning" | "error" | "neutral" = "neutral";
    if (summary.goal && summary.goal > 0) {
        const ratio = summary.calories / summary.goal;
        tone = ratio > 1.1 ? "error" : ratio > 1 ? "warning" : "success";
    }
    const cls: Record<typeof tone, string> = {
        success: "bg-success-secondary text-success-primary",
        warning: "bg-warning-secondary text-warning-primary",
        error: "bg-error-secondary text-error-primary",
        neutral: "bg-secondary text-secondary",
    };
    const kcal = Math.round(summary.calories).toLocaleString("en-US");
    const goalText = summary.goal ? ` / ${Math.round(summary.goal).toLocaleString("en-US")}` : "";
    const label = `${kcal}${goalText} kcal · ${summary.mealCount} meal${summary.mealCount === 1 ? "" : "s"}`;
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                router.push(`/nutrition?date=${summary.day}`);
            }}
            title={label}
            aria-label={`Nutrition: ${label}`}
            className={cx("relative z-10 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] font-medium transition hover:brightness-95", cls[tone])}
        >
            <Coins01 className="size-3 shrink-0 opacity-80" aria-hidden="true" />
            <span className="truncate tabular-nums">
                {kcal} kcal · {summary.mealCount}
            </span>
        </button>
    );
}

/** Compact "N transactions · net" chip; net is green when positive, red when negative. */
function TxnChip({ summary }: { summary: TxnDaySummary }) {
    const router = useRouter();
    const negative = summary.net < 0;
    const netText = `${negative ? "-" : summary.net > 0 ? "+" : ""}${formatCurrency(Math.abs(summary.net))}`;
    const label = `${summary.count} transaction${summary.count === 1 ? "" : "s"} · ${netText} net`;
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                router.push(`/financial/transactions?from=${summary.day}&to=${summary.day}`);
            }}
            title={label}
            aria-label={label}
            className="relative z-10 flex w-full items-center gap-1 rounded bg-utility-blue-50 px-1 py-0.5 text-left text-[11px] font-medium text-utility-blue-700 transition hover:brightness-95"
        >
            <CreditCard02 className="size-3 shrink-0 opacity-80" aria-hidden="true" />
            <span className="truncate tabular-nums">
                {summary.count} txn ·{" "}
                <span className={cx(negative ? "text-error-primary" : summary.net > 0 ? "text-success-primary" : "")}>{netText}</span>
            </span>
        </button>
    );
}

/** "+N more" trigger that opens a popover listing the remaining items for a day. */
function MorePill({ items, date, onSelect }: { items: CalendarItem[]; date: Date; onSelect: (it: CalendarItem) => void }) {
    return (
        <AriaDialogTrigger>
            <button
                type="button"
                className="relative z-10 w-full rounded px-1 py-0.5 text-left text-[11px] font-medium text-tertiary transition hover:bg-secondary_hover"
            >
                +{items.length} more
            </button>
            <Popover size="md" className="w-64!">
                <AriaDialog className="outline-hidden">
                    <div className="border-b border-secondary px-3 py-2 text-xs font-semibold text-secondary">{format(date, "EEEE, MMM d")}</div>
                    <div className="flex flex-col gap-0.5 p-1.5">
                        {items.map((it) => (
                            <EventPill key={it.id} item={it} onSelect={() => onSelect(it)} />
                        ))}
                    </div>
                </AriaDialog>
            </Popover>
        </AriaDialogTrigger>
    );
}

// ── Time grid (Week / Day) ───────────────────────────────────
//
// A real time-positioned grid: hour axis on the left, soft part-of-day zone
// bands as the background, and absolutely-positioned blocks for timed events
// and timed todos. Todos with only a time-of-day tag float into their zone
// band; each day carries a capacity mini-bar driven by todo duration estimates.

const HOUR_PX = 44;
const AXIS_PX = 48;

type TodoBlockStatus = "PLANNED" | "IN_PROGRESS" | "DONE" | "SKIPPED";

/** planned = gray · in progress = blue · done = green · skipped = muted. */
const TODO_BLOCK_STYLE: Record<TodoBlockStatus, { box: string; border: string; text: string; bar: string }> = {
    PLANNED: { box: "bg-secondary", border: "border-secondary", text: "text-secondary", bar: "bg-fg-quaternary/50" },
    IN_PROGRESS: { box: "bg-utility-blue-50", border: "border-utility-blue-500", text: "text-utility-blue-700", bar: "bg-utility-blue-500" },
    DONE: { box: "bg-utility-green-50", border: "border-utility-green-500", text: "text-utility-green-700", bar: "bg-utility-green-500" },
    SKIPPED: { box: "bg-secondary/60", border: "border-secondary", text: "text-quaternary line-through", bar: "bg-fg-quaternary/30" },
};

/** Very soft background tint per zone. */
const ZONE_TINT: Record<TimeOfDayValue, string> = {
    MORNING: "bg-utility-amber-50/40",
    AFTERNOON: "bg-utility-blue-50/30",
    EVENING: "bg-utility-purple-50/30",
    NIGHT: "bg-utility-indigo-50/40",
};

function todoBlockStatus(s: string): TodoBlockStatus {
    return s === "DONE" || s === "IN_PROGRESS" || s === "SKIPPED" ? s : "PLANNED";
}

/** Minutes-since-midnight for the start of a calendar item (local). */
function itemStartMin(it: CalendarItem): number {
    const d = new Date(it.startsAt);
    return d.getHours() * 60 + d.getMinutes();
}
function itemEndMin(it: CalendarItem): number {
    if (!it.endsAt) return itemStartMin(it) + 60;
    const e = new Date(it.endsAt);
    const em = e.getHours() * 60 + e.getMinutes();
    const sm = itemStartMin(it);
    return em > sm ? em : sm + 60; // guard against end-of-day / next-day rollovers
}

type GridBlock =
    | { kind: "event"; key: string; item: CalendarItem; startMin: number; endMin: number; lane: number; lanes: number }
    | { kind: "todo"; key: string; todo: TodoEntry; startMin: number; endMin: number; lane: number; lanes: number };

/** Greedy interval-graph lane packing so overlapping blocks sit side-by-side. */
function packLanes(blocks: GridBlock[]): GridBlock[] {
    const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    const out: GridBlock[] = [];
    let cluster: GridBlock[] = [];
    let clusterEnd = -Infinity;
    const laneEnds: number[] = [];
    const flush = () => {
        const lanes = cluster.reduce((m, b) => Math.max(m, b.lane + 1), 0);
        for (const b of cluster) b.lanes = lanes;
        out.push(...cluster);
        cluster = [];
        laneEnds.length = 0;
        clusterEnd = -Infinity;
    };
    for (const b of sorted) {
        if (cluster.length && b.startMin >= clusterEnd) flush();
        let lane = laneEnds.findIndex((end) => end <= b.startMin);
        if (lane === -1) {
            lane = laneEnds.length;
            laneEnds.push(b.endMin);
        } else {
            laneEnds[lane] = b.endMin;
        }
        b.lane = lane;
        cluster.push(b);
        clusterEnd = Math.max(clusterEnd, b.endMin);
    }
    if (cluster.length) flush();
    return out;
}

/** Compute the visible hour window across every rendered day. */
function computeWindow(days: Date[], getEvents: (d: Date) => CalendarItem[], getTodos: (d: Date) => TodoEntry[]) {
    let lo = 8 * 60;
    let hi = 18 * 60;
    for (const d of days) {
        for (const it of getEvents(d)) {
            if (it.allDay) continue;
            lo = Math.min(lo, itemStartMin(it));
            hi = Math.max(hi, itemEndMin(it));
        }
        for (const t of getTodos(d)) {
            const place = todoGridPlacement(t);
            if (place === "block") {
                const sm = hhmmToMinutes(t.startTime) ?? 0;
                lo = Math.min(lo, sm);
                hi = Math.max(hi, sm + (t.durationMinutes ?? 30));
            } else if (place === "zone" && t.timeOfDay) {
                const z = TIME_ZONES.find((z) => z.value === t.timeOfDay);
                if (z) {
                    lo = Math.min(lo, z.startHour * 60);
                    hi = Math.max(hi, z.endHour * 60);
                }
            }
        }
    }
    const startHour = Math.max(0, Math.floor(lo / 60));
    const endHour = Math.min(24, Math.max(startHour + 1, Math.ceil(hi / 60)));
    return { startHour, endHour };
}

/** Day-header (date + weekday + capacity mini-bar). */
function GridDayHeader({ day, capacity, onSelectDay, onAdd }: { day: Date; capacity: ReturnType<typeof summarizeCapacity>; onSelectDay: (d: Date) => void; onAdd: (d: Date) => void }) {
    const today = isToday(day);
    const pct = Math.min(100, Math.round(capacity.ratio * 100));
    const barColor = capacity.over ? "bg-error-solid" : capacity.ratio > 0.85 ? "bg-warning-solid" : "bg-brand-solid";
    return (
        <button
            type="button"
            onClick={() => onSelectDay(day)}
            onDoubleClick={() => onAdd(day)}
            aria-label={`View ${format(day, "EEEE, MMMM d")} in panel`}
            className={cx("flex flex-col items-stretch gap-1 border-r border-secondary px-1.5 py-2 text-center transition last:border-r-0 hover:bg-secondary_hover", today && "bg-brand-primary/30")}
        >
            <span className="flex flex-col items-center gap-0.5">
                <span className={cx("text-xs font-medium", today ? "text-brand-secondary" : "text-tertiary")}>{format(day, "EEE")}</span>
                <span className={cx("inline-flex size-7 items-center justify-center rounded-full text-sm", today ? "bg-brand-solid font-bold text-white" : "font-semibold text-primary")}>{format(day, "d")}</span>
            </span>
            {capacity.estimatedCount > 0 && (
                <span className="flex flex-col gap-0.5" title={`${formatDuration(capacity.scheduledMinutes) || "0m"} of ${formatDuration(capacity.capacityMinutes)} scheduled`}>
                    <span className="h-1 w-full overflow-hidden rounded-full bg-quaternary">
                        <span className={cx("block h-full rounded-full", barColor)} style={{ width: `${pct}%` }} />
                    </span>
                    <span className={cx("text-[10px] tabular-nums", capacity.over ? "text-error-primary" : "text-quaternary")}>{formatDuration(capacity.scheduledMinutes) || "0m"}</span>
                </span>
            )}
        </button>
    );
}

/** A single positioned todo block (title, duration bar, status colour). */
function GridTodoBlock({ todo, top, height, leftPct, widthPct, onSelect }: { todo: TodoEntry; top: number; height: number; leftPct: number; widthPct: number; onSelect: () => void }) {
    const st = TODO_BLOCK_STYLE[todoBlockStatus(todo.status)];
    const startLabel = formatHHMM(todo.startTime);
    const dur = formatDuration(todo.durationMinutes);
    const barPct = todo.durationMinutes ? Math.min(100, Math.round((todo.durationMinutes / 120) * 100)) : 0;
    return (
        <button
            type="button"
            onClick={onSelect}
            title={`${todo.title}${startLabel ? ` · ${startLabel}` : ""}${dur ? ` · ${dur}` : ""}`}
            style={{ top, height, left: `calc(${leftPct}% + 1px)`, width: `calc(${widthPct}% - 2px)` }}
            className={cx("absolute z-10 flex flex-col overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left ring-1 ring-secondary ring-inset transition hover:brightness-95", st.box, st.border, st.text)}
        >
            <span className="truncate text-[10px] tabular-nums opacity-80">
                {startLabel}
                {dur ? ` · ${dur}` : ""}
            </span>
            <span className="truncate text-[11px] leading-tight font-medium">{todo.title}</span>
            {height >= 38 && todo.durationMinutes != null && (
                <span className="mt-auto h-1 w-full overflow-hidden rounded-full bg-black/5">
                    <span className={cx("block h-full rounded-full", st.bar)} style={{ width: `${Math.max(8, barPct)}%` }} />
                </span>
            )}
        </button>
    );
}

/** A single positioned event/overlay block. */
function GridEventBlock({ item, top, height, leftPct, widthPct, onSelect }: { item: CalendarItem; top: number; height: number; leftPct: number; widthPct: number; onSelect: () => void }) {
    const c = categoryColor(item.color);
    const Icon = itemIcon(item);
    return (
        <button
            type="button"
            onClick={onSelect}
            title={`${item.title} · ${timeRange(item)}`}
            style={{ top, height, left: `calc(${leftPct}% + 1px)`, width: `calc(${widthPct}% - 2px)` }}
            className={cx("absolute z-10 flex flex-col overflow-hidden rounded-md border-l-[3px] border-transparent px-1.5 py-0.5 text-left transition hover:brightness-95", c.chip)}
        >
            <span className="flex items-center gap-1 text-[10px] tabular-nums opacity-80">
                {Icon && <Icon className="size-3 shrink-0" aria-hidden="true" />}
                {format(new Date(item.startsAt), "HH:mm")}
            </span>
            <span className={cx("truncate text-[11px] leading-tight font-medium", item.done && "line-through opacity-70")}>{item.title}</span>
        </button>
    );
}

/** Todo with neither a start time nor a zone tag — shown in the all-day row. */
function AllDayTodoChip({ todo, onSelect }: { todo: TodoEntry; onSelect: () => void }) {
    const st = TODO_BLOCK_STYLE[todoBlockStatus(todo.status)];
    return (
        <button
            type="button"
            onClick={onSelect}
            title={todo.title}
            className={cx("flex w-full items-center gap-1 overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[11px] transition hover:brightness-95", st.box, st.border, st.text)}
        >
            <CheckSquare className="size-2.5 shrink-0 opacity-70" aria-hidden="true" />
            <span className="truncate">{todo.title}</span>
        </button>
    );
}

/** A "floated" todo with only a time-of-day tag — sits inside its zone band. */
function ZoneFloatChip({ todo, top, onSelect }: { todo: TodoEntry; top: number; onSelect: () => void }) {
    const st = TODO_BLOCK_STYLE[todoBlockStatus(todo.status)];
    const dur = formatDuration(todo.durationMinutes);
    return (
        <button
            type="button"
            onClick={onSelect}
            title={`${todo.title}${dur ? ` · ${dur}` : ""} · ${todo.timeOfDay ? TIME_OF_DAY_LABEL[todo.timeOfDay] : ""}`}
            style={{ top }}
            className={cx("absolute right-1 left-1 z-[6] flex items-center gap-1 overflow-hidden rounded-md border border-dashed px-1.5 py-0.5 text-left text-[10px] transition hover:brightness-95", st.box, st.border, st.text)}
        >
            <span className="truncate font-medium">{todo.title}</span>
            {dur && <span className="ml-auto shrink-0 tabular-nums opacity-70">{dur}</span>}
        </button>
    );
}

/** One day column: positioned event + todo blocks, plus floated zone chips. */
function TimeGridColumn({ day, startHour, endHour, events, todos, onSelect, onSelectTodo }: {
    day: Date;
    startHour: number;
    endHour: number;
    events: CalendarItem[];
    todos: TodoEntry[];
    onSelect: (it: CalendarItem) => void;
    onSelectTodo: (t: TodoEntry) => void;
}) {
    const gridTopMin = startHour * 60;
    const gridBottomMin = endHour * 60;
    const minToTop = (m: number) => ((Math.max(gridTopMin, m) - gridTopMin) / 60) * HOUR_PX;

    // Build packed blocks (events + timed todos share lanes).
    const raw: GridBlock[] = [];
    for (const it of events) {
        if (it.allDay) continue;
        raw.push({ kind: "event", key: it.id, item: it, startMin: itemStartMin(it), endMin: itemEndMin(it), lane: 0, lanes: 1 });
    }
    for (const t of todos) {
        if (todoGridPlacement(t) !== "block") continue;
        const sm = hhmmToMinutes(t.startTime) ?? 0;
        raw.push({ kind: "todo", key: t.id, todo: t, startMin: sm, endMin: sm + (t.durationMinutes ?? 30), lane: 0, lanes: 1 });
    }
    const packed = packLanes(raw);

    // Floated zone todos, grouped by zone and stacked within their band.
    const floated = todos.filter((t) => todoGridPlacement(t) === "zone");
    const floatByZone = new Map<TimeOfDayValue, TodoEntry[]>();
    for (const t of floated) {
        if (!t.timeOfDay) continue;
        const arr = floatByZone.get(t.timeOfDay) ?? [];
        arr.push(t);
        floatByZone.set(t.timeOfDay, arr);
    }

    return (
        <div className={cx("relative border-r border-secondary last:border-r-0", isWeekend(day) && "bg-secondary_subtle/40")}>
            {packed.map((b) => {
                const top = minToTop(b.startMin);
                const bottom = minToTop(Math.min(b.endMin, gridBottomMin));
                const height = Math.max(18, bottom - top);
                const leftPct = (100 * b.lane) / b.lanes;
                const widthPct = 100 / b.lanes;
                return b.kind === "todo" ? (
                    <GridTodoBlock key={b.key} todo={b.todo} top={top} height={height} leftPct={leftPct} widthPct={widthPct} onSelect={() => onSelectTodo(b.todo)} />
                ) : (
                    <GridEventBlock key={b.key} item={b.item} top={top} height={height} leftPct={leftPct} widthPct={widthPct} onSelect={() => onSelect(b.item)} />
                );
            })}
            {[...floatByZone.entries()].map(([zone, list]) => {
                const z = TIME_ZONES.find((x) => x.value === zone);
                if (!z) return null;
                const base = minToTop(z.startHour * 60) + 2;
                return list.map((t, i) => <ZoneFloatChip key={t.id} todo={t} top={base + i * 22} onSelect={() => onSelectTodo(t)} />);
            })}
        </div>
    );
}

/** The full time grid: header row, all-day row, then the positioned timed area. */
function TimeGrid({ days, getEvents, getTodos, dayNutrition, dayTxn, onSelect, onSelectTodo, onAdd, onSelectDay }: {
    days: Date[];
    getEvents: (d: Date) => CalendarItem[];
    getTodos: (d: Date) => TodoEntry[];
    dayNutrition: (d: Date) => NutritionDaySummary | null;
    dayTxn: (d: Date) => TxnDaySummary | null;
    onSelect: (it: CalendarItem) => void;
    onSelectTodo: (t: TodoEntry) => void;
    onAdd: (d: Date) => void;
    onSelectDay: (d: Date) => void;
}) {
    const { startHour, endHour } = useMemo(() => computeWindow(days, getEvents, getTodos), [days, getEvents, getTodos]);
    const gridHeight = (endHour - startHour) * HOUR_PX;
    // Hours within the window (exclusive end): gridlines + axis labels sit at the
    // top of each hour row; the window's bottom edge is the card border.
    const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
    const gridTemplate = `${AXIS_PX}px repeat(${days.length}, minmax(0, 1fr))`;
    const isWeek = days.length > 1;

    return (
        <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
                <div style={isWeek ? { minWidth: "48rem" } : undefined}>
                    {/* Header row */}
                    <div className="grid border-b border-secondary" style={{ gridTemplateColumns: gridTemplate }}>
                        <div className="border-r border-secondary" />
                        {days.map((d) => (
                            <GridDayHeader key={d.toISOString()} day={d} capacity={summarizeCapacity(getTodos(d))} onSelectDay={onSelectDay} onAdd={onAdd} />
                        ))}
                    </div>

                    {/* All-day + per-day summary row */}
                    <div className="grid border-b border-secondary" style={{ gridTemplateColumns: gridTemplate }}>
                        <div className="flex items-start justify-end border-r border-secondary px-1 py-1 text-[10px] text-quaternary">all-day</div>
                        {days.map((d) => {
                            const allDay = getEvents(d).filter((it) => it.allDay);
                            // Todos with no time and no zone tag have nowhere to position — keep
                            // them visible here rather than dropping them off the grid.
                            const untimed = getTodos(d).filter((t) => todoGridPlacement(t) === "none");
                            const nut = dayNutrition(d);
                            const tx = dayTxn(d);
                            return (
                                <div key={d.toISOString()} className="flex min-h-9 flex-col gap-0.5 border-r border-secondary p-1 last:border-r-0">
                                    {nut && <NutritionChip summary={nut} />}
                                    {tx && <TxnChip summary={tx} />}
                                    {allDay.map((it) => (
                                        <EventPill key={it.id} item={it} onSelect={() => onSelect(it)} showTime={false} />
                                    ))}
                                    {untimed.map((t) => (
                                        <AllDayTodoChip key={t.id} todo={t} onSelect={() => onSelectTodo(t)} />
                                    ))}
                                </div>
                            );
                        })}
                    </div>

                    {/* Timed area: zone bands + gridlines (background) then columns */}
                    <div className="relative" style={{ height: gridHeight }}>
                        <div className="pointer-events-none absolute inset-y-0" style={{ left: AXIS_PX, right: 0 }}>
                            {TIME_ZONES.map((z) => {
                                const topH = Math.max(z.startHour, startHour);
                                const botH = Math.min(z.endHour, endHour);
                                if (botH <= topH) return null;
                                return (
                                    <div key={z.value} className={cx("absolute inset-x-0", ZONE_TINT[z.value])} style={{ top: (topH - startHour) * HOUR_PX, height: (botH - topH) * HOUR_PX }} />
                                );
                            })}
                            {hours.map((h) => (
                                <div key={h} className="absolute inset-x-0 border-t border-secondary/60" style={{ top: (h - startHour) * HOUR_PX }} />
                            ))}
                        </div>

                        <div className="grid h-full" style={{ gridTemplateColumns: gridTemplate }}>
                            {/* Hour axis + zone labels */}
                            <div className="relative border-r border-secondary">
                                {hours.map((h) => (
                                    <span key={h} className="absolute right-1.5 text-[10px] tabular-nums text-quaternary" style={{ top: (h - startHour) * HOUR_PX + 2 }}>
                                        {String(h).padStart(2, "0")}:00
                                    </span>
                                ))}
                                {TIME_ZONES.map((z) => {
                                    const topH = Math.max(z.startHour, startHour);
                                    const botH = Math.min(z.endHour, endHour);
                                    if (botH <= topH) return null;
                                    return (
                                        <span key={z.value} className="absolute left-1 text-[9px] font-medium tracking-wide text-quaternary/70 uppercase" style={{ top: (topH - startHour) * HOUR_PX + 14 }}>
                                            {z.label.slice(0, 3)}
                                        </span>
                                    );
                                })}
                            </div>
                            {days.map((d) => (
                                <TimeGridColumn key={d.toISOString()} day={d} startHour={startHour} endHour={endHour} events={getEvents(d)} todos={getTodos(d)} onSelect={onSelect} onSelectTodo={onSelectTodo} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
}

/** Desktop week view — a 7-day time grid. */
function WeekView({
    weekDays,
    dayItems,
    dayTodos,
    dayNutrition,
    dayTxn,
    onSelect,
    onSelectTodo,
    onAdd,
    onSelectDay,
}: {
    weekDays: Date[];
    dayItems: (d: Date) => CalendarItem[];
    dayTodos: (d: Date) => TodoEntry[];
    dayNutrition: (d: Date) => NutritionDaySummary | null;
    dayTxn: (d: Date) => TxnDaySummary | null;
    onSelect: (it: CalendarItem) => void;
    onSelectTodo: (t: TodoEntry) => void;
    onAdd: (d: Date) => void;
    onSelectDay: (d: Date) => void;
}) {
    // Todos render via the dedicated todo path; keep them out of the event blocks.
    const getEvents = useCallback((d: Date) => dayItems(d).filter((it) => it.source !== "todo"), [dayItems]);
    return (
        <TimeGrid
            days={weekDays}
            getEvents={getEvents}
            getTodos={dayTodos}
            dayNutrition={dayNutrition}
            dayTxn={dayTxn}
            onSelect={onSelect}
            onSelectTodo={onSelectTodo}
            onAdd={onAdd}
            onSelectDay={onSelectDay}
        />
    );
}

function EventModal({
    open,
    onClose,
    editing,
    defaultDate,
    categories,
    contacts,
    providers,
    doctors,
}: {
    open: boolean;
    onClose: () => void;
    editing: CalendarItem | null;
    defaultDate: Date | null;
    categories: CategoryOption[];
    contacts: Option[];
    providers: Option[];
    doctors: Option[];
}) {
    const [kind, setKind] = useState<"EVENT" | "APPOINTMENT">(editing?.eventKind ?? "EVENT");
    const [allDay, setAllDay] = useState(editing?.allDay ?? false);
    const [attendees, setAttendees] = useState<AttendeeDraft[]>(
        editing?.meta.attendees?.map((a) => ({ contactId: a.contactId ?? "", name: a.name ?? "", email: a.email ?? "" })) ?? [],
    );
    const [reminders, setReminders] = useState<ReminderDraft[]>(
        editing?.meta.reminders?.map((r) => ({ minutesBefore: String(r.minutesBefore), channel: r.channel })) ?? [],
    );
    const [categoryId, setCategoryId] = useState<string>(editing?.meta.categoryId ?? "");
    const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;
    const SelectedCategoryIcon = selectedCategory?.icon ? resolveIcon(selectedCategory.icon) : null;

    const startDefault = editing ? toLocalInput(editing.startsAt) : toLocalInput((defaultDate ?? new Date()).toISOString());
    const endDefault = editing?.endsAt ? toLocalInput(editing.endsAt) : "";

    async function onSubmit(fd: FormData) {
        fd.set("kind", kind);
        fd.set("allDay", allDay ? "true" : "false");
        fd.set("attendees", JSON.stringify(attendees.filter((a) => a.contactId || a.name || a.email)));
        fd.set(
            "reminders",
            JSON.stringify(reminders.filter((r) => r.minutesBefore !== "").map((r) => ({ minutesBefore: Number(r.minutesBefore), channel: r.channel }))),
        );
        const ok = await run(editing ? updateEvent : createEvent, fd, editing ? "Updated" : "Created");
        if (ok) onClose();
    }

    return (
        <FormModal isOpen={open} onOpenChange={(o) => !o && onClose()} title={editing ? "Edit event" : "New event"}>
            <form action={onSubmit} className="flex flex-col gap-4">
                {editing && <input type="hidden" name="id" value={editing.id} />}

                <div className="flex gap-2">
                    {(["EVENT", "APPOINTMENT"] as const).map((k) => (
                        <button key={k} type="button" onClick={() => setKind(k)} className={cx("flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition", kind === k ? "border-brand bg-brand-primary text-brand-secondary" : "border-secondary text-tertiary hover:text-secondary")}>
                            {k === "EVENT" ? "Event" : "Appointment"}
                        </button>
                    ))}
                </div>

                <Field label="Title" htmlFor="title" required><NativeInput id="title" name="title" defaultValue={editing?.title} required /></Field>

                <Checkbox isSelected={allDay} onChange={setAllDay} label="All day" />

                <div className="grid grid-cols-2 gap-4">
                    <FormDateInput
                        key={allDay ? "start-date" : "start-datetime"}
                        name="startsAt"
                        label="Starts"
                        isRequired
                        variant={allDay ? "date" : "datetime"}
                        defaultValue={allDay ? startDefault.slice(0, 10) : startDefault}
                    />
                    <FormDateInput
                        key={allDay ? "end-date" : "end-datetime"}
                        name="endsAt"
                        label="Ends"
                        variant={allDay ? "date" : "datetime"}
                        defaultValue={allDay ? endDefault.slice(0, 10) : endDefault}
                    />
                </div>

                <Field label="Category" htmlFor="categoryId">
                    <div className="flex items-center gap-2">
                        <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-lg", categoryColor(selectedCategory?.color).chip)}>
                            {SelectedCategoryIcon ? (
                                <SelectedCategoryIcon className="size-4.5" aria-hidden="true" />
                            ) : (
                                <span className={cx("size-2.5 rounded-full", categoryColor(selectedCategory?.color).dot)} />
                            )}
                        </span>
                        <NativeSelect id="categoryId" name="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                            <option value="">No category</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </NativeSelect>
                    </div>
                </Field>

                <Field label="Location" htmlFor="location"><NativeInput id="location" name="location" defaultValue={editing?.meta.location ?? ""} /></Field>
                <Field label="Description" htmlFor="description"><NativeTextarea id="description" name="description" defaultValue={editing?.meta.description ?? ""} /></Field>

                {kind === "APPOINTMENT" && (
                    <div className="flex flex-col gap-4 rounded-lg bg-secondary p-4">
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Provider" htmlFor="providerId">
                                <NativeSelect id="providerId" name="providerId" defaultValue={editing?.meta.providerId ?? ""}>
                                    <option value="">None</option>
                                    {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </NativeSelect>
                            </Field>
                            <Field label="Doctor" htmlFor="doctorId">
                                <NativeSelect id="doctorId" name="doctorId" defaultValue={editing?.meta.doctorId ?? ""}>
                                    <option value="">None</option>
                                    {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </NativeSelect>
                            </Field>
                        </div>
                        <Field label="Visit notes" htmlFor="visitNotes"><NativeTextarea id="visitNotes" name="visitNotes" defaultValue={editing?.meta.visitNotes ?? ""} /></Field>
                    </div>
                )}

                {/* Attendees */}
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-secondary">Attendees</span>
                        <Button size="sm" color="link-color" iconLeading={Plus} onClick={() => setAttendees((a) => [...a, { contactId: "", name: "", email: "" }])}>Add</Button>
                    </div>
                    {attendees.map((a, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <NativeSelect value={a.contactId} onChange={(e) => setAttendees((arr) => arr.map((x, j) => (j === i ? { ...x, contactId: e.target.value } : x)))} className="w-40">
                                <option value="">Contact…</option>
                                {contacts.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
                            </NativeSelect>
                            <NativeInput placeholder="Name" value={a.name} onChange={(e) => setAttendees((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                            <NativeInput placeholder="Email" type="email" value={a.email} onChange={(e) => setAttendees((arr) => arr.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                            <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Remove" onClick={() => setAttendees((arr) => arr.filter((_, j) => j !== i))} />
                        </div>
                    ))}
                </div>

                {/* Reminders */}
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-secondary">Reminders</span>
                        <Button size="sm" color="link-color" iconLeading={Plus} onClick={() => setReminders((r) => [...r, { minutesBefore: "10", channel: "INAPP" }])}>Add</Button>
                    </div>
                    {reminders.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <NativeInput type="number" min={0} value={r.minutesBefore} onChange={(e) => setReminders((arr) => arr.map((x, j) => (j === i ? { ...x, minutesBefore: e.target.value } : x)))} className="w-28" />
                            <span className="text-sm text-tertiary">min before</span>
                            <NativeSelect value={r.channel} onChange={(e) => setReminders((arr) => arr.map((x, j) => (j === i ? { ...x, channel: e.target.value } : x)))} className="w-32">
                                <option value="INAPP">In-app</option>
                                <option value="EMAIL">Email</option>
                            </NativeSelect>
                            <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Remove" onClick={() => setReminders((arr) => arr.filter((_, j) => j !== i))} />
                        </div>
                    ))}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <Button color="secondary" type="button" onClick={onClose}>Cancel</Button>
                    <Button type="submit">{editing ? "Save" : "Create"}</Button>
                </div>
            </form>
        </FormModal>
    );
}
