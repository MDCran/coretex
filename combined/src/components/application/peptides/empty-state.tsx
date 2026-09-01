"use client";

import type { FC, ReactNode } from "react";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/utils/cx";

interface EmptyStateProps {
    /** Icon shown in the FeaturedIcon. */
    icon: FC<{ className?: string }>;
    /** Concise, benefit-led heading. */
    title: string;
    /** One line of helpful copy. */
    description: string;
    /** Primary CTA label — kicks off the relevant create flow. */
    actionLabel?: string;
    /** Click handler for the primary CTA (in-page create modals). */
    onAction?: () => void;
    /** Href for the primary CTA (when the create flow lives on another route). */
    actionHref?: string;
    /** Icon for the primary CTA. */
    actionIcon?: FC<{ className?: string }>;
    /** FeaturedIcon theme — defaults to a soft "light" tint. */
    theme?: "light" | "modern";
    /** Vertical padding scale. */
    size?: "sm" | "md";
    /** Extra content rendered below the CTA. */
    children?: ReactNode;
    className?: string;
}

/**
 * Polished, conversion-minded empty state for the peptides workspace. A featured
 * icon, a confident heading, one helpful line and a primary CTA that starts the
 * relevant create flow. Never a bare "No data" string.
 */
export function EmptyState({
    icon,
    title,
    description,
    actionLabel,
    onAction,
    actionHref,
    actionIcon,
    theme = "light",
    size = "md",
    children,
    className,
}: EmptyStateProps) {
    const ActionIcon = actionIcon;
    return (
        <div className={cx("flex flex-col items-center gap-4 px-6 text-center", size === "sm" ? "py-8" : "py-12", className)}>
            <FeaturedIcon icon={icon} color={theme === "modern" ? "gray" : "brand"} theme={theme} size="lg" />
            <div className="flex flex-col gap-1">
                <h3 className="text-md font-semibold text-primary">{title}</h3>
                <p className="mx-auto max-w-sm text-sm text-tertiary">{description}</p>
            </div>
            {actionLabel && (onAction || actionHref) && (
                <Button
                    size="md"
                    href={actionHref}
                    onClick={onAction}
                    iconLeading={ActionIcon ? <ActionIcon data-icon className="size-4" /> : undefined}
                >
                    {actionLabel}
                </Button>
            )}
            {children}
        </div>
    );
}
