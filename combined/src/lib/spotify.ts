import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { spotifyApiUrl } from "@/lib/spotify-url";
import type {
    Paged,
    PlaybackState,
    PlaylistSummary,
    PlaylistTrack,
    QueueState,
    RecentlyPlayedItem,
    SpotifyDevice,
    TrackSearchHit,
} from "@/lib/spotify-shared";

/**
 * Spotify Web API integration (server-only).
 *
 * Auth flow:
 *  - /api/spotify/connect → builds an authorize URL with the scopes below and a
 *    random `state` nonce stored in a short-lived, httpOnly cookie.
 *  - /api/spotify/callback → verifies `state`, exchanges the code for tokens and
 *    upserts a SpotifyConnection row, then redirects to /settings/integrations.
 *
 * Token refresh: every authenticated call goes through `freshAccessToken`, which
 * refreshes (and persists) the access token when it is within REFRESH_SKEW_MS of
 * expiry. Spotify only returns a new refresh_token sometimes, so we keep the old
 * one when none is returned.
 *
 * Device semantics: player endpoints default to acting on the user's currently
 * active device (no device_id). When a specific device is chosen, an optional
 * device_id can be threaded into play/queue calls, or playback can be moved with
 * transferPlayback. getDevices lists the user's available Spotify Connect devices.
 * A 404 NO_ACTIVE_DEVICE from Spotify is surfaced as a friendly NoActiveDeviceError.
 */

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

export const SPOTIFY_SCOPES = [
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "user-read-recently-played",
    "user-library-read",
    "user-library-modify",
    "playlist-read-private",
    "playlist-read-collaborative",
    "playlist-modify-private",
    "playlist-modify-public",
];

export {
    LIKED_SONGS_PLAYLIST_ID,
    type Paged,
    type PlaybackState,
    type PlaylistSummary,
    type PlaylistTrack,
    type QueueState,
    type RecentlyPlayedItem,
    type SpotifyDevice,
    type TrackSearchHit,
} from "@/lib/spotify-shared";

const STATE_COOKIE = "spotify_oauth_state";
const REFRESH_SKEW_MS = 60_000; // refresh when < 60s of validity remains

/** Whether the Spotify app credentials are configured on the server. */
export function spotifyConfigured(): boolean {
    return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

/** Friendly error surfaced when no Spotify device is currently active. */
export class NoActiveDeviceError extends Error {
    constructor() {
        super("Start playing on any device first (open Spotify on your phone or computer), then try again.");
        this.name = "NoActiveDeviceError";
    }
}

/** Thrown when the user has not connected Spotify (or credentials are missing). */
export class SpotifyNotConnectedError extends Error {
    constructor(message = "Spotify is not connected.") {
        super(message);
        this.name = "SpotifyNotConnectedError";
    }
}

function clientId(): string {
    const id = process.env.SPOTIFY_CLIENT_ID;
    if (!id) throw new SpotifyNotConnectedError("Spotify is not configured — set SPOTIFY_CLIENT_ID on the server.");
    return id;
}

function clientSecret(): string {
    const secret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!secret) throw new SpotifyNotConnectedError("Spotify is not configured — set SPOTIFY_CLIENT_SECRET on the server.");
    return secret;
}

/**
 * Origin used for Spotify OAuth. Defaults to the browser request origin so cookies
 * and the dev server host stay aligned (localhost vs 127.0.0.1).
 */
