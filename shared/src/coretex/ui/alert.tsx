// @ts-nocheck
"use client";

// Coretex — Untitled UI alert/notification. Built on FeaturedIcon + semantic
// tokens so it themes in light/dark. Used for provider errors, banners, etc.

import type { FC, ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle, InfoCircle, XClose } from "@untitledui/icons";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/utils/cx";

export type AlertColor = "brand" | "gray" | "success" | "warning" | "error";

const ICONS: Record<AlertColor, FC<{ className?: string }>> = {
    brand: InfoCircle,
    gray: InfoCircle,
    success: CheckCircle,
    warning: AlertTriangle,
    error: AlertCircle,
};

interface AlertProps {
    color?: AlertColor;
    title: string;
    children?: ReactNode;
    action?: ReactNode;
    onDismiss?: () => void;
    className?: string;
}

export const Alert = ({ color = "gray", title, children, action, onDismiss, className }: AlertProps) => (
    <div className={cx("flex items-start gap-3 rounded-xl border border-secondary bg-primary p-4", className)} role="alert">
        <FeaturedIcon icon={ICONS[color]} color={color} theme="light" size="md" className="shrink-0" />
        <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-primary">{title}</p>
            {children && <div className="mt-0.5 text-sm text-tertiary">{children}</div>}
            {action && <div className="mt-3 flex items-center gap-3">{action}</div>}
        </div>
        {onDismiss && (
            <button type="button" onClick={onDismiss} className="shrink-0 rounded-md p-0.5 text-quaternary transition hover:text-secondary" title="Dismiss">
                <XClose className="size-4" />
            </button>
        )}
    </div>
);
