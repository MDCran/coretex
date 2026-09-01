// Coretex — Terminal Buddy block-capture. The buddy writes a command into the
// SAME live PTY the user sees, then reads that command's stdout + exit code back
// out of the broadcast stream. We bracket the command with private OSC sentinels
// (ESC ]7337;CTXB;<token>;S BEL … ESC ]7337;CTXB;<token>;E;<exit> BEL) which
// xterm.js renders as nothing (unknown OSC) but the Brain can parse. The terminal
// manager also suppresses the marker-wrapped transaction from terminal:data: probe
// internals stay silent, and Terminal Buddy commands/results are surfaced by its
// live step cards instead of leaking the capture wrapper into the shell buffer.
//
// THE ECHO TRAP: a PTY echoes the typed line, so the echoed input would itself
// contain the marker bytes and trip the parser early. We dodge it by emitting the
// ESC/BEL through the shell's OWN escape syntax — printf '\033…\007' (POSIX) or
// [char]27/[char]7 (PowerShell). The echoed text then holds the literal source
// (backslash-zero-three-three / "[char]27"), never a real ESC byte, so only the
// EXECUTED marker matches /\x1b…\x07/. cmd/unknown shells fall back to visible
// text markers (cmd can't emit ESC) which we strip from the captured output.

import { randomBytes } from "node:crypto";
import type { TerminalManager } from "./manager.js";

export type BuddyShellKind = "bash" | "zsh" | "fish" | "sh" | "powershell" | "cmd" | "unknown";

/** POSIX-family shells share the printf marker + `$?`/`$status` exit convention. */
function isPosix(kind: BuddyShellKind): boolean {
    return kind === "bash" || kind === "zsh" || kind === "sh" || kind === "fish";
}

/** Map a shell path/command to a known kind. */
export function detectShellKind(shell: string | undefined): BuddyShellKind {
    if (!shell) return "unknown";
    const base = shell
        .replace(/\\/g, "/")
        .split("/")
        .pop()!
        .replace(/\.exe$/i, "")
        .toLowerCase();
    if (base === "powershell" || base === "pwsh") return "powershell";
    if (base === "bash" || base === "git-bash") return "bash";
    if (base === "zsh") return "zsh";
    if (base === "fish") return "fish";
    if (base === "sh" || base === "dash" || base === "ash") return "sh";
    if (base === "cmd") return "cmd";
    // A bare "wsl" or login shell often runs bash inside.
    if (base === "wsl") return "bash";
    return "unknown";
}

function newToken(): string {
    // This token is a transaction boundary in a shared PTY stream. It must be
    // unpredictable so terminal output cannot guess and forge an early marker.
    return `b${randomBytes(16).toString("hex")}`;
}

/** Wrap a command so its stdout + exit code are bracketed by sentinels for capture. */
function wrapCommand(kind: BuddyShellKind, token: string, command: string): string {
    if (kind === "powershell") {
        // [char]27/[char]7 → real ESC/BEL only after evaluation; echoed line stays literal.
        return (
            `$o=[char]27;$b=[char]7;` +
            `[Console]::Write("$o]7337;CTXB;${token};S$b");` +
            `${command};` +
            `$ok=$?;$ec=$LASTEXITCODE;if($ok){$ec=0}elseif($null -eq $ec){$ec=1};` +
            `[Console]::Write("$o]7337;CTXB;${token};E;$ec$b")`
        );
    }
    if (kind === "fish") {
        return (
            `printf '\\033]7337;CTXB;${token};S\\007'; ` +
            `${command}; set __ctx $status; ` +
            `printf '\\033]7337;CTXB;${token};E;%s\\007' $__ctx`
        );
    }
    if (isPosix(kind)) {
        // printf interprets \033/\007 → ESC/BEL; the echoed line holds the literal source.
        return (
            `printf '\\033]7337;CTXB;${token};S\\007'; ` +
            `${command}; __ctx=$?; ` +
            `printf '\\033]7337;CTXB;${token};E;%s\\007' "$__ctx"`
        );
    }
    // cmd.exe / unknown — visible text markers; `call echo` re-expands errorlevel
    // AFTER the command runs (a plain %errorlevel% would expand at parse time).
    return `echo __CTXB_S_${token}__& ${command} & call echo __CTXB_E_${token}_%^errorlevel%__`;
}

/** Strip ANSI CSI/OSC control sequences + stray carriage returns for readable output. */
function cleanOutput(s: string): string {
    return s
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI sequences
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC sequences (BEL or ST terminated)
        .replace(/\x1b[@-Z\\-_]/g, "") // other two-char escapes
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "")
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "") // remaining control chars (keep \t \n)
        .trim();
}

export interface CaptureResult {
    stdout: string;
    exitCode: number | null;
    timedOut: boolean;
}

