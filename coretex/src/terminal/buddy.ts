// Coretex — Terminal Buddy engine. A per-terminal AI operator that:
//   1. probes the shell's real environment (buddy-probe),
//   2. plans a task into concrete, env-correct commands (LLM hub),
//   3. runs each command in the live PTY and READS its output (buddy-exec block capture),
//   4. classifies failures and auto-recovers (re-plans the command), and
//   5. hands off to the user ("needs help") when automatic recovery is exhausted.
//
// Suggest mode gates every step on user approval; Auto mode runs within the
// guardrails, still confirming destructive steps when configured. Everything is
// streamed to the Relay over buddy:* events and is fully abortable (Halt).

import { randomBytes } from "node:crypto";
import type { LLMHub } from "../llm/hub.js";
import type { CostTracker } from "../cost/tracker.js";
import type { TerminalManager } from "./manager.js";
import type { ConfigStore } from "../config/store.js";
import type { KeyVaultStore } from "../keyvault/store.js";
import { runCaptured, detectShellKind, type BuddyShellKind } from "./buddy-exec.js";
import { probeEnvironment, probeScript } from "./buddy-probe.js";
import { resolvePackageManager, looksLikeComplexInstall, type PmResolution } from "./buddy-pm.js";
import { evaluateTerminalCommand } from "../security/terminal-policy.js";
import type {
    OrchestratorEvent,
    TerminalEnvironment,
    BuddyMode,
    BuddyStatus,
    BuddyStepRuntime,
    BuddyHelp,
    ModelRef,
    LLMMessage,
} from "../types.js";

type Emit = (ev: OrchestratorEvent) => void;

type GateDecision =
    | { kind: "accept"; command?: string }
    | { kind: "skip" }
    | { kind: "reject" }
    | { kind: "retry"; approach?: string };

interface TaskRuntime {
    taskId: string;
    request: string;
    mode: BuddyMode;
    model: ModelRef;
    steps: BuddyStepRuntime[];
    aborter: AbortController;
    gate?: { stepId: string; resolve: (d: GateDecision) => void };
    recentOutput: string[];
    status: BuddyStatus;
    policyBlockReason?: string;
}

interface Runtime {
    env?: TerminalEnvironment;
    probing: boolean;
    probeAborter?: AbortController;
    mode: BuddyMode;
    task?: TaskRuntime;
}

const CMD_TIMEOUT = 120_000;

function trunc(s: string, n = 2000): string {
    if (!s) return s;
    return s.length > n ? s.slice(0, n) + "\n…[truncated]" : s;
}

