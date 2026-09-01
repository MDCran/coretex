"use client";

import { useState } from "react";
import { CalendarPlus01, Check, ChevronLeft, ChevronRight, X } from "@untitledui/icons";
import type { Peptide } from "@/lib/peptides/types";
import type { Occurrence } from "@/lib/peptides/schedule";
import { isOccurrenceTaken } from "@/lib/peptides/admin";
import { fmt, fmtUnits } from "@/lib/peptides/format";
import {
    addDays,
    addMonths,
    dayOfMonth,
    isSameMonth,
    monthLabel,
    rangeLabel,
    startOfMonth,
    startOfWeek,
    todayISO,
    WEEKDAY_LABELS,
} from "@/lib/peptides/date";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { EmptyState } from "./empty-state";
import { cx } from "@/utils/cx";

export interface CalendarTrack {
    peptideId: string;
    name: string;
    color: string;
    peptide: Peptide;
    occurrences: Occurrence[];
}

type DoseStatus = "taken" | "missed" | "today" | "upcoming";

interface Item {
    track: CalendarTrack;
    occ: Occurrence;
    taken: boolean;
    status: DoseStatus;
}

function doseStatus(date: string, today: string, taken: boolean): DoseStatus {
    if (taken) return "taken";
    if (date < today) return "missed";
    if (date === today) return "today";
    return "upcoming";
}

interface Props {
    tracks: CalendarTrack[];
    onToggle: (peptideId: string, occ: Occurrence) => void;
    /** Show the per-item peptide name (multi-peptide mode). */
    showNames?: boolean;
}

function buildIndex(tracks: CalendarTrack[]): Map<string, Item[]> {
    const map = new Map<string, Item[]>();
    for (const track of tracks) {
        for (const occ of track.occurrences) {
            const taken = isOccurrenceTaken(track.peptide, occ);
            const item: Item = { track, occ, taken, status: doseStatus(occ.date, todayISO(), taken) };
            const list = map.get(occ.date);
            if (list) list.push(item);
            else map.set(occ.date, [item]);
        }
    }
    return map;
}

export function ScheduleCalendar({ tracks, onToggle, showNames = false }: Props) {
    const [view, setView] = useState<"week" | "month">("week");
    const [cursor, setCursor] = useState<string>(() => todayISO());
    const today = todayISO();
    const index = buildIndex(tracks);

    const step = (dir: 1 | -1) => setCursor((c) => (view === "week" ? addDays(c, dir * 7) : addMonths(c, dir)));

    const weekStart = startOfWeek(cursor);
    const weekEnd = addDays(weekStart, 6);
    const label = view === "week" ? rangeLabel(weekStart, weekEnd) : monthLabel(cursor);

    const hasSchedule = tracks.some((t) => t.occurrences.length > 0);

    // Adherence for the visible week.
    let weekTotal = 0;
    let weekTaken = 0;
    let weekMissed = 0;
    for (let i = 0; i < 7; i++) {
        const items = index.get(addDays(weekStart, i)) ?? [];
        for (const it of items) {
            weekTotal++;
            if (it.taken) weekTaken++;
            else if (it.status === "missed") weekMissed++;
        }
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <ButtonGroup
                    size="sm"
                    selectedKeys={[view]}
                    onSelectionChange={(keys) => {
                        const v = [...keys][0];
                        if (v === "week" || v === "month") setView(v);
                    }}
                >
                    <ButtonGroupItem id="week">Week</ButtonGroupItem>
                    <ButtonGroupItem id="month">Month</ButtonGroupItem>
                </ButtonGroup>
                <div className="flex items-center gap-2">
                    {view === "week" && weekTotal > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <Badge color={weekTaken === weekTotal ? "success" : "brand"} size="sm" type="pill-color">
                                {weekTaken}/{weekTotal} taken
                            </Badge>
                            {weekMissed > 0 && (
                                <Badge color="error" size="sm" type="pill-color">
                                    {weekMissed} missed
                                </Badge>
                            )}
                        </div>
                    )}
                    <span className="font-mono text-sm text-secondary tabular-nums">{label}</span>
                    <Button size="sm" color="secondary" iconLeading={ChevronLeft} onClick={() => step(-1)} aria-label="Previous" />
                    <Button size="sm" color="secondary" onClick={() => setCursor(today)}>
                        Today
                    </Button>
                    <Button size="sm" color="secondary" iconLeading={ChevronRight} onClick={() => step(1)} aria-label="Next" />
                </div>
            </div>

            {tracks.length > 1 && (
                <div className="flex flex-wrap gap-3">
                    {tracks.map((t) => (
                        <span key={t.peptideId} className="flex items-center gap-1.5 text-xs text-tertiary">
                            <span className="size-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                            {t.name}
                        </span>
                    ))}
                </div>
            )}

            {!hasSchedule ? (
                <div className="rounded-lg border border-dashed border-secondary">
                    <EmptyState
                        icon={CalendarPlus01}
                        title="Your schedule is ready to fill"
                        description="Add cycle blocks and set a start date in the Plan tab — every planned dose lands here, ready to tap and log."
                        size="sm"
                    />
                </div>
            ) : view === "week" ? (
                <WeekGrid weekStart={weekStart} index={index} today={today} onToggle={onToggle} showNames={showNames} />
            ) : (
                <MonthGrid cursor={cursor} index={index} today={today} onToggle={onToggle} />
            )}
        </div>
    );
}

