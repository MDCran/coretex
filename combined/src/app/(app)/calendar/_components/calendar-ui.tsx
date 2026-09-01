"use client";

import type { ReactNode } from "react";
import { X, ChevronDown } from "@untitledui/icons";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { InputBase } from "@/components/base/input/input";
import { TextAreaBase } from "@/components/base/textarea/textarea";
import { cx } from "@/utils/cx";

/**
 * Maps an EventCategory color token to semantic-ish utility classes.
 *
 * `dot`  — small solid status dot.
 * `chip` — event-pill background + text (low-contrast tinted surface).
 * `ring` — ring colour for selected swatches / outlines.
 * `pill` — solid badge style (filled swatch background + readable text).
 *
 * Only `bg-utility-{family}-*` families that EXIST in src/styles/theme.css are
 * used (blue, brand, red, yellow, green, orange, indigo, fuchsia, pink, purple,
 * sky, emerald, amber). The `color` field on EventCategory is a free string, so
 * any key here is valid; unknown values fall back to `neutral`.
 */
export const CATEGORY_COLORS: Record<string, { dot: string; chip: string; ring: string; pill: string }> = {
    red: { dot: "bg-utility-red-500", chip: "bg-utility-red-50 text-utility-red-700", ring: "ring-utility-red-500", pill: "bg-utility-red-500 text-white" },
    orange: { dot: "bg-utility-orange-500", chip: "bg-utility-orange-50 text-utility-orange-700", ring: "ring-utility-orange-500", pill: "bg-utility-orange-500 text-white" },
    amber: { dot: "bg-utility-amber-500", chip: "bg-utility-amber-50 text-utility-amber-700", ring: "ring-utility-amber-500", pill: "bg-utility-amber-500 text-white" },
    yellow: { dot: "bg-utility-yellow-500", chip: "bg-utility-yellow-50 text-utility-yellow-700", ring: "ring-utility-yellow-500", pill: "bg-utility-yellow-500 text-white" },
    green: { dot: "bg-utility-green-500", chip: "bg-utility-green-50 text-utility-green-700", ring: "ring-utility-green-500", pill: "bg-utility-green-500 text-white" },
    emerald: { dot: "bg-utility-emerald-500", chip: "bg-utility-emerald-50 text-utility-emerald-700", ring: "ring-utility-emerald-500", pill: "bg-utility-emerald-500 text-white" },
    sky: { dot: "bg-utility-sky-500", chip: "bg-utility-sky-50 text-utility-sky-700", ring: "ring-utility-sky-500", pill: "bg-utility-sky-500 text-white" },
    blue: { dot: "bg-utility-blue-500", chip: "bg-utility-blue-50 text-utility-blue-700", ring: "ring-utility-blue-500", pill: "bg-utility-blue-500 text-white" },
    indigo: { dot: "bg-utility-indigo-500", chip: "bg-utility-indigo-50 text-utility-indigo-700", ring: "ring-utility-indigo-500", pill: "bg-utility-indigo-500 text-white" },
    violet: { dot: "bg-utility-purple-500", chip: "bg-utility-purple-50 text-utility-purple-700", ring: "ring-utility-purple-500", pill: "bg-utility-purple-500 text-white" },
    purple: { dot: "bg-utility-purple-500", chip: "bg-utility-purple-50 text-utility-purple-700", ring: "ring-utility-purple-500", pill: "bg-utility-purple-500 text-white" },
    fuchsia: { dot: "bg-utility-fuchsia-500", chip: "bg-utility-fuchsia-50 text-utility-fuchsia-700", ring: "ring-utility-fuchsia-500", pill: "bg-utility-fuchsia-500 text-white" },
    pink: { dot: "bg-utility-pink-500", chip: "bg-utility-pink-50 text-utility-pink-700", ring: "ring-utility-pink-500", pill: "bg-utility-pink-500 text-white" },
    rose: { dot: "bg-utility-pink-500", chip: "bg-utility-pink-50 text-utility-pink-700", ring: "ring-utility-pink-500", pill: "bg-utility-pink-500 text-white" },
    brand: { dot: "bg-brand-solid", chip: "bg-brand-primary text-brand-secondary", ring: "ring-brand", pill: "bg-brand-solid text-white" },
    neutral: { dot: "bg-fg-quaternary", chip: "bg-secondary text-secondary", ring: "ring-secondary", pill: "bg-quaternary text-primary" },
};

/** Ordered list of swatch keys offered in the category color picker. */
export const CATEGORY_COLOR_NAMES: string[] = [
    "red",
    "orange",
    "amber",
    "yellow",
    "green",
    "emerald",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "neutral",
];

export function categoryColor(color: string | null | undefined) {
    return CATEGORY_COLORS[color ?? "neutral"] ?? CATEGORY_COLORS.neutral;
}

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
    <div className={cx("rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset", className)}>{children}</div>
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

interface FormModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    children: ReactNode;
}

export const FormModal = ({ isOpen, onOpenChange, title, description, children }: FormModalProps) => (
    <ModalOverlay isDismissable isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal className="max-w-xl">
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
                    <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
                </div>
            </Dialog>
        </Modal>
    </ModalOverlay>
);
