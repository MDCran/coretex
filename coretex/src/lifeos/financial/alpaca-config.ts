// @ts-nocheck
// import "server-only";

import type { AlpacaCreds } from "@/lib/financial/alpaca";
import { openOptionalIntegrationSecret } from "../../security/integration-secret-box.js";

function readEnv(...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    return undefined;
}

function apcaBaseUrl(): string {
    return (process.env.APCA_API_BASE_URL ?? process.env.ALPACA_API_BASE_URL ?? "").trim().toLowerCase();
}

/** True when generic APCA_* keys target the live API (default is paper). */
function apcaGenericIsLive(): boolean {
    const base = apcaBaseUrl();
    if (!base) return false;
    return base.includes("api.alpaca.markets") && !base.includes("paper");
}

export type AlpacaEnvStatus = {
    paperReady: boolean;
    liveReady: boolean;
    paperKeyOnly: boolean;
    liveKeyOnly: boolean;
};

export function getAlpacaEnvStatus(): AlpacaEnvStatus {
    const paperKey = readEnv("ALPACA_PAPER_API_KEY", "ALPACA_PAPER_API_KEY_ID");
    const paperSecret = readEnv("ALPACA_PAPER_API_SECRET", "ALPACA_PAPER_API_SECRET_KEY");
    const liveKey = readEnv("ALPACA_LIVE_API_KEY", "ALPACA_LIVE_API_KEY_ID");
    const liveSecret = readEnv("ALPACA_LIVE_API_SECRET", "ALPACA_LIVE_API_SECRET_KEY");

    const genericKey = readEnv("APCA_API_KEY_ID", "ALPACA_API_KEY", "ALPACA_API_KEY_ID");
    const genericSecret = readEnv("APCA_API_SECRET_KEY", "ALPACA_API_SECRET", "ALPACA_SECRET_KEY", "ALPACA_API_SECRET_KEY");

    const paperFromGeneric = !apcaGenericIsLive() && genericKey && genericSecret ? { key: genericKey, secret: genericSecret } : null;
    const liveFromGeneric = apcaGenericIsLive() && genericKey && genericSecret ? { key: genericKey, secret: genericSecret } : null;

    const paperReady = Boolean((paperKey && paperSecret) || paperFromGeneric);
    const liveReady = Boolean((liveKey && liveSecret) || liveFromGeneric);
    const paperKeyOnly = Boolean((paperKey || paperFromGeneric?.key) && !paperReady);
    const liveKeyOnly = Boolean((liveKey || liveFromGeneric?.key) && !liveReady);

    return { paperReady, liveReady, paperKeyOnly, liveKeyOnly };
}

/** Paper-trading keys from server env (optional bootstrap). */
export function alpacaPaperEnvCreds(): Pick<AlpacaCreds, "apiKey" | "apiSecret"> | null {
    const apiKey = readEnv("ALPACA_PAPER_API_KEY", "ALPACA_PAPER_API_KEY_ID");
    const apiSecret = readEnv("ALPACA_PAPER_API_SECRET", "ALPACA_PAPER_API_SECRET_KEY");
    if (apiKey && apiSecret) return { apiKey, apiSecret };

    if (!apcaGenericIsLive()) {
        const genericKey = readEnv("APCA_API_KEY_ID", "ALPACA_API_KEY", "ALPACA_API_KEY_ID");
        const genericSecret = readEnv("APCA_API_SECRET_KEY", "ALPACA_API_SECRET", "ALPACA_SECRET_KEY", "ALPACA_API_SECRET_KEY");
        if (genericKey && genericSecret) return { apiKey: genericKey, apiSecret: genericSecret };
    }

    return null;
}

/** Live/production keys from server env (optional bootstrap). */
export function alpacaLiveEnvCreds(): Pick<AlpacaCreds, "apiKey" | "apiSecret"> | null {
    const apiKey = readEnv("ALPACA_LIVE_API_KEY", "ALPACA_LIVE_API_KEY_ID");
    const apiSecret = readEnv("ALPACA_LIVE_API_SECRET", "ALPACA_LIVE_API_SECRET_KEY");
    if (apiKey && apiSecret) return { apiKey, apiSecret };

    if (apcaGenericIsLive()) {
        const genericKey = readEnv("APCA_API_KEY_ID", "ALPACA_API_KEY", "ALPACA_API_KEY_ID");
        const genericSecret = readEnv("APCA_API_SECRET_KEY", "ALPACA_API_SECRET", "ALPACA_SECRET_KEY", "ALPACA_API_SECRET_KEY");
        if (genericKey && genericSecret) return { apiKey: genericKey, apiSecret: genericSecret };
    }

    return null;
}

export function alpacaEnvConfigured(): boolean {
    const status = getAlpacaEnvStatus();
    return status.paperReady || status.liveReady;
}

/** Default active mode from whichever env keys are present. */
export function defaultAlpacaActivePaper(): boolean {
    const paper = alpacaPaperEnvCreds();
    const live = alpacaLiveEnvCreds();
    if (paper && !live) return true;
    if (live && !paper) return false;
    return true;
}

export type AlpacaConnectionKeys = {
    userId: string;
    activePaper: boolean;
    paperApiKey: string | null;
    paperApiSecret: string | null;
    liveApiKey: string | null;
    liveApiSecret: string | null;
};

/** Convert database ciphertext into in-memory credentials at the last responsible moment. */
export function openAlpacaConnectionKeys(conn: AlpacaConnectionKeys): AlpacaConnectionKeys {
    return {
        userId: conn.userId,
        activePaper: conn.activePaper,
        paperApiKey: openOptionalIntegrationSecret(conn.paperApiKey, { provider: "alpaca", userId: conn.userId, field: "paperApiKey" }),
        paperApiSecret: openOptionalIntegrationSecret(conn.paperApiSecret, { provider: "alpaca", userId: conn.userId, field: "paperApiSecret" }),
        liveApiKey: openOptionalIntegrationSecret(conn.liveApiKey, { provider: "alpaca", userId: conn.userId, field: "liveApiKey" }),
        liveApiSecret: openOptionalIntegrationSecret(conn.liveApiSecret, { provider: "alpaca", userId: conn.userId, field: "liveApiSecret" }),
    };
}

/** Resolve credentials for the active mode, with fallback to the other mode if needed. */
export function resolveActiveAlpacaCreds(conn: AlpacaConnectionKeys): AlpacaCreds | null {
    const opened = openAlpacaConnectionKeys(conn);
    const paper =
        opened.paperApiKey && opened.paperApiSecret
            ? { apiKey: opened.paperApiKey, apiSecret: opened.paperApiSecret, paper: true as const }
            : null;
    const live =
        opened.liveApiKey && opened.liveApiSecret
            ? { apiKey: opened.liveApiKey, apiSecret: opened.liveApiSecret, paper: false as const }
            : null;
    if (opened.activePaper) return paper ?? live;
    return live ?? paper;
}
