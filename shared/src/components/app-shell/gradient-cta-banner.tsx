// @ts-nocheck
import type { FC } from "react";

import { ArrowRight } from "@untitledui/icons";
import { cx } from "@/utils/cx";

export type CtaTone = "brand" | "blue" | "emerald" | "violet" | "amber" | "rose" | "slate";

/** Vivid, on-brand gradients — intentionally consistent across light/dark for a SaaS feel. */
const GRADIENTS: Record<CtaTone, string> = {
    brand: "linear-gradient(120deg, #5925DC 0%, #7F56D9 48%, #9E77ED 100%)",
    blue: "linear-gradient(120deg, #1849A9 0%, #2E90FA 50%, #53B1FD 100%)",
    emerald: "linear-gradient(120deg, #05603A 0%, #16B364 52%, #3CCB7F 100%)",
    violet: "linear-gradient(120deg, #3538CD 0%, #6172F3 50%, #8098F9 100%)",
    amber: "linear-gradient(120deg, #B54708 0%, #F79009 52%, #FDB022 100%)",
    rose: "linear-gradient(120deg, #A11043 0%, #EE46BC 55%, #F670C7 100%)",
    slate: "linear-gradient(120deg, #0F172A 0%, #334155 55%, #475569 100%)",
};

export interface CtaAction {
    label: string;
    href: string;
}

/**
 * Corporate-grade gradient call-to-action banner. A vivid full-bleed gradient with a
 * faint grid texture, a soft light bloom, an oversized ghost icon, an eyebrow chip,
 * headline, supporting copy and one or two action buttons — the kind of "do something"
 * banner that makes the product read like a SaaS, not a passive dashboard.
 */
export function GradientCtaBanner({
    eyebrow,
    title,
    description,
    icon: Icon,
    tone = "brand",
    primary,
    secondary,
    className,
}: {
    eyebrow?: string;
    title: string;
    description?: string;
    icon?: FC<{ className?: string }>;
    tone?: CtaTone;
    primary: CtaAction;
    secondary?: CtaAction;
    className?: string;
}) {
    return (
        <div
            className={cx("relative isolate overflow-hidden rounded-2xl p-6 shadow-lg sm:p-8", className)}
            style={{ background: GRADIENTS[tone] }}
        >
            {/* Grid texture, fading toward the bottom-right */}
            <div
                className="pointer-events-none absolute inset-0 -z-10 opacity-70"
                style={{
                    backgroundImage:
                        "linear-gradient(to right, rgb(255 255 255 / 0.12) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.12) 1px, transparent 1px)",
                    backgroundSize: "36px 36px",
                    maskImage: "radial-gradient(ellipse 90% 120% at 0% 0%, black 10%, transparent 75%)",
                    WebkitMaskImage: "radial-gradient(ellipse 90% 120% at 0% 0%, black 10%, transparent 75%)",
                }}
                aria-hidden="true"
            />
            {/* Light bloom highlight */}
            <div
                className="pointer-events-none absolute -top-24 -left-12 -z-10 size-80 rounded-full opacity-40 blur-3xl"
                style={{ background: "radial-gradient(circle, rgb(255 255 255 / 0.55) 0%, transparent 70%)" }}
                aria-hidden="true"
            />
            {/* Oversized ghost icon */}
            {Icon && <Icon className="pointer-events-none absolute -right-6 -bottom-10 -z-10 size-52 text-white/10" aria-hidden="true" />}

            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex max-w-2xl flex-col gap-2.5">
                    {eyebrow && (
                        <span className="flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white ring-1 ring-white/25 ring-inset backdrop-blur-sm">
                            {Icon && <Icon className="size-3.5" aria-hidden="true" />}
                            {eyebrow}
                        </span>
                    )}
                    <h2 className="text-display-xs font-semibold tracking-tight text-white sm:text-display-sm">{title}</h2>
                    {description && <p className="text-md text-white/85">{description}</p>}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2.5">
                    <a href="#">
                        {primary.label}
                        <ArrowRight className="size-4 transition-transform duration-100 ease-linear group-hover:translate-x-0.5" aria-hidden="true" />
                    </a>
                    {secondary && (
                        <a href="#">
                            {secondary.label}
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}
