"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, CalendarCheck01, Moon01 } from "@untitledui/icons";
import type { Peptide } from "@/lib/peptides/types";
import { fmt, fmtUnits } from "@/lib/peptides/format";
import { parseISO } from "@/lib/peptides/date";
import { formatDate } from "@/lib/dates";
import { formatDateShort } from "@/lib/dates";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Tooltip } from "@/components/base/tooltip/tooltip";
import { cx } from "@/utils/cx";
import { Card } from "./card";
import { PeptideModal } from "./peptide-modal";
import { cycleDoseTotals, cycleEndDate, currentWeek, maxEndWeek, unitsForBlock, weekCells, weekEndISO, weekStartISO, type WeekCell } from "./cycle";

function fmtDate(iso: string): string {
    if (!iso) return "—";
    return formatDate(parseISO(iso));
}

/** "Jun 9 – Jun 15" date range for a given (1-based) cycle week. */
function weekRangeLabel(p: Peptide, week: number): string {
    const start = weekStartISO(p, week);
    const end = weekEndISO(p, week);
    if (!start || !end) return "";
    return `${formatDateShort(parseISO(start))} – ${formatDateShort(parseISO(end))}`;
}

/**
 * Block-derived hue: keep the peptide color but vary opacity by plan-order so
 * adjacent blocks read as distinct bands. Off weeks fall back to neutral.
 */
function bandStyle(color: string, cell: WeekCell): React.CSSProperties {
    if (cell.off) return {};
    const alpha = [0.16, 0.26, 0.2, 0.3, 0.22][cell.blockIndex % 5];
    const bg = Math.round(alpha * 255)
        .toString(16)
        .padStart(2, "0");
    return { backgroundColor: color + bg, borderColor: color };
}

interface TimelineProps {
    peptide: Peptide;
    color: string;
    /** Called when a week is activated and its block should be focused in the plan editor. */
    onSelectBlock?: (blockId: string) => void;
}

