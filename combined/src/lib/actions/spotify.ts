"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConfigured, runClaude } from "@/lib/ai/claude";
import {
    LIKED_SONGS_PLAYLIST_ID,
    NoActiveDeviceError,
    SpotifyNotConnectedError,
    addToQueue,
    addTracksToPlaylist,
    createPlaylist,
    saveTrackToLibrary,
    findPlaylistsContainingTrack,
    getCurrentPlayback,
    getDevices,
    getQueue,
    getRecentlyPlayed,
    getPlaylistTracks,
    getPlaylists,
    getSavedTracks,
    getSavedTracksCount,
    next as nextTrack,
    pause,
    play,
    playPlaylistFromTrack,
    playTrack,
    previous,
    searchTracks,
    setVolume,
    spotifyConfigured,
    transferPlayback as transferPlaybackToDevice,
    type PlaybackState,
    type Paged,
    type PlaylistSummary,
    type PlaylistTrack,
    type QueueState,
    type RecentlyPlayedItem,
    type SpotifyDevice,
    type TrackSearchHit,
} from "@/lib/spotify";

/**
 * Server actions for the Spotify integration. Every action is scoped to the
 * logged-in user via requireUser; access tokens never leave the server.
 *
 * Player actions translate library errors into friendly messages so the client
 * can toast them (e.g. NoActiveDeviceError → "Start playing on any device first").
 */

/** Disconnect Spotify: remove the stored connection. */
export async function disconnectSpotify(): Promise<void> {
    const user = await requireUser();
    await db.spotifyConnection.deleteMany({ where: { userId: user.id } });
    revalidatePath("/settings/integrations");
}

// ── Status ──────────────────────────────────────────────────

export interface SpotifyStatus {
    configured: boolean;
    connected: boolean;
    aiEnabled: boolean;
    displayName: string | null;
    scopes: string[];
    /** True when the stored token is missing library scopes (Liked Songs / save track). */
    needsLibraryReconnect: boolean;
    /** True when the stored token is missing recently-played scope. */
    needsHistoryReconnect: boolean;
}

/** Lightweight status used by the workouts sidebar (client polls this on mount). */
export async function getSpotifyStatus(): Promise<SpotifyStatus> {
    const user = await requireUser();
    const conn = await db.spotifyConnection.findUnique({ where: { userId: user.id } });
    const scopes = conn?.scope ? conn.scope.split(" ").filter(Boolean) : [];
    return {
        configured: spotifyConfigured(),
        connected: Boolean(conn),
        aiEnabled: aiConfigured(),
        displayName: conn?.displayName ?? null,
        scopes,
        needsLibraryReconnect: Boolean(conn) && !scopes.includes("user-library-read"),
        needsHistoryReconnect: Boolean(conn) && !scopes.includes("user-read-recently-played"),
    };
}

// ── Playback (polled + controls) ────────────────────────────

function friendly(error: unknown): string {
    if (error instanceof NoActiveDeviceError) return error.message;
    if (error instanceof SpotifyNotConnectedError) return error.message;
    return error instanceof Error ? error.message : "Spotify request failed.";
}

/** Poll target: current playback state (or null when idle). Throws friendly errors. */
export async function fetchPlayback(): Promise<PlaybackState | null> {
    const user = await requireUser();
    try {
        return await getCurrentPlayback(user.id);
    } catch (error) {
        // A missing connection should surface as "not connected"; everything else bubbles.
        if (error instanceof SpotifyNotConnectedError) throw new Error(friendly(error));
        throw new Error(friendly(error));
    }
}

export async function playerResume(): Promise<void> {
    const user = await requireUser();
    try {
        await play(user.id);
    } catch (error) {
        throw new Error(friendly(error));
    }
}

export async function playerPause(): Promise<void> {
    const user = await requireUser();
    try {
        await pause(user.id);
    } catch (error) {
        throw new Error(friendly(error));
    }
}

export async function playerNext(): Promise<void> {
    const user = await requireUser();
    try {
        await nextTrack(user.id);
    } catch (error) {
        throw new Error(friendly(error));
    }
}

export async function playerPrevious(): Promise<void> {
    const user = await requireUser();
    try {
        await previous(user.id);
    } catch (error) {
        throw new Error(friendly(error));
    }
}

/** List the user's available Spotify Connect devices (for the device picker). */
export async function fetchDevices(): Promise<SpotifyDevice[]> {
    const user = await requireUser();
    try {
        return await getDevices(user.id);
    } catch (error) {
        throw new Error(friendly(error));
    }
}

