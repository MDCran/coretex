export interface ConnectorRuntimeSpec {
    command: "docker" | "npx";
    args: string;
    envKeys: readonly string[];
}

/**
 * Executable connector adapters reviewed by the Brain. Renderer metadata may select
 * one of these entries but can never supply an arbitrary process command.
 */
export const CONNECTOR_RUNTIME_SPECS: Readonly<Record<string, ConnectorRuntimeSpec>> = Object.freeze({
    github: Object.freeze({
        command: "docker",
        args: "run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server",
        envKeys: Object.freeze(["GITHUB_PERSONAL_ACCESS_TOKEN"]),
    }),
    notion: Object.freeze({
        command: "npx",
        args: "-y @notionhq/notion-mcp-server",
        envKeys: Object.freeze(["NOTION_TOKEN"]),
    }),
});

export function connectorRuntimeSpec(serviceId: string): ConnectorRuntimeSpec | undefined {
    return CONNECTOR_RUNTIME_SPECS[serviceId];
}

/** Exact executable boundary for connector-owned MCP entries. */
export function connectorRuntimeMatches(
    serviceId: string,
    runtime: { transport?: string; command?: string; args?: string; envKeys?: readonly string[] },
): boolean {
    const spec = connectorRuntimeSpec(serviceId);
    const envKeys = runtime.envKeys ?? [];
    return Boolean(
        spec &&
        runtime.transport === "stdio" &&
        runtime.command === spec.command &&
        runtime.args === spec.args &&
        envKeys.length === spec.envKeys.length &&
        envKeys.every((key, index) => key === spec.envKeys[index]),
    );
}
