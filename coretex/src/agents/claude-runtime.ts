// Coretex — ClaudeAgentRuntime: runs anthropic agents on the Claude Agent SDK
// (@anthropic-ai/claude-agent-sdk), getting Claude Code's proven agent loop, tools,
// permissions, MCP, and sessions natively. Translates SDK messages into Coretex's
// normalized AgentRuntimeEvent stream so downstream (cost/audit/activity/halt) is
// engine-agnostic. The SDK is loaded lazily so the Brain still runs without it.

import type * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import type { ProviderHealth } from "../types.js";
import type { AgentRunInput, AgentRuntime, AgentRuntimeEvent, BrowserToolHandler, ConnectorToolGuard } from "./runtime.js";
import { toSdkPermissionMode } from "./runtime.js";
import { evaluateTerminalCommand, type TerminalSecurityPolicy } from "../security/terminal-policy.js";

const DEFAULT_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Bash", "Write", "Edit"];
// Shell/terminal-touching tools dropped when an agent has no terminal access.
const TERMINAL_TOOLS = new Set(["Bash"]);
const CLAUDE_BIN = process.env.CLAUDE_CLI_PATH || "claude";
const AUTH_STATUS_TIMEOUT_MS = 8_000;

/**
 * npm-installed CLIs are exposed as `.cmd` shims on Windows. Node cannot execute
 * those shims directly with `spawn(..., { shell: false })`, even when PowerShell
 * can resolve the same bare command. Route only the known Claude shim through
 * `cmd.exe`; native executables and explicit non-shim paths stay direct.
 */
function claudeInvocation(args: string[]): { command: string; args: string[] } {
    const windowsShim = process.platform === "win32" && /(?:^|[\\/])claude(?:\.cmd|\.bat)?$/i.test(CLAUDE_BIN);
    return windowsShim
        ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", CLAUDE_BIN, ...args] }
        : { command: CLAUDE_BIN, args };
}

/** Non-billing Claude Code auth probe used by Settings; it never sends a model prompt. */
export async function checkClaudeLogin(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    const offline = (error: string): ProviderHealth => ({
        provider: "anthropic", healthy: false, latencyMs: Date.now() - startedAt,
        error, models: [], checkedAt: Date.now(), status: "offline", channel: "subscription",
    });
    return new Promise<ProviderHealth>((resolve) => {
        let settled = false;
        const finish = (value: ProviderHealth) => { if (!settled) { settled = true; resolve(value); } };
        let child: ChildProcess;
        try {
            const invocation = claudeInvocation(["auth", "status"]);
            child = spawn(invocation.command, invocation.args, {
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
                shell: false,
            });
        } catch (error) {
            finish(offline(`Claude CLI not found: ${error instanceof Error ? error.message : String(error)}`));
            return;
        }
        let output = "";
        child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
        child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
        const timer = setTimeout(() => {
            try { child.kill(); } catch { /* already exited */ }
            finish(offline("Claude CLI auth status did not respond in time."));
        }, AUTH_STATUS_TIMEOUT_MS);
        child.once("error", (error: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            finish(offline(error.code === "ENOENT" ? `Claude CLI ("${CLAUDE_BIN}") not found on PATH.` : error.message));
        });
        child.once("close", (code) => {
            clearTimeout(timer);
            if (code === 0) {
                finish({ provider: "anthropic", healthy: true, latencyMs: Date.now() - startedAt, models: [], checkedAt: Date.now(), status: "ready", channel: "subscription" });
            } else {
                finish(offline(output.trim() || 'Not signed in. Run "claude" once and complete login, then Test.'));
            }
        });
    });
}

// The in-process MCP server name under which the in-app browser tools are exposed (#33).
// The SDK fully-qualifies these as `mcp__coretex_browser__<tool>` in the model's tool list.
const BROWSER_MCP_SERVER = "coretex_browser";
const browserToolFqn = (tool: string): string => `mcp__${BROWSER_MCP_SERVER}__${tool}`;

/**
 * Build an in-process SDK MCP server that backs the four in-app browser tools with the supplied
 * permission-gated handler. Returns the server config plus the fully-qualified tool names to add to
 * `allowedTools`. Tools resolve to a text CallToolResult; the handler never throws, so a denied or
 * unsupported action comes back as readable text the model can recover from. Built lazily from the
 * SDK module so the Brain still runs without the SDK installed.
 */