function DoseChip({ track, occ, taken, status, onToggle, showNames }: Item & { onToggle: (id: string, occ: Occurrence) => void; showNames: boolean }) {
    const label = `${track.name} — ${fmt(occ.dose)} ${occ.unit} (${fmtUnits(occ.units)}u)${occ.note ? ` · ${occ.note}` : ""}`;
    const title =
        status === "taken"
            ? `${label} · taken (click to undo)`
            : status === "missed"
              ? `${label} · missed (click to log retroactively)`
              : status === "today"
                ? `${label} · due today`
                : label;

    return (
        <button
            onClick={() => onToggle(track.peptideId, occ)}
            title={title}
            className={cx(
                "group/dose flex cursor-pointer flex-col gap-0.5 rounded-md px-1.5 py-1 text-left text-xs ring-1 transition duration-100 ease-linear",
                "hover:ring-2 hover:brightness-105 active:scale-[0.98]",
                status === "taken" && "bg-success-primary/10",
                status === "missed" && "bg-error-primary/10",
                status === "today" && !taken && "bg-brand-primary/10 ring-2",
                status === "upcoming" && "hover:bg-secondary",
            )}
            style={
                {
                    borderColor: status === "missed" ? "var(--color-border-error)" : track.color,
                    "--tw-ring-color": status === "missed" ? "var(--color-fg-error-primary)" : track.color + (taken ? "AA" : "66"),
                } as React.CSSProperties
            }
        >
            <span className="flex items-center gap-1.5">
                <span
                    className={cx(
                        "flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border transition duration-100 ease-linear",
                        status === "missed" && "border-error bg-error-primary/20",
                    )}
                    style={
                        status === "missed"
                            ? undefined
                            : { borderColor: track.color, backgroundColor: taken ? track.color : "transparent" }
                    }
                >
                    {status === "missed" ? (
                        <X className="size-2.5 text-fg-error-primary" strokeWidth={3} aria-hidden="true" />
                    ) : (
                        <Check
                            className={cx("size-2.5 text-white transition-transform duration-150 ease-out", taken ? "scale-100" : "scale-0")}
                            strokeWidth={3}
                            aria-hidden="true"
                        />
                    )}
                </span>
                <span
                    className={cx(
                        "font-mono tabular-nums",
                        status === "taken" && "font-medium text-success-primary",
                        status === "missed" && "text-error-primary line-through decoration-error-primary/60",
                        status === "today" && !taken && "font-medium text-brand-secondary",
                        status === "upcoming" && "text-secondary",
                    )}
                >
                    {fmtUnits(occ.units)}u · {fmt(occ.dose)} {occ.unit}
                </span>
            </span>
            {showNames && <span className="truncate text-tertiary">{track.name}</span>}
            {occ.note && <span className="truncate text-tertiary italic">{occ.note}</span>}
        </button>
    );
}

