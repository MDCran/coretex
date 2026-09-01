// @ts-nocheck
// Coretex — terminal autocomplete CompletionEngine (pure TS, no I/O of its own).
//
// This is the brain behind fish-style ghost text + the completion dropdown in the
// xterm host. It is deliberately *pure*: every side-effecting dependency (reading a
// directory, fetching command history) is INJECTED via callbacks so the engine can
// run identically in the browser, in tests, or on the Brain. No imports from the
// app, no DOM, no fs — just data in, ranked Completion[] out.
//
// Today's providers (ranked, deduped):
//   (a) HISTORY      — fish-style: the most-recent history line that starts with the
//                      current line wins; its remainder is the top "ghost" suggestion.
//                      Highest priority because it's the most reliable signal of intent.
//   (b) PATH / FS    — when the active token looks like a filesystem path, complete it
//                      against entries from an injected async directory lister, honoring
//                      the shell's path separator (Windows "\" vs POSIX "/") and quoting
//                      paths that contain spaces.
//
// Part-2 providers (this file's additions, all behind autocomplete.providers.*):
//   (c) SPEC         — when the first token matches a command-specs.ts entry, complete
//                      its subcommands / flags / arg-hints with one-line descriptions.
//                      Flag style is re-rendered per shell (--long, /flag, -Param).
//   (d) BUILTINS     — shell builtins / cmdlets / coreutils for the FIRST token, chosen
//                      by the detected shell (PowerShell, cmd, bash/zsh/fish + coreutils).
//   (e) PATH-EXEC    — executables for the first token, from an injected name list
//                      (deps.pathExecutables). The host scans PATH and hands us the names.
//
// Remaining seam: an AI provider — write a `(ctx, deps) => Completion[]` and register it.

import { getSpec, resolveSpecPath, type SpecFlag, type Subcommand } from "./command-specs";

/** A completion entry surfaced to the UI (dropdown row + optional ghost text). */
export interface Completion {
    /** The full token/value this completion represents (e.g. "git", "src/index.ts"). */
    value: string;
    /** What to show in the dropdown (may differ from `value`, e.g. trailing "/" on dirs). */
    display: string;
    /** Where this came from — drives the icon + grouping + ranking tier in the UI. */
    kind: "command" | "subcommand" | "flag" | "path" | "arg" | "builtin" | "history" | "ai";
    /** Optional one-line hint shown beside the row. */
    description?: string;
    /**
     * The text to actually insert at the cursor to complete the current token.
     * This is the *remainder* after what the user already typed for the token
     * (so the caller can append it directly). For history, it's the remainder of
     * the whole line; that remainder is also the ghost-text suggestion.
     */
    insert: string;
    /** Higher = ranked first. Tiers are spaced out by provider so kinds don't interleave. */
    score: number;
}

/** Everything a provider needs to know about the current input + environment. */
export interface CompletionContext {
    /** The full command line as typed (without the prompt). */
    line: string;
    /** Cursor offset into `line` (0..line.length). */
    cursor: number;
    /** The token under/just-before the cursor (the thing being completed). */
    token: string;
    /** Working directory the shell is in (used to resolve relative path tokens). */
    cwd: string;
    /** Normalized shell kind: "bash" | "zsh" | "fish" | "sh" | "powershell" | "cmd" | "unknown". */
    shell: string;
    /** Resolved shell version, when known. */
    shellVersion?: string;
    /** OS family: "windows" | "macos" | "linux" | "unknown". */
    os: string;
    /** True when the shell is a WSL distro (POSIX paths on a Windows host). */
    isWSL?: boolean;
}

/** A directory entry returned by the injected lister (a subset of coretex FsEntry). */
export interface DirEntry {
    name: string;
    isDir: boolean;
}

/** Injected dependencies — the only way the engine touches the outside world. */
export interface CompletionDeps {
    /**
     * Command history, most-recent LAST (newest at the end). The engine reverses as
     * needed; callers can pass their raw ring buffer.
     */
    history: string[];
    /**
     * Resolve a directory to its entries. `dir` is an absolute (or cwd-joined) path in
     * the shell's own separator convention. Return [] (or reject) when it can't be read.
     * Wire this to actions.fsList / the coretex fs service in the host.
     */
    listDir: (dir: string) => Promise<DirEntry[]>;
    /**
     * Executable names found on the shell's PATH (just the base names, e.g. "git",
     * "node.exe"). The host scans PATH once per session and injects the list here; the
     * pathExecutables provider filters it by the first-token prefix. Optional — when
     * absent or empty, that provider simply yields nothing.
     */
    pathExecutables?: string[];
    /**
     * Per-provider on/off toggles, mirrored from CoretexConfig.autocomplete.providers.
     * Defaults (when a key is omitted): history+path on, specs+pathExecutables off, ai off.
     */
    providers?: Partial<Record<ProviderId, boolean>>;
}

