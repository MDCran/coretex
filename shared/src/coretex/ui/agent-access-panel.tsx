// @ts-nocheck
"use client";

// Shared capability / connector access summary for agent create & edit flows.
// Makes model abilities, built-in tools, MCP servers, and vault connectors
// visible so users know what an agent can actually use.

import type { BuiltInMcpId, CoretexConfig, ModelInfo, ProviderType, ServiceConnection } from "@repo/coretex/types";
import { Badge } from "@/components/base/badges/badges";
import { Toggle } from "@/components/base/toggle/toggle";
import { BrandLogo } from "./brand-logo";
import { modelCaps } from "./model-caps";
import { HelpTooltip } from "./help-tooltip";
import { cx } from "@/utils/cx";
import type { CoretexState } from "../use-coretex";

const BUILTIN_META: Record<BuiltInMcpId, { label: string; hint: string }> = {
    "coretex-browser": { label: "Browser", hint: "Navigate, read DOM, click, eval" },
    "coretex-filesystem": { label: "Filesystem", hint: "Read and write project files" },
    "coretex-git": { label: "Git", hint: "Status, log, diff, commit" },
    "coretex-ssh": { label: "SSH", hint: "Run commands on remote hosts" },
    "coretex-terminal": { label: "Terminal", hint: "Shell commands (also gated by Allow terminal)" },
};

export interface AgentAccessSelection {
    /** Keyvault ServiceConnection ids this agent may use. Empty = inherit all connected mcpEnabled connectors. */
    connectorIds: string[];
    /** Settings mcpServers ids. Empty = inherit all enabled MCP servers. */
    mcpServerIds: string[];
    terminalAccess: boolean;
}

interface Props {
    settings: CoretexConfig;
    state: CoretexState;
    /** Selected model (for capability badges). */
    model?: ModelInfo | null;
    /** Provider that will execute the agent; external MCP is currently bridged by the Claude SDK runtime. */
    provider?: ProviderType;
    selection: AgentAccessSelection;
    onChange: (next: AgentAccessSelection) => void;
    /** Compact for deploy panel; comfortable for settings builder / edit modal. */
    density?: "compact" | "comfortable";
    className?: string;
    /** Optional project policy. When provided, the agent may only select these
     * connector ids; an empty agent selection inherits this project set. */
    allowedConnectorIds?: string[];
}

function CapPill({ on, label, hint }: { on: boolean; label: string; hint?: string }) {
    return (
        <span title={hint} className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium", on ? "bg-[color-mix(in_srgb,var(--brand)_18%,transparent)] text-brand-secondary" : "bg-[var(--surface-2)] text-quaternary")}>
            {label}
            {!on && <span className="ml-1 opacity-70">off</span>}
        </span>
    );
}

/** Live-connected / MCP-enabled connectors from the keyvault (excludes pure AI-provider shelves). */
export function agentConnectors(state: CoretexState): ServiceConnection[] {
    return (state.keyvault?.integrations ?? []).filter(
        (i) =>
            (i.status === "connected" || i.status === "partial") &&
            (i.agentEnabled ?? i.mcpEnabled) !== false &&
            i.category !== "ai",
    );
}

const EXPLICIT_NONE = "__none__";

