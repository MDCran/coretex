"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Edit01, Plus, X } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { TextInput, TextareaInput, DateInput, SelectInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";
import { INTERVIEW_FORMAT_LABELS, ROUND_OUTCOME_LABELS, toOptions } from "@/lib/jobs/enums";

export type RoundDefaults = {
    roundNumber: number;
    name: string | null;
    format: string;
    scheduledAt: string;
    durationMinutes: number | null;
    outcome: string;
    selfRating: number | null;
    interviewerNames: string[];
    notesMarkdown: string | null;
    thankYouSent: boolean;
};

export function InterviewRoundDialog({
    action,
    mode = "create",
    defaults,
    nextRoundNumber = 1,
    triggerLabel = "Add round",
}: {
    action: (formData: FormData) => void | Promise<void>;
    mode?: "create" | "edit";
    defaults?: RoundDefaults;
    nextRoundNumber?: number;
    triggerLabel?: string;
}) {
    const [open, setOpen] = useState(false);

    async function onSubmit(fd: FormData) {
        await action(fd);
        toast.success(mode === "edit" ? "Round updated" : "Round logged");
        setOpen(false);
    }

    return (
        <>
            {mode === "edit" ? (
                <Button color="tertiary" size="sm" iconLeading={Edit01} onClick={() => setOpen(true)} aria-label="Edit round" />
            ) : (
                <Button color="secondary" size="sm" iconLeading={Plus} onClick={() => setOpen(true)}>
                    {triggerLabel}
                </Button>
            )}

            <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-lg">
                    <Dialog aria-label={mode === "edit" ? "Edit round" : "Add interview round"}>
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">{mode === "edit" ? "Edit round" : "Add interview round"}</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setOpen(false)} aria-label="Close" />
                            </div>

                            <form action={onSubmit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <TextInput name="roundNumber" label="Round #" type="number" inputMode="numeric" defaultValue={defaults?.roundNumber ?? nextRoundNumber} />
                                    <TextInput name="name" label="Name" defaultValue={defaults?.name ?? ""} placeholder="Recruiter screen, Final…" />
                                    <SelectInput name="format" label="Format" defaultValue={defaults?.format ?? "VIDEO"} options={toOptions(INTERVIEW_FORMAT_LABELS)} />
                                    <SelectInput name="outcome" label="Outcome" defaultValue={defaults?.outcome ?? "PENDING"} options={toOptions(ROUND_OUTCOME_LABELS)} />
                                    <DateInput name="scheduledAt" label="Date & time" variant="datetime" defaultValue={defaults?.scheduledAt ?? ""} />
                                    <TextInput name="durationMinutes" label="Duration (min)" type="number" inputMode="numeric" defaultValue={defaults?.durationMinutes ?? ""} />
                                    <SelectInput
                                        name="selfRating"
                                        label="Self-rating"
                                        placeholder="—"
                                        defaultValue={defaults?.selfRating ? String(defaults.selfRating) : ""}
                                        options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} / 5` }))}
                                    />
                                    <TextInput name="interviewerNames" label="Interviewers" defaultValue={defaults?.interviewerNames.join(", ") ?? ""} placeholder="Comma-separated" />
                                </div>

                                <TextareaInput name="notesMarkdown" label="Private notes — what went well / poorly" rows={4} defaultValue={defaults?.notesMarkdown ?? ""} />

                                <label className="flex items-center gap-2 text-sm text-secondary">
                                    <input type="checkbox" name="thankYouSent" defaultChecked={defaults?.thankYouSent ?? false} className="size-4 rounded border-primary text-brand-solid accent-brand-solid" />
                                    Thank-you email sent
                                </label>

                                <div className="flex justify-end gap-2 pt-2">
                                    <Button color="secondary" onClick={() => setOpen(false)}>
                                        Cancel
                                    </Button>
                                    <SubmitButton color="primary">{mode === "edit" ? "Save" : "Add round"}</SubmitButton>
                                </div>
                            </form>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </>
    );
}
