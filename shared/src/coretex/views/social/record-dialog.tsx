// @ts-nocheck

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Plus, X, Edit01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import type { Props as ButtonProps } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { SubmitButton } from "@/components/jobs/submit-button";

/**
 * Generic record dialog. Renders a trigger button; on submit it runs the
 * server action, toasts, and closes. Children are the form fields (with `name`s).
 *
 * Supports two visual variants of the trigger:
 *  - `add` (default): a primary/secondary "+ {triggerLabel}" button (the original behavior).
 *  - `edit`: a compact tertiary pencil icon button used to reopen the same form
 *    pre-filled with an existing record's values (the field children supply
 *    `defaultValue`s, and a hidden `id` is posted to the matching `update*` action).
 *
 * For the edit variant pass a hidden `<input name="id" value={...} />` as part of
 * `children` so the update action can identify the row.
 */
export function RecordDialog({
    title,
    triggerLabel,
    action,
    children,
    triggerColor = "secondary",
    triggerSize = "sm",
    successMessage = "Saved",
    submitLabel = "Save",
    triggerProps,
    variant = "add",
}: {
    title: string;
    triggerLabel?: string;
    action: (formData: FormData) => void | Promise<void>;
    children: ReactNode;
    triggerColor?: ButtonProps["color"];
    triggerSize?: ButtonProps["size"];
    successMessage?: string;
    submitLabel?: string;
    triggerProps?: Partial<ButtonProps>;
    variant?: "add" | "edit";
}) {
    const [open, setOpen] = useState(false);

    async function onSubmit(fd: FormData) {
        try {
            await action(fd);
            toast.success(successMessage);
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    const trigger =
        variant === "edit" ? (
            <Button
                color="tertiary"
                size={triggerSize}
                iconLeading={<Edit01 data-icon className="size-4" />}
                onClick={() => setOpen(true)}
                aria-label={triggerLabel ?? "Edit"}
                {...triggerProps}
            />
        ) : (
            <Button color={triggerColor} size={triggerSize} iconLeading={Plus} onClick={() => setOpen(true)} {...triggerProps}>
                {triggerLabel}
            </Button>
        );

    return (
        <>
            {trigger}

            <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-lg">
                    <Dialog aria-label={title}>
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">{title}</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setOpen(false)} aria-label="Close" />
                            </div>
                            <form action={onSubmit} className="flex flex-col gap-4 p-5">
                                {children}
                                <div className="flex justify-end gap-2 pt-1">
                                    <Button color="secondary" onClick={() => setOpen(false)}>
                                        Cancel
                                    </Button>
                                    <SubmitButton color="primary">{submitLabel}</SubmitButton>
                                </div>
                            </form>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </>
    );
}

/** Small inline delete form posting `id` to a server action (no confirm modal). */
export function InlineDelete({ action, id, label = "Delete" }: { action: (formData: FormData) => void | Promise<void>; id: string; label?: string }) {
    return (
        <form action={action}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" color="tertiary-destructive" size="sm" aria-label={label}>
                {label}
            </Button>
        </form>
    );
}
