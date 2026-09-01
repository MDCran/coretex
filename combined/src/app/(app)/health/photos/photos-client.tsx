"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, Camera01, Plus, Trash02, X } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Select } from "@/components/base/select/select";
import type { BadgeColors } from "@/components/base/badges/badge-types";
import { Card, Field, NativeInput, NativeTextarea, SectionHeader } from "../_components/health-ui";
import { HealthEmptyState } from "../_components/empty-state";
import { FormModal } from "../_components/form-modal";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { FormFileUpload } from "@/components/application/file-upload/form-file-upload";
import { createProgressPhoto, deleteProgressPhoto } from "@/lib/actions/health-photos";
import { type UnitSystem, parseWeightInput, weightToDisplay, weightUnit } from "@/lib/units";
import type { WorkoutOption } from "@/lib/workouts-history";

type LinkedWorkout = { id: string; name: string; date: string };

export interface PhotoRow {
    id: string;
    url: string;
    angle: string | null;
    phase: string | null;
    weightKg: number | null;
    notes: string | null;
    takenAt: string;
    workout: LinkedWorkout | null;
}

const ANGLES = [
    { id: "", label: "—" },
    { id: "FRONT", label: "Front" },
    { id: "SIDE", label: "Side" },
    { id: "BACK", label: "Back" },
] as const;

const PHASES: { id: string; label: string; color: BadgeColors }[] = [
    { id: "", label: "—", color: "gray" },
    { id: "BULK", label: "Bulk", color: "orange" },
    { id: "CUT", label: "Cut", color: "sky" },
    { id: "MAINTAIN", label: "Maintain", color: "gray" },
];

