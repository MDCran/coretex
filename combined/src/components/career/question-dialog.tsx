"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Edit01, Plus, X } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { TextInput, TextareaInput, SelectInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";

const CATEGORIES = ["behavioral", "technical", "system-design", "culture", "logistics", "other"];

export type QuestionDefaults = {
    question: string;
    answer: string | null;
    category: string | null;
};

export function QuestionDialog({
    action,
    mode = "create",
    defaults,
    applicationId,
    companyId,
    triggerLabel = "Add question",
}: {
    action: (formData: FormData) => void | Promise<void>;
    mode?: "create" | "edit";
    defaults?: QuestionDefaults;
    applicationId?: string;
    companyId?: string;
    triggerLabel?: string;
}) {
    const [open, setOpen] = useState(false);

    async function onSubmit(fd: FormData) {
        await action(fd);
        toast.success(mode === "edit" ? "Question updated" : "Question saved");
        setOpen(false);
    }

    return (
        <>
            {mode === "edit" ? (
                <Button color="tertiary" size="sm" iconLeading={Edit01} onClick={() => setOpen(true)} aria-label="Edit question" />
            ) : (
                <Button color="secondary" size="sm" iconLeading={Plus} onClick={() => setOpen(true)}>
                    {triggerLabel}
                </Button>
            )}

            <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-lg">
                    <Dialog aria-label={mode === "edit" ? "Edit question" : "Add question"}>
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">{mode === "edit" ? "Edit question" : "Add question"}</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setOpen(false)} aria-label="Close" />
                            </div>

                            <form action={onSubmit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
                                {applicationId && <input type="hidden" name="applicationId" value={applicationId} />}
                                {companyId && <input type="hidden" name="companyId" value={companyId} />}
                                <TextareaInput name="question" label="Question" rows={2} required defaultValue={defaults?.question ?? ""} placeholder="Tell me about a time you…" />
                                <TextareaInput name="answer" label="Your answer / notes" rows={5} defaultValue={defaults?.answer ?? ""} placeholder="Store your best answer to reuse." />
                                <SelectInput name="category" label="Category" placeholder="—" defaultValue={defaults?.category ?? ""} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
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
