// @ts-nocheck
"use client";

// Coretex Relay — MCP servers settings page (§10.3).
// settings.mcpServers is an array collection; it is replaced wholesale via
// actions.updateSettings({ mcpServers: updated }). Per-field edits map over the
// array by id. Secrets (env var values) live in the secret store, never here.
import { useState } from "react";
import type { ReactNode } from "react";
import type { CoretexConfig, McpServerStatus } from "@repo/coretex/types";
import { Folder, GitBranch01, Globe01, Key01, Plus, Server01, Terminal, Trash01 } from "@untitledui/icons";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RichSelect } from "@/components/base/select/rich-select";
import { Toggle } from "@/components/base/toggle/toggle";
import { BrandLogo } from "../../ui/brand-logo";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { SettingsSection } from "../controls";
import { SettingsPageHeader, SettingsStatusBadge } from "../settings-shell";

// McpServerConfig is not re-exported from the types barrel; derive its shape
// from the live config so this stays structurally locked to the schema.
type McpServerConfig = CoretexConfig["mcpServers"][number];
type BuiltInMcpServer = CoretexConfig["mcpBuiltIns"][number];

/** Icon per built-in coretex-* server. */
const BUILT_IN_ICON: Record<string, typeof Server01> = {
    "coretex-browser": Globe01,
    "coretex-filesystem": Folder,
    "coretex-git": GitBranch01,
    "coretex-ssh": Server01,
    "coretex-terminal": Terminal,
};

