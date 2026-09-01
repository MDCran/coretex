import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { connectAlpacaFromEnv, getAlpacaConnectionView } from "@/lib/actions/financial-alpaca";
import { getPlaidItemsView, type PlaidLinkOption } from "@/lib/actions/financial-plaid";
import { alpacaEnvConfigured, getAlpacaEnvStatus } from "@/lib/financial/alpaca-config";
import { buildIntegrationStatuses } from "@/lib/integrations/status";
import { createLinkToken, plaidConfigured } from "@/lib/plaid";
import { getRequestOrigin } from "@/lib/request-origin";
import { geniusConnectUrl, geniusOAuthOrigin } from "@/lib/genius";
import { redirectUri as spotifyRedirectUri, spotifyConnectUrl } from "@/lib/spotify";
import { IntegrationsClient } from "./integrations-client";

export const dynamic = "force-dynamic";

export default async function SettingsIntegrationsPage() {
    const user = await requireUser();
    const requestOrigin = await getRequestOrigin();
    const alpacaEnv = getAlpacaEnvStatus();

    let alpaca = await getAlpacaConnectionView(user.id);
    let alpacaAutoConnectError: string | null = null;
    if (!alpaca && alpacaEnvConfigured()) {
        try {
            await connectAlpacaFromEnv();
            alpaca = await getAlpacaConnectionView(user.id);
        } catch (e) {
            // Surface the reason (e.g. rejected keys) instead of silently showing "Not connected".
            alpacaAutoConnectError = e instanceof Error ? e.message : "Could not connect to Alpaca with the keys in .env.";
        }
    }

    const [conn, geniusConn, plaidItems, finAccounts, creditCards] = await Promise.all([
        db.spotifyConnection.findUnique({ where: { userId: user.id } }),
        db.geniusConnection.findUnique({ where: { userId: user.id } }),
        getPlaidItemsView(user.id),
        db.finAccount.findMany({
            where: { userId: user.id },
            orderBy: [{ archived: "asc" }, { createdAt: "desc" }],
            select: { id: true, nickname: true, kind: true, last4: true, institution: true, institutionRef: { select: { name: true } } },
        }),
        db.creditCard.findMany({
            where: { userId: user.id },
            orderBy: [{ archived: "asc" }, { createdAt: "desc" }],
            select: { id: true, nickname: true, productName: true, last4: true, issuer: true, institutionRef: { select: { name: true } } },
        }),
    ]);

    const plaidLinkOptions: PlaidLinkOption[] = [
        ...finAccounts.map((a) => ({
            value: `account:${a.id}`,
            label: `Account: ${a.nickname || a.institutionRef?.name || a.institution || a.kind}${a.last4 ? ` ••${a.last4}` : ""}`,
            kind: "account" as const,
        })),
        ...creditCards.map((c) => ({
            value: `card:${c.id}`,
            label: `Card: ${c.nickname || c.productName || c.institutionRef?.name || c.issuer || "Card"}${c.last4 ? ` ••${c.last4}` : ""}`,
            kind: "card" as const,
        })),
    ];

    let plaidLinkToken: string | null = null;
    let plaidLinkError: string | null = null;
    if (plaidConfigured()) {
        try {
            plaidLinkToken = await createLinkToken(user.id);
        } catch (e) {
            plaidLinkError = e instanceof Error ? e.message : "Could not create Plaid link token";
        }
    }

    const statuses = buildIntegrationStatuses({
        spotifyConnection: conn
            ? { displayName: conn.displayName, spotifyUserId: conn.spotifyUserId }
            : null,
        geniusConnection: geniusConn ? { displayName: geniusConn.displayName } : null,
        plaidItemCount: plaidItems.length,
        alpacaConnected: Boolean(alpaca),
        alpacaActivePaper: alpaca?.activePaper,
    });

    const spotifyRedirectOrigin = requestOrigin;
    const geniusRedirectOrigin = geniusOAuthOrigin(requestOrigin);

    return (
        <IntegrationsClient
            statuses={statuses}
            plaidItems={plaidItems}
            connection={
                conn
                    ? {
                          displayName: conn.displayName,
                          spotifyUserId: conn.spotifyUserId,
                          scopes: conn.scope ? conn.scope.split(" ").filter(Boolean) : [],
                      }
                    : null
            }
            alpaca={alpaca}
            alpacaEnv={alpacaEnv}
            alpacaAutoConnectError={alpacaAutoConnectError}
            spotifyConnectUrl={spotifyConnectUrl(requestOrigin)}
            spotifyRedirectOrigin={spotifyRedirectOrigin}
            spotifyRedirectUri={spotifyRedirectUri(requestOrigin)}
            geniusConnection={geniusConn ? { displayName: geniusConn.displayName } : null}
            geniusConnectUrl={geniusConnectUrl(requestOrigin)}
            geniusRedirectOrigin={geniusRedirectOrigin}
            plaidLinkToken={plaidLinkToken}
            plaidLinkError={plaidLinkError}
            plaidLinkOptions={plaidLinkOptions}
        />
    );
}
