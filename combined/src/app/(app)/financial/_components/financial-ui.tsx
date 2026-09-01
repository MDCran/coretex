"use client";

import type { FC, ReactNode } from "react";
import { cx } from "@/utils/cx";
import { InputBase } from "@/components/base/input/input";
import { TextAreaBase } from "@/components/base/textarea/textarea";
import { ChevronDown, HelpCircle, Inbox01 } from "@untitledui/icons";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";

/** A bordered surface card used across all financial pages. */
export const Card = ({ id, className, children }: { id?: string; className?: string; children: ReactNode }) => (
    <div id={id} className={cx("rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset", className)}>
        {children}
    </div>
);

/** Card with decorative bloom — `overflow-hidden` keeps blurs inside the card. */
export const BloomCard = ({
    id,
    className,
    children,
    bloom = "brand",
}: {
    id?: string;
    className?: string;
    children: ReactNode;
    bloom?: "brand" | "success" | "error" | "warning";
}) => {
    const bloomClass =
        bloom === "success"
            ? "bg-success-solid/10"
            : bloom === "error"
              ? "bg-error-solid/10"
              : bloom === "warning"
                ? "bg-warning-solid/10"
                : "bg-brand-solid/10";
    return (
        <Card id={id} className={cx("relative overflow-hidden", className)}>
            <div className={cx("pointer-events-none absolute -top-10 -right-10 size-36 rounded-full blur-3xl", bloomClass)} aria-hidden="true" />
            <div className={cx("pointer-events-none absolute -bottom-8 -left-8 size-28 rounded-full blur-2xl opacity-60", bloomClass)} aria-hidden="true" />
            <div className="relative">{children}</div>
        </Card>
    );
};

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
export const Field = ({ label, htmlFor, hint, className, children }: { label: string; htmlFor?: string; hint?: string; className?: string; children: ReactNode }) => (
    <div className={cx("flex flex-col gap-1.5", className)}>
        <label htmlFor={htmlFor} className="text-sm font-medium text-secondary">
            {label}
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
export const Stat = ({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "success" | "error" }) => (
    <div className="flex flex-col gap-1 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
        <p className="text-sm text-tertiary">{label}</p>
        <p className={cx("text-display-xs font-semibold", tone === "success" ? "text-success-primary" : tone === "error" ? "text-error-primary" : "text-primary")}>{value}</p>
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

/** A simple table shell with horizontal scroll. Children render the <thead>/<tbody>. */
export const TableCard = ({ minWidth = 640, tableClassName, children }: { minWidth?: number; tableClassName?: string; children: ReactNode }) => (
    <Card className="-mx-4 overflow-hidden rounded-none p-0 ring-0 sm:mx-0 sm:rounded-xl sm:ring-1">
        <div className="overflow-x-auto">
            <table className={cx("w-full text-sm", tableClassName)} style={{ minWidth }}>
                {children}
            </table>
        </div>
    </Card>
);

/** Table header label with a small help tooltip for terms that need context. */
export const TableHeaderHelp = ({ label, help, align = "left" }: { label: string; help: ReactNode; align?: "left" | "right" }) => (
    <span className={cx("inline-flex w-full items-center gap-1.5", align === "right" && "justify-end")}>
        <span>{label}</span>
        <Tooltip title={label} description={help} placement="top">
            <TooltipTrigger
                aria-label={`${label} help`}
                className="rounded-full text-fg-quaternary transition duration-100 ease-linear hover:text-fg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
                <HelpCircle className="size-3.5 stroke-[2.25px]" />
            </TooltipTrigger>
        </Tooltip>
    </span>
);

/**
 * Polished empty state: a featured icon, a concise heading, one line of helpful
 * copy and an optional primary call-to-action. Use inside a Card or as a section
 * placeholder so empty lists feel intentional rather than broken.
 */
export const EmptyState = ({
    icon = Inbox01,
    title,
    description,
    action,
    color = "brand",
    theme = "light",
    className,
}: {
    icon?: FC<{ className?: string }>;
    title: string;
    description?: string;
    action?: ReactNode;
    color?: "brand" | "gray" | "success" | "warning" | "error";
    theme?: "light" | "modern";
    className?: string;
}) => (
    <div className={cx("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}>
        <FeaturedIcon icon={icon} color={color} theme={theme} size="lg" />
        <div className="flex max-w-sm flex-col gap-1">
            <p className="text-sm font-semibold text-primary">{title}</p>
            {description && <p className="text-sm text-tertiary">{description}</p>}
        </div>
        {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
);

/**
 * Empty row spanning the given number of columns. When given a `title`/`action`
 * it renders the full polished EmptyState; otherwise it falls back to a single
 * line of muted copy (back-compat with the older `label`-only call sites).
 */
export const EmptyRow = ({
    colSpan,
    label = "Nothing here yet.",
    icon,
    title,
    description,
    action,
}: {
    colSpan: number;
    label?: string;
    icon?: FC<{ className?: string }>;
    title?: string;
    description?: string;
    action?: ReactNode;
}) => (
    <tr>
        <td colSpan={colSpan} className="p-0">
            {title ? (
                <EmptyState icon={icon} title={title} description={description ?? label} action={action} />
            ) : (
                <p className="px-5 py-8 text-center text-tertiary">{label}</p>
            )}
        </td>
    </tr>
);
