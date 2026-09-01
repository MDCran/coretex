import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { evaluateTerminalCommand, terminalToolsEnabled, type TerminalSecurityPolicy } from "../src/security/terminal-policy.js";
import { ConfigStore } from "../src/config/store.js";
import { CodexAgentRuntime } from "../src/agents/codex-runtime.js";
import { GeminiCliAgentRuntime } from "../src/agents/gemini-cli-runtime.js";
import type { AgentRunInput, AgentRuntimeEvent } from "../src/agents/runtime.js";

const policy = (patch: Partial<TerminalSecurityPolicy> = {}): TerminalSecurityPolicy => ({
    autonomousTerminal: "auto",
    denylist: [],
    allowlist: [],
    maxCommandLength: 8_192,
    ...patch,
});

assert.deepEqual(evaluateTerminalCommand(policy(), "npm test"), {
    allowed: true,
    requiresApproval: false,
    code: "allowed",
    matchedRule: undefined,
});

assert.equal(evaluateTerminalCommand(policy({ autonomousTerminal: "off" }), "npm test").code, "terminal-off");

const approval = evaluateTerminalCommand(policy({ autonomousTerminal: "approval" }), "npm test");
assert.equal(approval.allowed, false);
assert.equal(approval.requiresApproval, true);
assert.equal(approval.code, "approval-required");
assert.equal(evaluateTerminalCommand(policy({ autonomousTerminal: "approval" }), "npm test", { approved: true }).allowed, true);

const denied = evaluateTerminalCommand(policy({ denylist: ["DROP TABLE"] }), "psql -c 'drop table users'");
assert.equal(denied.code, "denylist");
assert.equal(denied.matchedRule, "DROP TABLE");

const exactAllowed = evaluateTerminalCommand(policy({ allowlist: ["git   status"] }), "  GIT status  ");
assert.equal(exactAllowed.allowed, true);
assert.equal(exactAllowed.matchedRule, "git   status");
assert.equal(
    evaluateTerminalCommand(policy({ allowlist: ["git status"] }), "echo git status && bad").code,
    "not-allowlisted",
    "allowlist rules must be exact commands, not decoy substrings",
);
assert.equal(
    evaluateTerminalCommand(policy({ allowlist: ["git status"] }), "git\nstatus").code,
    "not-allowlisted",
    "allowlist normalization must preserve shell statement separators",
);

const tooLong = evaluateTerminalCommand(policy({ maxCommandLength: 256 }), "x".repeat(257));
assert.equal(tooLong.code, "command-too-long");
assert.equal(tooLong.matchedRule, "max 256");

for (const command of [
    "rm -rf /",
    "rm -r /",
    "rm -rf /*",
    "rm --no-preserve-root -f -r /",
    "rm -r \\\n/",
    "rm -r -fo C:\\",
    "Remove-Item -Recurse C:\\",
    "Remove-Item -Force C:\\ -Recurse",
    "del /s /q C:\\*",
    "rd /s /q C:\\",
    "Format-Volume -DriveLetter C -Confirm:$false",
    "format C:",
]) {
    const decision = evaluateTerminalCommand(policy(), command);
    assert.equal(decision.code, "hard-deny", `${command} must hit immutable hard safety`);
}
assert.equal(evaluateTerminalCommand(policy(), "rm -rf ./dist").allowed, true, "project-local cleanup is not a hard-root delete");

assert.equal(terminalToolsEnabled(policy({ autonomousTerminal: "off" })), false);
assert.equal(terminalToolsEnabled(policy(), false), false);
assert.equal(terminalToolsEnabled(policy(), true), true);

const guardedInput = (terminalPolicy: TerminalSecurityPolicy): AgentRunInput => ({
    agentId: "test-agent",
    name: "Policy test",
    provider: "test",
    model: "test",
    prompt: "Do not run",
    permissionMode: "ask",
    signal: new AbortController().signal,
    terminalPolicy,
});
const collect = async (runtime: { run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> }, input: AgentRunInput): Promise<AgentRuntimeEvent[]> => {
    const events: AgentRuntimeEvent[] = [];
    for await (const event of runtime.run(input)) events.push(event);
    return events;
};
for (const runtime of [new CodexAgentRuntime(), new GeminiCliAgentRuntime()]) {
    const events = await collect(runtime, guardedInput(policy({ autonomousTerminal: "approval" })));
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "error");
    assert.equal(events[0]?.data.fallback, true, "uninterceptable external CLI must safely fall back under Approval");
}

const dataDir = await mkdtemp(path.join(tmpdir(), "coretex-security-policy-"));
try {
    const store = new ConfigStore(dataDir);
    await store.load();
    await store.setByPath("security.maxCommandLength", 999_999);
    assert.equal(store.get().security.maxCommandLength, 65_536, "persisted command cap must be hard-clamped");
    await store.setByPath("security.autonomousTerminal", "invalid");
    assert.equal(store.get().security.autonomousTerminal, "approval", "invalid modes must fall back safely");
    await store.setByPath("security.allowlist", ["  npm test  ", "", 42]);
    assert.deepEqual(store.get().security.allowlist, ["npm test"], "policy patterns must be sanitized on write");
} finally {
    await rm(dataDir, { recursive: true, force: true });
}

const buddy = await readFile(new URL("../src/terminal/buddy.ts", import.meta.url), "utf8");
const evaluatorIndex = buddy.indexOf("await this._authorizeCommand");
const executionIndex = buddy.indexOf("await runCaptured", evaluatorIndex);
assert.ok(evaluatorIndex >= 0 && executionIndex > evaluatorIndex, "Buddy must authorize immediately before captured execution");
assert.match(buddy, /evaluateTerminalCommand\(this\.configStore\.get\(\)\.security, candidate, \{ approved: needsApproval \}\)/);

const claudeRuntime = await readFile(new URL("../src/agents/claude-runtime.ts", import.meta.url), "utf8");
assert.match(claudeRuntime, /PreToolUse:[\s\S]*matcher: "Bash"/);
assert.match(claudeRuntime, /evaluateTerminalCommand\(policy, command\)/);
const codexRuntime = await readFile(new URL("../src/agents/codex-runtime.ts", import.meta.url), "utf8");
assert.match(codexRuntime, /autonomousTerminal !== "auto"/);
const geminiRuntime = await readFile(new URL("../src/agents/gemini-cli-runtime.ts", import.meta.url), "utf8");
assert.match(geminiRuntime, /autonomousTerminal !== "auto"/);

const types = await readFile(new URL("../src/types.ts", import.meta.url), "utf8");
assert.match(types, /type: "security:checkCommand"; requestId: string; command: string/);
assert.match(types, /type: "security:commandCheck"; requestId: string; allowed: boolean; requiresApproval: boolean/);

const orchestrator = await readFile(new URL("../src/orchestrator.ts", import.meta.url), "utf8");
assert.match(orchestrator, /case "security:checkCommand":[\s\S]*evaluateTerminalCommand\(this\.configStore\.get\(\)\.security, cmd\.command\)/);
assert.match(orchestrator, /terminalPolicyProvider = \(\) =>/);
assert.match(orchestrator, /MAX_ASSISTED_TASK_ENV_CHARS = 4_000/);
assert.match(orchestrator, /Get-Command claude -All/);
assert.match(orchestrator, /ExternalScript[\s\S]*\\\\\.ps1\$[\s\S]*Application[\s\S]*exe\|com/);
assert.doesNotMatch(orchestrator, /claude '--' \$__coretexTask/);

console.log("security terminal policy smoke: PASS");
