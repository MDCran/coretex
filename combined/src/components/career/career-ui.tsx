import type { FC, ReactNode } from "react";
import { Inbox01 } from "@untitledui/icons";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/utils/cx";

/** Small status chip for cert/goal statuses. */
export function StatusChip({ status }: { status: string | null | undefined }) {
    const map: Record<string, { label: string; cls: string }> = {
        planned: { label: "Planned", cls: "bg-secondary text-tertiary" },
        in_progress: { label: "In progress", cls: "bg-warning-secondary text-warning-primary" },
        completed: { label: "Completed", cls: "bg-success-secondary text-success-primary" },
        active: { label: "Active", cls: "bg-brand-secondary text-brand-secondary" },
        abandoned: { label: "Abandoned", cls: "bg-secondary text-tertiary" },
    };
    const v = map[status ?? ""] ?? { label: status ?? "—", cls: "bg-secondary text-tertiary" };
    return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", v.cls)}>{v.label}</span>;
}

/** Read-only chip used for technology tags etc. */
export function Tag({ children }: { children: ReactNode }) {
    return <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary">{children}</span>;
}

/**
 * Polished empty-state for tables/lists/sections.
 *
 * Backwards compatible: pass just `children` for a one-line message, or provide
 * `icon` / `title` / `action` to render the full centered FeaturedIcon layout
 * with a heading, helper copy, and a call-to-action.
 */
export function EmptyState({
    icon,
    title,
    action,
    className,
    children,
}: {
    icon?: FC<{ className?: string }>;
    title?: string;
    action?: ReactNode;
    className?: string;
    children?: ReactNode;
}) {
    // Rich variant: an icon, a title, or a CTA was provided.
    if (icon || title || action) {
        const Icon = icon ?? Inbox01;
        return (
            <div className={cx("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
                <FeaturedIcon icon={Icon} color="brand" theme="light" size="lg" />
                {title && <p className="text-sm font-semibold text-primary">{title}</p>}
                {children && <p className="max-w-sm text-sm text-tertiary">{children}</p>}
                {action && <div className="mt-1">{action}</div>}
            </div>
        );
    }

    // Compact legacy variant: a single muted line.
    return <p className={cx("py-8 text-center text-sm text-tertiary", className)}>{children}</p>;
}
