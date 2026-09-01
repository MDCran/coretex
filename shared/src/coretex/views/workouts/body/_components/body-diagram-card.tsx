// @ts-nocheck

import { useState } from "react";
import { UnitSystem } from "@/lib/units";
import BodyDiagram from "@/components/health/body-diagram";
import { Card, SectionHeader } from "../../_components/workouts-ui";
import { cx } from "@/utils/cx";

export interface BodyMarkerInput {
    neckCm: number | null;
    chestCm: number | null;
    waistCm: number | null;
    hipCm: number | null;
    armLCm: number | null;
    armRCm: number | null;
    legLCm: number | null;
    legRCm: number | null;
}

function fmt(cm: number | null, imperial: boolean): string | null {
    if (cm == null) return null;
    const v = imperial ? cm / 2.54 : cm;
    return `${v.toFixed(1)} ${imperial ? "in" : "cm"}`;
}

function pairAvg(a: number | null, b: number | null): number | null {
    if (a == null && b == null) return null;
    if (a != null && b != null) return (a + b) / 2;
    return (a ?? b)!;
}

/** Interactive body map — latest girth measurements shown as per-region markers. */
export function BodyDiagramCard({ measurement, unitSystem }: { measurement: BodyMarkerInput | null; unitSystem: UnitSystem }) {
    const [view, setView] = useState<"front" | "back">("front");
    const [selected, setSelected] = useState<string | null>(null);
    const imperial = unitSystem === "IMPERIAL";

    const markers: Record<string, string> = {};
    if (measurement) {
        const add = (region: string, cm: number | null) => {
            const v = fmt(cm, imperial);
            if (v) markers[region] = v;
        };
        add("neck", measurement.neckCm);
        add("chest", measurement.chestCm);
        add("core", measurement.waistCm);
        add("hips", measurement.hipCm);
        add("arms", pairAvg(measurement.armLCm, measurement.armRCm));
        add("thighs", pairAvg(measurement.legLCm, measurement.legRCm));
    }

    const selectedValue = selected ? markers[selected] : undefined;

    return (
        <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionHeader title="Body map" />
                <div className="flex rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset">
                    {(["front", "back"] as const).map((v) => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => setView(v)}
                            className={cx(
                                "cursor-pointer rounded-md px-3 py-1 text-sm font-medium capitalize transition duration-100 ease-linear",
                                view === v ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-tertiary hover:text-secondary",
                            )}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>

            <div className="mt-4 flex flex-col items-center gap-3">
                <BodyDiagram view={view} selected={selected} onSelectRegion={setSelected} markers={markers} className="mx-auto h-80 max-w-[240px]" />
                <p className="min-h-5 text-center text-sm text-tertiary">
                    {selected ? (
                        <>
                            <span className="font-semibold text-secondary capitalize">{selected}</span>
                            {selectedValue ? ` · ${selectedValue}` : " · not measured"}
                        </>
                    ) : Object.keys(markers).length > 0 ? (
                        "Tap a region to inspect your latest measurement."
                    ) : (
                        "Log measurements to see them mapped here."
                    )}
                </p>
            </div>
        </Card>
    );
}