export function spotifyOAuthOrigin(requestOrigin?: string): string {
    const explicit = process.env.SPOTIFY_REDIRECT_URI?.trim();
    if (explicit) {
        try {
            return new URL(explicit).origin;
        } catch {
            /* fall through */
        }
    }
    return (requestOrigin ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Absolute redirect URI registered in the Spotify developer dashboard. */
export function redirectUri(requestOrigin?: string): string {
    // PREFER the explicitly configured env value when set. Spotify requires the
    // redirect_uri sent at /authorize and at the token exchange to be byte-exact
    // to a URI registered in the dashboard. The browser host varies (next dev
    // serves both http://localhost:3000 and http://127.0.0.1:3000, and Spotify
    // post-Apr-2025 rejects raw `localhost`), so deriving it from the request
    // origin produces a host that may not match the registration. Pinning to
    // SPOTIFY_REDIRECT_URI guarantees authorize == token-exchange == dashboard.
    const explicit = process.env.SPOTIFY_REDIRECT_URI?.trim();
    if (explicit) return explicit.replace(/\/$/, "");

    // Fall back to the request-origin-derived URL only when no env is configured.
    if (requestOrigin) {
        return `${requestOrigin.replace(/\/$/, "")}/api/spotify/callback`;
    }
    return `${spotifyOAuthOrigin(requestOrigin)}/api/spotify/callback`;
}

/** Path to begin OAuth on the same host as the current browser tab. */
export function spotifyConnectUrl(_requestOrigin?: string): string {
    return "/api/spotify/connect";
}

// ============================================================
// OAuth
// ============================================================

/** Build the authorize URL and persist a random state nonce in a short-lived cookie. */
export async function buildAuthorizeUrl(requestOrigin?: string): Promise<string> {
    const state = randomBytes(16).toString("hex");
    const jar = await cookies();
    jar.set(STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 600, // 10 minutes
    });

    const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId(),
        scope: SPOTIFY_SCOPES.join(" "),
        redirect_uri: redirectUri(requestOrigin),
        state,
        show_dialog: "true",
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Verify the state nonce from the callback against the cookie, then clear it. */
export async function consumeState(state: string | null): Promise<boolean> {
    const jar = await cookies();
    const expected = jar.get(STATE_COOKIE)?.value ?? null;
    jar.delete(STATE_COOKIE);
    return Boolean(state) && Boolean(expected) && state === expected;
}

interface TokenResponse {
    access_token: string;
    token_type: string;
    scope: string;
    expires_in: number;
    refresh_token?: string;
}

function basicAuthHeader(): string {
    return "Basic " + Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64");
}

/** Exchange an authorization code for tokens and persist a SpotifyConnection. */
export async function exchangeCodeAndConnect(opts: { userId: string; code: string; requestOrigin?: string }): Promise<void> {
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: basicAuthHeader(),
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code: opts.code,
            redirect_uri: redirectUri(opts.requestOrigin),
        }),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Spotify token exchange failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const token = (await res.json()) as TokenResponse;
    const expiresAt = new Date(Date.now() + token.expires_in * 1000);

    // Fetch the Spotify profile to store identity for display.
    const profile = await spotifyFetch<{ id: string; display_name: string | null }>(token.access_token, "/me");

    await db.spotifyConnection.upsert({
        where: { userId: opts.userId },
        update: {
            spotifyUserId: profile.id,
            displayName: profile.display_name ?? profile.id,
            accessToken: sealSecret(token.access_token, { provider: "spotify", userId: opts.userId, field: "accessToken" }),
            ...(token.refresh_token
                ? { refreshToken: sealSecret(token.refresh_token, { provider: "spotify", userId: opts.userId, field: "refreshToken" }) }
                : {}),
            expiresAt,
            scope: token.scope,
        },
        create: {
            userId: opts.userId,
            spotifyUserId: profile.id,
            displayName: profile.display_name ?? profile.id,
            accessToken: sealSecret(token.access_token, { provider: "spotify", userId: opts.userId, field: "accessToken" }),
            refreshToken: token.refresh_token
                ? sealSecret(token.refresh_token, { provider: "spotify", userId: opts.userId, field: "refreshToken" })
                : "",
            expiresAt,
            scope: token.scope,
        },
    });
}

interface ConnectionRow {
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
}

