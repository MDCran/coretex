"use client";

// Coretex Relay — Calendar. A polished month/week/day calendar over the Brain's
// persisted events (state.calendar), with a left sidebar (mini-month navigator,
// Today + prev/next, and per-category filters), an Untitled UI ButtonGroup view
// switcher, colorized event chips, and a SlideoutMenu event editor. All CRUD goes
// through actions.calendarUpsert / actions.calendarDelete — nothing is hardcoded.

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, CalendarPlus01, ChevronLeft, ChevronRight, Clock, Lock01, MarkerPin01, RefreshCw01, Settings01, Users01, XClose } from "@untitledui/icons";
import {
    Calendar as AriaCalendar,
    CalendarGrid as AriaCalendarGrid,
    CalendarGridBody as AriaCalendarGridBody,
    CalendarGridHeader as AriaCalendarGridHeader,
    CalendarHeaderCell as AriaCalendarHeaderCell,
    CalendarCell as AriaCalendarCell,
} from "react-aria-components";
import type { CalendarEvent } from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { cx } from "@/utils/cx";
import type { CoretexActions, CoretexState } from "../use-coretex";
import type { NavTarget } from "../nav";
import { CalendarEventEditor } from "./event-editor";
import { CalendarCategoriesManager } from "./calendar-categories-manager";
import { CALENDAR_CATEGORIES, categoryById } from "./categories";
import { MiniCalendar, toCalendarDate, fromDateValue } from "./mini-calendar";
import { useLifeOSQuery, type LifeOSClient } from "../views/personal/use-lifeos-query";
import { ProjectIcon } from "../ui/project-icon";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import {
    deriveFinancialCalendarEvents,
    derivePersonalCalendarEvents,
    deriveWorkspaceCalendarEvents,
    expandRecurringCalendarEvents,
    mergeCalendarEvents,
    type FinancialCalendarSignal,
    type PersonalCalendarSignal,
} from "./calendar-data";
import { isEventEditable, type RichCalendarEvent } from "./event-draft";

type View = "month" | "week" | "day";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_MS = 86_400_000;
const HOUR_PX = 48; // height of one hour row in the time grid

// ---- date helpers (epoch-ms <-> local Date) ----
const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1;
const sameDay = (a: Date, b: Date) => dateKey(a) === dateKey(b);

function fmtTime(ms: number, timeZone?: string): string {
    return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
}
function fmtHour(h: number): string {
    return new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });
}
function addDays(d: Date, n: number): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function startOfWeek(d: Date): Date {
    return addDays(d, -d.getDay());
}

interface CalendarViewProps {
    state: CoretexState;
    actions: CoretexActions;
    client: LifeOSClient;
    onNavigate?: (target: NavTarget) => void;
}

export function calendarSourceTarget(event: RichCalendarEvent): NavTarget | null {
    const source = event.source;
    if (!source) return null;
    if (source.kind === "agent" && source.id) return { kind: "agent", id: source.id };
    if (source.kind === "project" && source.id) return { kind: "project", id: source.id, tab: "overview" };
    if (source.kind === "email") return { kind: "email" };
    if (source.kind === "financial") return { kind: "financial" };
    if (source.kind === "social") return { kind: "social" };
    if (source.kind === "workout") return { kind: "workouts" };
    if (source.kind === "nutrition") return { kind: "nutrition" };
    if (source.kind === "health") return { kind: "health" };
    if (source.kind === "todo") return { kind: "tasks" };
    return null;
}

