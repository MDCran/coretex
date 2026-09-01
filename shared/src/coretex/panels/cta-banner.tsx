// @ts-nocheck
"use client";

// Coretex Relay — CTABanner. A reusable, corporate-grade call-to-action banner.
// A big low-opacity @untitledui/icons glyph sits slanted in the background (clipped
// by overflow-hidden), a FeaturedIcon + headline + subtext lead, and 1-2 Buttons
// drive the action. Three surfaces: brand-RED 'gradient', frosted 'glass', and a
// quiet tokenized 'subtle'. Fully tokenized — no blue/violet chrome.

import type { FC, ReactNode } from "react";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

type IconType = FC<{ className?: string }>;

export interface CTAAction {
    label: ReactNode;
    onClick: () => void;
    icon?: IconType;
    /** Visual weight. Defaults to a sensible primary/secondary based on order. */
    color?: "primary" | "secondary" | "tertiary" | "link-gray";
}

export interface CTABannerProps {
    title: ReactNode;
    description?: ReactNode;
    icon: IconType;
    actions?: CTAAction[];
    /** brand RED gradient, frosted glass, or a quiet tokenized surface. */
    variant?: "gradient" | "glass" | "subtle";
    className?: string;
}

export const CTABanner = ({ title, description, icon: Icon, actions = [], variant = "subtle", className }: CTABannerProps) => {
    const onGradient = variant === "gradient";

    const surfaceStyle: React.CSSProperties =
        variant === "gradient"
            ? {
                  background: "linear-gradient(115deg, #ef4242 0%, #e11d48 52%, #f97316 100%)",
                  border: "1px solid color-mix(in srgb, #fff 18%, transparent)",
              }
            : variant === "glass"
              ? {
                    background: "color-mix(in srgb, var(--surface) 70%, transparent)",
                    border: "1px solid var(--c-border)",
                    backdropFilter: "blur(10px)",
                }
              : { background: "var(--surface)", border: "1px solid var(--c-border)" };

    return (
        <div
            className={cx("relative isolate overflow-hidden rounded-2xl px-5 py-5 sm:px-6", className)}
            style={{
                ...surfaceStyle,
                // Kill any inherited left accent bar (old blue stripe) from shared banner styles.
                borderLeft: surfaceStyle.border ?? "1px solid var(--c-border)",
                boxShadow: "none",
            }}
        >
            {/* Big slanted background glyph — decorative, clipped by overflow-hidden. */}
            <Icon
                aria-hidden
                className={cx(
                    "pointer-events-none absolute -right-6 -top-10 size-56 rotate-12 sm:size-64",
                    onGradient ? "text-white opacity-[0.10]" : "opacity-[0.05]",
                )}
                {...(!onGradient ? { style: { color: "var(--brand)" } } : {})}
            />

            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3.5">
                    {onGradient ? (
                        <span
                            aria-hidden
                            className="flex size-11 shrink-0 items-center justify-center rounded-xl"
                            style={{ background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.28)" }}
                        >
                            <Icon className="size-6 text-white" />
                        </span>
                    ) : (
                        <FeaturedIcon icon={Icon} color="brand" theme={variant === "glass" ? "light" : "modern"} size="lg" className="shrink-0 !ring-0" />
                    )}
                    <div className="min-w-0">
                        <h2 className={cx("text-md font-semibold sm:text-lg", onGradient ? "text-white" : "text-primary")}>{title}</h2>
                        {description && (
                            <p className={cx("mt-1 max-w-xl text-sm", onGradient ? "text-white/85" : "text-tertiary")}>{description}</p>
                        )}
                    </div>
                </div>

                {actions.length > 0 && (
                    <div className="flex shrink-0 flex-wrap items-center gap-2.5">
                        {actions.map((a, i) => {
                            const color = a.color ?? (i === 0 ? (onGradient ? "secondary" : "primary") : "secondary");
                            return (
                                <Button key={i} size="md" color={color} iconLeading={a.icon} onClick={a.onClick}>
                                    {a.label}
                                </Button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
