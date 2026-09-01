"use client";

import { useState, useTransition } from "react";
import { Beaker02, Check, CheckCircle, ChevronRight, FlipBackward, SkipForward } from "@untitledui/icons";
import { toast } from "sonner";
import type { Peptide } from "@/lib/peptides/types";
import type { Occurrence } from "@/lib/peptides/schedule";
import { dryVialsRemaining, isOccurrenceTaken, nextSite } from "@/lib/peptides/admin";
import { addLog, removeLog } from "@/lib/actions/peptides";
import { logDose as logTherapeuticDose, skipDose as skipTherapeuticDose, resetDose as resetTherapeuticDose } from "@/lib/actions/therapeutics";
import { Button } from "@/components/base/buttons/button";
import { Card } from "@/components/life/life-ui";
import { formatTime } from "@/lib/dates";
import { cx } from "@/utils/cx";

export interface PeptideDoseItem {
    peptide: Peptide;
    color: string;
    /** Today's occurrence for this peptide. */
    occ: Occurrence;
    taken: boolean;
}

export interface TherapeuticDoseItem {
    id: string;
    name: string;
    kind: string;
    dosage: string | null;
    /** ISO time. */
    scheduledAt: string;
    status: "pending" | "logged" | "skipped";
}

interface DosesCardProps {
    peptideDoses: PeptideDoseItem[];
    therapeuticDoses: TherapeuticDoseItem[];
}

function timeLabel(iso: string): string {
    return formatTime(iso);
}

