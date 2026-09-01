"use client";

import { useState } from "react";
import { Dropper, Trash01 } from "@untitledui/icons";
import type { LogEntry, Peptide } from "@/lib/peptides/types";
import { type UnitSystem, volumeToDisplay, volumeUnit } from "@/lib/units";
import { computeDose } from "@/lib/peptides/dosing";
import { dryVialsRemaining, nextSite, SITES } from "@/lib/peptides/admin";
import { fmt, fmtUnits } from "@/lib/peptides/format";
import { parseISO, todayISO } from "@/lib/peptides/date";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { ProgressBarBase } from "@/components/base/progress-indicators/progress-indicators";
import { ControlledDateInput } from "@/components/base/input/form-date-input";
import { formatDate } from "@/lib/dates";
import { cx } from "@/utils/cx";
import { Card, CardBody, CardHeader, CardTitle } from "./card";
import { EmptyState } from "./empty-state";
import { Field, NumberInput } from "./field-controls";
import { ConfirmModal } from "./confirm-modal";

interface Props {
    peptide: Peptide;
    onAddLog: (entry: Omit<LogEntry, "id">, supply: { activeVialRemainingMl: number; vialsOpened?: number }) => void;
    onRemoveLog: (logId: string, restoredRemainingMl: number) => void;
    onOpenNewVial: (vialsOpened: number, activeVialRemainingMl: number) => void;
    unitSystem: UnitSystem;
}

// Short labels for the body-map-ish site picker, mapped to the canonical SITES.
const SITE_LABELS: Record<string, string> = {
    "L abdomen": "L Abd",
    "R abdomen": "R Abd",
    "L thigh": "L Thigh",
    "R thigh": "R Thigh",
    "L delt": "L Delt",
    "R delt": "R Delt",
    "L glute": "L Glute",
    "R glute": "R Glute",
};

function dateHeading(iso: string): string {
    const today = todayISO();
    if (iso === today) return "Today";
    if (iso === addDaysStr(today, -1)) return "Yesterday";
    return formatDate(parseISO(iso));
}

