import type { FC, ReactNode } from "react";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

export type ModuleHeroAction = {
    label: string;
    href: string;
    icon?: FC<{ className?: string }>;
    color?: "primary" | "secondary";
};

/** Per-module accent: an RGB triplet for the gradient glow + matching chip/eyebrow classes. */
const THEMES = {
    brand: { glow: "127 86 217", chip: "bg-brand-primary text-brand-secondary ring-brand", eyebrow: "text-brand-secondary" },
    emerald: { glow: "16 185 129", chip: "bg-success-secondary text-success-primary ring-success-primary/20", eyebrow: "text-success-primary" },
    amber: { glow: "245 158 11", chip: "bg-warning-secondary text-warning-primary ring-warning-primary/20", eyebrow: "text-warning-primary" },
    blue: { glow: "59 130 246", chip: "bg-brand-primary text-brand-secondary ring-brand", eyebrow: "text-brand-secondary" },
    red: { glow: "239 68 68", chip: "bg-error-secondary text-error-primary ring-error-primary/20", eyebrow: "text-error-primary" },
} as const;

/**
 * Lively module hero banner — a gradient-glow card with an icon chip, eyebrow,
 * heading, description and call-to-action buttons. Mirrors the workouts hero so
 * every module's landing page opens with the same energy.
 */
export function ModuleHero({
    eyebrow,
    title,
    description,
    icon: Icon,
    theme = "brand",
    actions,
    children,
}: {
    eyebrow: string;
    title: string;
    description?: ReactNode;
    icon: FC<{ className?: string }>;
    theme?: keyof typeof THEMES;
    actions?: ModuleHeroAction[];
    children?: ReactNode;
}) {
    const t = THEMES[theme];
    return (
        <div className="relative overflow-hidden rounded-2xl bg-primary ring-1 ring-secondary ring-inset">
            {/* Fading grid texture for a premium, engineered feel. */}
            <div
                className="pointer-events-none absolute inset-0 opacity-[0.6]"
                style={{
                    backgroundImage:
                        "linear-gradient(to right, var(--color-border-secondary) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border-secondary) 1px, transparent 1px)",
                    backgroundSize: "34px 34px",
                    maskImage: "radial-gradient(ellipse 75% 90% at 15% 0%, black 0%, transparent 75%)",
                    WebkitMaskImage: "radial-gradient(ellipse 75% 90% at 15% 0%, black 0%, transparent 75%)",
                }}
                aria-hidden="true"
            />
            {/* Soft accent blooms behind the content. */}
            <div
                className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full opacity-50 blur-3xl"
                style={{ background: `radial-gradient(circle, rgb(${t.glow} / 0.5) 0%, transparent 70%)` }}
                aria-hidden="true"
            />
            <div
                className="pointer-events-none absolute -bottom-24 left-1/4 size-56 rounded-full opacity-30 blur-3xl"
                style={{ background: `radial-gradient(circle, rgb(${t.glow} / 0.35) 0%, transparent 70%)` }}
                aria-hidden="true"
            />
            {/* Top sheen — a faint light edge that reads as glass. */}
            <div
                className="pointer-events-none absolute inset-x-0 top-0 h-px"
                style={{ background: `linear-gradient(to right, transparent, rgb(${t.glow} / 0.5), transparent)` }}
                aria-hidden="true"
            />
            <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between lg:p-8">
                <div className="flex max-w-xl flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <span className={cx("flex size-10 items-center justify-center rounded-xl ring-1 ring-inset", t.chip)}>
                            <Icon className="size-5" aria-hidden="true" />
                        </span>
                        <p className={cx("text-sm font-semibold", t.eyebrow)}>{eyebrow}</p>
                    </div>
                    <h2 className="text-display-xs font-semibold text-primary sm:text-display-sm">{title}</h2>
                    {description && <p className="text-md text-tertiary">{description}</p>}
                    {actions && actions.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                            {actions.map((a) => (
                                <Button
                                    key={a.href}
                                    size="lg"
                                    color={a.color ?? "primary"}
                                    href={a.href}
                                    iconLeading={a.icon ? <a.icon data-icon className="size-5" /> : undefined}
                                >
                                    {a.label}
                                </Button>
                            ))}
                        </div>
                    )}
                </div>
                {children && <div className="shrink-0">{children}</div>}
            </div>
        </div>
    );
}
