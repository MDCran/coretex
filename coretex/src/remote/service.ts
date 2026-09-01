// Coretex — Remote transport service. Backs the Remote (SSH / SFTP / FTP) view with
// real sessions: ssh2 powers SSH + SFTP (browse over the SFTP subsystem), basic-ftp
// powers plain FTP. Sessions are kept in-memory keyed by a generated id; credentials
// arrive per-connect from the vault (never persisted here). All operations are
// best-effort and surface errors as data rather than throwing across the WS bridge.

import { Client as SshClient } from "ssh2";
import type { SFTPWrapper } from "ssh2";
import { Client as FtpClient } from "basic-ftp";

export type RemoteProtocol = "ssh" | "sftp" | "ftp";

export interface RemoteSession {
    id: string;
    hostId: string;
    label: string;
    protocol: RemoteProtocol;
    host: string;
    user: string;
    cwd: string;
    status: "connecting" | "connected" | "error" | "closed";
    error?: string;
}

export interface RemoteEntry {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    modified: number;
}

export interface RemoteConnectInput {
    hostId: string;
    label: string;
    protocol: RemoteProtocol;
    host: string;
    port: number;
    user: string;
    auth: "key" | "agent" | "password";
    /** Secret from the vault: password (password auth) or private key text (key auth). */
    secret?: string;
}

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

/** Join a POSIX remote path safely. */
function joinPosix(base: string, name: string): string {
    if (name.startsWith("/")) return name;
    if (base.endsWith("/")) return base + name;
    return `${base}/${name}`;
}

interface Live {
    meta: RemoteSession;
    ssh?: SshClient;
    sftp?: SFTPWrapper;
    ftp?: FtpClient;
}

export class RemoteService {
    private readonly sessions = new Map<string, Live>();
    private seq = 0;
    /** Set by the orchestrator → broadcast remote:sessions whenever a session changes. */
    onChange: (() => void) | null = null;

    listSessions(): RemoteSession[] {
        return [...this.sessions.values()].map((s) => ({ ...s.meta }));
    }

    private emit(): void {
        this.onChange?.();
    }

    private newId(hostId: string): string {
        this.seq += 1;
        return `rs-${hostId}-${this.seq}`;
    }

    /** Open a session. Resolves once connected (or rejects with a readable message). */
    async connect(input: RemoteConnectInput): Promise<RemoteSession> {
        // Keep one authoritative attempt per saved host. Otherwise a failed
        // session remains first in insertion order and can mask every retry in
        // the renderer while also leaking dead transports in memory.
        for (const [sessionId, existing] of this.sessions) {
            if (existing.meta.hostId !== input.hostId) continue;
            this.teardown(existing);
            this.sessions.delete(sessionId);
        }
        const id = this.newId(input.hostId);
        const startCwd = input.protocol === "ftp" ? "/" : ".";
        const meta: RemoteSession = {
            id,
            hostId: input.hostId,
            label: input.label,
            protocol: input.protocol,
            host: input.host,
            user: input.user,
            cwd: startCwd,
            status: "connecting",
        };
        const live: Live = { meta };
        this.sessions.set(id, live);
        this.emit();

        try {
            if (input.protocol === "ftp") {
                await this.connectFtp(live, input);
            } else {
                await this.connectSsh(live, input);
            }
            meta.status = "connected";
            // Resolve a concrete starting directory for browsing.
            meta.cwd = await this.resolveHome(live);
            this.emit();
            return { ...meta };
        } catch (err) {
            meta.status = "error";
            meta.error = err instanceof Error ? err.message : String(err);
            this.emit();
            this.teardown(live);
            return { ...meta };
        }
    }

    private connectSsh(live: Live, input: RemoteConnectInput): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const client = new SshClient();
            live.ssh = client;
            const cfg: Record<string, unknown> = { host: input.host, port: input.port || 22, username: input.user, readyTimeout: 15_000, keepaliveInterval: 15_000, keepaliveCountMax: 3 };
            if (input.auth === "password") cfg.password = input.secret ?? "";
            else if (input.auth === "key") cfg.privateKey = input.secret ?? "";
            else if (input.auth === "agent") cfg.agent = process.env["SSH_AUTH_SOCK"] || (process.platform === "win32" ? "pageant" : undefined);

            client.on("ready", () => {
                client.sftp((err, sftp) => {
                    if (err) {
                        reject(new Error(`SFTP subsystem unavailable: ${err.message}`));
                        return;
                    }
                    live.sftp = sftp;
                    resolve();
                });
            });
            client.on("error", (err) => reject(err instanceof Error ? err : new Error(String(err))));
            client.on("close", () => {
                if (live.meta.status === "connected") {
                    live.meta.status = "closed";
                    this.emit();
                }
            });
            try {
                client.connect(cfg);
            } catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    private async connectFtp(live: Live, input: RemoteConnectInput): Promise<void> {
        const client = new FtpClient(20_000);
        live.ftp = client;
        await client.access({
            host: input.host,
            port: input.port || 21,
            user: input.user || "anonymous",
            password: input.auth === "password" ? input.secret ?? "" : "anonymous@",
            secure: false,
        });
    }

    private async resolveHome(live: Live): Promise<string> {
        if (live.ftp) {
            try {
                return await live.ftp.pwd();
            } catch {
                return "/";
            }
        }
        if (live.sftp) {
            const sftp = live.sftp;
            return await new Promise<string>((resolve) => {
                sftp.realpath(".", (err, abs) => resolve(err ? "/" : abs));
            });
        }
        return "/";
    }

