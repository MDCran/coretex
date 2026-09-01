"use client";

import type { ReactNode } from "react";
import { cx } from "@/utils/cx";
import { InputBase } from "@/components/base/input/input";
import { TextAreaBase } from "@/components/base/textarea/textarea";
import { ChevronDown } from "@untitledui/icons";

/** A bordered surface card used across all health pages. */
export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
    <div className={cx("rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset", className)}>{children}</div>
);

/** Page section header with optional action slot. */
export const SectionHeader = ({ title, description, action }: { title: string; description?: string; action?: ReactNode }) => (
    <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-semibold text-primary">{title}</h2>
            {description && <p className="text-sm text-tertiary">{description}</p>}
        </div>
        {action}
    </div>
);

/** A labelled native form field wrapper (matches Untitled spacing). */
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

/** A small labelled stat for snapshot/summary rows. */
export const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => (
    <div className="flex flex-col gap-1 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
        <p className="text-sm text-tertiary">{label}</p>
        <p className="text-display-xs font-semibold text-primary">{value}</p>
        {sub && <p className="text-xs text-tertiary">{sub}</p>}
    </div>
);

/** Shimmer placeholder block for loading states. */
export const Skeleton = ({ className }: { className?: string }) => (
    <div className={cx("animate-pulse rounded-md bg-secondary motion-reduce:animate-none", className)} />
);

/** A card-shaped skeleton used in route loading.tsx files. */
export const CardSkeleton = ({ lines = 3, className }: { lines?: number; className?: string }) => (
    <div className={cx("rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset", className)}>
        <Skeleton className="h-5 w-40" />
        <div className="mt-4 flex flex-col gap-2.5">
            {Array.from({ length: lines }).map((_, i) => (
                <Skeleton key={i} className={cx("h-4", i === lines - 1 ? "w-2/3" : "w-full")} />
            ))}
        </div>
    </div>
);

/** Linear progress bar (value/max) using semantic tokens. Pass `fillClassName` to override the named-color fill. */
export const ProgressBar = ({
    value,
    max,
    color = "brand",
    fillClassName,
}: {
    value: number;
    max: number;
    color?: "brand" | "success" | "warning" | "error";
    fillClassName?: string;
}) => {
    const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
    const fill =
        fillClassName ?? (color === "success" ? "bg-success-solid" : color === "warning" ? "bg-warning-solid" : color === "error" ? "bg-error-solid" : "bg-brand-solid");
    return (
        <div className="h-2 w-full overflow-hidden rounded-full bg-quaternary">
            <div className={cx("h-full rounded-full transition-all duration-300", fill)} style={{ width: `${pct}%` }} />
        </div>
    );
};
