import "server-only";

import { decodeXml, parsePlaylistId, parseVideoId, thumbnailFor, watchUrl, type VideoMeta } from "./youtube-shared";

/**
 * Keyless YouTube metadata fetchers (server-only).
 *
 * Single videos use the public oEmbed endpoint (title, channel, thumbnail — no
 * duration is exposed without the Data API). Playlists are expanded via the
 * public RSS feed (`feeds/videos.xml?playlist_id=`), which returns the ~15 most
 * recent entries without a key. Duration is therefore an optional manual field.
 *
 * Pure parsing/formatting helpers live in ./youtube-shared (client-safe) and are
 * re-exported here for server callers' convenience.
 */

export { parseVideoId, parsePlaylistId, thumbnailFor, watchUrl, formatDuration } from "./youtube-shared";
export type { VideoMeta } from "./youtube-shared";

/** Fetch a single video's metadata via oEmbed. Throws if the video can't be resolved. */
export async function fetchVideoMeta(input: string): Promise<VideoMeta> {
    const youtubeId = parseVideoId(input);
    if (!youtubeId) throw new Error("Could not find a YouTube video id in that input.");
    const url = watchUrl(youtubeId);

    let title = `YouTube video ${youtubeId}`;
    let channel: string | null = null;
    try {
        const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
            headers: { accept: "application/json" },
        });
        if (res.ok) {
            const data = (await res.json()) as { title?: string; author_name?: string };
            if (data.title) title = data.title;
            if (data.author_name) channel = data.author_name;
        }
    } catch {
        // network/parse failure — fall back to id-derived defaults below
    }

    return { youtubeId, url, title, channel, thumbnailUrl: thumbnailFor(youtubeId) };
}

interface RssEntry {
    youtubeId: string;
    title: string;
    channel: string | null;
}

/** Expand a playlist via its public RSS feed (keyless, ~15 most recent entries). */
export async function fetchPlaylistVideos(input: string): Promise<VideoMeta[]> {
    const playlistId = parsePlaylistId(input);
    if (!playlistId) throw new Error("Could not find a playlist id in that URL.");

    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`);
    if (!res.ok) throw new Error("Could not load that playlist (it may be private or empty).");
    const xml = await res.text();

    const entries: RssEntry[] = [];
    const blocks = xml.split("<entry>").slice(1);
    for (const block of blocks) {
        const idMatch = block.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/);
        if (!idMatch) continue;
        const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
        const authorMatch = block.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/);
        entries.push({
            youtubeId: idMatch[1],
            title: decodeXml(titleMatch?.[1]?.trim() ?? `Video ${idMatch[1]}`),
            channel: authorMatch ? decodeXml(authorMatch[1].trim()) : null,
        });
    }
    if (!entries.length) throw new Error("No videos found in that playlist feed.");

    return entries.map((e) => ({
        youtubeId: e.youtubeId,
        url: watchUrl(e.youtubeId),
        title: e.title,
        channel: e.channel,
        thumbnailUrl: thumbnailFor(e.youtubeId),
    }));
}
