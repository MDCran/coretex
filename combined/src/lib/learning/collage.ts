import "server-only";

import sharp from "sharp";
import { objectKey, uploadObject } from "@/lib/s3";

/**
 * Build a 2x2 thumbnail collage cover for a video group and upload it to S3.
 * Returns the object key (served via `fileUrl`). Falls back gracefully when a
 * thumbnail can't be fetched by filling that cell with the theme color.
 */

const CELL = 320; // each quadrant is 320x320 → 640x640 cover
const SIZE = CELL * 2;

function hexToRgb(hex: string | null | undefined): { r: number; g: number; b: number } {
    const fallback = { r: 30, g: 41, b: 59 }; // slate-800
    if (!hex) return fallback;
    const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
    if (!m) return fallback;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

async function cell(url: string | undefined, bg: { r: number; g: number; b: number }): Promise<Buffer> {
    const solid = () =>
        sharp({ create: { width: CELL, height: CELL, channels: 3, background: bg } })
            .jpeg()
            .toBuffer();
    if (!url) return solid();
    try {
        const res = await fetch(url);
        if (!res.ok) return solid();
        const buf = Buffer.from(await res.arrayBuffer());
        return await sharp(buf).resize(CELL, CELL, { fit: "cover", position: "centre" }).jpeg().toBuffer();
    } catch {
        return solid();
    }
}

export async function buildCollageBuffer(thumbnailUrls: string[], themeColor?: string | null): Promise<Buffer> {
    const bg = hexToRgb(themeColor);
    // Take up to 4 distinct thumbnails; tile if fewer so the grid always fills.
    const picks: (string | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
        picks.push(thumbnailUrls.length ? thumbnailUrls[i % thumbnailUrls.length] : undefined);
    }
    const cells = await Promise.all(picks.map((u) => cell(u, bg)));
    const positions = [
        { left: 0, top: 0 },
        { left: CELL, top: 0 },
        { left: 0, top: CELL },
        { left: CELL, top: CELL },
    ];
    return sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: bg } })
        .composite(cells.map((input, i) => ({ input, ...positions[i] })))
        .jpeg({ quality: 82 })
        .toBuffer();
}

/** Build + upload a group cover collage. Returns the S3 object key. */
export async function generateGroupCover(userId: string, thumbnailUrls: string[], themeColor?: string | null): Promise<string> {
    const buffer = await buildCollageBuffer(thumbnailUrls, themeColor);
    const key = objectKey(userId, "learning/video-groups", "cover.jpg");
    await uploadObject(key, buffer, "image/jpeg");
    return key;
}