/** Return a valid access token for the user, refreshing + persisting if near expiry. */
async function freshAccessToken(userId: string): Promise<string> {
    const conn = (await db.spotifyConnection.findUnique({ where: { userId } })) as ConnectionRow | null;
    if (!conn) throw new SpotifyNotConnectedError();

    if (conn.expiresAt.getTime() - Date.now() > REFRESH_SKEW_MS) {
        return openSecret(conn.accessToken, { provider: "spotify", userId: conn.userId, field: "accessToken" });
    }

    // Refresh.
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: basicAuthHeader(),
        },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: openSecret(conn.refreshToken, { provider: "spotify", userId: conn.userId, field: "refreshToken" }),
        }),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Spotify token refresh failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const token = (await res.json()) as TokenResponse;
    const expiresAt = new Date(Date.now() + token.expires_in * 1000);
    await db.spotifyConnection.update({
        where: { userId },
        data: {
            accessToken: sealSecret(token.access_token, { provider: "spotify", userId, field: "accessToken" }),
            ...(token.refresh_token
                ? { refreshToken: sealSecret(token.refresh_token, { provider: "spotify", userId, field: "refreshToken" }) }
                : {}),
            expiresAt,
            ...(token.scope ? { scope: token.scope } : {}),
        },
    });
    return token.access_token;
}

// ============================================================
// Low-level API helpers
// ============================================================

