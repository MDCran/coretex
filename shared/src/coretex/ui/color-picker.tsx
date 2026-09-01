// @ts-nocheck
"use client";

// Coretex — Untitled UI color picker. Swatches + a portaled HSV popover that
// floats above the page (never expands rows / clips inside scroll areas).

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, XClose } from "@untitledui/icons";
import { Input } from "@/components/base/input/input";
import { cx } from "@/utils/cx";
import { AnchoredPopover } from "./anchored-popover";

export interface Swatch {
    name: string;
    value: string;
}

/** The Coretex accent palette (Untitled UI tones). */
export const COLOR_SWATCHES: Swatch[] = [
    { name: "Gray", value: "#667085" },
    { name: "Red", value: "#ef4444" },
    { name: "Orange", value: "#f97316" },
    { name: "Amber", value: "#f59e0b" },
    { name: "Green", value: "#22c55e" },
    { name: "Teal", value: "#14b8a6" },
    { name: "Blue", value: "#3b82f6" },
    { name: "Violet", value: "#8b5cf6" },
    { name: "Pink", value: "#ec4899" },
];

function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
}

function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1]!, 16);
    const r = ((n >> 16) & 0xff) / 255;
    const g = ((n >> 8) & 0xff) / 255;
    const b = (n & 0xff) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    return { h, s, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
    return `#${to(r)}${to(g)}${to(b)}`;
}

function normalizeHex(value: string): string {
    const t = (value ?? "").trim();
    if (!t) return "";
    const withHash = t.startsWith("#") ? t : `#${t}`;
    return withHash.toLowerCase();
}

function isHex6(value: string): boolean {
    return /^#[0-9a-f]{6}$/i.test(value);
}

interface Props {
    value: string;
    onChange: (value: string) => void;
    allowCustom?: boolean;
    allowNone?: boolean;
    /** full — swatch row (Appearance). compact — single trigger (color schemes). */
    variant?: "full" | "compact";
    className?: string;
}

const POPOVER_STYLE = {
    width: 280,
    background: "var(--surface)",
    border: "1px solid var(--c-border)",
    borderRadius: 12,
    boxShadow: "0 18px 50px color-mix(in srgb, #000 28%, transparent), 0 0 0 1px color-mix(in srgb, var(--c-border) 60%, transparent)",
} as const;