/** Extract the captured region from a buffer, or null if the end marker isn't present yet. */
function parse(buffer: string, kind: BuddyShellKind, token: string): { stdout: string; exitCode: number | null } | null {
    if (isPosix(kind) || kind === "powershell") {
        // Real OSC markers. Terminator is BEL (\x07); accept ST (\x1b\\) too.
        const start = new RegExp(`\\x1b\\]7337;CTXB;${token};S(?:\\x07|\\x1b\\\\)`);
        const end = new RegExp(`\\x1b\\]7337;CTXB;${token};E;(-?\\d+)(?:\\x07|\\x1b\\\\)`);
        const sm = start.exec(buffer);
        if (!sm) return null;
        const after = buffer.slice(sm.index + sm[0].length);
        const em = end.exec(after);
        if (!em) return null;
        return { stdout: cleanOutput(after.slice(0, em.index)), exitCode: Number(em[1]) };
    }
    // Visible text markers (cmd/unknown). The echoed command line may contain the
    // markers too, so take the content after the LAST start marker.
    const startTok = `__CTXB_S_${token}__`;
    const end = new RegExp(`__CTXB_E_${token}_(-?\\d+)__`);
    const lastStart = buffer.lastIndexOf(startTok);
    if (lastStart < 0) return null;
    const after = buffer.slice(lastStart + startTok.length);
    const em = end.exec(after);
    if (!em) return null;
    return { stdout: cleanOutput(after.slice(0, em.index)), exitCode: Number(em[1]) };
}

const MAX_BUFFER = 1024 * 1024;
const HEAD_KEEP = 4096;
const DEFAULT_TIMEOUT = 60_000;

/** Index of the (real) start marker in the buffer, or -1. */
function startMarkerIndex(buffer: string, kind: BuddyShellKind, token: string): number {
    if (isPosix(kind) || kind === "powershell") {
        const m = new RegExp(`\\x1b\\]7337;CTXB;${token};S(?:\\x07|\\x1b\\\\)`).exec(buffer);
        return m ? m.index : -1;
    }
    return buffer.lastIndexOf(`__CTXB_S_${token}__`);
}

/**
 * Run `command` in the live PTY `sessionId` and resolve with its captured stdout
 * + exit code. Never rejects — a timeout resolves with whatever was captured and
 * `timedOut: true`. An aborted signal resolves immediately with timedOut.
 */
export function runCaptured(
    manager: TerminalManager,
    sessionId: string,
    kind: BuddyShellKind,
    command: string,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<CaptureResult> {
    const token = newToken();
    return manager.runPrivateOutput(sessionId, token, (write, privateSignal) => new Promise<CaptureResult>((resolve) => {
        let buffer = "";
        let done = false;

        const finish = (result: CaptureResult): void => {
            if (done) return;
            done = true;
            untap();
            clearTimeout(timer);
            opts?.signal?.removeEventListener("abort", onAbort);
            privateSignal.removeEventListener("abort", onAbort);
            resolve(result);
        };

        const onChunk = (data: string): void => {
            buffer += data;
            // Parse BEFORE truncating so a complete capture is never lost to the cap.
            const parsed = parse(buffer, kind, token);
            if (parsed) {
                finish({ stdout: parsed.stdout, exitCode: parsed.exitCode, timedOut: false });
                return;
            }
            // Bound memory WITHOUT discarding the start marker (dropping it would make
            // parse() never match → a false 120s timeout). Keep the marker head + the
            // recent tail (where the end marker lands); only the large middle is shed.
            if (buffer.length > MAX_BUFFER) {
                const si = startMarkerIndex(buffer, kind, token);
                if (si > 0) {
                    const head = buffer.slice(si, si + HEAD_KEEP);
                    const tail = buffer.slice(-(MAX_BUFFER - HEAD_KEEP));
                    buffer = head + tail;
                } else {
                    buffer = buffer.slice(-MAX_BUFFER);
                }
            }
        };

        const onAbort = (): void => {
            const parsed = parse(buffer, kind, token);
            finish({ stdout: parsed?.stdout ?? cleanOutput(buffer), exitCode: parsed?.exitCode ?? null, timedOut: true });
        };

        const untap = manager.tap(sessionId, onChunk);
        const timer = setTimeout(() => {
            const parsed = parse(buffer, kind, token);
            finish({ stdout: parsed?.stdout ?? cleanOutput(buffer), exitCode: parsed?.exitCode ?? null, timedOut: true });
        }, opts?.timeoutMs ?? DEFAULT_TIMEOUT);

        if (opts?.signal) {
            if (opts.signal.aborted) {
                onAbort();
                return;
            }
            opts.signal.addEventListener("abort", onAbort, { once: true });
        }
        if (privateSignal.aborted) {
            onAbort();
            return;
        }
        privateSignal.addEventListener("abort", onAbort, { once: true });

        // Carriage return submits the line to the PTY's line discipline. The raw
        // writer deliberately bypasses TerminalManager.input(): this is Brain
        // traffic, not user input, and must not enter the command-block heuristic.
        write(wrapCommand(kind, token, command) + "\r");
    })).catch((): CaptureResult => ({ stdout: "", exitCode: null, timedOut: true }));
}
