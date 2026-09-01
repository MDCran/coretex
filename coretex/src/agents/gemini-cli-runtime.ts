// Coretex — GeminiCliAgentRuntime: runs Gemini agents on Google's Gemini CLI (subprocess)
// when the user has selected a Google AI Pro/Ultra subscription instead of an API key.
// Like ChatGPT Plus/Pro, that plan billing is not reachable via the Gemini REST API — only
// via Gemini CLI's own "Login with Google" OAuth flow, tied to the Google account the
// subscription is on. This runtime never sees or manages that credential — it only shells
// out to the already-authenticated `gemini` binary and translates its headless JSONL event
// stream into Coretex's normalized AgentRuntimeEvent stream, exactly like ClaudeAgentRuntime
// does for the Claude Agent SDK.
//
// The prompt is piped over stdin rather than passed as a `-p` argument so long system
// prompts / task prompts never hit an OS command-line length limit (a real constraint on
// Windows), and so headless mode is triggered unambiguously (a non-TTY stdin) regardless of
// prompt size.

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { ProviderHealth } from "../types.js";
import type { AgentRunInput, AgentRuntime, AgentRuntimeEvent } from "./runtime.js";

const GEMINI_BIN = process.env.GEMINI_CLI_PATH || "gemini";
const LOGIN_PROBE_TIMEOUT_MS = 20_000;

/** Run the npm `.cmd` shim correctly on Windows without enabling a shell elsewhere. */
function geminiInvocation(args: string[]): { command: string; args: string[] } {
    const windowsShim = process.platform === "win32" && /(?:^|[\\/])gemini(?:\.cmd|\.bat)?$/i.test(GEMINI_BIN);
    return windowsShim
        ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", GEMINI_BIN, ...args] }
        : { command: GEMINI_BIN, args };
}

