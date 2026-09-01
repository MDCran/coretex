// @ts-nocheck
import { useMemo, useState } from "react";
import { Beaker02, FileCheck02, Plus } from "@untitledui/icons";
import type { Peptide } from "@/lib/peptides/types";
import type { Occurrence } from "@/lib/peptides/schedule";
import { type UnitSystem, volumeToDisplay, volumeUnit } from "@/lib/units";
import { deriveBlock, deriveCycle, mgToUnit } from "@/lib/peptides/dosing";
import { fmt, fmtUnits } from "@/lib/peptides/format";
const exportOverviewPdf = () => {};
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { UsageChart } from "./usage-chart";
import { Card, CardBody, CardHeader, CardTitle } from "./card";
import { EmptyState } from "./empty-state";
import { PeptideHeroCard } from "./peptide-hero-card";
import { ScheduleCalendar, type CalendarTrack } from "./schedule-calendar";
import { snapshot } from "./supply";

interface Props {
    peptides: Peptide[];
    colorOf: (id: string) => string;
    tracks: CalendarTrack[];
    onLogOccurrence: (peptideId: string, occ: Occurrence) => void;
    onExporting: (busy: boolean) => void;
    onAdd: () => void;
    unitSystem: UnitSystem;
}

function distinctUnits(p: Peptide): string {
    const vals = new Set(
        p.blocks
            .map((b) => deriveBlock(b, p).unitsPerAdmin)
            .filter((u) => u > 0)
            .map((u) => `${fmtUnits(u)}u`),
    );
    return vals.size ? [...vals].join(", ") : "—";
}

function distinctDoses(p: Peptide): string {
    const vals = new Set(p.blocks.filter((b) => b.dosePerAdmin > 0).map((b) => `${fmt(b.dosePerAdmin)} ${p.doseUnit}`));
    return vals.size ? [...vals].join(", ") : "—";
}

export function Overview({ peptides, colorOf, tracks, onLogOccurrence, onExporting, onAdd, unitSystem }: Props) {
    const snaps = useMemo(() => new Map(peptides.map((p) => [p.id, snapshot(p)])), [peptides]);
    const volUnit = volumeUnit(unitSystem);
    const [exporting, setExporting] = useState(false);

    const handleExport = async () => {
        setExporting(true);
        onExporting(true);
        try {
            await exportOverviewPdf(peptides);
        } finally {
            setExporting(false);
            onExporting(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            {/* Hero cards */}
            {peptides.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={Beaker02}
                        title="Plan your first peptide protocol"
                        description="Set up a vial and reconstitution, then map out cycles, doses and supply — all calculated for you and tracked in one place."
                        actionLabel="Add your first peptide"
                        actionIcon={Plus}
                        onAction={onAdd}
                    />
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {peptides.map((p) => (
                        <PeptideHeroCard key={p.id} peptide={p} color={colorOf(p.id)} snap={snaps.get(p.id)!} onLogToday={(occ) => onLogOccurrence(p.id, occ)} unitSystem={unitSystem} />
                    ))}
                </div>
            )}

            {peptides.length > 0 && (
                <>
                    {/* Combined schedule calendar (all peptides, click-to-log) */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Schedule — tap a dose to log it</CardTitle>
                        </CardHeader>
                        <CardBody>
                            <ScheduleCalendar tracks={tracks} onToggle={onLogOccurrence} showNames />
                        </CardBody>
                    </Card>

                    {/* Comparison table */}
                    <Card>
                        <CardHeader>
                            <CardTitle>All cycles</CardTitle>
                            <div className="flex items-center gap-2">
                                <Button size="sm" color="secondary" iconLeading={FileCheck02} onClick={handleExport} isLoading={exporting} showTextWhileLoading>
                                    Export PDF
                                </Button>
                                <Button size="sm" iconLeading={Plus} onClick={onAdd}>
                                    Add peptide
                                </Button>
                            </div>
                        </CardHeader>
                        <CardBody className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-secondary text-left text-xs font-semibold tracking-wider text-tertiary uppercase">
                                        <th className="px-2 py-2">Peptide</th>
                                        <th className="px-2 py-2 text-right">Dose</th>
                                        <th className="px-2 py-2 text-right">Units / dose</th>
                                        <th className="px-2 py-2 text-right">Cycle total</th>
                                        <th className="px-2 py-2 text-right">Vials needed</th>
                                        <th className="px-2 py-2 text-right">Bac. water</th>
                                        <th className="px-2 py-2 text-right">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {peptides.map((p) => {
                                        const s = deriveCycle(p);
                                        return (
                                            <tr key={p.id} className="border-b border-secondary last:border-0">
                                                <td className="px-2 py-2.5">
                                                    <a href={`/health/peptides/${p.id}`} className="flex items-center gap-2 font-medium text-secondary hover:text-primary">
                                                        <span className="size-2.5 rounded-full" style={{ backgroundColor: colorOf(p.id) }} />
                                                        {p.name}
                                                    </a>
                                                </td>
                                                <td className="px-2 py-2.5 text-right font-mono text-secondary tabular-nums">{distinctDoses(p)}</td>
                                                <td className="px-2 py-2.5 text-right font-mono text-secondary tabular-nums">{distinctUnits(p)}</td>
                                                <td className="px-2 py-2.5 text-right font-mono text-secondary tabular-nums">
                                                    {fmt(mgToUnit(s.cycleTotalMg, p.doseUnit), 2)} {p.doseUnit}
                                                </td>
                                                <td className="px-2 py-2.5 text-right font-mono text-secondary tabular-nums">{s.vialsNeeded}</td>
                                                <td className="px-2 py-2.5 text-right font-mono text-secondary tabular-nums">
                                                    {volumeToDisplay(p.waterMl, unitSystem)} {volUnit}
                                                </td>
                                                <td className="px-2 py-2.5 text-right">
                                                    {s.overBudget ? (
                                                        <Badge color="error" size="sm" type="pill-color">
                                                            Short {fmt(mgToUnit(s.shortfallMg, p.doseUnit), 1)} {p.doseUnit}
                                                        </Badge>
                                                    ) : (
                                                        <Badge color="success" size="sm" type="pill-color">
                                                            On Track
                                                        </Badge>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </CardBody>
                    </Card>

                    {/* Weekly stacked chart */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Weekly planned units</CardTitle>
                        </CardHeader>
                        <CardBody>
                            <UsageChart peptides={peptides} colorOf={colorOf} />
                        </CardBody>
                    </Card>
                </>
            )}
        </div>
    );
}
