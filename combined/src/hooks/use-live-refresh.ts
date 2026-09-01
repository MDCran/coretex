"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface UseLiveRefreshOptions {
    /** Polling interval in milliseconds. Falsy disables the interval. */
    intervalMs?: number;
    /** Refresh immediately when the tab/window regains focus or visibility. */
    refreshOnFocus?: boolean;
}

/**
 * Keep a Server Component route feeling "live" by calling router.refresh() on a
 * timer (only while the tab is visible) and when the tab regains focus — no
 * websockets required. Pausing while hidden avoids needless background work.
 */
export function useLiveRefresh({ intervalMs, refreshOnFocus = true }: UseLiveRefreshOptions) {
    const router = useRouter();

    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | null = null;

        const clear = () => {
            if (timer !== null) {
                clearInterval(timer);
                timer = null;
            }
        };

        const start = () => {
            if (!intervalMs) return;
            if (timer !== null) return;
            if (document.visibilityState !== "visible") return;
            timer = setInterval(() => {
                if (document.visibilityState === "visible") {
                    router.refresh();
                }
            }, intervalMs);
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                if (refreshOnFocus) router.refresh();
                start();
            } else {
                clear();
            }
        };

        const onFocus = () => {
            if (document.visibilityState !== "visible") return;
            if (refreshOnFocus) router.refresh();
            start();
        };

        start();
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("focus", onFocus);

        return () => {
            clear();
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("focus", onFocus);
        };
    }, [router, intervalMs, refreshOnFocus]);
}
