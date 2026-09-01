"use client";

import { ArrowLeft } from "@untitledui/icons";
import { useRouter } from "next/navigation";
import type { Peptide } from "@/lib/peptides/types";
import type { Occurrence } from "@/lib/peptides/schedule";
import type { UnitSystem } from "@/lib/units";
import { peptideColor } from "@/lib/peptides/peptide-color";
import { parseISO } from "@/lib/peptides/date";
import { formatDate } from "@/lib/dates";
import { Badge } from "@/components/base/badges/badges";
import { cx } from "@/utils/cx";
import { Button } from "@/components/base/buttons/button";
import { Card, CardBody } from "./card";
import { usePeptides } from "./use-peptides";
import { toggleOccurrence } from "./toggle-helper";
import { PeptidePanel } from "./peptide-panel";
import { snapshot } from "./supply";
import { cycleDoseTotals, cycleEndDate, currentWeek, dosesLeft, maxEndWeek } from "./cycle";

function fmtShort(iso: string): string {
    if (!iso) return "—";
    return formatDate(parseISO(iso));
}

export function PeptideDetailClient({ peptide, colorIndex, unitSystem }: { peptide: Peptide; colorIndex: number; unitSystem: UnitSystem }) {
    const store = usePeptides([peptide]);
    const router = useRouter();
    const current = store.peptides[0];
    const color = peptideColor(colorIndex);

    if (!current) {
        // Deleted — bounce back to overview.
        router.push("/health/peptides");
        return null;
    }

    const handleToggle = (_id: string, occ: Occurrence) => toggleOccurrence(store, current, occ);

    const total = maxEndWeek(current);
    const cur = currentWeek(current);
    const snap = snapshot(current);
    const left = dosesLeft(current, snap);
    // Recomputed every render from the (optimistically updated) store, so logging
    // or un-logging a dose immediately moves "Doses left in cycle".
    const totals = cycleDoseTotals(current);
    const scheduled = Boolean(current.cycleStartDate) && total > 0;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Button size="sm" color="link-gray" iconLeading={ArrowLeft} href="/health/peptides">
                    Back to overview
                </Button>
                <span className="flex items-center gap-2">
                    <span className="size-3 rounded-full ring-2 ring-bg-primary" style={{ backgroundColor: color }} />
                    <span className="text-sm font-medium text-secondary">{current.name || "Untitled"}</span>
                </span>
            </div>

            {/* Key dates + doses left header summary */}
            {scheduled ? (
                <Card className="shadow-xs">
                    <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-3">
                        {cur != null && cur >= 1 && cur <= total ? (
                            <Badge color="brand" size="md" type="pill-color">
                                Week {cur} of {total}
                            </Badge>
                        ) : (
                            <Badge color="gray" size="md" type="modern">
                                {cur != null && cur > total ? "Cycle Complete" : "Starts Soon"}
                            </Badge>
                        )}
                        <span className="hidden h-9 w-px bg-border-secondary sm:block" aria-hidden="true" />
                        <HeaderStat label="Start" value={fmtShort(current.cycleStartDate)} />
                        <HeaderStat label="End" value={fmtShort(cycleEndDate(current))} />
                        <HeaderStat label="Taken" value={String(totals.taken)} />
                        {totals.missed > 0 && <HeaderStat label="Missed" value={String(totals.missed)} warn />}
                        <HeaderStat label="Doses left" value={String(totals.left)} />
                        <HeaderStat label="In cycle" value={String(totals.total)} />
                        <HeaderStat label="Supply covers" value={String(left.coverable)} />
                    </CardBody>
                </Card>
            ) : (
                <Card className="shadow-xs transition duration-100 ease-linear hover:ring-brand">
                    <a href="#cycle-start-date" className="block px-5 py-4 text-sm text-tertiary transition duration-100 ease-linear hover:text-secondary">
                        Set a start date to see the timeline.
                    </a>
                </Card>
            )}
            <PeptidePanel
                peptide={current}
                color={color}
                unitSystem={unitSystem}
                onChange={(patch) => store.updatePeptide(current.id, patch)}
                onDelete={() => {
                    store.removePeptide(current.id);
                    router.push("/health/peptides");
                }}
                onAddBlock={() => store.addBlock(current.id)}
                onUpdateBlock={(blockId, patch) => store.updateBlock(current.id, blockId, patch)}
                onRemoveBlock={(blockId) => store.removeBlock(current.id, blockId)}
                onDuplicateBlock={(blockId) => store.duplicateBlock(current.id, blockId)}
                onResizeBlock={(blockId, delta) => store.resizeBlock(current.id, blockId, delta)}
                onSplitBlock={(blockId, week) => store.splitBlock(current.id, blockId, week)}
                onToggle={handleToggle}
                onAddLog={(entry, supply) => store.addLog(current.id, entry, supply)}
                onRemoveLog={(logId, restored) => store.removeLog(current.id, logId, restored)}
                onOpenNewVial={(opened, remaining) => store.openNewVial(current.id, opened, remaining)}
            />
        </div>
    );
}

function HeaderStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium tracking-wider whitespace-nowrap text-tertiary uppercase">{label}</span>
            <span className={cx("font-mono text-sm leading-5 font-semibold tabular-nums", warn ? "text-error-primary" : "text-primary")}>{value}</span>
        </div>
    );
}
