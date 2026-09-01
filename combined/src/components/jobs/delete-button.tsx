"use client";

import { useState } from "react";
import { Trash01, AlertTriangle } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";

/** Delete with a confirmation modal. Submits `id` to a server action. */
export function DeleteButton({
    action,
    id,
    label = "Delete",
    title = "Delete this item?",
    description = "This action cannot be undone.",
    iconOnly = false,
    revalidate,
}: {
    action: (formData: FormData) => void | Promise<void>;
    id: string;
    label?: string;
    title?: string;
    description?: string;
    iconOnly?: boolean;
    revalidate?: string;
}) {
    const [open, setOpen] = useState(false);

    return (
        <>
            {iconOnly ? (
                <Button color="tertiary-destructive" size="sm" iconLeading={Trash01} onClick={() => setOpen(true)} aria-label={label} />
            ) : (
                <Button color="secondary-destructive" size="sm" iconLeading={Trash01} onClick={() => setOpen(true)}>
                    {label}
                </Button>
            )}

            <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-md">
                    <Dialog aria-label={title}>
                        <div className="w-full rounded-2xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                            <FeaturedIcon icon={AlertTriangle} color="error" theme="light" size="lg" />
                            <h2 className="mt-4 text-lg font-semibold text-primary">{title}</h2>
                            <p className="mt-1 text-sm text-tertiary">{description}</p>
                            <div className="mt-6 flex justify-end gap-3">
                                <Button color="secondary" onClick={() => setOpen(false)}>
                                    Cancel
                                </Button>
                                <form action={action}>
                                    <input type="hidden" name="id" value={id} />
                                    {revalidate && <input type="hidden" name="revalidate" value={revalidate} />}
                                    <Button type="submit" color="primary-destructive">
                                        {label}
                                    </Button>
                                </form>
                            </div>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </>
    );
}
