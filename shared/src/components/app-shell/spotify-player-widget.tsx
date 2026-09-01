// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import {
    Headphones01,
    LayoutRight,
    LinkExternal01,
    MagicWand01,
    MusicNote01,
    PauseCircle,
    PlayCircle,
    SkipBack,
    SkipForward,
    Stars02,
} from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { LibrarySection } from "@/components/app-shell/spotify-player-library";
import { MusicLyricsPanel } from "@/components/music/music-lyrics-panel";
import { SpotifyOutputControls } from "@/components/music/spotify-output-controls";
import {
    fetchPlayback,
    generateMoodPlaylist,
    getSpotifyStatus,
    playerNext,
    playerPause,
    playerPlayTrack,
    playerPrevious,
    playerResume,
    saveMoodPlaylist,
    type MoodPlaylist,
    type SpotifyStatus,
} from "@/lib/actions/spotify";
import type { PlaybackState } from "@/lib/spotify-shared";

const POLL_MS = 5000;

function fmtTime(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MusicWidgetPanel() {
    const [status, setStatus] = useState<SpotifyStatus | null>(null);

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

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {status == null ? (
                <div className="flex flex-1 items-center justify-center p-6">
                    <LayoutRight className="size-6 animate-pulse text-fg-quaternary motion-reduce:animate-none" aria-hidden="true" />
                </div>
            ) : !status.configured ? (
                <UnavailableState />
            ) : !status.connected ? (
                <NotConnectedState />
            ) : (
                <ConnectedPanel aiEnabled={status.aiEnabled} />
            )}
        </div>
    );
}

function UnavailableState() {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <MusicNote01 className="size-8 text-fg-quaternary" aria-hidden="true" />
            <p className="text-sm font-semibold text-primary">Spotify isn&apos;t set up</p>
            <p className="text-sm text-tertiary">
                Add <code className="rounded bg-secondary px-1 text-xs">SPOTIFY_CLIENT_ID</code> /{" "}
                <code className="rounded bg-secondary px-1 text-xs">SPOTIFY_CLIENT_SECRET</code> on the server to enable the player.
            </p>
        </div>
    );
}

function NotConnectedState() {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <Headphones01 className="size-8 text-fg-quaternary" aria-hidden="true" />
            <p className="text-sm font-semibold text-primary">Connect Spotify</p>
            <p className="text-sm text-tertiary">
                Link your Spotify account to control playback and build AI mood playlists while you train.
            </p>
            <Button href="/settings/integrations" iconLeading={MusicNote01} size="sm">
                Connect Spotify
            </Button>
        </div>
    );
}

function ConnectedPanel({ aiEnabled }: { aiEnabled: boolean }) {
    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <NowPlaying />
            <MusicLyricsPanel />
            <LibrarySection />
            <MoodSection aiEnabled={aiEnabled} />
        </div>
    );
}

function NowPlaying() {
    const [playback, setPlayback] = useState<PlaybackState | null>(null);
    const [busy, setBusy] = useState(false);
    const errored = useRef(false);

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

    const track = playback?.track ?? null;
    const isPlaying = playback?.isPlaying ?? false;
    const progress = playback?.progressMs ?? 0;
    const duration = track?.durationMs ?? 0;
    const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

    return (
        <section className="shrink-0 border-b border-secondary p-4">
            <div className="flex items-center gap-3">
                <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-secondary ring-1 ring-secondary ring-inset">
                    {track?.albumArt ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={track.albumArt} alt="" className="size-full object-cover" />
                    ) : (
                        <div className="flex size-full items-center justify-center">
                            <MusicNote01 className="size-6 text-fg-quaternary" aria-hidden="true" />
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
                        <p className="text-sm text-tertiary">Nothing playing.</p>
                    )}
                </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
                <span className="w-9 text-right text-[11px] tabular-nums text-tertiary">{fmtTime(progress)}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-quaternary">
                    <div className="h-full rounded-full bg-brand-solid transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-9 text-[11px] tabular-nums text-tertiary">{fmtTime(duration)}</span>
            </div>

            <div className="mt-3 flex items-center justify-center gap-2">
                <Button size="sm" color="tertiary" iconLeading={SkipBack} aria-label="Previous track" isDisabled={busy} onClick={() => control(playerPrevious)} />
                <Button
                    size="md"
                    color="primary"
                    iconLeading={isPlaying ? PauseCircle : PlayCircle}
                    aria-label={isPlaying ? "Pause" : "Play"}
                    isDisabled={busy}
                    onClick={() =>
                        control(isPlaying ? playerPause : playerResume, () =>
                            setPlayback((p: PlaybackState | null) => (p ? { ...p, isPlaying: !isPlaying } : p)),
                        )
                    }
                />
                <Button size="sm" color="tertiary" iconLeading={SkipForward} aria-label="Next track" isDisabled={busy} onClick={() => control(playerNext)} />
            </div>

            <div className="mt-3">
                <SpotifyOutputControls variant="bar" onChanged={() => void poll()} />
            </div>
        </section>
    );
}

