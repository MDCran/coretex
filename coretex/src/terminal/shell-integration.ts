// Coretex — shell integration for live PTY sessions. We inject a small startup
// snippet into each spawned shell that emits the standard OSC 133 "FinalTerm"
// semantic-prompt markers around the prompt + command, plus OSC 7 for the cwd:
//
//   OSC 133 ; A ST   — prompt start
//   OSC 133 ; B ST   — prompt end / command-input start
//   OSC 133 ; C ST   — command pre-exec (output start)
//   OSC 133 ; D ; <exit> ST — command finished (with exit code)
//   OSC 7 ; file://<host><path> ST — current working directory
//
// xterm.js renders unknown/handled OSC as nothing, so the markers are invisible
// in the rendered terminal. The Brain parses the SAME stream (out-of-band, after
// the raw passthrough) to maintain a per-session block model: the current command
// line, the cwd, and completed CommandBlocks (command + output + exit code).
//
// When integration can't be injected (cmd.exe, unknown shells) we fall back to a
// heuristic: track bytes typed since the last prompt as the command line and
// follow `cd`. Ordinary terminal:data remains byte-for-byte; only Brain-injected
// marker-wrapped transactions are suppressed from the renderer by the manager.

import os from "node:os";
import type { BuddyShellKind } from "./buddy-exec.js";
import type { CommandBlock, SessionShellInfo } from "../types.js";

const ST = "\\007"; // BEL terminator (shell-escaped form used inside snippets)

/** OS family for SessionShellInfo. */
export function osFamily(): "windows" | "macos" | "linux" | "unknown" {
    const p = os.platform();
    if (p === "win32") return "windows";
    if (p === "darwin") return "macos";
    if (p === "linux") return "linux";
    return "unknown";
}

/**
 * The shell-integration startup snippet for a given shell kind, written to the PTY
 * once right after spawn. Returns "" when the shell can't be integrated (cmd/unknown).
 *
 * Each snippet:
 *  - prints OSC 133;A at prompt start, OSC 133;B at prompt end (PS1/prompt),
 *  - prints OSC 133;C just before a command runs + OSC 133;D;<exit> after,
 *  - prints OSC 7 with the cwd at every prompt.
 * The command text itself is delivered via OSC 633;E (VS Code convention) so the
 * Brain learns the command without depending on local echo parsing.
 */
export function integrationSnippet(kind: BuddyShellKind): string {
    switch (kind) {
        case "bash":
        case "sh":
            // PROMPT_COMMAND emits A + cwd(7); PS0 (bash 4.4+) marks exec start C;
            // a DEBUG/PROMPT pairing reports the previous exit via D. We keep it
            // resilient on plain sh (no PS0) by emitting C from the DEBUG trap.
            return [
                `__ctx_osc7() { printf '\\033]7;file://%s%s${ST}' "$HOSTNAME" "$PWD"; }`,
                `__ctx_pre() { printf '\\033]133;C${ST}'; }`,
                `__ctx_prompt() { local e=$?; printf '\\033]133;D;%s${ST}' "$e"; __ctx_osc7; printf '\\033]133;A${ST}'; }`,
                `PS1='\\[$(printf "\\033]133;B${ST}")\\]'"$PS1"`,
                `case "$PROMPT_COMMAND" in *__ctx_prompt*) ;; *) PROMPT_COMMAND="__ctx_prompt;$PROMPT_COMMAND" ;; esac`,
                `trap '__ctx_pre' DEBUG`,
                ``,
            ].join("\n");
        case "zsh":
            return [
                `__ctx_osc7() { printf '\\033]7;file://%s%s${ST}' "$HOST" "$PWD"; }`,
                `precmd_functions+=(__ctx_precmd)`,
                `__ctx_precmd() { local e=$?; printf '\\033]133;D;%s${ST}' "$e"; __ctx_osc7; printf '\\033]133;A${ST}'; }`,
                `preexec_functions+=(__ctx_preexec)`,
                `__ctx_preexec() { printf '\\033]133;C${ST}'; }`,
                `PS1='%{$(printf "\\033]133;B${ST}")%}'"$PS1"`,
                ``,
            ].join("\n");
        case "fish":
            return [
                `function __ctx_osc7 --on-event fish_prompt; printf '\\033]7;file://%s%s${ST}' (hostname) "$PWD"; end`,
                `function __ctx_prompt --on-event fish_prompt; printf '\\033]133;D;%s${ST}' $status; printf '\\033]133;A${ST}'; end`,
                `function __ctx_preexec --on-event fish_preexec; printf '\\033]133;C${ST}'; end`,
                `functions -c fish_prompt __ctx_orig_prompt 2>/dev/null; function fish_prompt; printf '\\033]133;B${ST}'; __ctx_orig_prompt; end`,
                ``,
            ].join("\n");
        case "powershell":
            // Wrap the existing prompt function. [char]27/[char]7 → real ESC/BEL.
            // $? captures the previous command's success; map to 0/1 for the D marker.
            // MUST be single-line statements: a multi-line `function prompt {` block
            // sent over a PTY puts PowerShell into ">>" continuation mode, which
            // corrupts the session (and any concurrent capture). Each line here is a
            // complete statement, so no continuation prompt is ever entered.
            return [
                `if (-not (Test-Path function:__ctxOrigPrompt)) { Copy-Item function:prompt function:__ctxOrigPrompt -ErrorAction SilentlyContinue }`,
                `function prompt { $e = if ($?) { 0 } else { 1 }; $o = [char]27; $b = [char]7; [Console]::Write("$o]133;D;$e$b"); $p = ($PWD.ProviderPath -replace '\\\\','/'); [Console]::Write("$o]7;file://$env:COMPUTERNAME/$p$b"); [Console]::Write("$o]133;A$b"); $r = if (Test-Path function:__ctxOrigPrompt) { & __ctxOrigPrompt } else { "PS $($PWD.Path)> " }; [Console]::Write("$o]133;B$b"); return $r }`,
                ``,
            ].join("\n");
        // cmd.exe and unknown shells can't reliably emit ESC OSC markers — heuristic fallback only.
        default:
            return "";
    }
}

