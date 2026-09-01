// @ts-nocheck
import { AlertTriangle, ArrowRight, Calendar, Check, Zap } from "@untitledui/icons";
import type { Peptide } from "@/lib/peptides/types";
import type { Occurrence } from "@/lib/peptides/schedule";
import { type UnitSystem, volumeToDisplay, volumeUnit } from "@/lib/units";
import { fmt, fmtUnits } from "@/lib/peptides/format";
import { parseISO, todayISO } from "@/lib/peptides/date";
import { formatDateShort } from "@/lib/dates";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { SupplyRing } from "./supply-ring";
import type { PeptideSnapshot } from "./supply";
import { CycleStrip } from "./cycle-timeline";
import { cycleDoseTotals, cycleEndDate, dosesLeft } from "./cycle";

function fmtShort(iso: string): string {
    if (!iso) return "—";
    return formatDateShort(parseISO(iso));
}

interface Props {
    peptide: Peptide;
    color: string;
    snap: PeptideSnapshot;
    onLogToday: (occ: Occurrence) => void;
    unitSystem: UnitSystem;
}

function relDay(iso: string): string {
    const today = todayISO();
    if (iso === today) return "Today";
    const diff = Math.round((parseISO(iso).getTime() - parseISO(today).getTime()) / 86_400_000);
    if (diff === 1) return "Tomorrow";
    if (diff > 1 && diff < 7) return parseISO(iso).toLocaleDateString(undefined, { weekday: "long" });
    return formatDateShort(parseISO(iso));
}

export function PeptideHeroCard({ peptide: p, color, snap, onLogToday, unitSystem }: Props) {
    const today = snap.todayOccurrence;
    const next = snap.nextOccurrence;
    const ringValue = snap.upcomingMl > 0 ? Math.min(1, snap.supplyPct) : 1;
    const endDate = cycleEndDate(p);
    const left = dosesLeft(p, snap);
    const totals = cycleDoseTotals(p);

    return (
        <div className="group flex flex-col gap-4 rounded-xl bg-primary p-5 shadow-xs ring-1 ring-secondary transition duration-100 ease-linear hover:shadow-md">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <a href={`/health/peptides/${p.id}`} className="flex min-w-0 items-center gap-2.5">
                    <span className="size-3 shrink-0 rounded-full ring-2 ring-bg-primary" style={{ backgroundColor: color }} />
                    <span className="truncate text-lg font-semibold text-primary transition group-hover:text-brand-secondary">{p.name || "Untitled"}</span>
                </a>
                {snap.currentWeek != null ? (
                    <Badge color="gray" size="sm" type="modern">
                        Week {snap.currentWeek}
                        {snap.totalWeeks ? ` / ${snap.totalWeeks}` : ""}
                    </Badge>
                ) : (
                    <Badge color="gray" size="sm" type="modern">
                        Not Scheduled
                    </Badge>
                )}
            </div>

            {/* Today's dose / next dose */}
            <div className="flex items-center gap-4">
                <SupplyRing
                    value={ringValue}
                    color={color}
                    over={snap.supplyShort || snap.overBudget}
                    label={snap.upcomingMl > 0 ? `${snap.dosesCovered}` : "∞"}
                    sublabel="doses"
                />
                <div className="min-w-0 flex-1">
                    {today ? (
                        <>
                            <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-brand-secondary uppercase">
                                <Zap className="size-3.5" aria-hidden="true" /> Today
                            </p>
                            <p className="mt-0.5 font-mono text-2xl leading-none font-semibold text-primary tabular-nums">
                                {fmtUnits(today.units)}
                                <span className="ml-1 text-base font-normal text-tertiary">units</span>
                            </p>
                            <p className="mt-1 text-sm text-tertiary">
                                {fmt(today.dose)} {today.unit}
                                {today.note ? ` · ${today.note}` : ""}
                            </p>
                        </>
                    ) : next ? (
                        <>
                            <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-tertiary uppercase">
                                <Calendar className="size-3.5" aria-hidden="true" /> Next dose
                            </p>
                            <p className="mt-0.5 text-lg font-semibold text-primary">{relDay(next.date)}</p>
                            <p className="mt-1 text-sm text-tertiary">
                                {fmtUnits(next.units)}u · {fmt(next.dose)} {next.unit}
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="text-xs font-medium tracking-wide text-tertiary uppercase">Schedule</p>
                            <p className="mt-0.5 text-sm text-tertiary">No upcoming doses. Plan a cycle to get started.</p>
                        </>
                    )}
                </div>
            </div>

            {/* Cycle week-strip */}
            {p.cycleStartDate && snap.totalWeeks > 0 && (
                <div className="flex flex-col gap-1.5">
                    <CycleStrip peptide={p} color={color} />
                    <div className="flex items-center justify-between text-[11px] text-tertiary">
                        <span className="font-mono tabular-nums">{fmtShort(p.cycleStartDate)}</span>
                        <span className="font-mono tabular-nums">{fmtShort(endDate)}</span>
                    </div>
                </div>
            )}

            {/* Doses left + supply status */}
            <div className="flex flex-col gap-1.5 border-t border-secondary pt-3">
                {snap.totalWeeks > 0 && (
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-tertiary">Cycle progress</span>
                        <span className="font-mono text-secondary tabular-nums">
                            {totals.taken}
                            <span className="text-tertiary"> / {totals.total} taken</span>
                            {totals.missed > 0 && <span className="text-error-primary"> · {totals.missed} missed</span>}
                        </span>
                    </div>
                )}
                <div className="flex items-center justify-between text-xs">
                    <span className="text-tertiary">Doses left in cycle</span>
                    <span className="font-mono text-secondary tabular-nums">
                        {totals.left}
                        <span className="text-tertiary"> · {left.coverable} covered</span>
                    </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                    <span className="text-tertiary">Supply remaining</span>
                    <span className={cx("font-mono tabular-nums", snap.supplyShort ? "text-error-primary" : "text-secondary")}>
                        {volumeToDisplay(snap.remainingMl, unitSystem)} {volumeUnit(unitSystem)}
                    </span>
                </div>
                {(snap.supplyShort || snap.overBudget) && (
                    <p className="flex items-center gap-1 text-xs font-medium text-error-primary">
                        <AlertTriangle className="size-3.5" aria-hidden="true" />
                        {snap.overBudget ? "Cycle exceeds owned vials" : "Supply runs out before cycle ends"}
                    </p>
                )}
            </div>

            {/* Actions */}
            <div className="mt-auto flex items-center gap-2">
                {today ? (
                    <Button size="sm" iconLeading={Check} onClick={() => onLogToday(today)} className="flex-1">
                        Log today&apos;s dose
                    </Button>
                ) : (
                    <Button size="sm" color="secondary" href={`/health/peptides/${p.id}`} iconTrailing={ArrowRight} className="flex-1">
                        Open
                    </Button>
                )}
                {today && (
                    <Button size="sm" color="secondary" href={`/health/peptides/${p.id}`} iconLeading={ArrowRight} aria-label="Open peptide" />
                )}
            </div>
        </div>
    );
}
