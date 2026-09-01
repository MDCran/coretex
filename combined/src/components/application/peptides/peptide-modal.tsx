"use client";

import type { ReactNode } from "react";
import { X } from "@untitledui/icons";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";

interface PeptideModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    children: ReactNode;
    className?: string;
}

/** Standard centered modal with an accessible header, used across the peptides pages. */
export function PeptideModal({ isOpen, onOpenChange, title, description, children, className }: PeptideModalProps) {
    return (
        <ModalOverlay isDismissable isOpen={isOpen} onOpenChange={onOpenChange}>
            <Modal className={className ?? "max-w-lg"}>
                <Dialog aria-label={title}>
                    <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary ring-inset">
                        <div className="flex items-start justify-between gap-4 border-b border-secondary px-5 py-4">
                            <div className="flex flex-col gap-0.5">
                                <h2 className="text-lg font-semibold text-primary">{title}</h2>
                                {description && <p className="text-sm text-tertiary">{description}</p>}
                            </div>
                            <button
                                type="button"
                                aria-label="Close"
                                onClick={() => onOpenChange(false)}
                                className="cursor-pointer rounded-md p-1.5 text-fg-quaternary transition duration-100 ease-linear hover:bg-primary_hover hover:text-fg-quaternary_hover"
                            >
                                <X className="size-5" />
                            </button>
                        </div>
                        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
