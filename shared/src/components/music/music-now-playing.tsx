// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import {
    MusicNote01,
    PauseCircle,
    PlayCircle,
    Plus,
    SkipBack,
    SkipForward,
} from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Select } from "@/components/base/select/select";
import { cx } from "@/utils/cx";
import {
    addTrackToUserPlaylist,
    fetchPlaylists,
    fetchPlayback,
    playerNext,
    playerPause,
    playerPrevious,
    playerResume,
} from "@/lib/actions/spotify";
import { PlaylistArt } from "@/components/app-shell/spotify-player-library";
import { SpotifyOutputControls } from "@/components/music/spotify-output-controls";
import {
    LIKED_SONGS_PLAYLIST_ID,
    type PlaybackState,
    type PlaylistSummary,
} from "@/lib/spotify-shared";

const COVER_SIZE_KEY = "lifeos.music.coverSize";
const POLL_MS = 4000;

type CoverSize = "md" | "lg" | "xl";

const COVER_CLASS: Record<CoverSize, string> = {
    md: "size-44 sm:size-52",
    lg: "size-56 sm:size-64",
    xl: "size-72 sm:size-80",
};

function loadCoverSize(): CoverSize {
    try {
        const v = localStorage.getItem(COVER_SIZE_KEY);
        if (v === "md" || v === "lg" || v === "xl") return v;
    } catch {
        /* ignore */
    }
    if (typeof window !== "undefined" && window.innerWidth < 640) return "md";
    return "lg";
}

