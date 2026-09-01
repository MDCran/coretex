// Coretex — pluggable agent-runtime layer. Every agent runs on the engine right for
// its provider + auth mode: Claude (anthropic) → the Claude Agent SDK (ClaudeAgentRuntime);
// OpenAI/Gemini under subscription auth → their own CLI (Codex CLI / Gemini CLI), shelled
// out to and speaking the SAME normalized event stream; everything else (ollama/lmstudio/
// openai/gemini under api-key/openrouter/openclaw) → Coretex's own universal REST loop.
// All engines speak the SAME normalized event stream so the Orchestrator, cost, audit,
// halt, and analytics are engine-agnostic.
//
// The CLI-shim engines (codex-cli/gemini-cli) exist ONLY to bill agent runs against a
// consumer subscription (ChatGPT Plus/Pro, Google AI Pro/Ultra) instead of pay-per-token
// API credits — that billing relationship is NOT reachable via either provider's REST API,
// only via their own CLI's OAuth login (`codex login` / `gemini` sign-in). In api-key mode
// both providers keep using the plain REST universal loop, unchanged.

import type { PermissionMode } from "../types.js";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { TerminalSecurityPolicy } from "../security/terminal-policy.js";

export type AgentRuntimeKind = "claude-sdk" | "codex-cli" | "gemini-cli" | "universal";

/**
 * Anthropic always runs on the Claude Agent SDK (it handles both api-key and plan auth
 * internally). OpenAI/Gemini only leave the universal REST loop for their own CLI when the
 * agent's auth mode is "subscription" (consumer plan, not an API key) — that's the only
 * reason those CLIs exist here.
 */
export function runtimeKindForProvider(provider: string, authMode?: string): AgentRuntimeKind {
    if (provider === "anthropic") return "claude-sdk";
    if (provider === "openai" && authMode === "subscription") return "codex-cli";
    if (provider === "gemini" && authMode === "subscription") return "gemini-cli";
    return "universal";
}

/** Normalized events both runtimes emit → fed to CostTracker / activity / UI / orchestration. */
export interface AgentRuntimeEvent {
    type: "text" | "thinking" | "tool_call" | "tool_result" | "step" | "cost" | "session" | "done" | "error";
    data: Record<string, unknown>;
}

export interface AgentRunInput {
    agentId: string;
    name: string;
    provider: string;
    model: string;
    /** The task prompt (already includes the seeded instructions). */
    prompt: string;
    /** Agent instructions + inherited capability manifest, as a system prompt. */
    systemPrompt?: string;
    /** Working directory for file/shell tools (project root). */
    cwd?: string;
    /**
     * Extra environment variables for the agent tool subprocess (project env vars /
     * AI-accessible API keys). Values must NEVER be echoed into prompts.
     */
    env?: Record<string, string>;
    /** Anthropic API key (API billing) — omit for Claude Pro/Max plan auth. */
    apiKey?: string;
    /** Prefer Claude subscription (Pro/Max) over API key billing. */
    authMode?: "api-key" | "claude-plan" | "subscription";
    /** Optional `claude setup-token` OAuth token for headless plan auth. */
    oauthToken?: string;
    permissionMode: PermissionMode;
    /** Allowed tool names; undefined → the runtime's sensible default set. */
    allowedTools?: string[];
    maxTurns?: number;
    signal: AbortSignal;
    /** Resume a prior session id (continuity across task re-runs). */
    resume?: string;
    /** Coretex MCP servers to expose to the SDK (when they have a real transport). */
    mcpServers?: Record<string, McpServerConfig>;
    /**
     * Authorization seam for connector-owned MCP tools. The orchestrator supplies a
     * closure bound to the outer Coretex agent + task principal; SDK/subagent metadata
     * is deliberately not accepted as an authorization identity.
     */
    connectorToolGuard?: ConnectorToolGuard;
    /** When false, shell/terminal (Bash) tools are dropped from the allowed set. Default true. */
    terminalAccess?: boolean;
    /** Snapshot of the global terminal policy for this run. */
    terminalPolicy?: TerminalSecurityPolicy;
    /**
     * Optional bridge that lets the running agent actually invoke the in-app browser tools
     * (#33). When provided, the runtime registers `browser_navigate/read_dom/click` as
     * live, callable tools backed by this handler (which the Orchestrator wires to its
     * permission-gated + audited `agentBrowser*` methods). Absent → the tools are not exposed
     * and nothing changes. The handler is responsible for permission gating; it must never throw
     * — it returns a JSON-serializable result (incl. error strings) that is fed back to the model.
     */
    browserControl?: BrowserToolHandler;
}

