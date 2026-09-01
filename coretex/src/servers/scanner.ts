// Coretex — running-server / port detection. Enumerates listening TCP ports +
// owning process, classifies each via a known-port map and a light HTTP probe,
// and returns RunningServer rows. Windows uses netstat + tasklist; POSIX uses
// lsof. All best-effort: failures degrade to fewer fields, never throw.

import { exec } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import type { RunningServer, ServerTier, ServerType } from "../types.js";

const pexec = promisify(exec);

/** Dev runtimes/frameworks — these are "yours", not background noise. */
const DEV_PROCESSES = new Set([
    "node", "deno", "bun", "python", "python3", "uvicorn", "gunicorn", "ruby", "rails",
    "php", "dotnet", "go", "cargo", "rustc", "vite", "next", "ng", "flutter", "dart",
    "ollama", "ollama app", "lms", "llama-server", "java", "esbuild", "webpack",
]);

/** Known system / background process names — grouped + collapsed (still listed). */
const SYSTEM_PROCESSES = new Set([
    "system", "svchost", "lsass", "services", "spoolsv", "runtimebroker", "dwm",
    "searchhost", "wininit", "csrss", "smss", "wininet", "system idle process",
    "spotify", "steam", "steamwebhelper", "steamservice", "discord", "teamviewer_service",
    "teamviewer", "focusrite control 2", "focusrite control", "elgatoaudiocontrolserver",
    "asus_framework", "armourycrate.service", "armourycrate.usersessionhelper", "roglive",
    "roglive service", "rogliveservice", "armourycrate", "rtkaudioservice", "rtkauduservice",
    "jetbrains-toolbox", "tailscaled", "signalrgb", "signalrgbservice", "streamdeck",
    "epicgameslauncher", "adobe desktop service", "curse.agent.host", "workflowappcontrol",
    "figma_agent", "nvcontainer", "msmpeng", "audiodg",
]);

// Packaged Brain uses 8765; the desktop development relay intentionally uses
// 8766 so both modes are identified and protected from the stop action.
const CORETEX_PORTS = new Set([8765, 8766]);

export interface PortClass {
    type: ServerType;
    tech: string;
    /** Don't HTTP-probe databases. */
    probe: boolean;
}

const KNOWN_PORTS: Record<number, PortClass> = {
    5432: { type: "database", tech: "PostgreSQL", probe: false },
    3306: { type: "database", tech: "MySQL", probe: false },
    27017: { type: "database", tech: "MongoDB", probe: false },
    6379: { type: "database", tech: "Redis", probe: false },
    1433: { type: "database", tech: "SQL Server", probe: false },
    11434: { type: "api", tech: "Ollama", probe: true },
    1234: { type: "api", tech: "LM Studio", probe: true },
    5173: { type: "dev", tech: "Vite", probe: true },
    5174: { type: "dev", tech: "Vite", probe: true },
    3000: { type: "dev", tech: "Next.js / Node", probe: true },
    3001: { type: "dev", tech: "Node dev server", probe: true },
    3002: { type: "dev", tech: "Node dev server", probe: true },
    4000: { type: "dev", tech: "Dev server", probe: true },
    8000: { type: "api", tech: "HTTP / FastAPI", probe: true },
    8080: { type: "web", tech: "HTTP", probe: true },
    8765: { type: "api", tech: "Coretex Brain (WebSocket)", probe: false },
    8766: { type: "api", tech: "Coretex Brain (WebSocket · dev)", probe: false },
    9000: { type: "api", tech: "Coretex relay", probe: true },
    6341: { type: "dev", tech: "Dev server", probe: true },
};

function classify(port: number): PortClass {
    return KNOWN_PORTS[port] ?? { type: "unknown", tech: "", probe: true };
}

// ---- listener enumeration ----
interface Listener {
    port: number;
    pid?: number;
}

