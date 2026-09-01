// @ts-nocheck
const useRouter = () => ({ push: () => {}, replace: () => {} }); const useSearchParams = () => ({ get: () => null });




import { toast } from "sonner";
import { ModalOverlay, Modal, Dialog, Checkbox, Button } from "react-aria-components";
import { useTransition, useState } from "react";
import { X, Trophy01 } from "@untitledui/icons";
import { UnitSystem } from "@/lib/units";
import { InputNumber } from "@/components/base/input/input-number";
import { ControlledDateInput } from "@/components/base/input/form-date-input";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { BadgeWithIcon } from "@/components/base/badges/badges";
import { Field, NativeTextarea } from "../../_components/workouts-ui";

export type AttemptExercise = {
    id: string;
    name: string;
    slug: string;
    tracksReps: boolean;
    tracksWeight: boolean;
    tracksTime: boolean;
    tracksDistance: boolean;
};

function firePrConfetti() {
    const opts: confetti.Options = { particleCount: 80, spread: 70, origin: { y: 0.65 } };
    confetti(opts);
    setTimeout(() => confetti({ ...opts, particleCount: 40, angle: 60, origin: { x: 0 } }), 100);
    setTimeout(() => confetti({ ...opts, particleCount: 40, angle: 120, origin: { x: 1 } }), 100);
}

export function LogExerciseAttemptModal({
    exercise,
    unitSystem,
    currentPrs,
    onClose,
}: {
    exercise: AttemptExercise;
    unitSystem: UnitSystem;
    currentPrs?: CurrentPRs;
    onClose: () => void;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [dateKey, setDateKey] = useState(toDateKey(new Date()));
    const [reps, setReps] = useState<number | null>(null);
    const [weight, setWeight] = useState<number | null>(null);
    const [seconds, setSeconds] = useState<number | null>(null);
    const [meters, setMeters] = useState<number | null>(null);
    const [rpe, setRpe] = useState<number | null>(null);
    const [isWarmup, setIsWarmup] = useState(false);
    const [note, setNote] = useState("");

    const wU = weightUnit(unitSystem);
    const weightDisplay = weight == null ? null : weightToDisplay(weight, unitSystem);
    const setWeightFromDisplay = (v: number | null) => setWeight(v == null ? null : parseWeightInput(String(v), unitSystem));

    const submit = () => {
        const hasValue =
            (exercise.tracksReps && reps != null) ||
            (exercise.tracksWeight && weight != null) ||
            (exercise.tracksTime && seconds != null) ||
            (exercise.tracksDistance && meters != null);
        if (!hasValue) {
            toast.error("Enter at least one measurement");
            return;
        }

        startTransition(async () => {
            try {
                const result = await logExerciseAttempt({
                    exerciseId: exercise.id,
                    dateKey,
                    actualReps: exercise.tracksReps ? reps : null,
                    actualWeight: exercise.tracksWeight ? weight : null,
                    actualSeconds: exercise.tracksTime ? seconds : null,
                    actualMeters: exercise.tracksDistance ? meters : null,
                    rpe,
                    isWarmup,
                    note: note.trim() || null,
                });
                if (result.isPr) {
                    firePrConfetti();
                    toast.success(`New PR logged for ${exercise.name}!`, {
                        description: result.prTypes.length ? result.prTypes.map((t) => t.toUpperCase()).join(" · ") : undefined,
                    });
                } else {
                    toast.success("Attempt logged");
                }
                router.refresh();
                onClose();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to log attempt");
            }
        });
    };

    return (
        <ModalOverlay isOpen onOpenChange={(v) => !v && onClose()}>
            <Modal className="max-w-md">
                <Dialog aria-label={`Log attempt — ${exercise.name}`}>
                    <div className="flex w-full flex-col overflow-hidden rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                        <div className="flex items-start justify-between gap-3 border-b border-secondary px-5 py-4">
                            <div>
                                <h2 className="text-lg font-semibold text-primary">Log attempt</h2>
                                <p className="text-sm text-tertiary">{exercise.name}</p>
                                <p className="mt-1 text-xs text-quaternary">Saved as a standalone attempt — not a full workout session.</p>
                            </div>
                            <ButtonUtility size="sm" color="tertiary" icon={X} tooltip="Close" onClick={onClose} />
                        </div>

                        <div className="flex flex-col gap-4 p-5">
                            {currentPrs && (currentPrs.oneRm > 0 || currentPrs.reps > 0 || currentPrs.time > 0) && (
                                <div className="flex flex-wrap gap-2 rounded-lg bg-secondary_subtle px-3 py-2">
                                    <span className="text-xs font-medium text-tertiary">Current bests:</span>
                                    {currentPrs.oneRm > 0 && (
                                        <BadgeWithIcon iconLeading={Trophy01} color="warning" size="sm">
                                            1RM {weightToDisplay(currentPrs.oneRm, unitSystem)} {wU}
                                        </BadgeWithIcon>
                                    )}
                                    {currentPrs.reps > 0 && (
                                        <BadgeWithIcon iconLeading={Trophy01} color="warning" size="sm">
                                            {currentPrs.reps} reps
                                        </BadgeWithIcon>
                                    )}
                                    {currentPrs.time > 0 && (
                                        <BadgeWithIcon iconLeading={Trophy01} color="warning" size="sm">
                                            {currentPrs.time}s
                                        </BadgeWithIcon>
                                    )}
                                </div>
                            )}

                            <Field label="Date">
                                <ControlledDateInput variant="date" value={dateKey} onChange={(v) => setDateKey(v)} />
                            </Field>

                            <div className="grid grid-cols-2 gap-3">
                                {exercise.tracksWeight && (
                                    <InputNumber
                                        label={`Weight (${wU})`}
                                        value={weightDisplay ?? undefined}
                                        onChange={(v) => setWeightFromDisplay(v)}
                                        minValue={0}
                                        step={unitSystem === "IMPERIAL" ? 2.5 : 1}
                                    />
                                )}
                                {exercise.tracksReps && (
                                    <InputNumber label="Reps" value={reps ?? undefined} onChange={setReps} minValue={0} step={1} />
                                )}
                                {exercise.tracksTime && (
                                    <InputNumber label="Time (sec)" value={seconds ?? undefined} onChange={setSeconds} minValue={0} step={5} />
                                )}
                                {exercise.tracksDistance && (
                                    <InputNumber label="Distance (m)" value={meters ?? undefined} onChange={setMeters} minValue={0} step={10} />
                                )}
                                <InputNumber label="RPE" value={rpe ?? undefined} onChange={setRpe} minValue={1} maxValue={10} step={0.5} />
                            </div>

                            <Checkbox label="Warmup set" isSelected={isWarmup} onChange={setIsWarmup} />

                            <Field label="Note">
                                <NativeTextarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional notes…" rows={2} />
                            </Field>
                        </div>

                        <div className="flex justify-end gap-2 border-t border-secondary px-5 py-3">
                            <Button color="secondary" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button color="primary" isLoading={pending} onClick={submit}>
                                Log attempt
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
