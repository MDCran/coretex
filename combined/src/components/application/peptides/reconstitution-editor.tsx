"use client";

import { useState } from "react";
import { Beaker02, Calculator, Droplets01, Package, Trash01 } from "@untitledui/icons";
import type { DoseUnit, Peptide, SyringeUnitsPerMl } from "@/lib/peptides/types";
import { type UnitSystem, parseVolumeInput, volumeToDisplay, volumeUnit } from "@/lib/units";
import { concentrationMgPerMl, mgToUnit } from "@/lib/peptides/dosing";
import { fmt } from "@/lib/peptides/format";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ControlledDateInput } from "@/components/base/input/form-date-input";
import { Card, CardBody } from "./card";
import { Field, FieldSelect, NumberInput } from "./field-controls";
import { ConfirmModal } from "./confirm-modal";

interface Props {
    peptide: Peptide;
    onChange: (patch: Partial<Peptide>) => void;
    onDelete: () => void;
    unitSystem: UnitSystem;
}

const SYRINGES: SyringeUnitsPerMl[] = [100, 50, 40];

export function ReconstitutionEditor({ peptide, onChange, onDelete, unitSystem }: Props) {
    const [confirmDelete, setConfirmDelete] = useState(false);
    const volUnit = volumeUnit(unitSystem);
    const conc = concentrationMgPerMl(peptide.vialMg, peptide.waterMl);
    const perUnitDisplay = mgToUnit(conc / peptide.syringeUnitsPerMl, peptide.doseUnit);
    const invalidWater = !peptide.waterMl || peptide.waterMl <= 0;

    return (
        <Card>
            <div className="flex items-center justify-between gap-2 border-b border-secondary px-4 py-3">
                <Input
                    aria-label="Peptide name"
                    value={peptide.name}
                    placeholder="Peptide name"
                    onChange={(v) => onChange({ name: v })}
                    size="sm"
                    inputClassName="text-lg font-semibold"
                    wrapperClassName="border-0 bg-transparent shadow-none ring-0"
                    className="flex-1"
                />
                <Button size="sm" color="secondary-destructive" iconLeading={Trash01} onClick={() => setConfirmDelete(true)}>
                    Delete
                </Button>
            </div>
            <CardBody className="space-y-4">
                <div className="flex flex-col gap-0.5">
                    <h4 className="text-xs font-semibold tracking-wider text-tertiary uppercase">Vial &amp; reconstitution</h4>
                    <p className="text-xs text-tertiary">How each vial is mixed — this sets the concentration for every dose.</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Vial strength" required>
                        <NumberInput value={peptide.vialMg} min={0} icon={Beaker02} suffix="mg" onChange={(v) => onChange({ vialMg: v })} aria-label="Vial strength" />
                    </Field>
                    <Field label="Bac. water" required warn={invalidWater ? "enter > 0" : undefined}>
                        <NumberInput
                            value={volumeToDisplay(peptide.waterMl, unitSystem)}
                            min={0}
                            step={0.5}
                            icon={Droplets01}
                            suffix={volUnit}
                            isInvalid={invalidWater}
                            onChange={(v) => onChange({ waterMl: parseVolumeInput(v, unitSystem) ?? 0 })}
                            aria-label="Bacteriostatic water per vial"
                        />
                    </Field>
                    <Field label="Vials owned (dry stock)">
                        <NumberInput value={peptide.vialsOwned} min={0} step={1} icon={Package} onChange={(v) => onChange({ vialsOwned: v })} aria-label="Vials owned" />
                    </Field>
                    <Field label="Cycle start date">
                        <ControlledDateInput
                            id="cycle-start-date"
                            size="sm"
                            value={peptide.cycleStartDate || null}
                            onChange={(v) => onChange({ cycleStartDate: v })}
                        />
                    </Field>
                    <Field label="Dose unit">
                        <FieldSelect
                            value={peptide.doseUnit}
                            onChange={(v) => onChange({ doseUnit: v as DoseUnit })}
                            options={[
                                { value: "mg", label: "mg" },
                                { value: "mcg", label: "mcg" },
                            ]}
                            aria-label="Dose unit"
                        />
                    </Field>
                    <Field label="Syringe scale">
                        <FieldSelect
                            value={String(peptide.syringeUnitsPerMl)}
                            onChange={(v) => onChange({ syringeUnitsPerMl: Number(v) as SyringeUnitsPerMl })}
                            options={SYRINGES.map((s) => ({ value: String(s), label: `U-${s} (${s}u = 1 ml)` }))}
                            aria-label="Syringe scale"
                        />
                    </Field>
                </div>

                {/* Live "what this means" summary */}
                <div className="flex items-start gap-3 rounded-lg bg-secondary p-3">
                    <Calculator className="mt-0.5 size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                    {invalidWater ? (
                        <p className="text-sm text-tertiary">Enter bacteriostatic water greater than 0 to compute concentration.</p>
                    ) : (
                        <p className="text-sm text-secondary">
                            Concentration <span className="font-mono font-semibold text-primary tabular-nums">{fmt(conc)} mg/ml</span> · each unit ={" "}
                            <span className="font-mono font-semibold text-primary tabular-nums">
                                {fmt(perUnitDisplay, 4)} {peptide.doseUnit}
                            </span>{" "}
                            · active vial{" "}
                            <span className="font-mono font-semibold text-primary tabular-nums">
                                {volumeToDisplay(peptide.activeVialRemainingMl, unitSystem)} {volUnit}
                            </span>
                        </p>
                    )}
                </div>
                <p className="text-xs text-tertiary">
                    Reconstitute a vial on demand with <span className="font-medium text-secondary">Open new vial</span> in the Log tab.
                </p>
            </CardBody>

            <ConfirmModal
                isOpen={confirmDelete}
                onOpenChange={setConfirmDelete}
                title="Delete peptide?"
                description={`This permanently removes "${peptide.name || "this peptide"}", its cycle plan and all logged doses.`}
                confirmLabel="Delete peptide"
                destructive
                onConfirm={() => {
                    setConfirmDelete(false);
                    onDelete();
                }}
            />
        </Card>
    );
}
