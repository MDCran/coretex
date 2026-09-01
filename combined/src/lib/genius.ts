import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { sealSecret } from "@/lib/secret-box";
import { GENIUS_FETCH_REDIRECT, geniusPageUrl, safeGeniusPageUrl } from "@/lib/genius-url";
import { parseLrc, syncedLinesToPlain, type SyncedLyricLine } from "@/lib/lrc";
import type { GeniusLyricsResult } from "@/lib/genius-types";

export type { GeniusLyricsResult, SyncedLyricLine } from "@/lib/genius-types";

/**
 * Genius API integration (server-only).
 *
 * Lyrics flow:
 *  - Search songs via api.genius.com (app client-credentials token).
 *  - Resolve lyric text from the public Genius song page, then LRCLIB / lyrics.ovh fallbacks.
 *
 * OAuth (optional): /api/genius/connect → callback stores a per-user GeniusConnection.
 */

const AUTHORIZE_URL = "https://api.genius.com/oauth/authorize";
const TOKEN_URL = "https://api.genius.com/oauth/token";
const API_BASE = "https://api.genius.com";
const LRCLIB_API = "https://lrclib.net/api/search";
const LYRICS_OVH_API = "https://api.lyrics.ovh/v1";

const BROWSER_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
};

const STATE_COOKIE = "genius_oauth_state";

let cachedAppToken: { token: string; expiresAt: number } | null = null;

export class GeniusNotConfiguredError extends Error {
    constructor(message = "Genius is not configured.") {
        super(message);
        this.name = "GeniusNotConfiguredError";
    }
}

/** Whether Genius app credentials are configured on the server. */
export function geniusConfigured(): boolean {
    return Boolean(process.env.GENIUS_CLIENT_ID && process.env.GENIUS_CLIENT_SECRET);
}

function clientId(): string {
    const id = process.env.GENIUS_CLIENT_ID;
    if (!id) throw new GeniusNotConfiguredError("Set GENIUS_CLIENT_ID on the server.");
    return id;
}

function clientSecret(): string {
    const secret = process.env.GENIUS_CLIENT_SECRET;
    if (!secret) throw new GeniusNotConfiguredError("Set GENIUS_CLIENT_SECRET on the server.");
    return secret;
}

/** OAuth origin — aligns redirect host with GENIUS_REDIRECT_URI when set. */
export function geniusOAuthOrigin(requestOrigin?: string): string {
    const explicit = process.env.GENIUS_REDIRECT_URI?.trim();
    if (explicit) {
        try {
            return new URL(explicit).origin;
        } catch {
            /* fall through */
        }
    }
    return (requestOrigin ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function redirectUri(requestOrigin?: string): string {
    const explicit = process.env.GENIUS_REDIRECT_URI?.trim();
    if (explicit) return explicit.replace(/\/$/, "");
    return `${geniusOAuthOrigin(requestOrigin)}/api/genius/callback`;
}

export function geniusConnectUrl(requestOrigin?: string): string {
    return `${geniusOAuthOrigin(requestOrigin)}/api/genius/connect`;
}

// ============================================================
// OAuth
// ============================================================

export async function buildAuthorizeUrl(): Promise<string> {
    const state = randomBytes(16).toString("hex");
    const jar = await cookies();
    jar.set(STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 600,
        path: "/",
    });

    const params = new URLSearchParams({
        client_id: clientId(),
        redirect_uri: redirectUri(),
        scope: "me",
        state,
        response_type: "code",
    });
    return `${AUTHORIZE_URL}?${params}`;
}

export async function consumeState(state: string | null): Promise<boolean> {
    if (!state) return false;
    const jar = await cookies();
    const stored = jar.get(STATE_COOKIE)?.value;
    jar.delete(STATE_COOKIE);
    return Boolean(stored && stored === state);
}

interface TokenResponse {
    access_token: string;
    token_type: string;
    expires_in?: number;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        redirect: GENIUS_FETCH_REDIRECT,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Genius token exchange failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<TokenResponse>;
}

/** App-level access token (client credentials) — cached until expiry. */
export async function getAppAccessToken(): Promise<string> {
    if (cachedAppToken && Date.now() < cachedAppToken.expiresAt - 60_000) {
        return cachedAppToken.token;
    }

    const data = await postToken(
        new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId(),
            client_secret: clientSecret(),
        }),
    );

    cachedAppToken = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return data.access_token;
}