export function DosesCard({ peptideDoses, therapeuticDoses }: DosesCardProps) {
    const [isPending, startTransition] = useTransition();
    // Track which row is mid-flight so only that button shows a spinner.
    const [busyId, setBusyId] = useState<string | null>(null);

    const totalDue = peptideDoses.length + therapeuticDoses.length;
    const takenCount =
        peptideDoses.filter((d) => d.taken).length +
        therapeuticDoses.filter((d) => d.status !== "pending").length;
    const allDone = totalDue > 0 && takenCount === totalDue;

    function togglePeptide(item: PeptideDoseItem) {
        const { peptide: p, occ, taken } = item;
        setBusyId(p.id);
        startTransition(async () => {
            try {
                if (taken) {
                    // Un-mark: drop the fulfilling log, restore its volume.
                    const existing = p.logs.find(
                        (l) => l.date === occ.date && (l.blockId === occ.blockId || (!l.blockId && l.dose === occ.dose)),
                    );
                    if (existing) {
                        const restored = Math.min(p.waterMl, p.activeVialRemainingMl + existing.mlUsed);
                        await removeLog(p.id, existing.id, restored);
                    }
                    toast.success("Dose un-logged.");
                } else {
                    // Mark taken: mirror toggleOccurrence supply math, open a fresh vial on demand.
                    let remaining = p.activeVialRemainingMl;
                    let opened = p.vialsOpened;
                    let openedChanged = false;
                    if (remaining < occ.mlPerAdmin && dryVialsRemaining(p) > 0) {
                        opened += 1;
                        remaining = p.waterMl;
                        openedChanged = true;
                    }
                    await addLog(
                        p.id,
                        {
                            date: occ.date,
                            dose: occ.dose,
                            units: Number(occ.units.toFixed(2)),
                            mlUsed: Number(occ.mlPerAdmin.toFixed(4)),
                            site: nextSite(p.logs),
                            blockId: occ.blockId,
                        },
                        {
                            activeVialRemainingMl: Math.max(0, remaining - occ.mlPerAdmin),
                            ...(openedChanged && { vialsOpened: opened }),
                        },
                    );
                    toast.success("Dose logged.");
                }
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't update dose.");
            } finally {
                setBusyId(null);
            }
        });
    }

    function runTherapeutic(id: string, action: (id: string) => Promise<void>, ok: string) {
        setBusyId(id);
        startTransition(async () => {
            try {
                await action(id);
                toast.success(ok);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't update dose.");
            } finally {
                setBusyId(null);
            }
        });
    }

    return (
        <Card className="flex h-full flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Beaker02 className="size-5 text-brand-secondary" aria-hidden="true" />
                    <h2 className="text-md font-semibold text-primary">Today's doses</h2>
                </div>
                {totalDue > 0 && (
                    <span className={cx("text-sm font-medium", allDone ? "text-success-primary" : "text-tertiary")}>
                        {takenCount}/{totalDue}
                    </span>
                )}
            </div>

            {totalDue === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
                    <Beaker02 className="size-8 text-fg-quaternary" aria-hidden="true" />
                    <p className="text-sm text-tertiary">Nothing scheduled today.</p>
                </div>
            ) : allDone ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg bg-success-primary/40 py-8 text-center">
                    <CheckCircle className="size-8 text-success-primary" aria-hidden="true" />
                    <p className="text-sm font-medium text-success-primary">All doses done for today.</p>
                </div>
            ) : (
                <ul className="flex flex-col gap-2">
                    {peptideDoses.map((item) => {
                        const busy = isPending && busyId === item.peptide.id;
                        return (
                            <li
                                key={`pep-${item.peptide.id}`}
                                className={cx(
                                    "flex items-center gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset transition duration-100 ease-linear",
                                    item.taken && "bg-success-primary/30",
                                )}
                            >
                                <span
                                    className="size-2.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: item.color }}
                                    aria-hidden="true"
                                />
                                <div className="min-w-0 flex-1">
                                    <p className={cx("truncate text-sm font-medium", item.taken ? "text-tertiary line-through" : "text-primary")}>
                                        {item.peptide.name || "Untitled"}
                                    </p>
                                    <p className="text-xs text-tertiary">
                                        {item.occ.units.toFixed(1)} units · {item.occ.dose} {item.occ.unit}
                                        {item.occ.note ? ` · ${item.occ.note}` : ""}
                                    </p>
                                </div>
                                {item.taken ? (
                                    <Button
                                        size="sm"
                                        color="tertiary"
                                        iconLeading={FlipBackward}
                                        aria-label={`Undo dose for ${item.peptide.name}`}
                                        isLoading={busy}
                                        isDisabled={isPending}
                                        onClick={() => togglePeptide(item)}
                                    >
                                        Undo
                                    </Button>
                                ) : (
                                    <Button
                                        size="sm"
                                        color="primary"
                                        iconLeading={Check}
                                        isLoading={busy}
                                        isDisabled={isPending}
                                        onClick={() => togglePeptide(item)}
                                    >
                                        Log
                                    </Button>
                                )}
                            </li>
                        );
                    })}

                    {therapeuticDoses.map((item) => {
                        const busy = isPending && busyId === item.id;
                        const done = item.status !== "pending";
                        return (
                            <li
                                key={`tx-${item.id}`}
                                className={cx(
                                    "flex items-center gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset transition duration-100 ease-linear",
                                    item.status === "logged" && "bg-success-primary/30",
                                    item.status === "skipped" && "bg-warning-primary/30",
                                )}
                            >
                                <span className="size-2.5 shrink-0 rounded-full bg-fg-quaternary" aria-hidden="true" />
                                <div className="min-w-0 flex-1">
                                    <p className={cx("truncate text-sm font-medium", done ? "text-tertiary line-through" : "text-primary")}>
                                        {item.name}
                                    </p>
                                    <p className="text-xs text-tertiary">
                                        {item.dosage ? `${item.dosage} · ` : ""}
                                        {timeLabel(item.scheduledAt)}
                                        {item.status === "skipped" ? " · skipped" : ""}
                                    </p>
                                </div>
                                {done ? (
                                    <Button
                                        size="sm"
                                        color="tertiary"
                                        iconLeading={FlipBackward}
                                        aria-label={`Reset dose for ${item.name}`}
                                        isLoading={busy}
                                        isDisabled={isPending}
                                        onClick={() => runTherapeutic(item.id, resetTherapeuticDose, "Dose reset.")}
                                    >
                                        Undo
                                    </Button>
                                ) : (
                                    <div className="flex shrink-0 items-center gap-1">
                                        <Button
                                            size="sm"
                                            color="tertiary"
                                            iconLeading={SkipForward}
                                            aria-label={`Skip dose for ${item.name}`}
                                            isDisabled={isPending}
                                            onClick={() => runTherapeutic(item.id, skipTherapeuticDose, "Dose skipped.")}
                                        />
                                        <Button
                                            size="sm"
                                            color="primary"
                                            iconLeading={Check}
                                            isLoading={busy}
                                            isDisabled={isPending}
                                            onClick={() => runTherapeutic(item.id, logTherapeuticDose, "Dose logged.")}
                                        >
                                            Take
                                        </Button>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <Button
                href="/health/peptides"
                color="link-color"
                size="sm"
                iconTrailing={ChevronRight}
                className="mt-auto self-start"
            >
                Open peptides
            </Button>
        </Card>
    );
}
