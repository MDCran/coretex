// Coretex — Bridge server. Hosts the WebSocket endpoint the browser dashboard (the Relay)
// connects to. Broadcasts OrchestratorEvents outward and surfaces inbound WebCommands.

import { EventEmitter } from "eventemitter3";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { OrchestratorEvent, WebCommand } from "../types.js";

export const BRIDGE_PROTOCOL = "coretex-v1";
export const BRIDGE_SESSION_FILE = "bridge-session.json";

const TOKEN_PROTOCOL_PREFIX = "coretex-auth.";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const NATIVE_ORIGINS = new Set(["file://", "null", "app://coretex"]);

export interface BridgeServerOptions {
    /** 32+ bytes encoded as base64url. Omit to create a fresh per-process token. */
    authToken?: string;
    /** Exact browser origins allowed to attempt an authenticated upgrade. */
    allowedOrigins?: Iterable<string>;
}

export interface BridgeSession {
    version: 1;
    port: number;
    pid: number;
    token: string;
    createdAt: string;
}

/** Canonicalize an origin entry while rejecting paths, credentials, and unsafe schemes. */
function normalizeOrigin(origin: string): string | null {
    const value = origin.trim();
    if (NATIVE_ORIGINS.has(value)) return value;
    try {
        const parsed = new URL(value);
        if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
            parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
            return null;
        }
        return parsed.origin;
    } catch {
        return null;
    }
}

export function normalizeBridgeOrigins(origins: Iterable<string> = []): ReadonlySet<string> {
    const normalized = new Set<string>(NATIVE_ORIGINS);
    for (const origin of origins) {
        const value = normalizeOrigin(origin);
        if (value) normalized.add(value);
    }
    return normalized;
}

