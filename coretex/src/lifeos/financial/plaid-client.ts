/**
 * Small Plaid REST client for the local Coretex Brain.
 *
 * Keeping this adapter fetch-based avoids shipping browser credentials or a
 * second HTTP service inside Electron. All tokens stay in the Brain process and
 * only normalized financial records cross the renderer bridge.
 */

type PlaidEnvironment = "sandbox" | "development" | "production";

function environment(): PlaidEnvironment {
    const value = String(process.env.PLAID_ENV ?? "sandbox").toLowerCase();
    if (value === "production" || value === "development") return value;
    return "sandbox";
}
function baseUrl(): string {
    return `https://${environment()}.plaid.com`;
}

export function plaidConfigured(): boolean {
    return Boolean(process.env.PLAID_CLIENT_ID?.trim() && process.env.PLAID_SECRET?.trim());
}

async function plaidPost<T = any>(path: string, payload: Record<string, unknown>): Promise<{ data: T }> {
    const clientId = process.env.PLAID_CLIENT_ID?.trim();
    const secret = process.env.PLAID_SECRET?.trim();
    if (!clientId || !secret) throw new Error("Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET in Coretex settings or the local Brain environment.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(`${baseUrl()}${path}`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "PLAID-CLIENT-ID": clientId,
                "PLAID-SECRET": secret,
                "Plaid-Version": "2020-09-14",
            },
            body: JSON.stringify({ client_id: clientId, secret, ...payload }),
            signal: controller.signal,
        });
        const data = await response.json().catch(() => ({})) as T & { error_message?: string; display_message?: string; error_code?: string };
        if (!response.ok) {
            const message = data.display_message || data.error_message || data.error_code || `Plaid request failed (${response.status}).`;
            throw new Error(message);
        }
        return { data };
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("Plaid did not respond within 30 seconds.");
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

export function plaidClient() {
    return {
        linkTokenCreate: (payload: Record<string, unknown>) => plaidPost<any>("/link/token/create", payload),
        itemPublicTokenExchange: (payload: Record<string, unknown>) => plaidPost<any>("/item/public_token/exchange", payload),
        itemGet: (payload: Record<string, unknown>) => plaidPost<any>("/item/get", payload),
        institutionsGetById: (payload: Record<string, unknown>) => plaidPost<any>("/institutions/get_by_id", payload),
        accountsGet: (payload: Record<string, unknown>) => plaidPost<any>("/accounts/get", payload),
        liabilitiesGet: (payload: Record<string, unknown>) => plaidPost<any>("/liabilities/get", payload),
        transactionsSync: (payload: Record<string, unknown>) => plaidPost<any>("/transactions/sync", payload),
        itemRemove: (payload: Record<string, unknown>) => plaidPost<any>("/item/remove", payload),
    };
}

export async function createLinkToken(userId: string): Promise<string> {
    const result = await plaidClient().linkTokenCreate({
        client_name: "Coretex",
        language: "en",
        country_codes: ["US"],
        products: ["transactions"],
        optional_products: ["liabilities"],
        user: { client_user_id: userId },
    });
    const token = result.data.link_token;
    if (!token) throw new Error("Plaid did not return a Link token.");
    return String(token);
}
