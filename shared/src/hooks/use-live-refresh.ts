import { useEffect } from "react";

/**
 * Event emitted when a ported LifeOS screen should reload its local data.
 *
 * The original Next.js hook called `router.refresh()`, which only works for
 * server-component routes.  Coretex screens fetch through the local Brain
 * bridge instead, so consumers can subscribe to this event and repeat their
 * query without reloading the Electron renderer.
 */
export const LIVE_REFRESH_EVENT = "coretex:live-refresh";

export interface UseLiveRefreshOptions {
    /** Polling interval in milliseconds. Falsy disables interval refreshes. */
    intervalMs?: number;
    /** Refresh when the Electron window regains focus or visibility. */
    refreshOnFocus?: boolean;
}

export function requestLiveRefresh(): void {
    window.dispatchEvent(new CustomEvent(LIVE_REFRESH_EVENT));
}

export function useLiveRefresh({ intervalMs, refreshOnFocus = true }: UseLiveRefreshOptions): void {
    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | null = null;

        const clear = () => {
            if (timer !== null) {
                clearInterval(timer);
                timer = null;
            }
        };

        const refresh = () => {
            if (document.visibilityState === "visible") requestLiveRefresh();
        };

        const start = () => {
            if (!intervalMs || timer !== null || document.visibilityState !== "visible") return;
            timer = setInterval(refresh, intervalMs);
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                if (refreshOnFocus) refresh();
                start();
            } else {
                clear();
            }
        };

        const onFocus = () => {
            if (refreshOnFocus) refresh();
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
    }, [intervalMs, refreshOnFocus]);
}
