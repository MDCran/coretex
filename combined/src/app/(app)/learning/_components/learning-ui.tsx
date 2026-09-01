"use client";

import type { FC, ReactNode } from "react";
import { cx } from "@/utils/cx";
import { InputBase } from "@/components/base/input/input";
import { TextAreaBase } from "@/components/base/textarea/textarea";
import { ChevronDown } from "@untitledui/icons";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";

/** A bordered surface card used across learning pages. */
export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
    <div className={cx("rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset", className)}>{children}</div>
);

/**
 * Polished empty state: featured icon, concise heading, one line of helpful
 * copy, and an optional primary call-to-action. Used wherever a list, table,
 * or section can be empty so users always get a clear next step.
 */
export const EmptyState = ({
    icon,
    title,
    description,
    action,
    className,
    theme = "light",
    compact = false,
}: {
    icon: FC<{ className?: string }>;
    title: string;
    description?: string;
    action?: ReactNode;
    className?: string;
    theme?: "light" | "modern";
    compact?: boolean;
}) => (
    <div className={cx("flex flex-col items-center justify-center gap-3 text-center", compact ? "px-4 py-8" : "px-6 py-12", className)}>
        <FeaturedIcon icon={icon} color={theme === "modern" ? "gray" : "brand"} theme={theme} size="lg" />
        <div className="flex max-w-sm flex-col gap-1">
            <h3 className="text-sm font-semibold text-primary">{title}</h3>
            {description && <p className="text-sm text-tertiary">{description}</p>}
        </div>
        {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
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

/** A labelled native form field wrapper. */
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

/** Linear progress bar (value/max) using semantic tokens. */
export const ProgressBar = ({ value, max, color = "brand" }: { value: number; max: number; color?: "brand" | "success" | "warning" | "error" }) => {
    const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
    const fill = color === "success" ? "bg-success-solid" : color === "warning" ? "bg-warning-solid" : color === "error" ? "bg-error-solid" : "bg-brand-solid";
    return (
        <div className="h-2 w-full overflow-hidden rounded-full bg-quaternary">
            <div className={cx("h-full rounded-full transition-all duration-300", fill)} style={{ width: `${pct}%` }} />
        </div>
    );
};
