// @ts-nocheck
"use client";

// Coretex — applies persisted appearance settings that affect the live renderer
// (and, on the desktop build, the OS window via Electron IPC). Mounted once by the
// app shell. Renders nothing; it only runs effects when the relevant settings change.

import { useEffect } from "react";
import type { CoretexConfig } from "@repo/coretex/types";

interface ElectronBridge {
    send?: (channel: string, data?: unknown) => void;
}

/** Darken a #RRGGBB hex by mixing toward black (amount 0..1) for a hover tone. */
function darken(hex: string, amount: number): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const f = 1 - amount;
    const r = Math.round(((n >> 16) & 0xff) * f);
    const g = Math.round(((n >> 8) & 0xff) * f);
    const b = Math.round((n & 0xff) * f);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// ---- Shared locale store ----------------------------------------------------
// A module-level snapshot of the user's locale prefs, kept in sync by SettingsEffects.
// Shared date/number/cost formatters read these getters so a single settings write
// re-formats everything (effect re-runs on change, formatters read on next call).

export interface LocalePrefs {
    dateFormat: string;
    timeFormat: "12h" | "24h";
    units: "imperial" | "metric";
    currency: string;
}

const DEFAULT_LOCALE: LocalePrefs = { dateFormat: "YYYY-MM-DD", timeFormat: "24h", units: "metric", currency: "USD" };

let currentLocale: LocalePrefs = { ...DEFAULT_LOCALE };

/** Read the active locale snapshot (used by shared formatters). */
export function getLocalePrefs(): LocalePrefs {
    return currentLocale;
}
export function getDateFormat(): string {
    return currentLocale.dateFormat;
}
export function getTimeFormat(): "12h" | "24h" {
    return currentLocale.timeFormat;
}
export function getUnits(): "imperial" | "metric" {
    return currentLocale.units;
}
export function getCurrency(): string {
    return currentLocale.currency;
}

