// Coretex — MCP (Model Context Protocol) client. Coretex is the MCP Host: it
// spawns an MCP Server as a child process and speaks line-delimited JSON-RPC 2.0
// over stdio — initialize handshake, tools/list, tools/call. One client per
// server; multiple agents can reuse the same client (tool calls carry their own
// params), so sessions aren't tied to a single agent.

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { McpTool } from "../types.js";

interface Pending {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
}

export interface McpConnectResult {
    tools: McpTool[];
    serverName?: string;
    serverVersion?: string;
}

export class McpClient {
    private proc: ChildProcessWithoutNullStreams | undefined;
    private buffer = "";
    private nextId = 1;
    private readonly pending = new Map<number, Pending>();
    private connected = false;
    private closing = false;
    private stderrTail = "";

    constructor(
        private readonly command: string,
        private readonly args: string[],
        private readonly env: Record<string, string> = {},
        private readonly onUnexpectedExit?: (error: string) => void,
    ) {}

    isConnected(): boolean {
        return this.connected;
    }

    /** Spawn the server, run the initialize handshake, and list its tools. */
    async connect(timeoutMs = 20_000): Promise<McpConnectResult> {
        const windowsShim = process.platform === "win32" && /(?:^|[\\/])(npm|npx|pnpm|yarn|bunx)(?:\.cmd)?$/i.test(this.command);
        const spawnCommand = windowsShim ? (process.env.ComSpec || "cmd.exe") : this.command;
        const spawnArgs = windowsShim ? ["/d", "/s", "/c", this.command, ...this.args] : this.args;
        const proc = spawn(spawnCommand, spawnArgs, {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, ...this.env },
            windowsHide: true,
            shell: false,
        });
        this.proc = proc;
        this.closing = false;

        proc.stdout.setEncoding("utf8");
        proc.stdout.on("data", (chunk: string) => this._onData(chunk));
        proc.stderr.setEncoding("utf8");
        proc.stderr.on("data", (chunk: string) => {
            this.stderrTail = (this.stderrTail + chunk).slice(-4000);
        });
        proc.on("exit", (code, signal) => {
            this.connected = false;
            const detail = this.stderrTail.trim();
            const reason = `MCP server exited${code != null ? ` with code ${code}` : signal ? ` (${signal})` : ""}${detail ? `: ${detail}` : ""}`;
            for (const [, p] of this.pending) p.reject(new Error(reason));
            this.pending.clear();
            if (!this.closing) this.onUnexpectedExit?.(reason);
        });
        proc.on("error", (err) => {
            for (const [, p] of this.pending) p.reject(err);
            this.pending.clear();
            if (!this.closing) this.onUnexpectedExit?.(err.message);
        });

        const withTimeout = <T>(p: Promise<T>): Promise<T> =>
            new Promise<T>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("MCP timeout")), timeoutMs);
                p.then(
                    (value) => { clearTimeout(timer); resolve(value); },
                    (error) => { clearTimeout(timer); reject(error); },
                );
            });

        // 1. initialize
        let init: { serverInfo?: { name?: string; version?: string } };
        try {
            init = (await withTimeout(
                this._request("initialize", {
                    protocolVersion: "2025-11-25",
                    capabilities: {},
                    clientInfo: { name: "coretex", version: "1.0.0" },
                }),
            )) as { serverInfo?: { name?: string; version?: string } };
        } catch (error) {
            const detail = this.stderrTail.trim();
            throw new Error(`${error instanceof Error ? error.message : String(error)}${detail ? ` — ${detail}` : ""}`);
        }
        // 2. initialized notification
        this._notify("notifications/initialized", {});
        this.connected = true;

        // 3. tools/list
        const toolsRes = (await withTimeout(this._request("tools/list", {}))) as { tools?: McpTool[] };
        return {
            tools: Array.isArray(toolsRes.tools) ? toolsRes.tools : [],
            serverName: init.serverInfo?.name,
            serverVersion: init.serverInfo?.version,
        };
    }

    /** Invoke a tool; returns its text content. */
    async callTool(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<string> {
        const res = (await new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Tool call timeout")), timeoutMs);
            this._request("tools/call", { name, arguments: args }).then(
                (value) => { clearTimeout(timer); resolve(value); },
                (error) => { clearTimeout(timer); reject(error); },
            );
        })) as { content?: { type: string; text?: string }[]; isError?: boolean };
        const text = (res.content ?? [])
            .map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`))
            .join("\n");
        if (res.isError) throw new Error(text || "Tool returned an error");
        return text;
    }

    disconnect(): void {
        this.connected = false;
        this.closing = true;
        try {
            const pid = this.proc?.pid;
            if (process.platform === "win32" && pid) {
                // stdio servers launched through npm/npx have a cmd → node process tree;
                // killing only the shell leaves the actual server orphaned with open pipes.
                const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
                    stdio: "ignore",
                    windowsHide: true,
                    shell: false,
                });
                killer.unref();
            } else {
                this.proc?.kill();
            }
        } catch {
            /* already gone */
        }
        this.proc = undefined;
        for (const [, pending] of this.pending) pending.reject(new Error("MCP server disconnected"));
        this.pending.clear();
    }

    // ---- JSON-RPC plumbing (line-delimited over stdio) ----
    private _request(method: string, params: unknown): Promise<unknown> {
        const id = this.nextId++;
        const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
        return new Promise<unknown>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            try {
                this.proc?.stdin.write(msg + "\n");
            } catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    private _notify(method: string, params: unknown): void {
        try {
            this.proc?.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
        } catch {
            /* ignore */
        }
    }

    private _onData(chunk: string): void {
        this.buffer += chunk;
        let nl = this.buffer.indexOf("\n");
        while (nl !== -1) {
            const line = this.buffer.slice(0, nl).trim();
            this.buffer = this.buffer.slice(nl + 1);
            if (line.length > 0) this._onMessage(line);
            nl = this.buffer.indexOf("\n");
        }
    }

    private _onMessage(line: string): void {
        let msg: Record<string, unknown>;
        try {
            msg = JSON.parse(line) as Record<string, unknown>;
        } catch {
            return; // server log noise on stdout
        }
        const id = msg["id"];
        if (typeof id !== "number") return; // a notification/request from the server
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        if (msg["error"]) {
            const e = msg["error"] as { message?: string };
            p.reject(new Error(e.message ?? "MCP error"));
        } else {
            p.resolve(msg["result"]);
        }
    }
}