export function bridgeOriginsFromEnvironment(value: string | undefined): string[] {
    return (value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
}

/** Browser origins must match the configured allowlist exactly. Native clients omit Origin. */
export function isTrustedOrigin(origin: string | undefined, allowedOrigins: Iterable<string> = []): boolean {
    if (origin === undefined) return true;
    const normalized = normalizeOrigin(origin);
    return normalized !== null && normalizeBridgeOrigins(allowedOrigins).has(normalized);
}

export function generateBridgeAuthToken(): string {
    return randomBytes(32).toString("base64url");
}

function requireBridgeAuthToken(value: string | undefined): string {
    const token = value?.trim() || generateBridgeAuthToken();
    if (!TOKEN_PATTERN.test(token)) {
        throw new Error("CORETEX_BRIDGE_TOKEN must be 32 or more random bytes encoded as base64url.");
    }
    return token;
}

export function bridgeAuthProtocols(token: string): string[] {
    return [BRIDGE_PROTOCOL, TOKEN_PROTOCOL_PREFIX + requireBridgeAuthToken(token)];
}

function tokenFromProtocolHeader(header: string | string[] | undefined): string | undefined {
    const raw = Array.isArray(header) ? header.join(",") : header;
    return raw?.split(",").map((value) => value.trim())
        .find((value) => value.startsWith(TOKEN_PROTOCOL_PREFIX))
        ?.slice(TOKEN_PROTOCOL_PREFIX.length);
}

function tokensEqual(actual: string | undefined, expected: string): boolean {
    if (!actual || !TOKEN_PATTERN.test(actual)) return false;
    const actualBytes = Buffer.from(actual, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export class BridgeServer extends EventEmitter {
    private server: WebSocketServer | null = null;
    private clients: Map<string, WebSocket> = new Map();
    private counter: number = 0;
    /** Liveness flag per socket (set on pong); the reaper terminates sockets that miss a beat. */
    private alive: WeakMap<WebSocket, boolean> = new WeakMap();
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    private outboundTransform: ((event: OrchestratorEvent) => OrchestratorEvent) | undefined;
    private readonly token: string;
    private readonly allowedOrigins: ReadonlySet<string>;
    private sessionPath: string | null = null;

    constructor(options: BridgeServerOptions = {}) {
        super();
        this.token = requireBridgeAuthToken(options.authToken);
        this.allowedOrigins = normalizeBridgeOrigins(options.allowedOrigins);
    }

    /** Used only by trusted host bootstrap code; never include this in bridge payloads or logs. */
    public get authToken(): string {
        return this.token;
    }

    /** Install a non-mutating output transform (used for centralized secret redaction). */
    public setOutboundTransform(transform: ((event: OrchestratorEvent) => OrchestratorEvent) | undefined): void {
        this.outboundTransform = transform;
    }

    public start(port: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // Bind to loopback and require both an exact trusted Origin and an ephemeral bearer
            // token before the WebSocket upgrade. Origin checks alone do not protect native
            // clients (which omit Origin) or against DNS rebinding/local-origin compromise.
            const server = new WebSocketServer({
                port,
                host: "127.0.0.1",
                maxPayload: 16 * 1024 * 1024,
                handleProtocols: (protocols) => protocols.has(BRIDGE_PROTOCOL) ? BRIDGE_PROTOCOL : false,
                verifyClient: (info, done) => {
                    if (!isTrustedOrigin(info.origin, this.allowedOrigins)) {
                        done(false, 403, "Forbidden origin");
                        return;
                    }
                    const suppliedToken = tokenFromProtocolHeader(info.req.headers["sec-websocket-protocol"]);
                    if (!tokensEqual(suppliedToken, this.token)) {
                        done(false, 401, "Unauthorized");
                        return;
                    }
                    done(true, 101);
                },
            });
            this.server = server;

            let listening = false;

            const onListening = (): void => {
                listening = true;
                server.off("error", onError);
                console.log("WebSocket server listening on ws://localhost:" + port);
                resolve();
            };

            const onError = (err: Error): void => {
                if (!listening) {
                    server.off("listening", onListening);
                    reject(err);
                }
            };

            server.once("listening", onListening);
            server.once("error", onError);

            server.on("connection", (socket: WebSocket): void => {
                const clientId = "client_" + ++this.counter;
                this.clients.set(clientId, socket);
                this.alive.set(socket, true);
                console.log("Bridge client connected: " + clientId);

                this.emit("client:connected", clientId);

                // Immediately request a snapshot so the new client renders current state.
                this.emit("command", { type: "system:status" } as WebCommand, clientId);

                // A pong (reply to our ping) proves the socket is still live — reset its flag.
                socket.on("pong", (): void => {
                    this.alive.set(socket, true);
                });

                socket.on("message", (data: WebSocket.RawData): void => {
                    this.alive.set(socket, true);
                    try {
                        const command = JSON.parse(data.toString()) as WebCommand;
                        this.emit("command", command, clientId);
                    } catch (err: unknown) {
                        const message = err instanceof Error ? err.message : String(err);
                        console.error("Bridge: failed to parse command from " + clientId + ": " + message);
                    }
                });

                socket.on("close", (): void => {
                    this.clients.delete(clientId);
                    this.alive.delete(socket);
                    console.log("Bridge client disconnected: " + clientId);
                    this.emit("client:disconnected", clientId);
                });

                socket.on("error", (): void => {
                    this.clients.delete(clientId);
                    this.alive.delete(socket);
                    this.emit("client:disconnected", clientId);
                });
            });

            // Heartbeat reaper: every 30s, terminate any socket that didn't pong since the last
            // sweep (a client that reloaded/vanished without a clean close), then ping the rest.
            // Without this, half-open sockets linger as CLOSE_WAIT and pile up until the server
            // stops servicing new WebSocket upgrades and every client is stuck loading.
            this.heartbeat = setInterval((): void => {
                for (const [clientId, socket] of this.clients) {
                    if (this.alive.get(socket) === false) {
                        this.clients.delete(clientId);
                        this.alive.delete(socket);
                        try { socket.terminate(); } catch { /* already gone */ }
                        this.emit("client:disconnected", clientId);
                        continue;
                    }
                    this.alive.set(socket, false);
                    try { socket.ping(); } catch { /* send failed — reaped next sweep */ }
                }
            }, 30000);
            // Don't let the heartbeat keep the process alive on its own.
            this.heartbeat.unref?.();
        });
    }

    public broadcast(event: OrchestratorEvent): void {
        const msg = this.encode(event);
        for (const [clientId, socket] of this.clients) {
            if (socket.readyState === WebSocket.OPEN) {
                // A socket can drop between the readyState check and send(); never let one
                // dead client throw and abort the whole broadcast loop.
                try {
                    socket.send(msg);
                } catch {
                    this.clients.delete(clientId);
                }
            } else {
                this.clients.delete(clientId);
            }
        }
    }

    public send(clientId: string, event: OrchestratorEvent): void {
        const socket = this.clients.get(clientId);
        if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
            try {
                socket.send(this.encode(event));
            } catch {
                this.clients.delete(clientId);
            }
        }
    }

    public get clientCount(): number {
        return this.clients.size;
    }

    /** Publish the short-lived token for same-user desktop/web bootstrap outside the repo. */
    public async publishSession(dataDir: string, port: number): Promise<void> {
        await mkdir(dataDir, { recursive: true });
        const destination = join(dataDir, BRIDGE_SESSION_FILE);
        const temporary = destination + `.${process.pid}.tmp`;
        const session: BridgeSession = {
            version: 1,
            port,
            pid: process.pid,
            token: this.token,
            createdAt: new Date().toISOString(),
        };
        await writeFile(temporary, JSON.stringify(session), { encoding: "utf8", mode: 0o600 });
        try { await chmod(temporary, 0o600); } catch { /* Windows ACLs are inherited from the user profile. */ }
        await rename(temporary, destination);
        try { await chmod(destination, 0o600); } catch { /* Best effort on Windows. */ }
        this.sessionPath = destination;
    }

    private async removeOwnSession(): Promise<void> {
        const destination = this.sessionPath;
        this.sessionPath = null;
        if (!destination) return;
        try {
            const current = JSON.parse(await readFile(destination, "utf8")) as Partial<BridgeSession>;
            if (current.pid === process.pid && current.token === this.token) await unlink(destination);
        } catch {
            // Missing, replaced, or malformed session files are not ours to remove.
        }
    }

    private encode(event: OrchestratorEvent): string {
        let outgoing = event;
        if (this.outboundTransform) {
            try {
                outgoing = this.outboundTransform(event);
            } catch {
                // Output filtering must fail closed for the connection, not crash the Brain.
                outgoing = { type: "notice", level: "error", message: "An output event could not be safely delivered." };
            }
        }
        return JSON.stringify(outgoing);
    }

    public stop(): void {
        void this.removeOwnSession();
        if (this.heartbeat !== null) {
            clearInterval(this.heartbeat);
            this.heartbeat = null;
        }
        for (const socket of this.clients.values()) {
            socket.close();
        }
        this.clients.clear();
        if (this.server !== null) {
            this.server.close();
            this.server = null;
        }
    }
}
