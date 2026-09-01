// @ts-nocheck
import type { APIKey, ConnectorCredentialInput, CoretexConfig, ServiceConnection } from "@repo/coretex/types";
import type { CoretexActions } from "../use-coretex";
import type { ServiceDef } from "./catalog";
import { buildVaultMcpServer } from "./register-vault-mcp";

type VaultActions = Pick<
    CoretexActions,
    | "keyvaultUpsertKey"
    | "keyvaultUpsertIntegration"
    | "connectorConnect"
    | "connectorVerify"
    | "connectorDisconnect"
    | "updateSettings"
    | "setSecret"
>;

const AI_PROVIDER_BY_SERVICE: Record<string, string> = {
    openai: "openai",
    anthropic: "anthropic",
    gemini: "gemini",
    openrouter: "openrouter",
};

/** When an AI vault key is saved, also wire Settings → AI providers so chat/agents can use it. */
export function syncAiProviderFromVaultKey(opts: {
    key: APIKey;
    settings: CoretexConfig | null;
    actions: Pick<CoretexActions, "setSecret" | "updateSettings">;
}): void {
    const provider = AI_PROVIDER_BY_SERVICE[opts.key.serviceId];
    if (!provider || !opts.settings || !opts.key.keyValue.trim()) return;
    opts.actions.setSecret(`provider.${provider}.apiKey`, opts.key.keyValue.trim());
    const next = (opts.settings.aiProviders ?? []).map((p) => {
        if (p.provider !== provider) return p;
        return {
            ...p,
            keyConfigured: true,
            enabled: true,
            ...(provider === "anthropic" ? { authMode: "api-key" as const } : {}),
        };
    });
    opts.actions.updateSettings({ aiProviders: next });
}

/** Atomically persist every credential, connect/verify the integration, and
 * register its account-scoped MCP runtime when the catalog supplies one. */
export function applyVaultConnect(opts: {
    service: ServiceDef;
    integration: ServiceConnection;
    credentials: ConnectorCredentialInput[];
    actions: VaultActions;
}): string | null {
    return opts.actions.connectorConnect(
        opts.integration,
        opts.credentials,
        buildVaultMcpServer(opts.service, opts.integration) ?? undefined,
    );
}

/** Atomically stop the runtime, remove the connection, and clean its linked
 * connector credentials. */
export function applyVaultDisconnect(opts: {
    entry: ServiceConnection;
    actions: VaultActions;
}): string | null {
    return opts.actions.connectorDisconnect(opts.entry.id);
}

export function applyVaultVerify(opts: { entry: ServiceConnection; actions: VaultActions }): string | null {
    return opts.actions.connectorVerify(opts.entry.id);
}

/** Sync Settings MCP registration when the user toggles "Enable for AI agents". */
export function syncVaultMcpEnabled(opts: {
    integration: ServiceConnection;
    settings?: CoretexConfig | null;
    actions: VaultActions;
}): void {
    opts.actions.keyvaultUpsertIntegration({
        ...opts.integration,
        agentEnabled: opts.integration.agentEnabled ?? opts.integration.mcpEnabled,
    });
}
