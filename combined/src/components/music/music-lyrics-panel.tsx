"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { File06, LinkExternal01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { SyncedLyricsView } from "@/components/music/synced-lyrics-view";
import { fetchLyricsForTrack, getGeniusStatus, type GeniusStatus } from "@/lib/actions/genius";
import { fetchPlayback } from "@/lib/actions/spotify";
import type { GeniusLyricsResult } from "@/lib/genius-types";
import { cx } from "@/utils/cx";

const TRACK_POLL_MS = 5000;
const PLAYBACK_POLL_MS = 400;
/** Max ms to extrapolate between Spotify polls — avoids highlighting lines ahead of playback. */
const MAX_INTERPOLATE_MS = PLAYBACK_POLL_MS;

export function MusicLyricsPanel({ embedded = false }: { embedded?: boolean }) {
    const [geniusStatus, setGeniusStatus] = useState<GeniusStatus | null>(null);
    const [lyrics, setLyrics] = useState<GeniusLyricsResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progressMs, setProgressMs] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const loadedKey = useRef("");
    const inflightKey = useRef("");
    const progressRef = useRef(0);
    const playingRef = useRef(false);
    const lastPollAt = useRef(0);
    const lyricsScrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let active = true;
        getGeniusStatus()
            .then((s) => active && setGeniusStatus(s))
            .catch(() => active && setGeniusStatus({ configured: false, connected: false, displayName: null }));
        return () => {
            active = false;
        };
    }, []);

    const loadForCurrentTrack = useCallback(async () => {
        if (!geniusStatus?.configured) return;

        try {
            const playback = await fetchPlayback();
            const track = playback?.track;
            if (!track) {
                loadedKey.current = "";
                inflightKey.current = "";
                setLyrics(null);
                setError(null);
                setProgressMs(0);
                setIsPlaying(false);
                progressRef.current = 0;
                playingRef.current = false;
                return;
            }

            const key = `${track.id}:${track.name}:${track.artists}`;
            const progress = playback.progressMs ?? 0;
            progressRef.current = progress;
            playingRef.current = playback.isPlaying;
            lastPollAt.current = Date.now();
            setProgressMs(progress);
            setIsPlaying(playback.isPlaying);

            if (key === loadedKey.current) return;
            if (inflightKey.current === key) return;

            inflightKey.current = key;
            setLoading(true);
            setError(null);

            const result = await fetchLyricsForTrack(track.artists, track.name);
            if (!result) {
                setLyrics(null);
                setError("No lyrics found for this track.");
                return;
            }

            loadedKey.current = key;
            setLyrics(result);
            setError(null);
        } catch {
            setError("Could not load lyrics.");
            setLyrics(null);
        } finally {
            if (inflightKey.current) inflightKey.current = "";
            setLoading(false);
        }
    }, [geniusStatus?.configured]);

    const pollPlayback = useCallback(async () => {
        if (!geniusStatus?.configured || !loadedKey.current) return;

        try {
            const playback = await fetchPlayback();
            const track = playback?.track;
            if (!track) {
                setProgressMs(0);
                setIsPlaying(false);
                progressRef.current = 0;
                playingRef.current = false;
                return;
            }

            const key = `${track.id}:${track.name}:${track.artists}`;
            if (key !== loadedKey.current) {
                void loadForCurrentTrack();
                return;
            }

            const progress = playback.progressMs ?? 0;
            progressRef.current = progress;
            playingRef.current = playback.isPlaying;
            lastPollAt.current = Date.now();
            setProgressMs(progress);
            setIsPlaying(playback.isPlaying);
        } catch {
            /* keep last position */
        }
    }, [geniusStatus?.configured, loadForCurrentTrack]);

    useEffect(() => {
        if (!geniusStatus?.configured) return;
        void loadForCurrentTrack();
        const id = setInterval(() => void loadForCurrentTrack(), TRACK_POLL_MS);
        return () => clearInterval(id);
    }, [geniusStatus?.configured, loadForCurrentTrack]);

    const hasSynced = Boolean(lyrics?.syncedLines?.length);

    useEffect(() => {
        if (!hasSynced) return;

        void pollPlayback();
        const id = setInterval(() => void pollPlayback(), PLAYBACK_POLL_MS);
        return () => clearInterval(id);
    }, [hasSynced, pollPlayback]);

    useEffect(() => {
        if (!hasSynced || !isPlaying) return;

        const id = setInterval(() => {
            const elapsed = Date.now() - lastPollAt.current;
            if (elapsed > 0 && elapsed <= MAX_INTERPOLATE_MS) {
                setProgressMs(progressRef.current + elapsed);
            }
        }, 50);

        return () => clearInterval(id);
    }, [hasSynced, isPlaying]);

    if (geniusStatus == null) {
        return (
            <div className="border-t border-secondary px-5 py-4">
                <div className="h-24 animate-pulse rounded-lg bg-secondary_subtle motion-reduce:animate-none" />
            </div>
        );
    }

    if (!geniusStatus.configured) {
        return (
            <div className="border-t border-secondary px-5 py-4">
                <div className="flex items-start gap-3">
                    <File06 className="mt-0.5 size-5 shrink-0 text-fg-quaternary" aria-hidden="true" />
                    <div>
                        <p className="text-sm font-medium text-secondary">Lyrics</p>
                        <p className="mt-1 text-sm text-tertiary">
                            Add <span className="font-mono text-xs">GENIUS_CLIENT_ID</span> and{" "}
                            <span className="font-mono text-xs">GENIUS_CLIENT_SECRET</span> to enable Genius lyrics.
                        </p>
                        <Button href="/settings/integrations" size="sm" color="link-color" className="mt-2">
                            Integrations
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={cx("flex min-h-0 flex-1 flex-col", !embedded && "border-t border-secondary")}>
            <div className={cx("flex items-center justify-between gap-2", embedded ? "px-3 py-2" : "px-5 py-3")}>
                <div className="flex items-center gap-2">
                    <File06 className="size-4 text-fg-quaternary" aria-hidden="true" />
                    <p className="text-sm font-semibold text-secondary">Lyrics</p>
                    {hasSynced && (
                        <span className="rounded-full bg-brand-primary px-2 py-0.5 text-[10px] font-semibold tracking-wide text-brand-secondary uppercase">
                            Live
                        </span>
                    )}
                </div>
                {lyrics?.geniusUrl && (
                    <Button
                        href={lyrics.geniusUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        size="sm"
                        color="link-gray"
                        iconTrailing={LinkExternal01}
                    >
                        Genius
                    </Button>
                )}
            </div>

            <div
                ref={lyricsScrollRef}
                className={cx(
                    "min-h-0 flex-1 overflow-y-auto overscroll-contain",
                    embedded ? "px-3 pb-3" : "px-4 pb-4 sm:px-5 sm:pb-5 max-sm:min-h-[11rem] max-sm:max-h-[38dvh]",
                )}
            >
                {loading && !lyrics ? (
                    <p className="text-sm text-tertiary">Loading lyrics…</p>
                ) : error ? (
                    <p className="text-sm text-tertiary">{error}</p>
                ) : lyrics ? (
                    <div className="flex flex-col gap-3">
                        <div>
                            <p className="text-sm font-medium text-primary">{lyrics.songTitle}</p>
                            <p className="text-xs text-tertiary">{lyrics.artistName}</p>
                        </div>
                        {hasSynced && lyrics.syncedLines ? (
                            <SyncedLyricsView
                                lines={lyrics.syncedLines}
                                progressMs={progressMs}
                                isPlaying={isPlaying}
                                scrollRootRef={lyricsScrollRef}
                            />
                        ) : (
                            <>
                                <p className="text-xs text-quaternary">Synced lyrics unavailable — showing plain text.</p>
                                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-secondary">{lyrics.lyrics}</pre>
                            </>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-tertiary">Play a song on Spotify to see lyrics here.</p>
                )}
            </div>
        </div>
    );
}
