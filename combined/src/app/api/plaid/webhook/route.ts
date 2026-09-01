import { NextResponse } from "next/server";
import type { JWKPublicKey } from "plaid";
import { db } from "@/lib/db";
import { syncPlaidItemFull } from "@/lib/financial/plaid-sync";
import { plaidClient, plaidConfigured } from "@/lib/plaid";
import {
    PlaidWebhookBadRequestError,
    PlaidWebhookBodyTooLargeError,
    PlaidWebhookVerificationError,
    readPlaidWebhookBody,
    verifyPlaidWebhook,
} from "@/lib/plaid-webhook";

export const runtime = "nodejs";

const KEY_CACHE_TTL_SECONDS = 5 * 60;
const MAX_CACHED_KEYS = 16;
const TRANSACTION_UPDATE_CODES = new Set(["SYNC_UPDATES_AVAILABLE", "DEFAULT_UPDATE", "INITIAL_UPDATE", "HISTORICAL_UPDATE"]);
const verificationKeyCache = new Map<string, { key: JWKPublicKey; validUntil: number }>();

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(body: Record<string, unknown>, field: string, maxLength: number): string | undefined {
    const value = body[field];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
        throw new PlaidWebhookBadRequestError(`Invalid ${field}.`);
    }
    return value;
}

function responseStatus(error: unknown): number | undefined {
    if (!isObject(error) || !isObject(error.response)) return undefined;
    return typeof error.response.status === "number" ? error.response.status : undefined;
}

async function getPlaidVerificationKey(keyId: string): Promise<JWKPublicKey> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const cached = verificationKeyCache.get(keyId);
    if (cached && cached.validUntil > nowSeconds) return cached.key;
    if (cached) verificationKeyCache.delete(keyId);

    let key: JWKPublicKey;
    try {
        const result = await plaidClient().webhookVerificationKeyGet({ key_id: keyId });
        key = result.data.key;
    } catch (error) {
        const status = responseStatus(error);
        if (status !== undefined && status >= 400 && status < 500) {
            throw new PlaidWebhookVerificationError();
        }
        throw error;
    }

    const validUntil = Math.min(key.expired_at ?? nowSeconds + KEY_CACHE_TTL_SECONDS, nowSeconds + KEY_CACHE_TTL_SECONDS);
    if (validUntil > nowSeconds) {
        if (verificationKeyCache.size >= MAX_CACHED_KEYS) {
            const oldestKey = verificationKeyCache.keys().next().value;
            if (oldestKey !== undefined) verificationKeyCache.delete(oldestKey);
        }
        verificationKeyCache.set(keyId, { key, validUntil });
    }
    return key;
}

/**
 * Plaid webhook handler — triggers transaction sync when Plaid signals updates.
 * Set PLAID_WEBHOOK_URL to your public URL + /api/plaid/webhook in the Plaid dashboard.
 */
export async function POST(req: Request) {
    const verificationToken = req.headers.get("plaid-verification");
    if (!verificationToken) {
        return NextResponse.json({ received: false }, { status: 401 });
    }
    if (!plaidConfigured()) {
        return NextResponse.json({ received: false }, { status: 503 });
    }

    try {
        const rawBody = await readPlaidWebhookBody(req);
        await verifyPlaidWebhook({
            token: verificationToken,
            rawBody,
            getVerificationKey: getPlaidVerificationKey,
        });

        let body: unknown;
        try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
            body = JSON.parse(text);
        } catch {
            throw new PlaidWebhookBadRequestError("Invalid JSON body.");
        }
        if (!isObject(body)) throw new PlaidWebhookBadRequestError("Invalid JSON body.");

        const webhookType = optionalString(body, "webhook_type", 128);
        const webhookCode = optionalString(body, "webhook_code", 128);
        const itemId = optionalString(body, "item_id", 256);

        if (webhookType === "TRANSACTIONS" && itemId) {
            if (webhookCode && TRANSACTION_UPDATE_CODES.has(webhookCode)) {
                const item = await db.plaidItem.findUnique({ where: { itemId }, select: { id: true } });
                if (item) await syncPlaidItemFull(item.id);
            }
        }

        if (webhookType === "ITEM" && webhookCode === "ERROR" && itemId) {
            const errorBody = body.error;
            if (errorBody !== undefined && !isObject(errorBody)) {
                throw new PlaidWebhookBadRequestError("Invalid error object.");
            }
            const errorCode = isObject(errorBody) ? (optionalString(errorBody, "error_code", 128) ?? "ITEM_ERROR") : "ITEM_ERROR";
            await db.plaidItem.updateMany({
                where: { itemId },
                data: { status: "error", errorCode },
            });
        }

        return NextResponse.json({ received: true });
    } catch (error) {
        if (error instanceof PlaidWebhookBodyTooLargeError) {
            return NextResponse.json({ received: false }, { status: 413 });
        }
        if (error instanceof PlaidWebhookBadRequestError) {
            return NextResponse.json({ received: false }, { status: 400 });
        }
        if (error instanceof PlaidWebhookVerificationError) {
            return NextResponse.json({ received: false }, { status: 401 });
        }
        console.error("[plaid webhook] processing failed", error instanceof Error ? error.message : "Unknown error");
        return NextResponse.json({ received: false }, { status: 500 });
    }
}