    /** List a directory. Returns entries sorted dirs-first then by name. */
    async list(sessionId: string, dir: string): Promise<RemoteEntry[]> {
        const live = this.sessions.get(sessionId);
        if (!live) throw new Error("Session not found");
        if (live.meta.status !== "connected") throw new Error("Session is not connected");
        const path = dir || live.meta.cwd || "/";
        let entries: RemoteEntry[];
        if (live.ftp) entries = await this.listFtp(live.ftp, path);
        else if (live.sftp) entries = await this.listSftp(live.sftp, path);
        else throw new Error("No transport");
        live.meta.cwd = path;
        this.emit();
        return entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    }

    private listSftp(sftp: SFTPWrapper, dir: string): Promise<RemoteEntry[]> {
        return new Promise<RemoteEntry[]>((resolve, reject) => {
            sftp.readdir(dir, (err, list) => {
                if (err) {
                    reject(new Error(err.message));
                    return;
                }
                const out: RemoteEntry[] = [];
                const linkIdx: number[] = [];
                for (const e of list) {
                    if (e.filename === "." || e.filename === "..") continue;
                    const masked = (e.attrs.mode ?? 0) & S_IFMT;
                    if (masked === S_IFLNK) linkIdx.push(out.length);
                    out.push({
                        name: e.filename,
                        path: joinPosix(dir, e.filename),
                        isDir: masked === S_IFDIR,
                        size: e.attrs.size ?? 0,
                        modified: (e.attrs.mtime ?? 0) * 1000,
                    });
                }
                // Resolve symlinks with stat() (which follows the link) so symlinked
                // directories are navigable rather than mis-shown as files.
                if (linkIdx.length === 0) {
                    resolve(out);
                    return;
                }
                let pending = linkIdx.length;
                for (const i of linkIdx) {
                    sftp.stat(out[i].path, (serr, st) => {
                        if (!serr && st) out[i].isDir = ((st.mode ?? 0) & S_IFMT) === S_IFDIR;
                        if (--pending === 0) resolve(out);
                    });
                }
            });
        });
    }

    private async listFtp(ftp: FtpClient, dir: string): Promise<RemoteEntry[]> {
        const list = await ftp.list(dir);
        return list.map((f) => ({
            name: f.name,
            path: joinPosix(dir, f.name),
            isDir: f.isDirectory,
            size: f.size,
            modified: f.modifiedAt ? f.modifiedAt.getTime() : 0,
        }));
    }

    async mkdir(sessionId: string, dir: string): Promise<void> {
        const live = this.require(sessionId);
        if (live.ftp) await live.ftp.ensureDir(dir);
        else if (live.sftp) {
            const sftp = live.sftp;
            await new Promise<void>((resolve, reject) => sftp.mkdir(dir, (err) => (err ? reject(new Error(err.message)) : resolve())));
        }
    }

    async remove(sessionId: string, target: string, isDir: boolean): Promise<void> {
        const live = this.require(sessionId);
        if (live.ftp) {
            if (isDir) await live.ftp.removeDir(target);
            else await live.ftp.remove(target);
        } else if (live.sftp) {
            const sftp = live.sftp;
            await new Promise<void>((resolve, reject) => {
                const cb = (err: Error | null | undefined): void => (err ? reject(new Error(err.message)) : resolve());
                if (isDir) sftp.rmdir(target, cb);
                else sftp.unlink(target, cb);
            });
        }
    }

    /** Rename/move a remote entry (file or directory) — WinSCP F2 parity. */
    async rename(sessionId: string, from: string, to: string): Promise<void> {
        const live = this.require(sessionId);
        if (live.ftp) await live.ftp.rename(from, to);
        else if (live.sftp) {
            const sftp = live.sftp;
            await new Promise<void>((resolve, reject) => sftp.rename(from, to, (err) => (err ? reject(new Error(err.message)) : resolve())));
        }
    }

    /** Download a remote file to a local path. */
    async download(sessionId: string, remotePath: string, localPath: string): Promise<void> {
        const live = this.require(sessionId);
        if (live.ftp) await live.ftp.downloadTo(localPath, remotePath);
        else if (live.sftp) {
            const sftp = live.sftp;
            await new Promise<void>((resolve, reject) => {
                sftp.fastGet(remotePath, localPath, (err) => (err ? reject(new Error(err.message)) : resolve()));
            });
        }
    }

    /** Upload a local file to a remote path. */
    async upload(sessionId: string, localPath: string, remotePath: string): Promise<void> {
        const live = this.require(sessionId);
        if (live.ftp) await live.ftp.uploadFrom(localPath, remotePath);
        else if (live.sftp) {
            const sftp = live.sftp;
            await new Promise<void>((resolve, reject) => {
                sftp.fastPut(localPath, remotePath, (err) => (err ? reject(new Error(err.message)) : resolve()));
            });
        }
    }

    disconnect(sessionId: string): void {
        const live = this.sessions.get(sessionId);
        if (!live) return;
        this.teardown(live);
        live.meta.status = "closed";
        this.sessions.delete(sessionId);
        this.emit();
    }

    disconnectAll(): void {
        for (const live of this.sessions.values()) this.teardown(live);
        this.sessions.clear();
        this.emit();
    }

    private require(sessionId: string): Live {
        const live = this.sessions.get(sessionId);
        if (!live) throw new Error("Session not found");
        if (live.meta.status !== "connected") throw new Error("Session is not connected");
        return live;
    }

    private teardown(live: Live): void {
        try {
            live.ftp?.close();
        } catch {
            /* ignore */
        }
        try {
            live.ssh?.end();
        } catch {
            /* ignore */
        }
        live.ftp = undefined;
        live.sftp = undefined;
        live.ssh = undefined;
    }
}
