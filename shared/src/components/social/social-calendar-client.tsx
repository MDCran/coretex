// @ts-nocheck
import { useMemo, useState } from "react";

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
import { BatteryFull, Calendar, ChevronLeft, ChevronRight, Gift01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Tabs } from "@/components/application/tabs/tabs";
import { Card } from "@/components/social/ui";
import { cx } from "@/utils/cx";

export type BatteryDay = { date: string; energy: number | null };
export type SocialCalEvent = { id: string; title: string; date: string; href: string };

type View = "month" | "week" | "day";

function batteryBg(level: number | null): string {
    if (level == null) return "";
    if (level <= 3) return "bg-error-secondary";
    if (level <= 6) return "bg-warning-secondary";
    return "bg-success-secondary";
}

function batteryText(level: number | null): string {
    if (level == null) return "text-tertiary";
    if (level <= 3) return "text-error-primary";
    if (level <= 6) return "text-warning-primary";
    return "text-success-primary";
}

/**
 * Social battery + events calendar. Mirrors the main /calendar page: a prev/today/next
 * toolbar, an Untitled UI tab view switcher (Month / Week / Day), and a day-detail
 * sidebar. Links out to the full calendar for cross-module detail.
 */
export function SocialCalendarClient({ battery, events }: { battery: BatteryDay[]; events: SocialCalEvent[] }) {
    const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
    const [view, setView] = useState<View>("month");
    const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());

    const batteryByDay = useMemo(() => new Map(battery.map((b) => [b.date.slice(0, 10), b.energy])), [battery]);
    const eventsByDay = useMemo(() => {
        const m = new Map<string, SocialCalEvent[]>();
        for (const e of events) {
            const key = e.date.slice(0, 10);
            const list = m.get(key) ?? [];
            list.push(e);
            m.set(key, list);
        }
        return m;
    }, [events]);

    const energyFor = (d: Date) => batteryByDay.get(format(d, "yyyy-MM-dd")) ?? null;
    const eventsFor = (d: Date) => eventsByDay.get(format(d, "yyyy-MM-dd")) ?? [];

    const monthDays = useMemo(() => {
        const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
        const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
        return eachDayOfInterval({ start, end });
    }, [cursor]);

    const weekDays = useMemo(() => {
        const start = startOfWeek(cursor, { weekStartsOn: 0 });
        return eachDayOfInterval({ start, end: addDays(start, 6) });
    }, [cursor]);

    function shift(dir: number) {
        setCursor((c) => (view === "month" ? addMonths(c, dir) : view === "week" ? addDays(c, dir * 7) : addDays(c, dir)));
    }
    function goToday() {
        const today = new Date();
        setCursor(view === "month" ? startOfMonth(today) : today);
        setSelectedDay(today);
    }
    function setViewMode(next: View) {
        setView(next);
        if (next === "day") {
            setCursor(selectedDay);
        } else if (next === "month") {
            setCursor((c) => startOfMonth(c));
        }
    }
    function selectDay(d: Date) {
        setSelectedDay(d);
        if (view === "day") setCursor(d);
    }

    const headerLabel =
        view === "month"
            ? format(cursor, "MMMM yyyy")
            : view === "day"
              ? format(cursor, "EEEE, MMMM d, yyyy")
              : `${format(weekDays[0], "MMM d")} – ${format(weekDays[6], "MMM d, yyyy")}`;

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
                    <Tabs selectedKey={view} onSelectionChange={(k) => setViewMode(k as View)}>
                        <Tabs.List type="button-gray" size="sm">
                            <Tabs.Item id="month">Month</Tabs.Item>
                            <Tabs.Item id="week">Week</Tabs.Item>
                            <Tabs.Item id="day">Day</Tabs.Item>
                        </Tabs.List>
                    </Tabs>
                    <Button size="sm" color="secondary" iconLeading={Calendar} href="/calendar">
                        Open full calendar
                    </Button>
                </div>
            </div>

            <div className="flex gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                    {view === "month" && (
                        <div className="overflow-hidden rounded-xl bg-primary ring-1 ring-secondary ring-inset">
                            <div className="grid grid-cols-7 border-b border-secondary">
                                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                                    <div key={d} className={cx("px-2 py-2 text-center text-xs font-medium text-tertiary", (i === 0 || i === 6) && "bg-secondary_subtle")}>
                                        {d}
                                    </div>
                                ))}
                            </div>
                            <div className="grid grid-cols-7">
                                {monthDays.map((day) => {
                                    const energy = energyFor(day);
                                    const dayEvents = eventsFor(day);
                                    const inMonth = isSameMonth(day, cursor);
                                    const selected = isSameDay(day, selectedDay);
                                    return (
                                        <button
                                            key={day.toISOString()}
                                            type="button"
                                            onClick={() => selectDay(day)}
                                            className={cx(
                                                "flex min-h-24 flex-col gap-1 border-r border-b border-secondary p-2 text-left align-top transition [&:nth-child(7n)]:border-r-0",
                                                isWeekend(day) && "bg-secondary_subtle/60",
                                                !inMonth && "bg-secondary_subtle opacity-60",
                                                isToday(day) && "ring-2 ring-brand ring-inset",
                                                selected && "bg-brand-primary/40 ring-2 ring-brand ring-inset",
                                            )}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className={cx("inline-flex size-6 items-center justify-center rounded-full text-xs", isToday(day) ? "bg-brand-solid font-bold text-white" : inMonth ? "text-secondary" : "text-quaternary")}>
                                                    {format(day, "d")}
                                                </span>
                                                {energy != null && (
                                                    <span className={cx("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", batteryBg(energy), batteryText(energy))}>
                                                        <BatteryFull className="size-2.5" aria-hidden="true" />
                                                        {energy}
                                                    </span>
                                                )}
                                            </div>
                                            {dayEvents.slice(0, 2).map((e) => (
                                                <span key={e.id} className="flex items-center gap-1 truncate rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-secondary">
                                                    <Gift01 className="size-2.5 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                                    <span className="truncate">{e.title}</span>
                                                </span>
                                            ))}
                                            {dayEvents.length > 2 && <span className="px-1 text-[10px] text-tertiary">+{dayEvents.length - 2} more</span>}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {view === "week" && (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
                            {weekDays.map((day) => {
                                const energy = energyFor(day);
                                const dayEvents = eventsFor(day);
                                const selected = isSameDay(day, selectedDay);
                                return (
                                    <button
                                        key={day.toISOString()}
                                        type="button"
                                        onClick={() => selectDay(day)}
                                        className={cx(
                                            "flex min-h-40 flex-col gap-1.5 rounded-xl bg-primary p-2.5 text-left ring-1 ring-secondary ring-inset transition hover:bg-secondary_hover",
                                            isToday(day) && "ring-2 ring-brand",
                                            selected && "bg-brand-primary/40 ring-2 ring-brand",
                                        )}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium text-tertiary">{format(day, "EEE")}</span>
                                            <span className={cx("inline-flex size-6 items-center justify-center rounded-full text-xs", isToday(day) ? "bg-brand-solid font-bold text-white" : "text-secondary")}>
                                                {format(day, "d")}
                                            </span>
                                        </div>
                                        {energy != null && (
                                            <span className={cx("inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", batteryBg(energy), batteryText(energy))}>
                                                <BatteryFull className="size-3" aria-hidden="true" />
                                                {energy}/10
                                            </span>
                                        )}
                                        <div className="flex flex-col gap-1">
                                            {dayEvents.map((e) => (
                                                <span key={e.id} className="flex items-center gap-1 truncate rounded-md bg-secondary px-1.5 py-1 text-[11px] text-secondary">
                                                    <Gift01 className="size-3 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                                    <span className="truncate">{e.title}</span>
                                                </span>
                                            ))}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {view === "day" && <DayAgenda day={cursor} energy={energyFor(cursor)} events={eventsFor(cursor)} />}
                </div>

                {/* Selected-day sidebar (desktop) */}
                <div className="hidden w-80 shrink-0 lg:block">
                    <Card className="sticky top-4">
                        <DayPanel day={selectedDay} energy={energyFor(selectedDay)} events={eventsFor(selectedDay)} />
                    </Card>
                </div>
            </div>

            {/* Selected-day panel (mobile, below grid) */}
            {view !== "day" && (
                <div className="lg:hidden">
                    <Card>
                        <DayPanel day={selectedDay} energy={energyFor(selectedDay)} events={eventsFor(selectedDay)} />
                    </Card>
                </div>
            )}
        </div>
    );
}

function BatteryStat({ energy }: { energy: number | null }) {
    return (
        <div className={cx("flex items-center justify-between rounded-xl px-3 py-2.5 ring-1 ring-inset", energy != null ? cx(batteryBg(energy), "ring-transparent") : "bg-secondary ring-secondary")}>
            <span className="flex items-center gap-2 text-sm font-medium text-secondary">
                <BatteryFull className={cx("size-4", batteryText(energy))} aria-hidden="true" />
                Social battery
            </span>
            <span className={cx("text-sm font-semibold", batteryText(energy))}>{energy != null ? `${energy}/10` : "Not logged"}</span>
        </div>
    );
}

function DayPanel({ day, energy, events }: { day: Date; energy: number | null; events: SocialCalEvent[] }) {
    return (
        <div className="flex flex-col gap-4">
            <div>
                <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">{isToday(day) ? "Today" : format(day, "EEEE")}</p>
                <p className="text-lg font-semibold text-primary">{format(day, "MMMM d, yyyy")}</p>
            </div>
            <BatteryStat energy={energy} />
            <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">Events</p>
                {events.length === 0 ? (
                    <p className="text-sm text-tertiary">No social events.</p>
                ) : (
                    <ul className="flex flex-col gap-1.5">
                        {events.map((e) => (
                            <li key={e.id}>
                                <a href="#">
                                    <Gift01 className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                    <span className="truncate">{e.title}</span>
                                </a>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function DayAgenda({ day, energy, events }: { day: Date; energy: number | null; events: SocialCalEvent[] }) {
    return (
        <div className="flex flex-col gap-4 rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset">
            <BatteryStat energy={energy} />
            <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">Events on {format(day, "MMM d")}</p>
                {events.length === 0 ? (
                    <p className="text-sm text-tertiary">No social events on this day.</p>
                ) : (
                    <ul className="flex flex-col divide-y divide-secondary">
                        {events.map((e) => (
                            <li key={e.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                <a href="#">
                                    <Gift01 className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                    <span className="truncate">{e.title}</span>
                                </a>
                                <Badge size="sm" color="gray">{format(new Date(e.date), "MMM d")}</Badge>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