/** Raw fetch against the Spotify API with an explicit token (used during connect). */
async function spotifyFetch<T>(accessToken: string, path: string): Promise<T> {
    const res = await fetch(spotifyApiUrl(path), {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        redirect: "error",
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Spotify API ${path} failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
}

interface ApiCallOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    /** Player calls must not include a device_id — they act on the active device. */
    expectNoActiveDevice?: boolean;
}

/**
 * Authenticated call for a user (handles refresh). Returns parsed JSON, or null for
 * 204/empty responses. Maps 404 NO_ACTIVE_DEVICE to NoActiveDeviceError.
 */
async function apiCall<T>(userId: string, path: string, options: ApiCallOptions = {}): Promise<T | null> {
    const token = await freshAccessToken(userId);
    const res = await fetch(spotifyApiUrl(path), {
        method: options.method ?? "GET",
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        cache: "no-store",
        redirect: "error",
    });

    if (res.status === 204) return null;

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        // Spotify returns 404 with reason NO_ACTIVE_DEVICE when there's no active device.
        if (res.status === 404 && /NO_ACTIVE_DEVICE/i.test(text)) {
            throw new NoActiveDeviceError();
        }
        if (res.status === 401) {
            throw new SpotifyNotConnectedError("Spotify session expired — reconnect in Settings.");
        }
        throw new Error(`Spotify API ${path} failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
}

interface SpotifyImage {
    url: string;
    width: number | null;
    height: number | null;
}
interface SpotifyArtist {
    name: string;
}
interface SpotifyTrackObj {
    id: string | null;
    uri: string;
    name: string;
    duration_ms: number;
    popularity?: number | null;
    artists: SpotifyArtist[];
    album: { name: string; images: SpotifyImage[] };
}

function artistNames(artists: SpotifyArtist[] | undefined): string {
    return (artists ?? []).map((a) => a.name).join(", ");
}
function pickImage(images: SpotifyImage[] | undefined): string | null {
    return images && images.length > 0 ? images[0].url : null;
}

// ============================================================
// Devices
// ============================================================

interface SpotifyDeviceObj {
    id: string | null;
    is_active: boolean;
    is_restricted: boolean;
    name: string;
    type: string;
    volume_percent: number | null;
}

/** List the user's available Spotify Connect devices. */
export async function getDevices(userId: string): Promise<SpotifyDevice[]> {
    const data = await apiCall<{ devices: SpotifyDeviceObj[] }>(userId, "/me/player/devices");
    if (!data?.devices) return [];
    return data.devices.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        isActive: d.is_active,
        isRestricted: d.is_restricted,
        volumePercent: d.volume_percent,
    }));
}

/**
 * Transfer playback to a specific device. Pass play=true to start/keep playing on
 * the target device, false to move control without forcing play. Activating a
 * device this way lets subsequent device-less player calls act on it.
 */
export async function transferPlayback(userId: string, deviceId: string, play = true): Promise<void> {
    if (!deviceId) throw new Error("Missing device id.");
    await apiCall(userId, "/me/player", {
        method: "PUT",
        body: { device_ids: [deviceId], play },
    });
}

// ============================================================
// Player (acts on the active device, or a chosen device_id)
// ============================================================

/** Append `device_id=...` to a player path when a target device is provided. */
function withDevice(path: string, deviceId?: string): string {
    if (!deviceId) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}device_id=${encodeURIComponent(deviceId)}`;
}

/** Current playback state, or null when nothing is playing / no active device. */
export async function getCurrentPlayback(userId: string): Promise<PlaybackState | null> {
    const data = await apiCall<{
        is_playing: boolean;
        progress_ms: number | null;
        item: SpotifyTrackObj | null;
    }>(userId, "/me/player");
    if (!data || !data.item) return null;
    const item = data.item;
    return {
        isPlaying: data.is_playing,
        progressMs: data.progress_ms,
        track: {
            id: item.id ?? item.uri,
            uri: item.uri,
            name: item.name,
            artists: artistNames(item.artists),
            album: item.album?.name ?? "",
            albumArt: pickImage(item.album?.images),
            durationMs: item.duration_ms,
        },
    };
}

/**
 * Resume / start playback. Provide either `uris` (track URIs) or `contextUri`
 * (album/playlist) or neither (resume). Defaults to the active device; pass
 * `deviceId` to target a specific (even not-yet-active) device.
 */
export async function play(
    userId: string,
    opts: {
        uris?: string[];
        contextUri?: string;
        positionMs?: number;
        offsetUri?: string;
        offsetPosition?: number;
        deviceId?: string;
    } = {},
): Promise<void> {
    const body: Record<string, unknown> = {};
    if (opts.uris && opts.uris.length > 0) body.uris = opts.uris;
    if (opts.contextUri) body.context_uri = opts.contextUri;
    if (opts.positionMs != null) body.position_ms = opts.positionMs;
    if (opts.offsetUri) body.offset = { uri: opts.offsetUri };
    else if (opts.offsetPosition != null) body.offset = { position: opts.offsetPosition };
    await apiCall(userId, withDevice("/me/player/play", opts.deviceId), {
        method: "PUT",
        body: Object.keys(body).length > 0 ? body : undefined,
    });
}

export async function pause(userId: string): Promise<void> {
    await apiCall(userId, "/me/player/pause", { method: "PUT" });
}

/**
 * Set playback volume (0–100) on the active device, or a specific `deviceId`.
 * Spotify ignores this on devices that report `is_restricted` (e.g. some Connect
 * speakers and the Web Playback SDK), so the caller should disable the control then.
 */
export async function setVolume(userId: string, volumePercent: number, deviceId?: string): Promise<void> {
    const v = Math.max(0, Math.min(100, Math.round(volumePercent)));
    await apiCall(userId, withDevice(`/me/player/volume?volume_percent=${v}`, deviceId), { method: "PUT" });
}

export async function next(userId: string): Promise<void> {
    await apiCall(userId, "/me/player/next", { method: "POST" });
}

export async function previous(userId: string): Promise<void> {
    await apiCall(userId, "/me/player/previous", { method: "POST" });
}

/** Play a single track URI (active device by default, or a chosen `deviceId`). */
export async function playTrack(userId: string, uri: string, deviceId?: string): Promise<void> {
    await play(userId, { uris: [uri], deviceId });
}

/** Start a playlist at a specific track (active device only). */
export async function playPlaylistFromTrack(userId: string, playlistId: string, trackUri: string): Promise<void> {
    await play(userId, {
        contextUri: `spotify:playlist:${playlistId}`,
        offsetUri: trackUri,
    });
}

// ============================================================
// Library
// ============================================================

export async function getPlaylists(userId: string, opts: { limit?: number; offset?: number } = {}): Promise<Paged<PlaylistSummary>> {
    const limit = Math.min(opts.limit ?? 50, 50);
    const offset = opts.offset ?? 0;
    const data = await apiCall<{
        items: Array<{
            id: string;
            name: string;
            description: string | null;
            images: SpotifyImage[];
            tracks: { total: number };
            owner: { display_name: string | null } | null;
        }>;
        total: number;
        next: string | null;
    }>(userId, `/me/playlists?limit=${limit}&offset=${offset}`);

    if (!data) return { items: [], total: 0, next: false };
    return {
        items: data.items
            .filter((p) => p != null)
            .map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description || null,
                coverArt: pickImage(p.images),
                trackCount: p.tracks?.total ?? 0,
                owner: p.owner?.display_name ?? null,
            })),
        total: data.total,
        next: Boolean(data.next),
    };
}

