"use client";

import { useState } from "react";
import { LibrarySection } from "@/components/app-shell/spotify-player-library";
import { MusicLyricsPanel } from "@/components/music/music-lyrics-panel";
import { MusicNowPlaying } from "@/components/music/music-now-playing";
import { SpotifyMoodSection } from "@/components/music/spotify-mood-section";
import { cx } from "@/utils/cx";

type MobileMusicTab = "player" | "library" | "mood";

function MobileMusicTabs({ tab, onChange }: { tab: MobileMusicTab; onChange: (t: MobileMusicTab) => void }) {
    return (
        <div className="mobile-tab-bar shrink-0 border-b border-secondary bg-primary px-1 pt-1">
            {(
                [
                    ["player", "Player"],
                    ["library", "Library"],
                    ["mood", "Mood"],
                ] as const
            ).map(([id, label]) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => onChange(id)}
                    className={cx(
                        "border-b-2 px-2 pb-2 text-sm font-semibold transition",
                        tab === id
                            ? "border-brand-solid text-brand-secondary"
                            : "border-transparent text-tertiary hover:text-secondary",
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

function BottomPaneTabs({ tab, onChange }: { tab: "library" | "mood"; onChange: (t: "library" | "mood") => void }) {
    return (
        <div className="mobile-tab-bar shrink-0 border-b border-secondary px-1 pt-1">
            {(
                [
                    ["library", "Library"],
                    ["mood", "Mood"],
                ] as const
            ).map(([id, label]) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => onChange(id)}
                    className={cx(
                        "border-b-2 px-2 pb-2 text-sm font-semibold capitalize transition",
                        tab === id
                            ? "border-brand-solid text-brand-secondary"
                            : "border-transparent text-tertiary hover:text-secondary",
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

/** Full mobile music workspace: top player + lyrics, bottom library (+ mood). */
export function MusicMobileWorkspacePage({ aiEnabled }: { aiEnabled: boolean }) {
    const [libraryTab, setLibraryTab] = useState<"library" | "mood">("library");

    return (
        <div className="mobile-split-viewport flex min-h-0 w-full flex-col overflow-hidden bg-primary sm:rounded-xl sm:ring-1 sm:ring-secondary sm:ring-inset">
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)]">
                <div className="flex min-h-0 flex-col overflow-hidden border-b border-secondary">
                    <MusicNowPlaying variant="compact" />
                    <MusicLyricsPanel embedded />
                </div>

                <div className="flex min-h-0 flex-col overflow-hidden">
                    <BottomPaneTabs tab={libraryTab} onChange={setLibraryTab} />
                    {libraryTab === "library" ? (
                        <LibrarySection />
                    ) : (
                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                            <SpotifyMoodSection aiEnabled={aiEnabled} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/** Compact music panel docked below workout content on mobile. */
export function MusicMobileWorkspaceDock({ aiEnabled }: { aiEnabled: boolean }) {
    const [tab, setTab] = useState<MobileMusicTab>("player");

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-primary">
            <MobileMusicTabs tab={tab} onChange={setTab} />
            {tab === "player" && (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <MusicNowPlaying variant="compact" showAddToPlaylist={false} />
                    <MusicLyricsPanel embedded />
                </div>
            )}
            {tab === "library" && <LibrarySection />}
            {tab === "mood" && (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                    <SpotifyMoodSection aiEnabled={aiEnabled} />
                </div>
            )}
        </div>
    );
}