/** Move playback to a specific device (and start playing by default). */
export async function transferPlayback(deviceId: string, play = true): Promise<void> {
    const user = await requireUser();
    if (!deviceId) throw new Error("Choose a device.");
    try {
        await transferPlaybackToDevice(user.id, deviceId, play);
    } catch (error) {
        throw new Error(friendly(error));
    }
}

/** Set Spotify playback volume (0–100) on the active device, or a specific device. */
export async function setPlayerVolume(volumePercent: number, deviceId?: string): Promise<void> {
    const user = await requireUser();
    try {
        await setVolume(user.id, volumePercent, deviceId);
    } catch (error) {
        throw new Error(friendly(error));
    }
}

/** Play a single track on the active device (never changes device). */
export async function playerPlayTrack(uri: string): Promise<void> {
    const user = await requireUser();
    if (!uri) throw new Error("Missing track URI.");
    try {
        await playTrack(user.id, uri);
    } catch (error) {
        throw new Error(friendly(error));
    }
}

export async function playerAddToQueue(uri: string): Promise<void> {
    const user = await requireUser();
    if (!uri) throw new Error("Missing track URI.");
    try {
        await addToQueue(user.id, uri);
    } catch (error) {
        throw new Error(friendly(error));
    }
}

export async function fetchQueue(): Promise<QueueState> {
    const user = await requireUser();
    try {
        return await getQueue(user.id);
    } catch (error) {
        throw new Error(friendly(error));
    }
}

export async function fetchRecentlyPlayed(after?: number): Promise<{ items: RecentlyPlayedItem[]; next: boolean; after?: number }> {
    const user = await requireUser();
    try {
        return await getRecentlyPlayed(user.id, { limit: 50, after });
    } catch (error) {
        throw new Error(friendly(error));
    }
}

// ── Library browsing ────────────────────────────────────────

export async function fetchPlaylists(offset = 0): Promise<Paged<PlaylistSummary>> {
    const user = await requireUser();
    try {
        const [page, conn] = await Promise.all([
            getPlaylists(user.id, { offset, limit: 50 }),
            db.spotifyConnection.findUnique({ where: { userId: user.id }, select: { scope: true } }),
        ]);
        const scopes = conn?.scope?.split(" ").filter(Boolean) ?? [];
        const canReadLibrary = scopes.includes("user-library-read");

        if (offset === 0 && canReadLibrary) {
            try {
                const likedCount = await getSavedTracksCount(user.id);
                const liked: PlaylistSummary = {
                    id: LIKED_SONGS_PLAYLIST_ID,
                    name: "Liked Songs",
                    description: "Tracks you've saved in Spotify",
                    coverArt: null,
                    trackCount: likedCount,
                    owner: "You",
                };
                return { ...page, items: [liked, ...page.items] };
            } catch {
                /* library scope stale or revoked — still return real playlists */
            }
        }
        return page;
    } catch (error) {
        throw new Error(friendly(error));
    }
}

export async function fetchPlaylistTracks(playlistId: string, offset = 0): Promise<Paged<PlaylistTrack>> {
    const user = await requireUser();
    if (!playlistId) throw new Error("Missing playlist id.");
    try {
        if (playlistId === LIKED_SONGS_PLAYLIST_ID) {
            return await getSavedTracks(user.id, { offset, limit: 50 });
        }
        return await getPlaylistTracks(user.id, playlistId, { offset, limit: 100 });
    } catch (error) {
        throw new Error(friendly(error));
    }
}

export async function playerPlayPlaylistFromTrack(playlistId: string, trackUri: string): Promise<void> {
    const user = await requireUser();
    if (!playlistId || playlistId === LIKED_SONGS_PLAYLIST_ID) {
        throw new Error("Pick a playlist to start from that track.");
    }
    if (!trackUri) throw new Error("Missing track URI.");
    try {
        await playPlaylistFromTrack(user.id, playlistId, trackUri);
    } catch (error) {
        throw new Error(friendly(error));
    }
}

export interface TrackInPlaylistsResult {
    track: TrackSearchHit;
    playlists: PlaylistSummary[];
    matches: TrackSearchHit[];
}