function WeekGrid({
    weekStart,
    index,
    today,
    onToggle,
    showNames,
}: {
    weekStart: string;
    index: Map<string, Item[]>;
    today: string;
    onToggle: (peptideId: string, occ: Occurrence) => void;
    showNames: boolean;
}) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return (
        <div className="grid grid-cols-7 gap-1.5">
            {days.map((date, dayIdx) => {
                const items = index.get(date) ?? [];
                const isToday = date === today;
                return (
                    <div
                        key={date}
                        className={cx(
                            "flex min-h-32 flex-col gap-1 rounded-lg bg-primary p-1.5 ring-1 ring-secondary",
                            isToday && "bg-brand-primary/5 ring-2 ring-brand",
                        )}
                    >
                        <div className="mb-1 flex items-baseline justify-between px-0.5">
                            <span className="text-[10px] tracking-wide text-tertiary uppercase">{WEEKDAY_LABELS[dayIdx]}</span>
                            <span className={cx("font-mono text-sm tabular-nums", isToday ? "font-semibold text-brand-secondary" : "text-secondary")}>{dayOfMonth(date)}</span>
                        </div>
                        {items.length === 0 ? (
                            <span className="px-0.5 text-[10px] text-quaternary">—</span>
                        ) : (
                            items.map((item, i) => <DoseChip key={item.track.peptideId + i} {...item} onToggle={onToggle} showNames={showNames} />)
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function MonthGrid({
    cursor,
    index,
    today,
    onToggle,
}: {
    cursor: string;
    index: Map<string, Item[]>;
    today: string;
    onToggle: (peptideId: string, occ: Occurrence) => void;
}) {
    const gridStart = startOfWeek(startOfMonth(cursor));
    const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    return (
        <div>
            <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] tracking-wide text-tertiary uppercase">
                {WEEKDAY_LABELS.map((d) => (
                    <span key={d}>{d}</span>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
                {cells.map((date) => {
                    const items = index.get(date) ?? [];
                    const inMonth = isSameMonth(date, cursor);
                    const isToday = date === today;
                    return (
                        <div
                            key={date}
                            className={cx(
                                "flex min-h-20 flex-col gap-0.5 rounded-md bg-primary p-1 ring-1 ring-secondary",
                                !inMonth && "opacity-40",
                                isToday && "ring-2 ring-brand",
                            )}
                        >
                            <span className={cx("font-mono text-[11px] tabular-nums", isToday ? "font-semibold text-brand-secondary" : "text-secondary")}>{dayOfMonth(date)}</span>
                            <div className="flex flex-wrap gap-0.5">
                                {items.map(({ track, occ, taken, status }, i) => (
                                    <button
                                        key={track.peptideId + i}
                                        onClick={() => onToggle(track.peptideId, occ)}
                                        title={`${track.name} — ${fmt(occ.dose)} ${occ.unit}${status === "missed" ? " · missed" : taken ? " · taken" : ""}`}
                                        className={cx(
                                            "flex cursor-pointer items-center gap-0.5 rounded-[4px] border px-1 text-[10px] leading-4 transition-transform duration-100 hover:scale-105 active:scale-95",
                                            status === "missed" && "line-through decoration-error-primary/60",
                                        )}
                                        style={{
                                            borderColor: status === "missed" ? "var(--color-border-error)" : track.color,
                                            backgroundColor: taken ? track.color : status === "missed" ? "var(--color-bg-error-primary)" : track.color + "22",
                                            color: taken ? "#fff" : status === "missed" ? "var(--color-text-error-primary)" : undefined,
                                        }}
                                    >
                                        {taken ? (
                                            <Check className="size-2" strokeWidth={3} aria-hidden="true" />
                                        ) : status === "missed" ? (
                                            <X className="size-2" strokeWidth={3} aria-hidden="true" />
                                        ) : null}
                                        <span className="font-mono tabular-nums">{fmtUnits(occ.units)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
