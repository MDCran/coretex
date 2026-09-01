const SAFE_INLINE_TYPES = new Set([
    "application/pdf",
    "audio/aac",
    "audio/flac",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "image/avif",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/plain",
    "video/mp4",
    "video/ogg",
    "video/webm",
]);

export function safeContentType(value: string | undefined): string {
    const mime = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime) ? mime : "application/octet-stream";
}

export function canServeInline(contentType: string): boolean {
    return SAFE_INLINE_TYPES.has(contentType);
}

export function attachmentHeader(value: string): string {
    const cleaned = value.replace(/[\\"\r\n]/g, "_").replace(/[^\x20-\x7e]/g, "_").slice(0, 150) || "file";
    const unicodeSafeValue = Array.from(value, (character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint >= 0xd800 && codePoint <= 0xdfff ? "\uFFFD" : character;
    })
        .slice(0, 300)
        .join("");
    const encoded = encodeURIComponent(unicodeSafeValue).replace(/['()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `attachment; filename="${cleaned}"; filename*=UTF-8''${encoded}`;
}
