// Coretex — agent pool. Owns the lifecycle of every Agent and runs the
// multi-step completion loop that turns a Task into a finished result.

import { EventEmitter } from "eventemitter3";
import type {
    AgentConfig,
    AgentState,
    AgentStatus,
    ClaudeExecutionMode,
    LLMMessage,
    LLMResponse,
    Task,
    TaskLog,
    OrchestratorConfig,
} from "../types.js";
import { LLMHub, isProviderUnavailableMessage } from "../llm/hub.js";
import { CostTracker } from "../cost/tracker.js";
import type { AgentRunInput, AgentRuntime, AgentRuntimeKind, BrowserToolHandler, ConnectorToolGuard } from "./runtime.js";
import { runtimeKindForProvider } from "./runtime.js";
import { ClaudeAgentRuntime } from "./claude-runtime.js";
import { CodexAgentRuntime } from "./codex-runtime.js";
import { GeminiCliAgentRuntime } from "./gemini-cli-runtime.js";
import type { TerminalSecurityPolicy } from "../security/terminal-policy.js";
import { terminalToolsEnabled } from "../security/terminal-policy.js";

/**
 * Auth + context the orchestrator supplies for a CLI-shim runtime agent (Claude Agent SDK /
 * Codex CLI / Gemini CLI). Only anthropic populates apiKey/oauthToken/mcpServers — Codex CLI
 * and Gemini CLI own their own OAuth session (`codex login` / `gemini` sign-in) and never see
 * a Coretex-managed credential.
 */
export interface CliRuntimeAuth {
    enabled: boolean;
    /** Plan / subscription auth — skip API $ accounting (and for Claude, use Code login). */
    authMode?: "api-key" | "claude-plan" | "subscription";
    apiKey?: string;
    /** Optional portable OAuth token from `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN). */
    oauthToken?: string;
    cwd?: string;
    /** Project env var / AI-accessible key values injected into the agent tool subprocess (never into prompts). */
    env?: Record<string, string>;
    mcpServers?: AgentRunInput["mcpServers"];
    /** Connector MCP authorization closure bound to this outer agent/task run. */
    connectorToolGuard?: ConnectorToolGuard;
}

/** Literal completion marker every agent system prompt instructs the model to emit. */
const DONE_MARKER: string = "[DONE]";

/** Remove the [DONE] completion marker (case-insensitive) from a final result. */
function stripDoneMarker(content: string): string {
    return content.replace(/\[done\]/gi, "").trim();
}

const FS_MUTATING_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "delete_file", "write_file", "apply_patch"]);

function isFsMutatingTool(tool: string): boolean {
    return FS_MUTATING_TOOLS.has(tool) || /^(write|edit|create|delete|patch)/i.test(tool);
}

/** Pull a filesystem path out of Claude/SDK tool input shapes. */
function extractToolFilePath(tool: string, input: unknown): string | undefined {
    if (!input || typeof input !== "object") return undefined;
    const obj = input as Record<string, unknown>;
    const candidates = [
        obj.file_path,
        obj.filePath,
        obj.path,
        obj.target_file,
        obj.targetFile,
        obj.notebook_path,
        obj.notebookPath,
    ];
    for (const c of candidates) {
        if (typeof c === "string" && c.trim()) return c.trim();
    }
    // Bash sometimes does `cat > file` — skip noisy shells, keep Write/Edit only for attribution.
    void tool;
    return undefined;
}

/** True if the [DONE] completion marker appears anywhere in the content (case-insensitive). */
function hasDoneMarker(content: string): boolean {
    return content.toLowerCase().includes(DONE_MARKER.toLowerCase());
}

export class Agent {
    private readonly _state: AgentState;
    private readonly memoryWindow: number;

    constructor(config: AgentConfig, memoryWindow: number = 50) {
        this.memoryWindow = memoryWindow;
        const now: string = new Date().toISOString();
        this._state = {
            id: config.id,
            config,
            status: "idle",
            currentTaskId: undefined,
            stepCount: 0,
            tokensUsedTotal: 0,
            tokensUsedToday: 0,
            costTotal: 0,
            costToday: 0,
            memory: [],
            errorMessage: undefined,
            createdAt: now,
            lastActiveAt: now,
        };
    }

    get id(): string {
        return this._state.id;
    }

    get role(): AgentState["config"]["role"] {
        return this._state.config.role;
    }

    get status(): AgentStatus {
        return this._state.status;
    }

    get isIdle(): boolean {
        return this._state.status === "idle";
    }

    get isPaused(): boolean {
        return this._state.status === "paused";
    }

    /** The underlying mutable AgentState. */
    get state(): AgentState {
        return this._state;
    }

    /** The agent's configuration. */
    get config(): AgentConfig {
        return this._state.config;
    }

    /** The agent's working memory (system + conversation messages). */
    get memory(): LLMMessage[] {
        return this._state.memory;
    }

    setStatus(status: AgentStatus, taskId?: string): void {
        this._state.status = status;
        this._state.currentTaskId = taskId;
        this._state.lastActiveAt = new Date().toISOString();
    }

