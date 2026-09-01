/**
 * Environment-agnostic YouTube helpers — safe to import from client OR server.
 * The network fetchers that hit YouTube live in `./youtube` (server-only); keep
 * pure parsing/formatting here so client components can use them without dragging
 * `server-only` into the browser bundle.
 */

export interface VideoMeta {
    youtubeId: string;
    url: string;
    title: string;
    channel: string | null;
    thumbnailUrl: string;
}

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isYouTubeUrl(url: URL): boolean {
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return (
        host === "youtube.com" ||
        host.endsWith(".youtube.com") ||
        host === "youtube-nocookie.com" ||
        host.endsWith(".youtube-nocookie.com") ||
        host === "youtu.be"
    );
}

function validVideoId(value: string | null | undefined): string | null {
    return value && VIDEO_ID_PATTERN.test(value) ? value : null;
}

/** Extract a video id from any common YouTube URL form, or accept a raw 11-char id. */
export function parseVideoId(input: string): string | null {
    const s = input.trim();
    if (VIDEO_ID_PATTERN.test(s)) return s;

    try {
        const u = new URL(s);
        if (!isYouTubeUrl(u)) return null;

        const host = u.hostname.toLowerCase();
        if (host === "youtu.be") return validVideoId(u.pathname.split("/")[1]);

        const queryId = validVideoId(u.searchParams.get("v"));
        if (queryId) return queryId;

        const pathMatch = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
        return validVideoId(pathMatch?.[1]);
    } catch {
        return null;
    }
}

/** Extract a playlist id (list=...) from a YouTube URL, or accept a raw list id. */
export function parsePlaylistId(input: string): string | null {
    const s = input.trim();
    if (/^(PL|UU|LL|FL|OL)[A-Za-z0-9_-]+$/.test(s)) return s;

    try {
        const u = new URL(s);
        if (!isYouTubeUrl(u)) return null;
        const playlistId = u.searchParams.get("list");
        return playlistId && PLAYLIST_ID_PATTERN.test(playlistId) ? playlistId : null;
    } catch {
        return null;
    }
}

/** High-resolution thumbnail URL for a video id (used for cards + collages). */
export function thumbnailFor(youtubeId: string): string {
    return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
}

export function watchUrl(youtubeId: string): string {
    return `https://www.youtube.com/watch?v=${youtubeId}`;
}

export function decodeXml(s: string): string {
    const entities: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        "#39": "'",
        apos: "'",
    };

    // One replacement pass is intentional: `&amp;lt;` becomes `&lt;`, not `<`.
    return s.replace(/&(amp|lt|gt|quot|#39|apos);/g, (entity, name: string) => entities[name] ?? entity);
}

/** Format a duration in seconds as "1h 23m" / "12m" / "—". */
export function formatDuration(seconds: number | null | undefined): string {
    if (!seconds || seconds <= 0) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}
