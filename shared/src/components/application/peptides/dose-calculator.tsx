// @ts-nocheck
import { useState } from "react";
import type { Peptide } from "@/lib/peptides/types";
import { computeDose } from "@/lib/peptides/dosing";
import { fmt, fmtUnits, syringeLabel } from "@/lib/peptides/format";
import { Slider } from "@/components/base/slider/slider";
import { cx } from "@/utils/cx";
import { Card, CardBody, CardHeader, CardTitle } from "./card";
import { Field, NumberInput } from "./field-controls";

export function DoseCalculator({ peptide }: { peptide: Peptide }) {
    const [dose, setDose] = useState<number>(peptide.doseUnit === "mcg" ? 30 : 2);
    const r = computeDose({
        vialMg: peptide.vialMg,
        waterMl: peptide.waterMl,
        syringeUnitsPerMl: peptide.syringeUnitsPerMl,
        dose,
        unit: peptide.doseUnit,
    });
    const valid = r.mgPerMl > 0;
    const max = peptide.doseUnit === "mcg" ? Math.max(100, Math.round(peptide.vialMg * 1000)) : Math.max(5, Math.round(peptide.vialMg));
    const step = peptide.doseUnit === "mcg" ? 5 : 0.25;

    // Syringe fill: units drawn relative to a full 1 ml barrel (syringeUnitsPerMl units).
    const fillPct = valid ? Math.max(0, Math.min(100, (r.unitsPerDose / peptide.syringeUnitsPerMl) * 100)) : 0;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Dose calculator</CardTitle>
            </CardHeader>
            <CardBody className="space-y-5">
                <div className="flex items-end justify-between gap-4">
                    <Field label={`Dose (${peptide.doseUnit})`} className="w-32 shrink-0">
                        <NumberInput value={dose} min={0} max={max} step={step} size="md" onChange={setDose} aria-label="Dose" />
                    </Field>
                    <div className="flex flex-col items-end pb-0.5">
                        <span className="font-mono text-4xl leading-none font-semibold text-primary tabular-nums">{valid ? fmtUnits(r.unitsPerDose) : "—"}</span>
                        <span className="mt-1.5 text-[10px] tracking-wider text-tertiary uppercase">units ({syringeLabel(peptide.syringeUnitsPerMl)})</span>
                    </div>
                </div>

                <Slider
                    aria-label="Dose"
                    value={[dose]}
                    minValue={0}
                    maxValue={max}
                    step={step}
                    onChange={(v) => setDose(Array.isArray(v) ? v[0] : v)}
                />

                {/* Syringe visualization: rounded track, brand fill, quarter ticks + tick at the drawn volume */}
                <div>
                    <div className="relative h-8 overflow-hidden rounded-full bg-quaternary ring-1 ring-secondary ring-inset">
                        <div
                            className={cx("h-full rounded-full transition-[width] duration-150 ease-linear", fillPct > 100 ? "bg-error-solid" : "bg-brand-solid")}
                            style={{ width: `${Math.min(100, fillPct)}%` }}
                        />
                        {/* Quarter-barrel ticks */}
                        {[25, 50, 75].map((t) => (
                            <span
                                key={t}
                                className="pointer-events-none absolute top-0 bottom-0 w-px bg-bg-primary/40"
                                style={{ left: `${t}%` }}
                                aria-hidden="true"
                            />
                        ))}
                        {/* Target tick at the drawn volume */}
                        {valid && fillPct > 0 && fillPct <= 100 && (
                            <span
                                className="pointer-events-none absolute top-0.5 bottom-0.5 w-0.5 rounded-full bg-fg-white shadow-xs transition-[left] duration-150 ease-linear"
                                style={{ left: `calc(${fillPct}% - 1px)` }}
                                aria-hidden="true"
                            />
                        )}
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-3 font-mono text-xs tabular-nums">
                            <span className={cx(fillPct > 18 ? "text-white" : "text-secondary")}>{valid ? `${fmtUnits(r.unitsPerDose)}u` : "—"}</span>
                            <span className={cx(fillPct > 82 ? "text-white" : "text-tertiary")}>{peptide.syringeUnitsPerMl}u barrel</span>
                        </div>
                    </div>
                    <div className="mt-1 flex justify-between px-0.5 font-mono text-[10px] text-quaternary tabular-nums" aria-hidden="true">
                        <span>0u</span>
                        <span>{Math.round(peptide.syringeUnitsPerMl / 2)}u</span>
                        <span>{peptide.syringeUnitsPerMl}u</span>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg ring-1 ring-secondary">
                    <div className="flex flex-col gap-1 bg-secondary p-3">
                        <span className="text-[10px] tracking-wider text-tertiary uppercase">Draw volume</span>
                        <span className="font-mono text-lg text-primary tabular-nums">{valid ? `${fmt(r.mlPerDose, 4)} ml` : "—"}</span>
                    </div>
                    <div className="flex flex-col gap-1 bg-secondary p-3">
                        <span className="text-[10px] tracking-wider text-tertiary uppercase">Concentration</span>
                        <span className="font-mono text-lg text-primary tabular-nums">{valid ? `${fmt(r.mgPerMl)} mg/ml` : "—"}</span>
                    </div>
                </div>

                {!valid && <p className="text-xs text-tertiary">Set bacteriostatic water &gt; 0 to compute draw volume.</p>}
            </CardBody>
        </Card>
    );
}
