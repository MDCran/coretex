"use client";

import type { FC, SVGProps } from "react";
import { AlertTriangle, CheckCircle, XCircle } from "@untitledui/icons";
import type { IntegrationConnectionState, IntegrationEnvState } from "@/lib/integrations/status";
import { cx } from "@/utils/cx";

/**
 * Unified status tones. Every status pill across Settings → Integrations
 * (per-card header badges AND the overview table) renders through
 * IntegrationStatusChip, so changing the tones here changes them everywhere.
 */
export type ChipTone = "success" | "error" | "warning" | "gray";

type IconComponent = FC<SVGProps<SVGSVGElement>>;

const ENV_LABELS: Record<IntegrationEnvState, { label: string; tone: ChipTone }> = {
    configured: { label: "Configured", tone: "success" },
    not_configured: { label: "Not configured", tone: "warning" },
    not_required: { label: "Ready", tone: "success" },
};

const CONNECTION_LABELS: Record<IntegrationConnectionState, { label: string; tone: ChipTone }> = {
    connected: { label: "Connected", tone: "success" },
    not_connected: { label: "Not connected", tone: "warning" },
    unavailable: { label: "Unavailable", tone: "gray" },
    error: { label: "Needs attention", tone: "error" },
};

/**
 * Tinted background + ring per tone so connected / not-connected / error are
 * unmistakable at a glance. Uses tokens that exist in src/styles/theme.css:
 * bg/text-*-primary + fg-*-primary semantic tokens, ring-error_subtle for
 * error, and the utility green/yellow scale for success/warning rings (there
 * is no semantic ring-success / ring-warning token).
 */
const chipClass: Record<ChipTone, string> = {
    success: "bg-success-primary text-success-primary ring-utility-green-300",
    error: "bg-error-primary text-error-primary ring-error_subtle",
    warning: "bg-warning-primary text-warning-primary ring-utility-yellow-300",
    gray: "bg-secondary_subtle text-tertiary ring-secondary",
};

const chipIcon: Record<ChipTone, { icon: IconComponent; className: string } | null> = {
    success: { icon: CheckCircle, className: "text-fg-success-primary" },
    error: { icon: XCircle, className: "text-fg-error-primary" },
    warning: { icon: AlertTriangle, className: "text-fg-warning-primary" },
    gray: null,
};

interface Props {
    env?: IntegrationEnvState;
    connection?: IntegrationConnectionState;
    showEnv?: boolean;
    showConnection?: boolean;
    connectionCount?: number;
    size?: "sm" | "md";
    className?: string;
}

export function IntegrationStatusChip({ label, tone, size = "sm" }: { label: string; tone: ChipTone; size?: "sm" | "md" }) {
    const iconMeta = chipIcon[tone];
    const Icon = iconMeta?.icon;
    return (
        <span
            className={cx(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium ring-1 ring-inset",
                size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
                chipClass[tone],
            )}
        >
            {Icon ? (
                <Icon
                    className={cx(size === "sm" ? "size-3.5" : "size-4", "shrink-0", iconMeta?.className)}
                    aria-hidden="true"
                />
            ) : (
                <span className="size-1.5 shrink-0 rounded-full bg-fg-quaternary" aria-hidden="true" />
            )}
            {label}
        </span>
    );
}

function connectionBadge(
    connection: IntegrationConnectionState,
    connectionCount?: number,
): { label: string; tone: ChipTone } {
    const base = CONNECTION_LABELS[connection];
    if (connection === "connected" && connectionCount != null && connectionCount > 1) {
        return { label: `${connectionCount} connected`, tone: base.tone };
    }
    return base;
}

export function IntegrationStatusBadges({
    env,
    connection,
    showEnv = true,
    showConnection = true,
    connectionCount,
    size = "md",
    className,
}: Props) {
    const envBadge = env ? ENV_LABELS[env] : null;
    const connBadge = showConnection && connection ? connectionBadge(connection, connectionCount) : null;

    if (!envBadge && !connBadge) return null;

    return (
        <div className={className ?? "flex flex-wrap items-center justify-end gap-1.5"}>
            {showEnv && envBadge && <IntegrationStatusChip label={envBadge.label} tone={envBadge.tone} size={size} />}
            {connBadge && <IntegrationStatusChip label={connBadge.label} tone={connBadge.tone} size={size} />}
        </div>
    );
}

export { SettingsEnvVarList as EnvVarList } from "@/components/settings/settings-notice";
