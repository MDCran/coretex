"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Edit01, Plus, X } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { TextInput, TextareaInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";

export type StarDefaults = {
    title: string;
    situation: string | null;
    task: string | null;
    action: string | null;
    result: string | null;
    tags: string[];
};

export function StarDialog({
    action,
    mode = "create",
    defaults,
}: {
    action: (formData: FormData) => void | Promise<void>;
    mode?: "create" | "edit";
    defaults?: StarDefaults;
}) {
    const [open, setOpen] = useState(false);

    async function onSubmit(fd: FormData) {
        await action(fd);
        toast.success(mode === "edit" ? "Story updated" : "Story saved");
        setOpen(false);
    }

    return (
        <>
            {mode === "edit" ? (
                <Button color="tertiary" size="sm" iconLeading={Edit01} onClick={() => setOpen(true)} aria-label="Edit story" />
            ) : (
                <Button color="primary" size="sm" iconLeading={Plus} onClick={() => setOpen(true)}>
                    Add story
                </Button>
            )}

            <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-lg">
                    <Dialog aria-label={mode === "edit" ? "Edit STAR story" : "Add STAR story"}>
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">{mode === "edit" ? "Edit story" : "Add STAR story"}</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setOpen(false)} aria-label="Close" />
                            </div>
                            <form action={onSubmit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
                                <TextInput name="title" label="Title" required defaultValue={defaults?.title ?? ""} placeholder="Led migration under deadline" />
                                <TextareaInput name="situation" label="Situation" rows={2} defaultValue={defaults?.situation ?? ""} />
                                <TextareaInput name="task" label="Task" rows={2} defaultValue={defaults?.task ?? ""} />
                                <TextareaInput name="action" label="Action" rows={3} defaultValue={defaults?.action ?? ""} />
                                <TextareaInput name="result" label="Result" rows={2} defaultValue={defaults?.result ?? ""} />
                                <TextInput name="tags" label="Tags" defaultValue={defaults?.tags.join(", ") ?? ""} placeholder="leadership, conflict, ownership" hint="Comma-separated" />
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
