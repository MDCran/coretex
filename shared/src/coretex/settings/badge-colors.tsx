// @ts-nocheck
"use client";

// Coretex — customizable badge colors for task priorities + agent roles.
// Compact selector per row → anchored popover (near the click) with swatches + picker.
// Writes to appearance.badges.* (named BadgeColor tokens only).

import { useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "@untitledui/icons";
import type { BadgeColor, CoretexConfig } from "@repo/coretex/types";
import { Badge } from "@/components/base/badges/badges";
import { cx } from "@/utils/cx";
import type { CoretexActions } from "../use-coretex";
import { priorityColor, roleColor } from "../use-coretex";
import { roleLabel, titleCase } from "../labels";
import { SettingsSection } from "./controls";
import { ColorPicker } from "../ui/color-picker";
import { AnchoredPopover } from "../ui/anchored-popover";

const BADGE_COLORS: BadgeColor[] = ["gray", "brand", "blue", "sky", "indigo", "purple", "pink", "orange", "warning", "success", "error", "slate"];

/** Representative hex per named BadgeColor (brand uses Coretex red as stand-in). */
const SWATCH: Record<BadgeColor, string> = {
    gray: "#667085",
    brand: "#ef4242",
    blue: "#2970ff",
    sky: "#0ba5ec",
    indigo: "#6172f3",
    purple: "#7a5af8",
    pink: "#ee46bc",
    orange: "#ef6820",
    warning: "#f79009",
    success: "#17b26a",
    error: "#f04438",
    slate: "#475467",
};

const PANEL_STYLE = {
    width: 300,
    maxHeight: "min(420px, calc(100vh - 24px))",
    background: "var(--surface)",
    border: "1px solid var(--c-border)",
    borderRadius: 12,
    boxShadow: "0 18px 50px color-mix(in srgb, #000 28%, transparent), 0 0 0 1px color-mix(in srgb, var(--c-border) 60%, transparent)",
} as const;

const PRIORITIES = ["low", "medium", "high", "critical"];
const ROLES = ["orchestrator", "researcher", "developer", "reviewer", "writer", "analyst", "devops", "qa", "custom"];

function parseHex(hex: string): [number, number, number] | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Snap a free-form hex to the nearest named badge color token. */
function nearestBadgeColor(hex: string): BadgeColor {
    const rgb = parseHex(hex);
    if (!rgb) return "gray";
    let best: BadgeColor = "gray";
    let bestDist = Infinity;
    for (const c of BADGE_COLORS) {
        const other = parseHex(SWATCH[c]);
        if (!other) continue;
        const d = (rgb[0] - other[0]) ** 2 + (rgb[1] - other[1]) ** 2 + (rgb[2] - other[2]) ** 2;
        if (d < bestDist) {
            bestDist = d;
            best = c;
        }
    }
    return best;
}

export const ColorSelector = ({
    label,
    preview,
    current,
    onChange,
}: {
    label: string;
    preview: ReactNode;
    current: BadgeColor;
    onChange: (c: BadgeColor) => void;
}) => {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(current);

    const toggle = () => {
        if (!open) setDraft(current);
        setOpen((v) => !v);
    };

    const apply = (c: BadgeColor) => {
        setDraft(c);
        onChange(c);
    };

    return (
        <div className="flex items-center justify-between gap-4 py-2.5">
            <div className="min-w-0 shrink-0">{preview}</div>
            <button
                ref={triggerRef}
                type="button"
                onClick={toggle}
                className="flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 transition hover:brightness-105"
                style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                aria-haspopup="dialog"
                aria-expanded={open}
            >
                <span
                    className="size-5 shrink-0 rounded-full"
                    style={{
                        background: current === "brand" ? "var(--brand)" : SWATCH[current],
                        boxShadow: "0 0 0 1px color-mix(in srgb, var(--c-border) 80%, transparent)",
                    }}
                />
                <span className="text-sm font-medium text-secondary">{titleCase(current)}</span>
                <ChevronDown className={cx("size-3.5 text-quaternary transition", open && "rotate-180")} />
            </button>

            {open && (
                <AnchoredPopover
                    anchorRef={triggerRef}
                    onClose={() => setOpen(false)}
                    align="right"
                    aria-label={`Choose color for ${label}`}
                    style={PANEL_STYLE}
                >
                    <div className="flex max-h-[inherit] flex-col overflow-hidden">
                        <div className="shrink-0 border-b px-3.5 py-2.5" style={{ borderColor: "var(--c-border)" }}>
                            <p className="text-sm font-semibold text-primary">{label}</p>
                            <p className="mt-0.5 text-xs text-tertiary">Swatches or custom hex</p>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
                            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                                <span className="text-xs font-medium text-tertiary">Preview</span>
                                <Badge color={draft} size="md">{label}</Badge>
                            </div>

                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-quaternary">Swatches</p>
                            <div className="mb-4 grid grid-cols-6 gap-1.5">
                                {BADGE_COLORS.map((c) => {
                                    const selected = c === draft;
                                    return (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => apply(c)}
                                            title={titleCase(c)}
                                            aria-label={titleCase(c)}
                                            aria-pressed={selected}
                                            className={cx(
                                                "flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition",
                                                selected ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]",
                                            )}
                                        >
                                            <span
                                                className="relative flex size-7 items-center justify-center rounded-full"
                                                style={{
                                                    background: c === "brand" ? "var(--brand)" : SWATCH[c],
                                                    boxShadow: selected
                                                        ? "0 0 0 2px var(--surface), 0 0 0 3px var(--brand)"
                                                        : "0 0 0 1px color-mix(in srgb, var(--c-border) 70%, transparent)",
                                                }}
                                            >
                                                {selected && <Check className="size-3 text-white drop-shadow" />}
                                            </span>
                                            <span className="truncate text-[9px] font-medium text-quaternary">{titleCase(c)}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-quaternary">Custom</p>
                            <p className="mb-2 text-xs text-tertiary">
                                Matches closest badge color ({titleCase(draft)}).
                            </p>
                            <ColorPicker
                                value={SWATCH[draft]}
                                onChange={(hex) => {
                                    if (!hex) return;
                                    apply(nearestBadgeColor(hex));
                                }}
                                allowNone={false}
                                variant="full"
                            />
                        </div>
                    </div>
                </AnchoredPopover>
            )}
        </div>
    );
};

export const BadgeColorSettings = ({ settings, actions }: { settings: CoretexConfig; actions: CoretexActions }) => (
    <SettingsSection title="Badge colors" description="Color-coordinate task priorities and agent roles. Changes apply instantly.">
        <div className="py-1">
            <p className="pb-1 text-xs font-semibold uppercase tracking-wider text-quaternary">Priority</p>
            {PRIORITIES.map((p) => {
                const color = priorityColor(p, settings);
                const label = titleCase(p);
                return (
                    <ColorSelector
                        key={p}
                        label={label}
                        current={color}
                        preview={<Badge color={color} size="md">{label}</Badge>}
                        onChange={(c) => actions.setSetting(`appearance.badges.priority.${p}`, c)}
                    />
                );
            })}
        </div>

        <div className="py-1">
            <p className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-quaternary">Role</p>
            {ROLES.map((r) => {
                const color = roleColor(r, settings);
                const label = roleLabel(r);
                return (
                    <ColorSelector
                        key={r}
                        label={label}
                        current={color}
                        preview={<Badge color={color} size="md">{label}</Badge>}
                        onChange={(c) => actions.setSetting(`appearance.badges.role.${r}`, c)}
                    />
                );
            })}
        </div>
    </SettingsSection>
);