/** Coretex's own permission mode → Gemini CLI approval mode. Never silently hangs headless. */
function approvalModeFor(mode: AgentRunInput["permissionMode"]): "plan" | "yolo" {
    return mode === "plan" ? "plan" : "yolo";
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
    return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function extractText(obj: Record<string, unknown>): string {
    const nested = asRecord(obj.message);
    for (const c of [obj.text, obj.content, nested?.text, nested?.content, obj.response]) {
        if (typeof c === "string" && c.trim()) return c;
    }
    return "";
}

function extractRole(obj: Record<string, unknown>): string {
    const nested = asRecord(obj.message);
    const c = obj.role ?? nested?.role;
    return typeof c === "string" ? c : "";
}

function extractToolName(obj: Record<string, unknown>): string {
    for (const c of [obj.name, obj.tool, obj.toolName]) {
        if (typeof c === "string" && c) return c;
    }
    return "gemini_tool";
}

function extractErrorMessage(obj: Record<string, unknown>): string | undefined {
    const errField = asRecord(obj.error);
    for (const c of [obj.message, errField?.message, typeof obj.error === "string" ? obj.error : undefined]) {
        if (typeof c === "string" && c.trim()) return c;
    }
    return undefined;
}

export class GeminiCliAgentRuntime implements AgentRuntime {
    readonly kind = "gemini-cli" as const;

    async *run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
        // Gemini's headless CLI has no Coretex callback that can approve or
        // intercept each shell command. Do not start it for Off/Approval; the
        // pool can fall back to the tool-free universal loop when API auth is
        // available. Command lists/caps are not claimed for this external process.
        if (input.terminalPolicy && input.terminalPolicy.autonomousTerminal !== "auto") {
            yield {
                type: "error",
                data: {
                    message: input.terminalPolicy.autonomousTerminal === "off"
                        ? "Gemini CLI was not started because AI terminal execution is off."
                        : "Gemini CLI was not started because this headless runtime cannot relay per-command approvals.",
                    fallback: true,
                },
            };
            return;
        }
        const approvalMode = approvalModeFor(input.permissionMode);
        const args: string[] = [
            "--output-format", "stream-json",
            "--approval-mode", approvalMode,
            "--non-interactive",
        ];
        if (input.model) {
            // Gemini model ids are tokens (for example gemini-2.5-pro). Keeping
            // shell metacharacters out also makes the Windows `.cmd` path safe.
            if (!/^[A-Za-z0-9._:/-]+$/.test(input.model)) {
                yield { type: "error", data: { message: "Gemini model id contains unsupported characters.", fallback: true } };
                return;
            }
            args.push("--model", input.model);
        }
        // No dedicated prompt flag — the full prompt is piped via stdin (see file header).

        let child: ChildProcess;
        try {
            const invocation = geminiInvocation(args);
            child = spawn(invocation.command, invocation.args, {
                cwd: input.cwd,
                env: input.env ? { ...process.env, ...input.env } : process.env,
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
                shell: false,
            });
        } catch (err) {
            yield {
                type: "error",
                data: { message: `Failed to launch Gemini CLI: ${err instanceof Error ? err.message : String(err)}`, fallback: true },
            };
            return;
        }

        let spawnFailed: string | undefined;
        child.once("error", (err: NodeJS.ErrnoException) => {
            spawnFailed =
                err.code === "ENOENT"
                    ? `Gemini CLI ("${GEMINI_BIN}") not found on PATH. Install it and sign in once (run "gemini" and choose "Login with Google"), or switch Gemini to API-key auth in Settings.`
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

                    if (type === "message") {
                        if (extractRole(obj) === "user") continue;
                        const text = extractText(obj);
                        if (text) {
                            lastText += (lastText ? "\n" : "") + text;
                            yield { type: "text", data: { text } };
                        }
                    } else if (type === "tool_use") {
                        yield { type: "tool_call", data: { name: extractToolName(obj), input: obj } };
                    } else if (type === "tool_result") {
                        yield { type: "tool_result", data: obj };
                    } else if (type === "result") {
                        const text = extractText(obj);
                        if (text && !lastText) lastText = text;
                        const usage = (asRecord(obj.stats) ?? asRecord(obj.usage) ?? {}) as Record<string, unknown>;
                        yield { type: "cost", data: { costUsd: 0, usage } };
                    } else if (type === "error") {
                        const message = extractErrorMessage(obj) ?? "Gemini CLI reported an error";
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
            const authHint = /not (logged|authenticat)|sign.?in|login/i.test(stderrTail) ? ' Run "gemini" once and choose "Login with Google", then retry.' : "";
            yield {
                type: "error",
                data: { message: `Gemini CLI exited with code ${exitCode}.${authHint}${stderrTail ? ` ${stderrTail.slice(-500)}` : ""}`.trim() },
            };
            return;
        }
        if (!sawEvent && !failedMessage) {
            yield {
                type: "error",
                data: { message: `Gemini CLI produced no output.${stderrTail ? ` ${stderrTail.slice(-500)}` : ' Is it installed and signed in ("gemini" → Login with Google)?'}` },
            };
            return;
        }
        if (!failedMessage) {
            yield { type: "done", data: { result: lastText } };
        }
    }
}

function offline(startedAt: number, error: string): ProviderHealth {
    return { provider: "gemini", healthy: false, latencyMs: Date.now() - startedAt, error, models: [], checkedAt: Date.now(), status: "offline", channel: "subscription" };
}

/**
 * Lightweight preflight for the AI-providers "Test connection" button under subscription
 * auth. Gemini CLI has no documented non-interactive "auth status" command, so this runs a
 * minimal live headless query and reads whether it succeeds — a tiny, one-off use of the
 * plan's quota, same trade-off the hub already makes for API-key providers' health checks.
 */
export async function checkGeminiLogin(): Promise<ProviderHealth> {
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
            const invocation = geminiInvocation(["--output-format", "json", "--approval-mode", "plan", "--non-interactive"]);
            child = spawn(invocation.command, invocation.args, {
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
                shell: false,
            });
        } catch (err) {
            finish(offline(startedAt, `Gemini CLI not found: ${err instanceof Error ? err.message : String(err)}`));
            return;
        }

        const timer = setTimeout(() => {
            try {
                child.kill();
            } catch {
                /* already exited */
            }
            finish(offline(startedAt, "Gemini CLI did not respond in time."));
        }, LOGIN_PROBE_TIMEOUT_MS);

        child.stdin?.write("Reply with the single word: ok");
        child.stdin?.end();

        let out = "";
        child.stdout?.on("data", (c: Buffer) => (out += c.toString()));
        child.stderr?.on("data", (c: Buffer) => (out += c.toString()));
        child.once("error", (err: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            finish(
                offline(
                    startedAt,
                    err.code === "ENOENT"
                        ? `Gemini CLI ("${GEMINI_BIN}") not found on PATH. Install it, then run "gemini" once to sign in.`
                        : err.message,
                ),
            );
        });
        child.once("close", (code) => {
            clearTimeout(timer);
            if (code === 0) {
                finish({ provider: "gemini", healthy: true, latencyMs: Date.now() - startedAt, models: [], checkedAt: Date.now(), status: "ready", channel: "subscription" });
                return;
            }
            const authIssue = /not (logged|authenticat)|sign.?in|login|unauthenticated/i.test(out);
            finish(
                offline(
                    startedAt,
                    authIssue ? 'Not signed in. Run "gemini" once and choose "Login with Google", then Test.' : out.trim() || `Gemini CLI exited with code ${code}.`,
                ),
            );
        });
    });
}
