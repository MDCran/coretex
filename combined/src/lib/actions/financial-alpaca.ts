"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
    alpacaEnvConfigured,
    alpacaLiveEnvCreds,
    alpacaPaperEnvCreds,
    defaultAlpacaActivePaper,
    openAlpacaConnectionKeys,
} from "@/lib/financial/alpaca-config";
import { sealOptionalSecret } from "@/lib/secret-box";
import {
    clearAlpacaCache,
    getAccount,
    getPortfolioHistory,
    getPositions,
    testConnection,
    type AlpacaAccount,
    type AlpacaCreds,
    type AlpacaPosition,
    type AlpacaRange,
} from "@/lib/financial/alpaca";

/**
 * Server actions for the per-user Alpaca integration. API keys are stored in
 * AlpacaConnection and NEVER returned to the client — only derived portfolio data
 * crosses the boundary. Everything here is READ-ONLY (no order endpoints).
 */

type AlpacaRow = {
    userId: string;
    activePaper: boolean;
    paperApiKey: string | null;
    paperApiSecret: string | null;
    liveApiKey: string | null;
    liveApiSecret: string | null;
};

function mask(key: string): string {
    if (key.length <= 4) return "••••";
    return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function credsForMode(row: AlpacaRow, paper: boolean): AlpacaCreds | null {
    if (paper) {
        if (!row.paperApiKey || !row.paperApiSecret) return null;
        return { apiKey: row.paperApiKey, apiSecret: row.paperApiSecret, paper: true };
    }
    if (!row.liveApiKey || !row.liveApiSecret) return null;
    return { apiKey: row.liveApiKey, apiSecret: row.liveApiSecret, paper: false };
}

function activeCreds(row: AlpacaRow): AlpacaCreds | null {
    const primary = credsForMode(row, row.activePaper);
    if (primary) return primary;
    const fallback = credsForMode(row, !row.activePaper);
    return fallback;
}

function hasPaperKeys(row: AlpacaRow): boolean {
    return Boolean(row.paperApiKey && row.paperApiSecret);
}

function hasLiveKeys(row: AlpacaRow): boolean {
    return Boolean(row.liveApiKey && row.liveApiSecret);
}

async function loadRow(userId: string): Promise<AlpacaRow | null> {
    const row = await db.alpacaConnection.findUnique({
        where: { userId },
        select: {
            userId: true,
            activePaper: true,
            paperApiKey: true,
            paperApiSecret: true,
            liveApiKey: true,
            liveApiSecret: true,
        },
    });
    return row ? openAlpacaConnectionKeys(row) : null;
}

async function loadCreds(userId: string): Promise<AlpacaCreds | null> {
    const row = await loadRow(userId);
    if (!row) return null;
    return activeCreds(row);
}

/** Merge optional env keys into the DB without overwriting user-saved keys. */
export async function ensureAlpacaFromEnv(userId: string): Promise<void> {
    const paper = alpacaPaperEnvCreds();
    const live = alpacaLiveEnvCreds();
    if (!paper && !live) return;

    const existing = await loadRow(userId);
    const activePaper =
        paper && live ? (existing?.activePaper ?? defaultAlpacaActivePaper()) : paper ? true : live ? false : defaultAlpacaActivePaper();

    await db.alpacaConnection.upsert({
        where: { userId },
        create: {
            userId,
            activePaper,
            paperApiKey: sealOptionalSecret(paper?.apiKey, { provider: "alpaca", userId, field: "paperApiKey" }),
            paperApiSecret: sealOptionalSecret(paper?.apiSecret, { provider: "alpaca", userId, field: "paperApiSecret" }),
            liveApiKey: sealOptionalSecret(live?.apiKey, { provider: "alpaca", userId, field: "liveApiKey" }),
            liveApiSecret: sealOptionalSecret(live?.apiSecret, { provider: "alpaca", userId, field: "liveApiSecret" }),
        },
        update: {
            // Env wins on refresh so newly added secrets in .env are picked up.
            paperApiKey: sealOptionalSecret(paper?.apiKey ?? existing?.paperApiKey, { provider: "alpaca", userId, field: "paperApiKey" }),
            paperApiSecret: sealOptionalSecret(paper?.apiSecret ?? existing?.paperApiSecret, { provider: "alpaca", userId, field: "paperApiSecret" }),
            liveApiKey: sealOptionalSecret(live?.apiKey ?? existing?.liveApiKey, { provider: "alpaca", userId, field: "liveApiKey" }),
            liveApiSecret: sealOptionalSecret(live?.apiSecret ?? existing?.liveApiSecret, { provider: "alpaca", userId, field: "liveApiSecret" }),
            activePaper: paper && live ? activePaper : paper ? true : live ? false : activePaper,
        },
    });
}

/** Masked, key-free view of the connection for settings display. */
export interface AlpacaConnectionView {
    activePaper: boolean;
    hasPaper: boolean;
    hasLive: boolean;
    paperApiKeyMasked: string | null;
    liveApiKeyMasked: string | null;
    envConfigured: boolean;
    createdAt: string;
}

/** Bootstrap Alpaca from server env vars and verify the connection. */
export async function connectAlpacaFromEnv() {
    const user = await requireUser();
    if (!alpacaEnvConfigured()) {
        throw new Error(
            "Alpaca is not configured. Set ALPACA_PAPER_API_KEY and ALPACA_PAPER_API_SECRET (or ALPACA_LIVE_* for live) in .env, then restart the dev server.",
        );
    }

    await ensureAlpacaFromEnv(user.id);
    const creds = await loadCreds(user.id);
    if (!creds) {
        throw new Error(
            "Alpaca keys in .env are incomplete. Each mode needs both an API key and secret (ALPACA_PAPER_API_KEY + ALPACA_PAPER_API_SECRET, or ALPACA_LIVE_*).",
        );
    }

    const result = await testConnection(creds);
    revalidatePath("/settings/integrations");
    revalidatePath("/financial/accounts");
    revalidatePath("/financial");
    return { equity: result.equity, currency: result.currency, paper: result.paper };
}

/** Switch active portfolio between paper and live without re-entering keys. */
export async function setAlpacaActiveMode(paper: boolean) {
    const user = await requireUser();
    await ensureAlpacaFromEnv(user.id);
    const row = await loadRow(user.id);
    if (!row) throw new Error("No Alpaca connection saved.");

    const next = credsForMode(row, paper);
    if (!next) {
        throw new Error(
            paper
                ? "Paper trading keys are not in .env. Set ALPACA_PAPER_API_KEY and ALPACA_PAPER_API_SECRET, then restart the dev server."
                : "Live account keys are not in .env. Set ALPACA_LIVE_API_KEY and ALPACA_LIVE_API_SECRET, then restart the dev server.",
        );
    }

    const prev = activeCreds(row);
    await db.alpacaConnection.update({
        where: { userId: user.id },
        data: { activePaper: paper },
    });
    if (prev) clearAlpacaCache(prev);
    clearAlpacaCache(next);

    const result = await testConnection(next);
    revalidatePath("/settings/integrations");
    revalidatePath("/financial/accounts");
    revalidatePath("/financial");
    return { equity: result.equity, paper: result.paper };
}

/** Remove the stored Alpaca connection. */
export async function disconnectAlpaca() {
    const user = await requireUser();
    const row = await loadRow(user.id);
    const creds = row ? activeCreds(row) : null;
    if (creds) clearAlpacaCache(creds);
    await db.alpacaConnection.deleteMany({ where: { userId: user.id } });
    revalidatePath("/settings/integrations");
    revalidatePath("/financial/accounts");
    revalidatePath("/financial");
}

/** Test the currently active connection. */
export async function testAlpacaConnection() {
    const user = await requireUser();
    await ensureAlpacaFromEnv(user.id);
    const creds = await loadCreds(user.id);
    if (!creds) throw new Error("No Alpaca connection saved.");
    return testConnection(creds);
}

export interface AlpacaPortfolioData {
    account: AlpacaAccount;
    positions: AlpacaPosition[];
    paper: boolean;
}

/** Live account + positions for the brokerage page. Returns null when not connected. */
export async function fetchAlpacaPortfolio(): Promise<AlpacaPortfolioData | null> {
    const user = await requireUser();
    await ensureAlpacaFromEnv(user.id);
    const creds = await loadCreds(user.id);
    if (!creds) return null;
    const [account, positions] = await Promise.all([getAccount(creds), getPositions(creds)]);
    return { account, positions, paper: creds.paper };
}

export interface AlpacaHistoryPoint {
    label: string;
    t: number;
    equity: number | null;
}

/** Portfolio value history for the chart range tabs. Returns [] when not connected. */
export async function fetchAlpacaHistory(range: AlpacaRange): Promise<AlpacaHistoryPoint[]> {
    const user = await requireUser();
    await ensureAlpacaFromEnv(user.id);
    const creds = await loadCreds(user.id);
    if (!creds) return [];
    const h = await getPortfolioHistory(creds, range);
    return h.timestamps.map((ts, i) => ({
        t: ts * 1000,
        label: String(ts * 1000),
        equity: h.equity[i] ?? null,
    }));
}

/** Current Alpaca equity for net-worth inclusion. Returns null when not connected. */
export async function getAlpacaEquity(userId: string): Promise<number | null> {
    await ensureAlpacaFromEnv(userId);
    const creds = await loadCreds(userId);
    if (!creds) return null;
    try {
        const acct = await getAccount(creds);
        return acct.equity;
    } catch {
        return null;
    }
}

/** Masked connection view (key-free) for settings. */
export async function getAlpacaConnectionView(userId: string): Promise<AlpacaConnectionView | null> {
    await ensureAlpacaFromEnv(userId);
    const stored = await db.alpacaConnection.findUnique({ where: { userId } });
    if (!stored) return null;
    const conn = openAlpacaConnectionKeys(stored);

    const hasPaper = hasPaperKeys(conn);
    const hasLive = hasLiveKeys(conn);
    if (!hasPaper && !hasLive) return null;

    return {
        activePaper: conn.activePaper,
        hasPaper,
        hasLive,
        paperApiKeyMasked: conn.paperApiKey ? mask(conn.paperApiKey) : null,
        liveApiKeyMasked: conn.liveApiKey ? mask(conn.liveApiKey) : null,
        envConfigured: alpacaEnvConfigured(),
        createdAt: stored.createdAt.toISOString(),
    };
}

export async function isAlpacaConnected(userId: string): Promise<boolean> {
    await ensureAlpacaFromEnv(userId);
    const row = await loadRow(userId);
    if (!row) return false;
    return hasPaperKeys(row) || hasLiveKeys(row);
}
