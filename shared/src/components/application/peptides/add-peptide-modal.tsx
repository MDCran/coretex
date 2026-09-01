// @ts-nocheck
import { useState } from "react";
import { Beaker02, Calculator, Droplets01, Package } from "@untitledui/icons";
import type { DoseUnit, SyringeUnitsPerMl } from "@/lib/peptides/types";
import type { NewPeptideInput } from "@/lib/actions/peptides";
import { type UnitSystem } from "@/lib/units";
const parseVolumeInput = (a:any) => a;
const volumeToDisplay = (a:any) => a;
const volumeUnit = () => "ml";
import { concentrationMgPerMl, mgToUnit } from "@/lib/peptides/dosing";
import { fmt } from "@/lib/peptides/format";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ControlledDateInput } from "@/components/base/input/form-date-input";
import { PeptideModal } from "./peptide-modal";
import { Field, FieldSelect, NumberInput } from "./field-controls";

interface Props {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onCreate: (input: NewPeptideInput) => Promise<void> | void;
    unitSystem: UnitSystem;
}

const SYRINGES: SyringeUnitsPerMl[] = [100, 50, 40];
const DEFAULT_WATER_ML = 2;

export function AddPeptideModal({ isOpen, onOpenChange, onCreate, unitSystem }: Props) {
    const volUnit = volumeUnit(unitSystem);
    const [name, setName] = useState("");
    const [vialMg, setVialMg] = useState(10);
    const [doseUnit, setDoseUnit] = useState<DoseUnit>("mg");
    // Edited in the user's display unit; converted to ml only for calc + storage.
    const [waterDisplay, setWaterDisplay] = useState(() => volumeToDisplay(DEFAULT_WATER_ML, unitSystem));
    const [syringe, setSyringe] = useState<SyringeUnitsPerMl>(100);
    const [vialsOwned, setVialsOwned] = useState(1);
    const [cycleStartDate, setCycleStartDate] = useState("");
    const [saving, setSaving] = useState(false);

    const waterMl = parseVolumeInput(waterDisplay, unitSystem) ?? 0;

    const reset = () => {
        setName("");
        setVialMg(10);
        setDoseUnit("mg");
        setWaterDisplay(volumeToDisplay(DEFAULT_WATER_ML, unitSystem));
        setSyringe(100);
        setVialsOwned(1);
        setCycleStartDate("");
    };

    const conc = concentrationMgPerMl(vialMg, waterMl);
    const perUnit = mgToUnit(conc / syringe, doseUnit);
    const validWater = waterMl > 0;

    const submit = async () => {
        if (!name.trim() || saving) return;
        setSaving(true);
        try {
            await onCreate({ name: name.trim(), vialMg, doseUnit, waterMl, syringeUnitsPerMl: syringe, vialsOwned, cycleStartDate: cycleStartDate || undefined });
            reset();
            onOpenChange(false);
        } finally {
            setSaving(false);
        }
    };

    return (
        <PeptideModal isOpen={isOpen} onOpenChange={onOpenChange} title="Add peptide" description="Set up the vial and reconstitution — you can plan the cycle next.">
            <div className="flex flex-col gap-5">
                <Input
                    label="Name"
                    placeholder="e.g. BPC-157"
                    value={name}
                    onChange={setName}
                    icon={Beaker02}
                    isRequired
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                />

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-0.5 border-b border-secondary pb-3">
                        <h3 className="text-sm font-semibold text-primary">Vial &amp; reconstitution</h3>
                        <p className="text-xs text-tertiary">How each vial is mixed — this sets the concentration for every dose.</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Vial strength" required>
                            <NumberInput value={vialMg} min={0} size="md" icon={Beaker02} suffix="mg" onChange={setVialMg} aria-label="Vial strength" />
                        </Field>
                        <Field label="Bac. water" required warn={!validWater ? "enter > 0" : undefined}>
                            <NumberInput
                                value={waterDisplay}
                                min={0}
                                step={0.5}
                                size="md"
                                icon={Droplets01}
                                suffix={volUnit}
                                isInvalid={!validWater}
                                onChange={setWaterDisplay}
                                aria-label="Bacteriostatic water per vial"
                            />
                        </Field>
                        <Field label="Dose unit">
                            <FieldSelect
                                size="md"
                                value={doseUnit}
                                onChange={(v) => setDoseUnit(v as DoseUnit)}
                                options={[
                                    { value: "mg", label: "mg" },
                                    { value: "mcg", label: "mcg" },
                                ]}
                                aria-label="Dose unit"
                            />
                        </Field>
                        <Field label="Syringe scale">
                            <FieldSelect
                                size="md"
                                value={String(syringe)}
                                onChange={(v) => setSyringe(Number(v) as SyringeUnitsPerMl)}
                                options={SYRINGES.map((s) => ({ value: String(s), label: `U-${s} (${s}u = 1 ml)` }))}
                                aria-label="Syringe scale"
                            />
                        </Field>
                        <Field label="Vials owned">
                            <NumberInput value={vialsOwned} min={0} step={1} size="md" icon={Package} onChange={setVialsOwned} aria-label="Vials owned" />
                        </Field>
                        <Field label="Cycle start (optional)">
                            <ControlledDateInput size="md" value={cycleStartDate || null} onChange={setCycleStartDate} />
                        </Field>
                    </div>
                </div>

                <div className="flex items-start gap-3 rounded-lg bg-secondary p-3">
                    <Calculator className="mt-0.5 size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                    {validWater ? (
                        <p className="text-sm text-secondary">
                            That makes <span className="font-mono font-semibold text-primary tabular-nums">{fmt(conc)} mg/ml</span> — each syringe unit delivers{" "}
                            <span className="font-mono font-semibold text-primary tabular-nums">
                                {fmt(perUnit, 4)} {doseUnit}
                            </span>
                            .
                        </p>
                    ) : (
                        <p className="text-sm text-tertiary">Enter bacteriostatic water greater than 0 to compute concentration.</p>
                    )}
                </div>

                <div className="flex justify-end gap-3 border-t border-secondary pt-4">
                    <Button color="secondary" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={submit} isDisabled={!name.trim()} isLoading={saving}>
                        Create peptide
                    </Button>
                </div>
            </div>
        </PeptideModal>
    );
}