async function listenersWindows(): Promise<Map<number, Listener>> {
    const out = new Map<number, Listener>();
    const { stdout } = await pexec("netstat -ano -p TCP", { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    for (const line of stdout.split(/\r?\n/)) {
        if (!line.includes("LISTENING")) continue;
        const parts = line.trim().split(/\s+/);
        // proto local foreign state pid
        if (parts.length < 5) continue;
        const local = parts[1];
        const pid = Number(parts[4]);
        const m = local.match(/:(\d+)$/);
        if (!m) continue;
        const port = Number(m[1]);
        if (!Number.isFinite(port) || port <= 0) continue;
        if (!out.has(port)) out.set(port, { port, pid: Number.isFinite(pid) ? pid : undefined });
    }
    return out;
}

async function processNamesWindows(pids: number[]): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    if (pids.length === 0) return names;
    try {
        const { stdout } = await pexec('tasklist /FO CSV /NH', { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
        for (const line of stdout.split(/\r?\n/)) {
            // "name.exe","pid","session","#","mem"
            const m = line.match(/^"([^"]+)","(\d+)"/);
            if (!m) continue;
            names.set(Number(m[2]), m[1].replace(/\.exe$/i, ""));
        }
    } catch {
        /* tasklist unavailable */
    }
    return names;
}

async function listenersPosix(): Promise<{ listeners: Map<number, Listener>; names: Map<number, string> }> {
    const listeners = new Map<number, Listener>();
    const names = new Map<number, string>();
    try {
        const { stdout } = await pexec("lsof -nP -iTCP -sTCP:LISTEN", { maxBuffer: 4 * 1024 * 1024 });
        for (const line of stdout.split(/\r?\n/)) {
            if (!line.includes("LISTEN")) continue;
            const parts = line.trim().split(/\s+/);
            if (parts.length < 9) continue;
            const name = parts[0];
            const pid = Number(parts[1]);
            const addr = parts[8];
            const m = addr.match(/:(\d+)$/);
            if (!m) continue;
            const port = Number(m[1]);
            if (!listeners.has(port)) {
                listeners.set(port, { port, pid: Number.isFinite(pid) ? pid : undefined });
                if (Number.isFinite(pid)) names.set(pid, name);
            }
        }
    } catch {
        /* lsof unavailable */
    }
    return { listeners, names };
}

async function probe(port: number): Promise<{ ok: boolean; tech?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 700);
    try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { method: "GET", signal: controller.signal });
        const server = res.headers.get("server") ?? "";
        const powered = res.headers.get("x-powered-by") ?? "";
        let tech: string | undefined;
        const hay = `${server} ${powered}`.toLowerCase();
        if (hay.includes("next")) tech = "Next.js";
        else if (hay.includes("express")) tech = "Express";
        else if (hay.includes("vite")) tech = "Vite";
        else if (hay.includes("uvicorn") || hay.includes("fastapi")) tech = "FastAPI";
        else if (hay.includes("werkzeug") || hay.includes("flask")) tech = "Flask";
        else if (server) tech = server.split("/")[0];
        return { ok: true, tech };
    } catch {
        return { ok: false };
    } finally {
        clearTimeout(timer);
    }
}

export interface DockerPortInfo {
    name: string;
    compose?: string;
    id: string;
    image?: string;
    privatePort?: number;
}

export type DockerPortMap = Map<number, DockerPortInfo>;

/**
 * Refine a host-port guess with Docker metadata. Published host ports are often
 * arbitrary (for example 5450 → PostgreSQL 5432), while the container-side
 * port, image, and name describe the actual protocol.
 */
export function classifyDockerPort(docker: DockerPortInfo, fallback: PortClass): PortClass {
    const privateClass = docker.privatePort !== undefined ? KNOWN_PORTS[docker.privatePort] : undefined;
    if (privateClass?.type === "database") return privateClass;

    const identity = `${docker.name} ${docker.image ?? ""}`.toLowerCase();
    if (/\b(postgres(?:ql)?|postgis|supabase\/postgres)\b/.test(identity)) {
        return { type: "database", tech: "PostgreSQL", probe: false };
    }
    if (/\b(mariadb|mysql)\b/.test(identity)) {
        return { type: "database", tech: identity.includes("mariadb") ? "MariaDB" : "MySQL", probe: false };
    }
    if (/\b(mongo(?:db)?|redis|valkey)\b/.test(identity)) {
        const tech = identity.includes("redis") ? "Redis" : identity.includes("valkey") ? "Valkey" : "MongoDB";
        return { type: "database", tech, probe: false };
    }
    if (/\b(mssql|sqlserver|sql-server)\b/.test(identity)) {
        return { type: "database", tech: "SQL Server", probe: false };
    }
    return fallback;
}

