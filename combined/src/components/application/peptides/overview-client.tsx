"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Beaker02, Plus } from "@untitledui/icons";
import { toast } from "sonner";
import type { Peptide } from "@/lib/peptides/types";
import type { Occurrence } from "@/lib/peptides/schedule";
import type { UnitSystem } from "@/lib/units";
import { generateSchedule } from "@/lib/peptides/schedule";
import { isOccurrenceTaken } from "@/lib/peptides/admin";
import { peptideColor } from "@/lib/peptides/peptide-color";
import { Button } from "@/components/base/buttons/button";
import { usePeptides } from "./use-peptides";
import { toggleOccurrence } from "./toggle-helper";
import { Overview } from "./overview";
import type { CalendarTrack } from "./schedule-calendar";
import { AddPeptideModal } from "./add-peptide-modal";

export function PeptidesOverviewClient({ initial, unitSystem }: { initial: Peptide[]; unitSystem: UnitSystem }) {
    const store = usePeptides(initial);
    const router = useRouter();
    const [adding, setAdding] = useState(false);
    const [exporting, setExporting] = useState(false);

    const colorOf = useMemo(() => {
        const map = new Map(store.peptides.map((p, i) => [p.id, peptideColor(i)]));
        return (id: string) => map.get(id) ?? peptideColor(0);
    }, [store.peptides]);

    // One calendar track per peptide for the combined schedule calendar.
    const tracks = useMemo<CalendarTrack[]>(
        () =>
            store.peptides.map((p, i) => ({
                peptideId: p.id,
                name: p.name || "Untitled",
                color: peptideColor(i),
                peptide: p,
                occurrences: generateSchedule(p),
            })),
        [store.peptides],
    );

    const handleLog = (peptideId: string, occ: Occurrence) => {
        const p = store.peptides.find((x) => x.id === peptideId);
        if (!p) return;
        const wasTaken = isOccurrenceTaken(p, occ);
        toggleOccurrence(store, p, occ);
        toast.success(wasTaken ? "Dose un-logged." : "Dose logged.");
    };

    return (
        <div className="flex flex-col gap-6">
            {/* Premium module hero — mirrors the Nutrition landing energy while keeping
                the create flow as an in-page modal (so it stays an onClick CTA). */}
            <div className="relative overflow-hidden rounded-2xl bg-primary ring-1 ring-secondary ring-inset">
                <div
                    className="pointer-events-none absolute inset-0 opacity-[0.6]"
                    style={{
                        backgroundImage:
                            "linear-gradient(to right, var(--color-border-secondary) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border-secondary) 1px, transparent 1px)",
                        backgroundSize: "34px 34px",
                        maskImage: "radial-gradient(ellipse 75% 90% at 15% 0%, black 0%, transparent 75%)",
                        WebkitMaskImage: "radial-gradient(ellipse 75% 90% at 15% 0%, black 0%, transparent 75%)",
                    }}
                    aria-hidden="true"
                />
                <div
                    className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full opacity-50 blur-3xl"
                    style={{ background: "radial-gradient(circle, rgb(127 86 217 / 0.5) 0%, transparent 70%)" }}
                    aria-hidden="true"
                />
                <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-px"
                    style={{ background: "linear-gradient(to right, transparent, rgb(127 86 217 / 0.5), transparent)" }}
                    aria-hidden="true"
                />
                <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between lg:p-8">
                    <div className="flex max-w-xl flex-col gap-3">
                        <div className="flex items-center gap-2">
                            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-primary text-brand-secondary ring-1 ring-brand ring-inset">
                                <Beaker02 className="size-5" aria-hidden="true" />
                            </span>
                            <p className="text-sm font-semibold text-brand-secondary">Your peptide command center</p>
                        </div>
                        <h2 className="text-display-xs font-semibold text-primary sm:text-display-sm">Plan, dose and never run short</h2>
                        <p className="text-md text-tertiary">
                            Map cycles, calculate every draw and track supply in one place — so each protocol stays precise and you always know your next dose.
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                            <Button size="lg" iconLeading={Plus} onClick={() => setAdding(true)}>
                                Add peptide
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <Overview
                peptides={store.peptides}
                colorOf={colorOf}
                tracks={tracks}
                onLogOccurrence={handleLog}
                onExporting={setExporting}
                onAdd={() => setAdding(true)}
                unitSystem={unitSystem}
            />

            <AddPeptideModal
                isOpen={adding}
                onOpenChange={setAdding}
                unitSystem={unitSystem}
                onCreate={async (input) => {
                    const id = await store.addPeptide(input);
                    if (id) {
                        toast.success("Peptide created.");
                        router.push(`/health/peptides/${id}`);
                    }
                }}
            />

            {exporting && <span className="sr-only" role="status">Generating PDF…</span>}
        </div>
    );
}
