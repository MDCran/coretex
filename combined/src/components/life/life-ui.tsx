"use client";

import type { ReactNode } from "react";
import { X, ChevronDown } from "@untitledui/icons";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { InputBase } from "@/components/base/input/input";
import { TextAreaBase } from "@/components/base/textarea/textarea";
import { cx } from "@/utils/cx";

/** Bordered surface card. */
export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
    <div className={cx("rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset", className)}>{children}</div>
);

/** Section header with optional action. */
export const SectionHeader = ({ title, description, action }: { title: string; description?: string; action?: ReactNode }) => (
    <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-semibold text-primary">{title}</h2>
            {description && <p className="text-sm text-tertiary">{description}</p>}
        </div>
        {action}
    </div>
);

export const Field = ({ label, htmlFor, hint, required, className, children }: { label: string; htmlFor?: string; hint?: string; required?: boolean; className?: string; children: ReactNode }) => (
    <div className={cx("flex flex-col gap-1.5", className)}>
        <label htmlFor={htmlFor} className="flex items-center gap-0.5 text-sm font-medium text-secondary">
            {label}
            {required && <span className="text-error-primary"> *</span>}
        </label>
        {children}
        {hint && <p className="text-xs text-tertiary">{hint}</p>}
    </div>
);

const selectFieldClasses =
    "w-full appearance-none rounded-lg bg-primary px-3 py-2 pr-8 text-sm text-primary shadow-xs ring-1 ring-primary transition duration-100 ease-linear ring-inset placeholder:text-placeholder focus:outline-2 focus:-outline-offset-2 focus:outline-brand";

/** Library-backed text/number/date input that keeps the native event API. */
export const NativeInput = ({ className, size: _size, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <InputBase size="sm" {...props} wrapperClassName={cx("w-full", className)} />
);

/** Styled native <select> using the library's select chrome (keeps native event API). */
export const NativeSelect = ({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <div className="relative grid w-full items-center">
        <select {...props} className={cx(selectFieldClasses, "cursor-pointer", className)}>
            {children}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 size-4 stroke-[2.25px] text-fg-quaternary" />
    </div>
);

/** Library-backed textarea that keeps the native event API. */
export const NativeTextarea = ({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <TextAreaBase size="sm" {...props} className={cx("min-h-20", className)} />
);

export const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => (
    <div className="flex flex-col gap-1 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
        <p className="text-sm text-tertiary">{label}</p>
        <p className="text-display-xs font-semibold text-primary">{value}</p>
        {sub && <p className="text-xs text-tertiary">{sub}</p>}
    </div>
);

interface FormModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    children: ReactNode;
}

export const FormModal = ({ isOpen, onOpenChange, title, description, children }: FormModalProps) => (
    <ModalOverlay isDismissable isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal className="w-[calc(100vw-2rem)] max-w-lg">
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
                            className="rounded-md p-1.5 text-fg-quaternary transition duration-100 ease-linear hover:bg-primary_hover hover:text-fg-quaternary_hover"
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

/** Shared toast-wrapped server-action runner for client components. */
export async function runAction(action: (fd: FormData) => Promise<unknown>, fd: FormData, toast: { success: (m: string) => void; error: (m: string) => void }, ok = "Saved") {
    try {
        await action(fd);
        toast.success(ok);
        return true;
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        return false;
    }
}
