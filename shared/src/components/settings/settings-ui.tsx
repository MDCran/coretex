import type { ReactNode } from "react";
import { cx } from "@/utils/cx";

const GLOW: Record<string, string> = {
    brand: "127 86 217",
    emerald: "16 185 129",
    amber: "245 158 11",
    blue: "59 130 246",
};

/** A modern settings surface: rounded card with a soft accent bloom in the corner. */
export function SettingsCard({
    bloom = "brand",
    className,
    children,
}: {
    bloom?: keyof typeof GLOW;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={cx("relative overflow-hidden rounded-2xl bg-primary p-5 ring-1 ring-secondary ring-inset sm:p-6", className)}>
            <div
                className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full opacity-40 blur-3xl"
                style={{ background: `radial-gradient(circle, rgb(${GLOW[bloom]} / 0.4) 0%, transparent 70%)` }}
                aria-hidden="true"
            />
            <div className="relative">{children}</div>
        </div>
    );
}

/** Section heading used inside a SettingsCard. */
export function SettingsHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
                <h2 className="text-lg font-semibold text-primary">{title}</h2>
                {description && <p className="mt-0.5 text-sm text-tertiary">{description}</p>}
            </div>
            {action}
        </div>
    );
}

/** A labelled row with a control on the right (toggles, sliders, selects). */
export function SettingRow({
    title,
    description,
    children,
    className,
}: {
    title: string;
    description?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={cx("flex flex-wrap items-center justify-between gap-4 py-4", className)}>
            <div className="min-w-0">
                <p className="text-sm font-medium text-secondary">{title}</p>
                {description && <p className="mt-0.5 text-sm text-tertiary">{description}</p>}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}
