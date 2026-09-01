// Coretex — terminal multiplexer. Spawns real PTY sessions (node-pty), streams
// their output, accepts input/resize/kill, and tracks session metadata. The
// orchestrator wires data/exit out over the bridge; the Relay dock renders each
// session with xterm.js.

import { spawn, type IPty } from "node-pty";
import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CommandBlock, SessionShellInfo, TerminalSessionMeta } from "../types.js";
import { detectShellKind, runCaptured, type BuddyShellKind } from "./buddy-exec.js";
import { PrivateOutputFilter } from "./private-output.js";
import { ShellIntegrationParser, integrationSnippet, probeCommand, osFamily } from "./shell-integration.js";

interface PrivateOutputTransaction {
    filter: PrivateOutputFilter;
    controller: AbortController;
    queuedInput: string[];
    queuedInputSize: number;
}

interface Session {
    meta: TerminalSessionMeta;
    /** Undefined for "agent" consoles, which mirror an agent run rather than a real PTY. */
    pty?: IPty;
    /** Shell-integration parser (real PTY sessions only); maintains the block model. */
    parser?: ShellIntegrationParser;
    /** Resolved shell info, updated as the version probe / cwd tracking learns more. */
    shellInfo?: SessionShellInfo;
    /** Cached executable base-names found on this session's PATH (enumerated once, async). */
    pathExecutables?: string[];
    /** Active Brain-injected command. Its raw stream remains available to taps and
     *  the integration parser, but is not broadcast to the renderer. */
    privateOutput?: PrivateOutputTransaction;
    /**
     * Bounded renderer-safe output used when an xterm view attaches after the
     * shell's first prompt. This is memory-only and contains the same filtered
     * bytes that were already eligible for terminal:data broadcasts.
     */
    outputReplay: string;
}

function defaultShell(): string {
    if (os.platform() === "win32") return "powershell.exe";
    return process.env["SHELL"] || "/bin/bash";
}

function deriveTitle(shell: string): string {
    const base = path.basename(shell).replace(/\.exe$/i, "").toLowerCase();
    const map: Record<string, string> = {
        "powershell": "PowerShell",
        "pwsh": "PowerShell",
        "cmd": "Command Prompt",
        "bash": "bash",
        "zsh": "zsh",
        "wsl": "WSL",
        "git-bash": "Git Bash",
    };
    return map[base] ?? base;
}

export interface CreateTerminalOpts {
    id: string;
    shell?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    profileId?: string;
    agentId?: string;
    projectId?: string;
    env?: Record<string, string>;
    /** Extra arguments appended to the spawned shell's argv. When omitted, the
     *  manager falls back to the configured startup.launchArgs default (if set). */
    args?: string;
}

/** Process-launch defaults sourced from startup.* config (cols/rows/args). The
 *  manager applies these when a create() call doesn't supply its own values. */
export interface LaunchDefaults {
    cols?: number;
    rows?: number;
    /** Raw argument string (e.g. startup.launchArgs); tokenized on whitespace. */
    args?: string;
}

/** Split a raw argument string into argv tokens, honoring single/double quotes. */
function tokenizeArgs(raw: string): string[] {
    const out: string[] = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        out.push(m[1] ?? m[2] ?? m[3] ?? "");
    }
    return out.filter((t) => t.length > 0);
}

/** A PTY write containing literal newlines submits each line separately. Collapse
 * startup integration into one shell command so one private sentinel pair covers
 * the entire injection. */
function compactInjectedCommand(source: string): string {
    return source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("; ");
}

/** A probe normally lasts milliseconds. If a stalled transaction receives an
 * enormous paste, release it rather than growing memory or losing user input. */
const MAX_QUEUED_PRIVATE_INPUT = 1024 * 1024;
/** Enough recent output to restore a newly mounted xterm without unbounded RAM. */
const MAX_OUTPUT_REPLAY = 256 * 1024;