const BuiltInServers = ({ settings, actions }: { settings: CoretexConfig; actions: CoretexActions }) => {
    const servers: BuiltInMcpServer[] = settings.mcpBuiltIns ?? [];

    const setEnabled = (id: string, enabled: boolean): void => {
        actions.updateSettings({
            mcpBuiltIns: servers.map((s) => (s.id === id ? { ...s, enabled } : s)),
        });
    };

    return (
        <SettingsSection
            title="Built-in servers"
            description="MCP servers bundled with Coretex. Terminal tool calls follow your configured Security policy."
        >
            <div className="flex flex-col gap-3 py-1">
                {servers.map((s) => {
                    const Icon = BUILT_IN_ICON[s.id] ?? Server01;
                    return (
                        <div
                            key={s.id}
                            className="flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between"
                            style={{
                                background: "var(--surface-2)",
                                border: "1px solid var(--c-border)",
                            }}
                        >
                            <div className="flex min-w-0 items-start gap-3">
                                {s.id === "coretex-git" ? (
                                    <BrandLogo domain="git-scm.com" name="Git" size={36} className="rounded-lg" />
                                ) : (
                                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--surface-2)" }}>
                                        <Icon className="size-4 text-secondary" />
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="break-all font-mono text-sm font-semibold text-primary" title={s.id}>{s.id}</p>
                                        {s.caps.map((c) => (
                                            <Badge key={c} size="sm" color={c === "tools" ? "brand" : "gray"}>
                                                {c}
                                            </Badge>
                                        ))}
                                    </div>
                                    <p className="mt-0.5 text-xs text-tertiary">{s.description}</p>
                                </div>
                            </div>
                            <div className="shrink-0">
                                <Toggle aria-label={`Enable ${s.id}`} isSelected={s.enabled} onChange={(v: boolean) => setEnabled(s.id, v)} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </SettingsSection>
    );
};

// URL (HTTP/SSE) transport is not yet supported by the Brain: McpClient.connect()
// only spawns a stdio child process, and orchestrator._mcpConnect rejects any
// non-stdio server ("Only stdio servers are supported in this build."). Until the
// Brain grows an HTTP/SSE transport, only offer stdio so the control can't produce
// a server that will never connect.
// TODO(brain): add URL/SSE transport to coretex/src/mcp/client.ts + _mcpConnect,
// then restore the "url" option here and the URL input below.
const TRANSPORT_OPTIONS: {
    label: string;
    value: McpServerConfig["transport"];
}[] = [{ label: "Standard I/O (stdio)", value: "stdio" }];

const OFFICIAL_PRESETS = [
    {
        value: "filesystem",
        label: "Filesystem",
        supportingText: "Official file tools, restricted to the chosen path",
        command: "npx",
        args: "-y @modelcontextprotocol/server-filesystem .",
        envKeys: [],
    },
    {
        value: "memory",
        label: "Memory graph",
        supportingText: "Official persistent knowledge-graph tools",
        command: "npx",
        args: "-y @modelcontextprotocol/server-memory",
        envKeys: ["MEMORY_FILE_PATH"],
    },
    {
        value: "sequential-thinking",
        label: "Sequential thinking",
        supportingText: "Official structured reasoning tool",
        command: "npx",
        args: "-y @modelcontextprotocol/server-sequential-thinking",
        envKeys: ["DISABLE_THOUGHT_LOGGING"],
    },
] as const;

function makeId(): string {
    return `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

interface PageProps {
    settings: CoretexConfig;
    state: CoretexState;
    actions: CoretexActions;
}

export const McpServersPage = ({ settings, state, actions }: PageProps) => {
    const servers: McpServerConfig[] = settings.mcpServers ?? [];
    const [presetId, setPresetId] = useState(OFFICIAL_PRESETS[0].value);
    const serverDeletion = useConfirm();
    const connectedCount = servers.filter((s) => state.mcp[s.id]?.connected).length;
    const enabledCount = servers.filter((s) => s.enabled).length;

    const writeServers = (next: McpServerConfig[]): void => {
        actions.updateSettings({ mcpServers: next });
    };

    const addServer = (): void => {
        const server: McpServerConfig = {
            id: makeId(),
            name: "New server",
            transport: "stdio",
            command: "",
            args: "",
            url: "",
            enabled: false,
            envKeys: [],
        };
        writeServers([...servers, server]);
    };

    const addPreset = (): void => {
        const preset = OFFICIAL_PRESETS.find((item) => item.value === presetId) ?? OFFICIAL_PRESETS[0];
        // Presets enable immediately so the Brain auto-connects via _syncMcpConnections.
        writeServers([
            ...servers,
            {
                id: makeId(),
                name: preset.label,
                transport: "stdio",
                command: preset.command,
                args: preset.args,
                enabled: true,
                envKeys: [...preset.envKeys],
            },
        ]);
    };

    const patchServer = (id: string, patch: Partial<McpServerConfig>): void => {
        writeServers(servers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    };

    /** Connect always enables the server so it survives the next config sync. */
    const connectServer = (id: string): void => {
        const server = servers.find((s) => s.id === id);
        if (server && !server.enabled) patchServer(id, { enabled: true });
        actions.mcpConnect(id);
    };

    /** Toggle enabled — Brain auto-connects enabled stdio servers; disable disconnects. */
    const setServerEnabled = (id: string, enabled: boolean): void => {
        patchServer(id, { enabled });
        if (enabled) actions.mcpConnect(id);
        else actions.mcpDisconnect(id);
    };

    const removeServer = (id: string): void => {
        const server = servers.find((item) => item.id === id);
        actions.mcpDisconnect(id);
        server?.envKeys.forEach((key) => actions.setSecret(`mcp.${id}.${key}`, ""));
        writeServers(servers.filter((s) => s.id !== id));
    };

    return (
        <div className="flex flex-col gap-6">
            {serverDeletion.dialog}
            <SettingsPageHeader
                icon={Server01}
                title="MCP servers"
                subtitle="Built-in Coretex servers and custom stdio MCP connectors for agent tools."
                badges={
                    servers.length > 0 ? (
                        <SettingsStatusBadge
                            label={`${connectedCount}/${servers.length} connected`}
                            color={connectedCount > 0 ? "success" : enabledCount > 0 ? "warning" : "gray"}
                        />
                    ) : undefined
                }
            />
            <BuiltInServers settings={settings} actions={actions} />
            <SettingsSection
                title="Custom servers"
                description="Add a preset or custom stdio command, enable it, and Connect — agents on Claude can use its tools once status is green."
            >
                <div className="flex flex-col gap-4 py-1">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div className="min-w-0 flex-1 sm:min-w-[18rem]">
                            <p className="mb-2 text-xs text-quaternary">Start from a maintained MCP reference server, or enter any local stdio command.</p>
                            <div className="flex max-w-xl flex-col gap-2 sm:flex-row">
                                <div className="min-w-0 flex-1">
                                    <RichSelect
                                        aria-label="MCP server preset"
                                        rich
                                        options={OFFICIAL_PRESETS}
                                        value={presetId}
                                        onChange={(event) => setPresetId(event.target.value as typeof presetId)}
                                    />
                                </div>
                                <Button size="md" color="secondary" onClick={addPreset}>
                                    Add preset
                                </Button>
                            </div>
                        </div>
                        <Button size="sm" color="secondary" iconLeading={Plus} onClick={addServer}>
                            Custom server
                        </Button>
                    </div>

                    {servers.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 rounded-xl px-6 py-10 text-center" style={{ border: "1px dashed var(--c-border)" }}>
                            <Server01 className="size-6 text-fg-quaternary" />
                            <p className="text-sm text-tertiary">No MCP servers yet — add one to give agents extra tools.</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {servers.map((server) => (
                                <ServerCard
                                    key={server.id}
                                    server={server}
                                    status={state.mcp[server.id]}
                                    onPatch={(patch) => patchServer(server.id, patch)}
                                    onSetEnabled={(enabled) => setServerEnabled(server.id, enabled)}
                                    onConnect={() => connectServer(server.id)}
                                    onDisconnect={() => {
                                        patchServer(server.id, { enabled: false });
                                        actions.mcpDisconnect(server.id);
                                    }}
                                    onCallTool={(name, args) => actions.mcpCallTool(server.id, name, args)}
                                    onSetSecret={(key, value) => actions.setSecret(`mcp.${server.id}.${key}`, value)}
                                    lastResult={state.mcpToolResult?.serverId === server.id ? state.mcpToolResult : null}
                                    onDelete={() =>
                                        serverDeletion.confirm({
                                            title: `Delete ${server.name || "MCP server"}?`,
                                            description:
                                                "This disconnects the server and removes its saved command and environment-variable configuration from Coretex.",
                                            confirmLabel: "Delete server",
                                            onConfirm: () => removeServer(server.id),
                                        })
                                    }
                                />
                            ))}
                        </div>
                    )}
                </div>
            </SettingsSection>
        </div>
    );
};

interface ServerCardProps {
    server: McpServerConfig;
    status?: McpServerStatus;
    lastResult?: { name: string; result?: string; error?: string } | null;
    onPatch: (patch: Partial<McpServerConfig>) => void;
    onSetEnabled: (enabled: boolean) => void;
    onConnect: () => void;
    onDisconnect: () => void;
    onCallTool: (name: string, args: Record<string, unknown>) => void;
    onSetSecret: (key: string, value: string) => void;
    onDelete: () => void;
}

const ServerCard = ({ server, status, lastResult, onPatch, onSetEnabled, onConnect, onDisconnect, onCallTool, onSetSecret, onDelete }: ServerCardProps) => {
    const [confirmTool, setConfirmTool] = useState<string | null>(null);
    const [envKeyDraft, setEnvKeyDraft] = useState("");
    const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
    const [savedSecrets, setSavedSecrets] = useState<Set<string>>(new Set());
    const [toolArgs, setToolArgs] = useState<Record<string, string>>({});
    const [toolError, setToolError] = useState<Record<string, string>>({});
    const environmentDeletion = useConfirm();
    const connected = status?.connected === true;
    const connecting = status?.connecting === true;
    const tools = status?.tools ?? [];

    const canConnect = server.transport === "stdio" && !!server.command?.trim();

    const addEnvKey = (): void => {
        const key = envKeyDraft.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || server.envKeys.includes(key)) return;
        onPatch({ envKeys: [...server.envKeys, key] });
        setEnvKeyDraft("");
    };

    const runTool = (name: string): void => {
        // User-in-the-loop safeguard: arm, then confirm before executing.
        if (confirmTool !== name) {
            setConfirmTool(name);
            window.setTimeout(() => setConfirmTool((c) => (c === name ? null : c)), 4000);
            return;
        }
        let args: Record<string, unknown> = {};
        try {
            const parsed = JSON.parse(toolArgs[name]?.trim() || "{}");
            if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Arguments must be a JSON object.");
            args = parsed as Record<string, unknown>;
        } catch (error) {
            setToolError((current) => ({
                ...current,
                [name]: error instanceof Error ? error.message : String(error),
            }));
            return;
        }
        setToolError((current) => ({ ...current, [name]: "" }));
        setConfirmTool(null);
        onCallTool(name, args);
    };

    return (
        <div
            className="rounded-xl p-4"
            style={{
                background: "var(--surface-2)",
                border: "1px solid var(--c-border)",
            }}
        >
            {environmentDeletion.dialog}
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
                <div className="flex-1">
                    <FieldLabel>Name</FieldLabel>
                    <Input aria-label="MCP server name" value={server.name} placeholder="My MCP server" onChange={(v: string) => onPatch({ name: v })} />
                </div>
                <div className="w-full shrink-0 sm:w-48">
                    <FieldLabel>Transport</FieldLabel>
                    <RichSelect
                        aria-label="MCP transport"
                        options={TRANSPORT_OPTIONS}
                        value={server.transport}
                        onChange={(e) =>
                            onPatch({
                                transport: e.target.value as McpServerConfig["transport"],
                            })
                        }
                    />
                </div>
            </div>

            {/* Only stdio fields: URL/SSE transport is not yet supported by the Brain
                (see TRANSPORT_OPTIONS). The URL input is hidden until then. */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <FieldLabel>Command</FieldLabel>
                    <Input aria-label="MCP server command" value={server.command ?? ""} placeholder="npx" onChange={(v: string) => onPatch({ command: v })} />
                </div>
                <div>
                    <FieldLabel>Arguments</FieldLabel>
                    <Input
                        aria-label="MCP server arguments"
                        value={server.args ?? ""}
                        placeholder="-y @modelcontextprotocol/server-filesystem ./"
                        onChange={(v: string) => onPatch({ args: v })}
                    />
                </div>
            </div>

            <div
                className="mt-3 rounded-lg p-3"
                style={{
                    background: "var(--surface)",
                    border: "1px solid var(--c-border)",
                }}
            >
                <div className="flex items-center gap-2">
                    <Key01 className="size-4 text-quaternary" />
                    <p className="text-xs font-semibold text-secondary">Secret environment variables</p>
                </div>
                <p className="mt-1 text-xs text-quaternary">Values are stored in the local secret vault and injected only into this server process.</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <div className="min-w-0 flex-1">
                        <Input aria-label="Environment variable name" value={envKeyDraft} placeholder="GITHUB_TOKEN" onChange={setEnvKeyDraft} />
                    </div>
                    <Button size="md" color="secondary" onClick={addEnvKey} isDisabled={!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envKeyDraft.trim())}>
                        Add variable
                    </Button>
                </div>
                {server.envKeys.length > 0 && (
                    <div className="mt-2 flex flex-col gap-2">
                        {server.envKeys.map((key) => (
                            <div key={key} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(7rem,0.6fr)_minmax(10rem,1fr)_auto_auto]">
                                <span className="break-all font-mono text-xs text-secondary" title={key}>{key}</span>
                                <Input
                                    aria-label={`${key} secret value`}
                                    type="password"
                                    value={secretDrafts[key] ?? ""}
                                    placeholder={savedSecrets.has(key) ? "Saved — enter to replace" : "Secret value"}
                                    onChange={(value) => setSecretDrafts((current) => ({ ...current, [key]: value }))}
                                />
                                <Button
                                    size="sm"
                                    color="secondary"
                                    isDisabled={!secretDrafts[key]}
                                    onClick={() => {
                                        onSetSecret(key, secretDrafts[key] ?? "");
                                        setSecretDrafts((current) => ({ ...current, [key]: "" }));
                                        setSavedSecrets((current) => new Set(current).add(key));
                                    }}
                                >
                                    Save
                                </Button>
                                <Button
                                    size="sm"
                                    color="tertiary-destructive"
                                    iconLeading={Trash01}
                                    aria-label={`Remove ${key}`}
                                    onClick={() =>
                                        environmentDeletion.confirm({
                                            title: `Remove ${key}?`,
                                            description: "This stops injecting the variable and clears its saved secret value from this device.",
                                            confirmLabel: "Remove variable",
                                            onConfirm: () => {
                                                onSetSecret(key, "");
                                                setSavedSecrets((current) => {
                                                    const next = new Set(current);
                                                    next.delete(key);
                                                    return next;
                                                });
                                                onPatch({
                                                    envKeys: server.envKeys.filter((item) => item !== key),
                                                });
                                            },
                                        })
                                    }
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div
                className="mt-4 flex flex-col items-start justify-between gap-3 border-t pt-3 sm:flex-row sm:items-center"
                style={{ borderColor: "var(--c-border)" }}
            >
                <div className="flex flex-wrap items-center gap-3">
                    <Toggle aria-label={`Enable ${server.name || "MCP server"}`} isSelected={server.enabled} onChange={(v: boolean) => onSetEnabled(v)} />
                    <span className="text-sm font-medium text-secondary">{server.enabled ? "Enabled" : "Disabled"}</span>
                    {connecting ? (
                        <Badge size="sm" color="brand" type="pill-color">
                            connecting…
                        </Badge>
                    ) : connected ? (
                        <Badge size="sm" color="success" type="pill-color">
                            connected{status?.serverName ? ` · ${status.serverName}` : ""} · {tools.length} tools
                        </Badge>
                    ) : status?.error ? (
                        <Badge size="sm" color="error" type="pill-color">
                            error
                        </Badge>
                    ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {connected ? (
                        <Button size="sm" color="secondary" onClick={onDisconnect}>
                            Disconnect
                        </Button>
                    ) : (
                        <Button size="sm" color="primary" onClick={onConnect} isDisabled={!canConnect || connecting}>
                            {connecting ? "Connecting…" : "Connect"}
                        </Button>
                    )}
                    <Button size="sm" color="tertiary-destructive" iconLeading={Trash01} onClick={onDelete}>
                        Delete
                    </Button>
                </div>
            </div>

            {status?.error && <p className="mt-2 break-words font-mono text-xs text-error-primary">{status.error}</p>}

            {/* Tool inventory (when connected). */}
            {connected && tools.length > 0 && (
                <div
                    className="mt-3 rounded-lg p-3"
                    style={{
                        background: "var(--surface)",
                        border: "1px solid var(--c-border)",
                    }}
                >
                    <p className="mb-2 text-xs font-semibold text-secondary">Tools</p>
                    <ul className="flex flex-col gap-1.5">
                        {tools.map((t) => (
                            <li key={t.name} className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(10rem,1fr)_auto]">
                                <div className="min-w-0">
                                    <p className="break-all font-mono text-xs text-primary" title={t.name}>{t.name}</p>
                                    {t.description && <p className="break-words text-xs text-quaternary">{t.description}</p>}
                                </div>
                                <div>
                                    <Input
                                        aria-label={`${t.name} tool arguments as JSON`}
                                        value={toolArgs[t.name] ?? "{}"}
                                        placeholder='{"key":"value"}'
                                        onChange={(value) =>
                                            setToolArgs((current) => ({
                                                ...current,
                                                [t.name]: value,
                                            }))
                                        }
                                    />
                                    {toolError[t.name] && <p className="mt-1 text-xs text-error-primary">{toolError[t.name]}</p>}
                                </div>
                                <Button size="sm" color={confirmTool === t.name ? "primary-destructive" : "tertiary"} onClick={() => runTool(t.name)}>
                                    {confirmTool === t.name ? "Confirm run" : "Run"}
                                </Button>
                            </li>
                        ))}
                    </ul>
                    {lastResult && (
                        <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--c-border)" }}>
                            <p className="text-xs font-medium text-tertiary">{lastResult.name} →</p>
                            <pre className="mt-1 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap text-secondary">
                                {lastResult.error ?? lastResult.result ?? ""}
                            </pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const FieldLabel = ({ children }: { children: ReactNode }) => <p className="mb-1.5 text-xs font-medium text-tertiary">{children}</p>;
