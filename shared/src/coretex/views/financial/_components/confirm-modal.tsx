// @ts-nocheck
import { type ReactNode, useState } from "react";
import { AlertTriangle } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";

interface ConfirmModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    isLoading?: boolean;
    onConfirm: () => void | Promise<void>;
}

/**
 * Accessible Untitled UI confirmation dialog — replaces window.confirm for all
 * destructive financial actions.
 */
export const ConfirmModal = ({
    isOpen,
    onOpenChange,
    title,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive = true,
    isLoading = false,
    onConfirm,
}: ConfirmModalProps) => (
    <ModalOverlay isDismissable isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal className="max-w-md">
            <Dialog aria-label={title}>
                <div className="w-full rounded-2xl bg-primary p-5 shadow-xl ring-1 ring-secondary ring-inset">
                    <div className="flex gap-4">
                        <FeaturedIcon icon={AlertTriangle} color={destructive ? "error" : "warning"} theme="light" size="md" />
                        <div className="flex flex-col gap-1 pt-0.5">
                            <h2 className="text-md font-semibold text-primary">{title}</h2>
                            {description && <div className="text-sm text-tertiary">{description}</div>}
                        </div>
                    </div>
                    <div className="mt-6 flex justify-end gap-2">
                        <Button color="secondary" type="button" onClick={() => onOpenChange(false)} isDisabled={isLoading}>
                            {cancelLabel}
                        </Button>
                        <Button color={destructive ? "primary-destructive" : "primary"} type="button" onClick={onConfirm} isLoading={isLoading}>
                            {confirmLabel}
                        </Button>
                    </div>
                </div>
            </Dialog>
        </Modal>
    </ModalOverlay>
);

/**
 * Hook providing a single reusable confirm dialog. Call `confirm({...})` to open it;
 * render `<dialog />` once in your tree.
 */
export function useConfirm() {
    const [state, setState] = useState<(Omit<ConfirmModalProps, "isOpen" | "onOpenChange" | "onConfirm" | "isLoading"> & { onConfirm: () => void | Promise<void> }) | null>(null);
    const [loading, setLoading] = useState(false);

    function confirm(opts: Omit<ConfirmModalProps, "isOpen" | "onOpenChange" | "isLoading">) {
        setState(opts);
    }

    async function handleConfirm() {
        if (!state) return;
        setLoading(true);
        try {
            await state.onConfirm();
            setState(null);
        } finally {
            setLoading(false);
        }
    }

    const dialog = (
        <ConfirmModal
            isOpen={state !== null}
            onOpenChange={(o) => !o && setState(null)}
            title={state?.title ?? ""}
            description={state?.description}
            confirmLabel={state?.confirmLabel}
            cancelLabel={state?.cancelLabel}
            destructive={state?.destructive}
            isLoading={loading}
            onConfirm={handleConfirm}
        />
    );

    return { confirm, dialog };
}