const HsvPanel = ({
    h, s, v, liveHex, value, allowNone, onCommitHsv, onChange, onClose,
}: {
    h: number; s: number; v: number; liveHex: string; value: string;
    allowNone: boolean;
    onCommitHsv: (nh: number, ns: number, nv: number) => void;
    onChange: (value: string) => void;
    onClose: () => void;
}) => {
    const normalized = normalizeHex(value);
    // Draft hex so typing "#e" / "#ef4" doesn't fight the parent controlled value.
    const [hexDraft, setHexDraft] = useState(() => (isHex6(normalized) ? normalized.toUpperCase() : ""));

    useEffect(() => {
        if (isHex6(normalized)) setHexDraft(normalized.toUpperCase());
        else if (!value) setHexDraft("");
    }, [normalized, value]);

    const commitHex = (raw: string) => {
        const next = normalizeHex(raw);
        if (!next) {
            if (allowNone) onChange("");
            setHexDraft("");
            return;
        }
        if (isHex6(next)) {
            onChange(next.toLowerCase());
            setHexDraft(next.toUpperCase());
        }
    };

    return (
        <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-primary">Color picker</p>
                <button type="button" onClick={onClose} className="grid size-6 place-items-center rounded-md text-quaternary transition hover:bg-[var(--surface-2)] hover:text-primary" aria-label="Close">
                    <XClose className="size-3.5" />
                </button>
            </div>

            <div
                role="presentation"
                className="relative h-32 w-full cursor-crosshair overflow-hidden rounded-lg"
                style={{
                    background: `
                        linear-gradient(to top, #000, transparent),
                        linear-gradient(to right, #fff, hsl(${h} 100% 50%))
                    `,
                }}
                onPointerDown={(e) => {
                    const el = e.currentTarget;
                    e.preventDefault();
                    const move = (ev: PointerEvent) => {
                        const r = el.getBoundingClientRect();
                        const ns = clamp((ev.clientX - r.left) / r.width, 0, 1);
                        const nv = clamp(1 - (ev.clientY - r.top) / r.height, 0, 1);
                        onCommitHsv(h, ns, nv);
                    };
                    move(e.nativeEvent);
                    const up = () => {
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", up);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                }}
            >
                <span
                    className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                    style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: liveHex }}
                />
            </div>

            <input
                type="range"
                min={0}
                max={360}
                value={Math.round(h)}
                onChange={(e) => onCommitHsv(Number(e.target.value), s, v)}
                aria-label="Hue"
                className="h-2 w-full cursor-pointer appearance-none rounded-full"
                style={{
                    background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
                }}
            />

            <div className="flex items-center gap-2">
                <span className="size-8 shrink-0 rounded-lg border border-secondary" style={{ background: liveHex }} />
                <div className="min-w-0 flex-1">
                    <Input
                        value={hexDraft}
                        placeholder="#RRGGBB"
                        onChange={(val: string) => {
                            // Allow free typing with or without #; commit when valid.
                            const cleaned = val.replace(/[^#0-9a-fA-F]/g, "").slice(0, 7);
                            setHexDraft(cleaned);
                            const next = normalizeHex(cleaned);
                            if (isHex6(next)) onChange(next.toLowerCase());
                        }}
                        onBlur={() => commitHex(hexDraft)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                commitHex(hexDraft);
                            }
                        }}
                        size="sm"
                        inputClassName="font-mono uppercase"
                    />
                </div>
                <label
                    className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg"
                    style={{ background: liveHex, border: "1px solid var(--c-border)" }}
                    title="System color picker"
                >
                    <input
                        type="color"
                        value={isHex6(normalized) ? normalized : liveHex}
                        onChange={(e) => onChange(e.target.value)}
                        className="absolute inset-0 cursor-pointer opacity-0"
                        aria-label="System color picker"
                    />
                </label>
            </div>

            {allowNone && (
                <button
                    type="button"
                    onClick={() => { onChange(""); onClose(); }}
                    className="self-start text-xs font-medium text-tertiary transition hover:text-primary"
                >
                    Clear color
                </button>
            )}
        </div>
    );
};

export const ColorPicker = ({
    value,
    onChange,
    allowCustom = true,
    allowNone = true,
    variant = "full",
    className,
}: Props) => {
    const normalized = normalizeHex(value);
    const [open, setOpen] = useState(false);
    const initial = hexToHsv(normalized) ?? { h: 0, s: 0.85, v: 0.95 };
    const [h, setH] = useState(initial.h);
    const [s, setS] = useState(initial.s);
    const [v, setV] = useState(initial.v);
    const [hexDraft, setHexDraft] = useState(() => (isHex6(normalized) ? normalized.toUpperCase() : ""));
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const hsv = hexToHsv(normalized);
        if (!hsv) return;
        setH(hsv.h);
        setS(hsv.s);
        setV(hsv.v);
    }, [normalized]);

    useEffect(() => {
        if (isHex6(normalized)) setHexDraft(normalized.toUpperCase());
        else if (!value) setHexDraft("");
    }, [normalized, value]);

    const liveHex = useMemo(() => hsvToHex(h, s, v), [h, s, v]);

    const commitHsv = (nh: number, ns: number, nv: number) => {
        setH(nh);
        setS(ns);
        setV(nv);
        onChange(hsvToHex(nh, ns, nv));
    };

    const commitHexDraft = (raw: string) => {
        const next = normalizeHex(raw);
        if (!next) {
            if (allowNone) {
                onChange("");
                setHexDraft("");
            } else if (isHex6(normalized)) {
                setHexDraft(normalized.toUpperCase());
            }
            return;
        }
        if (isHex6(next)) {
            onChange(next.toLowerCase());
            setHexDraft(next.toUpperCase());
        } else if (isHex6(normalized)) {
            setHexDraft(normalized.toUpperCase());
        }
    };

    const displayColor = isHex6(normalized) ? normalized : (normalized ? liveHex : "transparent");
    const rainbow = "conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #14b8a6, #3b82f6, #8b5cf6, #ec4899, #ef4444)";

    const panel = open && allowCustom ? (
        <AnchoredPopover
            anchorRef={triggerRef}
            onClose={() => setOpen(false)}
            align="left"
            aria-label="Color picker"
            style={POPOVER_STYLE}
        >
            <HsvPanel
                h={h} s={s} v={v}
                liveHex={liveHex}
                value={value}
                allowNone={allowNone}
                onCommitHsv={commitHsv}
                onChange={onChange}
                onClose={() => setOpen(false)}
            />
        </AnchoredPopover>
    ) : null;

    if (variant === "compact") {
        return (
            <div className={cx("flex min-w-0 items-center gap-2", className)}>
                <button
                    ref={triggerRef}
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    title="Pick color"
                    className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left transition hover:brightness-105"
                    style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                >
                    <span
                        className="size-6 shrink-0 rounded-md border border-secondary"
                        style={{ background: displayColor === "transparent" ? rainbow : displayColor }}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-secondary">
                        {isHex6(normalized) ? normalized.toUpperCase() : (normalized || "Pick color")}
                    </span>
                    <ChevronDown className={cx("size-3.5 shrink-0 text-quaternary transition", open && "rotate-180")} />
                </button>

                <label
                    className="relative flex size-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg"
                    style={{ background: displayColor === "transparent" ? "var(--surface-2)" : displayColor, border: "1px solid var(--c-border)" }}
                    title="System color picker"
                >
                    <input
                        type="color"
                        value={isHex6(normalized) ? normalized : liveHex}
                        onChange={(e) => onChange(e.target.value)}
                        className="absolute inset-0 cursor-pointer opacity-0"
                        aria-label="System color picker"
                    />
                </label>
                {panel}
            </div>
        );
    }

    return (
        <div className={cx("flex flex-col gap-2.5", className)}>
            <div className="flex flex-wrap items-center gap-1.5">
                {allowNone && (
                    <button
                        type="button"
                        onClick={() => onChange("")}
                        title="None"
                        className={cx(
                            "flex size-7 items-center justify-center rounded-full border-2 transition",
                            normalized === "" ? "border-brand-solid" : "border-secondary hover:border-primary",
                        )}
                        style={{ background: "var(--surface-2)" }}
                    >
                        <XClose className="size-3.5 text-quaternary" />
                    </button>
                )}

                {COLOR_SWATCHES.map((sw) => {
                    const selected = normalized === sw.value.toLowerCase();
                    return (
                        <button
                            key={sw.value}
                            type="button"
                            onClick={() => onChange(sw.value)}
                            title={sw.name}
                            aria-label={sw.name}
                            className={cx(
                                "flex size-7 items-center justify-center rounded-full transition",
                                selected ? "ring-2 ring-offset-2" : "hover:scale-110",
                            )}
                            style={{ background: sw.value, ...(selected ? { boxShadow: `0 0 0 2px ${sw.value}` } : {}) }}
                        >
                            {selected && <Check className="size-3.5 text-white" />}
                        </button>
                    );
                })}

                {allowCustom && (
                    <button
                        ref={triggerRef}
                        type="button"
                        title="Custom color"
                        onClick={() => setOpen((o) => !o)}
                        aria-expanded={open}
                        className={cx(
                            "relative flex size-7 items-center justify-center rounded-full transition hover:scale-110",
                            open && "ring-2 ring-offset-2",
                        )}
                        style={{
                            background: isHex6(normalized) ? normalized : rainbow,
                        }}
                    >
                        <Plus className="size-3.5 text-white drop-shadow" />
                    </button>
                )}
            </div>

            {allowCustom && (
                <div
                    className="flex w-full max-w-xs items-center gap-2 rounded-lg px-2 py-1.5"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                >
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        className="size-6 shrink-0 rounded-md border border-secondary transition hover:scale-105"
                        style={{ background: displayColor === "transparent" ? rainbow : displayColor }}
                        title="Open color picker"
                        aria-label="Open color picker"
                    />
                    <input
                        value={hexDraft}
                        placeholder="#RRGGBB"
                        spellCheck={false}
                        onChange={(e) => {
                            const cleaned = e.target.value.replace(/[^#0-9a-fA-F]/g, "").slice(0, 7);
                            setHexDraft(cleaned);
                            const next = normalizeHex(cleaned);
                            if (isHex6(next)) onChange(next.toLowerCase());
                        }}
                        onBlur={() => commitHexDraft(hexDraft)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                commitHexDraft(hexDraft);
                            }
                        }}
                        className="min-w-0 flex-1 bg-transparent font-mono text-xs uppercase text-secondary outline-none placeholder:normal-case placeholder:text-quaternary"
                    />
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        className="shrink-0 text-xs font-medium text-tertiary transition hover:text-primary"
                    >
                        Pick
                    </button>
                </div>
            )}

            {panel}
        </div>
    );
};
