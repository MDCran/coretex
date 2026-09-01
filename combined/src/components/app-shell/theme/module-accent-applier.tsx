"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ACCENT_STORAGE_KEY, BRAND_STOPS, accentVars, moduleAccentKey } from "./brand-presets";

/** Custom event the settings UI dispatches after changing a module/global accent. */
export const MODULE_ACCENTS_CHANGED_EVENT = "lifeos:module-accents-changed";

/**
 * Applies the active accent based on the current module: a per-module override if the
 * user set one (Settings → Appearance → Module colors), otherwise the global accent.
 * Writes the brand CSS vars on :root, so each section of the app can carry its own theme
 * color without touching any layout.
 *
 * Re-runs:
 *  - on every route change (segment may change → different module accent), and
 *  - when accent settings change live, via the `lifeos:module-accents-changed` window event
 *    and the cross-tab `storage` event — so changing a module's accent while viewing that
 *    module updates immediately without navigating away.
 */
export function ModuleAccentApplier() {
    const pathname = usePathname();
    // Keep the latest pathname in a ref so the (stable) event listeners always resolve the
    // current route's module without being re-registered on every navigation.
    const pathnameRef = useRef(pathname);
    pathnameRef.current = pathname;

    const apply = useCallback(() => {
        const segment = pathnameRef.current.split("/").filter(Boolean)[0] ?? "dashboard";
        let id: string | null = null;
        try {
            id = localStorage.getItem(moduleAccentKey(segment));
            if (!id || id === "inherit") id = localStorage.getItem(ACCENT_STORAGE_KEY) || "default";
        } catch {
            id = "default";
        }

        const vars = accentVars(id);
        const root = document.documentElement;
        for (const stop of BRAND_STOPS) {
            const key = `--color-brand-${stop}`;
            if (vars && vars[key]) root.style.setProperty(key, vars[key]);
            else root.style.removeProperty(key);
        }
    }, []);

    // Re-apply on route change.
    useEffect(() => {
        apply();
    }, [pathname, apply]);

    // Re-apply live when settings change (same tab via custom event, other tabs via storage).
    useEffect(() => {
        const onCustom = () => apply();
        const onStorage = (e: StorageEvent) => {
            if (e.key === null || e.key === ACCENT_STORAGE_KEY || e.key.startsWith("lifeos.module-accent.")) apply();
        };
        window.addEventListener(MODULE_ACCENTS_CHANGED_EVENT, onCustom);
        window.addEventListener("storage", onStorage);
        return () => {
            window.removeEventListener(MODULE_ACCENTS_CHANGED_EVENT, onCustom);
            window.removeEventListener("storage", onStorage);
        };
    }, [apply]);

    return null;
}
