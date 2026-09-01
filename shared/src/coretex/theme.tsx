// @ts-nocheck
"use client";

// Coretex Relay — theme system. Drives the spec's data-theme custom-property
// set AND Untitled UI's own `.dark-mode` class from a single switch, so both the
// custom shell chrome and the Untitled UI components stay in sync. Dark-default.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Monitor01, Moon01, Sun } from "@untitledui/icons";
import type { ColorScheme } from "@repo/coretex/types";
import { cx } from "@/utils/cx";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "coretex-theme";

interface ThemeContextValue {
    mode: ThemeMode;
    resolved: ResolvedTheme;
    setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(mode: ThemeMode): ResolvedTheme {
    if (mode === "system") return systemPrefersDark() ? "dark" : "light";
    return mode;
}

/** Apply the resolved theme to <html>: data-theme + Untitled UI's .dark-mode class. */
function applyTheme(resolved: ResolvedTheme): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    root.classList.toggle("dark-mode", resolved === "dark");
}

function readStoredMode(): ThemeMode {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    return "dark";
}

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
    const [mode, setModeState] = useState<ThemeMode>("dark");
    const [resolved, setResolved] = useState<ResolvedTheme>("dark");

    // Hydrate from storage on mount.
    useEffect(() => {
        const initial = readStoredMode();
        setModeState(initial);
        const r = resolve(initial);
        setResolved(r);
        applyTheme(r);
    }, []);

    // React to system changes while in "system" mode.
    useEffect(() => {
        if (mode !== "system" || typeof window === "undefined") return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = () => {
            const r: ResolvedTheme = mq.matches ? "dark" : "light";
            setResolved(r);
            applyTheme(r);
        };
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, [mode]);

    const setMode = useCallback((next: ThemeMode) => {
        setModeState(next);
        if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next);
        const r = resolve(next);
        setResolved(r);
        applyTheme(r);
    }, []);

    const value = useMemo<ThemeContextValue>(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
    return ctx;
}

// ---- Color schemes: recolor the app shell live from a selected palette ----

// The shell tokens a scheme overrides (inline on <html>); cleared to revert to the data-theme stylesheet.
// IMPORTANT: a terminal color scheme recolors terminal/surface chrome ONLY — it must NEVER touch the
// brand accent (--brand / --brand-hover) or the brand-tinted active rail (--sidebar-active-bg), or the
// scheme's ANSI "blue" would cascade into every brand-driven surface and turn the whole UI blue.
const SCHEME_VARS = [
    "--app-bg", "--sidebar-bg", "--surface", "--surface-2", "--c-border",
    "--c-text-primary", "--c-text-secondary", "--c-text-muted",
    "--c-success", "--c-warning", "--c-error",
    "--sidebar-active-fg",
];

function hexToRgb(hex: string): [number, number, number] | null {
    let h = hex.trim().replace(/^#/, "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function toHex(n: number): string {
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}
/** Linear blend: t fraction of `b` mixed into `a` (both #rrggbb). */
function mix(a: string, b: string, t: number): string {
    const ra = hexToRgb(a);
    const rb = hexToRgb(b);
    if (!ra || !rb) return a;
    return `#${toHex(ra[0] + (rb[0] - ra[0]) * t)}${toHex(ra[1] + (rb[1] - ra[1]) * t)}${toHex(ra[2] + (rb[2] - ra[2]) * t)}`;
}

/** Map a ColorScheme palette onto the shell tokens (or clear them when scheme is null). */
export function applyColorScheme(scheme: ColorScheme | null): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (!scheme || !hexToRgb(scheme.background) || !hexToRgb(scheme.foreground)) {
        for (const v of SCHEME_VARS) root.style.removeProperty(v);
        try {
            localStorage.removeItem("coretex-scheme");
        } catch {
            /* storage unavailable — non-fatal */
        }
        return;
    }
    const bg = scheme.background;
    const fg = scheme.foreground;
    const set = (k: string, v: string): void => root.style.setProperty(k, v);
    set("--app-bg", bg);
    set("--sidebar-bg", mix(bg, fg, 0.03));
    set("--surface", mix(bg, fg, 0.05));
    set("--surface-2", mix(bg, fg, 0.1));
    set("--c-border", mix(bg, fg, 0.18));
    set("--c-text-primary", fg);
    set("--c-text-secondary", mix(fg, bg, 0.35));
    set("--c-text-muted", mix(fg, bg, 0.55));
    // NOTE: --brand / --brand-hover are intentionally NOT set here — the brand accent stays the user's
    // RED (#ef4242) from globals.css regardless of which terminal scheme is active. Same for
    // --sidebar-active-bg, which globals.css derives as a translucent brand tint so the active rail
    // stays red. A scheme only governs terminal + surface + semantic (success/warning/error) tokens.
    set("--c-success", scheme.green);
    set("--c-warning", scheme.yellow);
    set("--c-error", scheme.red);
    set("--sidebar-active-fg", fg);
    // Persist the scheme's base background + foreground so the pre-paint bootstrap
    // (index.html / layout.tsx) can apply them on the very first frame, before the
    // Brain settings round-trip lands — preventing a late surface/text recolor.
    try {
        localStorage.setItem(
            "coretex-scheme",
            JSON.stringify({ background: bg, foreground: fg, green: scheme.green, yellow: scheme.yellow, red: scheme.red }),
        );
    } catch {
        /* storage unavailable — non-fatal */
    }
}

/** Mounts no DOM; applies the active color scheme to the shell whenever it changes. */
export const ColorSchemeApplier = ({ scheme }: { scheme: ColorScheme | null }): null => {
    const sig = scheme ? JSON.stringify(scheme) : "";
    useEffect(() => {
        applyColorScheme(scheme);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sig]);
    return null;
};

const OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
    { mode: "light", label: "Light", icon: Sun },
    { mode: "dark", label: "Dark", icon: Moon01 },
    { mode: "system", label: "System", icon: Monitor01 },
];

/** Segmented Light / Dark / System control for the sidebar footer. */
export const ThemeToggle = ({ className }: { className?: string }) => {
    const { mode, setMode } = useTheme();
    return (
        <div
            className={cx("inline-flex items-center gap-0.5 rounded-lg p-0.5", className)}
            style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
        >
            {OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = mode === opt.mode;
                return (
                    <button
                        key={opt.mode}
                        type="button"
                        title={opt.label}
                        aria-pressed={active}
                        onClick={() => setMode(opt.mode)}
                        className="flex size-7 items-center justify-center rounded-md transition"
                        style={{
                            background: active ? "var(--sidebar-active-bg)" : "transparent",
                            color: active ? "var(--sidebar-active-fg)" : "var(--c-text-secondary)",
                        }}
                    >
                        <Icon className="size-4" />
                    </button>
                );
            })}
        </div>
    );
};
