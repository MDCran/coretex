"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
    ACCENTS,
    ACCENT_STORAGE_KEY,
    BRAND_STOPS,
    DENSITIES,
    DENSITY_STORAGE_KEY,
    type AccentId,
    type Density,
} from "./brand-presets";

function applyAccent(id: AccentId) {
    if (typeof document === "undefined") return;
    const preset = ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
    const root = document.documentElement;
    for (const stop of BRAND_STOPS) {
        const v = preset.scale?.[stop];
        if (v) root.style.setProperty(`--color-brand-${stop}`, `rgb(${v})`);
        else root.style.removeProperty(`--color-brand-${stop}`);
    }
}

function applyDensity(d: Density) {
    if (typeof document === "undefined") return;
    const px = DENSITIES.find((x) => x.id === d)?.rootFontPx ?? 16;
    document.documentElement.style.fontSize = px === 16 ? "" : `${px}px`;
}

interface ThemeConfigApi {
    accent: AccentId;
    density: Density;
    setAccent: (id: AccentId) => void;
    setDensity: (d: Density) => void;
}

const ThemeConfigContext = createContext<ThemeConfigApi | null>(null);

export function useThemeConfig(): ThemeConfigApi {
    return (
        useContext(ThemeConfigContext) ?? { accent: "default", density: "comfortable", setAccent: () => {}, setDensity: () => {} }
    );
}

export function ThemeConfigProvider({ children }: { children: ReactNode }) {
    const [accent, setAccentState] = useState<AccentId>("default");
    const [density, setDensityState] = useState<Density>("comfortable");

    // Sync React state from what the early script already applied.
    useEffect(() => {
        try {
            const a = localStorage.getItem(ACCENT_STORAGE_KEY) as AccentId | null;
            const d = localStorage.getItem(DENSITY_STORAGE_KEY) as Density | null;
            if (a) setAccentState(a);
            if (d) setDensityState(d);
        } catch {
            /* ignore */
        }
    }, []);

    const setAccent = useCallback((id: AccentId) => {
        applyAccent(id);
        try {
            localStorage.setItem(ACCENT_STORAGE_KEY, id);
        } catch {
            /* ignore */
        }
        setAccentState(id);
    }, []);

    const setDensity = useCallback((d: Density) => {
        applyDensity(d);
        try {
            localStorage.setItem(DENSITY_STORAGE_KEY, d);
        } catch {
            /* ignore */
        }
        setDensityState(d);
    }, []);

    return <ThemeConfigContext.Provider value={{ accent, density, setAccent, setDensity }}>{children}</ThemeConfigContext.Provider>;
}

