/** Client-safe Genius types (no server-only APIs). */

export type { SyncedLyricLine } from "@/lib/lrc";
import type { SyncedLyricLine } from "@/lib/lrc";

export interface GeniusLyricsResult {
    lyrics: string;
    /** Timestamped lines for karaoke-style sync (from LRCLIB when available). */
    syncedLines: SyncedLyricLine[] | null;
    geniusUrl: string;
    songTitle: string;
    artistName: string;
    thumbnailUrl: string | null;
}