async function geniusApi<T>(path: string, token: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 0 },
        redirect: GENIUS_FETCH_REDIRECT,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Genius API ${path} failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
}

interface GeniusAccountResponse {
    response: { user: { id: number; name: string; login: string } };
}

export async function exchangeCodeAndConnect(input: { userId: string; code: string }): Promise<void> {
    const data = await postToken(
        new URLSearchParams({
            grant_type: "authorization_code",
            code: input.code,
            client_id: clientId(),
            client_secret: clientSecret(),
            redirect_uri: redirectUri(),
        }),
    );

    let geniusUserId: string | null = null;
    let displayName: string | null = null;
    try {
        const account = await geniusApi<GeniusAccountResponse>("/account", data.access_token);
        geniusUserId = String(account.response.user.id);
        displayName = account.response.user.name || account.response.user.login;
    } catch {
        /* account optional */
    }

    await db.geniusConnection.upsert({
        where: { userId: input.userId },
        create: {
            userId: input.userId,
            accessToken: sealSecret(data.access_token, { provider: "genius", userId: input.userId, field: "accessToken" }),
            geniusUserId,
            displayName,
        },
        update: {
            accessToken: sealSecret(data.access_token, { provider: "genius", userId: input.userId, field: "accessToken" }),
            geniusUserId,
            displayName,
        },
    });
}

// ============================================================
// Search & lyrics
// ============================================================

interface GeniusSearchHit {
    result: {
        id: number;
        title: string;
        url: string;
        primary_artist: { name: string };
        song_art_image_thumbnail_url?: string;
    };
}

interface GeniusSearchResponse {
    response: { hits: GeniusSearchHit[] };
}

function decodeHtmlEntities(text: string): string {
    const namedEntities: Record<string, string> = {
        nbsp: " ",
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
    };

    // Decode each source entity exactly once so encoded entity text stays encoded.
    return text.replace(
        /&(?:#x([0-9a-f]+)|#(\d+)|(nbsp|amp|lt|gt|quot|apos));/gi,
        (entity, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
            if (name) return namedEntities[name.toLowerCase()] ?? entity;

            const codePoint = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
            if (
                !Number.isInteger(codePoint) ||
                codePoint <= 0 ||
                codePoint > 0x10ffff ||
                (codePoint >= 0xd800 && codePoint <= 0xdfff)
            ) {
                return "\uFFFD";
            }
            return String.fromCodePoint(codePoint);
        },
    );
}

function lyricsHtmlToText(html: string): string {
    return decodeHtmlEntities(
        html
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/?[^>]+(>|$)/g, "")
            .trim(),
    );
}

/** Strip remaster/featuring noise so Genius search matches the canonical song. */
function cleanTitle(title: string): string {
    return title
        .replace(/\s*[-–—]\s*\d{4}\s*remaster(ed)?/gi, "")
        .replace(/\s*[-–—]\s*remaster(ed)?/gi, "")
        .replace(/\s*\([^)]*remaster[^)]*\)/gi, "")
        .replace(/\s*\(feat\..*?\)/gi, "")
        .replace(/\s*\(ft\..*?\)/gi, "")
        .replace(/\s*\(with .*?\)/gi, "")
        .replace(/\s*-\s*single version/gi, "")
        .trim();
}

function primaryArtist(artists: string): string {
    const first = artists.split(/,|&/)[0]?.trim();
    return first || artists.trim();
}

function normalizeForMatch(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function artistMatches(hitArtist: string, queryArtist: string): boolean {
    const a = normalizeForMatch(hitArtist);
    const b = normalizeForMatch(queryArtist);
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a);
}

