// @ts-nocheck
import { type ReactNode, useRef, useState } from "react";
import { AlertTriangle } from "@untitledui/icons";
import { Heading } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";

export interface ConfirmDialogProps {
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
 * Generic, accessible Untitled UI confirmation dialog. Use this in place of the
 * browser's blocking `window.confirm()` for any destructive/irreversible action.
 *
 * Either render it directly with controlled `isOpen` state, or use the
 * {@link useConfirm} hook for an imperative `confirm({...})` API.
 */
export const ConfirmDialog = ({
    isOpen,
    onOpenChange,
    title,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive = true,
    isLoading = false,
    onConfirm,
}: ConfirmDialogProps) => (
    <ModalOverlay isDismissable isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal className="max-w-md">
            <Dialog>
                <div className="w-full rounded-2xl bg-primary p-5 shadow-xl ring-1 ring-secondary ring-inset">
                    <div className="flex gap-4">
                        <FeaturedIcon icon={AlertTriangle} color={destructive ? "error" : "warning"} theme="light" size="md" />
                        <div className="flex flex-col gap-1 pt-0.5">
                            <Heading slot="title" className="text-md font-semibold text-primary">
                                {title}
                            </Heading>
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

type ConfirmOptions = Omit<ConfirmDialogProps, "isOpen" | "onOpenChange" | "isLoading">;

/**
 * Hook providing a single reusable confirm dialog. Call `confirm({...})` to open
 * it, and render `{dialog}` once anywhere in your component tree.
 *
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   <Button onClick={() => confirm({ title: "Delete?", onConfirm: doDelete })} />
 *   {dialog}
 */
export function useConfirm() {
    const [state, setState] = useState<ConfirmOptions | null>(null);
    const [loading, setLoading] = useState(false);
    const lastState = useRef<ConfirmOptions | null>(null);

    function confirm(opts: ConfirmOptions) {
        lastState.current = opts;
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

    // Keep the last options available while React Aria runs the modal's exit
    // animation. Clearing the title immediately would briefly leave the
    // still-mounted dialog without an accessible name.
    const renderedState = state ?? lastState.current;
    const dialog = (
        <ConfirmDialog
            isOpen={state !== null}
            onOpenChange={(o) => !o && setState(null)}
            title={renderedState?.title ?? "Confirmation"}
            description={renderedState?.description}
            confirmLabel={renderedState?.confirmLabel}
            cancelLabel={renderedState?.cancelLabel}
            destructive={renderedState?.destructive}
            isLoading={loading}
            onConfirm={handleConfirm}
        />
    );

    return { confirm, dialog };
}
