"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Plus, Trash01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { ExercisePickerModal, type ExerciseLibraryItem } from "../../exercises/_components/exercise-library-picker";
import { createTemplate, updateTemplate, type TemplateExerciseInput, type TemplateInput, type TemplateSetInput } from "@/lib/actions/workouts-templates";
import { type UnitSystem, parseWeightInput, weightToDisplay, weightUnit } from "@/lib/units";
import { Card, Field, NativeInput, NativeSelect, NativeTextarea } from "../../_components/workouts-ui";

// Template weights are stored in kg. State stays kg; inputs show/accept the
// chosen unit so progression math (server-side, kg) stays correct.
const kgToInput = (kg: number | null | undefined, system: UnitSystem) => (kg == null ? "" : String(weightToDisplay(kg, system)));
const inputToKg = (v: string, system: UnitSystem) => (v === "" ? null : parseWeightInput(v, system));

type EditorSet = TemplateSetInput;
type EditorExercise = TemplateExerciseInput & { _name: string; warmupJson: string };

export type TemplateEditorInitial = {
    id: string;
    name: string;
    note: string | null;
    progression: TemplateInput["progression"];
    progressionStepKg: number | null;
    cycleWeek: number | null;
    exercises: Array<TemplateExerciseInput & { _name: string }>;
};

const SCHEMES: { value: TemplateInput["progression"]; label: string }[] = [
    { value: "NONE", label: "No progression" },
    { value: "LINEAR", label: "Linear (add weight when targets hit)" },
    { value: "DOUBLE", label: "Double progression (reps then weight)" },
    { value: "FIVETHREEONE", label: "5/3/1 (training max + week %)" },
];