function pickBestHit(hits: GeniusSearchHit[], artist: string): GeniusSearchHit["result"] | null {
    const results = hits.map((h) => h.result).filter(Boolean);
    if (results.length === 0) return null;
    const match = results.find((r) => artistMatches(r.primary_artist.name, artist));
    return match ?? results[0];
}

async function searchGeniusSong(token: string, title: string, artist: string): Promise<GeniusSearchHit["result"] | null> {
    const cleanedTitle = cleanTitle(title);
    const mainArtist = primaryArtist(artist);
    const queries = [...new Set([`${cleanedTitle} ${mainArtist}`, `${title} ${artist}`, cleanedTitle, title].filter(Boolean))];

    for (const q of queries) {
        const search = await geniusApi<GeniusSearchResponse>(`/search?q=${encodeURIComponent(q)}`, token);
        const hit = pickBestHit(search.response.hits ?? [], mainArtist);
        if (hit) return hit;
    }
    return null;
}

/** Extract inner HTML for each lyrics container, handling nested divs. */
function extractLyricsContainerHtml(html: string): string[] {
    const sections: string[] = [];
    const openRe = /<div[^>]*data-lyrics-container="true"[^>]*>/gi;
    let openMatch: RegExpExecArray | null;

    while ((openMatch = openRe.exec(html))) {
        const start = openMatch.index + openMatch[0].length;
        let depth = 1;
        let i = start;

        while (i < html.length && depth > 0) {
            const nextOpen = html.indexOf("<div", i);
            const nextClose = html.indexOf("</div>", i);
            if (nextClose === -1) break;

            if (nextOpen !== -1 && nextOpen < nextClose) {
                depth += 1;
                i = nextOpen + 4;
                continue;
            }

            depth -= 1;
            if (depth === 0) {
                sections.push(html.slice(start, nextClose));
                break;
            }
            i = nextClose + 6;
        }
    }

    return sections;
}

/** Scrape lyrics from the public Genius song page (API lyrics endpoint returns 403 server-side). */
async function fetchLyricsFromGeniusPage(url: string): Promise<string | null> {
    const safeUrl = geniusPageUrl(url);
    const res = await fetch(safeUrl, {
        headers: BROWSER_HEADERS,
        cache: "no-store",
        redirect: GENIUS_FETCH_REDIRECT,
    });
    if (!res.ok) return null;

    const html = await res.text();
    const sections: string[] = [];

    for (const chunk of extractLyricsContainerHtml(html)) {
        const text = lyricsHtmlToText(chunk);
        if (text.length < 20) continue;
        if (/^\d+\s*contributors/i.test(text)) continue;
        if (/^translations/i.test(text)) continue;
        sections.push(text);
    }

    const lyrics = sections.join("\n\n").trim();
    return lyrics.length > 0 ? lyrics : null;
}

interface LrclibHit {
    trackName?: string;
    artistName?: string;
    plainLyrics?: string | null;
    syncedLyrics?: string | null;
}

interface LrclibLyricsPayload {
    lyrics: string;
    syncedLines: SyncedLyricLine[] | null;
}

async function fetchLyricsFromLrclib(title: string, artist: string): Promise<LrclibLyricsPayload | null> {
    const params = new URLSearchParams({
        track_name: cleanTitle(title),
        artist_name: primaryArtist(artist),
    });
    const res = await fetch(`${LRCLIB_API}?${params}`, {
        cache: "no-store",
        redirect: GENIUS_FETCH_REDIRECT,
    });
    if (!res.ok) return null;

    const hits = (await res.json()) as LrclibHit[];
    const hit =
        hits.find((h) => h.syncedLyrics?.trim()) ??
        hits.find((h) => h.plainLyrics?.trim()) ??
        hits[0];
    if (!hit) return null;

    const syncedRaw = hit.syncedLyrics?.trim();
    const syncedLines = syncedRaw ? parseLrc(syncedRaw) : null;
    const plain = hit.plainLyrics?.trim()?.replace(/^\[[^\]]+\]\s*/gm, "").trim();

    const lyrics = syncedLines?.length ? syncedLinesToPlain(syncedLines) : plain;
    if (!lyrics && !syncedLines?.length) return null;

    return {
        lyrics: lyrics ?? "",
        syncedLines: syncedLines?.length ? syncedLines : null,
    };
}

