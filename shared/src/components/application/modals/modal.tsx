// @ts-nocheck
import type { DialogProps as AriaDialogProps, ModalOverlayProps as AriaModalOverlayProps } from "react-aria-components";
import { Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { cx } from "@/utils/cx";

export const DialogTrigger = AriaDialogTrigger;

export const ModalOverlay = (props: AriaModalOverlayProps) => {
    return (
        <AriaModalOverlay
            {...props}
            className={(state) =>
                cx(
                    // z-[120]: above the app-shell chrome — floating widget dock (z-100) and
                    // the mobile nav drawer (z-110) — so dialogs fully cover the UI instead of
                    // letting those controls poke through the overlay.
                    "fixed inset-0 z-[120] flex min-h-dvh w-full items-end justify-center overflow-y-auto bg-overlay/70 px-4 pt-4 pb-[clamp(16px,8vh,64px)] outline-hidden backdrop-blur-[6px] sm:items-center sm:justify-center sm:p-8",
                    state.isEntering && "duration-300 ease-out animate-in fade-in motion-reduce:animate-none motion-reduce:duration-0",
                    state.isExiting && "duration-200 ease-in animate-out fade-out motion-reduce:animate-none motion-reduce:duration-0",
                    typeof props.className === "function" ? props.className(state) : props.className,
                )
            }
        />
    );
};

export const Modal = (props: AriaModalOverlayProps) => (
    <AriaModal
        {...props}
        className={(state) =>
            cx(
                "max-h-full w-full align-middle outline-hidden max-sm:overflow-y-auto max-sm:rounded-xl",
                state.isEntering && "duration-300 ease-out animate-in zoom-in-95 motion-reduce:animate-none motion-reduce:duration-0",
                state.isExiting && "duration-200 ease-in animate-out zoom-out-95 motion-reduce:animate-none motion-reduce:duration-0",
                typeof props.className === "function" ? props.className(state) : props.className,
            )
        }
    />
);

export const Dialog = (props: AriaDialogProps) => (
    <AriaDialog {...props} className={cx("flex w-full items-center justify-center outline-hidden", props.className)} />
);