function newId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${randomBytes(8).toString("hex")}`;
}

export class BuddyManager {
    private readonly runtimes = new Map<string, Runtime>();

    constructor(
        private readonly hub: LLMHub,
        private readonly cost: CostTracker,
        private readonly terminals: TerminalManager,
        private readonly configStore: ConfigStore,
        private readonly keyVault: KeyVaultStore,
        private readonly emit: Emit,
        /** Resolve the model+provider a given terminal's buddy should reason with. */
        private readonly resolveModel: (sessionId: string) => ModelRef,
        /** Project context (env-var NAMES, source path) when the terminal is project-attributed (§7). */
        private readonly contextProvider?: (sessionId: string) => string | undefined,
        /**
         * Optional web-search provider seam (§34.2). When supplied AND
         * terminalBuddy.webSearch is enabled, the buddy may request up-to-date
         * install steps for non-trivial tasks; the returned text is folded into
         * the plan prompt as "UP-TO-DATE WEB GUIDANCE". Left undefined → the
         * feature is a clean no-op (we never invent a web stack). Implementations
         * should reuse an existing web-search tool/provider when one is wired in.
         */
        private readonly webSearch?: (query: string, signal?: AbortSignal) => Promise<string | undefined>,
    ) {}

    private rt(sessionId: string): Runtime {
        let r = this.runtimes.get(sessionId);
        if (!r) {
            r = { probing: false, mode: this.configStore.get().terminalBuddy.defaultMode };
            this.runtimes.set(sessionId, r);
        }
        return r;
    }

    /** Is this a real, writable shell PTY the buddy can drive? */
    private isDrivable(sessionId: string): boolean {
        const meta = this.terminals.metaOf(sessionId);
        return !!meta && meta.kind !== "agent" && !meta.readOnly;
    }

    private shellKind(sessionId: string, shell?: string): BuddyShellKind {
        return detectShellKind(shell ?? this.terminals.metaOf(sessionId)?.shell);
    }

    // ---- Probe ----

    async probe(sessionId: string, shell?: string, approved = false): Promise<void> {
        if (!this.isDrivable(sessionId)) {
            this.emit({ type: "buddy:probing", sessionId, probing: false, error: "This terminal can't be probed." });
            return;
        }
        const r = this.rt(sessionId);
        if (r.probing) return;
        r.probing = true;
        r.probeAborter = new AbortController();
        this.emit({ type: "buddy:probing", sessionId, probing: true });
        try {
            const kind = this.shellKind(sessionId, shell);
            const decision = evaluateTerminalCommand(this.configStore.get().security, probeScript(kind), { approved });
            if (!decision.allowed) {
                this.emit({ type: "buddy:probing", sessionId, probing: false, error: decision.reason ?? "Environment probe blocked by terminal policy." });
                return;
            }
            const env = await probeEnvironment(this.terminals, sessionId, kind, { signal: r.probeAborter.signal });
            const model = this.resolveModel(sessionId);
            env.assignedModel = model.model;
            env.assignedProvider = model.provider;
            env.mode = r.mode;
            r.env = env;
            this.emit({ type: "buddy:environment", sessionId, env });
            this.emit({
                type: "buddy:probing",
                sessionId,
                probing: false,
                error: env.probeTimedOut ? "Environment probe timed out; partial details are shown." : undefined,
            });
        } catch (err) {
            this.emit({ type: "buddy:probing", sessionId, probing: false, error: err instanceof Error ? err.message : String(err) });
        } finally {
            r.probing = false;
        }
    }

    setMode(sessionId: string, mode: BuddyMode): void {
        const r = this.rt(sessionId);
        r.mode = mode;
        if (r.task) r.task.mode = mode;
        if (r.env) {
            r.env.mode = mode;
            this.emit({ type: "buddy:environment", sessionId, env: r.env });
        }
        this.emit({ type: "buddy:activity", sessionId, status: r.task ? r.task.status : "idle", line: `Mode: ${mode === "auto" ? "Auto" : "Suggest"}` });
    }

    // ---- Run a task ----

    async run(sessionId: string, request: string, mode: BuddyMode): Promise<void> {
        if (!this.isDrivable(sessionId)) {
            this.emit({ type: "buddy:error", sessionId, error: "The buddy can only run in a live shell terminal." });
            return;
        }
        if (this.configStore.get().security.autonomousTerminal === "off") {
            this.emit({ type: "buddy:error", sessionId, error: "AI terminal execution is turned off in Security settings." });
            return;
        }
        const r = this.rt(sessionId);
        // One task per terminal — supersede any in-flight task.
        if (r.task) this.halt(sessionId);
        r.mode = mode;

        if (!r.env) {
            await this.probe(sessionId);
        }

        const model = this.resolveModel(sessionId);
        const task: TaskRuntime = {
            taskId: newId("buddytask"),
            request,
            mode,
            model,
            steps: [],
            aborter: new AbortController(),
            recentOutput: [],
            status: "planning",
        };
        r.task = task;

        this._activity(sessionId, "planning", "Planning…");
        try {
            const steps = await this._plan(sessionId, task);
            if (task.aborter.signal.aborted) return this._finishHalted(sessionId, task, "Stopped");
            if (steps.length === 0) {
                this._finishDone(sessionId, task, false, "The buddy couldn't turn that into a command plan. Try rephrasing.");
                return;
            }
            task.steps = steps;
            this.emit({ type: "buddy:plan", sessionId, taskId: task.taskId, request, mode, steps });
            await this._runSteps(sessionId, task);
        } catch (err) {
            // A halt during the planning LLM call surfaces as an AbortError — treat it
            // as a clean stop, not a planning failure.
            if (task.aborter.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
                this._finishHalted(sessionId, task, "Stopped");
                return;
            }
            this.emit({ type: "buddy:error", sessionId, error: err instanceof Error ? err.message : String(err) });
            this._finishDone(sessionId, task, false, "The buddy hit an error while planning.");
        }
    }

    // ---- Gate decisions (from the Relay) ----

    accept(sessionId: string, stepId: string, command?: string): void {
        this._resolveGate(sessionId, stepId, { kind: "accept", command });
    }
    skip(sessionId: string, stepId: string): void {
        this._resolveGate(sessionId, stepId, { kind: "skip" });
    }
    retry(sessionId: string, stepId: string, approach?: string): void {
        this._resolveGate(sessionId, stepId, { kind: "retry", approach });
    }
    reject(sessionId: string): void {
        const t = this.runtimes.get(sessionId)?.task;
        if (t?.gate) t.gate.resolve({ kind: "reject" });
        else this.halt(sessionId);
    }

    halt(sessionId: string): void {
        const r = this.runtimes.get(sessionId);
        const t = r?.task;
        if (!t) return;
        t.aborter.abort();
        if (t.gate) t.gate.resolve({ kind: "reject" });
    }

    /** Forget a terminal's buddy state (called when the PTY exits). */
    dispose(sessionId: string): void {
        const r = this.runtimes.get(sessionId);
        if (r?.task) {
            r.task.aborter.abort();
            if (r.task.gate) r.task.gate.resolve({ kind: "reject" });
        }
        this.runtimes.delete(sessionId);
    }

    private _resolveGate(sessionId: string, stepId: string, decision: GateDecision): void {
        const t = this.runtimes.get(sessionId)?.task;
        if (t?.gate && (t.gate.stepId === stepId || stepId === "")) t.gate.resolve(decision);
    }

    private _gate(task: TaskRuntime, stepId: string): Promise<GateDecision> {
        return new Promise<GateDecision>((resolve) => {
            task.gate = {
                stepId,
                resolve: (d): void => {
                    task.gate = undefined;
                    resolve(d);
                },
            };
        });
    }

    // ---- Step execution ----

    private async _runSteps(sessionId: string, task: TaskRuntime): Promise<void> {
        const cfg = this.configStore.get().terminalBuddy;
        const kind = this.shellKind(sessionId);

        for (const step of task.steps) {
            if (task.aborter.signal.aborted) return this._finishHalted(sessionId, task, "Stopped");

            const result = await this._runWithRecovery(sessionId, task, step, kind, cfg.maxRetries);
            if (result === "aborted") return this._finishHalted(sessionId, task, "Stopped");
            if (result === "abort-task") return this._finishHalted(sessionId, task, task.policyBlockReason ?? "Rejected");
            // "success" or "skip" → continue to the next step.
        }

        const succeeded = task.steps.filter((s) => s.status === "success").length;
        const skipped = task.steps.filter((s) => s.status === "skipped").length;
        const summary = `Done — ${succeeded} of ${task.steps.length} step${task.steps.length === 1 ? "" : "s"} succeeded${skipped ? `, ${skipped} skipped` : ""}.`;
        this._finishDone(sessionId, task, true, summary);
    }

    private async _runWithRecovery(
        sessionId: string,
        task: TaskRuntime,
        step: BuddyStepRuntime,
        kind: BuddyShellKind,
        maxRetries: number,
    ): Promise<"success" | "skip" | "abort-task" | "aborted"> {
        const cfg = this.configStore.get().terminalBuddy;
        let command = step.command;
        let attempt = 1;

        for (;;) {
            if (task.aborter.signal.aborted) return "aborted";
            const authorized = await this._authorizeCommand(sessionId, task, step, command);
            if (authorized.kind === "abort-task") return "abort-task";
            if (authorized.kind === "skip") return "skip";
            command = authorized.command;
            task.status = "running";
            this._setStep(sessionId, task, step, { status: "running", attempt, command, diagnosis: undefined });
            this._activity(sessionId, "running", `$ ${command}`);

            const res = await runCaptured(this.terminals, sessionId, kind, command, { timeoutMs: CMD_TIMEOUT, signal: task.aborter.signal });
            if (task.aborter.signal.aborted) return "aborted";

            const failure = this._failureReason(step, res.stdout, res.exitCode, res.timedOut);
            if (!failure) {
                this._setStep(sessionId, task, step, { status: "success", exitCode: res.exitCode ?? 0, output: trunc(res.stdout), command });
                task.recentOutput.push(`$ ${command}\n${trunc(res.stdout, 1000)}`);
                task.recentOutput = task.recentOutput.slice(-6);
                void this._audit(sessionId, command, true);
                return "success";
            }
            void this._audit(sessionId, command, false);

            // Automatic recovery: ask the model for a corrected command.
            if (attempt <= maxRetries) {
                task.status = "recovering";
                this._setStep(sessionId, task, step, { status: "failed", exitCode: res.exitCode ?? undefined, output: trunc(res.stdout), diagnosis: `${failure} — recovering…` });
                this._activity(sessionId, "recovering", `Recovering (attempt ${attempt}/${maxRetries}): ${failure}`);
                const revised = await this._reviseCommand(sessionId, task, command, res.stdout, res.exitCode, failure);
                if (task.aborter.signal.aborted) return "aborted";
                if (revised && revised.trim() && revised.trim() !== command.trim()) {
                    command = revised.trim();
                    // A recovery revision could be destructive even if the step wasn't.
                    // _authorizeCommand re-assesses and gates it at the top of the loop.
                    const newRisk = this._assessRisk(command, step.riskLevel);
                    if (newRisk !== step.riskLevel) this._setStep(sessionId, task, step, { riskLevel: newRisk });
                    attempt++;
                    continue;
                }
                // No useful revision → hand off below.
            }

            // Hand off to the user.
            const help: BuddyHelp = {
                stepId: step.id,
                command,
                error: trunc(res.stdout, 800) || (res.timedOut ? "Command timed out." : `Exited with code ${res.exitCode ?? "?"}.`),
                diagnosis: failure,
                classification: this._classify(res.stdout, res.exitCode),
            };
            task.status = "needs-help";
            this._setStep(sessionId, task, step, { status: "failed", exitCode: res.exitCode ?? undefined, output: trunc(res.stdout), diagnosis: failure });
            this.emit({ type: "buddy:needsHelp", sessionId, taskId: task.taskId, help });
            this._activity(sessionId, "needs-help", `Needs your help: ${failure}`);

            const decision = await this._gate(task, step.id);
            if (decision.kind === "reject") return "abort-task";
            if (decision.kind === "skip") {
                this._setStep(sessionId, task, step, { status: "skipped" });
                return "skip";
            }
            if (decision.kind === "accept" && decision.command) {
                command = decision.command;
                attempt = 1;
                continue;
            }
            if (decision.kind === "retry") {
                const revised = await this._reviseCommand(sessionId, task, command, res.stdout, res.exitCode, failure, decision.approach);
                if (task.aborter.signal.aborted) return "aborted";
                command = revised && revised.trim() ? revised.trim() : command;
                attempt = 1;
                continue;
            }
            return "abort-task";
        }
    }

    /**
     * The single authorization boundary immediately before every task-command
     * PTY write. Recovered commands, user edits, and manual retries all loop
     * through here, so no alternate Buddy execution path bypasses policy.
     */
    private async _authorizeCommand(
        sessionId: string,
        task: TaskRuntime,
        step: BuddyStepRuntime,
        command: string,
    ): Promise<{ kind: "allow"; command: string } | { kind: "skip" } | { kind: "abort-task" }> {
        const cfg = this.configStore.get();
        let candidate = command.trim();
        const first = evaluateTerminalCommand(cfg.security, candidate);

        if (!first.allowed && !first.requiresApproval) {
            const reason = first.reason ?? "Command blocked by terminal policy.";
            task.policyBlockReason = reason;
            this._setStep(sessionId, task, step, { status: "failed", command: candidate, diagnosis: reason });
            this._activity(sessionId, "failed", reason);
            this.emit({ type: "buddy:error", sessionId, error: reason });
            void this._audit(sessionId, candidate, false);
            return { kind: "abort-task" };
        }

        const risk = this._assessRisk(candidate, step.riskLevel);
        if (risk !== step.riskLevel) this._setStep(sessionId, task, step, { riskLevel: risk });
        const needsApproval =
            first.requiresApproval ||
            task.mode === "suggest" ||
            (risk === "destructive" && cfg.terminalBuddy.alwaysConfirmDestructive);

        if (needsApproval) {
            task.status = first.requiresApproval || task.mode === "suggest" ? "awaiting" : "confirm";
            this._setStep(sessionId, task, step, { status: "awaiting", command: candidate });
            this._activity(
                sessionId,
                task.status,
                first.requiresApproval
                    ? `Approval required: ${step.description}`
                    : task.mode === "suggest"
                      ? `Review: ${step.description}`
                      : `Confirm destructive step: ${step.description}`,
            );
            const gate = await this._gate(task, step.id);
            if (gate.kind === "reject") return { kind: "abort-task" };
            if (gate.kind === "skip") {
                this._setStep(sessionId, task, step, { status: "skipped" });
                return { kind: "skip" };
            }
            if (gate.kind !== "accept") return { kind: "abort-task" };
            if (typeof gate.command === "string") candidate = gate.command.trim();
        }

        // Re-check the exact accepted text. Approval never overrides a deny,
        // allowlist miss, hard rule, or length cap.
        const final = evaluateTerminalCommand(this.configStore.get().security, candidate, { approved: needsApproval });
        if (!final.allowed) {
            const reason = final.reason ?? "Command blocked by terminal policy.";
            task.policyBlockReason = reason;
            this._setStep(sessionId, task, step, { status: "failed", command: candidate, diagnosis: reason });
            this._activity(sessionId, "failed", reason);
            this.emit({ type: "buddy:error", sessionId, error: reason });
            void this._audit(sessionId, candidate, false);
            return { kind: "abort-task" };
        }
        return { kind: "allow", command: candidate };
    }

    // ---- Failure detection / classification ----

    private _failureReason(step: BuddyStepRuntime, output: string, exitCode: number | null, timedOut: boolean): string | null {
        if (timedOut) return "Command timed out";
        if (step.errorPatterns && step.errorPatterns.length > 0) {
            // Bound ReDoS exposure from model-supplied patterns: cap the pattern
            // length and the scanned input slice.
            const probe = output.slice(0, 8000);
            for (const pat of step.errorPatterns) {
                if (typeof pat !== "string" || pat.length > 200) continue;
                try {
                    if (new RegExp(pat, "i").test(probe)) return `Output matched failure pattern (${this._classify(output, exitCode)})`;
                } catch {
                    /* ignore a bad regex from the model */
                }
            }
        }
        if (exitCode !== null && exitCode !== 0) return `Exited with code ${exitCode} (${this._classify(output, exitCode)})`;
        // Couldn't read an exit code — fall back to scanning the output for error keywords.
        if (exitCode === null && /\b(error|fatal|denied|not found|not recognized|cannot|unable|no such)\b/i.test(output)) {
            return `Likely failure (${this._classify(output, exitCode)})`;
        }
        // expectedOutput verification: a step can exit 0 yet not actually achieve its goal.
        // When the model declared an expected success substring and it's absent from the output,
        // treat it as a soft failure so recovery/hand-off can react instead of reporting success.
        if (step.expectedOutput && step.expectedOutput.trim() && (exitCode === 0 || exitCode === null)) {
            const needle = step.expectedOutput.trim().toLowerCase();
            if (!output.toLowerCase().includes(needle)) {
                return `Succeeded but expected output not found ("${trunc(step.expectedOutput.trim(), 80)}")`;
            }
        }
        return null;
    }

    /**
     * Deterministic destructive-command detector. The risk gate must never depend
     * solely on the LLM's self-reported riskLevel — an under-labeled (or
     * recovery-revised) command like `rm -rf` would otherwise run unconfirmed in
     * Auto mode. This regex forces "destructive" regardless of the model's label.
     */
    private static readonly DESTRUCTIVE_RE =
        /(\brm\s+-[a-z]*[rf]|\brmdir\b|\bmkfs\b|\bdd\s+if=|\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b|\bformat\s|>\s*\/dev\/|\bdrop\s+(database|table|schema)\b|\btruncate\s+table\b|\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+.*(--force|-f)\b)|\bdocker\s+(system\s+prune|rmi\s+-f|volume\s+rm|.*--force)|\bkubectl\s+delete\b|\bchmod\s+-R\b|\bchown\s+-R\b|\bRemove-Item\b[\s\S]*-Recurse|\bdel\s+\/[sqfh]|\brd\s+\/s|\bnpm\s+unpublish\b|\bkill(all)?\s+-9\b|:\(\)\s*\{)/i;

    /** The stricter of the model's riskLevel and a deterministic destructive scan. */
    private _assessRisk(command: string, llmRisk: BuddyStepRuntime["riskLevel"]): BuddyStepRuntime["riskLevel"] {
        if (BuddyManager.DESTRUCTIVE_RE.test(command)) return "destructive";
        return llmRisk;
    }

    private _classify(output: string, exitCode: number | null): string {
        const o = output.toLowerCase();
        if (/command not found|not recognized as|: not found|no such command/.test(o)) return "command-not-found";
        if (/permission denied|eacces|operation not permitted|requires (root|administrator)|must be run as|are you root/.test(o)) return "permission-denied";
        if (/unable to locate package|no package|could not find a version|no matching distribution|unable to find|package .* not found/.test(o)) return "package-not-found";
        if (/could not resolve host|network is unreachable|temporary failure in name resolution|etimedout|connection refused|econnrefused|could not connect/.test(o)) return "network-error";
        if (/already installed|is already the newest|nothing to do/.test(o)) return "already-installed";
        if (/no such file or directory|enoent|cannot find path/.test(o)) return "missing-file";
        if (/version|incompatible|unsupported|requires .* (>=|version)/.test(o)) return "version-conflict";
        if (/conflict|held broken packages|dependency/.test(o)) return "dependency-conflict";
        return exitCode !== null && exitCode !== 0 ? "command-failed" : "unknown";
    }

    // ---- LLM: planning + command revision ----

    private _envSummary(env: TerminalEnvironment | undefined): string {
        if (!env) return "Environment unknown (probe did not complete).";
        const pms = (env.packageManagers ?? []).map((p) => `${p.name}${p.primary ? " (primary)" : ""}`).join(", ") || "none detected";
        const lang = (env.tools ?? []).map((p) => p.name).join(", ") || "none detected";
        const rts = (env.runtimes ?? []).map((p) => `${p.name}${p.version ? ` ${p.version}` : ""}`).join(", ") || "none detected";
        const conn =
            env.connectionKind === "ssh"
                ? `SSH${env.sshHost ? ` ${env.sshUser ? env.sshUser + "@" : ""}${env.sshHost}` : ""}`
                : env.connectionKind === "docker"
                  ? `Docker${env.dockerContainer ? ` ${env.dockerContainer}` : ""}`
                  : env.connectionKind === "wsl"
                    ? `WSL${env.wslDistro ? ` ${env.wslDistro}` : ""}`
                    : "Local";
        const priv = env.isRoot ? "root" : env.hasSudo ? (env.sudoPasswordless ? "sudo (passwordless)" : "sudo available") : "no sudo/admin";
        return [
            `- Connection: ${conn}`,
            `- OS: ${env.osName ?? env.os ?? "unknown"}${env.osVersion ? ` ${env.osVersion}` : ""}${env.arch ? ` · ${env.arch}` : ""}${env.kernelVersion ? ` · kernel ${env.kernelVersion}` : ""}`,
            env.distro ? `- Distro: ${env.distro}${env.distroVersion ? ` ${env.distroVersion}` : ""}${env.initSystem ? ` · ${env.initSystem}` : ""}` : "",
            `- Shell: ${env.shell ?? "unknown"}${env.shellVersion ? ` ${env.shellVersion}` : ""}`,
            `- System package managers: ${pms}`,
            `- Language package managers: ${lang}`,
            `- Runtimes: ${rts}`,
            `- User: ${env.username ?? "unknown"} · ${priv}`,
            `- Working directory: ${env.cwd ?? "unknown"}`,
        ]
            .filter(Boolean)
            .join("\n");
    }

    private _planSystem(env: TerminalEnvironment | undefined, projectContext?: string, webContext?: string): string {
        const pm = resolvePackageManager(env);
        return (
            "You are Terminal Buddy, an expert shell operator embedded directly in a terminal. " +
            "You produce exact, safe shell commands tailored to the EXACT environment below — never generic guesses.\n\n" +
            "ENVIRONMENT:\n" +
            this._envSummary(env) +
            "\n\nPACKAGE MANAGERS (resolved for this exact environment):\n" +
            pm.summary +
            (projectContext ? `\n\nPROJECT CONTEXT:\n${projectContext}\n(Reference env-var names by name; their values are managed by the user — never echo or print secret values.)` : "") +
            (webContext ? `\n\nUP-TO-DATE WEB GUIDANCE:\n${webContext}` : "") +
            "\n\nRULES:\n" +
            `- Generate commands for THIS environment only.${pm.system ? ` Use ${pm.system} for system packages` : " Use the detected system package manager"} — never a different OS's manager.\n` +
            (pm.templates.install ? `- For system installs, the correct shape is: ${pm.templates.install} (substitute the real package name).\n` : "") +
            (pm.systemFallbacks.length ? `- If a package is unavailable in ${pm.system}, fall back to: ${pm.systemFallbacks.join(", ")}.\n` : "") +
            "- Use language package managers (npm/pip/cargo/…) for language-level packages.\n" +
            "- Use sudo only when required AND available. Prefer checking state (versions, existence) before mutating it.\n" +
            "- Each step is a SINGLE shell command line valid for the detected shell. No interactive prompts (use non-interactive flags like -y).\n" +
            '- riskLevel: "safe" = read-only/idempotent; "caution" = installs/config changes; "destructive" = deletes, overwrites, drops, or system-wide changes.\n\n' +
            'Respond with ONLY a JSON object (no markdown, no prose): {"steps":[{"description":"...","command":"...","riskLevel":"safe|caution|destructive","expectedOutput":"optional substring on success","errorPatterns":["optional regex"]}]}. ' +
            "Keep the plan as short as the task allows."
        );
    }

    /**
     * Config-gated web-search assist (§34.2). Returns up-to-date guidance text to
     * fold into the plan prompt, or undefined when the feature is off / unavailable
     * / the task is trivial. This is intentionally a thin seam: when no web-search
     * provider is injected it is a pure no-op (honoring the config flag without
     * inventing a web stack). The model is NOT given a web tool to call directly —
     * we fetch context once, up front, deterministically.
     */
    private async _maybeWebSearch(sessionId: string, task: TaskRuntime): Promise<string | undefined> {
        const cfg = this.configStore.get().terminalBuddy;
        if (!cfg.webSearch || !this.webSearch) return undefined;
        if (!looksLikeComplexInstall(task.request)) return undefined;
        const r = this.rt(sessionId);
        const pm: PmResolution = resolvePackageManager(r.env);
        const envHint = [r.env?.distro ?? r.env?.osName ?? r.env?.os, pm.system].filter(Boolean).join(" ");
        const query = `${task.request} ${envHint} install steps`.trim();
        try {
            this._activity(sessionId, "planning", "Checking the web for up-to-date steps…");
            const out = await this.webSearch(query, task.aborter.signal);
            return out && out.trim() ? trunc(out, 2000) : undefined;
        } catch {
            // Web search is best-effort: a failure must never block planning.
            return undefined;
        }
    }

    private async _plan(sessionId: string, task: TaskRuntime): Promise<BuddyStepRuntime[]> {
        const r = this.rt(sessionId);
        const projectContext = this.contextProvider?.(sessionId);
        // Optional, config-gated web-search assist for non-trivial installs.
        const webContext = await this._maybeWebSearch(sessionId, task);
        const messages: LLMMessage[] = [
            { role: "system", content: this._planSystem(r.env, projectContext, webContext) },
            {
                role: "user",
                content:
                    `Task: ${task.request}\n\n` +
                    (task.recentOutput.length ? `Recent terminal output:\n${task.recentOutput.join("\n---\n")}\n\n` : "") +
                    "Produce the JSON plan now.",
            },
        ];
        const res = await this.hub.complete(task.model.provider, {
            model: task.model.model,
            messages,
            temperature: 0.1,
            maxTokens: 1400,
            signal: task.aborter.signal,
        });
        this._record(sessionId, task, res.usage.promptTokens, res.usage.completionTokens, res.cost);
        return this._parsePlan(res.content);
    }

    private _parsePlan(content: string): BuddyStepRuntime[] {
        const json = this._extractJson(content);
        if (!json) return [];
        let parsed: unknown;
        try {
            parsed = JSON.parse(json);
        } catch {
            return [];
        }
        const rawSteps = (parsed as { steps?: unknown }).steps;
        if (!Array.isArray(rawSteps)) return [];
        const steps: BuddyStepRuntime[] = [];
        for (const raw of rawSteps) {
            if (!raw || typeof raw !== "object") continue;
            const o = raw as Record<string, unknown>;
            const command = typeof o["command"] === "string" ? o["command"].trim() : "";
            if (!command) continue;
            const risk = o["riskLevel"];
            const riskLevel = risk === "destructive" || risk === "caution" || risk === "safe" ? risk : "caution";
            steps.push({
                id: newId("step"),
                description: typeof o["description"] === "string" ? o["description"] : command,
                command,
                expectedOutput: typeof o["expectedOutput"] === "string" ? o["expectedOutput"] : undefined,
                errorPatterns: Array.isArray(o["errorPatterns"]) ? (o["errorPatterns"].filter((p) => typeof p === "string").slice(0, 8) as string[]) : undefined,
                // Override an under-reported risk: a deterministic scan can only raise it.
                riskLevel: this._assessRisk(command, riskLevel),
                status: "pending",
                attempt: 0,
            });
        }
        return steps;
    }

    private _extractJson(content: string): string | null {
        const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const body = fenced ? fenced[1] : content;
        const start = body.indexOf("{");
        const end = body.lastIndexOf("}");
        if (start < 0 || end <= start) return null;
        return body.slice(start, end + 1);
    }

    private async _reviseCommand(
        sessionId: string,
        task: TaskRuntime,
        command: string,
        output: string,
        exitCode: number | null,
        failure: string,
        approach?: string,
    ): Promise<string | null> {
        const r = this.rt(sessionId);
        const messages: LLMMessage[] = [
            {
                role: "system",
                content:
                    "You are Terminal Buddy fixing a failed shell command for the EXACT environment below.\n\n" +
                    "ENVIRONMENT:\n" +
                    this._envSummary(r.env) +
                    "\n\nPACKAGE MANAGERS (resolved for this exact environment):\n" +
                    resolvePackageManager(r.env).summary +
                    "\n\nA command failed. Diagnose the cause and output a SINGLE corrected shell command line that addresses it " +
                    "(e.g. switch package manager, add sudo, pin a version, fix the path, use a mirror). " +
                    "If it genuinely needs human intervention, output exactly: MANUAL\n" +
                    "Output ONLY the command line (or MANUAL). No explanation, no markdown.",
            },
            {
                role: "user",
                content:
                    `Original task: ${task.request}\n\n` +
                    `Failed command:\n${command}\n\n` +
                    `Exit code: ${exitCode ?? "unknown"}\nClassification: ${failure}\nOutput:\n${trunc(output, 1500)}\n\n` +
                    (approach ? `User guidance: ${approach}\n\n` : "") +
                    "Corrected command:",
            },
        ];
        const res = await this.hub.complete(task.model.provider, {
            model: task.model.model,
            messages,
            temperature: 0.1,
            maxTokens: 400,
            signal: task.aborter.signal,
        });
        this._record(sessionId, task, res.usage.promptTokens, res.usage.completionTokens, res.cost);
        let line = res.content.trim();
        const fence = line.match(/```(?:[a-z]*)?\s*([\s\S]*?)```/i);
        if (fence) line = fence[1].trim();
        line = line.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
        line = line.replace(/^`+|`+$/g, "").replace(/^\$\s*/, "").trim();
        if (!line || /^manual$/i.test(line)) return null;
        return line;
    }

    // ---- Emit + bookkeeping ----

    private _setStep(sessionId: string, task: TaskRuntime, step: BuddyStepRuntime, patch: Partial<BuddyStepRuntime>): void {
        Object.assign(step, patch);
        this.emit({ type: "buddy:step", sessionId, taskId: task.taskId, step: { ...step } });
    }

    private _activity(sessionId: string, status: BuddyStatus, line: string): void {
        const r = this.runtimes.get(sessionId);
        if (r?.task) r.task.status = status;
        this.emit({ type: "buddy:activity", sessionId, status, line });
    }

    private _finishDone(sessionId: string, task: TaskRuntime, ok: boolean, summary: string): void {
        task.status = ok ? "done" : "failed";
        this.emit({ type: "buddy:done", sessionId, taskId: task.taskId, ok, summary });
        this.emit({ type: "buddy:activity", sessionId, status: ok ? "done" : "failed", line: summary });
        const r = this.runtimes.get(sessionId);
        if (r && r.task === task) r.task = undefined;
    }

    private _finishHalted(sessionId: string, task: TaskRuntime, reason: string): void {
        task.status = "halted";
        // Carry an explicit halted flag so the reducer lands on "halted" directly instead of
        // inferring it from prev.status — which would flash a transient red "Failed" badge for
        // one render before the trailing activity('halted') corrected it.
        this.emit({ type: "buddy:done", sessionId, taskId: task.taskId, ok: false, summary: reason, halted: true });
        this.emit({ type: "buddy:activity", sessionId, status: "halted", line: reason });
        const r = this.runtimes.get(sessionId);
        if (r && r.task === task) r.task = undefined;
    }

    private _record(sessionId: string, task: TaskRuntime, promptTokens: number, completionTokens: number, cost: number): void {
        this.cost.record({
            agentId: `buddy:${sessionId.slice(0, 12)}`,
            provider: task.model.provider,
            model: task.model.model,
            promptTokens,
            completionTokens,
            cost,
        });
    }

    private async _audit(sessionId: string, command: string, ok: boolean): Promise<void> {
        try {
            await this.keyVault.addAudit("buddy:command", `terminal ${sessionId.slice(0, 8)}`, `${ok ? "ok" : "failed"}: ${command.slice(0, 200)}`, ok ? "info" : "warn");
        } catch {
            /* audit is best-effort */
        }
    }
}