export const SettingsEffects = ({ settings }: { settings: CoretexConfig | null }) => {
    const win = settings?.appearance.window;
    const ctx = settings?.appearance.coretex;
    const tabs = settings?.appearance.tabs;

    const paneAnimations = win?.paneAnimations !== false;
    const alwaysOnTop = win?.alwaysOnTop === true;
    const hideTitleBar = win?.hideTitleBar === true;
    const adminShield = win?.adminShield === true;
    const opacity = ctx?.windowOpacity ?? 100;
    const blurRadius = ctx?.blurRadius ?? 0;
    const acrylicTabs = tabs?.acrylic === true;
    const accent = settings?.appearance.application.accent ?? "";
    const antialiasing = settings?.rendering.render.antialiasing ?? "grayscale";

    const locale = settings?.appearance.locale;
    const dateFormat = locale?.dateFormat ?? DEFAULT_LOCALE.dateFormat;
    const timeFormat = locale?.timeFormat ?? DEFAULT_LOCALE.timeFormat;
    const units = locale?.units ?? DEFAULT_LOCALE.units;
    const currency = locale?.currency ?? DEFAULT_LOCALE.currency;

    // Subtrees the desktop main process consumes live (login item + config:apply).
    const startup = settings?.startup;
    const tray = settings?.appearance.tray;
    const rendering = settings?.rendering;
    const launchOnLogin = startup?.launchOnLogin === true;
    const acrylicWhenUnfocused = win?.acrylicWhenUnfocused === true;
    const language = settings?.startup.language ?? "system";
    const softwareRendering = rendering?.render.softwareRendering === true || rendering?.render.graphicsApi === "software";
    const disablePartial = rendering?.render.disablePartialSwapchain === true;
    // Serialize the live-config payload so the effect only fires when a value
    // inside one of these subtrees actually changes (not on every settings write).
    const liveConfigKey = JSON.stringify({ startup, tray, window: win, rendering });

    // Pane animations off → a global class that CSS uses to drop transitions (spinners keep running).
    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle("no-pane-animations", !paneAnimations);
    }, [paneAnimations]);

    // App accent color → drive the brand CSS vars on :root. Empty resets to the
    // stylesheet default by removing the inline overrides.
    useEffect(() => {
        const root = document.documentElement;
        const valid = /^#?([0-9a-f]{6})$/i.test(accent.trim());
        if (valid) {
            const hex = accent.trim().startsWith("#") ? accent.trim() : `#${accent.trim()}`;
            root.style.setProperty("--brand", hex);
            root.style.setProperty("--brand-hover", darken(hex, 0.12));
            // Persist so the pre-paint bootstrap (index.html / layout.tsx) can apply the
            // accent on the very first frame, before the Brain settings round-trip lands.
            try {
                localStorage.setItem("coretex-accent", hex);
            } catch {
                /* storage unavailable — non-fatal */
            }
        } else {
            root.style.removeProperty("--brand");
            root.style.removeProperty("--brand-hover");
            try {
                localStorage.removeItem("coretex-accent");
            } catch {
                /* storage unavailable — non-fatal */
            }
        }
    }, [accent]);

    // Acrylic tabs → toggle a root class + publish the blur radius as a CSS var so
    // globals.css can drive backdrop-filter: blur(var(--blur-radius)).
    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle("acrylic-tabs", acrylicTabs);
        root.classList.toggle("acrylic-unfocused", acrylicWhenUnfocused);
        root.style.setProperty("--blur-radius", `${Math.max(0, blurRadius)}px`);
    }, [acrylicTabs, acrylicWhenUnfocused, blurRadius]);

    // Admin shield → a root class CSS uses to draw the elevated-process marker border.
    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle("admin-shield", adminShield);
    }, [adminShield]);

    // Font antialiasing → drive -webkit-font-smoothing / font-smooth on the root.
    useEffect(() => {
        const root = document.documentElement;
        const webkit = antialiasing === "subpixel" ? "auto" : antialiasing === "none" ? "none" : "antialiased";
        const moz = antialiasing === "grayscale" ? "grayscale" : "auto";
        root.style.setProperty("-webkit-font-smoothing", webkit);
        root.style.setProperty("-moz-osx-font-smoothing", moz);
        // Standard `font-smooth` (limited support) mirrors the intent for non-webkit hosts.
        root.style.setProperty("font-smooth", antialiasing === "none" ? "never" : "always");
    }, [antialiasing]);

    // Software rendering / partial-swapchain flags → CSS classes for compatibility styling.
    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle("software-rendering", softwareRendering);
        root.classList.toggle("disable-partial-swapchain", disablePartial);
    }, [softwareRendering, disablePartial]);

    // Startup language → document lang (system keeps browser default).
    useEffect(() => {
        if (language === "system" || !language) {
            document.documentElement.removeAttribute("lang");
        } else {
            document.documentElement.lang = language;
        }
    }, [language]);

    // Locale prefs → publish into the shared module store the formatters read.
    useEffect(() => {
        currentLocale = { dateFormat, timeFormat, units, currency };
    }, [dateFormat, timeFormat, units, currency]);

    // Desktop window chrome via Electron IPC (no-op on web — the bridge isn't present).
    useEffect(() => {
        const api = (window as unknown as { electronAPI?: ElectronBridge }).electronAPI;
        api?.send?.("window:apply", { alwaysOnTop, opacity, hideTitleBar });
    }, [alwaysOnTop, opacity, hideTitleBar]);

    // OS login item → mirror launchOnLogin to the main process so it updates the
    // Windows startup entry live. No-op on web (no bridge).
    useEffect(() => {
        const api = (window as unknown as { electronAPI?: ElectronBridge }).electronAPI;
        api?.send?.("os:setLoginItem", { openAtLogin: launchOnLogin });
    }, [launchOnLogin]);

    // Live config push → mirror the startup / tray / window / rendering subtrees so the
    // main process honors tray, auto-hide-on-blur, run-in-background, new-instance, and
    // login edits without a restart. Re-runs whenever any of those values change (keyed
    // on the serialized snapshot). No-op on web (no bridge).
    useEffect(() => {
        if (!startup || !rendering) return;
        const api = (window as unknown as { electronAPI?: ElectronBridge }).electronAPI;
        api?.send?.("config:apply", {
            startup,
            appearance: { tray, window: win },
            rendering,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveConfigKey]);

    // Windows default terminal application registration (startup.defaultTerminalApp).
    useEffect(() => {
        if (startup?.defaultTerminalApp !== true) return;
        const api = (window as unknown as { electronAPI?: ElectronBridge }).electronAPI;
        api?.send?.("os:setDefaultTerminal", { enabled: true });
    }, [startup?.defaultTerminalApp]);

    return null;
};