function mapTrackObj(t: SpotifyTrackObj, addedAt: string | null = null): PlaylistTrack {
    return {
        id: t.id ?? t.uri,
        uri: t.uri,
        name: t.name,
        artists: artistNames(t.artists),
        album: t.album?.name ?? "",
        albumArt: pickImage(t.album?.images),
        durationMs: t.duration_ms,
        addedAt,
    };
}

/** Add a track URI to the end of the queue (active device by default, or `deviceId`). */
export async function addToQueue(userId: string, uri: string, deviceId?: string): Promise<void> {
    if (!uri) throw new Error("Missing track URI.");
    await apiCall(userId, withDevice(`/me/player/queue?uri=${encodeURIComponent(uri)}`, deviceId), { method: "POST" });
}

/** Read the active device's playback queue (currently playing + upcoming). */
export async function getQueue(userId: string): Promise<QueueState> {
    const data = await apiCall<{
        currently_playing: SpotifyTrackObj | null;
        queue: SpotifyTrackObj[];
    }>(userId, "/me/player/queue");

    if (!data) return { currentlyPlaying: null, queue: [] };

    const mapOrNull = (t: SpotifyTrackObj | null): PlaylistTrack | null => (t?.uri ? mapTrackObj(t) : null);

    return {
        currentlyPlaying: mapOrNull(data.currently_playing),
        queue: (data.queue ?? []).filter((t) => t?.uri).map((t) => mapTrackObj(t)),
    };
}

/** Recently played tracks (most recent first). */
export async function getRecentlyPlayed(
    userId: string,
    opts: { limit?: number; after?: number } = {},
): Promise<{ items: RecentlyPlayedItem[]; next: boolean; after?: number }> {
    const limit = Math.min(opts.limit ?? 50, 50);
    let path = `/me/player/recently-played?limit=${limit}`;
    if (opts.after != null) path += `&after=${opts.after}`;

    const data = await apiCall<{
        items: Array<{ played_at: string; track: SpotifyTrackObj | null }>;
        cursors?: { after?: string };
        next?: string | null;
    }>(userId, path);

    if (!data) return { items: [], next: false };

    const items: RecentlyPlayedItem[] = [];
    for (const item of data.items ?? []) {
        if (!item.track?.uri) continue;
        items.push({
            track: mapTrackObj(item.track),
            playedAt: item.played_at,
        });
    }

    const afterCursor = data.cursors?.after ? Number(data.cursors.after) : undefined;
    return { items, next: Boolean(data.next), after: Number.isFinite(afterCursor) ? afterCursor : undefined };
}

export async function getSavedTracksCount(userId: string): Promise<number> {
    const data = await apiCall<{ total: number }>(userId, "/me/tracks?limit=1");
    return data?.total ?? 0;
}

/** User's Liked Songs (saved tracks). */
export async function getSavedTracks(userId: string, opts: { limit?: number; offset?: number } = {}): Promise<Paged<PlaylistTrack>> {
    const limit = Math.min(opts.limit ?? 50, 50);
    const offset = opts.offset ?? 0;
    const data = await apiCall<{
        items: Array<{ added_at?: string; track: SpotifyTrackObj | null }>;
        total: number;
        next: string | null;
    }>(userId, `/me/tracks?limit=${limit}&offset=${offset}`);

    if (!data) return { items: [], total: 0, next: false };
    return {
        items: data.items
            .filter((i) => i.track != null && Boolean(i.track.uri))
            .map((i) => mapTrackObj(i.track!, i.added_at ?? null)),
        total: data.total,
        next: Boolean(data.next),
    };
}

