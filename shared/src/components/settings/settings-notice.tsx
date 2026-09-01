// @ts-nocheck
import type { FC, ReactNode, SVGProps } from "react";
import { AlertCircle, CheckCircle, InfoCircle, XCircle } from "@untitledui/icons";
import { cx } from "@/utils/cx";

export type SettingsNoticeTone = "success" | "warning" | "error" | "info" | "brand" | "neutral";

/**
 * Convenience status that auto-selects both the icon and the tone so callers
 * stop passing their own icon (which used to drift between cards).
 */
export type SettingsNoticeStatus = "success" | "error" | "warning" | "info";

type IconComponent = FC<SVGProps<SVGSVGElement>>;

/** status → { tone, icon }. Success is always the green CheckCircle. */
const STATUS_PRESET: Record<SettingsNoticeStatus, { tone: SettingsNoticeTone; icon: IconComponent }> = {
    success: { tone: "success", icon: CheckCircle },
    error: { tone: "error", icon: XCircle },
    warning: { tone: "warning", icon: AlertCircle },
    info: { tone: "info", icon: InfoCircle },
};

/** Shared shell — neutral surface, soft border (readable in light + dark). */
const noticeShell = "rounded-xl bg-secondary_subtle ring-1 ring-inset ring-secondary";

const codeShell = "rounded-md bg-primary px-1.5 py-0.5 font-mono text-xs text-secondary ring-1 ring-inset ring-secondary";

const toneStyles: Record<
    SettingsNoticeTone,
    { root: string; icon: string; title: string; body: string; code: string }
> = {
    success: {
        root: noticeShell,
        icon: "text-fg-success-primary",
        title: "text-primary",
        body: "text-secondary",
        code: codeShell,
    },
    warning: {
        root: noticeShell,
        icon: "text-fg-warning-primary",
        title: "text-primary",
        body: "text-secondary",
        code: codeShell,
    },
    error: {
        root: noticeShell,
        icon: "text-fg-error-primary",
        title: "text-primary",
        body: "text-secondary",
        code: codeShell,
    },
    info: {
        root: noticeShell,
        icon: "text-fg-secondary",
        title: "text-primary",
        body: "text-secondary",
        code: codeShell,
    },
    brand: {
        root: noticeShell,
        icon: "text-fg-brand-primary",
        title: "text-primary",
        body: "text-secondary",
        code: codeShell,
    },
    neutral: {
        root: noticeShell,
        icon: "text-fg-tertiary",
        title: "text-primary",
        body: "text-secondary",
        code: codeShell,
    },
};

interface SettingsNoticeProps {
    /**
     * Preferred API: auto-selects the matching icon + tone so every card stays
     * consistent (success ⇒ green CheckCircle, error ⇒ red XCircle, etc.).
     * Takes precedence over explicit `tone` / `icon` when provided.
     */
    status?: SettingsNoticeStatus;
    tone?: SettingsNoticeTone;
    icon?: IconComponent;
    title: string;
    children?: ReactNode;
    className?: string;
}

/** Legible status / alert block for Settings (light + dark). */
export function SettingsNotice({ status, tone, icon, title, children, className }: SettingsNoticeProps) {
    const preset = status ? STATUS_PRESET[status] : null;
    const resolvedTone: SettingsNoticeTone = preset?.tone ?? tone ?? "neutral";
    const Icon: IconComponent = preset?.icon ?? icon ?? InfoCircle;
    const s = toneStyles[resolvedTone];
    return (
        <div className={cx("flex items-start gap-3 p-4", s.root, className)} role="status">
            <Icon className={cx("mt-0.5 size-5 shrink-0", s.icon)} aria-hidden="true" />
            <div className="min-w-0 text-sm">
                <p className={cx("font-medium", s.title)}>{title}</p>
                {children ? <div className={cx("mt-1 leading-relaxed", s.body)}>{children}</div> : null}
            </div>
        </div>
    );
}

/** Inline env var names with readable contrast on notice backgrounds. */
export function SettingsEnvCode({ children, tone = "neutral" }: { children: ReactNode; tone?: SettingsNoticeTone }) {
    return <code className={toneStyles[tone].code}>{children}</code>;
}

export function SettingsEnvVarList({ vars, tone = "info" }: { vars: string[]; tone?: SettingsNoticeTone }) {
    if (vars.length === 0) return null;
    return (
        <p className="text-secondary">
            {vars.map((v, i) => (
                <span key={v}>
                    {i > 0 && i < vars.length - 1 ? ", " : i > 0 ? " and " : ""}
                    <SettingsEnvCode tone={tone}>{v}</SettingsEnvCode>
                </span>
            ))}
        </p>
    );
}
