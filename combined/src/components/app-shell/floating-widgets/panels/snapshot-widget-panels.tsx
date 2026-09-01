"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { ControlledDateInput } from "@/components/base/input/form-date-input";
import { cx } from "@/utils/cx";
import { quickLogSocialEvent } from "@/lib/actions/social-events";
import {
    getCalendarWidgetSnapshot,
    getFinancialWidgetSnapshot,
    getNutritionWidgetSnapshot,
    getSocialWidgetSnapshot,
    type CalendarRange,
    type CalendarWidgetSnapshot,
    type FinancialWidgetSnapshot,
    type NutritionWidgetSnapshot,
    type SocialWidgetSnapshot,
} from "@/lib/actions/widget-snapshots";

const POLL_MS = 60_000;

function WidgetLoading() {
    return <div className="flex flex-1 items-center justify-center p-6 text-sm text-tertiary">Loading…</div>;
}

function fmtTime(iso: string, allDay: boolean) {
    if (allDay) return "All day";
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDateTime(iso: string, allDay: boolean) {
    const d = fmtDate(iso);
    return allDay ? `${d} · All day` : `${d} · ${fmtTime(iso, false)}`;
}

/** Small progress meter used by nutrition/financial panels. */
function GoalBar({ value, goal, label, unit, tone = "brand" }: { value: number; goal: number | null; label: string; unit: string; tone?: "brand" | "success" }) {
    const pct = goal && goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
    const over = goal != null && value > goal;
    return (
        <div>
            <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium text-secondary">{label}</span>
                <span className="tabular-nums text-tertiary">
                    {value}
                    {goal != null ? ` / ${goal}` : ""} {unit}
                </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-quaternary">
                <div
                    className={cx("h-full rounded-full", over ? "bg-error-solid" : tone === "success" ? "bg-success-solid" : "bg-brand-solid")}
                    style={{ width: `${goal && goal > 0 ? pct : value > 0 ? 100 : 0}%` }}
                />
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar — today / tomorrow / this week
// ─────────────────────────────────────────────────────────────────────────────

const CAL_MODES: { id: "day" | "week"; label: string }[] = [
    { id: "day", label: "By day" },
    { id: "week", label: "Upcoming" },
];

/** Friendly label for a day offset from today (0 = Today). */
function dayLabel(offset: number, iso: string | null): string {
    if (offset === 0) return "Today";
    if (offset === 1) return "Tomorrow";
    if (offset === -1) return "Yesterday";
    const d = iso ? new Date(iso) : new Date(Date.now() + offset * 86_400_000);
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function CalendarWidgetPanel() {
    const [mode, setMode] = useState<"day" | "week">("day");
    const [dayOffset, setDayOffset] = useState(0);
    const [data, setData] = useState<CalendarWidgetSnapshot | null>(null);

    const load = useCallback(async (m: "day" | "week", offset: number) => {
        try {
            setData(await getCalendarWidgetSnapshot(m === "day" ? "day" : "week", offset));
        } catch {
            /* ignore */
        }
    }, []);
    useEffect(() => {
        void load(mode, dayOffset);
        const id = setInterval(() => void load(mode, dayOffset), POLL_MS);
        return () => clearInterval(id);
    }, [load, mode, dayOffset]);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div className="flex gap-1 rounded-lg bg-secondary_subtle p-1 ring-1 ring-inset ring-secondary">
                {CAL_MODES.map((m) => (
                    <button
                        key={m.id}
                        type="button"
                        onClick={() => setMode(m.id)}
                        className={cx(
                            "flex-1 rounded-md px-2 py-1 text-xs font-medium transition",
                            mode === m.id ? "bg-primary text-primary shadow-sm ring-1 ring-secondary" : "text-tertiary hover:text-secondary",
                        )}
                    >
                        {m.label}
                    </button>
                ))}
            </div>

            {mode === "day" && (
                <div className="flex items-center justify-between gap-2">
                    <Button size="sm" color="tertiary" iconLeading={ChevronLeft} aria-label="Previous day" onClick={() => setDayOffset((o) => o - 1)} />
                    <button
                        type="button"
                        onClick={() => setDayOffset(0)}
                        className="flex-1 rounded-md px-2 py-1 text-sm font-semibold text-primary transition hover:bg-secondary_hover"
                    >
                        {dayLabel(dayOffset, data?.dayIso ?? null)}
                    </button>
                    <Button size="sm" color="tertiary" iconTrailing={ChevronRight} aria-label="Next day" onClick={() => setDayOffset((o) => o + 1)} />
                </div>
            )}

            {!data ? (
                <WidgetLoading />
            ) : data.events.length === 0 ? (
                <p className="text-sm text-tertiary">{mode === "week" ? "Nothing coming up in the next 7 days." : `No events ${dayLabel(dayOffset, data.dayIso).toLowerCase()}.`}</p>
            ) : (
                <ul className="flex flex-col gap-1">
                    {data.events.map((e) => (
                        <li key={e.id} className="rounded-lg bg-secondary_subtle px-3 py-2 ring-1 ring-inset ring-secondary">
                            <p className="text-sm font-medium text-primary">{e.title}</p>
                            <p className="text-xs text-tertiary">{mode === "day" ? fmtTime(e.startsAt, e.allDay) : fmtDateTime(e.startsAt, e.allDay)}</p>
                        </li>
                    ))}
                </ul>
            )}
            <Button href="/calendar" size="sm" color="link-color" className="mt-auto self-start">
                Open Calendar
            </Button>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Nutrition — calories + macros vs daily goals
// ─────────────────────────────────────────────────────────────────────────────

export function NutritionWidgetPanel() {
    const [data, setData] = useState<NutritionWidgetSnapshot | null>(null);
    const load = useCallback(async () => {
        try {
            setData(await getNutritionWidgetSnapshot());
        } catch {
            /* ignore */
        }
    }, []);
    useEffect(() => {
        void load();
        const id = setInterval(() => void load(), POLL_MS);
        return () => clearInterval(id);
    }, [load]);

    if (!data) return <WidgetLoading />;

    const calPct = data.goalCalories && data.goalCalories > 0 ? Math.min(100, (data.calories / data.goalCalories) * 100) : 0;
    const remaining = data.goalCalories != null ? data.goalCalories - data.calories : null;

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <div className="rounded-xl bg-secondary_subtle p-3 ring-1 ring-inset ring-secondary">
                <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">Today</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-primary">{data.calories} kcal</p>
                {data.goalCalories != null && (
                    <>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-quaternary">
                            <div className={cx("h-full rounded-full", remaining != null && remaining < 0 ? "bg-error-solid" : "bg-brand-solid")} style={{ width: `${calPct}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-tertiary">
                            Goal {data.goalCalories} kcal{remaining != null ? ` · ${remaining >= 0 ? `${remaining} left` : `${Math.abs(remaining)} over`}` : ""}
                        </p>
                    </>
                )}
                <p className="mt-2 text-xs text-tertiary">{data.mealCount} {data.mealCount === 1 ? "meal" : "meals"} logged</p>
            </div>

            <div className="flex flex-col gap-3">
                <GoalBar label="Protein" value={data.protein} goal={data.goalProtein} unit="g" />
                <GoalBar label="Carbs" value={data.carbs} goal={data.goalCarbs} unit="g" />
                <GoalBar label="Fat" value={data.fat} goal={data.goalFat} unit="g" />
            </div>

            <Button href="/nutrition" size="sm" color="primary" className="mt-auto w-full">
                Log food
            </Button>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Social — upcoming + quick log
// ─────────────────────────────────────────────────────────────────────────────

function defaultEventLocal(): string {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SocialWidgetPanel() {
    const [data, setData] = useState<SocialWidgetSnapshot | null>(null);
    const [logging, setLogging] = useState(false);
    const [busy, setBusy] = useState(false);
    const [title, setTitle] = useState("");
    const [when, setWhen] = useState(defaultEventLocal);

    const load = useCallback(async () => {
        try {
            setData(await getSocialWidgetSnapshot());
        } catch {
            /* ignore */
        }
    }, []);
    useEffect(() => {
        void load();
        const id = setInterval(() => void load(), POLL_MS);
        return () => clearInterval(id);
    }, [load]);

    async function submit() {
        if (!title.trim()) {
            toast.error("Add a title");
            return;
        }
        setBusy(true);
        try {
            await quickLogSocialEvent({ name: title.trim(), eventDate: when });
            toast.success("Social event added");
            setTitle("");
            setWhen(defaultEventLocal());
            setLogging(false);
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't add event");
        } finally {
            setBusy(false);
        }
    }

    if (!data) return <WidgetLoading />;

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">Upcoming</p>
            {data.upcoming.length === 0 ? (
                <p className="text-sm text-tertiary">Nothing scheduled. Log a hangout below.</p>
            ) : (
                <ul className="flex flex-col gap-1">
                    {data.upcoming.map((e) => (
                        <li key={e.id} className="rounded-lg bg-secondary_subtle px-3 py-2 ring-1 ring-inset ring-secondary">
                            <p className="text-sm font-medium text-primary">{e.title}</p>
                            <p className="text-xs text-tertiary">
                                {fmtDateTime(e.startsAt, false)}
                                {e.location ? ` · ${e.location}` : ""}
                            </p>
                        </li>
                    ))}
                </ul>
            )}

            {logging ? (
                <div className="mt-1 flex flex-col gap-2 rounded-xl bg-secondary_subtle p-3 ring-1 ring-inset ring-secondary">
                    <input
                        autoFocus
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Coffee with Sam"
                        className="h-9 w-full rounded-md bg-primary px-2.5 text-sm text-primary ring-1 ring-primary ring-inset outline-none placeholder:text-placeholder focus:outline-2 focus:-outline-offset-2 focus:outline-brand"
                    />
                    <ControlledDateInput variant="datetime" value={when} onChange={setWhen} />
                    <div className="flex gap-2">
                        <Button size="sm" color="primary" className="flex-1" isLoading={busy} onClick={() => void submit()}>
                            Add
                        </Button>
                        <Button size="sm" color="tertiary" isDisabled={busy} onClick={() => setLogging(false)}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : (
                <Button size="sm" color="primary" iconLeading={Plus} className="w-full" onClick={() => setLogging(true)}>
                    Log a social thing
                </Button>
            )}

            <Button href="/social" size="sm" color="link-color" className="mt-auto self-start">
                Open Social
            </Button>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Financial — net worth + balances (works without Alpaca)
// ─────────────────────────────────────────────────────────────────────────────

function money(n: number): string {
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function FinancialWidgetPanel() {
    const [data, setData] = useState<FinancialWidgetSnapshot | null>(null);
    const load = useCallback(async () => {
        try {
            setData(await getFinancialWidgetSnapshot());
        } catch {
            /* ignore */
        }
    }, []);
    useEffect(() => {
        void load();
        const id = setInterval(() => void load(), POLL_MS);
        return () => clearInterval(id);
    }, [load]);

    if (!data) return <WidgetLoading />;

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            {!data.hasData ? (
                <p className="text-sm text-tertiary">Add accounts in Financial to see your net worth here.</p>
            ) : (
                <>
                    <div className="rounded-xl bg-secondary_subtle p-3 ring-1 ring-inset ring-secondary">
                        <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">Net worth</p>
                        <p className={cx("mt-1 text-2xl font-semibold tabular-nums", data.netWorth >= 0 ? "text-primary" : "text-error-primary")}>{money(data.netWorth)}</p>
                        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                            <span className="text-tertiary">Assets</span>
                            <span className="text-right tabular-nums text-success-primary">{money(data.assets)}</span>
                            <span className="text-tertiary">Liabilities</span>
                            <span className="text-right tabular-nums text-error-primary">{money(data.liabilities)}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-lg bg-secondary_subtle p-2 text-center ring-1 ring-inset ring-secondary">
                            <p className="text-[10px] font-semibold tracking-wide text-tertiary uppercase">Cash</p>
                            <p className="mt-0.5 text-sm font-semibold tabular-nums text-primary">{money(data.cash)}</p>
                        </div>
                        <div className="rounded-lg bg-secondary_subtle p-2 text-center ring-1 ring-inset ring-secondary">
                            <p className="text-[10px] font-semibold tracking-wide text-tertiary uppercase">Invest</p>
                            <p className="mt-0.5 text-sm font-semibold tabular-nums text-primary">{money(data.investments)}</p>
                        </div>
                        <div className="rounded-lg bg-secondary_subtle p-2 text-center ring-1 ring-inset ring-secondary">
                            <p className="text-[10px] font-semibold tracking-wide text-tertiary uppercase">Cards</p>
                            <p className="mt-0.5 text-sm font-semibold tabular-nums text-primary">{money(data.cardDebt)}</p>
                        </div>
                    </div>

                    {data.alpaca?.connected && (
                        <div className="rounded-lg bg-secondary_subtle px-3 py-2 ring-1 ring-inset ring-secondary">
                            <p className="flex items-center justify-between text-xs">
                                <span className="text-tertiary">Alpaca {data.alpaca.mode === "paper" ? "(paper)" : "(live)"}</span>
                                <span className="tabular-nums font-semibold text-primary">{data.alpaca.equity != null ? money(data.alpaca.equity) : "—"}</span>
                            </p>
                        </div>
                    )}
                </>
            )}
            <Button href="/financial" size="sm" color="link-color" className="mt-auto self-start">
                Open Financial
            </Button>
        </div>
    );
}
