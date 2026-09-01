import type { APIKey, MCPToolBinding, ServiceConnection } from "../types.js";

/** Persisted sentinel used by the UI to distinguish explicit none from inherit-all. */
export const EXPLICIT_NONE_CONNECTOR_ID = "__none__";

function uniqueIds(ids: string[] | undefined): string[] {
    return [...new Set((ids ?? []).map((id) => id.trim()).filter((id) => id.length > 0 && id !== EXPLICIT_NONE_CONNECTOR_ID))];
}

function explicitlyNone(ids: string[] | undefined): boolean {
    return (ids ?? []).includes(EXPLICIT_NONE_CONNECTOR_ID);
}

export interface EffectiveConnectorAccessInput {
    integrations: ServiceConnection[];
    /** True when dispatching a task belonging to a project. */
    projectTask: boolean;
    /** A project task has no connector access until this allowlist is populated. */
    projectConnectorIds?: string[];
    /** Empty/undefined inherits the project list (or all global connectors outside a project). */
    agentConnectorIds?: string[];
}

/**
 * Resolve the canonical account-level connector allowlist.
 *
 * Project tasks fail closed: the project must explicitly name connector accounts.
 * An agent may only narrow that list. Outside a project, an empty agent list inherits
 * all healthy global connector accounts. `__none__` always means no access.
 */
export function effectiveConnectorIds(input: EffectiveConnectorAccessInput): string[] {
    const eligible = input.integrations
        .filter((integration) =>
            integration.category !== "ai" &&
            integration.agentEnabled !== false &&
            (integration.status === "connected" || integration.status === "partial"),
        )
        .map((integration) => integration.id);
    const eligibleSet = new Set(eligible);

    let base: string[];
    if (input.projectTask) {
        if (explicitlyNone(input.projectConnectorIds)) return [];
        const projectIds = uniqueIds(input.projectConnectorIds);
        if (projectIds.length === 0) return [];
        base = projectIds.filter((id) => eligibleSet.has(id));
    } else {
        base = eligible;
    }

    if (explicitlyNone(input.agentConnectorIds)) return [];
    const agentIds = uniqueIds(input.agentConnectorIds);
    if (agentIds.length === 0) return base;
    const agentSet = new Set(agentIds);
    return base.filter((id) => agentSet.has(id));
}

/** Runtime server ids reachable through the resolved connector-account allowlist. */
export function connectorRuntimeServerIds(integrations: ServiceConnection[], connectorIds: string[]): string[] {
    const allowed = new Set(connectorIds);
    return [...new Set(
        integrations
            .filter((integration) => allowed.has(integration.id) && integration.mcpEnabled !== false && integration.runtimeServerId)
            .map((integration) => integration.runtimeServerId as string),
    )];
}

/**
 * Resolve an MCP tool only by its full account runtime identity.
 * Display names, binding ids, service ids, and suffix/substring matches are never aliases.
 */
export function resolveConnectorToolBinding(
    integration: ServiceConnection,
    runtimeServerId: string,
    runtimeName: string,
): MCPToolBinding | undefined {
    if (!integration.runtimeServerId || integration.runtimeServerId !== runtimeServerId) return undefined;
    const matches = integration.mcpTools.filter((binding) =>
        typeof binding.runtimeName === "string" && binding.runtimeName === runtimeName,
    );
    return matches.length === 1 ? matches[0] : undefined;
}

export interface ResolvedConnectorToolCall {
    integrationId: string;
    runtimeServerId: string;
    runtimeName: string;
}

/** Resolve a Claude MCP FQN (`mcp__<server>__<tool>`) using the longest exact server prefix. */
export function resolveConnectorToolCall(
    integrations: ServiceConnection[],
    toolName: string,
): ResolvedConnectorToolCall | null {
    if (typeof toolName !== "string" || !toolName.startsWith("mcp__")) return null;
    const candidates = integrations
        .filter((integration): integration is ServiceConnection & { runtimeServerId: string } =>
            typeof integration.runtimeServerId === "string" && integration.runtimeServerId.length > 0,
        )
        .map((integration) => ({ integration, prefix: `mcp__${integration.runtimeServerId}__` }))
        .filter(({ prefix }) => toolName.startsWith(prefix) && toolName.length > prefix.length)
        .sort((left, right) => right.integration.runtimeServerId.length - left.integration.runtimeServerId.length);
    if (candidates.length === 0) return null;
    const winner = candidates[0];
    // Duplicate account runtime ids are ambiguous and therefore fail closed.
    if (candidates[1]?.integration.runtimeServerId === winner.integration.runtimeServerId) return null;
    return {
        integrationId: winner.integration.id,
        runtimeServerId: winner.integration.runtimeServerId,
        runtimeName: toolName.slice(winner.prefix.length),
    };
}

/** Linked connector credentials injected into an authorized agent subprocess only. */
export function connectorCredentialEnvironment(
    keys: APIKey[],
    integrations: ServiceConnection[],
    connectorIds: string[],
): Record<string, string> {
    const allowed = new Set(connectorIds);
    const ownedCredentialIds = new Map(
        integrations
            .filter((integration) => allowed.has(integration.id))
            .map((integration) => [integration.id, new Set(integration.credentialIds ?? [])] as const),
    );
    const env: Record<string, string> = {};
    for (const key of keys) {
        if (!key.integrationId || !allowed.has(key.integrationId) || !key.keyValue) continue;
        if (!ownedCredentialIds.get(key.integrationId)?.has(key.id)) continue;
        const name = key.linkedEnvVarName?.trim();
        if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || env[name] !== undefined) continue;
        env[name] = key.keyValue;
    }
    return env;
}
