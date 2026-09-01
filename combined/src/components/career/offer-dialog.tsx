"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Edit01, Plus, X } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { FormFileUpload } from "@/components/application/file-upload/form-file-upload";
import { TextInput, TextareaInput, DateInput, SelectInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";
import { NEGOTIATION_KIND_LABELS, OFFER_STATUS_LABELS, toOptions } from "@/lib/jobs/enums";

export type OfferDefaults = {
    status: string;
    baseSalary: number | null;
    bonus: number | null;
    equityValue: number | null;
    equityDescription: string | null;
    signOnBonus: number | null;
    ptoDays: number | null;
    currency: string | null;
    benefits: string | null;
    location: string | null;
    remote: boolean | null;
    startDate: string;
    decisionDeadline: string;
    receivedAt: string;
    notesMarkdown: string | null;
};

export function OfferDialog({
    action,
    mode = "create",
    defaults,
    defaultCurrency = "USD",
    triggerLabel = "Add offer",
}: {
    action: (formData: FormData) => void | Promise<void>;
    mode?: "create" | "edit";
    defaults?: OfferDefaults;
    defaultCurrency?: string;
    triggerLabel?: string;
}) {
    const [open, setOpen] = useState(false);

    async function onSubmit(fd: FormData) {
        await action(fd);
        toast.success(mode === "edit" ? "Offer updated" : "Offer added");
        setOpen(false);
    }

    return (
        <>
            {mode === "edit" ? (
                <Button color="tertiary" size="sm" iconLeading={Edit01} onClick={() => setOpen(true)} aria-label="Edit offer" />
            ) : (
                <Button color="secondary" size="sm" iconLeading={Plus} onClick={() => setOpen(true)}>
                    {triggerLabel}
                </Button>
            )}

            <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-lg">
                    <Dialog aria-label={mode === "edit" ? "Edit offer" : "Add offer"}>
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">{mode === "edit" ? "Edit offer" : "Add offer"}</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setOpen(false)} aria-label="Close" />
                            </div>

                            <form action={onSubmit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <SelectInput name="status" label="Status" defaultValue={defaults?.status ?? "RECEIVED"} options={toOptions(OFFER_STATUS_LABELS)} />
                                    <TextInput name="currency" label="Currency" defaultValue={defaults?.currency ?? defaultCurrency} />
                                    <TextInput name="baseSalary" label="Base salary" type="number" inputMode="numeric" defaultValue={defaults?.baseSalary ?? ""} placeholder="150000" />
                                    <TextInput name="bonus" label="Target bonus" type="number" inputMode="numeric" defaultValue={defaults?.bonus ?? ""} placeholder="20000" />
                                    <TextInput name="equityValue" label="Equity / yr (est.)" type="number" inputMode="numeric" defaultValue={defaults?.equityValue ?? ""} placeholder="40000" />
                                    <TextInput name="signOnBonus" label="Sign-on bonus" type="number" inputMode="numeric" defaultValue={defaults?.signOnBonus ?? ""} placeholder="10000" />
                                    <TextInput name="ptoDays" label="PTO (days)" type="number" inputMode="numeric" defaultValue={defaults?.ptoDays ?? ""} placeholder="20" />
                                    <TextInput name="location" label="Location" defaultValue={defaults?.location ?? ""} placeholder="San Francisco, CA" />
                                    <DateInput name="startDate" label="Start date" defaultValue={defaults?.startDate ?? ""} />
                                    <DateInput name="decisionDeadline" label="Decision deadline" defaultValue={defaults?.decisionDeadline ?? ""} />
                                    <DateInput name="receivedAt" label="Received on" defaultValue={defaults?.receivedAt ?? ""} />
                                </div>

                                <TextInput name="equityDescription" label="Equity detail" defaultValue={defaults?.equityDescription ?? ""} placeholder="e.g. 4-yr vest, 1-yr cliff, 5,000 RSUs" />
                                <TextareaInput name="benefits" label="Benefits & perks" rows={3} defaultValue={defaults?.benefits ?? ""} placeholder="Health, 401k match, remote stipend…" />

                                <label className="flex items-center gap-2 text-sm text-secondary">
                                    <input type="checkbox" name="remote" defaultChecked={defaults?.remote ?? false} className="size-4 rounded border-primary text-brand-solid accent-brand-solid" />
                                    Remote allowed
                                </label>

                                <TextareaInput name="notesMarkdown" label="Notes" rows={3} defaultValue={defaults?.notesMarkdown ?? ""} />

                                <div className="flex flex-col gap-1.5">
                                    <span className="text-sm font-medium text-secondary">Offer letter</span>
                                    <FormFileUpload name="letter" hint="Upload the offer letter (PDF/doc up to 25 MB)." />
                                </div>

                                <div className="flex justify-end gap-2 pt-2">
                                    <Button color="secondary" onClick={() => setOpen(false)}>
                                        Cancel
                                    </Button>
                                    <SubmitButton color="primary">{mode === "edit" ? "Save" : "Add offer"}</SubmitButton>
                                </div>
                            </form>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </>
    );
}

export function NegotiationDialog({ action }: { action: (formData: FormData) => void | Promise<void> }) {
    const [open, setOpen] = useState(false);

    async function onSubmit(fd: FormData) {
        await action(fd);
        toast.success("Negotiation step added");
        setOpen(false);
    }

    return (
        <>
            <Button color="tertiary" size="sm" iconLeading={Plus} onClick={() => setOpen(true)}>
                Add step
            </Button>
            <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-md">
                    <Dialog aria-label="Add negotiation step">
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">Add negotiation step</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setOpen(false)} aria-label="Close" />
                            </div>
                            <form action={onSubmit} className="flex flex-col gap-4 p-5">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <SelectInput name="kind" label="Step" defaultValue="COUNTER" options={toOptions(NEGOTIATION_KIND_LABELS)} />
                                    <DateInput name="date" label="Date" defaultValue="" />
                                    <TextInput name="baseSalary" label="Base" type="number" inputMode="numeric" placeholder="160000" />
                                    <TextInput name="bonus" label="Bonus" type="number" inputMode="numeric" />
                                    <TextInput name="equityValue" label="Equity / yr" type="number" inputMode="numeric" />
                                    <TextInput name="outcome" label="Outcome" placeholder="Accepted, pending…" />
                                </div>
                                <TextareaInput name="rationale" label="Rationale" rows={3} placeholder="Why you asked for this / what you said." />
                                <div className="flex justify-end gap-2 pt-2">
                                    <Button color="secondary" onClick={() => setOpen(false)}>
                                        Cancel
                                    </Button>
                                    <SubmitButton color="primary">Add step</SubmitButton>
                                </div>
                            </form>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </>
    );
}
