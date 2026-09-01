"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Edit01, Plus, X } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { FormFileUpload } from "@/components/application/file-upload/form-file-upload";
import { TextInput, TextareaInput, DateInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";

type ContactOption = { id: string; name: string; companyName: string | null };

export type MeetingDefaults = {
    type: string | null;
    durationMinutes: number | null;
    dateTime: string;
    location: string | null;
    notesMarkdown: string | null;
    participantIds: string[];
    participantNames: string[];
};

export function MeetingDialog({
    action,
    contacts,
    mode = "create",
    defaults,
}: {
    action: (formData: FormData) => void | Promise<void>;
    contacts: ContactOption[];
    mode?: "create" | "edit";
    defaults?: MeetingDefaults;
}) {
    const [open, setOpen] = useState(false);

    async function onSubmit(fd: FormData) {
        await action(fd);
        toast.success(mode === "edit" ? "Meeting updated" : "Meeting added");
        setOpen(false);
    }

    return (
        <>
            {mode === "edit" ? (
                <Button color="tertiary" size="sm" iconLeading={Edit01} onClick={() => setOpen(true)} aria-label="Edit meeting" />
            ) : (
                <Button color="secondary" size="sm" iconLeading={Plus} onClick={() => setOpen(true)}>
                    Add meeting
                </Button>
            )}

            <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-lg">
                    <Dialog aria-label={mode === "edit" ? "Edit meeting" : "Add meeting"}>
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">{mode === "edit" ? "Edit meeting" : "Add meeting"}</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setOpen(false)} aria-label="Close" />
                            </div>

                            <form action={onSubmit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <TextInput name="type" label="Type" defaultValue={defaults?.type ?? ""} placeholder="Phone screen, On-site…" />
                                    <TextInput name="durationMinutes" label="Duration (min)" type="number" inputMode="numeric" defaultValue={defaults?.durationMinutes ?? ""} />
                                    <DateInput name="dateTime" label="Date & time" variant="datetime" defaultValue={defaults?.dateTime ?? ""} />
                                    <TextInput name="location" label="Location" defaultValue={defaults?.location ?? ""} placeholder="Zoom, Office…" />
                                </div>

                                {contacts.length > 0 && (
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-sm font-medium text-secondary">Participants (contacts)</span>
                                        <div className="flex flex-col gap-2 rounded-lg bg-secondary p-3">
                                            {contacts.map((c) => (
                                                <label key={c.id} className="flex items-center gap-2 text-sm text-secondary">
                                                    <input
                                                        type="checkbox"
                                                        name="participantIds"
                                                        value={c.id}
                                                        defaultChecked={defaults?.participantIds.includes(c.id)}
                                                        className="size-4 rounded border-primary text-brand-solid"
                                                    />
                                                    {c.name}
                                                    {c.companyName && <span className="text-tertiary">· {c.companyName}</span>}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <TextInput
                                    name="participantNames"
                                    label="Other participants"
                                    defaultValue={defaults?.participantNames.join(", ") ?? ""}
                                    placeholder="Comma-separated names"
                                />

                                <TextareaInput name="notesMarkdown" label="Notes (Markdown)" rows={4} defaultValue={defaults?.notesMarkdown ?? ""} />

                                <div className="flex flex-col gap-1.5">
                                    <span className="text-sm font-medium text-secondary">Attachments</span>
                                    <FormFileUpload name="files" multiple hint="Up to 5 files · 25 MB each · 50 MB total." />
                                </div>

                                <div className="flex justify-end gap-2 pt-2">
                                    <Button color="secondary" onClick={() => setOpen(false)}>
                                        Cancel
                                    </Button>
                                    <SubmitButton color="primary">{mode === "edit" ? "Save" : "Add meeting"}</SubmitButton>
                                </div>
                            </form>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </>
    );
}
