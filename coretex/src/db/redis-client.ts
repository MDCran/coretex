import net from "node:net";
import tls from "node:tls";
import type { DbConnection } from "../config/schema.js";
import { DB_MAX_CELL_BYTES, DB_MAX_RESULT_BYTES, DB_MAX_ROWS, DB_QUERY_TIMEOUT_MS } from "./query-safety.js";

export type RedisValue = string | number | null | RedisValue[];

class RedisReplyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RedisReplyError";
    }
}

interface ParsedFrame {
    value: RedisValue;
    offset: number;
}

function lineEnd(buffer: Buffer, offset: number): number {
    return buffer.indexOf("\r\n", offset, "utf8");
}

/** Incremental RESP2 decoder. `null` means the frame is incomplete. */
export function parseRedisFrame(buffer: Buffer, offset = 0): ParsedFrame | null {
    if (offset >= buffer.length) return null;
    const prefix = String.fromCharCode(buffer[offset]!);
    const end = lineEnd(buffer, offset + 1);
    if (end < 0) return null;
    const header = buffer.toString("utf8", offset + 1, end);
    if (prefix === "+") return { value: header, offset: end + 2 };
    if (prefix === "-") throw new RedisReplyError(header);
    if (prefix === ":") {
        const value = Number(header);
        if (!Number.isSafeInteger(value)) throw new Error("Redis returned an invalid integer response.");
        return { value, offset: end + 2 };
    }
    if (prefix === "$") {
        const length = Number(header);
        if (!Number.isInteger(length) || length < -1) throw new Error("Redis returned an invalid bulk response.");
        if (length === -1) return { value: null, offset: end + 2 };
        if (length > DB_MAX_CELL_BYTES) throw new Error(`Redis value exceeds the ${Math.round(DB_MAX_CELL_BYTES / 1024)} KB viewer limit.`);
        const bodyStart = end + 2;
        const bodyEnd = bodyStart + length;
        if (buffer.length < bodyEnd + 2) return null;
        if (buffer[bodyEnd] !== 13 || buffer[bodyEnd + 1] !== 10) throw new Error("Redis returned a malformed bulk response.");
        return { value: buffer.toString("utf8", bodyStart, bodyEnd), offset: bodyEnd + 2 };
    }
    if (prefix === "*") {
        const count = Number(header);
        if (!Number.isInteger(count) || count < -1) throw new Error("Redis returned an invalid array response.");
        if (count === -1) return { value: null, offset: end + 2 };
        if (count > DB_MAX_ROWS * 4) throw new Error("Redis returned too many items for the viewer.");
        const values: RedisValue[] = [];
        let cursor = end + 2;
        for (let i = 0; i < count; i += 1) {
            const child = parseRedisFrame(buffer, cursor);
            if (!child) return null;
            values.push(child.value);
            cursor = child.offset;
        }
        return { value: values, offset: cursor };
    }
    throw new Error("Redis returned an unsupported protocol response.");
}

function encodeCommand(args: string[]): Buffer {
    const chunks: Buffer[] = [Buffer.from(`*${args.length}\r\n`, "utf8")];
    for (const arg of args) {
        const value = Buffer.from(arg, "utf8");
        chunks.push(Buffer.from(`$${value.length}\r\n`, "utf8"), value, Buffer.from("\r\n", "utf8"));
    }
    return Buffer.concat(chunks);
}

export class RedisClient {
    private buffer = Buffer.alloc(0);
    private readonly replies: Array<{ resolve: (value: RedisValue) => void; reject: (error: Error) => void }> = [];
    private closed = false;

    private constructor(private readonly socket: net.Socket | tls.TLSSocket) {
        socket.on("data", (chunk: Buffer) => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            if (this.buffer.length > DB_MAX_RESULT_BYTES) {
                const error = new Error(`Redis response exceeds the ${Math.round(DB_MAX_RESULT_BYTES / 1024 / 1024)} MB viewer limit.`);
                this.fail(error);
                socket.destroy(error);
                return;
            }
            this.drain();
        });
        socket.on("error", (error) => this.fail(error));
        socket.on("timeout", () => {
            const error = new Error(`Redis operation timed out after ${DB_QUERY_TIMEOUT_MS}ms`);
            this.fail(error);
            socket.destroy(error);
        });
        socket.on("close", () => this.fail(new Error("Redis connection closed.")));
        socket.setTimeout(DB_QUERY_TIMEOUT_MS);
    }

    static async connect(conn: DbConnection, password?: string): Promise<RedisClient> {
        const host = conn.host?.trim() || "127.0.0.1";
        const port = conn.port ?? 6379;
        const socket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
            let settled = false;
            const onConnect = (value: net.Socket | tls.TLSSocket): void => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            const onError = (error: Error): void => {
                if (settled) return;
                settled = true;
                reject(error);
            };
            const candidate = conn.ssl
                ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: true })
                : net.createConnection({ host, port });
            candidate.once(conn.ssl ? "secureConnect" : "connect", () => onConnect(candidate));
            candidate.setTimeout(DB_QUERY_TIMEOUT_MS, () => candidate.destroy(new Error(`Redis connection timed out after ${DB_QUERY_TIMEOUT_MS}ms`)));
            candidate.once("error", onError);
        });
        const client = new RedisClient(socket);
        try {
            if (password !== undefined && password.length > 0) {
                const auth = conn.user?.trim() ? ["AUTH", conn.user.trim(), password] : ["AUTH", password];
                await client.command(auth);
            }
            const database = conn.database?.trim() || "0";
            if (database !== "0") await client.command(["SELECT", database]);
            return client;
        } catch (error) {
            client.close();
            throw error;
        }
    }

    command(args: string[]): Promise<RedisValue> {
        if (this.closed) return Promise.reject(new Error("Redis connection is closed."));
        if (args.length === 0) return Promise.reject(new Error("Redis command is empty."));
        return new Promise<RedisValue>((resolve, reject) => {
            this.replies.push({ resolve, reject });
            this.socket.write(encodeCommand(args), (error) => {
                if (error) this.fail(error);
            });
        });
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.socket.destroy();
        this.fail(new Error("Redis connection closed."));
    }

    private drain(): void {
        while (this.replies.length > 0 && this.buffer.length > 0) {
            try {
                const parsed = parseRedisFrame(this.buffer);
                if (!parsed) return;
                this.buffer = this.buffer.subarray(parsed.offset);
                this.replies.shift()!.resolve(parsed.value);
            } catch (error) {
                const safe = error instanceof Error ? error : new Error(String(error));
                this.replies.shift()?.reject(safe);
                this.fail(safe);
                this.socket.destroy();
                return;
            }
        }
    }

    private fail(error: Error): void {
        const pending = this.replies.splice(0);
        for (const reply of pending) reply.reject(error);
    }
}
