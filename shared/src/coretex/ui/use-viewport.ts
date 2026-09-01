// @ts-nocheck
"use client";

// Coretex — tiny viewport-width hook. SSR-safe (returns a sane desktop default
// until mounted) and updates on resize. Used to drive the responsive shell:
// docks overlay instead of stealing flex space on narrow screens, and the
// sidebar auto-collapses to an icon rail below the tablet breakpoint.

import { useEffect, useState } from "react";

/** Breakpoints (px) the shell reflows at. Match Tailwind's md/lg for consistency. */
export const BP = {
    /** Below this the sidebar auto-collapses to icons. */
    sidebar: 768,
    /** Below this the terminal/browser docks overlay the main content instead of taking flex space. */
    dock: 1024,
} as const;

/** Current viewport width in px. Defaults to a desktop width before mount (SSR-safe). */
export function useViewportWidth(): number {
    const [w, setW] = useState<number>(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
    useEffect(() => {
        const onResize = () => setW(window.innerWidth);
        onResize();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return w;
}