/** Full horizontal week-by-week visualization of the cycle, with a per-week detail popover. */
export function CycleTimeline({ peptide: p, color, onSelectBlock }: TimelineProps) {
    const cells = weekCells(p);
    const cur = currentWeek(p);
    const total = maxEndWeek(p);
    const scrollRef = useRef<HTMLDivElement>(null);
    const currentRef = useRef<HTMLButtonElement>(null);
    const [detail, setDetail] = useState<WeekCell | null>(null);

    // Auto-center the current week on mount / when it changes.
    useEffect(() => {
        const el = currentRef.current;
        if (el) el.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
    }, [cur, total]);

    if (!p.cycleStartDate) {
        return (
            <Card className="p-5">
                <div className="flex flex-col items-start gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-tertiary uppercase">
                        <Calendar className="size-3.5" aria-hidden="true" /> Cycle timeline
                    </span>
                    <p className="text-sm text-tertiary">Set a start date to see the timeline week by week.</p>
                    <Button size="sm" color="secondary" iconLeading={Calendar} href="#cycle-start-date">
                        Set start date
                    </Button>
                </div>
            </Card>
        );
    }

    if (total <= 0) {
        return (
            <Card className="p-5">
                <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-tertiary uppercase">
                    <Calendar className="size-3.5" aria-hidden="true" /> Cycle timeline
                </span>
                <p className="mt-2 text-sm text-tertiary">Add a dosing block to plan the cycle.</p>
            </Card>
        );
    }

    const endDate = cycleEndDate(p);
    const inCycle = cur != null && cur >= 1 && cur <= total;
    const totals = cycleDoseTotals(p);

    const handleActivate = (cell: WeekCell) => {
        if (cell.block && onSelectBlock) onSelectBlock(cell.block.id);
        setDetail(cell);
    };

    return (
        <Card className="p-5">
            {/* Header: key dates + position */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-tertiary uppercase">
                        <Calendar className="size-3.5" aria-hidden="true" /> Cycle timeline
                    </span>
                    {inCycle ? (
                        <Badge color="brand" size="sm" type="pill-color">
                            Week {cur} of {total}
                        </Badge>
                    ) : cur != null && cur > total ? (
                        <Badge color="gray" size="sm" type="modern">
                            Cycle Complete
                        </Badge>
                    ) : (
                        <Badge color="gray" size="sm" type="modern">
                            Starts Soon
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-4 text-xs text-tertiary">
                    <span className="flex items-center gap-1.5">
                        <Calendar className="size-3.5" aria-hidden="true" />
                        <span className="font-mono text-secondary tabular-nums">{fmtDate(p.cycleStartDate)}</span>
                    </span>
                    <span aria-hidden="true">→</span>
                    <span className="flex items-center gap-1.5">
                        <CalendarCheck01 className="size-3.5" aria-hidden="true" />
                        <span className="font-mono text-secondary tabular-nums">{fmtDate(endDate)}</span>
                    </span>
                </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge color="success" size="sm" type="pill-color">
                    {totals.taken} taken
                </Badge>
                {totals.missed > 0 && (
                    <Badge color="error" size="sm" type="pill-color">
                        {totals.missed} missed
                    </Badge>
                )}
                <Badge color="gray" size="sm" type="pill-color">
                    {totals.left} remaining
                </Badge>
                <span className="text-xs text-tertiary">
                    {totals.total} doses in cycle
                </span>
            </div>

            {/* Week strip */}
            <div ref={scrollRef} className="flex gap-1.5 overflow-x-auto pb-2">
                {cells.map((cell) => {
                    const taken = cell.takenDoses;
                    const planned = cell.plannedDoses;
                    const fullyTaken = planned > 0 && taken >= planned;
                    const range = weekRangeLabel(p, cell.week);
                    const doseInfo = cell.off
                        ? "Off week"
                        : `${fmt(cell.dose)} ${p.doseUnit} × ${fmt(planned, 1)}/wk${cell.isPast ? ` · ${taken}/${planned} taken` : ""}`;
                    return (
                        <Tooltip key={cell.week} title={`Week ${cell.week} · ${range}`} description={doseInfo} placement="top">
                            <button
                                ref={cell.isCurrent ? currentRef : undefined}
                                type="button"
                                onClick={() => handleActivate(cell)}
                                className={cx(
                                    "group/wk relative flex w-16 shrink-0 cursor-pointer flex-col gap-1 rounded-lg border px-1.5 py-2 text-left transition duration-100 ease-linear",
                                    "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                                    cell.off && "border-dashed border-secondary bg-secondary/40",
                                    !cell.off && "border-transparent",
                                    cell.isPast && !cell.off && "opacity-70",
                                    cell.isCurrent && "ring-2 ring-brand ring-offset-1 ring-offset-bg-primary",
                                )}
                                style={cell.off ? undefined : bandStyle(color, cell)}
                            >
                                <span
                                    className={cx(
                                        "flex items-baseline justify-between text-[10px] font-medium tracking-wide uppercase",
                                        cell.isCurrent ? "text-brand-secondary" : "text-tertiary",
                                    )}
                                >
                                    <span>Wk {cell.week}</span>
                                    {cell.isCurrent && <span className="size-1.5 rounded-full bg-fg-brand-primary" aria-hidden="true" />}
                                </span>

                                {cell.off ? (
                                    <span className="flex flex-1 items-center gap-1 text-[11px] text-tertiary">
                                        <Moon01 className="size-3" aria-hidden="true" /> off
                                    </span>
                                ) : (
                                    <>
                                        <span className="font-mono text-sm leading-tight font-semibold text-primary tabular-nums">
                                            {fmt(cell.dose)}
                                            <span className="ml-0.5 text-[9px] font-normal text-tertiary">{p.doseUnit}</span>
                                        </span>
                                        <span className="text-[9px] text-tertiary">×{fmt(planned, 1)}/wk</span>
                                    </>
                                )}

                                {/* Past-week adherence tick */}
                                {cell.isPast && !cell.off && (
                                    <span
                                        className={cx(
                                            "absolute inset-x-1.5 bottom-1 h-0.5 rounded-full",
                                            fullyTaken ? "bg-fg-success-primary" : taken > 0 ? "bg-fg-warning-primary" : "bg-fg-error-primary",
                                        )}
                                        aria-hidden="true"
                                    />
                                )}
                                {cell.isPast && !cell.off && taken < planned && (
                                    <span className="absolute top-1 right-1 text-[8px] font-bold text-error-primary" aria-hidden="true">
                                        !
                                    </span>
                                )}
                            </button>
                        </Tooltip>
                    );
                })}
            </div>

            <WeekDetailModal peptide={p} color={color} cell={detail} onClose={() => setDetail(null)} />
        </Card>
    );
}

function WeekDetailModal({
    peptide: p,
    color,
    cell,
    onClose,
}: {
    peptide: Peptide;
    color: string;
    cell: WeekCell | null;
    onClose: () => void;
}) {
    const open = cell != null;
    const week = cell?.week ?? 0;
    const start = open ? weekStartISO(p, week) : "";
    const end = open ? weekEndISO(p, week) : "";
    return (
        <PeptideModal isOpen={open} onOpenChange={(o) => !o && onClose()} title={`Week ${week}`} className="max-w-sm">
            {cell && (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2 text-sm text-tertiary">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: cell.off ? "var(--color-bg-quaternary)" : color }} />
                        <span className="font-mono tabular-nums">
                            {fmtDate(start)} – {fmtDate(end)}
                        </span>
                        {cell.isCurrent && (
                            <Badge color="brand" size="sm" type="pill-color">
                                Current
                            </Badge>
                        )}
                    </div>

                    {cell.off ? (
                        <p className="text-sm text-tertiary">No block covers this week — it&apos;s an off week.</p>
                    ) : (
                        <dl className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <dt className="text-xs text-tertiary">Dose</dt>
                                <dd className="font-mono font-semibold text-primary tabular-nums">
                                    {fmt(cell.dose)} {p.doseUnit}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-xs text-tertiary">Per dose</dt>
                                <dd className="font-mono font-semibold text-primary tabular-nums">
                                    {cell.block ? `${fmtUnits(unitsForBlock(p, cell.block))}u` : "—"}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-xs text-tertiary">Doses this week</dt>
                                <dd className="font-mono font-semibold text-primary tabular-nums">{fmt(cell.plannedDoses, 1)}</dd>
                            </div>
                            <div>
                                <dt className="text-xs text-tertiary">Taken</dt>
                                <dd className="font-mono font-semibold text-primary tabular-nums">
                                    {cell.takenDoses}/{cell.plannedDoses}
                                </dd>
                            </div>
                            {cell.block?.note && (
                                <div className="col-span-2">
                                    <dt className="text-xs text-tertiary">Note</dt>
                                    <dd className="text-secondary italic">{cell.block.note}</dd>
                                </div>
                            )}
                        </dl>
                    )}

                    <div className="flex justify-end">
                        <Button size="sm" color="secondary" onClick={onClose}>
                            Close
                        </Button>
                    </div>
                </div>
            )}
        </PeptideModal>
    );
}

/** Compact week-strip for overview hero cards. Read-only, current week highlighted. */
export function CycleStrip({ peptide: p, color }: { peptide: Peptide; color: string }) {
    const cells = weekCells(p);
    const cur = currentWeek(p);
    const stripRef = useRef<HTMLDivElement>(null);
    const currentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = currentRef.current;
        if (el) el.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
    }, [cur]);

    if (!p.cycleStartDate || cells.length === 0) return null;

    return (
        <div ref={stripRef} className="flex gap-0.5 overflow-x-auto" aria-label="Cycle weeks">
            {cells.map((cell) => {
                const fullyTaken = cell.plannedDoses > 0 && cell.takenDoses >= cell.plannedDoses;
                return (
                    <div
                        key={cell.week}
                        ref={cell.isCurrent ? currentRef : undefined}
                        title={cell.off ? `Week ${cell.week} — off` : `Week ${cell.week} — ${fmt(cell.dose)} ${p.doseUnit}`}
                        className={cx(
                            "h-5 min-w-3 flex-1 rounded-[3px] transition",
                            cell.isPast && !cell.off && "opacity-60",
                            cell.isCurrent && "ring-2 ring-brand ring-inset",
                        )}
                        style={
                            cell.off
                                ? { backgroundColor: "var(--color-bg-quaternary)" }
                                : { backgroundColor: color + (fullyTaken ? "" : "55"), borderColor: color }
                        }
                    />
                );
            })}
        </div>
    );
}
