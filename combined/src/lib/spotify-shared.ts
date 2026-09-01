/** Client-safe Spotify constants and types (no server-only APIs). */

/** Virtual playlist id for the user's Liked Songs library. */
export const LIKED_SONGS_PLAYLIST_ID = "liked-songs";

export interface PlaybackState {
    isPlaying: boolean;
    progressMs: number | null;
    track: {
        id: string;
        uri: string;
        name: string;
        artists: string;
        album: string;
        albumArt: string | null;
        durationMs: number;
    } | null;
}

export interface PlaylistSummary {
    id: string;
    name: string;
    description: string | null;
    coverArt: string | null;
    trackCount: number;
    owner: string | null;
}

export interface PlaylistTrack {
    id: string;
    uri: string;
    name: string;
    artists: string;
    album: string;
    albumArt: string | null;
    durationMs: number;
    /** ISO timestamp when the track was added to the playlist / library. */
    addedAt: string | null;
}

export interface Paged<T> {
    items: T[];
    total: number;
    next: boolean;
}

export interface TrackSearchHit {
    id: string;
    uri: string;
    name: string;
    artists: string;
    album: string;
    albumArt: string | null;
    popularity?: number | null;
}

export interface QueueState {
    currentlyPlaying: PlaylistTrack | null;
    queue: PlaylistTrack[];
}

export interface RecentlyPlayedItem {
    track: PlaylistTrack;
    playedAt: string;
}

/** A Spotify Connect playback device available to the user. */
export interface SpotifyDevice {
    /** Spotify device id. Can be null for some restricted/ephemeral devices. */
    id: string | null;
    name: string;
    /** e.g. "Computer", "Smartphone", "Speaker", "TV". */
    type: string;
    isActive: boolean;
    /** When true, the device cannot be controlled via the Web API (volume, transfer). */
    isRestricted: boolean;
    /** 0–100, or null when unknown. */
    volumePercent: number | null;
}