/** Add the current track to a user playlist (or Liked Songs). */
export async function addTrackToUserPlaylist(playlistId: string, trackUri: string, trackId: string): Promise<void> {
    const user = await requireUser();
    if (!trackUri || !trackId) throw new Error("No track selected.");
    if (!playlistId) throw new Error("Choose a playlist.");

    try {
        if (playlistId === LIKED_SONGS_PLAYLIST_ID) {
            await saveTrackToLibrary(user.id, trackId);
            return;
        }
        await addTracksToPlaylist(user.id, playlistId, [trackUri]);
    } catch (error) {
        throw new Error(friendly(error));
    }
}

/** Search the Spotify catalog (not limited to user's playlists). */
export async function searchSpotifyCatalog(query: string, limit = 20): Promise<TrackSearchHit[]> {
    const user = await requireUser();
    const q = query.trim();
    if (!q) throw new Error("Enter a song or artist to search.");
    try {
        return await searchTracks(user.id, q, limit);
    } catch (error) {
        throw new Error(friendly(error));
    }
}

/** Search catalog for a track, then scan the user's playlists for matches. */
export async function searchTrackInPlaylists(query: string, trackUri?: string): Promise<TrackInPlaylistsResult | null> {
    const user = await requireUser();
    const q = query.trim();
    if (!q && !trackUri) throw new Error("Enter a song or artist to search.");

    try {
        const matches = q ? await searchTracks(user.id, q, 8) : [];
        const track =
            (trackUri ? matches.find((m) => m.uri === trackUri) : null) ??
            matches[0] ??
            null;
        if (!track) return null;

        const playlists = await findPlaylistsContainingTrack(user.id, track.id);
        return { track, playlists, matches };
    } catch (error) {
        throw new Error(friendly(error));
    }
}

// ── AI mood playlist ────────────────────────────────────────

export interface MoodTrack {
    uri: string;
    name: string;
    artists: string;
    albumArt: string | null;
    source: "favorite" | "playlist" | "ai";
    sourceLabel: string | null;
    popularity?: number | null;
}

export interface MoodPlaylist {
    name: string;
    description: string;
    reasoning: string | null;
    tracks: MoodTrack[];
}

export interface MoodTrackFeedback {
    uri: string;
    rating: "good" | "bad";
}

export interface MoodPlaylistOptions {
    prioritizeFavorites?: boolean;
    feedback?: MoodTrackFeedback[];
}

const MOOD_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        name: { type: "string", description: "A short, evocative playlist name fitting the mood (max ~40 chars)." },
        description: { type: "string", description: "A one-sentence playlist description." },
        trackUris: {
            type: "array",
            description: "The Spotify track URIs to include, chosen ONLY from the provided candidate list. Around 20 tracks.",
            items: { type: "string", description: "A spotify:track:... URI copied verbatim from a candidate." },
        },
        wildcardQueries: {
            type: "array",
            description: "3 to 5 Spotify search queries for popular, high-quality wildcard songs that fit the mood but may not be in the candidate list.",
            items: { type: "string" },
        },
        reasoning: { type: "string", description: "A brief note on why these tracks fit the mood." },
    },
    required: ["name", "description", "trackUris"],
};

const MOOD_SYSTEM = `You are an expert music curator building a workout playlist that matches the user's described mood/feeling.
You will receive a list of candidate tracks (each with a Spotify URI, song name, artist, and source playlist).
Select roughly 20 tracks from the candidates that best fit the requested mood and flow well as a workout set.
Avoid low-quality, obscure, novelty, or weak-energy filler unless the user's mood explicitly asks for it.
CRITICAL: only output track URIs that appear verbatim in the candidate list — never invent URIs.`;

const TRACK_SAMPLE_CAP = 1200;
const PLAYLIST_SCAN_CAP = 200;
const POPULAR_WILDCARD_MIN = 55;

type MoodCandidate = {
    name: string;
    artists: string;
    albumArt: string | null;
    source: "favorite" | "playlist";
    sourceLabel: string | null;
    rating?: "good" | "bad";
};

async function getAllPlaylistsForMood(userId: string): Promise<PlaylistSummary[]> {
    const all: PlaylistSummary[] = [];
    for (let offset = 0; offset < PLAYLIST_SCAN_CAP; offset += 50) {
        const page = await getPlaylists(userId, { limit: 50, offset });
        all.push(...page.items);
        if (!page.next) break;
    }
    return all.slice(0, PLAYLIST_SCAN_CAP);
}