/** Search Spotify catalog for tracks by title / artist. */
export async function searchTracks(userId: string, query: string, limit = 8): Promise<TrackSearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const data = await apiCall<{
        tracks: { items: SpotifyTrackObj[] };
    }>(userId, `/search?q=${encodeURIComponent(q)}&type=track&limit=${Math.min(limit, 10)}`);

    if (!data?.tracks?.items) return [];
    return data.tracks.items
        .filter((t) => t?.uri)
        .map((t) => ({
            id: t.id ?? t.uri,
        uri: t.uri,
        name: t.name,
        artists: artistNames(t.artists),
        album: t.album?.name ?? "",
        albumArt: pickImage(t.album?.images),
        popularity: t.popularity ?? null,
    }));
}

const PLAYLIST_CONTAINS_SCAN_CAP = 60;

/** Find user playlists that include a track (by Spotify track id). */
export async function findPlaylistsContainingTrack(userId: string, trackId: string): Promise<PlaylistSummary[]> {
    const playlists = await getPlaylists(userId, { limit: 50 });
    const hits: PlaylistSummary[] = [];

    for (const pl of playlists.items.slice(0, PLAYLIST_CONTAINS_SCAN_CAP)) {
        let offset = 0;
        let found = false;
        while (!found) {
            const fields = "next,items(track(id))";
            const page = await apiCall<{
                items: Array<{ track: { id: string | null } | null }>;
                next: string | null;
            }>(userId, `/playlists/${encodeURIComponent(pl.id)}/tracks?limit=100&offset=${offset}&fields=${encodeURIComponent(fields)}`);
            if (!page) break;
            if (page.items.some((i) => i.track?.id === trackId)) {
                hits.push(pl);
                found = true;
                break;
            }
            if (!page.next) break;
            offset += 100;
        }
    }

    return hits;
}

export async function getPlaylistTracks(
    userId: string,
    playlistId: string,
    opts: { limit?: number; offset?: number } = {},
): Promise<Paged<PlaylistTrack>> {
    const limit = Math.min(opts.limit ?? 100, 100);
    const offset = opts.offset ?? 0;
    const fields = "total,next,items(added_at,track(id,uri,name,duration_ms,artists(name),album(name,images)))";
    const data = await apiCall<{
        items: Array<{ added_at: string; track: SpotifyTrackObj | null }>;
        total: number;
        next: string | null;
    }>(userId, `/playlists/${encodeURIComponent(playlistId)}/tracks?limit=${limit}&offset=${offset}&fields=${encodeURIComponent(fields)}`);

    if (!data) return { items: [], total: 0, next: false };
    return {
        items: data.items
            .filter((i) => i.track != null && Boolean(i.track.uri))
            .map((i) => mapTrackObj(i.track!, i.added_at ?? null)),
        total: data.total,
        next: Boolean(data.next),
    };
}

// ============================================================
// Playlist creation (for saving AI playlists)
// ============================================================

/** Create a private playlist on the user's account and return its id + URL. */
export async function createPlaylist(
    userId: string,
    name: string,
    description: string,
): Promise<{ id: string; url: string }> {
    const conn = await db.spotifyConnection.findUnique({ where: { userId } });
    if (!conn) throw new SpotifyNotConnectedError();
    const created = await apiCall<{ id: string; external_urls: { spotify: string } }>(
        userId,
        `/users/${encodeURIComponent(conn.spotifyUserId)}/playlists`,
        { method: "POST", body: { name, description, public: false } },
    );
    if (!created) throw new Error("Spotify did not return the created playlist.");
    return { id: created.id, url: created.external_urls?.spotify ?? `https://open.spotify.com/playlist/${created.id}` };
}

/** Add track URIs to a playlist (chunked to Spotify's 100-per-request limit). */
export async function addTracksToPlaylist(userId: string, playlistId: string, uris: string[]): Promise<void> {
    for (let i = 0; i < uris.length; i += 100) {
        const chunk = uris.slice(i, i + 100);
        await apiCall(userId, `/playlists/${encodeURIComponent(playlistId)}/tracks`, { method: "POST", body: { uris: chunk } });
    }
}

/** Save a track to the user's Liked Songs library. */
export async function saveTrackToLibrary(userId: string, trackId: string): Promise<void> {
    if (!trackId) throw new Error("Missing track id.");
    await apiCall(userId, `/me/tracks?ids=${encodeURIComponent(trackId)}`, { method: "PUT" });
}
