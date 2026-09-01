// @ts-nocheck
import { useEffect, useState } from "react";
import { Headphones01, MusicNote01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Card } from "@/components/jobs/card";
import { LibrarySection } from "@/components/app-shell/spotify-player-library";
import { MusicLyricsPanel } from "@/components/music/music-lyrics-panel";
import { MusicMobileWorkspacePage } from "@/components/music/music-mobile-workspace";
import { MusicNowPlaying } from "@/components/music/music-now-playing";
import { SpotifyMoodSection } from "@/components/music/spotify-mood-section";
import { getSpotifyStatus, type SpotifyStatus } from "@/lib/actions/spotify";

export function MusicClient({ initialStatus }: { initialStatus?: SpotifyStatus }) {
    const [status, setStatus] = useState<SpotifyStatus | null>(initialStatus ?? null);

    useEffect(() => {
        let active = true;
        getSpotifyStatus()
            .then((s) => active && setStatus(s))
            .catch(() =>
                active &&
                    setStatus({
                        configured: false,
                        connected: false,
                        aiEnabled: false,
                        displayName: null,
                        scopes: [],
                        needsLibraryReconnect: false,
                        needsHistoryReconnect: false,
                    }),
            );
        return () => {
            active = false;
        };
    }, []);

    if (status == null) {
        return (
            <div className="flex min-h-48 items-center justify-center">
                <MusicNote01 className="size-8 animate-pulse text-fg-quaternary motion-reduce:animate-none" aria-hidden="true" />
            </div>
        );
    }

    if (!status.configured) {
        return (
            <Card className="flex flex-col items-center gap-4 p-8 text-center">
                <MusicNote01 className="size-10 text-fg-quaternary" aria-hidden="true" />
                <div>
                    <p className="text-md font-semibold text-primary">Spotify isn&apos;t set up</p>
                    <p className="mt-1 text-sm text-tertiary">
                        Add <span className="font-mono text-xs">SPOTIFY_CLIENT_ID</span> and{" "}
                        <span className="font-mono text-xs">SPOTIFY_CLIENT_SECRET</span> on the server.
                    </p>
                </div>
            </Card>
        );
    }

    if (!status.connected) {
        return (
            <Card className="flex flex-col items-center gap-4 p-8 text-center">
                <Headphones01 className="size-10 text-fg-quaternary" aria-hidden="true" />
                <div>
                    <p className="text-md font-semibold text-primary">Connect Spotify</p>
                    <p className="mt-1 text-sm text-tertiary">
                        Link your account to control playback, browse playlists, and build AI mood mixes.
                    </p>
                </div>
                <Button href="/settings/integrations" iconLeading={MusicNote01}>
                    Connect Spotify
                </Button>
            </Card>
        );
    }

    return (
        <div className="flex min-h-0 flex-col gap-4 xl:gap-6">
            {status.needsLibraryReconnect && (
                <div className="shrink-0 rounded-xl bg-secondary_subtle px-4 py-3 text-sm text-secondary ring-1 ring-secondary">
                    Reconnect Spotify in{" "}
                    <a href="/settings/integrations" className="font-medium text-brand-secondary hover:underline">
                        Settings → Integrations
                    </a>{" "}
                    to enable Liked Songs and adding tracks to your library.
                </div>
            )}

            <div className="min-h-0 flex-1 xl:hidden">
                <MusicMobileWorkspacePage aiEnabled={status.aiEnabled} />
            </div>

            <div className="hidden gap-6 xl:grid xl:grid-cols-[minmax(300px,380px)_1fr]">
                <Card className="flex max-h-[calc(100vh-12rem)] flex-col overflow-hidden">
                    <div className="shrink-0">
                        <MusicNowPlaying />
                    </div>
                    <MusicLyricsPanel />
                </Card>

                <Card className="flex min-h-[32rem] flex-col overflow-hidden">
                    <div className="flex min-h-0 flex-1 flex-col">
                        <LibrarySection />
                    </div>
                </Card>
            </div>

            <Card className="hidden p-5 sm:p-6 xl:block">
                <SpotifyMoodSection aiEnabled={status.aiEnabled} />
            </Card>
        </div>
    );
}