    /** Append a message, then trim keeping ALL system messages + last memoryWindow non-system. */
    pushMemory(role: LLMMessage["role"], content: string): void {
        this._state.memory.push({ role, content });
        const systemMessages: LLMMessage[] = this._state.memory.filter(
            (msg: LLMMessage): boolean => msg.role === "system",
        );
        const nonSystemMessages: LLMMessage[] = this._state.memory.filter(
            (msg: LLMMessage): boolean => msg.role !== "system",
        );
        const trimmedNonSystem: LLMMessage[] =
            nonSystemMessages.length > this.memoryWindow
                ? nonSystemMessages.slice(nonSystemMessages.length - this.memoryWindow)
                : nonSystemMessages;
        this._state.memory = [...systemMessages, ...trimmedNonSystem];
    }

    /** Drop all non-system messages, keeping the seeded system prompt(s). */
    clearMemory(): void {
        this._state.memory = this._state.memory.filter(
            (msg: LLMMessage): boolean => msg.role === "system",
        );
    }

    /**
     * Replace this agent's capability-manifest system block (or remove it). System messages are
     * never trimmed, so re-running tasks must REPLACE, not append, the manifest to avoid unbounded
     * accumulation. Identified by the "CAPABILITY MANIFEST" marker.
     */
    setManifest(text: string | undefined): void {
        this._state.memory = this._state.memory.filter(
            (msg: LLMMessage): boolean => !(msg.role === "system" && msg.content.startsWith("CAPABILITY MANIFEST")),
        );
        if (text) this._state.memory.push({ role: "system", content: text });
    }

    /** Replace the base (non-manifest) system prompt so future runs use the latest skills/prompt. */
    setBaseSystemPrompt(prompt: string): void {
        const manifest = this._state.memory.filter((m: LLMMessage): boolean => m.role === "system" && m.content.startsWith("CAPABILITY MANIFEST"));
        const nonSystem = this._state.memory.filter((m: LLMMessage): boolean => m.role !== "system");
        this._state.memory = [{ role: "system", content: prompt }, ...manifest, ...nonSystem];
    }

    /** Fold one LLM response's usage and cost into both lifetime and daily counters. */
    recordUsage(res: LLMResponse): void {
        const tokens: number = res.usage.totalTokens;
        this._state.tokensUsedTotal += tokens;
        this._state.tokensUsedToday += tokens;
        this._state.costTotal += res.cost;
        this._state.costToday += res.cost;
    }

    resetDailyCounters(): void {
        this._state.tokensUsedToday = 0;
        this._state.costToday = 0;
    }

    isOverBudget(): boolean {
        const cfg: AgentConfig = this._state.config;
        if (cfg.tokenBudget > 0 && this._state.tokensUsedTotal >= cfg.tokenBudget) {
            return true;
        }
        if (cfg.dailyTokenBudget > 0 && this._state.tokensUsedToday >= cfg.dailyTokenBudget) {
            return true;
        }
        return false;
    }

    /** A broadcast-safe copy of the AgentState (memory array is duplicated). */
    snapshot(): AgentState {
        return {
            id: this._state.id,
            config: this._state.config,
            status: this._state.status,
            currentTaskId: this._state.currentTaskId,
            stepCount: this._state.stepCount,
            tokensUsedTotal: this._state.tokensUsedTotal,
            tokensUsedToday: this._state.tokensUsedToday,
            costTotal: this._state.costTotal,
            costToday: this._state.costToday,
            memory: this._state.memory.map((msg: LLMMessage): LLMMessage => ({
                role: msg.role,
                content: msg.content,
            })),
            errorMessage: this._state.errorMessage,
            createdAt: this._state.createdAt,
            lastActiveAt: this._state.lastActiveAt,
        };
    }
}

/** Effective system prompt = base prompt + all ENABLED skill.md bodies concatenated. */
function effectiveSystemPrompt(cfg: AgentConfig): string {
    const skills = (cfg.skills ?? []).filter((s) => s.enabled && s.content.trim().length > 0);
    const base = cfg.systemPrompt.trim();
    if (skills.length === 0) return base;
    return [base, ...skills.map((s) => `# ${s.name}\n${s.content.trim()}`)].filter((p) => p.length > 0).join("\n\n");
}

export class AgentPool extends EventEmitter {
    private readonly agents: Map<string, Agent> = new Map<string, Agent>();
    private readonly memoryWindow: number;
    private hub: LLMHub | undefined;
    private cost: CostTracker | undefined;
    /** Active run aborters, keyed by agentId — used by halt(). */
    private readonly aborters: Map<string, AbortController> = new Map<string, AbortController>();
    /** Agents whose current run is being CANCELLED (vs. halted) — they end idle, not paused. */
    private readonly cancelling: Set<string> = new Set<string>();
    /** Renders the capability manifest for a task at dispatch time (set by the orchestrator). */
    capabilityProvider: ((task: Task, agent: Agent) => string | undefined) | null = null;
    /**
     * Supplies auth + cwd for a CLI-shim runtime agent (anthropic/openai/gemini), and whether
     * that engine is enabled, given the provider it's being asked about (set by the orchestrator).
     */
    cliAuthProvider: ((agent: Agent, task: Task, provider: string) => CliRuntimeAuth) | null = null;
    /**
     * Appends grounding context for a task (project briefing + retrieved docs/code).
     * Async so RAG retrieval can run before the prompt is finalized.
     */
    taskContextProvider: ((task: Task) => Promise<string | undefined>) | null = null;
    /** Records a Claude agent's tool/integration calls to the audit log (set by the orchestrator). */
    auditTool: ((agentName: string, tool: string, taskId: string, filePath?: string) => void) | null = null;
    /**
     * Records a filesystem write/edit attributed to an agent (set by the orchestrator).
     * Powers Source Control "who changed this file" before commits.
     */
    recordFileChange: ((payload: {
        agentId: string;
        agentName: string;
        path: string;
        tool: string;
        taskId: string;
        projectId?: string;
    }) => void) | null = null;
    /**
     * Builds the in-app browser-tool bridge for a given agent (set by the orchestrator). When set,
     * a Claude-runtime agent can actually invoke browser_navigate/read_dom/click/eval — each call
     * is routed to the Orchestrator's permission-gated + audited agentBrowser* methods (#33).
     */
    browserControlProvider: ((agent: Agent) => BrowserToolHandler) | null = null;
    /** Snapshots the global terminal security policy at dispatch time. */
    terminalPolicyProvider: (() => TerminalSecurityPolicy) | null = null;
    /**
     * Spawns a human-in-loop Claude Code harness terminal for an "assisted"-mode run (set by the
     * orchestrator). Given the agent, task and the task prompt, it should create an agent-tagged PTY
     * running the `claude` CLI (or at minimum an agent-tagged terminal seam) and return a short note.
     * Must never throw — assisted mode hands off to a terminal and the agent returns to idle.
     */
    assistedProvider: ((agent: Agent, task: Task, prompt: string) => string | undefined) | null = null;
    /** Claude SDK session ids per agent → resume for continuity across task re-runs. */
    private readonly claudeSessions = new Map<string, string>();

