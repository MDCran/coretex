"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle, Clock, Hash02, Route, Scale02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { createExercise, updateExercise } from "@/lib/actions/workouts-exercises";
import { cx } from "@/utils/cx";
import { Card, Field, NativeInput, NativeSelect, NativeTextarea, SectionHeader } from "../../_components/workouts-ui";
import { FormFileUpload } from "@/components/application/file-upload/form-file-upload";

type Tracks = { reps: boolean; weight: boolean; time: boolean; distance: boolean };

const MEASURES: Array<{ key: keyof Tracks; label: string; icon: typeof Hash02 }> = [
    { key: "reps", label: "Reps", icon: Hash02 },
    { key: "weight", label: "Weight", icon: Scale02 },
    { key: "time", label: "Time", icon: Clock },
    { key: "distance", label: "Distance", icon: Route },
];

const PRESETS: Array<{ id: string; label: string; hint: string; tracks: Tracks; category?: string }> = [
    { id: "bodyweight", label: "Bodyweight", hint: "Reps only", tracks: { reps: true, weight: false, time: false, distance: false }, category: "strength" },
    { id: "weighted", label: "Weighted lifts", hint: "Reps + weight", tracks: { reps: true, weight: true, time: false, distance: false }, category: "strength" },
    { id: "weighted_full", label: "Full gym set", hint: "Reps, weight, time", tracks: { reps: true, weight: true, time: true, distance: false }, category: "strength" },
    { id: "running", label: "Running", hint: "Time + distance", tracks: { reps: false, weight: false, time: true, distance: true }, category: "cardio" },
    { id: "biking", label: "Biking", hint: "Time + distance", tracks: { reps: false, weight: false, time: true, distance: true }, category: "cardio" },
    { id: "timed", label: "Timed hold", hint: "Time only", tracks: { reps: false, weight: false, time: true, distance: false }, category: "mobility" },
];

function tracksEqual(a: Tracks, b: Tracks): boolean {
    return a.reps === b.reps && a.weight === b.weight && a.time === b.time && a.distance === b.distance;
}

export type ExerciseFormValues = {
    id?: string;
    name: string;
    muscles: string;
    secondaryMuscles: string;
    equipment: string;
    instructions: string;
    notes: string;
    mediaUrl: string;
    category: string;
    force: string;
    level: string;
    mechanic: string;
    parentId: string;
    tracksReps: boolean;
    tracksWeight: boolean;
    tracksTime: boolean;
    tracksDistance: boolean;
};

