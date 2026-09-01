"use client";

import type { FC, ReactNode } from "react";
import { Activity, LayoutAlt01, Trophy01 } from "@untitledui/icons";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/utils/cx";

/** A bordered surface card used across all workout pages. */
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

/**
 * Top-of-page header: a title + supporting copy on the left and a primary action
 * slot on the right. Keeps every workouts sub-page opening with the same rhythm.
 */
export const PageHeader = ({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) => (
    <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
            <h1 className="text-display-xs font-semibold text-primary">{title}</h1>
            {description && <p className="text-md text-tertiary">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
);

/**
 * Polished empty state for lists, tables and sections: a featured icon, a concise
 * heading, one line of helpful copy and an optional call-to-action. Centered and
 * padded to sit comfortably inside a Card.
 */
export const EmptyState = ({
    icon,
    iconName,
    title,
    description,
    action,
    theme = "light",
    color = "brand",
    className,
}: {
    /** Component icons are safe for client callers; Server Components should use iconName. */
    icon?: FC<{ className?: string }>;
    iconName?: "template" | "trophy";
    title: string;
    description?: string;
    action?: ReactNode;
    theme?: "light" | "modern";
    color?: "brand" | "gray" | "success" | "warning" | "error";
    className?: string;
}) => {
    const Icon = icon ?? (iconName === "template" ? LayoutAlt01 : iconName === "trophy" ? Trophy01 : Activity);
    return (
    <div className={cx("flex flex-col items-center justify-center gap-3 px-4 py-10 text-center", className)}>
        <FeaturedIcon icon={Icon} color={color} theme={theme} size="lg" />
        <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-primary">{title}</p>
            {description && <p className="mx-auto max-w-sm text-sm text-tertiary">{description}</p>}
        </div>
        {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
    );
};

/** A labelled native form field wrapper (matches Untitled spacing). */
export const Field = ({ label, htmlFor, hint, required, className, children }: { label?: string; htmlFor?: string; hint?: string; required?: boolean; className?: string; children: ReactNode }) => (
    <div className={cx("flex flex-col gap-1.5", className)}>
        {label && (
            <label htmlFor={htmlFor} className="flex items-center gap-0.5 text-sm font-medium text-secondary">
                {label}
                {required && <span className="text-error-primary"> *</span>}
            </label>
        )}
        {children}
        {hint && <p className="text-xs text-tertiary">{hint}</p>}
    </div>
);

const nativeFieldClasses =
    "w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs ring-1 ring-primary transition duration-100 ease-linear ring-inset placeholder:text-placeholder focus:outline-2 focus:-outline-offset-2 focus:outline-brand disabled:cursor-not-allowed disabled:opacity-50";

/** Styled native <input> (text/number/date/datetime-local/time) using semantic tokens. */
export const NativeInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} className={cx(nativeFieldClasses, props.className)} />
);

/** Styled native <select> using semantic tokens. */
export const NativeSelect = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} className={cx(nativeFieldClasses, "cursor-pointer appearance-none pr-8", props.className)} />
);

/** Styled native <textarea> using semantic tokens. */
export const NativeTextarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} className={cx(nativeFieldClasses, "min-h-20", props.className)} />
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