export const CalendarView = ({ state, actions, client, onNavigate }: CalendarViewProps) => {
    const [view, setView] = useState<View>("month");
    const [cursor, setCursor] = useState<Date>(() => new Date());
    const [hidden, setHidden] = useState<Set<string>>(() => new Set());
    const [managerOpen, setManagerOpen] = useState(false);
    const [sourceDetail, setSourceDetail] = useState<RichCalendarEvent | null>(null);
    const [editor, setEditor] = useState<{ open: boolean; event: CalendarEvent | null; date: string }>({
        open: false,
        event: null,
        date: dateKey(new Date()),
    });

    const userEvents = (state.calendar ?? []) as RichCalendarEvent[];
    const workspaceEvents = useMemo(() => deriveWorkspaceCalendarEvents(state), [state.agents, state.projects, state.tasks, state.email, (state as any).mail]);
    const financialCalendar = useLifeOSQuery<{ events: FinancialCalendarSignal[] }>(client, "financial:getCalendar");
    const financialEvents = useMemo(() => deriveFinancialCalendarEvents(financialCalendar.data?.events), [financialCalendar.data]);
    const personalRange = useMemo(() => ({ start: dateKey(addDays(cursor, -62)), end: dateKey(addDays(cursor, 400)) }), [cursor]);
    const personalCalendar = useLifeOSQuery<{ events: PersonalCalendarSignal[] }>(client, "calendar:getPersonalContext", personalRange);
    const personalEvents = useMemo(() => derivePersonalCalendarEvents(personalCalendar.data?.events), [personalCalendar.data]);
    const baseEvents = useMemo(() => mergeCalendarEvents(userEvents, workspaceEvents, financialEvents, personalEvents), [userEvents, workspaceEvents, financialEvents, personalEvents]);
    const recurrenceRange = useMemo(() => ({ start: startOfDay(addDays(cursor, -62)), end: endOfDay(addDays(cursor, 400)) }), [cursor]);
    const allEvents = useMemo(() => expandRecurringCalendarEvents(baseEvents, recurrenceRange.start, recurrenceRange.end), [baseEvents, recurrenceRange]);

    // Live, user-managed category set (falls back to the built-in palette).
    const liveCategories = state.calendarCategories?.length
        ? [...state.calendarCategories, ...CALENDAR_CATEGORIES.filter((c) => !state.calendarCategories!.some((x) => x.id === c.id))]
        : CALENDAR_CATEGORIES;

    // Categories present in the data — union of the managed palette with any
    // ad-hoc category ids found on events, so filters always cover what's shown.
    const categories = useMemo(() => {
        const map = new Map<string, { id: string; label: string; color: string; icon: string; count: number }>();
        for (const c of liveCategories) map.set(c.id, { id: c.id, label: c.label, color: c.color, icon: c.icon ?? categoryById(c.id).icon, count: 0 });
        for (const ev of allEvents) {
            const existing = map.get(ev.category);
            if (existing) existing.count += 1;
            else {
                const presentation = categoryById(ev.category);
                map.set(ev.category, { id: ev.category, label: presentation.label, color: ev.color || presentation.color, icon: ev.icon ?? presentation.icon, count: 1 });
            }
        }
        return [...map.values()];
    }, [allEvents, liveCategories]);

    // Client-side category filtering.
    const events = useMemo(() => allEvents.filter((ev) => !hidden.has(ev.category)), [allEvents, hidden]);

    const eventsForDay = (day: Date): CalendarEvent[] => {
        const s = startOfDay(day);
        const e = endOfDay(day);
        return events
            .filter((ev) => ev.start <= e && ev.end >= s)
            .sort((a, b) => (a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1));
    };

    // Days within the currently visible range that carry events (for mini-month dots).
    const eventDays = useMemo(() => {
        const keys = new Set<string>();
        const out: Date[] = [];
        for (const ev of events) {
            // Walk each day the event spans (cap to avoid runaway ranges).
            let cur = startOfDay(new Date(ev.start));
            const last = startOfDay(new Date(ev.end));
            for (let i = 0; cur <= last && i < 60; i++) {
                const d = new Date(cur);
                const k = dateKey(d);
                if (!keys.has(k)) {
                    keys.add(k);
                    out.push(d);
                }
                cur = startOfDay(addDays(new Date(cur), 1));
            }
        }
        return out;
    }, [events]);

    const openNew = (day: Date) => setEditor({ open: true, event: null, date: dateKey(day) });
    const openEdit = (raw: CalendarEvent) => {
        const ev = raw as RichCalendarEvent;
        if (!isEventEditable(ev)) {
            setSourceDetail(ev);
            return;
        }
        const base = ev.seriesId ? userEvents.find((event) => event.id === ev.seriesId) : ev;
        if (!base) return;
        const editorEvent = ev.seriesId ? { ...base, seriesId: base.id, occurrenceStart: ev.start } : base;
        setEditor({ open: true, event: editorEvent, date: dateKey(new Date(ev.start)) });
    };
    const close = () => setEditor((s) => ({ ...s, open: false }));

    const toggleCategory = (id: string) =>
        setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    // ---- header navigation ----
    const step = (dir: number) => {
        if (view === "month") setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
        else if (view === "week") setCursor(addDays(cursor, dir * 7));
        else setCursor(addDays(cursor, dir));
    };

    const title = useMemo(() => {
        if (view === "day") return cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
        if (view === "week") {
            const ws = startOfWeek(cursor);
            const we = addDays(ws, 6);
            return `${ws.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${we.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
        }
        return cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }, [cursor, view]);

    return (
        <div className="flex w-full flex-col gap-5">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-display-sm font-semibold text-primary">Calendar</h1>
                    <p className="mt-1 text-sm text-tertiary">
                        {events.length} event{events.length === 1 ? "" : "s"} shown · click a day to add one.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <ButtonGroup
                        size="sm"
                        selectedKeys={[view]}
                        onSelectionChange={(keys) => {
                            const next = [...keys][0] as View | undefined;
                            if (next) setView(next);
                        }}
                    >
                        <ButtonGroupItem id="month">Month</ButtonGroupItem>
                        <ButtonGroupItem id="week">Week</ButtonGroupItem>
                        <ButtonGroupItem id="day">Day</ButtonGroupItem>
                    </ButtonGroup>
                    <Button size="sm" color="primary" iconLeading={CalendarPlus01} onClick={() => openNew(cursor)}>
                        New event
                    </Button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                    <button type="button" aria-label="Previous" onClick={() => step(-1)} className="rounded-md p-2 text-secondary transition hover:bg-[var(--surface-2)]">
                        <ChevronLeft className="size-4" />
                    </button>
                    <button type="button" aria-label="Next" onClick={() => step(1)} className="rounded-md p-2 text-secondary transition hover:bg-[var(--surface-2)]">
                        <ChevronRight className="size-4" />
                    </button>
                    <Button size="sm" color="secondary" onClick={() => setCursor(new Date())} className="ml-1">
                        Today
                    </Button>
                </div>
                <p className="text-sm font-semibold text-primary">{title}</p>
            </div>

            {/* Legend — always visible so module colors are self-explanatory */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-secondary bg-primary px-3 py-2.5">
                <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-quaternary">Legend</span>
                {categories.filter((c) => c.count > 0 || ["agents", "projects", "todos", "financial", "social", "workouts", "nutrition", "health", "email"].includes(c.id)).map((c) => (
                    <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleCategory(c.id)}
                        className={cx(
                            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
                            hidden.has(c.id) ? "border-secondary text-quaternary opacity-50" : "border-secondary text-secondary",
                        )}
                        title={hidden.has(c.id) ? `Show ${c.label}` : `Hide ${c.label}`}
                    >
                        <ProjectIcon icon={c.icon} color={c.color} size={14} tile={false} />
                        {c.label}
                        {c.count > 0 && <span className="tabular-nums text-quaternary">{c.count}</span>}
                    </button>
                ))}
            </div>

            <div className="grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-[15rem_minmax(0,1fr)] min-[1680px]:grid-cols-[15rem_minmax(0,1fr)_18rem]">
                {/* Sidebar */}
                <aside className="flex w-full min-w-0 flex-col gap-4 overflow-hidden">
                    <div className="overflow-hidden rounded-xl border border-secondary bg-primary p-2.5">
                        <MiniCalendar
                            selected={cursor}
                            focused={cursor}
                            onSelect={(d) => {
                                setCursor(d);
                                if (view === "month") setView("day");
                            }}
                            onFocusChange={(d) => setCursor(d)}
                            eventDays={eventDays}
                        />
                    </div>

                    <div className="rounded-xl border border-secondary bg-primary p-4">
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">Calendars</p>
                            <Button size="sm" color="link-gray" iconLeading={Settings01} onClick={() => setManagerOpen(true)}>
                                Manage
                            </Button>
                        </div>
                        {categories.length === 0 ? (
                            <p className="text-xs text-quaternary">No events yet.</p>
                        ) : (
                            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-2">
                                {categories.map((c) => (
                                    <li key={c.id} className="flex min-w-0 items-center justify-between gap-2">
                                        <Checkbox
                                            isSelected={!hidden.has(c.id)}
                                            onChange={() => toggleCategory(c.id)}
                                            label={
                                                <span className="flex min-w-0 items-center gap-2 text-sm text-secondary">
                                                    <ProjectIcon icon={c.icon} color={c.color} size={16} tile={false} />
                                                    <span className="truncate">{c.label}</span>
                                                </span>
                                            }
                                        />
                                        <span className="shrink-0 text-xs text-quaternary tabular-nums">{c.count}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </aside>

                {/* Main view — min-w-0 so month grid never pushes outside the content pane */}
                <div className="min-w-0 flex-1 overflow-hidden">
                    {view === "month" && <MonthCalendar cursor={cursor} setCursor={setCursor} eventsForDay={eventsForDay} onDrill={(d) => { setCursor(d); setView("day"); }} onEdit={openEdit} />}
                    {view === "week" && <WeekView cursor={cursor} eventsForDay={eventsForDay} onNew={openNew} onEdit={openEdit} />}
                    {view === "day" && <DayView cursor={cursor} events={eventsForDay(cursor)} onNew={openNew} onEdit={openEdit} />}
                </div>

                {/* Selected-day agenda across user events, workspace signals,
                    finances, todos, relationships, workouts, and health. */}
                <DaySidebar day={cursor} events={eventsForDay(cursor)} onNew={openNew} onEdit={openEdit} />
            </div>

            <CalendarEventEditor
                event={editor.event}
                defaultDate={editor.date}
                isOpen={editor.open}
                categories={liveCategories}
                onClose={close}
                onSave={(ev) => actions.calendarUpsert(ev)}
                onDelete={(id) => actions.calendarDelete(id)}
            />

            <CalendarSourceDetail
                event={sourceDetail}
                onClose={() => setSourceDetail(null)}
                onOpenSource={(event) => {
                    const target = calendarSourceTarget(event);
                    if (!target || !onNavigate) return;
                    setSourceDetail(null);
                    onNavigate(target);
                }}
                canNavigate={Boolean(sourceDetail && calendarSourceTarget(sourceDetail) && onNavigate)}
            />

            {managerOpen && typeof document !== "undefined" && createPortal(
                <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={() => setManagerOpen(false)}>
                    <div className="my-auto flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl shadow-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
                        <div className="flex shrink-0 items-center gap-2 border-b border-secondary px-5 py-4">
                            <h2 className="text-sm font-semibold text-primary">Calendar categories</h2>
                            <button type="button" aria-label="Close calendar categories" onClick={() => setManagerOpen(false)} className="ml-auto rounded p-1 text-quaternary hover:bg-[var(--surface-2)]">
                                <XClose className="size-4" />
                            </button>
                        </div>
                        <div className="min-h-0 overflow-y-auto p-5">
                            <CalendarCategoriesManager categories={liveCategories} actions={actions} />
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
};

// ---- a single event chip (month view) ----
const EventChip = ({ ev, onEdit }: { ev: CalendarEvent; onEdit: (e: CalendarEvent) => void }) => (
    <button
        type="button"
        // Stop the parent react-aria calendar cell from also reacting to the press.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
            e.stopPropagation();
            onEdit(ev);
        }}
        className="flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-md px-1.5 py-1 text-left text-xs transition hover:opacity-90"
        style={{ background: ev.color + "22", color: "var(--c-text-primary)" }}
        title={ev.title}
    >
        <ProjectIcon icon={(ev as RichCalendarEvent).icon ?? categoryById(ev.category).icon} color={ev.color} size={13} tile={false} />
        {!ev.allDay && <span className="shrink-0 text-[10px] text-tertiary tabular-nums">{fmtTime(ev.start)}</span>}
        <span className="truncate">{ev.title}</span>
    </button>
);

const CalendarSourceDetail = ({
    event,
    onClose,
    onOpenSource,
    canNavigate,
}: {
    event: RichCalendarEvent | null;
    onClose: () => void;
    onOpenSource: (event: RichCalendarEvent) => void;
    canNavigate: boolean;
}) => {
    const category = categoryById(event?.category ?? "work");
    const sourceLabel = event?.source?.label || category.label;
    const dateLabel = event
        ? new Intl.DateTimeFormat(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
            ...(event.allDay ? {} : { hour: "numeric", minute: "2-digit" }),
            ...(event.timezone ? { timeZone: event.timezone } : {}),
        }).format(new Date(event.start))
        : "";
    return (
        <SlideoutMenu isOpen={Boolean(event)} onOpenChange={(open) => !open && onClose()} isDismissable dialogClassName="gap-0">
            {event && <>
                <SlideoutMenu.Header onClose={onClose} className="flex w-full items-center gap-3 pb-5">
                    <ProjectIcon icon={event.icon ?? category.icon} color={event.color} size={40} />
                    <div className="min-w-0 pr-8"><p className="truncate text-xs font-medium text-tertiary">{sourceLabel}</p><h1 className="truncate text-lg font-semibold text-primary">{event.title}</h1></div>
                </SlideoutMenu.Header>
                <SlideoutMenu.Content className="gap-4 border-t border-secondary py-5">
                    <div className="flex items-start gap-2.5 rounded-xl border border-secondary bg-secondary p-3">
                        <Lock01 className="mt-0.5 size-4 shrink-0 text-quaternary" />
                        <div><p className="text-xs font-semibold text-primary">Managed by {sourceLabel}</p><p className="mt-0.5 text-xs leading-4 text-tertiary">This is a live source event. Open its module to make changes without creating a disconnected calendar copy.</p></div>
                    </div>

                    <section className="rounded-xl border border-secondary bg-primary p-4">
                        <div className="flex items-start gap-3"><Clock className="mt-0.5 size-4 shrink-0 text-quaternary" /><div><p className="text-sm font-medium text-primary">{dateLabel}</p><p className="mt-0.5 text-xs text-tertiary">{event.allDay ? "All day" : `${fmtTime(event.start, event.timezone)} – ${fmtTime(event.end, event.timezone)}`}{event.timezone ? ` · ${event.timezone}` : ""}</p></div></div>
                    </section>

                    <div className="grid grid-cols-2 gap-3">
                        <DetailStat label="Calendar" value={category.label} icon={<ProjectIcon icon={event.icon ?? category.icon} color={event.color} size={15} tile={false} />} />
                        <DetailStat label="Status" value={(event.status ?? "confirmed").replaceAll("_", " ")} />
                        <DetailStat label="Priority" value={event.priority && event.priority !== "none" ? event.priority : "Normal"} />
                        <DetailStat label="Source" value={event.source?.kind ?? "module"} />
                    </div>

                    {event.description && <DetailBlock title="Details"><p className="whitespace-pre-wrap text-sm leading-5 text-secondary">{event.description}</p></DetailBlock>}
                    {event.location && <DetailBlock title="Location"><p className="flex items-start gap-2 text-sm text-secondary"><MarkerPin01 className="mt-0.5 size-4 shrink-0 text-quaternary" />{event.location}</p></DetailBlock>}
                    {(event.url || event.conferenceUrl) && <DetailBlock title="Links"><div className="flex flex-col gap-2">{event.conferenceUrl && <a href={event.conferenceUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-lg border border-secondary px-3 py-2 text-sm font-medium text-secondary hover:bg-secondary">Join conference<ArrowUpRight className="size-4" /></a>}{event.url && <a href={event.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-lg border border-secondary px-3 py-2 text-sm font-medium text-secondary hover:bg-secondary">Open related link<ArrowUpRight className="size-4" /></a>}</div></DetailBlock>}
                    {event.attendees.length > 0 && <DetailBlock title="People"><div className="flex flex-wrap gap-1.5">{event.attendees.map((attendee) => <span key={attendee} className="rounded-full border border-secondary bg-secondary px-2.5 py-1 text-xs text-secondary">{attendee}</span>)}</div></DetailBlock>}
                    {event.customFields && event.customFields.length > 0 && <DetailBlock title="More information"><dl className="divide-y divide-secondary">{event.customFields.map((field) => <div key={field.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"><dt className="text-xs text-tertiary">{field.label}</dt><dd className="text-right text-xs font-medium text-secondary">{field.value}</dd></div>)}</dl></DetailBlock>}
                </SlideoutMenu.Content>
                <SlideoutMenu.Footer className="flex w-full items-center justify-between gap-3"><Button size="sm" color="secondary" onClick={onClose}>Close</Button><Button size="sm" color="primary" iconTrailing={ArrowUpRight} isDisabled={!canNavigate} onClick={() => onOpenSource(event)}>Open in {sourceLabel}</Button></SlideoutMenu.Footer>
            </>}
        </SlideoutMenu>
    );
};

const DetailStat = ({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) => <div className="rounded-xl border border-secondary bg-primary p-3"><p className="text-[11px] font-medium text-tertiary">{label}</p><p className="mt-1 flex items-center gap-1.5 text-sm font-semibold capitalize text-primary">{icon}{value}</p></div>;
const DetailBlock = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="rounded-xl border border-secondary bg-primary p-4"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary">{title}</h2>{children}</section>;

// ---- right-hand "day at a glance" sidebar — everything for the selected day
// (today by default), grouped by module category so it reads as one agenda
// instead of a wall of chips. ----
const DaySidebar = ({
    day,
    events,
    onNew,
    onEdit,
}: {
    day: Date;
    events: CalendarEvent[];
    onNew: (d: Date) => void;
    onEdit: (e: CalendarEvent) => void;
}) => {
    const isToday = sameDay(day, new Date());
    const grouped = useMemo(() => {
        const map = new Map<string, CalendarEvent[]>();
        for (const ev of events) {
            const list = map.get(ev.category) ?? [];
            list.push(ev);
            map.set(ev.category, list);
        }
        return [...map.entries()]
            .map(([id, list]) => ({ category: categoryById(id), events: list.sort((a, b) => (a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1)) }))
            .sort((a, b) => a.category.label.localeCompare(b.category.label));
    }, [events]);

    return (
        <aside className="flex w-full min-w-0 flex-col gap-3 overflow-hidden xl:col-span-2 min-[1680px]:col-span-1">
            <div className="rounded-xl border border-secondary bg-primary p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                        <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">{isToday ? "Today" : "Selected day"}</p>
                        <p className="text-sm font-semibold text-primary">{day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
                    </div>
                    <Button size="sm" color="secondary" iconLeading={CalendarPlus01} onClick={() => onNew(day)}>
                        Add
                    </Button>
                </div>
                {events.length === 0 ? (
                    <p className="py-6 text-center text-sm text-tertiary">Nothing on the books for this day.</p>
                ) : (
                    <div className="flex max-h-[min(70vh,640px)] flex-col gap-4 overflow-y-auto">
                        {grouped.map(({ category, events: catEvents }) => (
                            <div key={category.id} className="flex flex-col gap-1.5">
                                <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-quaternary uppercase">
                                    <span className="size-1.5 rounded-full" style={{ background: category.color }} />
                                    {category.label}
                                </p>
                                <ul className="flex flex-col gap-1">
                                    {catEvents.map((ev) => (
                                        <li key={ev.id}>
                                            <button
                                                type="button"
                                                onClick={() => onEdit(ev)}
                                                className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--surface-2)]"
                                            >
                                                {!ev.allDay && <span className="mt-0.5 w-12 shrink-0 text-[11px] text-tertiary tabular-nums">{fmtTime(ev.start)}</span>}
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm text-primary">{ev.title}</span>
                                                    {ev.description && <span className="block truncate text-xs text-tertiary">{ev.description}</span>}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </aside>
    );
};

// ---- month view, built on the Untitled UI / react-aria <Calendar> (grid + a11y +
// month navigation), with tall cells that host event chips. Clicking a day drills
// into the Day view; clicking a chip opens the editor. ----
const MonthCalendar = ({
    cursor,
    setCursor,
    eventsForDay,
    onDrill,
    onEdit,
}: {
    cursor: Date;
    setCursor: (d: Date) => void;
    eventsForDay: (d: Date) => CalendarEvent[];
    onDrill: (d: Date) => void;
    onEdit: (e: CalendarEvent) => void;
}) => (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border border-secondary bg-primary">
        <AriaCalendar
            aria-label="Month"
            value={null}
            focusedValue={toCalendarDate(cursor)}
            onFocusChange={(v) => v && setCursor(fromDateValue(v))}
            onChange={(v) => v && onDrill(fromDateValue(v))}
            className="w-full min-w-0"
        >
            <AriaCalendarGrid weekdayStyle="short" className="w-full min-w-0 table-fixed border-collapse">
                <AriaCalendarGridHeader>
                    {(day) => (
                        <AriaCalendarHeaderCell className="w-[14.28%] border-b border-secondary p-0">
                            <div className="truncate py-2 text-center text-xs font-semibold text-tertiary">{day.slice(0, 3)}</div>
                        </AriaCalendarHeaderCell>
                    )}
                </AriaCalendarGridHeader>
                <AriaCalendarGridBody className="[&_td]:w-[14.28%] [&_td]:p-0 [&_td]:align-top">
                    {(date) => (
                        <AriaCalendarCell date={date} className="min-w-0 overflow-hidden align-top outline-hidden">
                            {({ isOutsideMonth, isToday, formattedDate }) => {
                                const dayEvents = eventsForDay(fromDateValue(date));
                                return (
                                    <div className={cx("flex min-h-[88px] w-full min-w-0 cursor-pointer flex-col gap-0.5 overflow-hidden border-b border-r border-secondary p-1 transition hover:bg-[var(--surface-2)] sm:min-h-[104px] sm:p-1.5", isOutsideMonth && "bg-secondary/30 opacity-45")}>
                                        <span
                                            className={cx("flex size-6 shrink-0 items-center justify-center self-start rounded-full text-xs font-medium", isToday ? "text-white" : "text-secondary")}
                                            style={isToday ? { background: "var(--brand)" } : undefined}
                                        >
                                            {formattedDate}
                                        </span>
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                                            {dayEvents.slice(0, 3).map((ev) => (
                                                <EventChip key={ev.id} ev={ev} onEdit={onEdit} />
                                            ))}
                                            {dayEvents.length > 3 && <span className="truncate px-1 text-[10px] font-medium text-quaternary">+{dayEvents.length - 3} more</span>}
                                        </div>
                                    </div>
                                );
                            }}
                        </AriaCalendarCell>
                    )}
                </AriaCalendarGridBody>
            </AriaCalendarGrid>
        </AriaCalendar>
    </div>
);

// ---- positioned event block for the time-grid (week/day) ----
const TimeBlock = ({ ev, day, onEdit }: { ev: CalendarEvent; day: Date; onEdit: (e: CalendarEvent) => void }) => {
    const dayStart = startOfDay(day);
    const dayEnd = startOfDay(addDays(day, 1));
    // Clamp the event to the visible day so multi-day events render sanely.
    const s = Math.max(ev.start, dayStart);
    const e = Math.min(ev.end, dayEnd);
    const startDate = new Date(s);
    const endDate = new Date(e);
    const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
    const endMinutes = e >= dayEnd ? 24 * 60 : endDate.getHours() * 60 + endDate.getMinutes();
    const top = (startMinutes / (24 * 60)) * 24 * HOUR_PX;
    const height = Math.max(18, ((Math.max(startMinutes + 1, endMinutes) - startMinutes) / (24 * 60)) * 24 * HOUR_PX);
    return (
        <button
            type="button"
            onClick={(evt) => {
                evt.stopPropagation();
                onEdit(ev);
            }}
            className="absolute right-1 left-1 overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left transition hover:opacity-90"
            style={{ top, height, background: ev.color + "22", borderColor: ev.color }}
            title={ev.title}
        >
            <p className="truncate text-xs font-medium text-primary">{ev.title}</p>
            {height > 30 && <p className="truncate text-[10px] text-tertiary tabular-nums">{fmtTime(ev.start)}</p>}
        </button>
    );
};

// ---- a vertical hour axis + day column(s) time grid ----
const TimeGrid = ({
    days,
    eventsForDay,
    onNew,
    onEdit,
}: {
    days: Date[];
    eventsForDay: (d: Date) => CalendarEvent[];
    onNew: (d: Date) => void;
    onEdit: (e: CalendarEvent) => void;
}) => {
    const today = new Date();
    const perDay = days.map((d) => eventsForDay(d));
    const hasAllDay = perDay.some((evs) => evs.some((e) => e.allDay));

    return (
        <div className="overflow-hidden rounded-xl border border-secondary bg-primary">
            {/* Day headers */}
            <div className="grid border-b border-secondary" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
                <div className="border-r border-secondary" />
                {days.map((day) => {
                    const isToday = sameDay(day, today);
                    return (
                        <div key={dateKey(day)} className="flex items-center justify-center gap-1.5 border-r border-secondary py-2 last:border-r-0">
                            <span className="text-xs font-semibold text-tertiary">{WEEKDAYS[day.getDay()]}</span>
                            <span
                                className={cx("flex size-6 items-center justify-center rounded-full text-xs font-medium", isToday ? "text-white" : "text-secondary")}
                                style={isToday ? { background: "var(--brand)" } : undefined}
                            >
                                {day.getDate()}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* All-day strip */}
            {hasAllDay && (
                <div className="grid border-b border-secondary" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
                    <div className="flex items-center justify-end border-r border-secondary px-2 py-1 text-[10px] font-medium text-quaternary">all-day</div>
                    {perDay.map((evs, i) => (
                        <div key={i} className="flex flex-col gap-0.5 border-r border-secondary p-1 last:border-r-0">
                            {evs.filter((e) => e.allDay).map((ev) => (
                                <EventChip key={ev.id} ev={ev} onEdit={onEdit} />
                            ))}
                        </div>
                    ))}
                </div>
            )}

            {/* Scrollable time body */}
            <div className="max-h-[640px] overflow-y-auto">
                <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
                    {/* Hour axis */}
                    <div className="border-r border-secondary">
                        {HOURS.map((h) => (
                            <div key={h} className="relative border-b border-secondary" style={{ height: HOUR_PX }}>
                                {h > 0 && <span className="absolute -top-2 right-1.5 text-[10px] text-quaternary tabular-nums">{fmtHour(h)}</span>}
                            </div>
                        ))}
                    </div>
                    {/* Day columns */}
                    {days.map((day, di) => (
                        <div key={dateKey(day)} className="relative border-r border-secondary last:border-r-0">
                            {HOURS.map((h) => (
                                <button
                                    key={h}
                                    type="button"
                                    aria-label={`Add event ${fmtHour(h)}`}
                                    onClick={() => onNew(day)}
                                    className="block w-full border-b border-secondary transition hover:bg-[var(--surface-2)]"
                                    style={{ height: HOUR_PX }}
                                />
                            ))}
                            {perDay[di]
                                .filter((e) => !e.allDay)
                                .map((ev) => (
                                    <TimeBlock key={ev.id} ev={ev} day={day} onEdit={onEdit} />
                                ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ---- week view (7-day time grid) ----
const WeekView = ({
    cursor,
    eventsForDay,
    onNew,
    onEdit,
}: {
    cursor: Date;
    eventsForDay: (d: Date) => CalendarEvent[];
    onNew: (d: Date) => void;
    onEdit: (e: CalendarEvent) => void;
}) => {
    const ws = startOfWeek(cursor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    return <TimeGrid days={days} eventsForDay={eventsForDay} onNew={onNew} onEdit={onEdit} />;
};

// ---- day view (single-day time grid + agenda) ----
const DayView = ({
    cursor,
    events,
    onNew,
    onEdit,
}: {
    cursor: Date;
    events: CalendarEvent[];
    onNew: (d: Date) => void;
    onEdit: (e: CalendarEvent) => void;
}) => {
    const eventsForDay = (d: Date) => (sameDay(d, cursor) ? events : []);
    return (
        <div className="flex flex-col gap-5">
            <TimeGrid days={[cursor]} eventsForDay={eventsForDay} onNew={onNew} onEdit={onEdit} />

            <div className="rounded-xl border border-secondary bg-primary p-4">
                <p className="mb-2 text-xs font-semibold tracking-wide text-tertiary uppercase">Agenda</p>
                {events.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-center">
                        <p className="text-sm text-tertiary">No events on this day.</p>
                        <Button size="sm" color="secondary" iconLeading={CalendarPlus01} onClick={() => onNew(cursor)}>
                            Add an event
                        </Button>
                    </div>
                ) : (
                    <ul className="flex flex-col divide-y divide-[var(--c-border)]">
                        {events.map((ev) => (
                            <li key={ev.id}>
                                <button type="button" onClick={() => onEdit(ev)} className="flex w-full items-start gap-3 py-3 text-left transition hover:opacity-90">
                                    <span className="mt-1 w-20 shrink-0 text-xs font-medium text-tertiary tabular-nums">{ev.allDay ? "All day" : fmtTime(ev.start)}</span>
                                    <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: ev.color }} />
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-primary">{ev.title}</p>
                                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-tertiary">
                                            {!ev.allDay && (
                                                <span>
                                                    {fmtTime(ev.start)} – {fmtTime(ev.end)}
                                                </span>
                                            )}
                                            <span className="capitalize">{categoryById(ev.category).label}</span>
                                            {ev.location && (
                                                <span className="flex items-center gap-1">
                                                    <MarkerPin01 className="size-3" />
                                                    {ev.location}
                                                </span>
                                            )}
                                            {ev.attendees.length > 0 && (
                                                <span className="flex items-center gap-1">
                                                    <Users01 className="size-3" />
                                                    {ev.attendees.length}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};
