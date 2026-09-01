import "server-only";

import sharp from "sharp";
import { objectKey, uploadObject } from "@/lib/s3";
import { MAX_USER_FILE_SIZE } from "@/lib/upload-limits";

export { MAX_USER_FILE_SIZE } from "@/lib/upload-limits";
const MAX_IMAGE_PIXELS = 40_000_000;

const ACTIVE_CONTENT_TYPES = new Set([
    "application/ecmascript",
    "application/javascript",
    "application/xhtml+xml",
    "application/xml",
    "image/svg+xml",
    "text/html",
    "text/javascript",
    "text/xml",
]);

function normalizedMimeType(value: string): string {
    const mime = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)) return "application/octet-stream";
    if (ACTIVE_CONTENT_TYPES.has(mime) || mime.startsWith("image/")) return "application/octet-stream";
    return mime;
}

function looksLikeSupportedRaster(buffer: Buffer): boolean {
    if (buffer.length < 12) return false;
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
    const header6 = buffer.subarray(0, 6).toString("ascii");
    if (header6 === "GIF87a" || header6 === "GIF89a") return true;
    if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return true;
    if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
        if (["avif", "avis"].includes(buffer.subarray(8, 12).toString("ascii"))) return true;
        for (let offset = 16; offset + 4 <= buffer.length && offset < 64; offset += 4) {
            if (["avif", "avis"].includes(buffer.subarray(offset, offset + 4).toString("ascii"))) return true;
        }
    }
    return false;
}

async function persistUserFile(
    userId: string,
    module: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
    metadata?: Record<string, string>,
) {
    const fileKey = objectKey(userId, module, fileName);
    await uploadObject(fileKey, buffer, mimeType, metadata);
    return { fileKey, fileName, fileSize: buffer.length, mimeType };
}

/**
 * Uploads a File (from FormData) into the user's S3 namespace.
 * Returns { fileKey, fileName, fileSize, mimeType } for persisting on a model.
 */
export async function uploadUserFile(userId: string, module: string, file: File) {
    if (file.size === 0) throw new Error("Empty file");
    if (file.size > MAX_USER_FILE_SIZE) throw new Error("File exceeds 25 MB limit");

    const buffer = Buffer.from(await file.arrayBuffer());
    return persistUserFile(userId, module, file.name, buffer, normalizedMimeType(file.type));
}

/**
 * Decode and re-encode an uploaded raster image before storage. This rejects
 * SVG/HTML and spoofed MIME payloads, caps decoder work, strips metadata, and
 * gives every stored preview a server-selected content type.
 */
export async function uploadUserRasterImage(userId: string, module: string, file: File) {
    if (file.size === 0) throw new Error("Empty image");
    if (file.size > MAX_USER_FILE_SIZE) throw new Error("Image exceeds 25 MB limit");

    const source = Buffer.from(await file.arrayBuffer());
    if (!looksLikeSupportedRaster(source)) throw new Error("Unsupported or invalid raster image");

    let processed: Buffer;
    try {
        const image = sharp(source, { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS });
        const metadata = await image.metadata();
        if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
            throw new Error("Image dimensions exceed the safe limit");
        }
        processed = await image
            .rotate()
            .resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 88, effort: 4 })
            .toBuffer();
    } catch {
        throw new Error("Unsupported, corrupt, or oversized raster image");
    }
    if (processed.length > MAX_USER_FILE_SIZE) throw new Error("Processed image exceeds 25 MB limit");

    const stem = file.name.replace(/\.[^.]*$/, "").trim() || "image";
    const stored = await persistUserFile(
        userId,
        module,
        `${stem}.webp`,
        processed,
        "image/webp",
        { "coretex-verified-raster": "1" },
    );
    return { ...stored, processedBuffer: processed };
}

/** Route image uploads through the raster sanitizer while preserving documents/media. */
export async function uploadUserMediaFile(userId: string, module: string, file: File) {
    if (!file.type.toLowerCase().startsWith("image/")) return uploadUserFile(userId, module, file);
    const stored = await uploadUserRasterImage(userId, module, file);
    return { fileKey: stored.fileKey, fileName: stored.fileName, fileSize: stored.fileSize, mimeType: stored.mimeType };
}

/** Reject client-round-tripped object keys outside the expected user/module namespace. */
export function assertUserUploadKey(userId: string, module: string, key: string): void {
    const prefix = `u/${userId}/${module}/`;
    if (!key.startsWith(prefix) || key.length > 1024 || /[\0\r\n]/.test(key)) {
        throw new Error("Invalid uploaded file reference");
    }
}

export { fileUrl } from "@/lib/files";
