"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { SelectInput, TextareaInput, DateInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";
import { CONTACT_METHOD_LABELS, toOptions } from "@/lib/jobs/enums";
import { toDateInput } from "@/lib/jobs/format";

export function InteractionDialog({ action }: { action: (formData: FormData) => void | Promise<void> }) {
    const [open, setOpen] = useState(false);

    async function onSubmit(fd: FormData) {
        await action(fd);
        toast.success("Interaction logged");
        setOpen(false);
    }

    return (
        <>
            <Button color="secondary" size="sm" iconLeading={Plus} onClick={() => setOpen(true)}>
                Log interaction
            </Button>

            <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-md">
                    <Dialog aria-label="Log interaction">
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">Log interaction</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setOpen(false)} aria-label="Close" />
                            </div>
                            <form action={onSubmit} className="flex flex-col gap-4 p-5">
                                <div className="grid grid-cols-2 gap-4">
                                    <DateInput name="date" label="Date" defaultValue={toDateInput(new Date())} />
                                    <SelectInput name="channel" label="Channel" placeholder="—" options={toOptions(CONTACT_METHOD_LABELS)} />
                                </div>
                                <TextareaInput name="note" label="Note" rows={3} placeholder="What was discussed?" />
                                <div className="flex justify-end gap-2">
                                    <Button color="secondary" onClick={() => setOpen(false)}>
                                        Cancel
                                    </Button>
                                    <SubmitButton color="primary">Log</SubmitButton>
                                </div>
                            </form>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </>
    );
}
