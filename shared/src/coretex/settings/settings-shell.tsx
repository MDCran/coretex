"use client";

// Shared settings page chrome — matches notifications / ai-providers polish.
// Page headers, stat cards, toggle cards, and wide-screen column layouts.

import type { ReactNode } from "react";
import type { IconComponentType } from "@/components/base/badges/badge-types";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { cx } from "@/utils/cx";

export const SETTINGS_SURFACE = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;

export function SettingsPageHeader({
    icon: Icon,
    title,
    subtitle,
    badges,
    actions,
}: {
    icon: IconComponentType;
    title: string;
    subtitle: string;
    badges?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <header className="flex min-w-0 flex-col items-stretch gap-4 @2xl/settings-page:flex-row @2xl/settings-page:items-start @2xl/settings-page:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="grid size-11 shrink-0 place-items-center rounded-xl" style={SETTINGS_SURFACE}>
                    <Icon className="size-5 text-secondary" />
                </div>
                <div className="min-w-0 flex-1">
                    <h1 className="break-words text-display-xs font-semibold text-primary [overflow-wrap:anywhere]">{title}</h1>
                    <p className="mt-1 max-w-3xl break-words text-sm text-tertiary [overflow-wrap:anywhere]">{subtitle}</p>
                </div>
            </div>
            {(badges || actions) && (
                <div className="flex w-full min-w-0 flex-wrap items-center gap-2 @2xl/settings-page:w-auto @2xl/settings-page:shrink-0 @2xl/settings-page:justify-end">
                    {badges}
                    {actions}
                </div>
            )}
        </header>
    );
}

export function SettingsColumnHeader({
    icon: Icon,
    title,
    subtitle,
    badge,
}: {
    icon: IconComponentType;
    title: string;
    subtitle: string;
    badge?: string;
}) {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)]" style={{ border: "1px solid var(--c-border)" }}>
                <Icon className="size-5 text-secondary" />
            </span>
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-words text-md font-semibold text-primary [overflow-wrap:anywhere]">{title}</h2>
                    {badge && <Badge size="sm" color="gray" type="pill-color">{badge}</Badge>}
                </div>
                <p className="break-words text-sm text-tertiary [overflow-wrap:anywhere]">{subtitle}</p>
            </div>
        </div>
    );
}

export function SettingsStatCard({
    label,
    value,
    color = "gray",
}: {
    label: string;
    value: number | string;
    color?: "success" | "warning" | "gray" | "brand";
}) {
    const tones = {
        success: "color-mix(in srgb, var(--c-success, #22c55e) 12%, var(--surface))",
        warning: "color-mix(in srgb, var(--c-warning, #f59e0b) 12%, var(--surface))",
        brand: "color-mix(in srgb, var(--brand) 10%, var(--surface))",
        gray: "var(--surface-2)",
    };
    return (
        <div
            className="flex min-w-[6.5rem] flex-1 flex-col gap-0.5 rounded-xl px-4 py-3"
            style={{ background: tones[color], border: "1px solid var(--c-border)" }}
        >
            <span className="text-2xl font-semibold tabular-nums text-primary">{value}</span>
            <span className="text-xs text-tertiary">{label}</span>
        </div>
    );
}

export function SettingsStatusBadge({
    label,
    color,
}: {
    label: string;
    color: "success" | "warning" | "error" | "gray" | "brand";
}) {
    return (
        <BadgeWithDot type="pill-color" size="md" color={color}>
            {label}
        </BadgeWithDot>
    );
}

/** Bordered toggle row — active state highlights with brand mix. */
export function SettingsToggleCard({
    icon: Icon,
    title,
    description,
    active,
    control,
}: {
    icon: IconComponentType;
    title: string;
    description: string;
    active?: boolean;
    control: ReactNode;
}) {
    return (
        <div
            className="flex items-start justify-between gap-3 rounded-xl px-3.5 py-3.5"
            style={{
                background: "var(--surface-2)",
                border: active
                    ? "1px solid color-mix(in srgb, var(--brand) 35%, var(--c-border))"
                    : "1px solid var(--c-border)",
            }}
        >
            <div className="flex min-w-0 items-start gap-2.5">
                <Icon className="mt-0.5 size-4 shrink-0 text-quaternary" />
                <div className="min-w-0">
                    <p className="text-sm font-medium text-primary">{title}</p>
                    <p className="mt-0.5 text-xs text-tertiary">{description}</p>
                </div>
            </div>
            <div className="shrink-0">{control}</div>
        </div>
    );
}

/** Two-column settings layout on wide screens (stacks on mobile). */
export function SettingsTwoColumn({ left, right }: { left: ReactNode; right: ReactNode }) {
    return (
        <div className="grid min-w-0 grid-cols-1 items-start gap-6 @5xl/settings-page:grid-cols-2 @5xl/settings-page:gap-8">
            <div className="flex min-w-0 flex-col gap-6">{left}</div>
            <div className="flex min-w-0 flex-col gap-6">{right}</div>
        </div>
    );
}

/** Full-width section stack below header / stats. */
export function SettingsStack({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cx("flex min-w-0 flex-col gap-6", className)}>{children}</div>;
}
