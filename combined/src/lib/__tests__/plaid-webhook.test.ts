import { type KeyObject, createHash, generateKeyPairSync, sign as signMessage } from "node:crypto";
import type { JWKPublicKey } from "plaid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/plaid/webhook/route";
import {
    MAX_PLAID_WEBHOOK_BODY_BYTES,
    PlaidWebhookBodyTooLargeError,
    PlaidWebhookVerificationError,
    readPlaidWebhookBody,
    verifyPlaidWebhook,
} from "@/lib/plaid-webhook";
import { isPublicApiPath } from "@/proxy";

const mocks = vi.hoisted(() => ({
    plaidConfigured: vi.fn(),
    plaidClient: vi.fn(),
    webhookVerificationKeyGet: vi.fn(),
    syncPlaidItemFull: vi.fn(),
    db: {
        plaidItem: {
            findUnique: vi.fn(),
            updateMany: vi.fn(),
        },
    },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/plaid", () => ({
    plaidConfigured: mocks.plaidConfigured,
    plaidClient: mocks.plaidClient,
}));
vi.mock("@/lib/financial/plaid-sync", () => ({ syncPlaidItemFull: mocks.syncPlaidItemFull }));

const KEY_ID = "test-key-1";
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicJwk = keys.publicKey.export({ format: "jwk" });

function verificationKey(now: Date, overrides: Partial<JWKPublicKey> = {}): JWKPublicKey {
    if (!publicJwk.x || !publicJwk.y) throw new Error("Test key export failed.");
    const nowSeconds = Math.floor(now.getTime() / 1000);
    return {
        alg: "ES256",
        crv: "P-256",
        kid: KEY_ID,
        kty: "EC",
        use: "sig",
        x: publicJwk.x,
        y: publicJwk.y,
        created_at: nowSeconds - 60,
        expired_at: null,
        ...overrides,
    };
}

