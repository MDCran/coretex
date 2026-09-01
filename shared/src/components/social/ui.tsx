import type { FC, ReactNode } from "react";
import { cx } from "@/utils/cx";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Button } from "@/components/base/buttons/button";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
    return <div className={cx("rounded-xl bg-primary ring-1 ring-secondary ring-inset", className)}>{children}</div>;
}

export function CardHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
    return (
        <div className={cx("flex items-center justify-between gap-3 border-b border-secondary px-5 py-4", className)}>
            <h2 className="text-md font-semibold text-primary">{title}</h2>
            {action}
        </div>
    );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
    return <div className={cx("p-5", className)}>{children}</div>;
}

/** A small 0–10 score meter (closeness / trust). */
export function ScoreMeter({ label, value, color = "brand" }: { label: string; value: number | null; color?: "brand" | "success" }) {
    const pct = value == null ? 0 : Math.max(0, Math.min(10, value)) * 10;
    const barColor = color === "success" ? "bg-success-solid" : "bg-brand-solid";
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-secondary">{label}</span>
                <span className="text-tertiary">{value == null ? "—" : `${value}/10`}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-quaternary">
                <div className={cx("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

/** A labelled key/value row for detail lists. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
            <div className="w-40 shrink-0 text-sm text-tertiary">{label}</div>
            <div className="min-w-0 text-sm text-primary">{children}</div>
        </div>
    );
}

export function EmptyHint({ children }: { children: ReactNode }) {
    return <p className="py-8 text-center text-sm text-tertiary">{children}</p>;
}

type EmptyStateAction =
    | { label: string; href: string; onClick?: never }
    | { label: string; onClick: () => void; href?: never };

/**
 * Polished empty state: a featured icon, a concise heading, one line of helpful
 * copy and an optional primary call-to-action that kicks off the create flow.
 * Use this for any list/section that can be empty instead of bare "No data" text.
 */
export function EmptyState({
    icon,
    title,
    description,
    action,
    theme = "light",
    className,
}: {
    icon: FC<{ className?: string }>;
    title: string;
    description?: ReactNode;
    action?: EmptyStateAction;
    theme?: "light" | "modern";
    className?: string;
}) {
    return (
        <div className={cx("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
            <FeaturedIcon icon={icon} color="brand" theme={theme} size="lg" />
            <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold text-primary">{title}</p>
                {description && <p className="max-w-sm text-sm text-tertiary">{description}</p>}
            </div>
            {action &&
                (action.href ? (
                    <Button href={action.href} color="primary" size="sm" className="mt-1">
                        {action.label}
                    </Button>
                ) : (
                    <Button onClick={action.onClick} color="primary" size="sm" className="mt-1">
                        {action.label}
                    </Button>
                ))}
        </div>
    );
}