/** One browser-tool invocation from a running agent → routed to the Orchestrator's agentBrowser* methods. */
export type BrowserToolAction =
    | { kind: "navigate"; sessionId: string; url: string }
    | { kind: "read_dom"; sessionId: string }
    | { kind: "click"; sessionId: string; selector: string };

/**
 * Handler the runtime calls when the model invokes a browser tool. Implementations (the
 * Orchestrator) apply permission gating + audit and return a JSON-serializable result. MUST
 * resolve (never reject) so a tool error becomes a tool result the model can read and recover from.
 */
export type BrowserToolHandler = (action: BrowserToolAction) => Promise<unknown>;

export interface ConnectorToolGuardDecision {
    allowed: boolean;
    reason?: string;
}

/** Null means the tool does not belong to a connector-owned MCP runtime. */
export type ConnectorToolGuard = (
    toolName: string,
    toolInput: unknown,
    toolUseId?: string,
) => Promise<ConnectorToolGuardDecision | null>;

export interface AgentRuntime {
    readonly kind: AgentRuntimeKind;
    run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
}

/**
 * Browser-control tools an agent may call to drive the in-app browser (#16). Registered
 * here alongside the other runtime tool wiring so the tool layer has a single canonical
 * spec (names + JSON-shaped descriptions). The Orchestrator backs these with
 * agentBrowser* methods, gated by permission mode + audited.
 *
 * HONEST host note baked into the descriptions: `browser_navigate` works in every host;
 * `browser_read_dom` / `browser_click` require the Electron <webview>
 * bridge and return a clear "not available in this host" result under the web/iframe host.
 */
export interface AgentToolSpec {
    name: string;
    description: string;
    /** JSON-schema-ish parameter hints (kept loose so any provider's tool format can adapt). */
    parameters: Record<string, "string">;
}

export const BROWSER_AGENT_TOOLS: readonly AgentToolSpec[] = [
    {
        name: "browser_navigate",
        description:
            "Navigate the in-app browser session to a URL. Works in every host (web iframe and Electron). Returns the resolved URL.",
        parameters: { sessionId: "string", url: "string" },
    },
    {
        name: "browser_read_dom",
        description:
            "Read the visible DOM/text of the in-app browser page. Requires the Electron <webview> host; under the web/iframe host this returns a 'not available in this host' result (the page is cross-origin/sandboxed).",
        parameters: { sessionId: "string" },
    },
    {
        name: "browser_click",
        description:
            "Click an element by CSS selector in the in-app browser. Requires the Electron <webview> host; under the web/iframe host this returns a 'not available in this host' result.",
        parameters: { sessionId: "string", selector: "string" },
    },
] as const;

/** Convenience: the tool names, for inclusion in an agent's allowedTools. */
export const BROWSER_AGENT_TOOL_NAMES: readonly string[] = BROWSER_AGENT_TOOLS.map((t) => t.name);

/** Map Coretex's permission mode → the Claude Agent SDK's permissionMode. */
export function toSdkPermissionMode(mode: PermissionMode): "default" | "acceptEdits" | "plan" | "bypassPermissions" {
    switch (mode) {
        case "accept-edits": return "acceptEdits";
        case "plan": return "plan";
        // The Claude Agent SDK has no "auto" mode; "auto" (run autonomously) maps to bypassing prompts.
        case "auto": return "bypassPermissions";
        case "bypass": return "bypassPermissions";
        case "ask":
        default: return "default";
    }
}