export const AgentAccessPanel = ({ settings, state, model, provider, selection, onChange, density = "comfortable", className, allowedConnectorIds }: Props) => {
    const caps = modelCaps(model ?? undefined);
    const builtIns = settings.mcpBuiltIns ?? [];
    const allConnectors = agentConnectors(state);
    const projectAllow = allowedConnectorIds === undefined ? null : new Set(allowedConnectorIds);
    const connectors = projectAllow ? allConnectors.filter((connector) => projectAllow.has(connector.id)) : allConnectors;
    const generatedRuntimeIds = new Set(allConnectors.map((connector) => connector.runtimeServerId).filter(Boolean));
    const mcpServers = (settings.mcpServers ?? []).filter((s) => s.enabled && !s.id.startsWith("vault-") && !generatedRuntimeIds.has(s.id));
    const mcpLive = state.mcp ?? {};

    const toggleConnector = (id: string): void => {
        const has = selection.connectorIds.includes(id);
        // First explicit toggle from empty (= all) locks in the full list minus this one, or just this one if turning on from empty meaning "all".
        if (selection.connectorIds.length === 0) {
            // Empty means inherit-all. First click starts an allowlist without `id` (turn off one) or with only `id` isn't right —
            // Empty = all. To disable one: set all except that id. To select subset: user checks boxes starting from all-checked UI.
            const allIds = connectors.map((c) => c.id);
            const next = allIds.filter((x) => x !== id);
            onChange({ ...selection, connectorIds: next.length > 0 ? next : [EXPLICIT_NONE] });
            return;
        }
        const current = selection.connectorIds.filter((x) => x !== EXPLICIT_NONE);
        const next = has ? current.filter((x) => x !== id) : [...current, id];
        onChange({
            ...selection,
            connectorIds: next.length > 0 ? next : [EXPLICIT_NONE],
        });
    };

    const connectorOn = (id: string): boolean => selection.connectorIds.length === 0 || selection.connectorIds.includes(id);

    const toggleMcp = (id: string): void => {
        if (selection.mcpServerIds.length === 0) {
            const allIds = mcpServers.map((s) => s.id);
            const next = allIds.filter((x) => x !== id);
            onChange({ ...selection, mcpServerIds: next.length > 0 ? next : [EXPLICIT_NONE] });
            return;
        }
        const has = selection.mcpServerIds.includes(id);
        const current = selection.mcpServerIds.filter((x) => x !== EXPLICIT_NONE);
        const next = has ? current.filter((x) => x !== id) : [...current, id];
        onChange({
            ...selection,
            mcpServerIds: next.length > 0 ? next : [EXPLICIT_NONE],
        });
    };

    const mcpOn = (id: string): boolean => selection.mcpServerIds.length === 0 || selection.mcpServerIds.includes(id);
    const executionProvider = provider ?? model?.provider;
    const harnessEnabled = (id: "claude" | "codex" | "gemini"): boolean =>
        settings.codingAgents?.find((agent) => agent.id === id)?.enabled === true;
    const claudeRuntimeAvailable = executionProvider === "anthropic" && settings.agentRuntime?.useClaudeSdkForClaude === true && harnessEnabled("claude");
    const codexRuntimeAvailable = executionProvider === "openai" && settings.agentRuntime?.useCodexCliForOpenAI === true && harnessEnabled("codex");
    const geminiRuntimeAvailable = executionProvider === "gemini" && settings.agentRuntime?.useGeminiCliForGemini === true && harnessEnabled("gemini");
    const mcpRuntimeAvailable = claudeRuntimeAvailable;
    const credentialRuntimeAvailable = claudeRuntimeAvailable || codexRuntimeAvailable || geminiRuntimeAvailable;
    const connectorSelectionCount = selection.connectorIds.includes(EXPLICIT_NONE)
        ? 0
        : selection.connectorIds.length === 0
          ? connectors.length
          : selection.connectorIds.filter((id) => connectors.some((connector) => connector.id === id)).length;
    const connectorScopeLabel = selection.connectorIds.includes(EXPLICIT_NONE)
        ? "None"
        : selection.connectorIds.length === 0
          ? allowedConnectorIds !== undefined ? `Project set · ${connectors.length}` : `All · ${connectors.length}`
          : `${connectorSelectionCount} of ${connectors.length}`;
    const mcpSelectionCount = selection.mcpServerIds.includes(EXPLICIT_NONE)
        ? 0
        : selection.mcpServerIds.length === 0
          ? mcpServers.length
          : selection.mcpServerIds.filter((id) => mcpServers.some((server) => server.id === id)).length;
    const mcpScopeLabel = selection.mcpServerIds.includes(EXPLICIT_NONE)
        ? "None"
        : selection.mcpServerIds.length === 0
          ? `All · ${mcpServers.length}`
          : `${mcpSelectionCount} of ${mcpServers.length}`;

    const pad = density === "compact" ? "p-3" : "p-4";

    return (
        <div className={cx("flex flex-col gap-3 rounded-xl", pad, className)} style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
            <div className="flex items-center gap-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-quaternary">Abilities & connectors</p>
                <HelpTooltip text="What this agent can do — model capabilities, built-in Coretex tools, MCP servers, and vault connectors. Toggle connectors/MCP to scope access." />
            </div>

            {/* Model capabilities */}
            <div>
                <p className="mb-1.5 break-words text-xs font-medium text-secondary [overflow-wrap:anywhere]">
                    Model{model ? <span className="font-normal text-quaternary" title={model.displayName ?? model.name}> · {model.displayName ?? model.name}</span> : null}
                </p>
                {model ? (
                    <div className="flex flex-wrap gap-1.5">
                        <CapPill on={caps.tools} label="Tool use" hint="Function / tool calling" />
                        <CapPill on={caps.vision} label="Vision" hint="Image input" />
                        <CapPill on={caps.reasoning} label="Reasoning" hint="Extended thinking" />
                        {caps.contextLength != null && (
                            <CapPill on label={`${Math.round(caps.contextLength / 1000)}k ctx`} hint="Context window" />
                        )}
                        {!caps.tools && (
                            <span className="text-[11px] text-warning-primary">This model may not call tools/connectors reliably.</span>
                        )}
                    </div>
                ) : (
                    <p className="text-xs text-quaternary">Pick a model to see its capabilities.</p>
                )}
            </div>

            {/* Built-in tools */}
            <div>
                <p className="mb-1.5 text-xs font-medium text-secondary">Built-in tools</p>
                <div className="flex flex-wrap gap-1.5">
                    {builtIns.map((b) => {
                        const meta = BUILTIN_META[b.id];
                        const terminalGate = b.id === "coretex-terminal" && !selection.terminalAccess;
                        const on = b.enabled && !terminalGate;
                        return (
                            <CapPill
                                key={b.id}
                                on={on}
                                label={meta?.label ?? b.id}
                                hint={
                                    terminalGate
                                        ? "Off because terminal access is disabled for this agent"
                                        : !b.enabled
                                          ? "Disabled in Settings → MCP servers"
                                          : (meta?.hint ?? b.description)
                                }
                            />
                        );
                    })}
                    {builtIns.length === 0 && <span className="text-xs text-quaternary">No built-ins configured.</span>}
                </div>
            </div>

            {/* Terminal gate (mirrors primary toggle; kept here for the summary) */}
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-medium text-secondary">Terminal access</p>
                    <p className="text-[11px] text-quaternary">Gates the Bash / shell tool for this agent.</p>
                </div>
                <Toggle
                    isSelected={selection.terminalAccess}
                    onChange={(v: boolean) => onChange({ ...selection, terminalAccess: v })}
                    aria-label="Terminal access"
                />
            </div>

            {/* MCP servers */}
            <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><p className="text-xs font-medium text-secondary">Custom MCP servers</p><Badge size="sm" color="gray" type="pill-color">{mcpScopeLabel}</Badge></div>
                    {mcpServers.length > 0 && selection.mcpServerIds.length > 0 && (
                        <button type="button" className="text-[11px] text-brand-secondary hover:underline" onClick={() => onChange({ ...selection, mcpServerIds: [] })}>
                            Use all
                        </button>
                    )}
                </div>
                {mcpServers.length === 0 ? (
                    <p className="text-xs text-quaternary">No MCP servers enabled — add them in Settings → MCP servers.</p>
                ) : !mcpRuntimeAvailable ? (
                    <p className="text-xs text-quaternary">External MCP tools require the enabled Claude SDK agent harness. This selected runtime will not receive these servers.</p>
                ) : (
                    <ul className="flex flex-col gap-1.5">
                        {mcpServers.map((s) => {
                            const live = mcpLive[s.id];
                            const on = mcpOn(s.id);
                            return (
                                <li key={s.id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1.5" style={{ background: "var(--surface)" }}>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-xs font-medium text-primary" title={s.name}>{s.name}</p>
                                        <p className="truncate text-[11px] text-quaternary">
                                            {live?.connecting ? "Connecting…" : live?.connected ? `${live.tools?.length ?? 0} tools live` : live?.error ? `Unavailable · ${live.error}` : "Not connected"}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        {live?.connected && <Badge size="sm" color="success" type="pill-color">Live</Badge>}
                                        {!live?.connected && <Badge size="sm" color={live?.error ? "error" : "gray"} type="pill-color">Unavailable</Badge>}
                                        <Toggle isSelected={on} isDisabled={!live?.connected || !mcpRuntimeAvailable} onChange={() => toggleMcp(s.id)} aria-label={`MCP ${s.name}`} />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* Vault connectors */}
            <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><p className="text-xs font-medium text-secondary">Service connectors</p><Badge size="sm" color="gray" type="pill-color">{connectorScopeLabel}</Badge></div>
                    {connectors.length > 0 && selection.connectorIds.length > 0 && (
                        <button type="button" className="text-[11px] text-brand-secondary hover:underline" onClick={() => onChange({ ...selection, connectorIds: [] })}>
                            {allowedConnectorIds !== undefined ? "Use project set" : "Use all"}
                        </button>
                    )}
                </div>
                {connectors.length === 0 ? (
                    <p className="text-xs text-quaternary">{allowedConnectorIds !== undefined && allowedConnectorIds.length === 0 ? "This project has no authorized connectors." : "No live agent-ready connectors yet — connect a supported service in Settings → Remote & connectors."}</p>
                ) : (
                    <ul className="flex flex-col gap-1.5">
                        {connectors.map((c) => {
                            const on = connectorOn(c.id);
                            const toolNames = (c.mcpTools ?? []).filter((t) => t.permission !== "disabled").map((t) => t.name);
                            const runtime = c.runtimeServerId ? mcpLive[c.runtimeServerId] : undefined;
                            const directMcp = Boolean(c.runtimeServerId);
                            const available = directMcp ? runtime?.connected === true && mcpRuntimeAvailable : credentialRuntimeAvailable;
                            return (
                                <li key={c.id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1.5" style={{ background: "var(--surface)" }}>
                                    <div className="flex min-w-0 flex-1 items-center gap-2">
                                        <BrandLogo domain={c.serviceDomain} name={c.serviceName} size={18} />
                                        <div className="min-w-0">
                                            <p className="truncate text-xs font-medium text-primary" title={c.serviceName}>{c.serviceName}</p>
                                            <p className="truncate text-[11px] text-quaternary">
                                                {directMcp
                                                    ? runtime?.connecting
                                                        ? "MCP runtime connecting…"
                                                        : runtime?.connected
                                                          ? mcpRuntimeAvailable ? `${runtime.tools?.length ?? toolNames.length} live MCP tools` : "Live MCP tools require Claude"
                                                          : runtime?.error ? `Unavailable · ${runtime.error}` : "MCP runtime not connected"
                                                    : credentialRuntimeAvailable
                                                      ? `Credential runtime · ${c.credentialIds?.length ?? 0} protected value${(c.credentialIds?.length ?? 0) === 1 ? "" : "s"}`
                                                      : "Credential runtime unavailable for the selected agent harness"}
                                            </p>
                                        </div>
                                    </div>
                                    <Toggle isSelected={on} isDisabled={!available} onChange={() => toggleConnector(c.id)} aria-label={`Connector ${c.serviceName}`} />
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
};
