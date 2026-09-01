"use client";

import { useState } from "react";
import { Download01, FileCheck02 } from "@untitledui/icons";
import { toast } from "sonner";
import type { Block, LogEntry, Peptide } from "@/lib/peptides/types";
import type { Occurrence } from "@/lib/peptides/schedule";
import type { UnitSystem } from "@/lib/units";
import { generateSchedule } from "@/lib/peptides/schedule";
import { downloadPlanCsv } from "@/lib/peptides/csv";
import { exportPeptidePdf } from "@/lib/peptides/pdf";
import { Button } from "@/components/base/buttons/button";
import { Tabs } from "@/components/application/tabs/tabs";
import { ReconstitutionEditor } from "./reconstitution-editor";
import { DoseCalculator } from "./dose-calculator";
import { CyclePlanTable } from "./cycle-plan-table";
import { CycleSummary } from "./cycle-summary";
import { CycleTimeline } from "./cycle-timeline";
import { LogView } from "./log-view";
import { ScheduleCalendar, type CalendarTrack } from "./schedule-calendar";
import { UsageChart } from "./usage-chart";
import { Card, CardBody, CardHeader, CardTitle } from "./card";

interface Props {
    peptide: Peptide;
    color: string;
    unitSystem: UnitSystem;
    onChange: (patch: Partial<Peptide>) => void;
    onDelete: () => void;
    onAddBlock: () => void;
    onUpdateBlock: (blockId: string, patch: Partial<Block>) => void;
    onRemoveBlock: (blockId: string) => void;
    onDuplicateBlock: (blockId: string) => void;
    onResizeBlock: (blockId: string, delta: number) => void;
    onSplitBlock: (blockId: string, week: number) => void;
    onToggle: (peptideId: string, occ: Occurrence) => void;
    onAddLog: (entry: Omit<LogEntry, "id">, supply: { activeVialRemainingMl: number; vialsOpened?: number }) => void;
    onRemoveLog: (logId: string, restoredRemainingMl: number) => void;
    onOpenNewVial: (vialsOpened: number, activeVialRemainingMl: number) => void;
}

export function PeptidePanel({
    peptide,
    color,
    unitSystem,
    onChange,
    onDelete,
    onAddBlock,
    onUpdateBlock,
    onRemoveBlock,
    onDuplicateBlock,
    onResizeBlock,
    onSplitBlock,
    onToggle,
    onAddLog,
    onRemoveLog,
    onOpenNewVial,
}: Props) {
    const [pdfBusy, setPdfBusy] = useState(false);
    const [tab, setTab] = useState("plan");
    const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
    const track: CalendarTrack = {
        peptideId: peptide.id,
        name: peptide.name,
        color,
        peptide,
        occurrences: generateSchedule(peptide),
    };

    const handlePdf = async () => {
        setPdfBusy(true);
        try {
            await exportPeptidePdf(peptide);
        } catch {
            toast.error("Could not generate PDF.");
        } finally {
            setPdfBusy(false);
        }
    };

    const selectBlock = (blockId: string) => {
        setTab("plan");
        setFocusBlockId(blockId);
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Full-width cycle timeline above the working columns. */}
            <CycleTimeline peptide={peptide} color={color} onSelectBlock={selectBlock} />

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                <div className="flex flex-col gap-4">
                    <ReconstitutionEditor peptide={peptide} onChange={onChange} onDelete={onDelete} unitSystem={unitSystem} />
                    <DoseCalculator peptide={peptide} />
                    <CycleSummary peptide={peptide} />
                </div>

                <div className="min-w-0">
                    <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k))}>
                        <div className="flex items-center justify-between gap-2">
                            <Tabs.List type="button-border">
                                <Tabs.Item id="plan">Plan</Tabs.Item>
                                <Tabs.Item id="schedule">Schedule</Tabs.Item>
                                <Tabs.Item id="log">Log</Tabs.Item>
                            </Tabs.List>
                            <div className="flex gap-2">
                                <Button size="sm" color="secondary" iconLeading={Download01} onClick={() => downloadPlanCsv(peptide)}>
                                    CSV
                                </Button>
                                <Button size="sm" color="secondary" iconLeading={FileCheck02} onClick={handlePdf} isLoading={pdfBusy}>
                                    PDF
                                </Button>
                            </div>
                        </div>

                        <Tabs.Panel id="plan" className="mt-4">
                            <CyclePlanTable
                                peptide={peptide}
                                onAddBlock={onAddBlock}
                                onUpdateBlock={onUpdateBlock}
                                onRemoveBlock={onRemoveBlock}
                                onDuplicateBlock={onDuplicateBlock}
                                onResizeBlock={onResizeBlock}
                                onSplitBlock={onSplitBlock}
                                focusBlockId={focusBlockId}
                                onFocusHandled={() => setFocusBlockId(null)}
                            />
                        </Tabs.Panel>

                        <Tabs.Panel id="schedule" className="mt-4 flex flex-col gap-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Schedule — tap a dose to mark it taken</CardTitle>
                                </CardHeader>
                                <CardBody>
                                    <ScheduleCalendar tracks={[track]} onToggle={onToggle} />
                                </CardBody>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>Weekly Planned Units</CardTitle>
                                </CardHeader>
                                <CardBody>
                                    <UsageChart peptides={[peptide]} colorOf={() => color} />
                                </CardBody>
                            </Card>
                        </Tabs.Panel>

                        <Tabs.Panel id="log" className="mt-4">
                            <LogView peptide={peptide} onAddLog={onAddLog} onRemoveLog={onRemoveLog} onOpenNewVial={onOpenNewVial} unitSystem={unitSystem} />
                        </Tabs.Panel>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}
