// @ts-nocheck
"use client";

// Coretex — per-agent / per-terminal permission mode selector (§5). A compact
// segmented control over the five gating modes. Fits card widths without
// clipping Bypass into the help icon. Bypass is visually flagged and (in
// callers) admin-gated.

import type { PermissionMode } from "@repo/coretex/types";
import { cx } from "@/utils/cx";
import { HelpTooltip } from "./help-tooltip";

export const PERMISSION_MODES: { value: PermissionMode; label: string; shortLabel: string; help: string; color: string }[] = [
    // `color` is the badge/dot accent. Active segment uses a soft tint of that color.
    { value: "ask", label: "Ask", shortLabel: "Ask", help: "Confirm every action (command, file edit, tool call) before it runs.", color: "var(--brand)" },
    { value: "accept-edits", label: "Accept edits", shortLabel: "Accept", help: "Auto-apply file edits, but still confirm commands and other tools.", color: "var(--c-success)" },
    { value: "plan", label: "Plan", shortLabel: "Plan", help: "Plan only — propose steps and edits but execute nothing until you approve.", color: "var(--c-text-secondary)" },
    { value: "auto", label: "Auto", shortLabel: "Auto", help: "Run without a per-action prompt where supported. The global Security policy remains the ceiling for Coretex-managed terminal commands.", color: "var(--c-warning)" },
    { value: "bypass", label: "Bypass", shortLabel: "Bypass", help: "⚠️ Remove per-action prompts where supported. Coretex hard and configured command rules still protect Terminal Buddy and Claude Bash; external CLIs enforce their own sandbox.", color: "var(--c-error)" },
];

/** The accent color for a permission mode (for badges/dots elsewhere). */
export function permissionModeColor(mode: PermissionMode): string {
    return PERMISSION_MODES.find((m) => m.value === mode)?.color ?? "var(--brand)";
}

interface Props {
    value: PermissionMode;
    onChange: (mode: PermissionMode) => void;
    /** Disable the Bypass option (non-admin). */
    allowBypass?: boolean;
    /**
     * `compact` (default) — short labels, equal-width segments for agent cards.
     * `comfortable` — full labels for settings / deploy forms with more space.
     */
    density?: "compact" | "comfortable";
    className?: string;
}

export const PermissionModeSelect = ({
    value,
    onChange,
    allowBypass = true,
    density = "compact",
    className,
}: Props) => {
    const comfortable = density === "comfortable";

    return (
        <div className={cx("flex w-full min-w-0 items-center gap-1.5", className)}>
            <div
                role="radiogroup"
                aria-label="Permission mode"
                className={cx(
                    "flex min-w-0 flex-1 overflow-hidden rounded-lg",
                    comfortable ? "gap-0" : "gap-0",
                )}
                style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
            >
                {PERMISSION_MODES.map((m, i) => {
                    const disabled = m.value === "bypass" && !allowBypass;
                    const selected = value === m.value;
                    const label = comfortable ? m.label : m.shortLabel;
                    return (
                        <button
                            key={m.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={m.label}
                            title={m.help}
                            disabled={disabled}
                            onClick={() => {
                                if (!disabled) onChange(m.value);
                            }}
                            className={cx(
                                "relative flex min-w-0 flex-1 items-center justify-center gap-1 font-semibold transition",
                                comfortable ? "px-2.5 py-2 text-xs sm:text-sm" : "px-1 py-1.5 text-[11px] sm:px-1.5 sm:text-xs",
                                selected ? "z-[1] text-primary" : "text-tertiary hover:text-secondary",
                                disabled && "cursor-not-allowed opacity-40",
                                i > 0 && "border-l",
                            )}
                            style={{
                                borderColor: "var(--c-border)",
                                background: selected
                                    ? `color-mix(in srgb, ${m.color} 18%, var(--surface))`
                                    : undefined,
                                boxShadow: selected ? `inset 0 0 0 1px color-mix(in srgb, ${m.color} 45%, transparent)` : undefined,
                            }}
                        >
                            <span
                                className="size-1.5 shrink-0 rounded-full"
                                style={{ background: m.color }}
                                aria-hidden="true"
                            />
                            <span className="truncate">{label}</span>
                        </button>
                    );
                })}
            </div>
            <div className="shrink-0">
                <HelpTooltip
                    title="Permission mode"
                    text="Controls how this agent's actions are gated — from confirming every step (Ask) to running everything unprompted (Bypass)."
                />
            </div>
        </div>
    );
};
