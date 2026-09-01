import "server-only";

import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";

/**
 * Plaid client for read-only bank / card linking and transaction sync.
 * Requires PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV (sandbox | development | production).
 */

export const READ_ONLY_PLAID_PRODUCTS = [Products.Transactions, Products.Liabilities] as const;
const FORBIDDEN_MONEY_MOVEMENT_PRODUCTS = new Set(["transfer", "payment_initiation"]);

function assertReadOnlyProducts(products: readonly Products[]) {
    for (const product of products) {
        if (FORBIDDEN_MONEY_MOVEMENT_PRODUCTS.has(String(product))) {
            throw new Error(`Refusing to create Plaid Link token with money-movement product: ${product}`);
        }
    }
}

export function plaidConfigured(): boolean {
    return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

function plaidEnv(): keyof typeof PlaidEnvironments {
    const env = (process.env.PLAID_ENV ?? "sandbox").toLowerCase();
    if (env === "production") return "production";
    if (env === "development") return "development";
    return "sandbox";
}

let _client: PlaidApi | null = null;

export function plaidClient(): PlaidApi {
    if (!plaidConfigured()) throw new Error("Plaid is not configured on the server.");
    if (!_client) {
        const configuration = new Configuration({
            basePath: PlaidEnvironments[plaidEnv()],
            baseOptions: {
                headers: {
                    "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
                    "PLAID-SECRET": process.env.PLAID_SECRET!,
                },
            },
        });
        _client = new PlaidApi(configuration);
    }
    return _client;
}

/** Create a Link token for the current user. */
export async function createLinkToken(userId: string): Promise<string> {
    const client = plaidClient();
    assertReadOnlyProducts(READ_ONLY_PLAID_PRODUCTS);
    const res = await client.linkTokenCreate({
        user: { client_user_id: userId },
        client_name: "LifeOS",
        // Read-only only: balances/account metadata, card liabilities, and transaction ledger sync.
        // Do not add Transfer, Payment Initiation, processor tokens, or other money-movement products here.
        products: [...READ_ONLY_PLAID_PRODUCTS],
        country_codes: [CountryCode.Us],
        language: "en",
        // Re-link existing items when adding more accounts at the same institution.
        ...(process.env.PLAID_WEBHOOK_URL ? { webhook: process.env.PLAID_WEBHOOK_URL } : {}),
    });
    return res.data.link_token;
}