/** A quietly-run probe command that prints a version/OS line we parse for SessionShellInfo. */
export function probeCommand(kind: BuddyShellKind): string | null {
    switch (kind) {
        case "bash":
        case "sh":
            return `printf '\\033]7338;ver=%s;os=%s${ST}' "$BASH_VERSION" "$(uname -sr 2>/dev/null)"`;
        case "zsh":
            return `printf '\\033]7338;ver=%s;os=%s${ST}' "$ZSH_VERSION" "$(uname -sr 2>/dev/null)"`;
        case "fish":
            return `printf '\\033]7338;ver=%s;os=%s${ST}' "$FISH_VERSION" (uname -sr 2>/dev/null)`;
        case "powershell":
            return `$o=[char]27;$b=[char]7;[Console]::Write("$o]7338;ver=$($PSVersionTable.PSVersion.ToString());os=$([System.Environment]::OSVersion.VersionString)$b")`;
        default:
            return null;
    }
}

const VER_RE = /\x1b\]7338;ver=([^;]*);os=([^\x07\x1b]*)(?:\x07|\x1b\\)/;
const OSC7_RE = /\x1b\]7;file:\/\/[^/]*(\/[^\x07\x1b]*)(?:\x07|\x1b\\)/;
// OSC 133 markers: A=prompt-start B=prompt-end C=cmd-exec D[;exit]=cmd-end E;<cmd>=cmd-line
const OSC133_RE = /\x1b\]133;([A-D])(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/g;
const OSC633E_RE = /\x1b\]633;E;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

/** Decode a file:// path captured from OSC 7 into a local path (handles Windows drive form). */
function decodeOsc7Path(p: string): string {
    let out = p;
    try {
        out = decodeURIComponent(p);
    } catch {
        /* leave as-is on malformed escapes */
    }
    // /C:/Users/... → C:/Users/...   (Windows OSC 7 leading-slash form)
    if (/^\/[A-Za-z]:/.test(out)) out = out.slice(1);
    return out;
}

/** Strip ANSI/OSC noise + control chars from captured command output for storage. */
function cleanOutput(s: string): string {
    return s
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC sequences
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI sequences
        .replace(/\x1b[@-Z\\-_]/g, "") // other two-char escapes
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "")
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
        .replace(/^\n+|\n+$/g, "");
}

const MAX_OUTPUT = 256 * 1024;

/**
 * Per-session shell-integration parser. Feed it the raw PTY chunks (same bytes
 * the Relay renders); it maintains the current cwd, the in-flight command, and
 * emits a completed CommandBlock whenever a command finishes. Tolerates the
 * heuristic fallback (no markers) by tracking typed input + following `cd`.
 */
export class ShellIntegrationParser {
    private buffer = "";
    private cwd: string;
    private readonly sessionId: string;
    private readonly kind: BuddyShellKind;
    private readonly integrated: boolean;

    // Block state.
    private phase: "idle" | "prompt" | "input" | "exec" = "idle";
    private commandLine = "";
    private execOutput = "";
    private startedAt = 0;
    private sawAnyMarker = false;

    // Heuristic fallback (no OSC 133): accumulate typed input since the prompt.
    private typed = "";

    constructor(opts: { sessionId: string; kind: BuddyShellKind; cwd: string; integrated: boolean }) {
        this.sessionId = opts.sessionId;
        this.kind = opts.kind;
        this.cwd = opts.cwd;
        this.integrated = opts.integrated;
    }

    getCwd(): string {
        return this.cwd;
    }

    /** True once we've actually observed integration markers (block model reliable). */
    get reliable(): boolean {
        return this.sawAnyMarker;
    }