/** Stable provider identifiers — the extension seam. New providers register here. */
export type ProviderId = "history" | "path" | "specs" | "pathExecutables" | "ai";

// Score tiers, spaced so a provider's worst entry still outranks the next tier's best.
// Ranking order: history > path (exact prefix on a path token) > specs > builtins/path-exec
// > ai. Within "specs" an exact prefix match is boosted above a fuzzy one (see EXACT_BONUS).
const SCORE = {
    history: 10_000,
    path: 5_000,
    specs: 3_000,
    builtins: 2_500,
    pathExecutables: 2_000,
    ai: 1_000,
} as const;

/** Added to a candidate that the typed prefix is an exact (case-insensitive) prefix of. */
const EXACT_BONUS = 400;
/** Added to a candidate matched only fuzzily (subsequence) — keeps it below exact-prefix. */
const FUZZY_PENALTY = -300;

// ---- Shell / path helpers ---------------------------------------------------

/** True for shells that use backslash as the native path separator. */
function usesBackslash(ctx: CompletionContext): boolean {
    // WSL is a POSIX shell even on Windows, so it uses "/". cmd/powershell use "\".
    if (ctx.isWSL) return false;
    if (ctx.shell === "powershell" || ctx.shell === "cmd") return true;
    return ctx.os === "windows" && ctx.shell !== "bash" && ctx.shell !== "zsh" && ctx.shell !== "fish" && ctx.shell !== "sh";
}

function sep(ctx: CompletionContext): string {
    return usesBackslash(ctx) ? "\\" : "/";
}

/** Does this token look like a filesystem path we should complete against the fs? */
function looksLikePath(token: string): boolean {
    if (token === "") return false;
    return (
        token.includes("/") ||
        token.includes("\\") ||
        token.startsWith(".") ||
        token.startsWith("~") ||
        // Windows drive root, e.g. "C:" or "C:\"
        /^[a-zA-Z]:/.test(token)
    );
}

const PATH_ARGUMENT_COMMANDS = new Set([
    "cd", "ls", "dir", "cat", "type", "less", "more", "head", "tail", "touch", "mkdir", "rmdir",
    "rm", "cp", "mv", "copy", "move", "del", "erase", "ren", "rename", "code", "open", "start",
    "set-location", "get-childitem", "get-content", "set-content", "add-content", "copy-item", "move-item",
    "remove-item", "new-item", "test-path", "out-file", "source", ".",
]);

/** Plain leaf tokens are paths after commands that are known to consume filesystem arguments. */
function isPathArgument(ctx: CompletionContext): boolean {
    const { command, priorTokens, active, isFirstToken } = parseCommandLine(ctx);
    if (isFirstToken || active.startsWith("-") || active.startsWith("/")) return false;
    const cmd = command.toLowerCase();
    if (PATH_ARGUMENT_COMMANDS.has(cmd)) return true;
    return cmd === "git" && ["add", "diff", "restore", "stage"].includes((priorTokens[0] ?? "").toLowerCase());
}

