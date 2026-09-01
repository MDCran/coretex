import "server-only";

import { aiConfigured } from "@/lib/ai/claude";
import { alpacaEnvConfigured } from "@/lib/financial/alpaca-config";
import { plaidConfigured } from "@/lib/plaid";
import { geniusConfigured } from "@/lib/genius";
import { spotifyConfigured } from "@/lib/spotify";

/** How the server-side (env) integration is set up. */
export type IntegrationEnvState = "configured" | "not_configured" | "not_required";

/** Per-user link state when the integration supports account connection. */
export type IntegrationConnectionState = "connected" | "not_connected" | "unavailable" | "error";

export type IntegrationId = "spotify" | "genius" | "claude" | "plaid" | "alpaca";

export interface IntegrationStatus {
    id: IntegrationId;
    name: string;
    envVars: string[];
    env: IntegrationEnvState;
    requiresAccount: boolean;
    connection: IntegrationConnectionState;
    connectionDetail?: string;
    connectionCount?: number;
    /** Optional human-readable error detail when connection === "error". */
    error?: string;
}

export interface IntegrationStatusInput {
    spotifyConnection: { displayName: string | null; spotifyUserId: string } | null;
    geniusConnection: { displayName: string | null } | null;
    plaidItemCount: number;
    alpacaConnected: boolean;
    alpacaActivePaper?: boolean;
}

function connectionState(env: IntegrationEnvState, connected: boolean): IntegrationConnectionState {
    if (env === "not_configured") return "unavailable";
    return connected ? "connected" : "not_connected";
}

/** Snapshot of all integrations for Settings → Integrations. */
export function buildIntegrationStatuses(input: IntegrationStatusInput): IntegrationStatus[] {
    const spotifyEnv = spotifyConfigured() ? "configured" : "not_configured";
    const geniusEnv = geniusConfigured() ? "configured" : "not_configured";
    const claudeEnv = aiConfigured() ? "configured" : "not_configured";
    const plaidEnv = plaidConfigured() ? "configured" : "not_configured";

    return [
        {
            id: "spotify",
            name: "Spotify",
            envVars: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
            env: spotifyEnv,
            requiresAccount: true,
            connection: connectionState(spotifyEnv, Boolean(input.spotifyConnection)),
            connectionDetail: input.spotifyConnection
                ? (input.spotifyConnection.displayName ?? input.spotifyConnection.spotifyUserId)
                : undefined,
        },
        {
            id: "genius",
            name: "Genius (lyrics)",
            envVars: ["GENIUS_CLIENT_ID", "GENIUS_CLIENT_SECRET"],
            env: geniusEnv,
            requiresAccount: false,
            connection: geniusEnv === "configured" ? "connected" : "unavailable",
            connectionDetail:
                geniusEnv === "configured"
                    ? input.geniusConnection?.displayName
                        ? `Linked as ${input.geniusConnection.displayName}`
                        : "Lyrics via app credentials"
                    : undefined,
        },
        {
            id: "claude",
            name: "Anthropic Claude",
            envVars: ["ANTHROPIC_API_KEY"],
            env: claudeEnv,
            requiresAccount: false,
            connection: "not_connected",
        },
        {
            id: "plaid",
            name: "Plaid",
            envVars: ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV"],
            env: plaidEnv,
            requiresAccount: true,
            connection: connectionState(plaidEnv, input.plaidItemCount > 0),
            connectionCount: input.plaidItemCount,
            connectionDetail:
                input.plaidItemCount > 0
                    ? `${input.plaidItemCount} bank${input.plaidItemCount === 1 ? "" : "s"}`
                    : undefined,
        },
        {
            id: "alpaca",
            name: "Alpaca",
            envVars: ["ALPACA_PAPER_API_KEY", "ALPACA_PAPER_API_SECRET", "ALPACA_LIVE_API_KEY", "ALPACA_LIVE_API_SECRET"],
            env: alpacaEnvConfigured() ? "configured" : "not_configured",
            requiresAccount: true,
            connection: input.alpacaConnected ? "connected" : "not_connected",
            connectionDetail: input.alpacaConnected
                ? input.alpacaActivePaper === false
                    ? "Live account"
                    : "Paper trading"
                : undefined,
        },
    ];
}
