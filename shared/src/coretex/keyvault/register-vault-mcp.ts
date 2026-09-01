// @ts-nocheck
import type { APIKey, ConnectorCredentialInput, ServiceConnection, CoretexConfig } from "@repo/coretex/types";
import { credentialFields, SERVICE_BY_ID, presetMcpBindings, vaultMcpServerId, type ServiceDef } from "./catalog";

type McpServerConfig = CoretexConfig["mcpServers"][number];

export function buildVaultIntegration(service: ServiceDef, opts: {
    accountLabel?: string;
    now?: number;
    enableMcpTools?: boolean;
    integrationId?: string;
}): ServiceConnection {
    const now = opts.now ?? Date.now();
    const enable = opts.enableMcpTools ?? Boolean(service.mcpRuntime);
    const id = opts.integrationId ?? `int_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const tools = presetMcpBindings(service.id).map((t) => ({
        ...t,
        permission: (enable ? t.permission : "disabled") as ServiceConnection["mcpTools"][number]["permission"],
    }));
    return {
        id,
        serviceId: service.id,
        serviceName: service.name,
        serviceDomain: service.domain,
        category: service.category,
        status: "connecting",
        authType: service.authType,
        connectedAs: opts.accountLabel?.trim() || `${service.name} account`,
        connectedAt: now,
        lastSyncedAt: now,
        mcpEnabled: enable,
        // Credential-only connectors are still useful to subprocess-backed
        // agents through their linked environment variables.
        agentEnabled: true,
        runtimeServerId: service.mcpRuntime ? vaultMcpServerId(service.id, id) : undefined,
        verification: "unverified",
        lastError: null,
        mcpTools: tools,
        stats: [],
        color: service.color,
        requireConfirmWrites: true,
    };
}

export function buildVaultApiKey(service: ServiceDef, secret: string, opts: {
    accountLabel?: string;
    now?: number;
    integrationId?: string;
    credentialLabel?: string;
    linkedEnvVarName?: string;
    primary?: boolean;
}): APIKey {
    const now = opts.now ?? Date.now();
    return {
        id: `key_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        serviceId: service.id,
        serviceName: service.name,
        serviceDomain: service.domain,
        nickname: `${opts.accountLabel?.trim() || service.name} · ${opts.credentialLabel || "credential"}`,
        keyValue: secret.trim(),
        keyPreview: "",
        category: service.category,
        environment: "production",
        status: "unverified",
        expiresAt: null,
        lastUsed: null,
        lastTested: null,
        testStatus: "untested",
        aiAgentAccess: opts.primary !== false,
        aiAccessScope: "read",
        projectId: null,
        note: `Saved when connecting the ${service.name} integration.`,
        tags: ["integration"],
        scopes: [],
        createdAt: now,
        updatedAt: now,
        integrationId: opts.integrationId,
        credentialLabel: opts.credentialLabel,
        linkedEnvVarName: opts.linkedEnvVarName,
    };
}

/** Convert every visible auth field into an atomic connector credential input.
 * The Brain persists one protected APIKey per item and returns their ids. */
export function buildConnectorCredentials(service: ServiceDef, values: Record<string, string>): ConnectorCredentialInput[] {
    return credentialFields(service).map((field) => ({
        label: field.label,
        value: (values[field.id] ?? "").trim(),
        primary: field.primary,
        linkedEnvVarName: field.envVar,
    }));
}

/** Build an account-scoped Settings MCP entry (id = vault-<service>-<account>). */
export function buildVaultMcpServer(service: ServiceDef, integration: ServiceConnection): McpServerConfig | null {
    const runtime = service.mcpRuntime;
    if (!runtime) return null;
    return {
        id: integration.runtimeServerId ?? vaultMcpServerId(service.id, integration.id),
        name: `${service.name} · ${integration.connectedAs}`,
        transport: "stdio",
        command: runtime.command ?? "npx",
        args: runtime.command
            ? (runtime.args ?? "")
            : `-y ${runtime.package}${runtime.args ? ` ${runtime.args}` : ""}`.trim(),
        enabled: true,
        envKeys: runtime.envVars ?? [runtime.envVar],
    };
}

export function upsertVaultMcpServer(
    settings: CoretexConfig,
    service: ServiceDef,
    integration: ServiceConnection,
): CoretexConfig["mcpServers"] | null {
    const entry = buildVaultMcpServer(service, integration);
    if (!entry) return null;
    const id = entry.id;
    const rest = (settings.mcpServers ?? []).filter((s) => s.id !== id);
    return [...rest, entry];
}

export function removeVaultMcpServer(
    settings: CoretexConfig,
    integration: Pick<ServiceConnection, "id" | "serviceId" | "runtimeServerId">,
): CoretexConfig["mcpServers"] {
    const id = integration.runtimeServerId ?? vaultMcpServerId(integration.serviceId, integration.id);
    return (settings.mcpServers ?? []).filter((s) => s.id !== id);
}

export function resolveService(serviceId: string): ServiceDef | undefined {
    return SERVICE_BY_ID[serviceId];
}
