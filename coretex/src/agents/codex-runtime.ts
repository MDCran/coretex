// Coretex — CodexAgentRuntime: runs OpenAI agents on OpenAI's Codex CLI (subprocess) when
// the user has selected ChatGPT Plus/Pro/Team subscription billing instead of an API key.
// ChatGPT plan billing is NOT reachable via the OpenAI REST API at all — the only sanctioned
// way to run agentic work against it is Codex CLI, which owns its own OAuth session
// (`codex login`, cached to ~/.codex/auth.json). This runtime never sees or manages that
// credential — it only shells out to the already-authenticated `codex` binary and translates
// its `codex exec --json` JSONL event stream into Coretex's normalized AgentRuntimeEvent
// stream, exactly like ClaudeAgentRuntime does for the Claude Agent SDK.
//
// The prompt is piped over stdin (not a CLI arg) so long system prompts / task prompts never
// hit an OS command-line length limit (a real constraint on Windows).

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { ProviderHealth } from "../types.js";
import type { AgentRunInput, AgentRuntime, AgentRuntimeEvent } from "./runtime.js";

const CODEX_BIN = process.env.CODEX_CLI_PATH || "codex";
const LOGIN_STATUS_TIMEOUT_MS = 8_000;

/** Coretex's own permission mode → Codex sandbox. Never grants danger-full-access. */
function sandboxFor(mode: AgentRunInput["permissionMode"]): "read-only" | "workspace-write" {
    return mode === "plan" ? "read-only" : "workspace-write";
}

/** Best-effort text extraction — Codex's item JSON shape isn't pinned down in the docs. */
function extractText(item: Record<string, unknown>): string {
    const nested = item.item && typeof item.item === "object" ? (item.item as Record<string, unknown>) : undefined;
    for (const c of [item.text, item.content, item.message, nested?.text, nested?.content]) {
        if (typeof c === "string" && c.trim()) return c;
    }
    return "";
}

function extractItemKind(item: Record<string, unknown>): string {
    const nested = item.item && typeof item.item === "object" ? (item.item as Record<string, unknown>) : undefined;
    for (const c of [item.item_type, item.itemType, nested?.item_type, nested?.type, item.type]) {
        if (typeof c === "string" && c) return c;
    }
    return "";
}

function extractErrorMessage(obj: Record<string, unknown>): string | undefined {
    const errField = obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : undefined;
    for (const c of [obj.message, errField?.message, typeof obj.error === "string" ? obj.error : undefined]) {
        if (typeof c === "string" && c.trim()) return c;
    }
    return undefined;
}

export class CodexAgentRuntime implements AgentRuntime {
    readonly kind = "codex-cli" as const;

    async *run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
        // Codex CLI does not expose a host callback that can approve/intercept
        // each shell command. Do not start it when global policy requires Off or
        // per-command approval; the pool can safely fall back to the tool-free
        // universal loop when an API-backed provider is available.
        if (input.terminalPolicy && input.terminalPolicy.autonomousTerminal !== "auto") {
            yield {
                type: "error",
                data: {
                    message: input.terminalPolicy.autonomousTerminal === "off"
                        ? "Codex CLI was not started because AI terminal execution is off."
                        : "Codex CLI was not started because this headless runtime cannot relay per-command approvals.",
                    fallback: true,
                },
            };
            return;
        }
        const args: string[] = [
            "exec",
            "--json",
            "--skip-git-repo-check",
            "--sandbox", sandboxFor(input.permissionMode),
            "--ask-for-approval", "never",
        ];
        if (input.model) args.push("--model", input.model);
        if (input.cwd) args.push("--cd", input.cwd);
        args.push("-"); // read the prompt from stdin

        let child: ChildProcess;
        try {
            child = spawn(CODEX_BIN, args, {
                cwd: input.cwd,
                env: input.env ? { ...process.env, ...input.env } : process.env,
                stdio: ["pipe", "pipe", "pipe"],
            });
        } catch (err) {
            yield {
                type: "error",
                data: { message: `Failed to launch Codex CLI: ${err instanceof Error ? err.message : String(err)}`, fallback: true },
            };
            return;
        }

        let spawnFailed: string | undefined;
        child.once("error", (err: NodeJS.ErrnoException) => {
            spawnFailed =
                err.code === "ENOENT"
                    ? `Codex CLI ("${CODEX_BIN}") not found on PATH. Install it and run "codex login" once, or switch OpenAI to API-key auth in Settings.`
                    : err.message;
        });

        const onAbort = (): void => {
            try {
                child.kill();
            } catch {
                /* already exited */
            }
        };
        input.signal.addEventListener("abort", onAbort);

        const fullPrompt = input.systemPrompt ? `${input.systemPrompt}\n\n---\n\n${input.prompt}` : input.prompt;
        child.stdin?.write(fullPrompt);
        child.stdin?.end();

        let lastText = "";
        let stderrTail = "";
        let sawEvent = false;
        let failedMessage: string | undefined;
        child.stderr?.on("data", (chunk: Buffer) => {
            stderrTail = (stderrTail + chunk.toString()).slice(-4000);
        });