function fmtTime(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MusicNowPlaying({
    variant = "full",
    showAddToPlaylist = true,
}: {
    variant?: "full" | "compact";
    showAddToPlaylist?: boolean;
}) {
    const [playback, setPlayback] = useState<PlaybackState | null>(null);
    const [busy, setBusy] = useState(false);
    const [coverSize, setCoverSize] = useState<CoverSize>("lg");
    const [playlistId, setPlaylistId] = useState<string | null>(null);
    const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
    const [adding, setAdding] = useState(false);
    const errored = useRef(false);

    useEffect(() => {
        setCoverSize(loadCoverSize());
    }, []);

    useEffect(() => {
        void fetchPlaylists(0)
            .then((page) => setPlaylists(page.items))
            .catch(() => {
                /* optional */
            });
    }, []);

    const poll = useCallback(async () => {
        try {
            const p = await fetchPlayback();
            errored.current = false;
            setPlayback(p);
        } catch (e) {
            if (!errored.current) {
                errored.current = true;
                toast.error(e instanceof Error ? e.message : "Couldn't read playback");
            }
        }
    }, []);

    useEffect(() => {
        void poll();
        const id = setInterval(() => void poll(), POLL_MS);
        return () => clearInterval(id);
    }, [poll]);

    async function control(action: () => Promise<void>, optimistic?: () => void) {
        if (busy) return;
        setBusy(true);
        optimistic?.();
        try {
            await action();
            await poll();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Playback control failed");
            await poll();
        } finally {
            setBusy(false);
        }
    }

    function setSize(size: CoverSize) {
        setCoverSize(size);
        try {
            localStorage.setItem(COVER_SIZE_KEY, size);
        } catch {
            /* ignore */
        }
    }

    async function onAddToPlaylist() {
        const track = playback?.track;
        if (!track || !playlistId) {
            toast.error("Choose a playlist first");
            return;
        }
        setAdding(true);
        try {
            await addTrackToUserPlaylist(playlistId, track.uri, track.id);
            const pl = playlists.find((p) => p.id === playlistId);
            toast.success(`Added to ${pl?.name ?? "playlist"}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't add track");
        } finally {
            setAdding(false);
        }
    }

    const track = playback?.track ?? null;
    const selectedPlaylist = playlists.find((p) => p.id === playlistId) ?? null;
    const playlistSelectItems = playlists.map((p) => ({
        id: p.id,
        label: p.id === LIKED_SONGS_PLAYLIST_ID ? "Liked Songs" : p.name,
    }));
    const isPlaying = playback?.isPlaying ?? false;
    const progress = playback?.progressMs ?? 0;
    const duration = track?.durationMs ?? 0;
    const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

    const addToPlaylistSection =
        track && showAddToPlaylist ? (
            <div className={cx("w-full space-y-3 border-t border-secondary pt-3", variant === "full" && "hidden max-w-md sm:block")}>
                <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">Add to playlist</p>
                {selectedPlaylist && (
                    <div className="flex items-center gap-3 rounded-xl bg-secondary_subtle p-3 ring-1 ring-inset ring-secondary">
                        <PlaylistArt playlist={selectedPlaylist} className="size-12 rounded-none" />
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-primary">{selectedPlaylist.name}</p>
                            <p className="text-xs text-tertiary">
                                {selectedPlaylist.id === LIKED_SONGS_PLAYLIST_ID
                                    ? "Saved tracks"
                                    : `${selectedPlaylist.trackCount} tracks`}
                            </p>
                        </div>
                    </div>
                )}
                <div className={cx("flex flex-col gap-2", variant === "full" && "sm:flex-row sm:items-end")}>
                    <div className="min-w-0 flex-1">
                        <Select
                            label="Playlist"
                            placeholder="Choose playlist"
                            items={playlistSelectItems}
                            selectedKey={playlistId}
                            onSelectionChange={(key) => setPlaylistId(key ? String(key) : null)}
                            size="sm"
                        >
                            {(item) => {
                                const playlist = playlists.find((p) => p.id === item.id);
                                return (
                                    <Select.Item
                                        id={item.id}
                                        icon={
                                            playlist ? (
                                                <PlaylistArt playlist={playlist} className="size-5 shrink-0 rounded-none" />
                                            ) : undefined
                                        }
                                    >
                                        {item.label}
                                    </Select.Item>
                                );
                            }}
                        </Select>
                    </div>
                    <Button
                        size="sm"
                        iconLeading={Plus}
                        onClick={() => void onAddToPlaylist()}
                        isLoading={adding}
                        showTextWhileLoading
                        isDisabled={!playlistId}
                        className="shrink-0"
                    >
                        Add song
                    </Button>
                </div>
            </div>
        ) : null;

    if (variant === "compact") {
        return (
            <div className="shrink-0 border-b border-secondary px-3 py-2.5">
                <div className="flex items-center gap-3">
                    <div className="size-11 shrink-0 overflow-hidden rounded-lg bg-secondary ring-1 ring-secondary ring-inset">
                        {track?.albumArt ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={track.albumArt} alt="" className="size-full object-cover" />
                        ) : (
                            <div className="flex size-full items-center justify-center">
                                <MusicNote01 className="size-5 text-fg-quaternary" aria-hidden="true" />
                            </div>
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        {track ? (
                            <>
                                <p className="truncate text-sm font-semibold text-primary">{track.name}</p>
                                <p className="truncate text-xs text-tertiary">{track.artists}</p>
                            </>
                        ) : (
                            <p className="text-sm text-tertiary">Nothing playing</p>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <SpotifyOutputControls variant="compact" onChanged={() => void poll()} />
                        <Button
                            size="sm"
                            color="tertiary"
                            iconLeading={SkipBack}
                            aria-label="Previous track"
                            isDisabled={busy}
                            onClick={() => control(playerPrevious)}
                        />
                        <Button
                            size="sm"
                            color="primary"
                            iconLeading={isPlaying ? PauseCircle : PlayCircle}
                            aria-label={isPlaying ? "Pause" : "Play"}
                            isDisabled={busy}
                            onClick={() =>
                                control(isPlaying ? playerPause : playerResume, () =>
                                    setPlayback((p) => (p ? { ...p, isPlaying: !isPlaying } : p)),
                                )
                            }
                        />
                        <Button
                            size="sm"
                            color="tertiary"
                            iconLeading={SkipForward}
                            aria-label="Next track"
                            isDisabled={busy}
                            onClick={() => control(playerNext)}
                        />
                    </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                    <span className="w-9 text-right text-[11px] tabular-nums text-tertiary">{fmtTime(progress)}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-quaternary">
                        <div className="h-full rounded-full bg-brand-solid transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-9 text-[11px] tabular-nums text-tertiary">{fmtTime(duration)}</span>
                </div>
                {addToPlaylistSection}
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center gap-5 p-5 sm:p-6">
            <div className="flex w-full items-center justify-between gap-2">
                <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">Now playing</p>
                <div className="flex rounded-lg bg-secondary p-0.5 ring-1 ring-inset ring-secondary">
                    {(["md", "lg", "xl"] as const).map((s) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setSize(s)}
                            className={cx(
                                "rounded-md px-2 py-1 text-xs font-medium capitalize transition",
                                coverSize === s ? "bg-primary text-primary shadow-xs" : "text-tertiary hover:text-secondary",
                            )}
                        >
                            {s === "md" ? "S" : s === "lg" ? "M" : "L"}
                        </button>
                    ))}
                </div>
            </div>

            <div
                className={cx(
                    "overflow-hidden rounded-2xl bg-secondary shadow-lg ring-1 ring-secondary ring-inset transition-[width,height] duration-200",
                    COVER_CLASS[coverSize],
                )}
            >
                {track?.albumArt ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={track.albumArt} alt="" className="size-full object-cover" />
                ) : (
                    <div className="flex size-full items-center justify-center">
                        <MusicNote01 className="size-16 text-fg-quaternary" aria-hidden="true" />
                    </div>
                )}
            </div>

            <div className="flex w-full flex-col items-center gap-3 text-center">
                {track ? (
                    <>
                        <p className="text-lg font-semibold text-primary sm:text-xl">{track.name}</p>
                        <p className="mt-0.5 text-sm text-tertiary">{track.artists}</p>
                        {track.album && <p className="mt-1 text-xs text-quaternary">{track.album}</p>}
                    </>
                ) : (
                    <>
                        <p className="text-sm text-tertiary">Nothing playing — pick a device below to start, or open Spotify anywhere.</p>
                        <SpotifyOutputControls variant="bar" onChanged={() => void poll()} className="max-w-md" />
                    </>
                )}
            </div>

            <div className="flex w-full max-w-md items-center gap-2">
                <span className="w-10 text-right text-xs tabular-nums text-tertiary">{fmtTime(progress)}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-quaternary">
                    <div className="h-full rounded-full bg-brand-solid transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-10 text-xs tabular-nums text-tertiary">{fmtTime(duration)}</span>
            </div>

            <div className="flex items-center justify-center gap-3">
                <Button
                    size="md"
                    color="secondary"
                    iconLeading={SkipBack}
                    aria-label="Previous track"
                    isDisabled={busy}
                    onClick={() => control(playerPrevious)}
                />
                <Button
                    size="lg"
                    color="primary"
                    iconLeading={isPlaying ? PauseCircle : PlayCircle}
                    aria-label={isPlaying ? "Pause" : "Play"}
                    isDisabled={busy}
                    onClick={() =>
                        control(isPlaying ? playerPause : playerResume, () =>
                            setPlayback((p) => (p ? { ...p, isPlaying: !isPlaying } : p)),
                        )
                    }
                />
                <Button
                    size="md"
                    color="secondary"
                    iconLeading={SkipForward}
                    aria-label="Next track"
                    isDisabled={busy}
                    onClick={() => control(playerNext)}
                />
            </div>

            <SpotifyOutputControls variant="bar" onChanged={() => void poll()} className="max-w-md" />

            {addToPlaylistSection}
        </div>
    );
}