function signedToken(options: {
    body: string | Uint8Array;
    now: Date;
    privateKey?: KeyObject;
    header?: Record<string, unknown>;
    payload?: Record<string, unknown>;
}): string {
    const rawBody = typeof options.body === "string" ? Buffer.from(options.body) : Buffer.from(options.body);
    const header = { alg: "ES256", typ: "JWT", kid: KEY_ID, ...options.header };
    const payload = {
        iat: Math.floor(options.now.getTime() / 1000),
        request_body_sha256: createHash("sha256").update(rawBody).digest("hex"),
        ...options.payload,
    };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = signMessage("sha256", Buffer.from(signingInput, "ascii"), {
        key: options.privateKey ?? keys.privateKey,
        dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    return `${signingInput}.${signature}`;
}

describe("Plaid webhook JWT verification", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    const body = JSON.stringify({ webhook_type: "TRANSACTIONS", item_id: "item-1" });

    it("accepts a fresh ES256 token whose digest matches the exact raw body", async () => {
        const getVerificationKey = vi.fn().mockResolvedValue(verificationKey(now));
        await expect(
            verifyPlaidWebhook({
                token: signedToken({ body, now }),
                rawBody: Buffer.from(body),
                getVerificationKey,
                now,
            }),
        ).resolves.toBeUndefined();
        expect(getVerificationKey).toHaveBeenCalledWith(KEY_ID);
    });

    it("rejects a valid signature when the raw request body was changed", async () => {
        await expect(
            verifyPlaidWebhook({
                token: signedToken({ body, now }),
                rawBody: Buffer.from(`${body} `),
                getVerificationKey: async () => verificationKey(now),
                now,
            }),
        ).rejects.toBeInstanceOf(PlaidWebhookVerificationError);
    });

    it("rejects unsupported algorithms before requesting a key", async () => {
        const getVerificationKey = vi.fn().mockResolvedValue(verificationKey(now));
        await expect(
            verifyPlaidWebhook({
                token: signedToken({ body, now, header: { alg: "HS256" } }),
                rawBody: Buffer.from(body),
                getVerificationKey,
                now,
            }),
        ).rejects.toBeInstanceOf(PlaidWebhookVerificationError);
        expect(getVerificationKey).not.toHaveBeenCalled();
    });

    it("rejects stale or future-dated tokens", async () => {
        for (const iat of [Math.floor(now.getTime() / 1000) - 301, Math.floor(now.getTime() / 1000) + 31]) {
            await expect(
                verifyPlaidWebhook({
                    token: signedToken({ body, now, payload: { iat } }),
                    rawBody: Buffer.from(body),
                    getVerificationKey: async () => verificationKey(now),
                    now,
                }),
            ).rejects.toBeInstanceOf(PlaidWebhookVerificationError);
        }
    });

    it("rejects an expired or mismatched Plaid verification key", async () => {
        const nowSeconds = Math.floor(now.getTime() / 1000);
        for (const key of [verificationKey(now, { expired_at: nowSeconds }), verificationKey(now, { kid: "other-key" })]) {
            await expect(
                verifyPlaidWebhook({
                    token: signedToken({ body, now }),
                    rawBody: Buffer.from(body),
                    getVerificationKey: async () => key,
                    now,
                }),
            ).rejects.toBeInstanceOf(PlaidWebhookVerificationError);
        }
    });
});

describe("Plaid webhook request boundary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.plaidConfigured.mockReturnValue(true);
        mocks.plaidClient.mockReturnValue({ webhookVerificationKeyGet: mocks.webhookVerificationKeyGet });
        mocks.webhookVerificationKeyGet.mockImplementation(async () => ({
            data: { key: verificationKey(new Date()) },
        }));
        mocks.db.plaidItem.findUnique.mockResolvedValue({ id: "database-item-1" });
        mocks.db.plaidItem.updateMany.mockResolvedValue({ count: 1 });
        mocks.syncPlaidItemFull.mockResolvedValue(undefined);
    });

    it("permits the exact webhook path without making lookalike paths public", () => {
        expect(isPublicApiPath("/api/plaid/webhook")).toBe(true);
        expect(isPublicApiPath("/api/plaid/webhook/")).toBe(false);
        expect(isPublicApiPath("/api/plaid/webhook/anything")).toBe(false);
        expect(isPublicApiPath("/api/plaid/webhook-evil")).toBe(false);
    });

    it("rejects a tampered body before any database mutation or sync", async () => {
        const now = new Date();
        const signedBody = JSON.stringify({
            webhook_type: "TRANSACTIONS",
            webhook_code: "SYNC_UPDATES_AVAILABLE",
            item_id: "item-1",
        });
        const tamperedBody = signedBody.replace("item-1", "item-2");
        const response = await POST(
            new Request("http://localhost/api/plaid/webhook", {
                method: "POST",
                body: tamperedBody,
                headers: { "Plaid-Verification": signedToken({ body: signedBody, now }) },
            }),
        );

        expect(response.status).toBe(401);
        expect(mocks.db.plaidItem.findUnique).not.toHaveBeenCalled();
        expect(mocks.db.plaidItem.updateMany).not.toHaveBeenCalled();
        expect(mocks.syncPlaidItemFull).not.toHaveBeenCalled();
    });

    it("accepts an authentic transaction webhook and syncs only the matched item", async () => {
        const now = new Date();
        const body = JSON.stringify({
            webhook_type: "TRANSACTIONS",
            webhook_code: "SYNC_UPDATES_AVAILABLE",
            item_id: "item-1",
        });
        const response = await POST(
            new Request("http://localhost/api/plaid/webhook", {
                method: "POST",
                body,
                headers: { "Plaid-Verification": signedToken({ body, now }) },
            }),
        );

        expect(response.status).toBe(200);
        expect(mocks.db.plaidItem.findUnique).toHaveBeenCalledWith({
            where: { itemId: "item-1" },
            select: { id: true },
        });
        expect(mocks.syncPlaidItemFull).toHaveBeenCalledWith("database-item-1");
    });

    it("rejects an oversized declared or chunked body before key lookup and mutation", async () => {
        const declaredResponse = await POST(
            new Request("http://localhost/api/plaid/webhook", {
                method: "POST",
                body: "{}",
                headers: {
                    "Content-Length": String(MAX_PLAID_WEBHOOK_BODY_BYTES + 1),
                    "Plaid-Verification": "a.b.c",
                },
            }),
        );
        expect(declaredResponse.status).toBe(413);

        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(MAX_PLAID_WEBHOOK_BODY_BYTES));
                controller.enqueue(new Uint8Array(1));
                controller.close();
            },
        });
        const request = new Request("http://localhost/api/plaid/webhook", {
            method: "POST",
            body: stream,
            duplex: "half",
        } as RequestInit & { duplex: "half" });
        await expect(readPlaidWebhookBody(request)).rejects.toBeInstanceOf(PlaidWebhookBodyTooLargeError);

        expect(mocks.webhookVerificationKeyGet).not.toHaveBeenCalled();
        expect(mocks.db.plaidItem.findUnique).not.toHaveBeenCalled();
        expect(mocks.db.plaidItem.updateMany).not.toHaveBeenCalled();
        expect(mocks.syncPlaidItemFull).not.toHaveBeenCalled();
    });
});
