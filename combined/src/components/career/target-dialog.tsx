"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Edit01, Plus, X } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { TextInput, TextareaInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";

export type TargetDefaults = {
    title: string;
    targetRole: string | null;
    targetCompanyType: string | null;
    targetSalary: number | null;
    targetLocation: string | null;
    notesMarkdown: string | null;
    isPrimary: boolean;
};

export function TargetDialog({
    action,
    mode = "create",
    defaults,
}: {
    action: (formData: FormData) => void | Promise<void>;
    mode?: "create" | "edit";
    defaults?: TargetDefaults;
}) {
    const [open, setOpen] = useState(false);

    async function onSubmit(fd: FormData) {
        await action(fd);
        toast.success(mode === "edit" ? "Target updated" : "Target added");
        setOpen(false);
    }

    return (
        <>
            {mode === "edit" ? (
                <Button color="tertiary" size="sm" iconLeading={Edit01} onClick={() => setOpen(true)} aria-label="Edit target" />
            ) : (
                <Button color="primary" size="sm" iconLeading={Plus} onClick={() => setOpen(true)}>
                    Add target
                </Button>
            )}

            <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-lg">
                    <Dialog aria-label={mode === "edit" ? "Edit target" : "Add target"}>
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">{mode === "edit" ? "Edit target" : "Add career target"}</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setOpen(false)} aria-label="Close" />
                            </div>
                            <form action={onSubmit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
                                <TextInput name="title" label="Title" required defaultValue={defaults?.title ?? ""} placeholder="Dream: Senior FE at an AI startup" />
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <TextInput name="targetRole" label="Target role" defaultValue={defaults?.targetRole ?? ""} placeholder="Senior Frontend Engineer" />
                                    <TextInput name="targetCompanyType" label="Company type" defaultValue={defaults?.targetCompanyType ?? ""} placeholder="Seed–Series B AI startup" />
                                    <TextInput name="targetSalary" label="Target salary" type="number" inputMode="numeric" defaultValue={defaults?.targetSalary ?? ""} placeholder="180000" />
                                    <TextInput name="targetLocation" label="Target location" defaultValue={defaults?.targetLocation ?? ""} placeholder="SF / Remote" />
                                </div>
                                <TextareaInput name="notesMarkdown" label="Notes" rows={3} defaultValue={defaults?.notesMarkdown ?? ""} />
                                <label className="flex items-center gap-2 text-sm text-secondary">
                                    <input type="checkbox" name="isPrimary" defaultChecked={defaults?.isPrimary ?? false} className="size-4 rounded border-primary text-brand-solid accent-brand-solid" />
                                    Primary target
                                </label>
                                <div className="flex justify-end gap-2 pt-2">
                                    <Button color="secondary" onClick={() => setOpen(false)}>
                                        Cancel
                                    </Button>
                                    <SubmitButton color="primary">{mode === "edit" ? "Save" : "Add"}</SubmitButton>
                                </div>
                            </form>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </>
    );
}
