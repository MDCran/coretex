// @ts-nocheck
import { type ComponentPropsWithRef, type ReactNode, type RefAttributes } from "react";
import type {
    DialogProps as AriaDialogProps,
    ModalOverlayProps as AriaModalOverlayProps,
    ModalRenderProps as AriaModalRenderProps,
} from "react-aria-components";
import { Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { CloseButton } from "@/components/base/buttons/close-button";
import { cx } from "@/utils/cx";

interface ModalOverlayProps extends AriaModalOverlayProps, RefAttributes<HTMLDivElement> {}

export const ModalOverlay = (props: ModalOverlayProps) => {
    return (
        <AriaModalOverlay
            {...props}
            className={(state) =>
                cx(
                    // z-[120]: above floating chrome (status-cluster z-40, terminal dock, widget dock z-100)
                    // so the panel covers Agents/Terminals/Alerts instead of sliding under them.
                    // overflow-hidden keeps the page behind locked; only the panel body scrolls.
                    "fixed inset-0 z-[120] flex min-h-dvh w-full items-stretch justify-end overflow-hidden bg-overlay/70 pl-6 outline-hidden ease-linear md:pl-10",
                    state.isEntering && "duration-300 animate-in fade-in motion-reduce:animate-none motion-reduce:duration-0",
                    state.isExiting && "duration-500 animate-out fade-out motion-reduce:animate-none motion-reduce:duration-0",
                    typeof props.className === "function" ? props.className(state) : props.className,
                )
            }
        />
    );
};
ModalOverlay.displayName = "ModalOverlay";

interface ModalProps extends AriaModalOverlayProps, RefAttributes<HTMLDivElement> {}

export const Modal = (props: ModalProps) => (
    <AriaModal
        {...props}
        className={(state) =>
            cx(
                // Stick to the viewport right edge (not the scrolling page body).
                "fixed inset-y-0 right-0 h-dvh max-h-dvh w-full max-w-100 shadow-xl transition",
                state.isEntering && "duration-300 animate-in slide-in-from-right motion-reduce:animate-none motion-reduce:duration-0",
                state.isExiting && "duration-500 animate-out slide-out-to-right motion-reduce:animate-none motion-reduce:duration-0",
                typeof props.className === "function" ? props.className(state) : props.className,
            )
        }
    />
);
Modal.displayName = "Modal";

interface DialogProps extends AriaDialogProps, RefAttributes<HTMLElement> {}

export const Dialog = (props: DialogProps) => (
    <AriaDialog
        role="dialog"
        aria-label="Slideout menu"
        {...props}
        className={cx(
            // Header/footer stay put; only Content scrolls.
            "relative flex size-full max-h-dvh flex-col items-start gap-0 overflow-hidden bg-primary ring-1 ring-secondary_alt outline-hidden",
            props.className,
        )}
    />
);
Dialog.displayName = "Dialog";

interface SlideoutMenuProps extends Omit<AriaModalOverlayProps, "children">, RefAttributes<HTMLDivElement> {
    children: ReactNode | ((children: AriaModalRenderProps & { close: () => void }) => ReactNode);
    dialogClassName?: string;
}

const Menu = ({ children, dialogClassName, ...props }: SlideoutMenuProps) => {
    return (
        <ModalOverlay {...props}>
            <Modal className={(state) => cx(typeof props.className === "function" ? props.className(state) : props.className)}>
                {(state) => (
                    <Dialog className={dialogClassName}>
                        {({ close }) => {
                            return typeof children === "function" ? children({ ...state, close }) : children;
                        }}
                    </Dialog>
                )}
            </Modal>
        </ModalOverlay>
    );
};
Menu.displayName = "SlideoutMenu";

const Content = ({ role = "main", ...props }: ComponentPropsWithRef<"div">) => {
    return (
        <div
            role={role}
            {...props}
            className={cx("flex min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 md:px-6", props.className)}
        />
    );
};
Content.displayName = "SlideoutContent";

interface SlideoutHeaderProps extends ComponentPropsWithRef<"header"> {
    onClose?: () => void;
}

const Header = ({ className, children, onClose, ...props }: SlideoutHeaderProps) => {
    return (
        <header {...props} className={cx("relative z-1 w-full shrink-0 px-4 pt-6 md:px-6", className)}>
            {children}
            <CloseButton size="sm" className="absolute top-3 right-3 shrink-0" onClick={onClose} />
        </header>
    );
};
Header.displayName = "SlideoutHeader";

const Footer = (props: ComponentPropsWithRef<"footer">) => {
    return <footer {...props} className={cx("w-full shrink-0 p-4 shadow-[inset_0px_1px_0px_0px] shadow-border-secondary md:px-6", props.className)} />;
};
Footer.displayName = "SlideoutFooter";

const SlideoutMenu = Menu as typeof Menu & {
    Trigger: typeof AriaDialogTrigger;
    Content: typeof Content;
    Header: typeof Header;
    Footer: typeof Footer;
};
SlideoutMenu.displayName = "SlideoutMenu";

SlideoutMenu.Trigger = AriaDialogTrigger;
SlideoutMenu.Content = Content;
SlideoutMenu.Header = Header;
SlideoutMenu.Footer = Footer;

export { SlideoutMenu };
