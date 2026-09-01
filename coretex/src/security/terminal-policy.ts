import type { CoretexConfig } from "../config/schema.js";

/** Absolute upper bound even if a caller bypasses ConfigStore normalization. */
export const TERMINAL_COMMAND_HARD_CAP = 65_536;
export const TERMINAL_COMMAND_DEFAULT_CAP = 8_192;

export type TerminalPolicyReasonCode =
    | "empty-command"
    | "terminal-off"
    | "command-too-long"
    | "hard-deny"
    | "denylist"
    | "not-allowlisted"
    | "approval-required"
    | "allowed";

export interface TerminalCommandDecision {
    allowed: boolean;
    requiresApproval: boolean;
    code: TerminalPolicyReasonCode;
    reason?: string;
    matchedRule?: string;
}

export type TerminalSecurityPolicy = Pick<
    CoretexConfig["security"],
    "autonomousTerminal" | "denylist" | "allowlist" | "maxCommandLength"
>;

interface EvaluateOptions {
    /** True only after the user approved this exact command text. */
    approved?: boolean;
}

interface HardRule {
    label: string;
    test: RegExp;
}

// Catastrophic host-wide operations are not user-configurable. These are kept
// deliberately narrow: destructive-but-legitimate commands belong in the
// configurable denylist or approval flow, while these never execute via AI.
const HARD_DENY_RULES: readonly HardRule[] = [
    {
        label: "recursive delete of filesystem root",
        test: /\brm\b(?=[^;\r\n]*(?:-[a-z]*r[a-z]*\b|--recursive\b))[^;\r\n]*?\s["']?\/(?:\*|["']?(?:\s|$))/i,
    },
    {
        label: "recursive delete of home directory",
        test: /\brm\b(?=[^;\r\n]*(?:-[a-z]*r[a-z]*\b|--recursive\b))[^;\r\n]*?\s["']?(?:~|\$HOME)(?:[\\/]\*?)?["']?(?:\s|$)/i,
    },
    { label: "filesystem formatter", test: /(?:^|[;&|]\s*)\bmkfs(?:\.[a-z0-9_-]+)?\b/i },
    { label: "raw disk overwrite", test: /\bdd\b[^\r\n]*\bof\s*=\s*["']?\/dev\/(?:sd|nvme|vd|hd)[a-z0-9]*/i },
    { label: "shell fork bomb", test: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*;\s*\}\s*;?/ },
    { label: "Windows system-drive format", test: /(?:^|[;&|]\s*)\bformat(?:\.com)?\s+(?:\/[a-z]\s+)*["']?[a-z]:/i },
    { label: "Windows volume formatter", test: /\bFormat-Volume\b(?=[^\r\n]*-DriveLetter\s+["']?[a-z](?:["']?(?:\s|$)))/i },
    {
        label: "recursive delete of Windows system drive",
        test: /\bRemove-Item\b(?=[^\r\n]*-Recurse\b)(?=[^\r\n]*(?:(?:-Path|-LiteralPath)\s+)?["']?[a-z]:\\(?:\*|["']?(?:\s|$)))/i,
    },
    {
        label: "recursive rm alias delete of Windows system drive",
        test: /\brm\b(?=[^\r\n]*(?:-[a-z]*r[a-z]*\b|-Recurse\b))(?=[^\r\n]*["']?[a-z]:\\(?:\*|["']?(?:\s|$)))/i,
    },
    {
        label: "recursive del of Windows system drive",
        test: /\bdel\b(?=[^\r\n]*\/s\b)(?=[^\r\n]*["']?[a-z]:\\(?:\*|["']?(?:\s|$)))/i,
    },
    {
        label: "recursive rmdir of Windows system drive",
        test: /\b(?:rd|rmdir)\b(?=[^\r\n]*\/s\b)(?=[^\r\n]*["']?[a-z]:\\(?:\*|["']?(?:\s|$)))/i,
    },
];

function normalizePatterns(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 500))
        .filter(Boolean)
        .slice(0, 500);
}

function firstLiteralMatch(command: string, patterns: readonly string[]): string | undefined {
    const normalized = normalizedForMatch(command);
    return patterns.find((pattern) => normalized.includes(normalizedForMatch(pattern)));
}

function normalizedForMatch(value: string): string {
    // Normalize horizontal spacing only. Newlines are shell statement
    // separators and must remain significant (`git\nstatus` is not `git status`).
    return value.trim().replace(/[ \t]+/g, " ").toLowerCase();
}

function firstExactMatch(command: string, patterns: readonly string[]): string | undefined {
    const normalized = normalizedForMatch(command);
    return patterns.find((pattern) => normalizedForMatch(pattern) === normalized);
}

function effectiveCap(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return TERMINAL_COMMAND_DEFAULT_CAP;
    return Math.max(256, Math.min(TERMINAL_COMMAND_HARD_CAP, Math.round(value)));
}

/**
 * Pure, non-executing terminal decision engine shared by preview and runtime.
 * Evaluation order is intentional: immutable hard rules, configured denylist,
 * configured allowlist, then approval. A user approval can never override a
 * deny/cap decision, and applies only to the exact text that was checked.
 */
export function evaluateTerminalCommand(
    policy: TerminalSecurityPolicy,
    rawCommand: string,
    options: EvaluateOptions = {},
): TerminalCommandDecision {
    const command = typeof rawCommand === "string" ? rawCommand.trim() : "";
    if (!command) {
        return { allowed: false, requiresApproval: false, code: "empty-command", reason: "Enter a command to check." };
    }
    if (policy.autonomousTerminal === "off") {
        return { allowed: false, requiresApproval: false, code: "terminal-off", reason: "AI terminal execution is turned off." };
    }

    const cap = effectiveCap(policy.maxCommandLength);
    if (command.length > cap) {
        return {
            allowed: false,
            requiresApproval: false,
            code: "command-too-long",
            reason: `Command is ${command.length.toLocaleString()} characters; the limit is ${cap.toLocaleString()}.`,
            matchedRule: `max ${cap}`,
        };
    }

    // Join explicit shell line continuations before catastrophic-rule checks;
    // formatting a dangerous command across lines must not bypass the guard.
    const hardProbe = command.replace(/(?:\\|`|\^)\r?\n/g, " ");
    const hard = HARD_DENY_RULES.find((rule) => rule.test.test(hardProbe));
    if (hard) {
        return {
            allowed: false,
            requiresApproval: false,
            code: "hard-deny",
            reason: `Blocked by the built-in safety rule: ${hard.label}.`,
            matchedRule: hard.label,
        };
    }

    const denied = firstLiteralMatch(command, normalizePatterns(policy.denylist));
    if (denied) {
        return {
            allowed: false,
            requiresApproval: false,
            code: "denylist",
            reason: `Blocked by denylist rule “${denied}”.`,
            matchedRule: denied,
        };
    }

    const allowlist = normalizePatterns(policy.allowlist);
    let matchedAllow: string | undefined;
    if (allowlist.length > 0) {
        matchedAllow = firstExactMatch(command, allowlist);
        if (!matchedAllow) {
            return {
                allowed: false,
                requiresApproval: false,
                code: "not-allowlisted",
                reason: "Command does not match any allowlist rule.",
            };
        }
    }

    if (policy.autonomousTerminal === "approval" && options.approved !== true) {
        return {
            allowed: false,
            requiresApproval: true,
            code: "approval-required",
            reason: "This command requires your approval before it can run.",
            matchedRule: matchedAllow,
        };
    }

    return { allowed: true, requiresApproval: false, code: "allowed", matchedRule: matchedAllow };
}

/** Global terminal policy is a ceiling over an agent's own terminal toggle. */
export function terminalToolsEnabled(policy: TerminalSecurityPolicy, agentAllowsTerminal = true): boolean {
    return agentAllowsTerminal && policy.autonomousTerminal !== "off";
}