function toLocalInput(iso: string) {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function phaseColor(phase: string | null): BadgeColors {
    return PHASES.find((p) => p.id === phase)?.color ?? "brand";
}

function phaseLabel(phase: string | null) {
    if (!phase) return null;
    return phase.charAt(0) + phase.slice(1).toLowerCase();
}

/** Title-case a stored all-caps angle value (e.g. "FRONT" → "Front") for badges. */
function angleLabel(angle: string | null) {
    if (!angle) return null;
    return angle.charAt(0) + angle.slice(1).toLowerCase();
}

export function PhotosClient({ photos, workoutOptions, unitSystem }: { photos: PhotoRow[]; workoutOptions: WorkoutOption[]; unitSystem: UnitSystem }) {
    const [open, setOpen] = useState(false);
    const [detail, setDetail] = useState<PhotoRow | null>(null);
    const [angle, setAngle] = useState("");
    const [phase, setPhase] = useState("");
    const [workoutId, setWorkoutId] = useState("");

    // group by date
    const groups = photos.reduce<Record<string, PhotoRow[]>>((acc, p) => {
        const key = p.takenAt.slice(0, 10);
        (acc[key] ??= []).push(p);
        return acc;
    }, {});
    const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    async function onSubmit(fd: FormData) {
        // Weight entered in display unit; store kg.
        const kg = parseWeightInput((fd.get("weightKg") as string) ?? "", unitSystem);
        fd.set("weightKg", kg != null ? String(kg) : "");
        try {
            await createProgressPhoto(fd);
            toast.success("Photo uploaded");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    async function onDelete(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteProgressPhoto(fd);
            toast.success("Deleted");
            setDetail(null);
        } catch {
            toast.error("Failed");
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader title="Progress photos" description="Track visual progress over time." action={<Button size="md" iconLeading={Plus} onClick={() => setOpen(true)}>Add photo</Button>} />

            {photos.length === 0 && (
                <Card className="p-0">
                    <HealthEmptyState
                        icon={Camera01}
                        title="See your progress in pictures"
                        description="Upload your first progress photo. Tag the angle, phase and weight, and watch the side-by-side changes add up."
                        actionLabel="Add photo"
                        onAction={() => setOpen(true)}
                    />
                </Card>
            )}

            {dates.map((date) => (
                <div key={date} className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-secondary">{new Date(date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {groups[date].map((p) => (
                            <button key={p.id} type="button" onClick={() => setDetail(p)} className="group relative aspect-3/4 overflow-hidden rounded-xl ring-1 ring-secondary ring-inset">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={p.url} alt={p.angle ?? "Progress photo"} className="size-full object-cover transition duration-100 ease-linear group-hover:scale-105" />
                                {p.angle && <span className="absolute left-2 top-2"><Badge color="gray" size="sm">{angleLabel(p.angle)}</Badge></span>}
                                {p.workout && (
                                    <span className="absolute inset-x-2 bottom-2 flex items-center gap-1 truncate rounded-md bg-brand-solid/90 px-2 py-1 text-xs font-medium text-white" title={`${p.workout.name} · ${p.workout.date}`}>
                                        <Activity className="size-3.5 shrink-0" aria-hidden="true" />
                                        <span className="truncate">{p.workout.name}</span>
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            ))}

            <FormModal
                isOpen={open}
                onOpenChange={(o) => {
                    setOpen(o);
                    if (!o) {
                        setAngle("");
                        setPhase("");
                        setWorkoutId("");
                    }
                }}
                title="Add progress photo"
            >
                <form action={onSubmit} className="flex flex-col gap-4">
                    <Field label="Photo" htmlFor="file">
                        <FormFileUpload
                            name="file"
                            accept="image/*"
                            hint="Click anywhere in the zone or drag a photo — PNG, JPG or GIF up to 25 MB."
                            className="w-full"
                        />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Angle">
                            <Select selectedKey={angle || null} onSelectionChange={(k) => setAngle(k ? String(k) : "")} items={[...ANGLES]} size="sm" aria-label="Angle">
                                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                            </Select>
                            <input type="hidden" name="angle" value={angle} />
                        </Field>
                        <Field label="Phase">
                            <Select selectedKey={phase || null} onSelectionChange={(k) => setPhase(k ? String(k) : "")} items={PHASES} size="sm" aria-label="Phase">
                                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                            </Select>
                            <input type="hidden" name="phase" value={phase} />
                            {phase && (
                                <div className="mt-2">
                                    <Badge color={phaseColor(phase)} size="sm">{phaseLabel(phase)}</Badge>
                                </div>
                            )}
                        </Field>
                        <Field label={`Weight (${weightUnit(unitSystem)})`} htmlFor="weightKg">
                            <NativeInput id="weightKg" name="weightKg" type="number" step="any" placeholder={`e.g. ${unitSystem === "IMPERIAL" ? "180" : "82"}`} />
                        </Field>
                        <FormDateInput name="takenAt" label="Date & time taken" variant="datetime" defaultValue={toLocalInput(new Date().toISOString())} />
                    </div>
                    <Field label="Link to workout">
                        <Select
                            selectedKey={workoutId || null}
                            onSelectionChange={(k) => setWorkoutId(k ? String(k) : "")}
                            items={[{ id: "", label: "— None —" }, ...workoutOptions.map((w) => ({ id: w.id, label: w.label }))]}
                            size="sm"
                            aria-label="Link to workout"
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                        <input type="hidden" name="workoutId" value={workoutId} />
                    </Field>
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit">Upload</Button>
                    </div>
                </form>
            </FormModal>

            {/* Detail view */}
            <ModalOverlay isDismissable isOpen={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
                <Modal className="max-w-2xl">
                    <Dialog aria-label="Progress photo detail">
                        {detail && (
                            <div className="w-full overflow-hidden rounded-2xl bg-primary ring-1 ring-secondary ring-inset">
                                <div className="flex items-center justify-between border-b border-secondary px-5 py-3">
                                    <p className="text-sm font-semibold text-primary">{new Date(detail.takenAt).toLocaleString()}</p>
                                    <button type="button" aria-label="Close" onClick={() => setDetail(null)} className="rounded-md p-1.5 text-fg-quaternary hover:bg-primary_hover">
                                        <X className="size-5" />
                                    </button>
                                </div>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={detail.url} alt={detail.angle ?? "Progress photo"} className="max-h-[60vh] w-full object-contain bg-secondary" />
                                <div className="flex items-center justify-between gap-3 px-5 py-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        {detail.angle && <Badge color="gray" size="sm">{angleLabel(detail.angle)}</Badge>}
                                        {detail.phase && <Badge color={phaseColor(detail.phase)} size="sm">{phaseLabel(detail.phase)}</Badge>}
                                        {detail.weightKg != null && <span className="text-sm text-tertiary">{weightToDisplay(detail.weightKg, unitSystem)} {weightUnit(unitSystem)}</span>}
                                        {detail.workout && (
                                            <Link href={`/workouts/session/${detail.workout.id}`} className="inline-flex items-center gap-1 rounded-md bg-brand-secondary px-2 py-1 text-xs font-medium text-brand-secondary transition hover:opacity-80" title={detail.workout.date}>
                                                <Activity className="size-3.5" aria-hidden="true" />
                                                {detail.workout.name}
                                            </Link>
                                        )}
                                        {detail.notes && <span className="text-sm text-tertiary">{detail.notes}</span>}
                                    </div>
                                    <Button size="sm" color="secondary-destructive" iconLeading={Trash02} onClick={() => onDelete(detail.id)}>
                                        Delete
                                    </Button>
                                </div>
                            </div>
                        )}
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </div>
    );
}