/** A project the scanner can attribute a server to, by matching its source path in a process command line. */
export interface ScanProject {
    id: string;
    sourcePath?: string;
}

/** Normalise a path/command line for case-insensitive substring matching across slash styles. */
function normPath(s: string): string {
    return s.toLowerCase().replace(/\\/g, "/");
}

/** Bulk pid→command-line map on Windows via CIM (one call); empty on failure.
 *  Emits a pipe-delimited "<pid>|<commandline>" stream and ships the PowerShell via
 *  -EncodedCommand (base64 UTF-16LE) so nested quotes survive cmd.exe untouched. */
async function commandLinesWindows(): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    try {
        const script = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }';
        const encoded = Buffer.from(script, "utf16le").toString("base64");
        const { stdout } = await pexec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });
        for (const line of stdout.split(/\r?\n/)) {
            const bar = line.indexOf("|");
            if (bar <= 0) continue;
            const pid = Number(line.slice(0, bar));
            const cmd = line.slice(bar + 1).trim();
            if (Number.isFinite(pid) && cmd) out.set(pid, cmd);
        }
    } catch {
        /* CIM unavailable */
    }
    return out;
}

/** Per-pid command line on POSIX via ps (best-effort, used only for the listening pids). */
async function commandLinesPosix(pids: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    await Promise.allSettled(
        pids.map(async (pid) => {
            try {
                const { stdout } = await pexec(`ps -o command= -p ${pid}`, { maxBuffer: 256 * 1024 });
                const cmd = stdout.trim();
                if (cmd) out.set(pid, cmd);
            } catch {
                /* gone */
            }
        }),
    );
    return out;
}

/** Assign a relevance tier (highest wins): coretex > docker > dev > system. */
function tierFor(port: number, process: string | undefined, type: ServerType, isDocker: boolean): ServerTier {
    const proc = (process ?? "").toLowerCase();
    if (CORETEX_PORTS.has(port)) return "coretex";
    if (isDocker || proc.includes("docker")) return "docker";
    if (SYSTEM_PROCESSES.has(proc)) return "system";
    if (DEV_PROCESSES.has(proc) || type === "dev") return "dev";
    // Classified API/Web on a user port with a known tech → treat as dev (yours).
    if ((type === "api" || type === "web") && proc.length > 0) return "dev";
    // Everything else (unknown system ports, unnamed) → background.
    return "system";
}

export class ServerScanner {
    /** port:pid → first scan timestamp, for uptime. Cleared when a port disappears. */
    private readonly firstSeen = new Map<string, number>();
    /** pid → { cmd, at }: command-line cache so we don't re-query every 12s scan. */
    private readonly cmdCache = new Map<number, { cmd: string; at: number }>();
    /** Last observed listeners, used to reject stale or unsafe stop requests. */
    private readonly stoppablePids = new Set<number>();
    private static readonly CMD_TTL_MS = 60_000;

