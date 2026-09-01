"use client";

import { CheckDone01, Clock, HeartHand, LayersThree01, Lightning01, PieChart03, Stars01, TrendUp02, X } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

export type AiTone = "brand" | "emerald" | "amber" | "rose" | "blue";
export type AiConfidence = "low" | "medium" | "high";
export type AiSuggestionIcon = "check" | "clock" | "heart-hand" | "layers" | "lightning" | "pie-chart" | "trend-up";

const ICONS: Record<AiSuggestionIcon, typeof Stars01> = {
    check: CheckDone01,
    clock: Clock,
    "heart-hand": HeartHand,
    layers: LayersThree01,
    lightning: Lightning01,
    "pie-chart": PieChart03,
    "trend-up": TrendUp02,
};

/** RGB triplets for the subtle corner bloom, matching the house glow palette. */
const GLOW: Record<AiTone, string> = {
    brand: "127 86 217",
    emerald: "16 185 129",
    amber: "245 158 11",
    rose: "240 70 199",
    blue: "59 130 246",
};

/** Eyebrow pill text/ring colors per tone (semantic-leaning, calm). */
const EYEBROW: Record<AiTone, string> = {
    brand: "text-brand-secondary ring-brand",
    emerald: "text-success-primary ring-success",
    amber: "text-warning-primary ring-warning",
    rose: "text-error-primary ring-error",
    blue: "text-brand-secondary ring-brand",
};

const CONFIDENCE: Record<AiConfidence, { label: string; className: string }> = {
    low: { label: "Low confidence", className: "bg-secondary text-tertiary ring-secondary" },
    medium: { label: "Medium confidence", className: "bg-warning-secondary text-warning-primary ring-warning" },
    high: { label: "High confidence", className: "bg-success-secondary text-success-primary ring-success" },
};

export interface AiSuggestionCardProps {
    title: string;
    body: string;
    tone?: AiTone;
    /** Serializable icon name so Server Components never pass a function across the client boundary. */
    iconName?: AiSuggestionIcon;
    confidence?: AiConfidence;
    href?: string;
    ctaLabel?: string;
    onAction?: () => void;
    onDismiss?: () => void;
    className?: string;
}

/**
 * A reusable, calm AI insight card for LifeOS modules (financial, workouts,
 * nutrition, health, career, social, learning). Surfaces a proactive suggestion
 * or alert with an optional call to action and dismiss control. Refined surface
 * (rounded-2xl, ring-inset) with a subtle corner bloom in the chosen tone.
 */
export function AiSuggestionCard({
    title,
    body,
    tone = "brand",
    iconName,
    confidence,
    href,
    ctaLabel = "View suggestion",
    onAction,
    onDismiss,
    className,
}: AiSuggestionCardProps) {
    const Icon = iconName ? ICONS[iconName] : Stars01;
    const hasCta = Boolean(href) || Boolean(onAction);
    const conf = confidence ? CONFIDENCE[confidence] : null;

    return (
        <div className={cx("relative overflow-hidden rounded-2xl bg-primary p-5 ring-1 ring-secondary ring-inset", className)}>
            {/* Subtle corner bloom in the tone color */}
            <div
                className="pointer-events-none absolute -top-16 -right-12 size-48 rounded-full opacity-30 blur-3xl"
                style={{ background: `radial-gradient(circle, rgb(${GLOW[tone]} / 0.45) 0%, transparent 70%)` }}
                aria-hidden="true"
            />

            {onDismiss && (
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label="Dismiss suggestion"
                    className="absolute top-3 right-3 z-10 flex size-7 items-center justify-center rounded-lg text-fg-quaternary outline-focus-ring transition duration-100 ease-linear hover:bg-primary_hover hover:text-fg-quaternary_hover focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                    <X className="size-4" aria-hidden="true" />
                </button>
            )}

            <div className={cx("relative flex flex-col gap-3", onDismiss && "pr-8")}>
                {/* AI eyebrow pill */}
                <span
                    className={cx(
                        "flex w-fit items-center gap-1.5 rounded-full bg-secondary_subtle px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                        EYEBROW[tone],
                    )}
                >
                    <Icon className="size-3.5" aria-hidden="true" />
                    AI suggestion
                </span>

                <div className="flex flex-col gap-1">
                    <h3 className="text-md font-semibold text-primary">{title}</h3>
                    <p className="text-sm text-tertiary">{body}</p>
                </div>

                {(conf || hasCta) && (
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                        {conf ? (
                            <span className={cx("flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", conf.className)}>
                                {conf.label}
                            </span>
                        ) : (
                            <span aria-hidden="true" />
                        )}

                        {hasCta && (
                            <Button size="sm" color="secondary" href={href} onClick={href ? undefined : onAction}>
                                {ctaLabel}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