export const ExerciseForm = ({ initial, parents }: { initial?: ExerciseFormValues; parents: { id: string; name: string }[] }) => {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [tracks, setTracks] = useState({
        reps: initial?.tracksReps ?? true,
        weight: initial?.tracksWeight ?? true,
        time: initial?.tracksTime ?? false,
        distance: initial?.tracksDistance ?? false,
    });

    const onSubmit = (form: FormData) => {
        form.set("tracksReps", tracks.reps ? "on" : "");
        form.set("tracksWeight", tracks.weight ? "on" : "");
        form.set("tracksTime", tracks.time ? "on" : "");
        form.set("tracksDistance", tracks.distance ? "on" : "");
        startTransition(async () => {
            try {
                if (initial?.id) {
                    await updateExercise(initial.id, form);
                    toast.success("Exercise updated");
                } else {
                    const slug = await createExercise(form);
                    toast.success("Exercise created");
                    router.push(`/workouts/exercises/${slug}`);
                    return;
                }
                router.push("/workouts/exercises");
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to save");
            }
        });
    };

    return (
        <form action={onSubmit} className="flex flex-col gap-5">
            <Card className="flex flex-col gap-4">
                <SectionHeader title="Basics" description="Name your exercise and tag the muscles and equipment it uses." />
                <Field label="Name">
                    <NativeInput name="name" required defaultValue={initial?.name} placeholder="Barbell Bench Press" />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Primary muscles" hint="Comma separated">
                        <NativeInput name="muscles" defaultValue={initial?.muscles} placeholder="chest, triceps" />
                    </Field>
                    <Field label="Secondary muscles" hint="Comma separated">
                        <NativeInput name="secondaryMuscles" defaultValue={initial?.secondaryMuscles} placeholder="shoulders" />
                    </Field>
                </div>
                <Field label="Equipment" hint="Comma separated">
                    <NativeInput name="equipment" defaultValue={initial?.equipment} placeholder="barbell, bench" />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Category">
                        <NativeInput name="category" defaultValue={initial?.category} placeholder="strength" />
                    </Field>
                    <Field label="Force">
                        <NativeSelect name="force" defaultValue={initial?.force ?? ""}>
                            <option value="">—</option>
                            <option value="PUSH">Push</option>
                            <option value="PULL">Pull</option>
                            <option value="STATIC">Static</option>
                        </NativeSelect>
                    </Field>
                    <Field label="Mechanic">
                        <NativeSelect name="mechanic" defaultValue={initial?.mechanic ?? ""}>
                            <option value="">—</option>
                            <option value="COMPOUND">Compound</option>
                            <option value="ISOLATION">Isolation</option>
                        </NativeSelect>
                    </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Level">
                        <NativeSelect name="level" defaultValue={initial?.level ?? ""}>
                            <option value="">—</option>
                            <option value="BEGINNER">Beginner</option>
                            <option value="INTERMEDIATE">Intermediate</option>
                            <option value="EXPERT">Expert</option>
                        </NativeSelect>
                    </Field>
                    <Field label="Variation of" hint="Parent exercise">
                        <NativeSelect name="parentId" defaultValue={initial?.parentId ?? ""}>
                            <option value="">—</option>
                            {parents.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                </div>
            </Card>

            <Card className="flex flex-col gap-4">
                <SectionHeader title="Measured by" description="Pick what you log for this exercise — only these inputs show during a session." />

                {/* Presets */}
                <div className="flex flex-wrap gap-2">
                    {PRESETS.map((p) => {
                        const active = tracksEqual(tracks, p.tracks);
                        return (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                    setTracks(p.tracks);
                                    const cat = document.querySelector<HTMLInputElement>('input[name="category"]');
                                    if (cat && p.category) cat.value = p.category;
                                }}
                                className={cx(
                                    "flex flex-col items-start rounded-lg px-3 py-2 text-left ring-1 ring-inset transition duration-100 ease-linear",
                                    active ? "bg-brand-primary_alt ring-brand" : "bg-primary ring-secondary hover:bg-secondary_hover",
                                )}
                            >
                                <span className="text-sm font-semibold text-primary">{p.label}</span>
                                <span className="text-xs text-tertiary">{p.hint}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Measure toggle chips */}
                <div className="flex flex-wrap gap-2">
                    {MEASURES.map((m) => {
                        const Icon = m.icon;
                        const on = tracks[m.key];
                        return (
                            <button
                                key={m.key}
                                type="button"
                                aria-pressed={on}
                                onClick={() => setTracks((t) => ({ ...t, [m.key]: !t[m.key] }))}
                                className={cx(
                                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition duration-100 ease-linear",
                                    on ? "bg-brand-solid text-white ring-transparent" : "bg-primary text-secondary ring-secondary hover:bg-secondary_hover",
                                )}
                            >
                                {on ? <CheckCircle className="size-4" aria-hidden="true" /> : <Icon className="size-4" aria-hidden="true" />}
                                {m.label}
                            </button>
                        );
                    })}
                </div>
            </Card>

            <Card className="flex flex-col gap-4">
                <SectionHeader title="Details & media" description="Optional form cues, notes and a reference image or video." />
                <Field label="Instructions">
                    <NativeTextarea name="instructions" defaultValue={initial?.instructions} placeholder="Step-by-step form cues…" />
                </Field>
                <Field label="Notes">
                    <NativeTextarea name="notes" defaultValue={initial?.notes} />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Media URL" hint="External image or video link">
                        <NativeInput name="mediaUrl" defaultValue={initial?.mediaUrl} placeholder="https://…" />
                    </Field>
                    <Field label="Upload media" hint="Image or video">
                        <FormFileUpload name="mediaFile" accept="image/*,video/*" hint="Image or video up to 25 MB." />
                    </Field>
                </div>
            </Card>

            <div className="flex flex-col-reverse gap-2 border-t border-secondary pt-5 sm:flex-row sm:justify-end">
                <Button color="secondary" onClick={() => router.back()} type="button">
                    Cancel
                </Button>
                <Button color="primary" type="submit" isLoading={pending}>
                    {initial?.id ? "Save changes" : "Create exercise"}
                </Button>
            </div>
        </form>
    );
};
