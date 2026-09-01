"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Camera01, Plus, X } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { uploadProgressPhoto } from "@/lib/actions/workouts-progress";
import { type UnitSystem, parseWeightInput, weightUnit } from "@/lib/units";
import { Field, NativeInput, NativeSelect, NativeTextarea } from "../../../_components/workouts-ui";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { FormFileUpload } from "@/components/application/file-upload/form-file-upload";

export type LinkedPhoto = { id: string; url: string; takenAt: string; angle: string | null };

/**
 * Strip of progress photos linked to this workout. "Add photo" opens a small
 * inline upload modal with this workout pre-linked (reusing the progress upload
 * action) and also offers the full progress page as a deep link. Photos appear in
 * both this strip and /workouts/progress.
 */
export function LinkedPhotosStrip({ workoutId, photos, unitSystem }: { workoutId: string; photos: LinkedPhoto[]; unitSystem: UnitSystem }) {
    const [open, setOpen] = useState(false);
    const deepLink = `/workouts/progress?workout=${workoutId}`;

    return (
        <div className="mx-auto w-full max-w-3xl px-4 pb-8">
            <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-secondary">
                    <Camera01 className="size-4" aria-hidden="true" />
                    Progress photos
                </h2>
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-secondary transition hover:bg-secondary_hover"
                >
                    <Plus className="size-3.5" aria-hidden="true" />
                    Add photo
                </button>
            </div>
            {photos.length === 0 ? (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="mt-3 flex aspect-[4/1] w-full items-center justify-center rounded-xl border border-dashed border-secondary text-xs text-tertiary transition hover:border-brand hover:text-brand-secondary"
                >
                    Link a progress photo to this workout
                </button>
            ) : (
                <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                    {photos.map((p) => (
                        <Link
                            key={p.id}
                            href={deepLink}
                            className="relative aspect-[3/4] h-32 shrink-0 overflow-hidden rounded-lg ring-1 ring-secondary ring-inset"
                            title={new Date(p.takenAt).toLocaleDateString()}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.url} alt={p.angle ?? "Progress photo"} className="size-full object-cover" />
                        </Link>
                    ))}
                </div>
            )}

            {open && <InlineUploadDialog workoutId={workoutId} unitSystem={unitSystem} deepLink={deepLink} onClose={() => setOpen(false)} />}
        </div>
    );
}

function InlineUploadDialog({
    workoutId,
    unitSystem,
    deepLink,
    onClose,
}: {
    workoutId: string;
    unitSystem: UnitSystem;
    deepLink: string;
    onClose: () => void;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const formRef = useRef<HTMLFormElement>(null);

    const onSubmit = (form: FormData) => {
        // Workout is pre-linked; weight entered in the chosen unit → store kg.
        form.set("workoutId", workoutId);
        const kg = parseWeightInput((form.get("weightKg") as string) ?? "", unitSystem);
        form.set("weightKg", kg != null ? String(kg) : "");
        startTransition(async () => {
            try {
                await uploadProgressPhoto(form);
                toast.success("Photo linked to this workout");
                onClose();
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Upload failed");
            }
        });
    };

    return (
        <ModalOverlay isOpen onOpenChange={(v) => !v && onClose()}>
            <Modal className="max-w-md">
                <Dialog aria-label="Add progress photo to workout">
                    <div className="w-full rounded-2xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <h2 className="text-lg font-semibold text-primary">Add progress photo</h2>
                                <p className="mt-1 text-sm text-tertiary">Linked to this workout automatically.</p>
                            </div>
                            <ButtonUtility size="sm" color="tertiary" icon={X} tooltip="Close" onClick={onClose} />
                        </div>
                        <form ref={formRef} action={onSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="Photo" className="sm:col-span-2">
                                <FormFileUpload name="file" accept="image/*" hint="PNG, JPG or GIF up to 25 MB." />
                            </Field>
                            <Field label="Angle">
                                <NativeSelect name="angle" defaultValue="">
                                    <option value="">—</option>
                                    <option value="FRONT">Front</option>
                                    <option value="SIDE">Side</option>
                                    <option value="BACK">Back</option>
                                </NativeSelect>
                            </Field>
                            <Field label={`Weight (${weightUnit(unitSystem)})`}>
                                <NativeInput name="weightKg" type="number" step="0.1" />
                            </Field>
                            <Field label="Taken at">
                                <FormDateInput name="takenAt" variant="date" />
                            </Field>
                            <Field label="Notes" className="sm:col-span-2">
                                <NativeTextarea name="notes" className="min-h-10" />
                            </Field>
                            <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
                                <Link href={deepLink} className="text-xs font-medium text-brand-secondary hover:underline">
                                    Open full progress page
                                </Link>
                                <div className="flex gap-2">
                                    <Button color="secondary" type="button" onClick={onClose}>
                                        Cancel
                                    </Button>
                                    <Button color="primary" type="submit" isLoading={pending}>
                                        Upload
                                    </Button>
                                </div>
                            </div>
                        </form>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