    constructor(cfg: OrchestratorConfig) {
        super();
        this.memoryWindow = cfg.memoryWindowSize;
    }

    init(hub: LLMHub, cost: CostTracker): void {
        this.hub = hub;
        this.cost = cost;
    }

    add(config: AgentConfig): Agent {
        const agent: Agent = new Agent(config, this.memoryWindow);
        agent.pushMemory("system", effectiveSystemPrompt(config));
        this.agents.set(agent.id, agent);
        return agent;
    }

    remove(id: string): void {
        this.agents.delete(id);
    }

    get(id: string): Agent | undefined {
        return this.agents.get(id);
    }

    all(): Agent[] {
        return Array.from(this.agents.values());
    }

    snapshots(): AgentState[] {
        return this.all().map((agent: Agent): AgentState => agent.snapshot());
    }

    findAvailableForTask(task: Task, isRunnable: (agent: Agent) => boolean = (): boolean => true): Agent | undefined {
        // Explicit agent assignment wins over role matching: pick the first idle
        // collaborator from the assigned list so dispatched agents run the task.
        if (task.assignedAgentIds !== undefined && task.assignedAgentIds.length > 0) {
            for (const id of task.assignedAgentIds) {
                const agent: Agent | undefined = this.agents.get(id);
                if (agent && agent.isIdle && !agent.isOverBudget() && isRunnable(agent)) {
                    return agent;
                }
            }
            return undefined;
        }
        // Collect every idle, in-budget, runnable, role-matching agent, then prefer
        // the cheapest one (by provider/model pricing) rather than just the first
        // found — ties (e.g. two equally-priced local agents) keep insertion order.
        let best: Agent | undefined;
        let bestCost = Infinity;
        for (const agent of this.agents.values()) {
            if (!agent.isIdle) {
                continue;
            }
            if (agent.isOverBudget()) {
                continue;
            }
            if (!isRunnable(agent)) {
                continue;
            }
            if (task.requiredRole !== undefined && agent.role !== task.requiredRole) {
                continue;
            }
            const cost = this.hub?.estimatedCostPer1M(agent.config.provider, agent.config.model) ?? 0;
            if (cost < bestCost) {
                best = agent;
                bestCost = cost;
            }
        }
        return best;
    }

    idleCount(): number {
        let count: number = 0;
        for (const agent of this.agents.values()) {
            if (agent.isIdle) {
                count += 1;
            }
        }
        return count;
    }

    /** Human-readable name for a CLI-shim engine, for logs/errors. */
    private _engineLabel(kind: AgentRuntimeKind): string {
        switch (kind) {
            case "claude-sdk": return "Claude Agent SDK";
            case "codex-cli": return "Codex CLI";
            case "gemini-cli": return "Gemini CLI";
            default: return kind;
        }
    }

    /** Instantiate the CLI-shim runtime for an engine kind. */
    private _cliRuntime(kind: AgentRuntimeKind): AgentRuntime | undefined {
        switch (kind) {
            case "claude-sdk": return new ClaudeAgentRuntime();
            case "codex-cli": return new CodexAgentRuntime();
            case "gemini-cli": return new GeminiCliAgentRuntime();
            default: return undefined;
        }
    }