function MoodSection({ aiEnabled }: { aiEnabled: boolean }) {
    const [mood, setMood] = useState("");
    const [generating, setGenerating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<MoodPlaylist | null>(null);
    const [playing, setPlaying] = useState<string | null>(null);

    async function onGenerate() {
        if (!mood.trim() || generating) return;
        setGenerating(true);
        setResult(null);
        try {
            const r = await generateMoodPlaylist(mood.trim());
            setResult(r);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't build a playlist");
        } finally {
            setGenerating(false);
        }
    }

    async function onPlay(uri: string) {
        setPlaying(uri);
        try {
            await playerPlayTrack(uri);
            toast.success("Playing");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't play track");
        } finally {
            setPlaying(null);
        }
    }

    async function onSave() {
        if (!result || saving) return;
        setSaving(true);
        try {
            const { url } = await saveMoodPlaylist({
                name: result.name,
                description: result.description,
                uris: result.tracks.map((t) => t.uri),
            });
            toast.success("Saved to Spotify", {
                action: { label: "Open", onClick: () => window.open(url, "_blank", "noopener") },
            });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't save playlist");
        } finally {
            setSaving(false);
        }
    }

    const disabled = !aiEnabled;

    return (
        <section className="max-h-48 shrink-0 overflow-y-auto border-t border-secondary p-4">
            <h3 className="flex items-center gap-1.5 pb-2 text-xs font-semibold tracking-wide text-tertiary uppercase">
                <Stars02 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                AI mood playlist
            </h3>

            {disabled ? (
                <p className="rounded-lg bg-secondary_subtle p-3 text-xs text-tertiary">
                    Enable AI (set ANTHROPIC_API_KEY) to generate a playlist from how you feel.
                </p>
            ) : (
                <>
                    <textarea
                        value={mood}
                        onChange={(e) => setMood(e.target.value)}
                        rows={2}
                        placeholder="How are you feeling? e.g. high energy, ready to lift heavy…"
                        aria-label="How are you feeling?"
                        className="w-full resize-none rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs ring-1 ring-primary ring-inset transition placeholder:text-placeholder focus:outline-2 focus:-outline-offset-2 focus:outline-brand"
                    />
                    <Button
                        size="sm"
                        iconLeading={MagicWand01}
                        onClick={onGenerate}
                        isDisabled={!mood.trim() || generating}
                        isLoading={generating}
                        showTextWhileLoading
                        className="mt-2 w-full"
                    >
                        Generate playlist
                    </Button>
                </>
            )}

            {result && (
                <div className="mt-3 flex flex-col gap-2 rounded-lg bg-secondary p-3">
                    <div>
                        <p className="text-sm font-semibold text-primary">{result.name}</p>
                        <p className="text-xs text-tertiary">{result.description}</p>
                    </div>
                    {result.reasoning && <p className="text-xs text-tertiary italic">{result.reasoning}</p>}
                    <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                        {result.tracks.map((t) => (
                            <button
                                key={t.uri}
                                type="button"
                                onClick={() => onPlay(t.uri)}
                                disabled={playing === t.uri}
                                className="flex items-center gap-2 rounded-md p-1.5 text-left transition hover:bg-secondary_hover disabled:opacity-50"
                            >
                                <div className="size-8 shrink-0 overflow-hidden rounded bg-tertiary">
                                    {t.albumArt ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={t.albumArt} alt="" className="size-full object-cover" />
                                    ) : (
                                        <div className="flex size-full items-center justify-center">
                                            <MusicNote01 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                                        </div>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-medium text-primary">{t.name}</p>
                                    <p className="truncate text-[11px] text-tertiary">{t.artists}</p>
                                </div>
                                <PlayCircle className="size-3.5 shrink-0 text-fg-quaternary" aria-hidden="true" />
                            </button>
                        ))}
                    </div>
                    <Button
                        size="sm"
                        color="secondary"
                        iconLeading={LinkExternal01}
                        onClick={onSave}
                        isLoading={saving}
                        showTextWhileLoading
                        className="w-full"
                    >
                        Save to Spotify
                    </Button>
                </div>
            )}
        </section>
    );
}
