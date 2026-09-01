"use client";

import { useState } from "react";
import { Edit01, Plus, X } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { TextInput, TextareaInput, DateInput, SelectInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";
import { CONTACT_METHOD_LABELS, toOptions } from "@/lib/jobs/enums";

type Option = { id: string; name: string };

export type OutreachDefaults = {
    personName: string;
    channel: string | null;
    sentAt: string;
    responded: boolean;
    respondedAt: string;
    converted: boolean;
    notesMarkdown: string | null;
    contactId: string | null;
    companyId: string | null;
};

export function OutreachDialog({
    action,
    contacts,
    companies,
    mode = "create",
    defaults,
    triggerLabel = "Log outreach",
}: {
    action: (formData: FormData) => void | Promise<void>;
    contacts: Option[];
    companies: Option[];
    mode?: "create" | "edit";
    defaults?: OutreachDefaults;
    /** Label for the create trigger button. */
    triggerLabel?: string;
}) {
    const [open, setOpen] = useState(false);

    async function onSubmit(fd: FormData) {
        await action(fd);
        toast.success(mode === "edit" ? "Outreach updated" : "Outreach logged");
        setOpen(false);
    }

    return (
        <>
            {mode === "edit" ? (
                <Button color="tertiary" size="sm" iconLeading={Edit01} onClick={() => setOpen(true)} aria-label="Edit outreach" />
            ) : (
                <Button color="primary" size="sm" iconLeading={Plus} onClick={() => setOpen(true)}>
                    {triggerLabel}
                </Button>
            )}

            <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-lg">
                    <Dialog aria-label={mode === "edit" ? "Edit outreach" : "Log outreach"}>
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">{mode === "edit" ? "Edit outreach" : "Log outreach"}</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setOpen(false)} aria-label="Close" />
                            </div>
                            <form action={onSubmit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <TextInput name="personName" label="Person" required defaultValue={defaults?.personName ?? ""} placeholder="Name of who you contacted" />
                                    <SelectInput name="channel" label="Channel" placeholder="—" defaultValue={defaults?.channel ?? ""} options={toOptions(CONTACT_METHOD_LABELS)} />
                                    <DateInput name="sentAt" label="Sent on" defaultValue={defaults?.sentAt ?? ""} />
                                    <DateInput name="respondedAt" label="Responded on" defaultValue={defaults?.respondedAt ?? ""} />
                                    <SelectInput name="companyId" label="Company" placeholder="—" defaultValue={defaults?.companyId ?? ""} options={companies.map((c) => ({ value: c.id, label: c.name }))} />
                                    <SelectInput name="contactId" label="Linked contact" placeholder="—" defaultValue={defaults?.contactId ?? ""} options={contacts.map((c) => ({ value: c.id, label: c.name }))} />
                                </div>
                                <div className="flex flex-wrap gap-4">
                                    <label className="flex items-center gap-2 text-sm text-secondary">
                                        <input type="checkbox" name="responded" defaultChecked={defaults?.responded ?? false} className="size-4 rounded border-primary text-brand-solid accent-brand-solid" />
                                        Got a response
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-secondary">
                                        <input type="checkbox" name="converted" defaultChecked={defaults?.converted ?? false} className="size-4 rounded border-primary text-brand-solid accent-brand-solid" />
                                        Led to a conversation / referral
                                    </label>
                                </div>
                                <TextareaInput name="notesMarkdown" label="Notes" rows={3} defaultValue={defaults?.notesMarkdown ?? ""} placeholder="What you said, follow-up plan…" />
                                <div className="flex justify-end gap-2 pt-2">
                                    <Button color="secondary" onClick={() => setOpen(false)}>
                                        Cancel
                                    </Button>
                                    <SubmitButton color="primary">{mode === "edit" ? "Save" : "Log"}</SubmitButton>
                                </div>
                            </form>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </>
    );
}