function num(v: string): number | null {
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

export const TemplateEditor = ({ library, initial, unitSystem }: { library: ExerciseLibraryItem[]; initial?: TemplateEditorInitial; unitSystem: UnitSystem }) => {
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    const [name, setName] = useState(initial?.name ?? "");
    const [note, setNote] = useState(initial?.note ?? "");
    const [progression, setProgression] = useState<TemplateInput["progression"]>(initial?.progression ?? "NONE");
    // `step` is kept in kg-string (state); displayed/edited in the chosen unit.
    const [step, setStep] = useState(initial?.progressionStepKg != null ? String(initial.progressionStepKg) : "2.5");
    const [cycleWeek, setCycleWeek] = useState(initial?.cycleWeek != null ? String(initial.cycleWeek) : "1");
    const [pickerOpen, setPickerOpen] = useState(false);

    const [exercises, setExercises] = useState<EditorExercise[]>(
        (initial?.exercises ?? []).map((te) => ({
            ...te,
            warmupJson: te.warmupSets && te.warmupSets.length > 0 ? JSON.stringify(te.warmupSets) : "",
        })),
    );

    const isFiveThreeOne = progression === "FIVETHREEONE";

    const addExercise = (lib: ExerciseLibraryItem) => {
        setExercises((prev) => [
            ...prev,
            { exerciseId: lib.id, _name: lib.name, targetSets: 3, targetReps: 5, perSetMode: false, sets: [], warmupJson: "" },
        ]);
        setPickerOpen(false);
    };

    const update = (idx: number, patch: Partial<EditorExercise>) => setExercises((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
    const remove = (idx: number) => setExercises((prev) => prev.filter((_, i) => i !== idx));
    const move = (idx: number, dir: -1 | 1) =>
        setExercises((prev) => {
            const next = [...prev];
            const j = idx + dir;
            if (j < 0 || j >= next.length) return prev;
            [next[idx], next[j]] = [next[j], next[idx]];
            return next;
        });

    const save = () => {
        if (!name.trim()) {
            toast.error("Name is required");
            return;
        }
        const payload: TemplateInput = {
            name: name.trim(),
            note: note.trim() || null,
            progression,
            progressionStepKg: progression === "NONE" ? null : num(step),
            cycleWeek: isFiveThreeOne ? num(cycleWeek) ?? 1 : null,
            exercises: exercises.map((e) => {
                let warmupSets: Array<{ pct: number; reps: number }> | null = null;
                if (e.warmupJson.trim()) {
                    try {
                        const parsed = JSON.parse(e.warmupJson);
                        if (Array.isArray(parsed)) warmupSets = parsed;
                    } catch {
                        // ignored — invalid JSON is dropped
                    }
                }
                return {
                    exerciseId: e.exerciseId,
                    targetSets: e.targetSets,
                    targetReps: e.targetReps,
                    targetRepsMin: e.targetRepsMin,
                    targetRepsMax: e.targetRepsMax,
                    targetWeight: e.targetWeight,
                    trainingMaxKg: e.trainingMaxKg,
                    note: e.note,
                    restSec: e.restSec,
                    warmupSets,
                    groupKey: e.groupKey,
                    targetRpe: e.targetRpe,
                    tempo: e.tempo,
                    perSetMode: e.perSetMode,
                    sets: e.sets,
                };
            }),
        };

        startTransition(async () => {
            try {
                if (initial?.id) {
                    await updateTemplate(initial.id, payload);
                    toast.success("Template saved");
                    router.push(`/workouts/templates/${initial.id}`);
                } else {
                    const id = await createTemplate(payload);
                    toast.success("Template created");
                    router.push(`/workouts/templates/${id}`);
                }
            } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed to save");
            }
        });
    };

    return (
        <div className="flex flex-col gap-5">
            <Card className="flex flex-col gap-4">
                <Field label="Template name">
                    <NativeInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Upper / Lower A" />
                </Field>
                <Field label="Note">
                    <NativeTextarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional description" />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Progression scheme">
                        <NativeSelect value={progression} onChange={(e) => setProgression(e.target.value as TemplateInput["progression"])}>
                            {SCHEMES.map((s) => (
                                <option key={s.value} value={s.value}>
                                    {s.label}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                    {progression !== "NONE" && (
                        <Field label={`Progression step (${weightUnit(unitSystem)})`}>
                            <NativeInput
                                type="number"
                                step="0.5"
                                value={kgToInput(num(step), unitSystem)}
                                onChange={(e) => {
                                    const kg = inputToKg(e.target.value, unitSystem);
                                    setStep(kg == null ? "" : String(kg));
                                }}
                            />
                        </Field>
                    )}
                    {isFiveThreeOne && (
                        <Field label="Current cycle week" hint="1–4 (4 = deload)">
                            <NativeSelect value={cycleWeek} onChange={(e) => setCycleWeek(e.target.value)}>
                                <option value="1">Week 1 (5s)</option>
                                <option value="2">Week 2 (3s)</option>
                                <option value="3">Week 3 (5/3/1)</option>
                                <option value="4">Week 4 (deload)</option>
                            </NativeSelect>
                        </Field>
                    )}
                </div>
            </Card>

            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-primary">Exercises</h2>
                <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => setPickerOpen(true)}>
                    Add exercise
                </Button>
            </div>

            {exercises.length === 0 && <p className="text-sm text-tertiary">No exercises yet. Add at least one.</p>}

            <div className="flex flex-col gap-3">
                {exercises.map((e, idx) => (
                    <ExerciseEditor
                        key={`${e.exerciseId}-${idx}`}
                        ex={e}
                        idx={idx}
                        isFirst={idx === 0}
                        isLast={idx === exercises.length - 1}
                        isFiveThreeOne={isFiveThreeOne}
                        unitSystem={unitSystem}
                        onUpdate={(patch) => update(idx, patch)}
                        onRemove={() => remove(idx)}
                        onMove={(dir) => move(idx, dir)}
                    />
                ))}
            </div>

            <div className="flex justify-end gap-2">
                <Button color="secondary" type="button" onClick={() => router.back()}>
                    Cancel
                </Button>
                <Button color="primary" isLoading={pending} onClick={save}>
                    {initial?.id ? "Save template" : "Create template"}
                </Button>
            </div>

            {pickerOpen && (
                <ExercisePickerModal
                    exercises={library}
                    existingIds={exercises.map((e) => e.exerciseId)}
                    onClose={() => setPickerOpen(false)}
                    onPick={(id) => {
                        const lib = library.find((e) => e.id === id);
                        if (lib) addExercise(lib);
                    }}
                />
            )}
        </div>
    );
};

function ExerciseEditor({
    ex,
    idx,
    isFirst,
    isLast,
    isFiveThreeOne,
    unitSystem,
    onUpdate,
    onRemove,
    onMove,
}: {
    ex: EditorExercise;
    idx: number;
    isFirst: boolean;
    isLast: boolean;
    isFiveThreeOne: boolean;
    unitSystem: UnitSystem;
    onUpdate: (patch: Partial<EditorExercise>) => void;
    onRemove: () => void;
    onMove: (dir: -1 | 1) => void;
}) {
    const addSet = () => onUpdate({ sets: [...(ex.sets ?? []), { targetReps: 5, isAmrap: false, isWarmup: false }] });
    const updateSet = (si: number, patch: Partial<EditorSet>) => onUpdate({ sets: (ex.sets ?? []).map((s, i) => (i === si ? { ...s, ...patch } : s)) });
    const removeSet = (si: number) => onUpdate({ sets: (ex.sets ?? []).filter((_, i) => i !== si) });

    return (
        <Card className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-primary">
                        {idx + 1}. {ex._name}
                    </p>
                    {ex.groupKey && (
                        <Badge color="purple" size="sm">
                            Superset {ex.groupKey}
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <ButtonUtility size="xs" color="tertiary" icon={ChevronUp} tooltip="Move up" isDisabled={isFirst} onClick={() => onMove(-1)} />
                    <ButtonUtility size="xs" color="tertiary" icon={ChevronDown} tooltip="Move down" isDisabled={isLast} onClick={() => onMove(1)} />
                    <ButtonUtility size="xs" color="tertiary" icon={Trash01} tooltip="Remove" onClick={onRemove} />
                </div>
            </div>

            {!ex.perSetMode && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Field label="Sets">
                        <NativeInput type="number" value={ex.targetSets ?? ""} onChange={(e) => onUpdate({ targetSets: num(e.target.value) })} />
                    </Field>
                    <Field label="Reps">
                        <NativeInput type="number" value={ex.targetReps ?? ""} onChange={(e) => onUpdate({ targetReps: num(e.target.value) })} />
                    </Field>
                    <Field label="Reps min">
                        <NativeInput type="number" value={ex.targetRepsMin ?? ""} onChange={(e) => onUpdate({ targetRepsMin: num(e.target.value) })} />
                    </Field>
                    <Field label="Reps max">
                        <NativeInput type="number" value={ex.targetRepsMax ?? ""} onChange={(e) => onUpdate({ targetRepsMax: num(e.target.value) })} />
                    </Field>
                    {isFiveThreeOne ? (
                        <Field label={`Training max (${weightUnit(unitSystem)})`}>
                            <NativeInput type="number" step="0.5" value={kgToInput(ex.trainingMaxKg, unitSystem)} onChange={(e) => onUpdate({ trainingMaxKg: inputToKg(e.target.value, unitSystem) })} />
                        </Field>
                    ) : (
                        <Field label={`Weight (${weightUnit(unitSystem)})`}>
                            <NativeInput type="number" step="0.5" value={kgToInput(ex.targetWeight, unitSystem)} onChange={(e) => onUpdate({ targetWeight: inputToKg(e.target.value, unitSystem) })} />
                        </Field>
                    )}
                </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Rest (sec)">
                    <NativeInput type="number" value={ex.restSec ?? ""} onChange={(e) => onUpdate({ restSec: num(e.target.value) })} />
                </Field>
                <Field label="Target RPE">
                    <NativeInput type="number" step="0.5" value={ex.targetRpe ?? ""} onChange={(e) => onUpdate({ targetRpe: num(e.target.value) })} />
                </Field>
                <Field label="Tempo" hint="ecc-pause-conc-rest">
                    <NativeInput value={ex.tempo ?? ""} onChange={(e) => onUpdate({ tempo: e.target.value || null })} placeholder="3-1-1-0" />
                </Field>
                <Field label="Superset group">
                    <NativeInput value={ex.groupKey ?? ""} onChange={(e) => onUpdate({ groupKey: e.target.value.toUpperCase().slice(0, 1) || null })} placeholder="A" />
                </Field>
            </div>

            <Field label="Warmup ramp (JSON)" hint='Array of {"pct":0.5,"reps":5} — % of working weight'>
                <NativeInput value={ex.warmupJson} onChange={(e) => onUpdate({ warmupJson: e.target.value })} placeholder='[{"pct":0.5,"reps":5},{"pct":0.7,"reps":3}]' className="font-mono text-xs" />
            </Field>

            <div className="flex flex-col gap-2 border-t border-secondary pt-3">
                <Checkbox label="Per-set mode (define each set individually)" isSelected={ex.perSetMode ?? false} onChange={(v) => onUpdate({ perSetMode: v })} />
                {ex.perSetMode && (
                    <div className="flex flex-col gap-2">
                        {(ex.sets ?? []).map((s, si) => (
                            <div key={si} className="flex flex-wrap items-end gap-2 rounded-lg bg-secondary p-2">
                                <div className="w-20">
                                    <Field label={`Set ${si + 1} reps`}>
                                        <NativeInput type="number" value={s.targetReps ?? ""} onChange={(e) => updateSet(si, { targetReps: num(e.target.value) })} />
                                    </Field>
                                </div>
                                <div className="w-24">
                                    <Field label={`Weight (${weightUnit(unitSystem)})`}>
                                        <NativeInput type="number" step="0.5" value={kgToInput(s.targetWeight, unitSystem)} onChange={(e) => updateSet(si, { targetWeight: inputToKg(e.target.value, unitSystem) })} />
                                    </Field>
                                </div>
                                <div className="w-20">
                                    <Field label="RPE">
                                        <NativeInput type="number" step="0.5" value={s.targetRpe ?? ""} onChange={(e) => updateSet(si, { targetRpe: num(e.target.value) })} />
                                    </Field>
                                </div>
                                <Checkbox label="AMRAP" isSelected={s.isAmrap ?? false} onChange={(v) => updateSet(si, { isAmrap: v })} />
                                <Checkbox label="Warmup" isSelected={s.isWarmup ?? false} onChange={(v) => updateSet(si, { isWarmup: v })} />
                                <ButtonUtility size="xs" color="tertiary" icon={Trash01} tooltip="Remove set" onClick={() => removeSet(si)} />
                            </div>
                        ))}
                        <Button size="sm" color="tertiary" iconLeading={Plus} onClick={addSet}>
                            Add set row
                        </Button>
                    </div>
                )}
            </div>
        </Card>
    );
}

