import type { ComponentProps, FC, ReactNode } from "react";
import { AlertCircle, SearchLg } from "@untitledui/icons";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { LoadingIndicator } from "@/components/application/loading-indicator/loading-indicator";
import { cx } from "@/utils/cx";

type StateSize = "sm" | "md" | "lg";

/** Centered loading state — the single sanctioned replacement for ad-hoc "Loading…" text. */
export function StateLoading({ label = "Loading…", size = "sm", className }: { label?: string; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
    return (
        <div className={cx("flex w-full items-center justify-center py-12", className)} role="status" aria-live="polite">
            <LoadingIndicator type="line-spinner" size={size} label={label} />
        </div>
    );
}

/**
 * Standard empty state — an illustration/icon, title, description and optional action(s).
 * Pass either `illustration` (preferred for whole-page emptiness) or `icon`.
 */
export function StateEmpty({
    title,
    description,
    icon = SearchLg,
    illustration,
    action,
    size = "md",
    className,
}: {
    title: string;
    description?: string;
    icon?: FC<{ className?: string }>;
    illustration?: ComponentProps<typeof EmptyState.Illustration>["type"];
    action?: ReactNode;
    size?: StateSize;
    className?: string;
}) {
    const Icon = icon;
    return (
        <EmptyState size={size} className={cx("py-10", className)}>
            <EmptyState.Header>
                {illustration ? (
                    <EmptyState.Illustration type={illustration} />
                ) : (
                    // Pass a rendered element (not the function) so this stays usable from
                    // Server Components — functions can't cross into the client EmptyState.
                    <EmptyState.FeaturedIcon icon={Icon ? <Icon data-icon className="size-6" aria-hidden="true" /> : undefined} color="gray" theme="modern" />
                )}
            </EmptyState.Header>
            <EmptyState.Content>
                <EmptyState.Title>{title}</EmptyState.Title>
                {description && <EmptyState.Description>{description}</EmptyState.Description>}
            </EmptyState.Content>
            {action && <EmptyState.Footer>{action}</EmptyState.Footer>}
        </EmptyState>
    );
}

/** Standard error state — for failed async surfaces. Pass a retry control as `action`. */
export function StateError({
    title = "Something went wrong",
    description = "We couldn't load this. Please try again.",
    action,
    size = "md",
    className,
}: {
    title?: string;
    description?: string;
    action?: ReactNode;
    size?: StateSize;
    className?: string;
}) {
    return (
        <EmptyState size={size} className={cx("py-10", className)}>
            <EmptyState.Header pattern="none">
                <EmptyState.FeaturedIcon icon={<AlertCircle data-icon className="size-6" aria-hidden="true" />} color="error" theme="light" />
            </EmptyState.Header>
            <EmptyState.Content>
                <EmptyState.Title>{title}</EmptyState.Title>
                <EmptyState.Description>{description}</EmptyState.Description>
            </EmptyState.Content>
            {action && <EmptyState.Footer>{action}</EmptyState.Footer>}
        </EmptyState>
    );
}