export class TerminalManager {
    private readonly sessions: Map<string, Session> = new Map<string, Session>();
    private onData: ((id: string, data: string) => void) | undefined;
    private onExit: ((id: string, code: number) => void) | undefined;
    /** Shell-integration outputs: detected shell info + completed command blocks. */
    private onShellInfo: ((info: SessionShellInfo) => void) | undefined;
    private onBlock: ((block: CommandBlock) => void) | undefined;
    private onPathExecutables: ((id: string, names: string[]) => void) | undefined;
    /** Cached PATH executable base-names (enumerated once per Brain process; PATH is machine-stable). */
    private pathExecCache: string[] | null = null;
    /** Out-of-band observers of a session's output stream (used by the Terminal Buddy
     *  to capture a command's stdout/exit code without disturbing the broadcast). */
    private readonly taps: Map<string, Set<(data: string) => void>> = new Map<string, Set<(data: string) => void>>();
    /** Per-session promise tail. Environment probes and Buddy commands must never
     *  overlap in the same interactive shell. */
    private readonly privateOutputQueues = new Map<string, Promise<void>>();
    /** Launch defaults from startup.* config (cols/rows/args), applied when a
     *  create() call omits its own. Updated by the orchestrator on config change.
     *  TODO(brain): orchestrator must call setLaunchDefaults() with
     *  { cols: startup.launchCols, rows: startup.launchRows, args: startup.launchArgs }
     *  on startup and on every config "change" so these settings are honored. */
    private launchDefaults: LaunchDefaults = {};

    setHandlers(onData: (id: string, data: string) => void, onExit: (id: string, code: number) => void): void {
        this.onData = onData;
        this.onExit = onExit;
    }

    /** Register shell-integration sinks: shell detection + completed command blocks. */
    setShellIntegrationHandlers(
        onShellInfo: (info: SessionShellInfo) => void,
        onBlock: (block: CommandBlock) => void,
        onPathExecutables?: (id: string, names: string[]) => void,
    ): void {
        this.onShellInfo = onShellInfo;
        this.onBlock = onBlock;
        this.onPathExecutables = onPathExecutables;
    }

    /** Set the startup.* launch defaults (cols/rows/args) consulted by create()
     *  when a session doesn't specify its own. Call on startup + config change. */
    setLaunchDefaults(defaults: LaunchDefaults): void {
        this.launchDefaults = { ...defaults };
    }

    /** Most-recent resolved shell info for a session, if known. */
    shellInfoOf(id: string): SessionShellInfo | undefined {
        return this.sessions.get(id)?.shellInfo;
    }

    /** Enumerate executable base-names on PATH (once; PATH is machine-stable) and feed the
     *  autocomplete engine via the registered handler. Best-effort + capped; per-dir failures ignored. */
    private async scanPathExecutables(id: string): Promise<void> {
        if (!this.pathExecCache) {
            const raw = process.env.PATH ?? process.env.Path ?? "";
            const isWin = process.platform === "win32";
            const dirs = [...new Set(raw.split(isWin ? ";" : ":").map((d) => d.trim()).filter(Boolean))].slice(0, 64);
            const exts = isWin
                ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").toLowerCase().split(";").map((e) => e.trim()).filter(Boolean)
                : [];
            const names = new Set<string>();
            for (const dir of dirs) {
                try {
                    for (const entry of await readdir(dir)) {
                        let base = entry;
                        if (isWin) {
                            const lower = entry.toLowerCase();
                            const ext = exts.find((x) => lower.endsWith(x));
                            if (!ext) continue;
                            base = entry.slice(0, -ext.length);
                        }
                        if (base) names.add(base);
                    }
                } catch {
                    /* unreadable PATH dir — skip */
                }
                if (names.size >= 4000) break;
            }
            this.pathExecCache = [...names].sort();
        }
        const s = this.sessions.get(id);
        if (s) s.pathExecutables = this.pathExecCache;
        this.onPathExecutables?.(id, this.pathExecCache);
    }

    private broadcastVisibleData(id: string, data: string): void {
        if (!data) return;
        const session = this.sessions.get(id);
        if (session) {
            session.outputReplay += data;
            if (session.outputReplay.length > MAX_OUTPUT_REPLAY) {
                session.outputReplay = session.outputReplay.slice(-MAX_OUTPUT_REPLAY);
            }
        }
        this.onData?.(id, data);
    }

    /** Fan non-PTY console data to the broadcast handler and registered taps. */
    private emitData(id: string, data: string): void {
        this.broadcastVisibleData(id, data);
        this.emitToTaps(id, data);
    }

    /** Raw taps power command capture, so they must receive bytes even when the
     * renderer-side stream is private. */
    private emitToTaps(id: string, data: string): void {
        const set = this.taps.get(id);
        if (set) for (const fn of set) {
            try {
                fn(data);
            } catch {
                /* a tap throwing must never break the stream */
            }
        }
    }