function buildBrowserMcpServer(
    sdk: typeof ClaudeSdk,
    handler: BrowserToolHandler,
): { server: ClaudeSdk.McpServerConfig; toolNames: string[] } {
    const asResult = (value: unknown): { content: { type: "text"; text: string }[] } => ({
        content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
    });
    const tools = [
        sdk.tool(
            "browser_navigate",
            "Navigate the in-app browser session to a URL. Works in every host. Returns the resolved URL.",
            { sessionId: z.string().describe("The in-app browser session id to drive."), url: z.string().describe("Absolute URL to navigate to.") },
            async (args) => asResult(await handler({ kind: "navigate", sessionId: args.sessionId, url: args.url })),
        ),
        sdk.tool(
            "browser_read_dom",
            "Read the visible DOM/text of the in-app browser page. Requires the Electron <webview> host; the web/iframe host returns a 'not available in this host' result.",
            { sessionId: z.string().describe("The in-app browser session id to read.") },
            async (args) => asResult(await handler({ kind: "read_dom", sessionId: args.sessionId })),
        ),
        sdk.tool(
            "browser_click",
            "Click an element by CSS selector in the in-app browser. Requires the Electron <webview> host.",
            { sessionId: z.string().describe("The in-app browser session id."), selector: z.string().describe("CSS selector of the element to click.") },
            async (args) => asResult(await handler({ kind: "click", sessionId: args.sessionId, selector: args.selector })),
        ),
    ];
    const server = sdk.createSdkMcpServer({ name: BROWSER_MCP_SERVER, version: "1.0.0", tools });
    return { server, toolNames: ["browser_navigate", "browser_read_dom", "browser_click"].map(browserToolFqn) };
}

/** Pull plain text + tool_use blocks out of an SDK assistant message (loose-typed). */
function readAssistant(message: unknown): { text: string; toolCalls: { name: string; input: unknown }[] } {
    const content = (message as { content?: unknown[] })?.content ?? [];
    let text = "";
    const toolCalls: { name: string; input: unknown }[] = [];
    for (const block of content as Array<Record<string, unknown>>) {
        if (block?.type === "text" && typeof block.text === "string") text += block.text;
        else if (block?.type === "tool_use" && typeof block.name === "string") toolCalls.push({ name: block.name, input: block.input });
    }
    return { text, toolCalls };
}

/**
 * Claude SDK exposes a true pre-tool hook, so its Bash calls can use the exact
 * same decision engine as Terminal Buddy. The hook only denies or asks; an
 * allowed command still respects the agent's own (possibly stricter) permission
 * mode rather than globally force-allowing it.
 */
function terminalPolicyHooks(policy: TerminalSecurityPolicy): NonNullable<ClaudeSdk.Options["hooks"]> {
    return {
        PreToolUse: [
            {
                matcher: "Bash",
                hooks: [
                    async (input): Promise<ClaudeSdk.HookJSONOutput> => {
                        const raw = input as unknown as { tool_input?: unknown };
                        const toolInput = raw.tool_input && typeof raw.tool_input === "object"
                            ? (raw.tool_input as Record<string, unknown>)
                            : {};
                        const command = typeof toolInput.command === "string" ? toolInput.command : "";
                        const decision = evaluateTerminalCommand(policy, command);
                        if (decision.allowed) return {};
                        return {
                            hookSpecificOutput: {
                                hookEventName: "PreToolUse",
                                permissionDecision: decision.requiresApproval ? "ask" : "deny",
                                permissionDecisionReason: decision.reason ?? "Blocked by Coretex terminal policy.",
                            },
                        };
                    },
                ],
            },
        ],
    };
}

/**
 * Merge the terminal policy with a generic connector MCP guard. The connector
 * matcher is intentionally omitted: the SDK invokes it for every PreToolUse event
 * and Coretex performs its own exact account-scoped FQN resolution.
 */
export function agentPolicyHooks(
    terminalPolicy?: TerminalSecurityPolicy,
    connectorToolGuard?: ConnectorToolGuard,
): NonNullable<ClaudeSdk.Options["hooks"]> | undefined {
    const preToolUse: NonNullable<NonNullable<ClaudeSdk.Options["hooks"]>["PreToolUse"]> = [];
    if (terminalPolicy) preToolUse.push(...(terminalPolicyHooks(terminalPolicy).PreToolUse ?? []));
    if (connectorToolGuard) {
        preToolUse.push({
            hooks: [
                async (input): Promise<ClaudeSdk.HookJSONOutput> => {
                    if (input.hook_event_name !== "PreToolUse") return {};
                    const raw = input as typeof input & {
                        tool_name?: unknown;
                        tool_input?: unknown;
                        tool_use_id?: unknown;
                    };
                    if (typeof raw.tool_name !== "string") return {};
                    try {
                        const decision = await connectorToolGuard(
                            raw.tool_name,
                            raw.tool_input,
                            typeof raw.tool_use_id === "string" ? raw.tool_use_id : undefined,
                        );
                        if (!decision) return {};
                        return {
                            hookSpecificOutput: {
                                hookEventName: "PreToolUse",
                                permissionDecision: decision.allowed ? "allow" : "deny",
                                permissionDecisionReason: decision.reason ?? (decision.allowed
                                    ? "Allowed by Coretex connector policy."
                                    : "Blocked by Coretex connector policy."),
                            },
                        };
                    } catch (error) {
                        return {
                            hookSpecificOutput: {
                                hookEventName: "PreToolUse",
                                permissionDecision: "deny",
                                permissionDecisionReason: `Connector policy check failed; tool call blocked (${error instanceof Error ? error.message : String(error)}).`,
                            },
                        };
                    }
                },
            ],
        });
    }
    return preToolUse.length > 0 ? { PreToolUse: preToolUse } : undefined;
}