    /**
     * Run a task on a CLI-shim runtime (Claude Agent SDK / Codex CLI / Gemini CLI), translating
     * its normalized events into the SAME agent:* / cost / task events the universal loop emits.
     * Returns true if it handled the run (success/error/halt); false if the engine was
     * unavailable (SDK not installed / CLI binary missing) and we should fall back to the
     * universal hub loop.
     */
    private async _runCliRuntime(agent: Agent, task: Task, aborter: AbortController, auth: CliRuntimeAuth, cfg: AgentConfig, runtime: AgentRuntime): Promise<boolean> {
        const engineLabel = this._engineLabel(runtime.kind);
        const manifest = this.capabilityProvider?.(task, agent);
        const terminalPolicy = this.terminalPolicyProvider?.();
        const configuredPermission = cfg.permissionMode ?? "ask";
        // Global approval is a ceiling: an agent-level Auto/Bypass choice may
        // never silently override it. Stricter modes remain unchanged.
        const permissionMode =
            terminalPolicy?.autonomousTerminal === "approval" &&
            (configuredPermission === "auto" || configuredPermission === "bypass")
                ? "ask"
                : configuredPermission;
        const input: AgentRunInput = {
            agentId: agent.id,
            name: cfg.name,
            provider: cfg.provider,
            model: cfg.model,
            prompt: await this._resolveTaskPrompt(task),
            systemPrompt: [effectiveSystemPrompt(cfg), manifest].filter(Boolean).join("\n\n") || undefined,
            cwd: auth.cwd,
            apiKey: auth.apiKey,
            authMode: auth.authMode,
            oauthToken: auth.oauthToken,
            permissionMode,
            maxTurns: cfg.maxSteps,
            signal: aborter.signal,
            // Session resume is only meaningful for the Claude Agent SDK today.
            resume: runtime.kind === "claude-sdk" ? this.claudeSessions.get(agent.id) : undefined,
            mcpServers: auth.mcpServers,
            connectorToolGuard: auth.connectorToolGuard,
            env: auth.env,
            // When terminal access is off, the runtime drops shell/Bash tools.
            terminalAccess: terminalPolicy
                ? terminalToolsEnabled(terminalPolicy, cfg.terminalAccess !== false)
                : cfg.terminalAccess !== false,
            terminalPolicy,
            // When set, lets this agent actually drive the in-app browser via permission-gated tools.
            browserControl: this.browserControlProvider?.(agent),
        };
        agent.setStatus("working", task.id);
        this.emit("agent:status", { agentId: agent.id, status: "working", taskId: task.id });

        let lastResult = "";
        let fellBack = false;
        let failed: string | null = null;
        let step = 0;
        try {
            for await (const ev of runtime.run(input)) {
                if (aborter.signal.aborted) break;
                if (ev.type === "text") {
                    this.emit("agent:stream", { agentId: agent.id, taskId: task.id, chunk: String(ev.data.text ?? "") });
                } else if (ev.type === "tool_call") {
                    step += 1;
                    agent.state.stepCount += 1;
                    const tool = String(ev.data.name);
                    const filePath = extractToolFilePath(tool, ev.data.input);
                    const stepLabel = filePath ? `→ ${tool} ${filePath}` : `→ ${tool}`;
                    this.emit("agent:step", { agentId: agent.id, taskId: task.id, step, content: stepLabel });
                    this._log(task.id, agent.id, step, filePath ? `${engineLabel} tool call: ${tool} → ${filePath}` : `${engineLabel} tool call: ${tool}.`);
                    this.auditTool?.(cfg.name, tool, task.id, filePath);
                    if (filePath && isFsMutatingTool(tool)) {
                        this.recordFileChange?.({
                            agentId: agent.id,
                            agentName: cfg.name,
                            path: filePath,
                            tool,
                            taskId: task.id,
                            projectId: task.projectId,
                        });
                    }
                } else if (ev.type === "session") {
                    if (typeof ev.data.sessionId === "string" && ev.data.sessionId) this.claudeSessions.set(agent.id, ev.data.sessionId);
                } else if (ev.type === "cost") {
                    const usage = (ev.data.usage ?? {}) as Record<string, number>;
                    const promptTokens = Number(usage.input_tokens ?? 0);
                    const completionTokens = Number(usage.output_tokens ?? 0);
                    // Plan / subscription billing (Claude Pro/Max, ChatGPT Plus/Pro, Google AI Pro/Ultra)
                    // is subscription-metered — track tokens, but never bill API $ against Coretex budgets.
                    const planBilled = auth.authMode === "claude-plan" || auth.authMode === "subscription";
                    const costUsd = planBilled ? 0 : Number(ev.data.costUsd ?? 0);
                    agent.recordUsage({ usage: { totalTokens: promptTokens + completionTokens }, cost: costUsd } as LLMResponse);
                    this.cost?.record({ agentId: agent.id, taskId: task.id, projectId: task.projectId, provider: cfg.provider, model: cfg.model, promptTokens, completionTokens, cost: costUsd });
                } else if (ev.type === "done") {
                    lastResult = String(ev.data.result ?? "");
                } else if (ev.type === "error") {
                    if (ev.data.fallback) fellBack = true;
                    else failed = String(ev.data.message ?? `${engineLabel} run failed`);
                }
            }
        } catch (err) {
            failed = err instanceof Error ? err.message : String(err);
        }

        if (fellBack) {
            this._log(task.id, agent.id, 0, `${engineLabel} unavailable — falling back to the universal loop.`);
            return false;
        }
        if (aborter.signal.aborted) {
            if (this.cancelling.has(agent.id)) {
                agent.setStatus("idle");
                this.emit("agent:status", { agentId: agent.id, status: "idle" });
            } else {
                agent.setStatus("paused", task.id);
                this.emit("agent:status", { agentId: agent.id, status: "paused", taskId: task.id });
            }
            return true;
        }
        if (failed) {
            agent.setStatus("error", task.id);
            agent.state.errorMessage = failed;
            this.emit("agent:status", { agentId: agent.id, status: "error", taskId: task.id });
            this.emit("task:fail", { taskId: task.id, agentId: agent.id, error: failed });
            // Auto-recover: an errored agent must not occupy its slot forever. After a short
            // window (error stays visible meanwhile) return it to idle so it can take new work.
            setTimeout(() => {
                if (agent.state.status === "error") {
                    agent.setStatus("idle");
                    this.emit("agent:status", { agentId: agent.id, status: "idle" });
                }
            }, 8000);
            return true;
        }
        agent.setStatus("idle");
        this.emit("agent:status", { agentId: agent.id, status: "idle" });
        this.emit("task:complete", { taskId: task.id, agentId: agent.id, result: lastResult });
        return true;
    }