    /** Record bytes the user typed. Drives the heuristic cwd-follow AND supplies the
     *  command text for the block model — the OSC 133 integration emits no 633;E, so
     *  without this the D marker has no command to attach and no block is produced. */
    onInput(data: string): void {
        for (const ch of data) {
            if (ch === "\r" || ch === "\n") {
                const cmd = this.typed.trim();
                this.typed = "";
                // Skip the Terminal Buddy's own marker-wrapped commands so they don't
                // pollute the block model (the buddy surfaces its own step cards).
                if (cmd && !cmd.includes("CTXB") && !cmd.includes("]7337")) {
                    // The just-submitted line is the command the next C…D block runs.
                    this.commandLine = cmd;
                    this.heuristicCommand(cmd);
                }
            } else if (ch === "\x7f" || ch === "\b") {
                this.typed = this.typed.slice(0, -1);
            } else if (ch >= " ") {
                this.typed += ch;
            }
        }
    }

    private heuristicCommand(cmd: string): void {
        // Follow `cd` so cwd tracking still works without OSC 7.
        const m = /^cd\s+(.+)$/.exec(cmd);
        if (m) {
            const target = m[1].trim().replace(/^["']|["']$/g, "");
            if (target) this.cwd = target;
        }
    }

    /**
     * Feed a raw output chunk. Returns any version-probe info parsed from it and
     * the list of CommandBlocks that completed in this chunk (plus the live state).
     */
    feed(chunk: string): {
        shellInfo?: Pick<SessionShellInfo, "version" | "os">;
        blocks: CommandBlock[];
        cwdChanged: boolean;
    } {
        this.buffer += chunk;
        // Bound the buffer so a marker-less stream can't grow unbounded.
        if (this.buffer.length > MAX_OUTPUT * 2) this.buffer = this.buffer.slice(-MAX_OUTPUT);

        const blocks: CommandBlock[] = [];
        let cwdChanged = false;
        let shellInfo: Pick<SessionShellInfo, "version" | "os"> | undefined;

        // Version probe (one-shot at startup).
        const vm = VER_RE.exec(this.buffer);
        if (vm) {
            shellInfo = { version: (vm[1] || "").trim() || undefined, os: (vm[2] || "").trim() || osFamily() };
            this.buffer = this.buffer.replace(VER_RE, "");
        }

        // OSC 7 cwd updates.
        let m7: RegExpExecArray | null;
        OSC7_RE.lastIndex = 0;
        while ((m7 = OSC7_RE.exec(this.buffer)) !== null) {
            const next = decodeOsc7Path(m7[1]);
            if (next && next !== this.cwd) {
                this.cwd = next;
                cwdChanged = true;
            }
        }

        // OSC 633;E command-line announcements (when the shell reports the command text).
        let mE: RegExpExecArray | null;
        OSC633E_RE.lastIndex = 0;
        while ((mE = OSC633E_RE.exec(this.buffer)) !== null) {
            this.commandLine = (mE[1] || "").trim();
        }

        // OSC 133 semantic markers drive the block model.
        let m: RegExpExecArray | null;
        OSC133_RE.lastIndex = 0;
        let lastIndex = 0;
        while ((m = OSC133_RE.exec(this.buffer)) !== null) {
            this.sawAnyMarker = true;
            const marker = m[1];
            // Accumulate any output that appeared before this marker while executing.
            if (this.phase === "exec") {
                this.execOutput += this.buffer.slice(lastIndex, m.index);
                if (this.execOutput.length > MAX_OUTPUT) this.execOutput = this.execOutput.slice(-MAX_OUTPUT);
            }
            lastIndex = m.index + m[0].length;

            if (marker === "A") {
                this.phase = "prompt";
            } else if (marker === "B") {
                this.phase = "input";
                this.commandLine = "";
                this.typed = "";
            } else if (marker === "C") {
                this.phase = "exec";
                this.execOutput = "";
                this.startedAt = Date.now();
            } else if (marker === "D") {
                const exit = m[2] !== undefined && m[2] !== "" ? Number(m[2]) : undefined;
                if (this.phase === "exec" || this.commandLine) {
                    const cmd = this.commandLine.trim();
                    if (cmd) {
                        blocks.push({
                            sessionId: this.sessionId,
                            command: cmd,
                            output: cleanOutput(this.execOutput),
                            exitCode: Number.isFinite(exit) ? exit : undefined,
                            startedAt: this.startedAt || Date.now(),
                            endedAt: Date.now(),
                            cwd: this.cwd,
                        });
                    }
                }
                this.execOutput = "";
                this.commandLine = "";
                this.phase = "idle";
            }
        }

        // Keep only the post-last-marker tail in the buffer; if executing, retain it as output.
        if (lastIndex > 0) {
            const tail = this.buffer.slice(lastIndex);
            if (this.phase === "exec") {
                this.execOutput += tail;
                if (this.execOutput.length > MAX_OUTPUT) this.execOutput = this.execOutput.slice(-MAX_OUTPUT);
                this.buffer = "";
            } else {
                this.buffer = tail.length > MAX_OUTPUT ? tail.slice(-MAX_OUTPUT) : tail;
            }
        }

        return { shellInfo, blocks, cwdChanged };
    }
}
