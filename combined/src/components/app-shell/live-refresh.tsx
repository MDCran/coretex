"use client";

import { useLiveRefresh } from "@/hooks/use-live-refresh";

interface LiveRefreshProps {
    /** Polling interval in milliseconds. Defaults to 5 minutes. */
    intervalMs?: number;
    /** Refresh immediately when the tab/window regains focus or visibility. */
    refreshOnFocus?: boolean;
}

/**
 * Drop-in client island that keeps a Server Component route fresh. Render
 * <LiveRefresh /> anywhere inside a server page to opt into auto-refresh.
 */
export function LiveRefresh({ intervalMs = 300000, refreshOnFocus = true }: LiveRefreshProps) {
    useLiveRefresh({ intervalMs, refreshOnFocus });
    return null;
}
