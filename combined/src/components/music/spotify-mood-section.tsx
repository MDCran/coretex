"use client";

import { useState } from "react";
import { LinkExternal01, MagicWand01, MusicNote01, PlayCircle, Stars02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { generateMoodPlaylist, playerPlayTrack, saveMoodPlaylist, type MoodPlaylist } from "@/lib/actions/spotify";

export function SpotifyMoodSection({ aiEnabled, className }: { aiEnabled: boolean; className?: string }) {
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

    return (
        <section className={className}>
            <h3 className="flex items-center gap-1.5 pb-3 text-xs font-semibold tracking-wide text-tertiary uppercase">
                <Stars02 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                AI mood playlist
            </h3>

            {!aiEnabled ? (
                <p className="rounded-xl bg-secondary_subtle p-4 text-sm text-tertiary ring-1 ring-inset ring-secondary">
                    Enable AI (set <span className="font-mono text-xs">ANTHROPIC_API_KEY</span>) to generate a playlist from how you feel.
                </p>
            ) : (
                <>
                    <textarea
                        value={mood}
                        onChange={(e) => setMood(e.target.value)}
                        rows={3}
                        placeholder="How are you feeling? e.g. high energy, deep focus, calm recovery…"
                        aria-label="How are you feeling?"
                        className="w-full resize-none rounded-lg bg-primary px-3 py-2.5 text-sm text-primary shadow-xs ring-1 ring-primary ring-inset transition placeholder:text-placeholder focus:outline-2 focus:-outline-offset-2 focus:outline-brand"
                    />
                    <Button
                        size="sm"
                        iconLeading={MagicWand01}
                        onClick={onGenerate}
                        isDisabled={!mood.trim() || generating}
                        isLoading={generating}
                        showTextWhileLoading
                        className="mt-3"
                    >
                        Generate playlist
                    </Button>
                </>
            )}

            {result && (
                <div className="mt-4 flex flex-col gap-3 rounded-xl bg-secondary_subtle p-4 ring-1 ring-inset ring-secondary">
                    <div>
                        <p className="text-md font-semibold text-primary">{result.name}</p>
                        <p className="text-sm text-tertiary">{result.description}</p>
                    </div>
                    {result.reasoning && <p className="text-sm text-tertiary italic">{result.reasoning}</p>}
                    <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                        {result.tracks.map((t) => (
                            <button
                                key={t.uri}
                                type="button"
                                onClick={() => onPlay(t.uri)}
                                disabled={playing === t.uri}
                                className="flex items-center gap-3 rounded-lg p-2 text-left transition hover:bg-secondary_hover disabled:opacity-50"
                            >
                                <div className="size-10 shrink-0 overflow-hidden rounded-md bg-tertiary">
                                    {t.albumArt ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={t.albumArt} alt="" className="size-full object-cover" />
                                    ) : (
                                        <div className="flex size-full items-center justify-center">
                                            <MusicNote01 className="size-4 text-fg-quaternary" aria-hidden="true" />
                                        </div>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-primary">{t.name}</p>
                                    <p className="truncate text-xs text-tertiary">{t.artists}</p>
                                </div>
                                <PlayCircle className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
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
                        className="w-full sm:w-auto"
                    >
                        Save to Spotify
                    </Button>
                </div>
            )}
        </section>
    );
}