    /** Route a raw node-pty chunk. Only terminal:data is filtered; taps and the
     * shell-integration parser continue to observe the original byte stream. */
    private emitPtyData(id: string, data: string): void {
        const session = this.sessions.get(id);
        const transaction = session?.privateOutput;
        if (transaction) {
            const filtered = transaction.filter.push(data);
            if (filtered.visible) this.broadcastVisibleData(id, filtered.visible);
        } else {
            this.broadcastVisibleData(id, data);
        }
        this.emitToTaps(id, data);
    }

    /** Recent renderer-visible bytes for an xterm that mounted after shell startup. */
    replayOf(id: string): string {
        return this.sessions.get(id)?.outputReplay ?? "";
    }

    private releasePrivateOutput(session: Session, transaction: PrivateOutputTransaction): string[] {
        if (session.privateOutput !== transaction) return [];
        session.privateOutput = undefined;
        transaction.filter.abort();
        const queued = transaction.queuedInput.splice(0);
        transaction.queuedInputSize = 0;
        return queued;
    }

    private writeUserInput(session: Session, chunks: readonly string[]): void {
        for (const data of chunks) {
            session.pty?.write(data);
            session.parser?.onInput(data);
        }
    }

    private flushQueuedInput(session: Session, transaction: PrivateOutputTransaction): void {
        this.writeUserInput(session, this.releasePrivateOutput(session, transaction));
    }

