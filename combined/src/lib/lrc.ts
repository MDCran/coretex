/** Parsed LRC synced lyric line (client + server safe). */

export interface SyncedLyricLine {
    timeMs: number;
    text: string;
}

const METADATA_TAG = /^\[(?:ti|ar|al|by|length|re|ve|au|la|tool|offset):/i;

/** Convert `[mm:ss.xx]` capture groups to milliseconds. */
function timestampToMs(minutes: string, seconds: string, fraction?: string): number {
    const min = Number.parseInt(minutes, 10);
    const sec = Number.parseInt(seconds, 10);
    const ms = fraction ? Number.parseInt(fraction.padEnd(3, "0").slice(0, 3), 10) : 0;
    return min * 60_000 + sec * 1_000 + ms;
}

/**
 * Parse LRC synced lyrics into timestamped lines.
 * Supports standard `[mm:ss.xx]Lyric` format and `[offset:ms]` adjustments.
 */
export function parseLrc(lrc: string): SyncedLyricLine[] {
    let offsetMs = 0;
    const lines: SyncedLyricLine[] = [];
    const timeTag = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

    for (const raw of lrc.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;

        const offsetMatch = line.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
        if (offsetMatch) {
            offsetMs = Number.parseInt(offsetMatch[1], 10) || 0;
            continue;
        }

        if (METADATA_TAG.test(line)) continue;

        const tags = [...line.matchAll(timeTag)];
        if (tags.length === 0) continue;

        const text = line.replace(timeTag, "").trim();
        const last = tags[tags.length - 1];
        const timeMs = timestampToMs(last[1], last[2], last[3]) + offsetMs;

        lines.push({ timeMs, text });
    }

    return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** Whether a synced line contains singable text (not an instrumental gap marker). */
export function hasLyricText(line: SyncedLyricLine): boolean {
    return line.text.trim().length > 0;
}

/** Index of the line active at `progressMs`, or -1 before the first line. */
export function activeSyncedLineIndex(lines: SyncedLyricLine[], progressMs: number): number {
    if (lines.length === 0) return -1;
    const clamped = Math.max(0, progressMs);
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].timeMs <= clamped) return i;
    }
    return -1;
}

/** Small lag so highlight advances slightly after the timestamp (reduces early line switches). */
export const SYNC_DISPLAY_LAG_MS = 100;

/**
 * Index of the lyric line to highlight for display.
 * Holds the most recent sung line through instrumental gaps and empty LRC markers.
 */
export function activeSyncedDisplayIndex(lines: SyncedLyricLine[], progressMs: number): number {
    if (lines.length === 0) return -1;

    const firstTextIndex = lines.findIndex(hasLyricText);
    if (firstTextIndex < 0) return -1;
    if (progressMs < lines[firstTextIndex].timeMs) return -1;

    const adjusted = Math.max(0, progressMs - SYNC_DISPLAY_LAG_MS);
    let index = activeSyncedLineIndex(lines, adjusted);

    while (index >= 0 && !hasLyricText(lines[index])) {
        index--;
    }

    return index;
}

/** Plain text fallback from synced lines. */
export function syncedLinesToPlain(lines: SyncedLyricLine[]): string {
    return lines
        .map((l) => l.text)
        .filter(Boolean)
        .join("\n");
}