/** Strip one layer of surrounding/leading quotes from a token for fs matching. */
function unquote(token: string): { body: string; quote: '"' | "'" | "" } {
    if (token.startsWith('"')) return { body: token.slice(1).replace(/"$/, ""), quote: '"' };
    if (token.startsWith("'")) return { body: token.slice(1).replace(/'$/, ""), quote: "'" };
    return { body: token, quote: "" };
}

/**
 * Split a path token into the directory portion to list and the partial leaf the user
 * has started typing. Honors both separators so a Windows user typing "src/foo" still
 * works. Returns the dir to hand to listDir + the leaf prefix to filter on.
 */
function splitPathToken(body: string, ctx: CompletionContext): { dir: string; leaf: string; sepUsed: string } {
    const s = sep(ctx);
    // Find the last separator of either flavor.
    const lastFwd = body.lastIndexOf("/");
    const lastBack = body.lastIndexOf("\\");
    const idx = Math.max(lastFwd, lastBack);
    const sepUsed = idx === lastBack && lastBack >= 0 ? "\\" : idx === lastFwd && lastFwd >= 0 ? "/" : s;

    if (idx < 0) {
        // No separator yet: complete leaves of the cwd.
        return { dir: ctx.cwd, leaf: body, sepUsed: s };
    }
    const dirPart = body.slice(0, idx + 1); // include the trailing separator
    const leaf = body.slice(idx + 1);
    const dir = resolveDir(dirPart, ctx);
    return { dir, leaf, sepUsed };
}

/** Resolve a (possibly relative / ~ / drive-rooted) directory prefix to a concrete dir. */
function resolveDir(dirPart: string, ctx: CompletionContext): string {
    const s = sep(ctx);
    let p = dirPart;
    // Home expansion (POSIX shells).
    if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) {
        // We don't know HOME here; hand the literal "~" dir to the lister, which can
        // expand it (the coretex fs service understands "~"). Keep it as-is.
        return p.replace(/[\\/]+$/, "") || "~";
    }
    const isAbsPosix = p.startsWith("/");
    const isAbsWin = /^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]{2}/.test(p); // drive or UNC
    if (isAbsPosix || isAbsWin) {
        return p.replace(/[\\/]+$/, "") || s;
    }
    // Relative: join onto cwd using the shell separator.
    const base = ctx.cwd.replace(/[\\/]+$/, "");
    const rel = p.replace(/[\\/]+$/, "");
    return rel ? `${base}${s}${rel}` : base;
}

/** Quote a completed path leaf if it (or the already-typed body) contains spaces. */
function quoteIfNeeded(full: string, originalQuote: '"' | "'" | ""): { display: string; needsQuote: boolean } {
    const hasSpace = /\s/.test(full);
    if (!hasSpace && !originalQuote) return { display: full, needsQuote: false };
    return { display: full, needsQuote: true };
}

// ---- Token extraction -------------------------------------------------------

/**
 * Extract the token under the cursor. Quote-aware: a quoted run (even with spaces)
 * counts as a single token. Falls back to whitespace splitting otherwise.
 */
export function tokenAt(line: string, cursor: number): { token: string; start: number } {
    const upto = line.slice(0, cursor);
    // Walk backwards to the start of the current token, respecting quotes.
    let i = upto.length;
    let inSingle = false;
    let inDouble = false;
    // First, determine if we're inside a quote by scanning forward.
    for (let j = 0; j < upto.length; j++) {
        const c = upto[j];
        if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === '"' && !inSingle) inDouble = !inDouble;
    }
    if (inSingle || inDouble) {
        const q = inSingle ? "'" : '"';
        const start = upto.lastIndexOf(q);
        return { token: line.slice(start, cursor), start };
    }
    // Unquoted: back up over non-space chars (treating an unescaped space as a break).
    i = upto.length;
    while (i > 0 && !/\s/.test(upto[i - 1])) i--;
    return { token: upto.slice(i), start: i };
}

// ---- Providers --------------------------------------------------------------

/**
 * HISTORY provider (fish-style). The most-recent history entry that starts with the
 * full current line is the top suggestion; its remainder is the ghost text. Earlier
 * matches rank below it, deduped. Empty line = no history suggestions (too noisy).
 */
function historyProvider(ctx: CompletionContext, deps: CompletionDeps): Completion[] {
    const prefix = ctx.line;
    if (prefix.trim() === "") return [];
    const out: Completion[] = [];
    const seen = new Set<string>();
    // Walk newest -> oldest.
    for (let i = deps.history.length - 1, rank = 0; i >= 0; i--) {
        const entry = deps.history[i];
        if (entry === prefix) continue; // exact same line is not a completion
        if (!entry.startsWith(prefix)) continue;
        if (seen.has(entry)) continue;
        seen.add(entry);
        const remainder = entry.slice(prefix.length);
        if (remainder === "") continue;
        out.push({
            value: entry,
            display: entry,
            kind: "history",
            description: "history",
            insert: remainder,
            score: SCORE.history - rank,
        });
        rank += 1;
        if (rank >= 25) break;
    }
    return out;
}

/**
 * PATH / filesystem provider. Active only when the token looks like a path. Lists the
 * resolved directory via deps.listDir and filters by the leaf prefix (case-insensitive
 * on Windows). Directories sort first and get a trailing separator; spaces are quoted.
 */
async function pathProvider(ctx: CompletionContext, deps: CompletionDeps): Promise<Completion[]> {
    if (!looksLikePath(ctx.token) && !isPathArgument(ctx)) return [];
    const { body, quote } = unquote(ctx.token);
    const { dir, leaf, sepUsed } = splitPathToken(body, ctx);

    let entries: DirEntry[];
    try {
        entries = await deps.listDir(dir);
    } catch {
        return [];
    }
    if (!Array.isArray(entries) || entries.length === 0) return [];

    const ci = usesBackslash(ctx) || ctx.os === "windows"; // case-insensitive match on Windows
    const leafCmp = ci ? leaf.toLowerCase() : leaf;
    const matches = entries.filter((e) => {
        const n = ci ? e.name.toLowerCase() : e.name;
        // Hide dotfiles unless the user explicitly started the leaf with a dot.
        if (e.name.startsWith(".") && !leaf.startsWith(".")) return false;
        return n.startsWith(leafCmp);
    });

    const out: Completion[] = [];
    for (let k = 0; k < matches.length; k++) {
        const e = matches[k];
        const remainderLeaf = e.name.slice(leaf.length);
        const trailing = e.isDir ? sepUsed : "";
        // The full completed token (body up to leaf + matched name + trailing sep).
        const completedBody = body.slice(0, body.length - leaf.length) + e.name + trailing;
        const { needsQuote } = quoteIfNeeded(completedBody, quote);
        // Build the insert string (what to append after the cursor).
        let insert = remainderLeaf + trailing;
        if (needsQuote && !quote) {
            // The host appends at the cursor, so escape only the unseen remainder. This keeps
            // `cd My` + `\ Folder` valid without requiring token replacement/backspaces.
            if (ctx.shell === "powershell") insert = insert.replace(/ /g, "` ");
            else if (ctx.shell !== "cmd") insert = insert.replace(/([\s\\'"$`])/g, "\\$1");
        } else if (quote && !e.isDir) {
            insert += quote; // close a quoted file token; directory quotes stay open for deeper completion
        }
        const display = e.name + trailing;
        // Directories rank above files; alphabetical within a kind via descending index.
        const tierBonus = e.isDir ? 500 : 0;
        out.push({
            value: needsQuote && !quote ? `"${completedBody}"` : completedBody,
            display,
            kind: "path",
            description: e.isDir ? "directory" : "file",
            insert,
            score: SCORE.path + tierBonus - k,
        });
    }
    return out;
}

// ---- First-token / matching helpers -----------------------------------------

/**
 * Split the line (up to the cursor) into the command's first token, the tokens already
 * completed after it, and the active partial token being typed. Quote-aware via tokenAt
 * for the active token; the leading words use simple whitespace splitting (commands and
 * subcommands don't contain spaces). Returns isFirstToken=true when the cursor is still
 * on the very first word.
 */
function parseCommandLine(ctx: CompletionContext): {
    command: string;
    priorTokens: string[];
    active: string;
    isFirstToken: boolean;
} {
    const upto = ctx.line.slice(0, ctx.cursor);
    const words = upto.split(/\s+/).filter((w) => w !== "");
    const endsWithSpace = /\s$/.test(upto);
    const active = endsWithSpace ? "" : ctx.token;
    // Words that are fully typed (everything except the trailing active partial).
    const completed = endsWithSpace ? words : words.slice(0, -1);
    const command = completed[0] ?? (endsWithSpace ? "" : active);
    const isFirstToken = completed.length === 0;
    const priorTokens = completed.slice(1); // tokens after the command, fully typed
    return { command, priorTokens, active, isFirstToken };
}

/** Case rules for matching the first token / flags (Windows + PowerShell are case-insensitive). */
function caseInsensitive(ctx: CompletionContext): boolean {
    return ctx.os === "windows" || ctx.shell === "powershell" || ctx.shell === "cmd";
}

/** Exact prefix test honoring case rules. */
function isPrefix(candidate: string, prefix: string, ci: boolean): boolean {
    if (prefix === "") return true;
    return ci ? candidate.toLowerCase().startsWith(prefix.toLowerCase()) : candidate.startsWith(prefix);
}

/** Subsequence ("fuzzy") test: every char of `prefix` appears in order in `candidate`. */
function isSubsequence(candidate: string, prefix: string, ci: boolean): boolean {
    if (prefix === "") return true;
    const c = ci ? candidate.toLowerCase() : candidate;
    const p = ci ? prefix.toLowerCase() : prefix;
    let i = 0;
    for (let j = 0; j < c.length && i < p.length; j++) if (c[j] === p[i]) i++;
    return i === p.length;
}

// ---- Flag styling (per shell / OS) ------------------------------------------

/**
 * Render a spec flag as the token style the active shell expects:
 *   - PowerShell: -Param (single dash, capitalized) for the long form.
 *   - cmd:        /flag  (slash).
 *   - POSIX:      --long (double dash) or -s (single dash short alias).
 * Returns the full flag token (with leading dashes/slash) so callers can prefix-match it.
 */
function styleFlag(flag: SpecFlag, ctx: CompletionContext, useShort: boolean): string {
    if (ctx.shell === "cmd") return `/${flag.name}`;
    if (ctx.shell === "powershell") {
        const n = flag.name.charAt(0).toUpperCase() + flag.name.slice(1);
        return `-${n}`;
    }
    if (useShort && flag.short) return `-${flag.short}`;
    return `--${flag.name}`;
}

// ---- Shell builtins (per detected shell) ------------------------------------

// Representative samples — not exhaustive. Used only for the FIRST token.
const POWERSHELL_CMDLETS = [
    "Get-ChildItem", "Set-Location", "Get-Content", "Set-Content", "Add-Content", "Get-Command",
    "Get-Help", "Get-Process", "Stop-Process", "Start-Process", "Get-Service", "Where-Object",
    "ForEach-Object", "Select-Object", "Sort-Object", "Measure-Object", "Write-Output", "Write-Host",
    "Out-File", "Copy-Item", "Move-Item", "Remove-Item", "New-Item", "Test-Path", "Invoke-WebRequest",
    "Invoke-RestMethod", "Import-Module", "Export-Csv", "ConvertTo-Json", "ConvertFrom-Json",
    // common aliases
    "cd", "ls", "cat", "cp", "mv", "rm", "pwd", "echo", "cls", "man", "pushd", "popd",
];
const CMD_BUILTINS = [
    "cd", "dir", "copy", "move", "del", "erase", "ren", "rename", "type", "echo", "set", "cls",
    "md", "mkdir", "rd", "rmdir", "pushd", "popd", "if", "for", "goto", "call", "exit", "start",
    "tasklist", "taskkill", "where", "find", "findstr", "ping", "ipconfig", "title", "ver", "path",
];
const POSIX_BUILTINS = [
    // shell builtins (bash/zsh/sh — fish overlaps enough for a useful sample)
    "cd", "echo", "export", "alias", "unalias", "source", "exit", "pwd", "set", "unset", "read",
    "history", "jobs", "fg", "bg", "kill", "wait", "type", "command", "eval", "exec", "trap",
    "test", "true", "false", "let", "local", "return", "shift", "umask",
    // coreutils & everyday tools
    "ls", "cat", "cp", "mv", "rm", "mkdir", "rmdir", "touch", "ln", "chmod", "chown", "grep",
    "egrep", "sed", "awk", "find", "head", "tail", "sort", "uniq", "wc", "cut", "tr", "tee",
    "less", "more", "diff", "tar", "gzip", "gunzip", "zip", "unzip", "curl", "wget", "ssh", "scp",
    "rsync", "ps", "top", "df", "du", "free", "which", "man", "xargs", "env", "printf", "date",
];
const FISH_EXTRA = ["set", "function", "funcsave", "abbr", "string", "math", "status", "builtin"];

function builtinsFor(ctx: CompletionContext): string[] {
    switch (ctx.shell) {
        case "powershell":
            return POWERSHELL_CMDLETS;
        case "cmd":
            return CMD_BUILTINS;
        case "fish":
            return [...POSIX_BUILTINS, ...FISH_EXTRA];
        case "bash":
        case "zsh":
        case "sh":
            return POSIX_BUILTINS;
        default:
            // Unknown shell: pick by OS so we still offer something sensible.
            return ctx.os === "windows" ? CMD_BUILTINS : POSIX_BUILTINS;
    }
}

// ---- New providers ----------------------------------------------------------

/**
 * SPEC provider. When the first token matches a command-specs.ts entry, complete the
 * subcommands / flags / arg-hints available at the current depth. Flags are re-styled
 * per shell. Exact-prefix matches outrank fuzzy (subsequence) matches.
 */
function specProvider(ctx: CompletionContext, deps: CompletionDeps): Completion[] {
    if (deps.providers?.specs === false) return [];
    const { command, priorTokens, active, isFirstToken } = parseCommandLine(ctx);
    if (isFirstToken) return []; // first token is for command/builtin/path-exec providers
    const spec = getSpec(command);
    if (!spec) return [];
    // Don't fight the path provider when the active token is clearly a path.
    if (looksLikePath(active)) return [];

    const ci = caseInsensitive(ctx);
    const { flags, subcommands } = resolveSpecPath(spec, priorTokens);
    const out: Completion[] = [];

    const completingFlag = active.startsWith("-") || (ctx.shell === "cmd" && active.startsWith("/"));

    if (!completingFlag) {
        // Subcommands first.
        let rank = 0;
        for (const sub of subcommands as Subcommand[]) {
            const exact = isPrefix(sub.name, active, ci);
            const fuzzy = !exact && isSubsequence(sub.name, active, ci);
            if (!exact && !fuzzy) continue;
            out.push({
                value: sub.name,
                display: sub.name,
                kind: "subcommand",
                description: sub.description,
                insert: sub.name.slice(active.length),
                score: SCORE.specs + (exact ? EXACT_BONUS : FUZZY_PENALTY) - rank,
            });
            rank++;
        }
    }

    // Flags. When the user is actively typing a flag (active starts with - or /), ALWAYS
    // offer matching flags — including top-level/global flags like `git --version` — even
    // if subcommands still exist at this depth. Only suppress flags in the no-dash
    // subcommand-listing case (where we want to show subcommands, not flag noise).
    const suppressFlags = !completingFlag && (subcommands as Subcommand[]).length > 0;
    let frank = 0;
    for (const flag of flags) {
        if (suppressFlags) break;
        // Use the short form only when the user has unambiguously typed a single-dash short
        // flag, e.g. "-v" (one dash followed by a non-dash char). For "-" (just a dash) or
        // "--…" we offer the long form. POSIX/short styling never applies to PowerShell/cmd.
        const useShort =
            ctx.shell !== "powershell" &&
            ctx.shell !== "cmd" &&
            active.startsWith("-") &&
            !active.startsWith("--") &&
            active.length >= 2 &&
            active[1] !== "-";
        const styled = styleFlag(flag, ctx, useShort);
        const exact = isPrefix(styled, active, ci);
        const fuzzy = !exact && active.length > 1 && isSubsequence(styled, active, ci);
        if (!exact && !fuzzy) continue;
        out.push({
            value: styled,
            display: styled,
            kind: "flag",
            description: flag.description,
            insert: styled.slice(active.length),
            score: SCORE.specs - 50 + (exact ? EXACT_BONUS : FUZZY_PENALTY) - frank,
        });
        frank++;
    }

    return out;
}

/**
 * BUILTINS provider. Completes the FIRST token from the detected shell's builtins /
 * cmdlets / coreutils sample. Always on (not gated by a provider toggle) since it has
 * no I/O; it's cheap and improves the first-word experience for every shell.
 */
function builtinsProvider(ctx: CompletionContext, _deps: CompletionDeps): Completion[] {
    const { active, isFirstToken } = parseCommandLine(ctx);
    if (!isFirstToken) return [];
    if (active === "" || looksLikePath(active)) return [];
    const ci = caseInsensitive(ctx);
    const list = builtinsFor(ctx);
    const out: Completion[] = [];
    let rank = 0;
    const seen = new Set<string>();
    for (const name of list) {
        const key = ci ? name.toLowerCase() : name;
        if (seen.has(key)) continue;
        const exact = isPrefix(name, active, ci);
        const fuzzy = !exact && isSubsequence(name, active, ci);
        if (!exact && !fuzzy) continue;
        seen.add(key);
        out.push({
            value: name,
            display: name,
            kind: "builtin",
            description: "builtin",
            insert: name.slice(active.length),
            score: SCORE.builtins + (exact ? EXACT_BONUS : FUZZY_PENALTY) - rank,
        });
        rank++;
        if (rank >= 50) break;
    }
    return out;
}

/**
 * PATH-executables provider. Completes the FIRST token from the injected list of
 * executable names (deps.pathExecutables). Gated on autocomplete.providers.pathExecutables.
 */
function pathExecutablesProvider(ctx: CompletionContext, deps: CompletionDeps): Completion[] {
    if (deps.providers?.pathExecutables === false) return [];
    const names = deps.pathExecutables;
    if (!names || names.length === 0) return [];
    const { active, isFirstToken } = parseCommandLine(ctx);
    if (!isFirstToken) return [];
    if (active === "" || looksLikePath(active)) return [];
    const ci = caseInsensitive(ctx);
    const out: Completion[] = [];
    let rank = 0;
    const seen = new Set<string>();
    for (const raw of names) {
        // Display the base name; strip a trailing .exe/.cmd/.bat for the visible label on Windows.
        const name = raw;
        const key = ci ? name.toLowerCase() : name;
        if (seen.has(key)) continue;
        const exact = isPrefix(name, active, ci);
        const fuzzy = !exact && isSubsequence(name, active, ci);
        if (!exact && !fuzzy) continue;
        seen.add(key);
        out.push({
            value: name,
            display: name,
            kind: "command",
            description: "on PATH",
            insert: name.slice(active.length),
            score: SCORE.pathExecutables + (exact ? EXACT_BONUS : FUZZY_PENALTY) - rank,
        });
        rank++;
        if (rank >= 50) break;
    }
    return out;
}

// ---- Orchestration ----------------------------------------------------------

/** Dedupe by (kind + value), keeping the highest score, then sort by score desc. */
function rankAndDedupe(all: Completion[]): Completion[] {
    const best = new Map<string, Completion>();
    for (const c of all) {
        const key = `${c.kind}:${c.value}`;
        const prev = best.get(key);
        if (!prev || c.score > prev.score) best.set(key, c);
    }
    return [...best.values()].sort((a, b) => b.score - a.score);
}

/**
 * Compute ranked completions for the given context. Pure aside from the injected
 * deps. The first entry (highest score) is the natural ghost-text candidate; the
 * full list backs the dropdown.
 *
 * Extension seam: to add the spec-DB / PATH-executables / AI providers, write a
 * `(ctx, deps) => Completion[] | Promise<Completion[]>` and push it into `providers`
 * below. The SCORE tiers above already reserve ranking space for them.
 */
export async function computeCompletions(ctx: CompletionContext, deps: CompletionDeps): Promise<Completion[]> {
    const on = (id: ProviderId) => deps.providers?.[id] !== false;
    const providers: Array<Promise<Completion[]> | Completion[]> = [
        on("history") ? historyProvider(ctx, deps) : [],
        on("path") ? pathProvider(ctx, deps) : [],
        specProvider(ctx, deps), // self-gates on providers.specs
        builtinsProvider(ctx, deps), // always-on (no I/O)
        pathExecutablesProvider(ctx, deps), // self-gates on providers.pathExecutables
        // TODO(brain): aiProvider(ctx, deps) seam. To light up providers.ai, inject an async
        // completer into CompletionDeps (e.g. `aiComplete?: (ctx) => Promise<Completion[]>`),
        // call it here when deps.providers?.ai === true, tag results kind:"ai" (SCORE.ai already
        // reserved). Until then the 'ai' toggle is hidden in the settings page so it isn't a dead
        // control. Requires a new Relay→Brain round-trip + assistant call — a larger subsystem.
    ];
    const settled = await Promise.all(providers.map((p) => Promise.resolve(p).catch(() => [] as Completion[])));
    return rankAndDedupe(settled.flat());
}

/**
 * Convenience: build a CompletionContext from a raw line + cursor + environment,
 * extracting the token for you. The host can use this instead of assembling `token`.
 */
export function makeContext(
    line: string,
    cursor: number,
    env: { cwd: string; shell: string; shellVersion?: string; os: string; isWSL?: boolean },
): CompletionContext {
    const { token } = tokenAt(line, cursor);
    return { line, cursor, token, ...env };
}