    /**
     * Conversational tier: a single LLM-hub completion turn instead of the full agent loop.
     * Reuses the hub + the SAME agent:* / cost / task events so downstream is unchanged. Returns
     * true when it handled the run (success/halt/error emitted); false if the hub was unavailable
     * so the caller can fall through to the standard path.
     */
    private async _runConversational(agent: Agent, task: Task, aborter: AbortController, cfg: AgentConfig): Promise<boolean> {
        const hub = this.hub;
        if (!hub) return false;

        // Seed the manifest + task prompt exactly like the universal loop, then run ONE turn.
        agent.setManifest(this.capabilityProvider?.(task, agent) ?? undefined);
        agent.pushMemory("user", await this._resolveTaskPrompt(task));
        agent.setStatus("working", task.id);
        this.emit("agent:status", { agentId: agent.id, status: "working", taskId: task.id });

        let content = "";
        try {
            const res: LLMResponse = await hub.complete(cfg.provider, {
                model: cfg.model,
                messages: agent.memory,
                temperature: cfg.temperature,
                maxTokens: cfg.maxTokensPerStep,
                stream: true,
                signal: aborter.signal,
                onChunk: (chunk: string): void => {
                    this.emit("agent:stream", { agentId: agent.id, taskId: task.id, chunk });
                },
            });
            agent.state.stepCount += 1;
            agent.recordUsage(res);
            this.cost?.record({
                agentId: agent.id,
                taskId: task.id,
                projectId: task.projectId,
                provider: cfg.provider,
                model: cfg.model,
                promptTokens: res.usage.promptTokens,
                completionTokens: res.usage.completionTokens,
                cost: res.cost,
            });
            agent.pushMemory("assistant", res.content);
            content = res.content;
            this.emit("agent:step", { agentId: agent.id, taskId: task.id, step: 1, content: res.content });
            this._log(task.id, agent.id, 1, `Conversational turn produced ${res.usage.totalTokens} tokens.`);
        } catch (err: unknown) {
            // A halt/cancel aborts the in-flight fetch → mirror the universal loop's handling.
            if (aborter.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
                if (this.cancelling.has(agent.id)) {
                    agent.setStatus("idle");
                    this.emit("agent:status", { agentId: agent.id, status: "idle" });
                } else {
                    agent.setStatus("paused", task.id);
                    this.emit("agent:status", { agentId: agent.id, status: "paused", taskId: task.id });
                }
                return true;
            }
            const message = err instanceof Error ? err.message : String(err);
            const unavailable = isProviderUnavailableMessage(message);
            agent.setStatus(unavailable ? "idle" : "error", unavailable ? undefined : task.id);
            agent.state.errorMessage = message;
            this.emit("agent:status", { agentId: agent.id, status: unavailable ? "idle" : "error", ...(unavailable ? {} : { taskId: task.id }) });
            this._log(task.id, agent.id, agent.state.stepCount, `Task failed: ${message}`);
            this.emit("task:fail", { taskId: task.id, agentId: agent.id, error: message });
            return true;
        }

        if (aborter.signal.aborted) {
            if (this.cancelling.has(agent.id)) {
                agent.setStatus("idle");
                this.emit("agent:status", { agentId: agent.id, status: "idle" });
            } else {
                agent.setStatus("paused", task.id);
                this.emit("agent:status", { agentId: agent.id, status: "paused", taskId: task.id });
            }
            return true;
        }
        agent.setStatus("idle");
        this.emit("agent:status", { agentId: agent.id, status: "idle" });
        this.emit("task:complete", { taskId: task.id, agentId: agent.id, result: stripDoneMarker(content) });
        return true;
    }

