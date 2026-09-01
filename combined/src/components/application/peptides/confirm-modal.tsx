"use client";

import { AlertTriangle } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { PeptideModal } from "./peptide-modal";

interface Props {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    onConfirm: () => void;
}

/** A small confirmation dialog with an accessible title, used for destructive peptide actions. */
export function ConfirmModal({ isOpen, onOpenChange, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive, onConfirm }: Props) {
    return (
        <PeptideModal isOpen={isOpen} onOpenChange={onOpenChange} title={title} className="max-w-md">
            <div className="flex flex-col gap-5">
                <div className="flex items-start gap-3">
                    <FeaturedIcon icon={AlertTriangle} color={destructive ? "error" : "warning"} theme="light" size="md" />
                    <p className="pt-1 text-sm text-tertiary">{description ?? "This action cannot be undone."}</p>
                </div>
                <div className="flex justify-end gap-2">
                    <Button color="secondary" onClick={() => onOpenChange(false)}>
                        {cancelLabel}
                    </Button>
                    <Button color={destructive ? "primary-destructive" : "primary"} onClick={onConfirm}>
                        {confirmLabel}
                    </Button>
                </div>
            </div>
        </PeptideModal>
    );
}