export class ClaudeAgentRuntime implements AgentRuntime {
    readonly kind = "claude-sdk" as const;

    async *run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
        // Lazy-load the SDK; if it isn't installed, signal a fallback to the universal loop.
        let sdk: typeof ClaudeSdk;
        try {
            sdk = (await import("@anthropic-ai/claude-agent-sdk")) as typeof ClaudeSdk;
        } catch {
            yield { type: "error", data: { message: "Claude Agent SDK not installed", fallback: true } };
            return;
        }
        if (!input.apiKey && input.authMode !== "claude-plan" && !input.oauthToken) {
            yield { type: "error", data: { message: "Anthropic API key required — or switch to Claude Pro/Max plan auth in Settings → AI providers.", auth: true } };
            return;
        }

        // Plan auth: do NOT set ANTHROPIC_API_KEY (it would override subscription billing).
        // API auth: set ANTHROPIC_API_KEY for this run only.
        const prevKey = process.env.ANTHROPIC_API_KEY;
        const prevOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
        const usePlan = input.authMode === "claude-plan" || (!input.apiKey && !!input.oauthToken);
        if (usePlan) {
            delete process.env.ANTHROPIC_API_KEY;
            if (input.oauthToken) process.env.CLAUDE_CODE_OAUTH_TOKEN = input.oauthToken;
        } else if (input.apiKey) {
            process.env.ANTHROPIC_API_KEY = input.apiKey;
        }

        const abortController = new AbortController();
        const onAbort = (): void => abortController.abort();
        input.signal.addEventListener("abort", onAbort);

        // Bind the in-app browser tools into the live tool list when a handler is supplied (#33).
        // ADDITIVE + defensive: if anything about wiring the SDK MCP server throws (e.g. an SDK
        // version without createSdkMcpServer/tool), log and run WITHOUT the browser tools rather
        // than failing the whole run or falling back off the SDK.
        let mcpServers = input.mcpServers;
        let browserToolNames: string[] = [];
        if (input.browserControl && typeof sdk.createSdkMcpServer === "function" && typeof sdk.tool === "function") {
            try {
                const built = buildBrowserMcpServer(sdk, input.browserControl);
                mcpServers = { ...(input.mcpServers ?? {}), [BROWSER_MCP_SERVER]: built.server };
                browserToolNames = built.toolNames;
            } catch (err) {
                console.warn("[claude-runtime] failed to register in-app browser tools; continuing without them:", err);
            }
        }

        // Allowed tool set = caller's (or the default set), minus terminal tools when disabled,
        // plus the fully-qualified browser MCP tool names when the bridge is present.
        const baseTools = (input.allowedTools ?? DEFAULT_TOOLS).filter((t) => (input.terminalAccess === false ? !TERMINAL_TOOLS.has(t) : true));
        const allowedTools = [...baseTools, ...browserToolNames];
        const hooks = agentPolicyHooks(input.terminalPolicy, input.connectorToolGuard);

        try {
            const iterator = sdk.query({
                prompt: input.prompt,
                options: {
                    model: input.model || undefined,
                    cwd: input.cwd,
                    env: input.env,
                    permissionMode: toSdkPermissionMode(input.permissionMode),
                    allowedTools,
                    maxTurns: input.maxTurns,
                    // Keep Claude Code's battle-tested system prompt; append the agent's instructions.
                    systemPrompt: input.systemPrompt ? { type: "preset", preset: "claude_code", append: input.systemPrompt } : undefined,
                    abortController,
                    resume: input.resume,
                    mcpServers,
                    hooks,
                },
            });

            for await (const msg of iterator) {
                if (input.signal.aborted) break;
                if (msg.type === "system" && "session_id" in msg) {
                    yield { type: "session", data: { sessionId: (msg as { session_id: string }).session_id } };
                } else if (msg.type === "assistant") {
                    const { text, toolCalls } = readAssistant((msg as { message: unknown }).message);
                    if (text) yield { type: "text", data: { text } };
                    for (const tc of toolCalls) yield { type: "tool_call", data: { name: tc.name, input: tc.input } };
                } else if (msg.type === "result") {
                    const r = msg as { subtype: string; result?: string; total_cost_usd?: number; usage?: Record<string, unknown>; session_id?: string };
                    if (r.subtype === "success") {
                        yield { type: "cost", data: { costUsd: r.total_cost_usd ?? 0, usage: r.usage ?? {} } };
                        yield { type: "done", data: { result: r.result ?? "", sessionId: r.session_id } };
                    } else {
                        yield { type: "error", data: { message: `Claude run ended: ${r.subtype}` } };
                    }
                }
            }
        } catch (err) {
            yield { type: "error", data: { message: err instanceof Error ? err.message : String(err) } };
        } finally {
            input.signal.removeEventListener("abort", onAbort);
            if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
            else process.env.ANTHROPIC_API_KEY = prevKey;
            if (prevOauth === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
            else process.env.CLAUDE_CODE_OAUTH_TOKEN = prevOauth;
        }
    }
}
