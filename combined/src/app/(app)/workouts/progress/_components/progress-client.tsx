"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Activity, Camera01, Edit01, Plus, Trash01, X } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { deleteProgressPhoto, updateProgressPhoto, uploadProgressPhoto } from "@/lib/actions/workouts-progress";
import { type UnitSystem, formatWeight, parseWeightInput, weightUnit } from "@/lib/units";
import type { WorkoutOption } from "@/lib/workouts-history";
import { Card, EmptyState, Field, NativeInput, NativeSelect, NativeTextarea, SectionHeader } from "../../_components/workouts-ui";
import { ControlledDateInput, FormDateInput } from "@/components/base/input/form-date-input";
import { FormFileUpload } from "@/components/application/file-upload/form-file-upload";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";

type LinkedWorkout = { id: string; name: string; date: string };

type Photo = {
    id: string;
    url: string;
    angle: string | null;
    phase: string | null;
    weightKg: number | null;
    closestWeightKg: number | null;
    takenAt: string;
    notes: string | null;
    workout: LinkedWorkout | null;
};

const ANGLES = ["FRONT", "SIDE", "BACK"] as const;
const PHASES = ["BULK", "CUT", "MAINTAIN"] as const;

function angleLabel(a: string | null) {
    if (!a) return null;
    return a.charAt(0) + a.slice(1).toLowerCase();
}
function phaseLabel(p: string | null) {
    if (!p) return null;
    return p.charAt(0) + p.slice(1).toLowerCase();
}

