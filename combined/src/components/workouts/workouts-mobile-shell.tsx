"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MusicMobileWorkspaceDock } from "@/components/music/music-mobile-workspace";
import { getSpotifyStatus, type SpotifyStatus } from "@/lib/actions/spotify";

/** On mobile, pins a full-feature music panel below scrollable workout content. */
export function WorkoutsMobileShell({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<SpotifyStatus | null>(null);

    useEffect(() => {
        let active = true;
        getSpotifyStatus()
            .then((s) => active && setStatus(s))
            .catch(() => active && setStatus(null));
        return () => {
            active = false;
        };
    }, []);

    const showMusic = status?.configured && status.connected;

    return (
        <div className="flex min-h-0 flex-col max-xl:mobile-workout-split">
            <div className="min-w-0 max-xl:min-h-0 max-xl:flex-1 max-xl:overflow-y-auto max-xl:overscroll-contain">{children}</div>
            {showMusic && (
                <div className="mobile-workout-music-dock shrink-0 border-t border-secondary xl:hidden">
                    <MusicMobileWorkspaceDock aiEnabled={status.aiEnabled} />
                </div>
            )}
        </div>
    );
}