        try {
            if (child.stdout) {
                const rl = createInterface({ input: child.stdout });
                for await (const line of rl) {
                    if (spawnFailed) break;
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    let evt: unknown;
                    try {
                        evt = JSON.parse(trimmed);
                    } catch {
                        continue;
                    }
                    sawEvent = true;
                    const obj = evt as Record<string, unknown>;
                    const type = typeof obj.type === "string" ? obj.type : "";

                    if (type === "item.completed") {
                        const item = (obj.item && typeof obj.item === "object" ? obj.item : obj) as Record<string, unknown>;
                        const kind = extractItemKind(item);
                        if (/command|tool|patch|file|mcp/i.test(kind)) {
                            yield { type: "tool_call", data: { name: kind || "codex_action", input: item } };
                        } else {
                            const text = extractText(item);
                            if (text) {
                                lastText += (lastText ? "\n" : "") + text;
                                yield { type: "text", data: { text } };
                            }
                        }
                    } else if (type === "turn.completed") {
                        const usage = (obj.usage && typeof obj.usage === "object" ? obj.usage : {}) as Record<string, unknown>;
                        yield { type: "cost", data: { costUsd: 0, usage } };
                    } else if (type === "turn.failed") {
                        failedMessage = extractErrorMessage(obj) ?? "Codex turn failed";
                        yield { type: "error", data: { message: failedMessage } };
                    } else if (type === "error") {
                        const message = extractErrorMessage(obj) ?? "Codex CLI reported an error";
                        failedMessage = message;
                        yield { type: "error", data: { message } };
                    }
                }
            }
        } catch (err) {
            yield { type: "error", data: { message: err instanceof Error ? err.message : String(err) } };
        } finally {
            input.signal.removeEventListener("abort", onAbort);
        }

        if (spawnFailed) {
            yield { type: "error", data: { message: spawnFailed, fallback: true } };
            return;
        }

        const exitCode: number = await new Promise((resolve) => {
            if (child.exitCode !== null) {
                resolve(child.exitCode);
                return;
            }
            child.once("close", (code) => resolve(code ?? 0));
        });

        if (input.signal.aborted) return;

        if (!failedMessage && exitCode !== 0) {
            const authHint = /not logged in|login|authenticat/i.test(stderrTail) ? ' Run "codex login" once, then retry.' : "";
            yield {
                type: "error",
                data: { message: `Codex CLI exited with code ${exitCode}.${authHint}${stderrTail ? ` ${stderrTail.slice(-500)}` : ""}`.trim() },
            };
            return;
        }
        if (!sawEvent && !failedMessage) {
            yield {
                type: "error",
                data: { message: `Codex CLI produced no output.${stderrTail ? ` ${stderrTail.slice(-500)}` : ' Is it installed and logged in ("codex login")?'}` },
            };
            return;
        }
        if (!failedMessage) {
            yield { type: "done", data: { result: lastText } };
        }
    }
}

function offline(startedAt: number, error: string): ProviderHealth {
    return { provider: "openai", healthy: false, latencyMs: Date.now() - startedAt, error, models: [], checkedAt: Date.now(), status: "offline", channel: "subscription" };
}

/**
 * Lightweight, non-billing preflight for the AI-providers "Test connection" button under
 * subscription auth: runs `codex login status` (documented as safe — reads cached auth state,
 * never creates/removes credentials) and reports whether a ChatGPT session is active.
 */
export async function checkCodexLogin(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    return new Promise<ProviderHealth>((resolve) => {
        let settled = false;
        const finish = (health: ProviderHealth): void => {
            if (settled) return;
            settled = true;
            resolve(health);
        };

        let child: ChildProcess;
        try {
            child = spawn(CODEX_BIN, ["login", "status"], { stdio: ["ignore", "pipe", "pipe"] });
        } catch (err) {
            finish(offline(startedAt, `Codex CLI not found: ${err instanceof Error ? err.message : String(err)}`));
            return;
        }

        const timer = setTimeout(() => {
            try {
                child.kill();
            } catch {
                /* already exited */
            }
            finish(offline(startedAt, "Codex CLI did not respond in time."));
        }, LOGIN_STATUS_TIMEOUT_MS);

        let out = "";
        child.stdout?.on("data", (c: Buffer) => (out += c.toString()));
        child.stderr?.on("data", (c: Buffer) => (out += c.toString()));
        child.once("error", (err: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            finish(
                offline(
                    startedAt,
                    err.code === "ENOENT"
                        ? `Codex CLI ("${CODEX_BIN}") not found on PATH. Install it, then run "codex login".`
                        : err.message,
                ),
            );
        });
        child.once("close", () => {
            clearTimeout(timer);
            const loggedIn = /logged in/i.test(out) && !/not logged in/i.test(out);
            if (loggedIn) {
                finish({ provider: "openai", healthy: true, latencyMs: Date.now() - startedAt, models: [], checkedAt: Date.now(), status: "ready", channel: "subscription" });
            } else {
                finish(offline(startedAt, out.trim() || 'Not logged in. Run "codex login" once, then Test.'));
            }
        });
    });
}
