// @ts-nocheck
// import "server-only";

/**
 * Minimal READ-ONLY Alpaca client built on fetch (no SDK / npm packages).
 *
 * Keys live in AlpacaConnection (per-user) and NEVER reach the client — every
 * function here is called from server actions only. Responses are cached in a
 * process-level Map for ~60s keyed by (apiKey + paper + endpoint) so repeated
 * page loads / net-worth computations don't hammer the API.
 *
 * There are deliberately NO order/trade endpoints. This module can only read.
 */

const PAPER_BASE = "https://paper-api.alpaca.markets";
const LIVE_BASE = "https://api.alpaca.markets";

export interface AlpacaCreds {
    apiKey: string;
    apiSecret: string;
    paper: boolean;
}

export interface AlpacaAccount {
    equity: number;
    lastEquity: number;
    cash: number;
    buyingPower: number;
    portfolioValue: number;
    currency: string;
    status: string;
}

export interface AlpacaPosition {
    symbol: string;
    qty: number;
    avgEntryPrice: number;
    currentPrice: number;
    marketValue: number;
    costBasis: number;
    unrealizedPl: number;
    unrealizedPlpc: number; // fraction, e.g. 0.05 = +5%
    side: string;
}

export interface AlpacaHistory {
    timestamps: number[]; // epoch seconds
    equity: (number | null)[];
    baseValue: number;
}

export type AlpacaRange = "1D" | "1W" | "1M" | "6M" | "1A" | "ALL";

/** Map our range tabs to Alpaca period + timeframe pairs. */
const RANGE_PARAMS: Record<AlpacaRange, { period: string; timeframe: string }> = {
    "1D": { period: "1D", timeframe: "5Min" },
    "1W": { period: "1W", timeframe: "1H" },
    "1M": { period: "1M", timeframe: "1D" },
    "6M": { period: "6M", timeframe: "1D" },
    "1A": { period: "1A", timeframe: "1D" },
    // "All": Alpaca caps history at the account's inception; a long period covers it.
    ALL: { period: "10A", timeframe: "1D" },
};

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

// --- tiny in-memory TTL cache (process-scoped) ---
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

function cacheKey(creds: AlpacaCreds, suffix: string): string {
    return `${creds.paper ? "p" : "l"}:${creds.apiKey}:${suffix}`;
}

async function alpacaGet<T>(creds: AlpacaCreds, path: string, ttl = true): Promise<T> {
    const key = cacheKey(creds, path);
    if (ttl) {
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
    }
    const base = creds.paper ? PAPER_BASE : LIVE_BASE;
    const res = await fetch(`${base}${path}`, {
        method: "GET",
        headers: {
            "APCA-API-KEY-ID": creds.apiKey,
            "APCA-API-SECRET-KEY": creds.apiSecret,
            accept: "application/json",
        },
        cache: "no-store",
    });
    if (!res.ok) {
        let detail = "";
        try {
            const body = (await res.json()) as { message?: string };
            detail = body?.message ? ` — ${body.message}` : "";
        } catch {
            // ignore parse errors
        }
        if (res.status === 401 || res.status === 403) throw new Error(`Alpaca rejected the API key/secret (HTTP ${res.status})${detail}`);
        throw new Error(`Alpaca request failed (HTTP ${res.status})${detail}`);
    }
    const value = (await res.json()) as T;
    if (ttl) cache.set(key, { at: Date.now(), value });
    return value;
}

/** GET /v2/account — equity, last_equity, cash, buying power. */
export async function getAccount(creds: AlpacaCreds): Promise<AlpacaAccount> {
    const a = await alpacaGet<Record<string, unknown>>(creds, "/v2/account");
    return {
        equity: num(a.equity),
        lastEquity: num(a.last_equity),
        cash: num(a.cash),
        buyingPower: num(a.buying_power),
        portfolioValue: num(a.portfolio_value),
        currency: typeof a.currency === "string" ? a.currency : "USD",
        status: typeof a.status === "string" ? a.status : "",
    };
}

/** GET /v2/positions — open positions with live market value + unrealized P/L. */
export async function getPositions(creds: AlpacaCreds): Promise<AlpacaPosition[]> {
    const rows = await alpacaGet<Record<string, unknown>[]>(creds, "/v2/positions");
    return (rows ?? [])
        .map((p) => ({
            symbol: String(p.symbol ?? ""),
            qty: num(p.qty),
            avgEntryPrice: num(p.avg_entry_price),
            currentPrice: num(p.current_price),
            marketValue: num(p.market_value),
            costBasis: num(p.cost_basis),
            unrealizedPl: num(p.unrealized_pl),
            unrealizedPlpc: num(p.unrealized_plpc),
            side: String(p.side ?? "long"),
        }))
        .sort((a, b) => b.marketValue - a.marketValue);
}

/** GET /v2/account/portfolio/history — equity time series for the chart. */
export async function getPortfolioHistory(creds: AlpacaCreds, range: AlpacaRange): Promise<AlpacaHistory> {
    const { period, timeframe } = RANGE_PARAMS[range] ?? RANGE_PARAMS["1M"];
    const qs = new URLSearchParams({ period, timeframe, extended_hours: "true" });
    const h = await alpacaGet<{ timestamp?: number[]; equity?: (number | null)[]; base_value?: number }>(
        creds,
        `/v2/account/portfolio/history?${qs.toString()}`,
    );
    return {
        timestamps: h.timestamp ?? [],
        equity: h.equity ?? [],
        baseValue: num(h.base_value),
    };
}

/** Lightweight connection test: returns equity on success, throws on bad keys. */
export async function testConnection(creds: AlpacaCreds): Promise<{ equity: number; currency: string; status: string; paper: boolean }> {
    const acct = await alpacaGet<Record<string, unknown>>(creds, "/v2/account", false);
    return {
        equity: num(acct.equity),
        currency: typeof acct.currency === "string" ? acct.currency : "USD",
        status: typeof acct.status === "string" ? acct.status : "",
        paper: creds.paper,
    };
}

/** Invalidate cached responses for a connection (e.g. after disconnect). */
export function clearAlpacaCache(creds: AlpacaCreds): void {
    const prefix = cacheKey(creds, "");
    for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}