export const ProgressClient = ({
    photos,
    workoutOptions,
    defaultWorkoutId,
    unitSystem,
}: {
    photos: Photo[];
    workoutOptions: WorkoutOption[];
    defaultWorkoutId?: string | null;
    unitSystem: UnitSystem;
}) => {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    // Open the upload panel automatically when arriving from a session "Add photo" link.
    const [showUpload, setShowUpload] = useState(!!defaultWorkoutId);
    const formRef = useRef<HTMLFormElement>(null);
    const { confirm, dialog } = useConfirm();

    // Filters
    const [filterAngle, setFilterAngle] = useState("");
    const [filterPhase, setFilterPhase] = useState("");

    // Selected photo for full-view / edit modal
    const [viewId, setViewId] = useState<string | null>(null);
    const [editId, setEditId] = useState<string | null>(null);

    const viewPhoto = photos.find((p) => p.id === viewId) ?? null;
    const editPhoto = photos.find((p) => p.id === editId) ?? null;

    // Compare selector
    const [leftId, setLeftId] = useState(photos[photos.length - 1]?.id ?? "");
    const [rightId, setRightId] = useState(photos[0]?.id ?? "");

    const left = photos.find((p) => p.id === leftId);
    const right = photos.find((p) => p.id === rightId);

    const filtered = photos.filter((p) => {
        if (filterAngle && p.angle !== filterAngle) return false;
        if (filterPhase && p.phase !== filterPhase) return false;
        return true;
    });

    const onUpload = (form: FormData) => {
        // Weight entered in the chosen unit; store kg.
        const kg = parseWeightInput((form.get("weightKg") as string) ?? "", unitSystem);
        form.set("weightKg", kg != null ? String(kg) : "");
        startTransition(async () => {
            try {
                await uploadProgressPhoto(form);
                toast.success("Photo uploaded");
                formRef.current?.reset();
                setShowUpload(false);
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Upload failed");
            }
        });
    };

    const remove = (id: string) => {
        confirm({
            title: "Delete this photo?",
            destructive: true,
            confirmLabel: "Delete",
            onConfirm: () =>
                startTransition(async () => {
                    await deleteProgressPhoto(id);
                    toast.success("Deleted");
                    if (viewId === id) setViewId(null);
                    if (editId === id) setEditId(null);
                    router.refresh();
                }),
        });
    };

    const wU = weightUnit(unitSystem);

    /** Display weight for a photo: explicit > closest (with ~ prefix) > — */
    const photoWeight = (p: Photo): string | null => {
        if (p.weightKg != null) return formatWeight(p.weightKg, unitSystem);
        if (p.closestWeightKg != null) return `~${formatWeight(p.closestWeightKg, unitSystem)}`;
        return null;
    };

    return (
        <div className="flex flex-col gap-6">
            {/* Header actions */}
            <div className="flex justify-end">
                <Button size="md" color="primary" iconLeading={Plus} onClick={() => setShowUpload((s) => !s)}>
                    Upload photo
                </Button>
            </div>

            {showUpload && (
                <Card>
                    <SectionHeader title="Upload progress photo" />
                    <form ref={formRef} action={onUpload} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Photo" className="sm:col-span-2">
                            <FormFileUpload name="file" accept="image/*" hint="PNG, JPG or GIF up to 25 MB." />
                        </Field>
                        <Field label="Angle">
                            <NativeSelect name="angle" defaultValue="">
                                <option value="">—</option>
                                {ANGLES.map((a) => (
                                    <option key={a} value={a}>{angleLabel(a)}</option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Phase">
                            <NativeSelect name="phase" defaultValue="">
                                <option value="">—</option>
                                {PHASES.map((p) => (
                                    <option key={p} value={p}>{phaseLabel(p)}</option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label={`Weight (${wU})`}>
                            <NativeInput name="weightKg" type="number" step="0.1" />
                        </Field>
                        <Field label="Taken at">
                            <FormDateInput name="takenAt" variant="date" />
                        </Field>
                        <Field label="Link to workout" className="sm:col-span-2">
                            <NativeSelect name="workoutId" defaultValue={defaultWorkoutId ?? ""}>
                                <option value="">— None —</option>
                                {workoutOptions.map((w) => (
                                    <option key={w.id} value={w.id}>
                                        {w.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Notes" className="sm:col-span-2">
                            <NativeTextarea name="notes" className="min-h-10" />
                        </Field>
                        <div className="sm:col-span-2">
                            <Button color="primary" type="submit" isLoading={pending}>
                                Upload
                            </Button>
                        </div>
                    </form>
                </Card>
            )}

            {/* Compare */}
            {photos.length >= 2 && (
                <Card>
                    <SectionHeader title="Before / after compare" description="Drag the divider to compare two photos." />
                    <div className="mt-4 grid grid-cols-2 gap-3">
                        <Field label="Left (before)">
                            <NativeSelect value={leftId} onChange={(e) => setLeftId(e.target.value)}>
                                {photos.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {new Date(p.takenAt).toLocaleDateString()} {p.angle ? `· ${angleLabel(p.angle)}` : ""}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Right (after)">
                            <NativeSelect value={rightId} onChange={(e) => setRightId(e.target.value)}>
                                {photos.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {new Date(p.takenAt).toLocaleDateString()} {p.angle ? `· ${angleLabel(p.angle)}` : ""}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                    </div>
                    {left && right && <CompareSlider leftUrl={left.url} rightUrl={right.url} />}
                </Card>
            )}

            {/* Gallery */}
            <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <SectionHeader title="All photos" />
                    {/* Filters */}
                    <div className="flex flex-wrap gap-2">
                        <NativeSelect value={filterAngle} onChange={(e) => setFilterAngle(e.target.value)} className="w-32 text-sm py-1.5">
                            <option value="">All angles</option>
                            {ANGLES.map((a) => (
                                <option key={a} value={a}>{angleLabel(a)}</option>
                            ))}
                        </NativeSelect>
                        <NativeSelect value={filterPhase} onChange={(e) => setFilterPhase(e.target.value)} className="w-32 text-sm py-1.5">
                            <option value="">All phases</option>
                            {PHASES.map((p) => (
                                <option key={p} value={p}>{phaseLabel(p)}</option>
                            ))}
                        </NativeSelect>
                        {(filterAngle || filterPhase) && (
                            <button
                                type="button"
                                onClick={() => { setFilterAngle(""); setFilterPhase(""); }}
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-tertiary hover:text-secondary hover:bg-secondary_hover"
                            >
                                <X className="size-3" /> Clear
                            </button>
                        )}
                    </div>
                </div>
                {filtered.length === 0 ? (
                    photos.length === 0 ? (
                        <EmptyState
                            icon={Camera01}
                            title="Start your photo timeline"
                            description="Upload your first progress photo. We'll tag it with your nearest logged weight so you can track visible change over time."
                            action={
                                <Button size="md" color="primary" iconLeading={Plus} onClick={() => setShowUpload(true)}>
                                    Upload photo
                                </Button>
                            }
                        />
                    ) : (
                        <EmptyState
                            icon={Camera01}
                            color="gray"
                            theme="modern"
                            title="No photos match these filters"
                            description="Try clearing the angle or phase filters to see your full gallery."
                            action={
                                <Button size="md" color="secondary" iconLeading={X} onClick={() => { setFilterAngle(""); setFilterPhase(""); }}>
                                    Clear filters
                                </Button>
                            }
                        />
                    )
                ) : (
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {filtered.map((p) => {
                            const w = photoWeight(p);
                            const isApprox = p.weightKg == null && p.closestWeightKg != null;
                            return (
                                <div key={p.id} className="group relative overflow-hidden rounded-lg ring-1 ring-secondary">
                                    <button
                                        type="button"
                                        onClick={() => setViewId(p.id)}
                                        className="block w-full text-left"
                                        aria-label={`View photo from ${new Date(p.takenAt).toLocaleDateString()}`}
                                    >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={p.url} alt="Progress" className="aspect-[3/4] w-full object-cover" />
                                    </button>
                                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/55 px-2 py-1.5 text-xs text-white">
                                        <span>{new Date(p.takenAt).toLocaleDateString()}</span>
                                        {w && (
                                            <span className={isApprox ? "text-white/75" : undefined} title={isApprox ? "Nearest logged weight (within 3 days)" : undefined}>
                                                {w}
                                            </span>
                                        )}
                                    </div>
                                    <div className="absolute top-2 left-2 flex gap-1">
                                        {p.angle && (
                                            <Badge color="gray" size="sm" type="modern">
                                                {angleLabel(p.angle)}
                                            </Badge>
                                        )}
                                        {p.phase && (
                                            <Badge color="brand" size="sm">
                                                {phaseLabel(p.phase)}
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                                        <ButtonUtility size="xs" color="tertiary" icon={Edit01} tooltip="Edit" onClick={() => setEditId(p.id)} />
                                        <ButtonUtility size="xs" color="tertiary" icon={Trash01} tooltip="Delete" onClick={() => remove(p.id)} />
                                    </div>
                                    {p.workout && (
                                        <Link
                                            href={`/workouts/session/${p.workout.id}`}
                                            className="absolute inset-x-2 bottom-8 flex items-center gap-1 truncate rounded-md bg-brand-solid/90 px-2 py-1 text-xs font-medium text-white transition hover:bg-brand-solid"
                                            title={`${p.workout.name} · ${p.workout.date}`}
                                        >
                                            <Activity className="size-3.5 shrink-0" aria-hidden="true" />
                                            <span className="truncate">{p.workout.name}</span>
                                        </Link>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>

            {/* Full-view modal */}
            {viewPhoto && (
                <ModalOverlay isOpen onOpenChange={(v) => !v && setViewId(null)}>
                    <Modal className="max-w-2xl">
                        <Dialog aria-label="View photo">
                            <div className="relative w-full overflow-hidden rounded-2xl bg-primary shadow-2xl ring-1 ring-secondary">
                                <div className="flex items-center justify-between gap-2 border-b border-secondary px-5 py-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h2 className="text-lg font-semibold text-primary">
                                            {new Date(viewPhoto.takenAt).toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
                                        </h2>
                                        {viewPhoto.angle && <Badge color="gray" size="sm" type="modern">{angleLabel(viewPhoto.angle)}</Badge>}
                                        {viewPhoto.phase && <Badge color="brand" size="sm">{phaseLabel(viewPhoto.phase)}</Badge>}
                                        {(() => {
                                            const w = photoWeight(viewPhoto);
                                            const isApprox = viewPhoto.weightKg == null && viewPhoto.closestWeightKg != null;
                                            return w ? (
                                                <span className="text-sm font-medium text-secondary" title={isApprox ? "Nearest logged weight (within 3 days)" : undefined}>
                                                    {isApprox ? "~" : ""}{w}
                                                </span>
                                            ) : null;
                                        })()}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <ButtonUtility size="sm" color="tertiary" icon={Edit01} tooltip="Edit" onClick={() => { setEditId(viewPhoto.id); setViewId(null); }} />
                                        <ButtonUtility size="sm" color="tertiary" icon={Trash01} tooltip="Delete" onClick={() => remove(viewPhoto.id)} />
                                        <ButtonUtility size="sm" color="tertiary" icon={X} tooltip="Close" onClick={() => setViewId(null)} />
                                    </div>
                                </div>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={viewPhoto.url} alt="Progress" className="max-h-[70vh] w-full object-contain bg-black/10" />
                                {viewPhoto.notes && (
                                    <div className="border-t border-secondary px-5 py-3 text-sm text-secondary">{viewPhoto.notes}</div>
                                )}
                                {viewPhoto.workout && (
                                    <div className="border-t border-secondary px-5 py-3">
                                        <Link href={`/workouts/session/${viewPhoto.workout.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-secondary hover:underline">
                                            <Activity className="size-3.5" aria-hidden="true" />
                                            {viewPhoto.workout.name} · {viewPhoto.workout.date}
                                        </Link>
                                    </div>
                                )}
                            </div>
                        </Dialog>
                    </Modal>
                </ModalOverlay>
            )}

            {/* Edit modal */}
            {editPhoto && (
                <EditPhotoModal
                    photo={editPhoto}
                    unitSystem={unitSystem}
                    pending={pending}
                    onClose={() => setEditId(null)}
                    onSave={(data) =>
                        startTransition(async () => {
                            try {
                                await updateProgressPhoto(editPhoto.id, data);
                                toast.success("Photo updated");
                                setEditId(null);
                                router.refresh();
                            } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Failed to update");
                            }
                        })
                    }
                />
            )}

            {dialog}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Edit photo modal
// ─────────────────────────────────────────────────────────────────────────────

function EditPhotoModal({
    photo,
    unitSystem,
    pending,
    onClose,
    onSave,
}: {
    photo: Photo;
    unitSystem: UnitSystem;
    pending: boolean;
    onClose: () => void;
    onSave: (data: { angle: string | null; phase: string | null; notes: string | null; weightKg: number | null; takenAt: string | null }) => void;
}) {
    const wU = weightUnit(unitSystem);
    const [angle, setAngle] = useState(photo.angle ?? "");
    const [phase, setPhase] = useState(photo.phase ?? "");
    const [notes, setNotes] = useState(photo.notes ?? "");
    const [weight, setWeight] = useState(photo.weightKg != null ? String(photo.weightKg) : "");
    const [takenAt, setTakenAt] = useState(photo.takenAt.slice(0, 10));

    const save = () =>
        onSave({
            angle: angle || null,
            phase: phase || null,
            notes: notes.trim() || null,
            weightKg: weight ? Number(weight) : null,
            takenAt: takenAt || null,
        });

    return (
        <ModalOverlay isOpen onOpenChange={(v) => !v && onClose()}>
            <Modal className="max-w-md">
                <Dialog aria-label="Edit photo">
                    <div className="w-full rounded-2xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <div className="flex items-start justify-between gap-2">
                            <h2 className="text-lg font-semibold text-primary">Edit photo</h2>
                            <ButtonUtility size="sm" color="tertiary" icon={X} tooltip="Close" onClick={onClose} />
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="Angle">
                                <NativeSelect value={angle} onChange={(e) => setAngle(e.target.value)}>
                                    <option value="">—</option>
                                    {ANGLES.map((a) => (
                                        <option key={a} value={a}>{angleLabel(a)}</option>
                                    ))}
                                </NativeSelect>
                            </Field>
                            <Field label="Phase">
                                <NativeSelect value={phase} onChange={(e) => setPhase(e.target.value)}>
                                    <option value="">—</option>
                                    {PHASES.map((p) => (
                                        <option key={p} value={p}>{phaseLabel(p)}</option>
                                    ))}
                                </NativeSelect>
                            </Field>
                            <Field label={`Weight (${wU})`}>
                                <NativeInput type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} />
                            </Field>
                            <Field label="Taken at">
                                <ControlledDateInput variant="date" value={takenAt} onChange={(v) => setTakenAt(v)} />
                            </Field>
                            <Field label="Notes" className="sm:col-span-2">
                                <NativeTextarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-10" />
                            </Field>
                        </div>
                        <div className="mt-6 flex justify-end gap-2">
                            <Button color="secondary" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button color="primary" isLoading={pending} onClick={save}>
                                Save
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compare slider
// ─────────────────────────────────────────────────────────────────────────────

function CompareSlider({ leftUrl, rightUrl }: { leftUrl: string; rightUrl: string }) {
    const [pos, setPos] = useState(50);
    const [width, setWidth] = useState(0);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const update = () => setWidth(el.clientWidth);
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const onMove = (clientX: number) => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const pct = ((clientX - rect.left) / rect.width) * 100;
        setPos(Math.min(100, Math.max(0, pct)));
    };

    return (
        <div
            ref={ref}
            className="relative mt-4 aspect-[3/4] max-h-[560px] w-full max-w-md cursor-ew-resize overflow-hidden rounded-xl ring-1 ring-secondary select-none"
            onMouseMove={(e) => e.buttons === 1 && onMove(e.clientX)}
            onClick={(e) => onMove(e.clientX)}
            onTouchMove={(e) => onMove(e.touches[0].clientX)}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={rightUrl} alt="After" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
            <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pos}%` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={leftUrl} alt="Before" className="absolute inset-y-0 left-0 h-full max-w-none object-cover" style={{ width: width || "100%" }} draggable={false} />
            </div>
            <div className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.4)]" style={{ left: `${pos}%` }}>
                <div className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-xs font-bold text-black shadow-md">
                    ⇄
                </div>
            </div>
            <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">Before</span>
            <span className="absolute right-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">After</span>
        </div>
    );
}
