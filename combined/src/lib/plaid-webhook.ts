import { createHash, createPublicKey, timingSafeEqual, verify as verifySignature } from "node:crypto";
import type { JWKPublicKey } from "plaid";

export const MAX_PLAID_WEBHOOK_BODY_BYTES = 64 * 1024;

const MAX_JWT_BYTES = 16 * 1024;
const MAX_HEADER_SEGMENT_BYTES = 2 * 1024;
const MAX_PAYLOAD_SEGMENT_BYTES = 8 * 1024;
const MAX_KEY_ID_LENGTH = 128;
const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;
const MAX_CLOCK_SKEW_SECONDS = 30;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

type JsonObject = Record<string, unknown>;

export class PlaidWebhookBodyTooLargeError extends Error {
    constructor() {
        super(`Plaid webhook body exceeds ${MAX_PLAID_WEBHOOK_BODY_BYTES} bytes.`);
        this.name = "PlaidWebhookBodyTooLargeError";
    }
}

export class PlaidWebhookBadRequestError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PlaidWebhookBadRequestError";
    }
}

export class PlaidWebhookVerificationError extends Error {
    constructor(message = "Plaid webhook verification failed.") {
        super(message);
        this.name = "PlaidWebhookVerificationError";
    }
}

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64Url(segment: string, maxBytes: number): Buffer {
    if (!segment || segment.length > Math.ceil((maxBytes * 4) / 3) + 4 || !BASE64URL_PATTERN.test(segment)) {
        throw new PlaidWebhookVerificationError();
    }

    const decoded = Buffer.from(segment, "base64url");
    if (decoded.length > maxBytes || decoded.toString("base64url") !== segment) {
        throw new PlaidWebhookVerificationError();
    }
    return decoded;
}

function decodeJsonSegment(segment: string, maxBytes: number): JsonObject {
    try {
        const decoded = decodeBase64Url(segment, maxBytes).toString("utf8");
        const value: unknown = JSON.parse(decoded);
        if (!isJsonObject(value)) throw new PlaidWebhookVerificationError();
        return value;
    } catch (error) {
        if (error instanceof PlaidWebhookVerificationError) throw error;
        throw new PlaidWebhookVerificationError();
    }
}

function assertIntegerClaim(value: unknown): asserts value is number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new PlaidWebhookVerificationError();
    }
}

function assertValidVerificationKey(key: JWKPublicKey, keyId: string, nowSeconds: number) {
    if (
        !key ||
        key.alg !== "ES256" ||
        key.kty !== "EC" ||
        key.crv !== "P-256" ||
        key.use !== "sig" ||
        key.kid !== keyId ||
        typeof key.x !== "string" ||
        typeof key.y !== "string" ||
        !Number.isSafeInteger(key.created_at) ||
        key.created_at > nowSeconds + MAX_CLOCK_SKEW_SECONDS ||
        (key.expired_at !== null && (!Number.isSafeInteger(key.expired_at) || key.expired_at <= nowSeconds))
    ) {
        throw new PlaidWebhookVerificationError();
    }

    const x = decodeBase64Url(key.x, 32);
    const y = decodeBase64Url(key.y, 32);
    if (x.length !== 32 || y.length !== 32) throw new PlaidWebhookVerificationError();
}

/** Read a request body without allowing chunked uploads to bypass the size cap. */
export async function readPlaidWebhookBody(request: Request): Promise<Buffer> {
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null) {
        const normalized = contentLength.trim();
        if (!/^\d+$/.test(normalized)) {
            throw new PlaidWebhookBadRequestError("Invalid Content-Length header.");
        }
        const declaredLength = Number(normalized);
        if (!Number.isSafeInteger(declaredLength)) throw new PlaidWebhookBodyTooLargeError();
        if (declaredLength > MAX_PLAID_WEBHOOK_BODY_BYTES) throw new PlaidWebhookBodyTooLargeError();
    }

    if (!request.body) return Buffer.alloc(0);

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > MAX_PLAID_WEBHOOK_BODY_BYTES) {
                await reader.cancel();
                throw new PlaidWebhookBodyTooLargeError();
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    return Buffer.concat(
        chunks.map((chunk) => Buffer.from(chunk)),
        totalBytes,
    );
}

type VerificationOptions = {
    token: string;
    rawBody: Uint8Array;
    getVerificationKey: (keyId: string) => Promise<JWKPublicKey>;
    now?: Date;
};

/** Verify Plaid's ES256 signature, key metadata, freshness, and exact raw-body digest. */
export async function verifyPlaidWebhook({ token, rawBody, getVerificationKey, now = new Date() }: VerificationOptions): Promise<void> {
    if (!token || Buffer.byteLength(token, "utf8") > MAX_JWT_BYTES) {
        throw new PlaidWebhookVerificationError();
    }

    const segments = token.split(".");
    if (segments.length !== 3) throw new PlaidWebhookVerificationError();
    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    const header = decodeJsonSegment(encodedHeader, MAX_HEADER_SEGMENT_BYTES);
    const payload = decodeJsonSegment(encodedPayload, MAX_PAYLOAD_SEGMENT_BYTES);

    if (
        header.alg !== "ES256" ||
        (header.typ !== undefined && header.typ !== "JWT") ||
        header.crit !== undefined ||
        typeof header.kid !== "string" ||
        header.kid.length < 1 ||
        header.kid.length > MAX_KEY_ID_LENGTH ||
        !BASE64URL_PATTERN.test(header.kid)
    ) {
        throw new PlaidWebhookVerificationError();
    }

    const signature = decodeBase64Url(encodedSignature, 64);
    if (signature.length !== 64) throw new PlaidWebhookVerificationError();

    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new PlaidWebhookVerificationError();

    assertIntegerClaim(payload.iat);
    if (payload.iat < nowSeconds - MAX_WEBHOOK_AGE_SECONDS || payload.iat > nowSeconds + MAX_CLOCK_SKEW_SECONDS) {
        throw new PlaidWebhookVerificationError();
    }

    if (payload.nbf !== undefined) {
        assertIntegerClaim(payload.nbf);
        if (payload.nbf > nowSeconds + MAX_CLOCK_SKEW_SECONDS) throw new PlaidWebhookVerificationError();
    }
    if (payload.exp !== undefined) {
        assertIntegerClaim(payload.exp);
        if (payload.exp <= nowSeconds - MAX_CLOCK_SKEW_SECONDS) throw new PlaidWebhookVerificationError();
    }

    if (typeof payload.request_body_sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(payload.request_body_sha256)) {
        throw new PlaidWebhookVerificationError();
    }

    const key = await getVerificationKey(header.kid);
    assertValidVerificationKey(key, header.kid, nowSeconds);

    let publicKey;
    try {
        publicKey = createPublicKey({
            key: {
                kty: "EC",
                crv: "P-256",
                x: key.x,
                y: key.y,
            },
            format: "jwk",
        });
    } catch {
        throw new PlaidWebhookVerificationError();
    }

    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii");
    let signatureValid = false;
    try {
        signatureValid = verifySignature("sha256", signingInput, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature);
    } catch {
        throw new PlaidWebhookVerificationError();
    }
    if (!signatureValid) throw new PlaidWebhookVerificationError();

    const expectedDigest = Buffer.from(payload.request_body_sha256, "hex");
    const actualDigest = createHash("sha256").update(rawBody).digest();
    if (!timingSafeEqual(expectedDigest, actualDigest)) throw new PlaidWebhookVerificationError();
}