    /**
     * Serialize a Brain-injected command and hide only that transaction from the
     * renderer. The callback receives a raw PTY writer so internal bytes are never
     * mistaken for user input by the block parser.
     */
    runPrivateOutput<T>(
        id: string,
        token: string,
        operation: (write: (data: string) => void, signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        const previous = this.privateOutputQueues.get(id) ?? Promise.resolve();
        const run = previous.catch(() => undefined).then(async (): Promise<T> => {
            const session = this.sessions.get(id);
            if (!session?.pty) throw new Error("Terminal session is no longer available.");

            const transaction: PrivateOutputTransaction = {
                filter: new PrivateOutputFilter(token),
                controller: new AbortController(),
                queuedInput: [],
                queuedInputSize: 0,
            };
            session.privateOutput = transaction;
            try {
                return await operation((data: string): void => session.pty?.write(data), transaction.controller.signal);
            } finally {
                // A matching sentinel normally completed the filter. Timeout and
                // abort use the same release path, discarding only private bytes.
                this.flushQueuedInput(session, transaction);
            }
        });
        const tail = run.then(() => undefined, () => undefined);
        this.privateOutputQueues.set(id, tail);
        void tail.finally((): void => {
            if (this.privateOutputQueues.get(id) === tail) this.privateOutputQueues.delete(id);
        });
        return run;
    }

    /** Observe a session's output stream. Returns an unsubscribe function. */
    tap(id: string, fn: (data: string) => void): () => void {
        let set = this.taps.get(id);
        if (!set) {
            set = new Set<(data: string) => void>();
            this.taps.set(id, set);
        }
        set.add(fn);
        return (): void => {
            const s = this.taps.get(id);
            if (!s) return;
            s.delete(fn);
            if (s.size === 0) this.taps.delete(id);
        };
    }

    /** Session metadata (shell/cwd/kind/…) for a live session, if present. */
    metaOf(id: string): TerminalSessionMeta | undefined {
        return this.sessions.get(id)?.meta;
    }

    create(opts: CreateTerminalOpts): TerminalSessionMeta {
        const shell = opts.shell && opts.shell.trim().length > 0 ? opts.shell : defaultShell();
        // Prefer the requested cwd, but never pass a missing path into node-pty (that throws).
        let cwd = opts.cwd && opts.cwd.trim().length > 0 ? opts.cwd.trim() : os.homedir();
        try {
            if (!existsSync(cwd) || !statSync(cwd).isDirectory()) cwd = os.homedir();
        } catch {
            cwd = os.homedir();
        }
        // Initial PTY size: explicit opts win, then the configured startup.launch* size, then 80x24.
        // Clamp hard — FitAddon can briefly report 0/1 and node-pty rejects invalid sizes.
        const rawCols = opts.cols && opts.cols > 0
            ? opts.cols
            : (this.launchDefaults.cols && this.launchDefaults.cols > 0 ? this.launchDefaults.cols : 80);
        const rawRows = opts.rows && opts.rows > 0
            ? opts.rows
            : (this.launchDefaults.rows && this.launchDefaults.rows > 0 ? this.launchDefaults.rows : 24);
        const cols = Math.max(2, Math.min(500, Math.floor(rawCols)));
        const rows = Math.max(2, Math.min(200, Math.floor(rawRows)));

        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
            if (typeof v === "string") env[k] = v;
        }
        if (opts.env) Object.assign(env, opts.env);
        // Ensure TERM is set for color-capable shells (helps PowerShell / bash not choke).
        if (!env.TERM) env.TERM = "xterm-256color";
        if (!env.COLORTERM) env.COLORTERM = "truecolor";

        // Shell args: explicit opts.args win, else the configured startup.launchArgs default.
        const rawArgs = opts.args !== undefined ? opts.args : (this.launchDefaults.args ?? "");
        const shellArgs = tokenizeArgs(rawArgs);

        let ptyProc: IPty;
        try {
            ptyProc = spawn(shell, shellArgs, {
                name: "xterm-256color",
                cols,
                rows,
                cwd,
                env,
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`Could not start shell "${shell}" in ${cwd}: ${msg}`);
        }

        const meta: TerminalSessionMeta = {
            id: opts.id,
            title: deriveTitle(shell),
            profileId: opts.profileId,
            shell,
            cwd,
            agentId: opts.agentId,
            projectId: opts.projectId,
            kind: "shell",
            status: "running",
            cols,
            rows,
            createdAt: Date.now(),
        };

        // ---- Shell integration: detect the shell, set up the block-model parser ----
        const kind: BuddyShellKind = detectShellKind(shell);
        const snippet = integrationSnippet(kind);
        const integrated = snippet.length > 0;
        const parser = new ShellIntegrationParser({ sessionId: opts.id, kind, cwd, integrated });
        const shellInfo: SessionShellInfo = {
            sessionId: opts.id,
            shell: kind,
            os: osFamily(),
            isWSL: /(^|[\\/])wsl/i.test(shell),
            cwd,
            integrated,
        };

        // Register the session before subscribing to PTY output. PowerShell can
        // emit its first prompt immediately; storing first makes that prompt
        // available to the renderer's explicit replay request.
        this.sessions.set(opts.id, { meta, pty: ptyProc, parser, shellInfo, outputReplay: "" });

        ptyProc.onData((d: string): void => {
            // 1) Renderer stream. Brain-injected private transactions are removed,
            // while their raw bytes remain available to taps below.
            this.emitPtyData(opts.id, d);
            // 2) Out-of-band: parse the original bytes for integration markers.
            const s = this.sessions.get(opts.id);
            if (!s || !s.parser) return;
            try {
                const res = s.parser.feed(d);
                if (res.shellInfo && s.shellInfo) {
                    s.shellInfo = {
                        ...s.shellInfo,
                        version: res.shellInfo.version ?? s.shellInfo.version,
                        os: res.shellInfo.os || s.shellInfo.os,
                    };
                    this.onShellInfo?.(s.shellInfo);
                }
                if (res.cwdChanged && s.shellInfo) {
                    s.shellInfo = { ...s.shellInfo, cwd: s.parser.getCwd() };
                    s.meta.cwd = s.parser.getCwd();
                    this.onShellInfo?.(s.shellInfo);
                }
                for (const block of res.blocks) this.onBlock?.(block);
            } catch {
                /* a parser fault must never break the live stream */
            }
        });
        ptyProc.onExit((e: { exitCode: number }): void => {
            const s = this.sessions.get(opts.id);
            if (s) {
                s.meta.status = "exited";
                s.privateOutput?.controller.abort();
                s.privateOutput?.filter.abort();
                s.privateOutput = undefined;
            }
            this.sessions.delete(opts.id);
            this.taps.delete(opts.id);
            this.privateOutputQueues.delete(opts.id);
            this.onExit?.(opts.id, e.exitCode);
        });

        // Announce the detected shell immediately (version fills in once the probe returns).
        this.onShellInfo?.(shellInfo);

        // Enumerate PATH executables (cached) for the autocomplete engine — fire-and-forget.
        void this.scanPathExecutables(opts.id);

        // Install integration + collect the one-shot version shortly after spawn.
        // This goes through the same private-capture gate as environment probes:
        // raw bytes still reach the parser, but source/output never reaches xterm.
        if (integrated) {
            setTimeout((): void => {
                const live = this.sessions.get(opts.id);
                if (!live || !live.pty) return;
                const setup = compactInjectedCommand(snippet);
                const versionProbe = probeCommand(kind);
                const command = versionProbe ? `${setup}; ${versionProbe}` : setup;
                void runCaptured(this, opts.id, kind, command, { timeoutMs: 3_000 });
            }, 600);
        }

        return meta;
    }

    input(id: string, data: string): void {
        const s = this.sessions.get(id);
        if (!s?.pty) return;
        if (s.privateOutput) {
            // Ctrl+C is an explicit request for control. Never make it wait behind
            // a slow or wedged probe: release the private gate, deliver the
            // interrupt immediately, then replay anything already typed.
            if (data.includes("\x03")) {
                const transaction = s.privateOutput;
                transaction.controller.abort();
                const queued = this.releasePrivateOutput(s, transaction);
                // Interrupt first; replaying a queued Enter before Ctrl+C could
                // accidentally submit it into the still-running private command.
                s.pty.write(data);
                s.parser?.onInput(data);
                this.writeUserInput(s, queued);
                return;
            }

            // A shell cannot safely interleave interactive bytes with the Brain's
            // marker-wrapped command. Preserve paste/key chunks exactly and replay
            // them as soon as the private end sentinel arrives (or the operation
            // times out/aborts). This prevents private filtering from eating user
            // keystrokes or their resulting output.
            const nextSize = s.privateOutput.queuedInputSize + data.length;
            if (nextSize <= MAX_QUEUED_PRIVATE_INPUT) {
                s.privateOutput.queuedInput.push(data);
                s.privateOutput.queuedInputSize = nextSize;
                return;
            }

            // Prefer live user control over a pathological private transaction.
            // Releasing at the cap keeps memory bounded and never drops input.
            const transaction = s.privateOutput;
            transaction.controller.abort();
            const queued = this.releasePrivateOutput(s, transaction);
            s.pty.write("\x03");
            s.parser?.onInput("\x03");
            this.writeUserInput(s, queued);
        }
        // PTY-less agent consoles ignore input (read-only).
        s.pty.write(data);
        // Feed typed bytes to the parser so the heuristic fallback (no markers) can
        // still recover the command line + follow `cd`.
        s.parser?.onInput(data);
    }

    resize(id: string, cols: number, rows: number): void {
        const s = this.sessions.get(id);
        if (!s || !s.pty) return;
        const c = Math.max(2, Math.min(500, Math.floor(cols || 0)));
        const r = Math.max(2, Math.min(200, Math.floor(rows || 0)));
        // Skip no-ops and invalid sizes so FitAddon zero-frames never kill the PTY.
        if (s.meta.cols === c && s.meta.rows === r) return;
        try {
            s.pty.resize(c, r);
            s.meta.cols = c;
            s.meta.rows = r;
        } catch {
            /* resize can race a just-exited pty */
        }
    }

    kill(id: string): void {
        const s = this.sessions.get(id);
        if (!s) return;
        s.privateOutput?.controller.abort();
        s.privateOutput?.filter.abort();
        s.privateOutput = undefined;
        this.privateOutputQueues.delete(id);
        this.taps.delete(id);
        try {
            s.pty?.kill();
        } catch {
            /* already gone */
        }
        this.sessions.delete(id);
    }

    list(): TerminalSessionMeta[] {
        return [...this.sessions.values()].map((s) => s.meta);
    }

    killAll(): void {
        for (const s of this.sessions.values()) {
            s.privateOutput?.controller.abort();
            s.privateOutput?.filter.abort();
            s.privateOutput = undefined;
            try {
                s.pty?.kill();
            } catch {
                /* ignore */
            }
        }
        this.sessions.clear();
        this.taps.clear();
        this.privateOutputQueues.clear();
    }

    // ---- Agent consoles (PTY-less, read-only): mirror an agent's run as a terminal ----

    /** Register a PTY-less console that surfaces an agent run as a read-only terminal session. */
    createAgentConsole(opts: { id: string; agentId: string; title: string; cwd?: string }): TerminalSessionMeta {
        const meta: TerminalSessionMeta = {
            id: opts.id,
            title: opts.title,
            shell: "agent",
            cwd: opts.cwd ?? "",
            agentId: opts.agentId,
            kind: "agent",
            readOnly: true,
            status: "running",
            cols: 80,
            rows: 24,
            createdAt: Date.now(),
        };
        this.sessions.set(opts.id, { meta, outputReplay: "" });
        return meta;
    }

    /** Stream text into a console (or any session) through the same broadcast path as PTY data. */
    writeAgent(id: string, data: string): void {
        if (this.sessions.has(id)) this.emitData(id, data);
    }

    /** Update a console's status without removing it (so it stays visible as running/exited). */
    setConsoleStatus(id: string, status: "running" | "exited"): void {
        const s = this.sessions.get(id);
        if (s) s.meta.status = status;
    }

    has(id: string): boolean {
        return this.sessions.has(id);
    }
}
