// @ts-nocheck
import type { FC, ReactNode } from "react";
import { Plus } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/utils/cx";

interface HealthEmptyStateProps {
    /** Icon shown in the FeaturedIcon. */
    icon: FC<{ className?: string }>;
    /** Concise, benefit-led heading. */
    title: string;
    /** One line of helpful copy. */
    description: string;
    /** Primary CTA label — kicks off the relevant create flow. */
    actionLabel?: string;
    /** Click handler for the primary CTA (use this for in-page create modals). */
    onAction?: () => void;
    /** Href for the primary CTA (use this when the create flow lives on another route). */
    actionHref?: string;
    /** Icon for the primary CTA (defaults to Plus). */
    actionIcon?: FC<{ className?: string }>;
    /** FeaturedIcon theme — defaults to a soft "light" tint. */
    theme?: "light" | "modern";
    /** FeaturedIcon color — defaults to brand. */
    color?: "brand" | "gray";
    /** Extra content rendered below the CTA (e.g. quick-pick presets). */
    children?: ReactNode;
    className?: string;
}

/**
 * Polished, conversion-minded empty state used across the Health module.
 * A featured icon, a confident heading, one helpful line and a primary CTA that
 * starts the relevant create flow. Keep copy benefit-led, never "No data".
 */
export function HealthEmptyState({
    icon,
    title,
    description,
    actionLabel,
    onAction,
    actionHref,
    actionIcon = Plus,
    theme = "light",
    color = "brand",
    children,
    className,
}: HealthEmptyStateProps) {
    const ActionIcon = actionIcon;
    return (
        <div className={cx("flex flex-col items-center gap-4 px-6 py-12 text-center", className)}>
            <FeaturedIcon icon={icon} color={theme === "modern" ? "gray" : color} theme={theme} size="lg" />
            <div className="flex flex-col gap-1">
                <h3 className="text-lg font-semibold text-primary">{title}</h3>
                <p className="mx-auto max-w-sm text-sm text-tertiary">{description}</p>
            </div>
            {actionLabel && (onAction || actionHref) && (
                <Button
                    size="md"
                    href={actionHref}
                    onClick={onAction}
                    iconLeading={<ActionIcon data-icon className="size-4" />}
                >
                    {actionLabel}
                </Button>
            )}
            {children}
        </div>
    );
}
