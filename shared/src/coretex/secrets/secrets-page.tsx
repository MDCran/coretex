"use client";

import type { ComponentType, ReactNode } from "react";
import { ShieldTick } from "@untitledui/icons";
import { cx } from "@/utils/cx";

/** Copy a plaintext credential, then remove it if the clipboard still contains that value. */
export async function copySecretToClipboard(value: string, clearAfterMs = 30_000): Promise<void> {
    try {
        await navigator.clipboard?.writeText(value);
        window.setTimeout(async () => {
            try {
                if (await navigator.clipboard?.readText() === value) await navigator.clipboard.writeText("");
            } catch {
                // Clipboard reads may be blocked by the OS; clearing is best-effort.
            }
        }, clearAfterMs);
    } catch {
        // Clipboard access can be denied outside a user gesture.
    }
}

type SecretsIcon = ComponentType<{ className?: string }>;

export type SecretsStat = {
    label: string;
    value: ReactNode;
    color?: string;
};

export type SecretsTabItem = {
    id: string;
    label: string;
    icon: SecretsIcon;
    count?: number;
};

/**
 * Shared frame for every credential surface (global and project-scoped).
 * It keeps hierarchy, spacing, badges, and responsive behavior identical while
 * allowing each page to supply its own actions and tab model.
 */
export const SecretsPageLayout = ({
    icon: Icon,
    title,
    description,
    badge = "Stored locally",
    stats = [],
    actions,
    navigation,
    compact = false,
    hideHeader = false,
    children,
    className,
}: {
    icon: SecretsIcon;
    title: string;
    description: ReactNode;
    badge?: string | null;
    stats?: SecretsStat[];
    actions?: ReactNode;
    navigation?: ReactNode;
    compact?: boolean;
    /** Preserve the shared body sizing while a parent Secrets page owns the identity header. */
    hideHeader?: boolean;
    children: ReactNode;
    className?: string;
}) => (
    <div className={cx("flex h-full min-h-0 flex-col gap-4", className)}>
        {(!hideHeader || actions || navigation) && (
            <header
                className="shrink-0 overflow-hidden rounded-xl"
                style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
            >
            {!hideHeader && <div className={cx("flex flex-wrap items-center gap-3", compact ? "px-4 py-3" : "px-4 py-4 sm:px-5")}>
                <div
                    className={cx("flex shrink-0 items-center justify-center rounded-lg", compact ? "size-9" : "size-10")}
                    style={{ background: "color-mix(in srgb, var(--brand) 14%, var(--surface))" }}
                >
                    <Icon className={cx(compact ? "size-4" : "size-5", "text-brand-secondary")} />
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className={cx("font-semibold text-primary", compact ? "text-sm" : "text-lg")}>{title}</h1>
                        {badge && (
                            <span
                                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-secondary"
                                style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                            >
                                <ShieldTick className="size-3 text-success-primary" />
                                {badge}
                            </span>
                        )}
                    </div>
                    <p className={cx("mt-0.5 max-w-3xl text-tertiary", compact ? "text-xs" : "text-xs sm:text-sm")}>{description}</p>
                </div>

                {stats.length > 0 && (
                    <div className="hidden items-center gap-1.5 xl:flex">
                        {stats.map((stat) => (
                            <div
                                key={stat.label}
                                className="min-w-20 rounded-lg px-2.5 py-1.5"
                                style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                            >
                                <div className="flex items-center gap-1.5">
                                    {stat.color && <span className="size-1.5 rounded-full" style={{ background: stat.color }} />}
                                    <span className="text-sm font-semibold tabular-nums text-primary">{stat.value}</span>
                                </div>
                                <p className="text-[10px] text-quaternary">{stat.label}</p>
                            </div>
                        ))}
                    </div>
                )}

                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>}

            {hideHeader && actions && <div className="flex flex-wrap items-center justify-end gap-2 px-3 py-2.5">{actions}</div>}

            {navigation && (
                <div className="border-t px-3 sm:px-4" style={{ borderColor: "var(--c-border)" }}>
                    {navigation}
                </div>
            )}
            </header>
        )}

        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
);

export const SecretsTabs = ({
    items,
    value,
    onChange,
    ariaLabel = "Secrets sections",
}: {
    items: SecretsTabItem[];
    value: string;
    onChange: (id: string) => void;
    ariaLabel?: string;
}) => (
    <div role="tablist" aria-label={ariaLabel} className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {items.map((item) => {
            const active = value === item.id;
            const Icon = item.icon;
            return (
                <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onChange(item.id)}
                    className={cx(
                        "relative inline-flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition sm:text-sm",
                        active ? "text-primary" : "text-tertiary hover:text-secondary",
                    )}
                >
                    <Icon className="size-4" />
                    {item.label}
                    {item.count !== undefined && (
                        <span
                            className="min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold tabular-nums"
                            style={{ background: "var(--surface-2)", color: "var(--c-text-muted)" }}
                        >
                            {item.count}
                        </span>
                    )}
                    {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full" style={{ background: "var(--brand)" }} />}
                </button>
            );
        })}
    </div>
);

export const SecretsToolbar = ({ children, className }: { children: ReactNode; className?: string }) => (
    <div
        className={cx("flex flex-wrap items-center gap-2 rounded-xl p-3", className)}
        style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
    >
        {children}
    </div>
);

export const SecretsContentPanel = ({
    children,
    className,
    padded = false,
}: {
    children: ReactNode;
    className?: string;
    padded?: boolean;
}) => (
    <div
        className={cx("min-h-0 overflow-hidden rounded-xl", padded && "p-4", className)}
        style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
    >
        {children}
    </div>
);

export const SecretsEmptyState = ({
    icon: Icon,
    title,
    description,
    action,
}: {
    icon: SecretsIcon;
    title: string;
    description: ReactNode;
    action?: ReactNode;
}) => (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <div
            className="flex size-12 items-center justify-center rounded-full"
            style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
        >
            <Icon className="size-6 text-tertiary" />
        </div>
        <div className="max-w-sm">
            <p className="text-sm font-semibold text-primary">{title}</p>
            <p className="mt-0.5 text-xs text-tertiary">{description}</p>
        </div>
        {action}
    </div>
);