async function fetchLyricsFromLyricsOvh(title: string, artist: string): Promise<string | null> {
    const path = `${encodeURIComponent(primaryArtist(artist))}/${encodeURIComponent(cleanTitle(title))}`;
    const res = await fetch(`${LYRICS_OVH_API}/${path}`, {
        cache: "no-store",
        redirect: GENIUS_FETCH_REDIRECT,
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { lyrics?: string; error?: string };
    const text = data.lyrics?.trim();
    return text && !data.error ? text : null;
}

async function resolvePlainLyricsText(title: string, artist: string, geniusUrl: string): Promise<string | null> {
    const sources = [
        ...(geniusUrl ? [() => fetchLyricsFromGeniusPage(geniusUrl)] : []),
        async () => (await fetchLyricsFromLrclib(title, artist))?.lyrics ?? null,
        () => fetchLyricsFromLyricsOvh(title, artist),
    ];

    for (const load of sources) {
        try {
            const lyrics = await load();
            if (lyrics) return lyrics;
        } catch {
            /* try next source */
        }
    }
    return null;
}

function buildLyricsResult(input: {
    hit: GeniusSearchHit["result"] | null;
    lrclib: LrclibLyricsPayload | null;
    plainLyrics: string | null;
    artist: string;
    title: string;
}): GeniusLyricsResult | null {
    const { hit, lrclib, plainLyrics, artist, title } = input;
    const mainArtist = primaryArtist(artist);
    const songTitle = cleanTitle(title);
    const lyrics = lrclib?.lyrics || plainLyrics || (lrclib?.syncedLines ? syncedLinesToPlain(lrclib.syncedLines) : null);
    if (!lyrics && !lrclib?.syncedLines?.length) return null;

    const searchUrl =
        safeGeniusPageUrl(hit?.url)?.href ??
        `https://genius.com/search?q=${encodeURIComponent(`${songTitle} ${mainArtist}`)}`;

    return {
        lyrics: lyrics ?? syncedLinesToPlain(lrclib!.syncedLines!),
        syncedLines: lrclib?.syncedLines ?? null,
        geniusUrl: searchUrl,
        songTitle: hit?.title ?? songTitle,
        artistName: hit?.primary_artist.name ?? mainArtist,
        thumbnailUrl: hit?.song_art_image_thumbnail_url ?? null,
    };
}

/** Resolve lyrics for a track by artist + title (uses app access token). */
export async function getLyricsForTrack(artist: string, title: string): Promise<GeniusLyricsResult | null> {
    if (!geniusConfigured()) return null;
    if (!artist.trim() || !title.trim()) return null;

    const token = await getAppAccessToken();
    const [hit, lrclib] = await Promise.all([searchGeniusSong(token, title, artist), fetchLyricsFromLrclib(title, artist)]);

    if (lrclib?.syncedLines?.length || lrclib?.lyrics) {
        const plain = lrclib.lyrics ? null : await resolvePlainLyricsText(title, artist, hit?.url ?? "");
        return buildLyricsResult({ hit, lrclib, plainLyrics: plain, artist, title });
    }

    if (hit) {
        const plain = await resolvePlainLyricsText(title, artist, hit.url);
        if (plain) {
            return buildLyricsResult({ hit, lrclib: null, plainLyrics: plain, artist, title });
        }
    }

    const fallbackPlain = await resolvePlainLyricsText(title, artist, "");
    return buildLyricsResult({ hit, lrclib: null, plainLyrics: fallbackPlain, artist, title });
}
