"use client";

import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { createBodyMeasurement } from "@/lib/actions/workouts-body";
import { toDateKey } from "@/lib/workouts";
import { type UnitSystem, heightUnit, parseHeightInput, parseWeightInput, weightUnit } from "@/lib/units";
import { Card, Field, NativeInput, NativeTextarea, SectionHeader } from "../../_components/workouts-ui";

// Girth fields are lengths (cm ↔ in); weight is kg ↔ lb. DB stores metric.
const GIRTH_FIELDS = ["chestCm", "waistCm", "neckCm", "hipCm", "armLCm", "armRCm", "legLCm", "legRCm"];

export const BodyMeasurementForm = ({ unitSystem }: { unitSystem: UnitSystem }) => {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const formRef = useRef<HTMLFormElement>(null);
    const wU = weightUnit(unitSystem);
    const lU = heightUnit(unitSystem);

    const onSubmit = (form: FormData) => {
        // Convert display-unit inputs back to metric before the action stores them.
        const wKg = parseWeightInput((form.get("weightKg") as string) ?? "", unitSystem);
        form.set("weightKg", wKg != null ? String(wKg) : "");
        for (const key of GIRTH_FIELDS) {
            const cm = parseHeightInput((form.get(key) as string) ?? "", unitSystem);
            form.set(key, cm != null ? String(cm) : "");
        }
        startTransition(async () => {
            try {
                await createBodyMeasurement(form);
                toast.success("Measurement logged");
                formRef.current?.reset();
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to log");
            }
        });
    };

    return (
        <Card>
            <SectionHeader title="Log measurement" />
            <form ref={formRef} action={onSubmit} className="mt-4 flex flex-col gap-3">
                <Field label="Date">
                    <FormDateInput name="date" variant="date" defaultValue={toDateKey(new Date())} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label={`Weight (${wU})`}>
                        <NativeInput name="weightKg" type="number" step="0.1" />
                    </Field>
                    <Field label="Body fat %">
                        <NativeInput name="bodyFatPct" type="number" step="0.1" />
                    </Field>
                    <Field label={`Chest (${lU})`}>
                        <NativeInput name="chestCm" type="number" step="0.1" />
                    </Field>
                    <Field label={`Waist (${lU})`}>
                        <NativeInput name="waistCm" type="number" step="0.1" />
                    </Field>
                    <Field label={`Neck (${lU})`}>
                        <NativeInput name="neckCm" type="number" step="0.1" />
                    </Field>
                    <Field label={`Hip (${lU})`}>
                        <NativeInput name="hipCm" type="number" step="0.1" />
                    </Field>
                    <Field label={`Arm L (${lU})`}>
                        <NativeInput name="armLCm" type="number" step="0.1" />
                    </Field>
                    <Field label={`Arm R (${lU})`}>
                        <NativeInput name="armRCm" type="number" step="0.1" />
                    </Field>
                    <Field label={`Leg L (${lU})`}>
                        <NativeInput name="legLCm" type="number" step="0.1" />
                    </Field>
                    <Field label={`Leg R (${lU})`}>
                        <NativeInput name="legRCm" type="number" step="0.1" />
                    </Field>
                </div>
                <Field label="Note">
                    <NativeTextarea name="note" />
                </Field>
                <Button color="primary" type="submit" isLoading={pending}>
                    Save measurement
                </Button>
            </form>
        </Card>
    );
};