    /** Enumerate, classify, probe, and rank listening servers. Attributes each to a project when given. */
    async scan(dockerPorts?: DockerPortMap, projects?: ScanProject[]): Promise<RunningServer[]> {
        const now = Date.now();
        let listeners: Map<number, Listener>;
        let names: Map<number, string>;

        if (os.platform() === "win32") {
            listeners = await listenersWindows().catch(() => new Map<number, Listener>());
            const pids = [...listeners.values()].map((l) => l.pid).filter((p): p is number => typeof p === "number");
            names = await processNamesWindows(pids);
        } else {
            const r = await listenersPosix();
            listeners = r.listeners;
            names = r.names;
        }

        const servers: RunningServer[] = [];
        const probes: Promise<void>[] = [];
        const seenKeys = new Set<string>();

        for (const { port, pid } of listeners.values()) {
            const procName = pid !== undefined ? names.get(pid) : undefined;

            // Uptime via first-seen tracking.
            const key = `${port}:${pid ?? 0}`;
            seenKeys.add(key);
            if (!this.firstSeen.has(key)) this.firstSeen.set(key, now);
            const uptimeMs = now - (this.firstSeen.get(key) ?? now);

            // Docker resolution (host port → real container/stack).
            const docker = dockerPorts?.get(port);
            const cls = docker ? classifyDockerPort(docker, classify(port)) : classify(port);

            const server: RunningServer = {
                port,
                type: cls.type,
                tech: cls.tech || undefined,
                pid,
                process: procName,
                owner: docker ? "docker" : "local",
                ownerId: docker?.id,
                url: cls.type === "database" ? undefined : `http://localhost:${port}`,
                lastSeen: now,
                tier: tierFor(port, procName, cls.type, !!docker),
                uptimeMs,
                composeProject: docker?.compose,
                containerName: docker?.name,
            };
            servers.push(server);
            if (cls.probe) {
                probes.push(
                    probe(port).then((r) => {
                        server.statusOk = r.ok;
                        if (r.tech && (!server.tech || server.type === "unknown")) {
                            server.tech = r.tech;
                            if (server.type === "unknown") server.type = "web";
                        }
                    }),
                );
            }
        }

        await Promise.allSettled(probes);

        // Attribute servers to projects by matching a project's source path inside the
        // owning process's command line (works cross-platform; cwd is unreadable on Windows).
        const candidates = (projects ?? []).filter((p) => p.sourcePath && p.sourcePath.trim().length > 0);
        if (candidates.length > 0) {
            await this.attributeProjects(servers, candidates);
        }

        // Drop first-seen entries for ports that vanished this scan.
        for (const k of [...this.firstSeen.keys()]) {
            if (!seenKeys.has(k)) this.firstSeen.delete(k);
        }
        // Evict stale command-line cache entries.
        const now2 = Date.now();
        for (const [pid, e] of this.cmdCache) {
            if (now2 - e.at > ServerScanner.CMD_TTL_MS) this.cmdCache.delete(pid);
        }

        servers.sort((a, b) => a.port - b.port);
        this.stoppablePids.clear();
        for (const server of servers) {
            if (server.pid !== undefined && (server.tier === "project" || server.tier === "dev")) {
                this.stoppablePids.add(server.pid);
            }
        }
        return servers;
    }

    /** Resolve command lines for the given servers' pids and set RunningServer.projectId by longest path match. */
    private async attributeProjects(servers: RunningServer[], projects: ScanProject[]): Promise<void> {
        const now = Date.now();
        const pids = [...new Set(servers.map((s) => s.pid).filter((p): p is number => typeof p === "number"))];
        // Which pids need a fresh command line (not cached or stale)?
        const missing = pids.filter((pid) => {
            const e = this.cmdCache.get(pid);
            return !e || now - e.at > ServerScanner.CMD_TTL_MS;
        });
        if (missing.length > 0) {
            const fetched = os.platform() === "win32" ? await commandLinesWindows() : await commandLinesPosix(missing);
            for (const pid of missing) {
                const cmd = fetched.get(pid) ?? "";
                this.cmdCache.set(pid, { cmd, at: now });
            }
        }
        // Precompute normalised project paths, longest first (most specific wins).
        const normed = projects
            .map((p) => ({ id: p.id, path: normPath(p.sourcePath ?? "") }))
            .filter((p) => p.path.length > 0)
            .sort((a, b) => b.path.length - a.path.length);

        for (const server of servers) {
            if (server.pid === undefined) continue;
            const cmd = this.cmdCache.get(server.pid)?.cmd;
            if (!cmd) continue;
            const hay = normPath(cmd);
            const match = normed.find((p) => hay.includes(p.path));
            if (match) server.projectId = match.id;
        }
    }

    /** Terminate a process by PID (best-effort, cross-platform). */
    async kill(pid: number): Promise<void> {
        if (!Number.isSafeInteger(pid) || pid <= 4 || pid === process.pid) {
            throw new Error("Coretex refused an invalid or protected process id.");
        }
        if (!this.stoppablePids.has(pid)) {
            throw new Error("Only a currently detected project or development server can be stopped here. Rescan and try again.");
        }
        if (os.platform() === "win32") {
            await pexec(`taskkill /PID ${pid}`, { windowsHide: true });
        } else {
            process.kill(pid, "SIGTERM");
        }
    }
}
