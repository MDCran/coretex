import { createHash, createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const DEFAULT_ENDPOINT = "http://localhost:9400";
const DEFAULT_BUCKET = "lifeos";
const DEFAULT_REGION = "us-east-1";
const DEFAULT_ACCESS_KEY = "minioadmin";
const DEFAULT_SECRET_KEY = "minioadmin";

function localAssetUrl(filePath: string): string {
    const encodedPath = Buffer.from(resolve(filePath), "utf8").toString("base64url");
    return `coretex-asset://local/${encodedPath}`;
}

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
    return createHmac("sha256", key).update(value).digest();
}

function awsEncode(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function objectPath(endpoint: URL, bucket: string, key: string): string {
    const prefix = endpoint.pathname.replace(/\/$/, "");
    const encodedKey = key.replace(/^\/+/, "").split("/").map(awsEncode).join("/");
    return `${prefix}/${awsEncode(bucket)}/${encodedKey}` || "/";
}

/**
 * Generate a short-lived, read-only URL for an object originally stored by the
 * Combined app. This keeps private MinIO/S3 assets loadable in the file://
 * Electron renderer without making the bucket public or exposing the secret.
 */
export function presignedObjectUrl(key: string, expiresSeconds = 3_600, now = new Date()): string {
    const endpoint = new URL(process.env.S3_ENDPOINT?.trim() || DEFAULT_ENDPOINT);
    const bucket = process.env.S3_BUCKET?.trim() || DEFAULT_BUCKET;
    const region = process.env.S3_REGION?.trim() || DEFAULT_REGION;
    const accessKey = process.env.S3_ACCESS_KEY?.trim() || DEFAULT_ACCESS_KEY;
    const secretKey = process.env.S3_SECRET_KEY?.trim() || DEFAULT_SECRET_KEY;
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const canonicalUri = objectPath(endpoint, bucket, key);
    const params: Array<[string, string]> = [
        ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
        ["X-Amz-Credential", `${accessKey}/${credentialScope}`],
        ["X-Amz-Date", amzDate],
        ["X-Amz-Expires", String(Math.max(1, Math.min(604_800, Math.round(expiresSeconds))))],
        ["X-Amz-SignedHeaders", "host"],
    ];
    const canonicalQuery = params
        .map(([name, value]) => [awsEncode(name), awsEncode(value)] as const)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => `${name}=${value}`)
        .join("&");
    const canonicalHeaders = `host:${endpoint.host}\n`;
    const canonicalRequest = ["GET", canonicalUri, canonicalQuery, canonicalHeaders, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
    const dateKey = hmac(`AWS4${secretKey}`, dateStamp);
    const regionKey = hmac(dateKey, region);
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    endpoint.pathname = canonicalUri;
    endpoint.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return endpoint.toString();
}

/** True for Combined/LifeOS object keys stored in MinIO (not local absolute paths). */
export function isObjectStorageKey(key: string | null | undefined): boolean {
    const trimmed = key?.trim();
    if (!trimmed) return false;
    if (isAbsolute(trimmed)) return false;
    return trimmed.startsWith("u/") || trimmed.startsWith("global/");
}

/**
 * Download an object from MinIO/S3 via a short-lived presigned GET.
 * Used for statement/receipt keys imported from the Combined LifeOS app.
 */
export async function getObjectBytes(key: string): Promise<Buffer> {
    const trimmed = key.trim();
    if (!trimmed) throw new Error("Object key is empty.");
    const url = presignedObjectUrl(trimmed, 900);
    let response: Response;
    try {
        response = await fetch(url);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not reach object storage for this document (${message}). Is MinIO running on port 9400?`);
    }
    if (!response.ok) {
        throw new Error(`Document not found in object storage (HTTP ${response.status}).`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return Buffer.from(bytes);
}

/** Resolve web URLs, local desktop files, and Combined S3 object keys. */
export function resolveAssetUrl(key: string | null | undefined): string | null {
    const trimmed = key?.trim();
    if (!trimmed) return null;
    if (/^(?:https?:|data:|blob:|file:)/i.test(trimmed)) return trimmed;
    if (isAbsolute(trimmed)) return localAssetUrl(trimmed);
    const localPath = resolve(trimmed);
    if (existsSync(localPath)) return localAssetUrl(localPath);
    if (isObjectStorageKey(trimmed)) return presignedObjectUrl(trimmed);
    return null;
}