function addDaysStr(iso: string, days: number): string {
    const d = parseISO(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export function LogView({ peptide, onAddLog, onRemoveLog, onOpenNewVial, unitSystem }: Props) {
    const volUnit = volumeUnit(unitSystem);
    const [dose, setDose] = useState<number>(peptide.doseUnit === "mcg" ? 30 : 2);
    const [site, setSite] = useState<string>(nextSite(peptide.logs));
    const [date, setDate] = useState<string>(() => todayISO());
    const [confirmVial, setConfirmVial] = useState(false);
    const [removingLog, setRemovingLog] = useState<string | null>(null);

    const r = computeDose({
        vialMg: peptide.vialMg,
        waterMl: peptide.waterMl,
        syringeUnitsPerMl: peptide.syringeUnitsPerMl,
        dose,
        unit: peptide.doseUnit,
    });
    const remaining = peptide.activeVialRemainingMl;
    const remainingPct = peptide.waterMl > 0 ? Math.max(0, Math.min(100, (remaining / peptide.waterMl) * 100)) : 0;
    const dry = dryVialsRemaining(peptide);
    const noActiveVial = remaining <= 0;
    const suggested = nextSite(peptide.logs);

    const openNewVial = () => {
        if (dry <= 0) return;
        onOpenNewVial(peptide.vialsOpened + 1, peptide.waterMl);
    };

    const logDose = () => {
        if (r.mlPerDose <= 0 || noActiveVial) return;
        const entry: Omit<LogEntry, "id"> = {
            date,
            dose,
            units: Number(r.unitsPerDose.toFixed(2)),
            mlUsed: Number(r.mlPerDose.toFixed(4)),
            site,
        };
        onAddLog(entry, { activeVialRemainingMl: Math.max(0, remaining - r.mlPerDose) });
        setSite(nextSite([...peptide.logs, { ...entry, id: "tmp" }]));
    };

    const removeLog = (id: string) => {
        const entry = peptide.logs.find((l) => l.id === id);
        const restored = entry ? Math.min(peptide.waterMl, remaining + entry.mlUsed) : remaining;
        onRemoveLog(id, restored);
    };

    // Group logs by date, newest first.
    const grouped = new Map<string, LogEntry[]>();
    for (const l of [...peptide.logs].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))) {
        const list = grouped.get(l.date);
        if (list) list.push(l);
        else grouped.set(l.date, [l]);
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Vial status */}
            <Card>
                <CardHeader>
                    <CardTitle>Active vial</CardTitle>
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-tertiary tabular-nums">
                            {fmt(dry)} / {fmt(peptide.vialsOwned)} vials left
                        </span>
                        <Button size="sm" color="secondary" onClick={() => setConfirmVial(true)} isDisabled={dry <= 0}>
                            Open new vial
                        </Button>
                    </div>
                </CardHeader>
                <CardBody className="space-y-2">
                    <ProgressBarBase value={remainingPct} className="h-3" progressClassName={remainingPct < 15 ? "bg-fg-error-primary" : undefined} />
                    <div className="flex items-baseline justify-between font-mono text-xs tabular-nums">
                        <span className={cx(remainingPct < 15 ? "text-error-primary" : "text-tertiary")}>
                            {volumeToDisplay(remaining, unitSystem)} / {volumeToDisplay(peptide.waterMl, unitSystem)} {volUnit} left
                        </span>
                        <span className="text-quaternary">{Math.round(remainingPct)}%</span>
                    </div>
                    {noActiveVial && (
                        <p className="text-xs text-tertiary">
                            {dry > 0 ? "No active vial — open one to start logging." : "No vials left — add to inventory in the Plan tab."}
                        </p>
                    )}
                </CardBody>
            </Card>

            {/* Log form */}
            <Card>
                <CardHeader>
                    <CardTitle>Log a dose</CardTitle>
                </CardHeader>
                <CardBody className="space-y-4">
                    <div className="flex flex-wrap items-end gap-3">
                        <Field label="Date" className="w-40">
                            <ControlledDateInput size="sm" value={date || null} onChange={setDate} />
                        </Field>
                        <Field label={`Dose (${peptide.doseUnit})`} className="w-28">
                            <NumberInput value={dose} min={0} step={peptide.doseUnit === "mcg" ? 5 : 0.5} onChange={setDose} aria-label="Log dose" />
                        </Field>
                    </div>

                    <div>
                        <p className="mb-1.5 text-xs font-medium text-secondary">
                            Injection site <span className="font-normal text-tertiary">· suggested: {SITE_LABELS[suggested] ?? suggested}</span>
                        </p>
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                            {SITES.map((s) => {
                                const selected = site === s;
                                const isSuggested = s === suggested;
                                return (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => setSite(s)}
                                        className={cx(
                                            "relative cursor-pointer rounded-lg px-2 py-2 text-xs font-medium ring-1 transition duration-100 ease-linear",
                                            selected
                                                ? "bg-brand-solid text-white ring-transparent"
                                                : "bg-primary text-secondary ring-primary hover:bg-primary_hover",
                                            !selected && isSuggested && "ring-2 ring-brand",
                                        )}
                                    >
                                        {SITE_LABELS[s] ?? s}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <Button iconLeading={Dropper} onClick={logDose} isDisabled={r.mlPerDose <= 0 || noActiveVial}>
                        Log dose ({r.mlPerDose > 0 ? fmtUnits(r.unitsPerDose) : "—"}u)
                    </Button>
                </CardBody>
            </Card>

            {/* Timeline */}
            <Card>
                <CardHeader>
                    <CardTitle>History</CardTitle>
                    <span className="font-mono text-xs text-tertiary tabular-nums">{peptide.logs.length} logged</span>
                </CardHeader>
                <CardBody>
                    {peptide.logs.length === 0 ? (
                        <EmptyState
                            icon={Dropper}
                            title="No doses logged yet"
                            description="Log a dose above to start building your injection history — sites rotate automatically and supply updates in real time."
                            size="sm"
                        />
                    ) : (
                        <div className="flex flex-col gap-5">
                            {[...grouped.entries()].map(([day, entries]) => (
                                <div key={day}>
                                    <p className="mb-2 text-xs font-semibold tracking-wide text-tertiary uppercase">{dateHeading(day)}</p>
                                    <div className="flex flex-col gap-2 border-l-2 border-secondary pl-3">
                                        {entries.map((l) => (
                                            <div
                                                key={l.id}
                                                className="group grid grid-cols-[5.5rem_3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-secondary/40 px-3 py-2 ring-1 ring-secondary"
                                            >
                                                <Badge color="gray" size="sm" type="modern" className="justify-self-start">
                                                    {SITE_LABELS[l.site] ?? l.site ?? "—"}
                                                </Badge>
                                                <span className="text-right font-mono text-sm font-medium text-primary tabular-nums">{fmtUnits(l.units)}u</span>
                                                <span className="truncate font-mono text-xs text-tertiary tabular-nums">
                                                    {fmt(l.dose)} {peptide.doseUnit} · {volumeToDisplay(l.mlUsed, unitSystem)} {volUnit}
                                                </span>
                                                <div className="opacity-100 transition duration-100 ease-linear focus-within:opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                                                    <ButtonUtility size="xs" color="tertiary" icon={Trash01} tooltip="Delete entry" onClick={() => setRemovingLog(l.id)} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardBody>
            </Card>

            <ConfirmModal
                isOpen={confirmVial}
                onOpenChange={setConfirmVial}
                title="Open a new vial?"
                description={`This reconstitutes a fresh vial with ${volumeToDisplay(peptide.waterMl, unitSystem)} ${volUnit} and marks the previous one finished.`}
                confirmLabel="Open new vial"
                onConfirm={() => {
                    openNewVial();
                    setConfirmVial(false);
                }}
            />

            <ConfirmModal
                isOpen={removingLog !== null}
                onOpenChange={(open) => !open && setRemovingLog(null)}
                title="Delete log entry?"
                description="The drawn volume will be restored to the active vial."
                confirmLabel="Delete entry"
                destructive
                onConfirm={() => {
                    if (removingLog) removeLog(removingLog);
                    setRemovingLog(null);
                }}
            />
        </div>
    );
}
