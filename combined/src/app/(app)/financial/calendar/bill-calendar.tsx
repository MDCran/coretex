"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { formatCurrency } from "@/lib/financial/format";
import { Card } from "../_components/financial-ui";

export interface BillCalendarEvent {
    id: string;
    /** yyyy-mm-dd (local). */
    date: string;
    label: string;
    amount: number;
    kind: "subscription" | "card" | "income";
    overdue: boolean;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KIND_DOT: Record<BillCalendarEvent["kind"], string> = {
    subscription: "bg-brand-solid",
    card: "bg-warning-solid",
    income: "bg-success-solid",
};

function ymd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function BillCalendar({ events, todayIso }: { events: BillCalendarEvent[]; todayIso: string }) {
    const [view, setView] = useState(() => {
        const [y, m] = todayIso.split("-").map(Number);
        return { year: y, month: m - 1 };
    });

    const byDate = useMemo(() => {
        const map = new Map<string, BillCalendarEvent[]>();
        for (const e of events) {
            const arr = map.get(e.date) ?? [];
            arr.push(e);
            map.set(e.date, arr);
        }
        return map;
    }, [events]);

    const monthStart = new Date(view.year, view.month, 1);
    const monthLabel = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const leadingBlanks = monthStart.getDay();

    const cells: (Date | null)[] = [];
    for (let i = 0; i < leadingBlanks; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.year, view.month, d));
    while (cells.length % 7 !== 0) cells.push(null);

    const monthEvents = events
        .filter((e) => e.date.startsWith(`${view.year}-${String(view.month + 1).padStart(2, "0")}`))
        .sort((a, b) => a.date.localeCompare(b.date));
    const monthTotal = monthEvents.filter((e) => e.kind !== "income").reduce((s, e) => s + e.amount, 0);

    const shift = (delta: number) => {
        const d = new Date(view.year, view.month + delta, 1);
        setView({ year: d.getFullYear(), month: d.getMonth() });
    };

    return (
        <div className="flex flex-col gap-4">
            <Card className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-primary">{monthLabel}</h2>
                    <div className="flex items-center gap-1">
                        <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="rounded-md p-1.5 text-fg-quaternary transition hover:bg-primary_hover hover:text-fg-secondary">
                            <ChevronLeft className="size-5" />
                        </button>
                        <button type="button" onClick={() => setView(() => { const [y, m] = todayIso.split("-").map(Number); return { year: y, month: m - 1 }; })} className="rounded-md px-2 py-1 text-xs font-medium text-tertiary transition hover:bg-primary_hover hover:text-secondary">
                            Today
                        </button>
                        <button type="button" onClick={() => shift(1)} aria-label="Next month" className="rounded-md p-1.5 text-fg-quaternary transition hover:bg-primary_hover hover:text-fg-secondary">
                            <ChevronRight className="size-5" />
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-7 gap-1">
                    {WEEKDAYS.map((w) => (
                        <div key={w} className="px-1 pb-1 text-center text-xs font-medium text-quaternary">
                            {w}
                        </div>
                    ))}
                    {cells.map((date, i) => {
                        if (!date) return <div key={`b${i}`} className="min-h-20 rounded-lg" />;
                        const iso = ymd(date);
                        const dayEvents = byDate.get(iso) ?? [];
                        const isToday = iso === todayIso;
                        return (
                            <div key={iso} className={cx("flex min-h-20 flex-col gap-1 rounded-lg p-1.5 ring-1 ring-inset", isToday ? "bg-secondary ring-brand" : "ring-secondary")}>
                                <span className={cx("text-xs font-medium tabular-nums", isToday ? "text-brand-secondary" : "text-tertiary")}>{date.getDate()}</span>
                                <div className="flex flex-col gap-0.5">
                                    {dayEvents.slice(0, 3).map((e) => (
                                        <div key={e.id} className={cx("flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] leading-tight", e.overdue ? "bg-error-primary text-error-primary" : "text-secondary")} title={`${e.label} · ${formatCurrency(e.amount)}`}>
                                            <span className={cx("size-1.5 shrink-0 rounded-full", e.overdue ? "bg-error-solid" : KIND_DOT[e.kind])} />
                                            <span className="truncate">{e.label}</span>
                                        </div>
                                    ))}
                                    {dayEvents.length > 3 && <span className="px-1 text-[10px] text-quaternary">+{dayEvents.length - 3} more</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </Card>

            <Card className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-secondary">{monthLabel} bills</p>
                    <p className="text-sm font-semibold text-primary tabular-nums">{formatCurrency(monthTotal)}</p>
                </div>
                {monthEvents.length === 0 ? (
                    <p className="py-4 text-center text-sm text-tertiary">Nothing scheduled this month.</p>
                ) : (
                    <ul className="flex flex-col divide-y divide-secondary">
                        {monthEvents.map((e) => (
                            <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                                <div className="flex min-w-0 items-center gap-2.5">
                                    <span className={cx("size-2 shrink-0 rounded-full", e.overdue ? "bg-error-solid" : KIND_DOT[e.kind])} />
                                    <div className="min-w-0">
                                        <p className="truncate text-sm text-primary">{e.label}</p>
                                        <p className="text-xs text-tertiary">
                                            {new Date(`${e.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                                            {e.overdue && <span className="ml-1.5 font-medium text-error-primary">· Overdue</span>}
                                        </p>
                                    </div>
                                </div>
                                <span className={cx("shrink-0 text-sm font-medium tabular-nums", e.kind === "income" ? "text-success-primary" : "text-primary")}>
                                    {e.kind === "income" ? "+" : ""}
                                    {formatCurrency(e.amount)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
}