async function addLikedSongsToMoodCandidates(userId: string, candidates: Map<string, MoodCandidate>, feedback: Map<string, "good" | "bad">) {
    for (let offset = 0; candidates.size < TRACK_SAMPLE_CAP; offset += 50) {
        const page = await getSavedTracks(userId, { limit: 50, offset });
        for (const t of page.items) {
            const rating = feedback.get(t.uri);
            if (rating === "bad") continue;
            if (!candidates.has(t.uri)) {
                candidates.set(t.uri, { name: t.name, artists: t.artists, albumArt: t.albumArt, source: "favorite", sourceLabel: "Liked Songs", rating });
            }
        }
        if (!page.next) break;
    }
}

/**
 * Build an AI mood playlist: sample the user's library (cap ~300 tracks), ask Claude
 * to select ~20 fitting tracks against MOOD_SCHEMA, then resolve the chosen URIs back
 * to rich track objects for the sidebar (art, names, click-to-play).
 */
export async function generateMoodPlaylist(mood: string): Promise<MoodPlaylist> {
    const user = await requireUser();
    const feeling = mood.trim();
    if (!feeling) throw new Error("Describe how you're feeling first.");
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");
    if (!spotifyConfigured()) throw new Error("Spotify is not configured.");

    // Gather a sample of tracks across the user's playlists.
    let playlists: Paged<PlaylistSummary>;
    try {
        playlists = await getPlaylists(user.id, { limit: 50 });
    } catch (error) {
        throw new Error(friendly(error));
    }
    if (playlists.items.length === 0) {
        throw new Error("No playlists found on your Spotify account to draw from.");
    }

    const candidates = new Map<string, { name: string; artists: string; albumArt: string | null; playlist: string }>();
    for (const pl of playlists.items.slice(0, PLAYLIST_SCAN_CAP)) {
        if (candidates.size >= TRACK_SAMPLE_CAP) break;
        try {
            const tracks = await getPlaylistTracks(user.id, pl.id, { limit: 100 });
            for (const t of tracks.items) {
                if (candidates.size >= TRACK_SAMPLE_CAP) break;
                if (!candidates.has(t.uri)) {
                    candidates.set(t.uri, { name: t.name, artists: t.artists, albumArt: t.albumArt, playlist: pl.name });
                }
            }
        } catch {
            // Skip playlists we can't read (e.g. local-files only).
            continue;
        }
    }

    if (candidates.size === 0) {
        throw new Error("Couldn't read any tracks from your playlists.");
    }

    const candidateLines = [...candidates.entries()]
        .map(([uri, t]) => `${uri} | ${t.name} — ${t.artists} (from "${t.playlist}")`)
        .join("\n");

    const prompt = `The user feels: "${feeling}".

Candidate tracks (URI | song — artist (from playlist)):
${candidateLines}

Pick ~20 of these that best match the mood for a workout. Return the chosen track URIs (verbatim), a playlist name, a description, and brief reasoning.`;

    const result = await runClaude<{ name: string; description: string; trackUris: string[]; reasoning?: string }>({
        purpose: "spotify-mood-playlist",
        userId: user.id,
        system: MOOD_SYSTEM,
        content: prompt,
        schema: MOOD_SCHEMA,
        maxTokens: 4000,
    });

    // Resolve selected URIs back to candidate detail; drop any hallucinated URIs.
    const tracks: MoodTrack[] = [];
    const seen = new Set<string>();
    for (const uri of result.data.trackUris) {
        const found = candidates.get(uri);
        if (found && !seen.has(uri)) {
            seen.add(uri);
            tracks.push({
                uri,
                name: found.name,
                artists: found.artists,
                albumArt: found.albumArt,
                source: "playlist",
                sourceLabel: found.playlist,
            });
        }
    }

    if (tracks.length === 0) {
        throw new Error("The AI didn't pick any tracks from your library. Try rephrasing your mood.");
    }

    return {
        name: result.data.name,
        description: result.data.description,
        reasoning: result.data.reasoning ?? null,
        tracks,
    };
}

/** Save an AI-generated mood playlist to Spotify and return its link. */
export async function saveMoodPlaylist(input: {
    name: string;
    description: string;
    uris: string[];
}): Promise<{ url: string }> {
    const user = await requireUser();
    const name = input.name?.trim();
    const uris = (input.uris ?? []).filter((u) => typeof u === "string" && u.startsWith("spotify:track:"));
    if (!name) throw new Error("Playlist name is required.");
    if (uris.length === 0) throw new Error("No tracks to save.");

    try {
        const { id, url } = await createPlaylist(user.id, name, input.description ?? "");
        await addTracksToPlaylist(user.id, id, uris);
        return { url };
    } catch (error) {
        throw new Error(friendly(error));
    }
}