    /**
     * Assisted tier: hand the work to a human-in-loop Claude Code harness terminal (a PTY tagged to
     * the agent, spawned by the orchestrator via assistedProvider). The agent itself returns to idle
     * — the user drives the terminal. Returns true when the hand-off occurred; false (no seam wired)
     * so the caller falls through to the standard path. Never throws.
     */
    private async _runAssisted(agent: Agent, task: Task, cfg: AgentConfig): Promise<boolean> {
        if (!this.assistedProvider) return false;
        let note: string | undefined;
        try {
            note = this.assistedProvider(agent, task, await this._resolveTaskPrompt(task));
        } catch (err: unknown) {
            this._log(task.id, agent.id, 0, `Assisted hand-off failed: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
        if (!note) return false;
        this._log(task.id, agent.id, 0, `Agent ${cfg.name} handed task "${task.title}" to a Claude Code harness terminal${note ? ` (${note})` : ""}.`);
        agent.setStatus("idle");
        this.emit("agent:status", { agentId: agent.id, status: "idle" });
        // The work continues in the terminal under human supervision; mark the task complete so it
        // leaves the queue rather than retrying. The terminal session carries the actual session.
        this.emit("task:complete", { taskId: task.id, agentId: agent.id, result: note ?? "Handed off to a Claude Code harness terminal (human-in-loop)." });
        return true;
    }

    async runTask(agent: Agent, task: Task): Promise<void> {
        const hub: LLMHub | undefined = this.hub;
        if (!hub) {
            const message: string = "AgentPool not initialized: no LLMHub";
            agent.setStatus("error", task.id);
            agent.state.errorMessage = message;
            this.emit("agent:status", { agentId: agent.id, status: "error", taskId: task.id });
            this.emit("task:fail", { taskId: task.id, agentId: agent.id, error: message });
            return;
        }

        // Snapshot the config at run start so edits made while the agent is working apply only to
        // FUTURE sessions, never mid-run (primitives are copied; skills are deep-copied).
        const cfg: AgentConfig = { ...agent.config, skills: agent.config.skills ? agent.config.skills.map((s) => ({ ...s })) : undefined };
        // Re-seed the base system prompt from this snapshot so prompt/skill edits take effect next run.
        agent.setBaseSystemPrompt(effectiveSystemPrompt(cfg));

        // Engine selection up front: a CLI-shim runtime (Claude Agent SDK / Codex CLI / Gemini
        // CLI) owns its own auth (subscription/plan) and never touches the hub, so it must NOT
        // be gated on hub readiness — a plan-only setup (no API key at all) has no hub provider
        // entry for that provider. Everything else still needs the hub, checked below exactly
        // as before.
        const cliAuth = this.cliAuthProvider?.(agent, task, cfg.provider) ?? { enabled: false };
        const engineKind = runtimeKindForProvider(cfg.provider, cliAuth.authMode);
        const cliEligible = engineKind !== "universal" && cliAuth.enabled;

        if (!cliEligible) {
            try {
                hub.assertReady(cfg.provider, cfg.model);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                agent.state.errorMessage = message;
                agent.setStatus("idle");
                this.emit("agent:status", { agentId: agent.id, status: "idle" });
                this.emit("task:fail", { taskId: task.id, agentId: agent.id, error: message });
                return;
            }
        }

        // One aborter per run so halt() can abort the in-flight completion.
        const aborter: AbortController = new AbortController();
        this.aborters.set(agent.id, aborter);

        try {
            // 1. Pick up the task.
            agent.state.errorMessage = undefined;
            agent.setStatus("thinking", task.id);
            this.emit("agent:status", { agentId: agent.id, status: "thinking", taskId: task.id });
            this._log(task.id, agent.id, 0, `Agent ${cfg.name} picked up task "${task.title}".`);

            // 1a. Claude tier routing (additive). The task may override the agent's mode; an
            //     undefined mode resolves to "autonomous" — i.e. EXACTLY today's behavior below.
            const mode: ClaudeExecutionMode = task.executionMode ?? cfg.executionMode ?? "autonomous";
            if (mode === "conversational") {
                const handled = await this._runConversational(agent, task, aborter, cfg);
                if (handled) return; // success/halt/error already emitted; finally() cleans up
                // else: hub unavailable → fall through to the standard path below
            } else if (mode === "assisted") {
                if (await this._runAssisted(agent, task, cfg)) return; // handed off to a terminal; agent idle
                // else: no assisted seam wired → fall through to the standard path below
            }

            // 1b. CLI-shim engine (Claude Agent SDK / Codex CLI / Gemini CLI). Everything else
            //     falls through to Coretex's universal loop below.
            if (cliEligible) {
                const runtime = this._cliRuntime(engineKind);
                if (runtime) {
                    const handled = await this._runCliRuntime(agent, task, aborter, cliAuth, cfg, runtime);
                    if (handled) return; // success/halt/error already emitted; finally() cleans up
                }
                // else: engine unavailable (SDK not installed / CLI binary missing) → fall through
                // to the universal loop, which needs the hub — checked lazily since we skipped the
                // upfront check above for this CLI-eligible path.
                try {
                    hub.assertReady(cfg.provider, cfg.model);
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    agent.setStatus("idle");
                    agent.state.errorMessage = message;
                    this.emit("agent:status", { agentId: agent.id, status: "idle" });
                    this.emit("task:fail", { taskId: task.id, agentId: agent.id, error: message });
                    return;
                }
            }

            // 2. Seed the inherited capability scope (rendered fresh for THIS agent's mode; replaces
            //    any prior manifest so it never accumulates), then the task prompt.
            agent.setManifest(this.capabilityProvider?.(task, agent) ?? undefined);
            agent.pushMemory("user", await this._resolveTaskPrompt(task));

            let lastAssistantContent: string = "";

            // 3. Step loop.
            for (let step: number = 1; step <= cfg.maxSteps; step++) {
                if (aborter.signal.aborted) {
                    break;
                }
                agent.setStatus("working", task.id);
                this.emit("agent:status", {
                    agentId: agent.id,
                    status: "working",
                    taskId: task.id,
                });

                if (agent.isOverBudget()) {
                    this._log(
                        task.id,
                        agent.id,
                        step,
                        `Agent ${cfg.name} hit its token budget; stopping early.`,
                    );
                    break;
                }

                const res: LLMResponse = await hub.complete(cfg.provider, {
                    model: cfg.model,
                    messages: agent.memory,
                    temperature: cfg.temperature,
                    maxTokens: cfg.maxTokensPerStep,
                    stream: true,
                    signal: aborter.signal,
                    onChunk: (chunk: string): void => {
                        this.emit("agent:stream", {
                            agentId: agent.id,
                            taskId: task.id,
                            chunk,
                        });
                    },
                });

                agent.state.stepCount += 1;
                agent.recordUsage(res);

                if (this.cost) {
                    this.cost.record({
                        agentId: agent.id,
                        taskId: task.id,
                        projectId: task.projectId,
                        provider: cfg.provider,
                        model: cfg.model,
                        promptTokens: res.usage.promptTokens,
                        completionTokens: res.usage.completionTokens,
                        cost: res.cost,
                    });
                }

                agent.pushMemory("assistant", res.content);
                lastAssistantContent = res.content;

                this.emit("agent:step", {
                    agentId: agent.id,
                    taskId: task.id,
                    step,
                    content: res.content,
                });
                this._log(
                    task.id,
                    agent.id,
                    step,
                    `Step ${step} produced ${res.usage.totalTokens} tokens.`,
                );

                if (hasDoneMarker(res.content)) {
                    break;
                }

                agent.pushMemory("user", "Continue. When finished, end with [DONE].");
            }

            // 4a. Aborted mid-run. Cancel → free the agent (idle); halt → pause (resumable).
            if (aborter.signal.aborted) {
                if (this.cancelling.has(agent.id)) {
                    agent.setStatus("idle");
                    this.emit("agent:status", { agentId: agent.id, status: "idle" });
                    this._log(task.id, agent.id, agent.state.stepCount, `Task cancelled by user.`);
                    return;
                }
                agent.setStatus("paused", task.id);
                this.emit("agent:status", { agentId: agent.id, status: "paused", taskId: task.id });
                this._log(task.id, agent.id, agent.state.stepCount, `Halted by user.`);
                return;
            }

            // 4b. Success.
            agent.setStatus("idle");
            this.emit("agent:status", { agentId: agent.id, status: "idle" });
            this.emit("task:complete", {
                taskId: task.id,
                agentId: agent.id,
                result: stripDoneMarker(lastAssistantContent),
            });
        } catch (err: unknown) {
            // A halt/cancel aborts the in-flight fetch → an AbortError lands here.
            // Cancel ends the agent idle; halt pauses it (resumable, no retry storm).
            if (aborter.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
                if (this.cancelling.has(agent.id)) {
                    agent.setStatus("idle");
                    this.emit("agent:status", { agentId: agent.id, status: "idle" });
                    this._log(task.id, agent.id, agent.state.stepCount, `Task cancelled by user.`);
                    return;
                }
                agent.setStatus("paused", task.id);
                this.emit("agent:status", { agentId: agent.id, status: "paused", taskId: task.id });
                this._log(task.id, agent.id, agent.state.stepCount, `Halted by user.`);
                return;
            }
            const message: string = err instanceof Error ? err.message : String(err);
            const unavailable = isProviderUnavailableMessage(message);
            agent.setStatus(unavailable ? "idle" : "error", unavailable ? undefined : task.id);
            agent.state.errorMessage = message;
            this.emit("agent:status", { agentId: agent.id, status: unavailable ? "idle" : "error", ...(unavailable ? {} : { taskId: task.id }) });
            this._log(task.id, agent.id, agent.state.stepCount, `Task failed: ${message}`);
            this.emit("task:fail", { taskId: task.id, agentId: agent.id, error: message });
        } finally {
            this.aborters.delete(agent.id);
            this.cancelling.delete(agent.id);
        }
    }

    /** Cancel an agent's in-flight run for a task; the agent ends idle (freed). */
    abortTask(id: string): void {
        const agent: Agent | undefined = this.agents.get(id);
        if (!agent) {
            return;
        }
        const aborter: AbortController | undefined = this.aborters.get(id);
        if (aborter) {
            this.cancelling.add(id);
            aborter.abort();
        } else if (agent.status !== "idle") {
            // No in-flight completion (e.g. between steps) — free the agent directly.
            agent.setStatus("idle");
            this.emit("agent:status", { agentId: id, status: "idle" });
        }
    }

    /** Immediately abort an agent's in-flight run; it ends paused (resumable). */
    halt(id: string): void {
        const aborter: AbortController | undefined = this.aborters.get(id);
        if (aborter) {
            aborter.abort();
        }
        const agent: Agent | undefined = this.agents.get(id);
        if (agent && agent.status !== "paused" && (aborter !== undefined || agent.state.currentTaskId !== undefined || agent.status === "working" || agent.status === "thinking")) {
            agent.setStatus("paused", agent.state.currentTaskId);
            this.emit("agent:status", {
                agentId: id,
                status: "paused",
                taskId: agent.state.currentTaskId,
            });
        }
    }

    /** Halt every agent (or just `ids`, when given) — emergency stop. */
    haltAll(ids?: string[]): void {
        const targets: string[] = ids ?? Array.from(this.agents.keys());
        for (const id of targets) {
            this.halt(id);
        }
    }

    /** Pause every non-paused agent (or just `ids`, when given). */
    pauseAll(ids?: string[]): void {
        const targets: Agent[] = ids
            ? ids.map((id) => this.agents.get(id)).filter((a): a is Agent => a !== undefined)
            : Array.from(this.agents.values());
        for (const agent of targets) {
            if (agent.status !== "paused") {
                this.pause(agent.id);
            }
        }
    }

    /** Resume every paused agent (or just `ids`, when given) — back to idle. */
    resumeAll(ids?: string[]): void {
        const targets: string[] = ids ?? Array.from(this.agents.keys());
        for (const id of targets) {
            this.resume(id);
        }
    }

    pause(id: string): void {
        const agent: Agent | undefined = this.agents.get(id);
        if (!agent) {
            return;
        }
        const aborter = this.aborters.get(id);
        if (aborter) aborter.abort();
        agent.setStatus("paused", agent.state.currentTaskId);
        this.emit("agent:status", {
            agentId: agent.id,
            status: "paused",
            taskId: agent.state.currentTaskId,
        });
    }

    resume(id: string): void {
        const agent: Agent | undefined = this.agents.get(id);
        if (!agent) {
            return;
        }
        if (agent.status !== "paused") {
            return;
        }
        agent.setStatus("idle");
        this.emit("agent:status", { agentId: agent.id, status: "idle" });
    }

    setDailyBudget(id: string, tokens: number): void {
        const agent: Agent | undefined = this.agents.get(id);
        if (!agent) {
            return;
        }
        agent.config.dailyTokenBudget = tokens;
    }

    /** Patch an agent's editable config fields in place; returns the updated config (or undefined). */
    updateConfig(id: string, patch: Partial<AgentConfig>): AgentConfig | undefined {
        const agent: Agent | undefined = this.agents.get(id);
        if (!agent) return undefined;
        const c = agent.config;
        if (patch.name !== undefined) c.name = patch.name;
        if (patch.role !== undefined) c.role = patch.role;
        if (patch.provider !== undefined) c.provider = patch.provider;
        if (patch.model !== undefined) c.model = patch.model;
        if (patch.systemPrompt !== undefined) c.systemPrompt = patch.systemPrompt;
        if (patch.temperature !== undefined) c.temperature = patch.temperature;
        if (patch.permissionMode !== undefined) c.permissionMode = patch.permissionMode;
        if (patch.dailyTokenBudget !== undefined) c.dailyTokenBudget = patch.dailyTokenBudget;
        if (patch.tokenBudget !== undefined) c.tokenBudget = patch.tokenBudget;
        if (patch.maxSteps !== undefined) c.maxSteps = patch.maxSteps;
        if (patch.maxTokensPerStep !== undefined) c.maxTokensPerStep = patch.maxTokensPerStep;
        if (patch.terminalAccess !== undefined) c.terminalAccess = patch.terminalAccess;
        if (patch.connectorIds !== undefined) c.connectorIds = patch.connectorIds;
        if (patch.mcpServerIds !== undefined) c.mcpServerIds = patch.mcpServerIds;
        if (patch.executionMode !== undefined) c.executionMode = patch.executionMode;
        if (patch.skills !== undefined) c.skills = patch.skills;
        if (patch.identity !== undefined) c.identity = patch.identity;
        if (patch.avatarUrl !== undefined) c.avatarUrl = patch.avatarUrl;
        if (patch.tags !== undefined) c.tags = patch.tags;
        return c;
    }

    resetDailyCounters(): void {
        for (const agent of this.agents.values()) {
            agent.resetDailyCounters();
        }
    }

    private async _resolveTaskPrompt(task: Task): Promise<string> {
        const base = this._buildTaskPrompt(task);
        if (!this.taskContextProvider) return base;
        try {
            const extra = await this.taskContextProvider(task);
            if (extra?.trim()) return `${base}\n\n${extra.trim()}`;
        } catch {
            /* retrieval failures must not block the task */
        }
        return base;
    }

    private _buildTaskPrompt(task: Task): string {
        const lines: string[] = [];
        lines.push(`Task: ${task.title}`);
        lines.push(`Priority: ${task.priority}`);
        if (task.projectId !== undefined) {
            lines.push(`Project id: ${task.projectId}`);
        }
        if (task.assignedAgentIds !== undefined && task.assignedAgentIds.length > 1) {
            lines.push(`Collaborators: this task is assigned to ${task.assignedAgentIds.length} agents working together — coordinate and avoid duplicating effort.`);
        }
        lines.push("");
        lines.push("Description:");
        lines.push(task.description);
        lines.push("");
        if (task.useProjectContext || task.useDocuments) {
            const srcs = [task.useProjectContext ? "the project's source files / code index" : null, task.useDocuments ? "the project's documents" : null].filter(Boolean).join(" and ");
            lines.push(`Context: use ${srcs} as grounding for this task — consult them before answering and cite what you used.`);
            lines.push("");
        } else if (task.projectId) {
            lines.push("Context: this task belongs to a project — prefer the project briefing and retrieved documents/code below when present.");
            lines.push("");
        }
        if (task.planningEffort !== undefined && task.planningEffort > 0) {
            const effort: number = task.planningEffort;
            const depth: string =
                effort >= 100 ? "Build an exhaustive master plan first: decompose the task into concrete subtasks, identify dependencies, edge cases, risks, and acceptance checks, then review and improve the plan before executing it."
                : effort >= 75 ? "Invest heavily in planning first: write a thorough step-by-step plan with subtasks, edge cases, risks, and a verification strategy before doing any work."
                : effort >= 50 ? "Plan before executing: outline the approach, main steps, dependencies, and the checks you will use to verify the result."
                : "Create a concise outline of the immediate steps, then proceed.";
            lines.push(`Planning effort: ${effort}/100. ${depth}`);
            lines.push("");
        }
        lines.push("Work through this task carefully. When you are finished, end your final response with the literal marker [DONE].");
        return lines.join("\n");
    }

    private _log(taskId: string, agentId: string, step: number, message: string): void {
        const log: TaskLog = {
            taskId,
            agentId,
            step,
            message,
            timestamp: new Date().toISOString(),
        };
        this.emit("task:log", { log });
    }
}
