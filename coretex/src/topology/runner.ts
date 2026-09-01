// Coretex — multi-agent topology runner. Executes a set of agents in one of
// three patterns over a shared transcript, streaming each turn:
//   sequential   — A → B → C (each refines the previous output)
//   debate       — agents alternate over N rounds, pushing back on each other
//   orchestrator — first agent plans, the rest respond, first synthesizes
// Reuses the LLM hub + cost tracker; never throws (resolves via onError).

import type { AgentConfig, LLMMessage, LLMResponse, TopologyKind, TopologyTurn } from "../types.js";
import type { LLMHub } from "../llm/hub.js";
import type { CostTracker } from "../cost/tracker.js";

export interface TopologyEmit {
    onStream: (agentId: string, round: number, phase: string, chunk: string) => void;
    onTurn: (turn: TopologyTurn) => void;
    onDone: (result: string) => void;
    onError: (error: string) => void;
}

interface Entry {
    speaker: string;
    content: string;
}

export class TopologyRunner {
    private aborter: AbortController | undefined;
    private activeRunId: string | undefined;
    private static readonly TURN_TIMEOUT_MS = 90_000;

    constructor(
        private readonly hub: LLMHub,
        private readonly cost: CostTracker,
    ) {}

    stop(): void {
        this.aborter?.abort();
    }

    isRunning(): boolean {
        return this.activeRunId !== undefined;
    }

    async run(runId: string, kind: TopologyKind, agents: AgentConfig[], prompt: string, rounds: number, emit: TopologyEmit): Promise<void> {
        if (agents.length === 0) {
            emit.onError("No agents selected.");
            return;
        }
        if (this.activeRunId) {
            emit.onError(`Council run ${this.activeRunId} is already active.`);
            return;
        }
        for (const agent of agents) {
            const reason = this.hub.availabilityReason(agent.provider, agent.model);
            if (reason) {
                emit.onError(`Council cannot start: ${agent.name} is unavailable (${reason}). No agents were run.`);
                return;
            }
        }
        this.activeRunId = runId;
        this.aborter = new AbortController();
        try {
            let result = "";
            if (kind === "sequential") result = await this._sequential(runId, agents, prompt, emit);
            else if (kind === "debate") result = await this._debate(runId, agents, prompt, Math.max(1, Math.min(6, rounds)), emit);
            else result = await this._orchestrator(runId, agents, prompt, emit);
            if (!this.aborter.signal.aborted) emit.onDone(result);
        } catch (err: unknown) {
            if (this.aborter.signal.aborted) emit.onDone("(stopped)");
            else emit.onError(err instanceof Error ? err.message : String(err));
        } finally {
            this.aborter = undefined;
            this.activeRunId = undefined;
        }
    }

    /** One streamed completion from an agent given a system + user prompt. */
    private async _ask(agent: AgentConfig, system: string, user: string, runId: string, round: number, phase: string, emit: TopologyEmit): Promise<string> {
        const messages: LLMMessage[] = [
            { role: "system", content: system },
            { role: "user", content: user },
        ];
        const runSignal = this.aborter?.signal;
        const turnAborter = new AbortController();
        let timedOut = false;
        const stopTurn = (): void => turnAborter.abort();
        runSignal?.addEventListener("abort", stopTurn, { once: true });
        const timeout = setTimeout((): void => {
            timedOut = true;
            turnAborter.abort();
        }, TopologyRunner.TURN_TIMEOUT_MS);
        let res: LLMResponse;
        try {
            res = await this.hub.complete(agent.provider, {
                model: agent.model,
                messages,
                temperature: agent.temperature,
                maxTokens: agent.maxTokensPerStep,
                stream: true,
                signal: turnAborter.signal,
                onChunk: (chunk: string) => emit.onStream(agent.id, round, phase, chunk),
            });
        } catch (err: unknown) {
            if (timedOut) {
                throw new Error(`${agent.name} (${agent.provider}/${agent.model}) did not respond within ${TopologyRunner.TURN_TIMEOUT_MS / 1000} seconds. Council halted.`);
            }
            if (runSignal?.aborted) throw err;
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`${agent.name} (${agent.provider}/${agent.model}) failed: ${detail}. Council halted.`);
        } finally {
            clearTimeout(timeout);
            runSignal?.removeEventListener("abort", stopTurn);
        }
        this.cost.record({
            agentId: agent.id,
            provider: agent.provider,
            model: agent.model,
            promptTokens: res.usage.promptTokens,
            completionTokens: res.usage.completionTokens,
            cost: res.cost,
        });
        emit.onTurn({ runId, agentId: agent.id, agentName: agent.name, role: agent.role, round, phase, content: res.content });
        return res.content;
    }

    private renderTranscript(entries: Entry[]): string {
        return entries.map((e) => `${e.speaker}: ${e.content}`).join("\n\n");
    }

    // ---- sequential chain ----
    private async _sequential(runId: string, agents: AgentConfig[], prompt: string, emit: TopologyEmit): Promise<string> {
        let carried = prompt;
        let last = "";
        for (let i = 0; i < agents.length; i++) {
            if (this.aborter?.signal.aborted) break;
            const agent = agents[i];
            const system = `${agent.systemPrompt}\n\nYou are step ${i + 1} of a chain. Build on the prior work and improve it. Be concise.`;
            const user = i === 0 ? `Task:\n${prompt}` : `Original task:\n${prompt}\n\nPrevious step's output:\n${carried}\n\nImprove or extend it.`;
            last = await this._ask(agent, system, user, runId, i + 1, "turn", emit);
            carried = last;
        }
        return last;
    }

    // ---- debate ----
    private async _debate(runId: string, agents: AgentConfig[], prompt: string, rounds: number, emit: TopologyEmit): Promise<string> {
        const speakers = agents.slice(0, Math.max(2, Math.min(3, agents.length)));
        const transcript: Entry[] = [];
        for (let r = 1; r <= rounds; r++) {
            for (const agent of speakers) {
                if (this.aborter?.signal.aborted) break;
                const system =
                    `${agent.systemPrompt}\n\nYou are ${agent.name} in a focused multi-agent discussion. ` +
                    "Respond to the other participants, challenge weak points, and push toward the best possible answer. Be specific and concise.";
                const user =
                    `Topic / task:\n${prompt}\n\n` +
                    (transcript.length > 0 ? `Discussion so far:\n${this.renderTranscript(transcript)}\n\n` : "") +
                    `Your turn (${agent.name}, round ${r}):`;
                const content = await this._ask(agent, system, user, runId, r, "turn", emit);
                transcript.push({ speaker: agent.name, content });
            }
        }
        // A final synthesis from the first speaker.
        if (!this.aborter?.signal.aborted && speakers.length > 0) {
            const lead = speakers[0];
            const content = await this._ask(
                lead,
                `${lead.systemPrompt}\n\nSynthesize the discussion into a single best answer.`,
                `Topic:\n${prompt}\n\nDiscussion:\n${this.renderTranscript(transcript)}\n\nFinal synthesized answer:`,
                runId,
                rounds + 1,
                "synthesize",
                emit,
            );
            return content;
        }
        return transcript.length > 0 ? transcript[transcript.length - 1].content : "";
    }

    // ---- orchestrator / critic ----
    private async _orchestrator(runId: string, agents: AgentConfig[], prompt: string, emit: TopologyEmit): Promise<string> {
        const orchestrator = agents[0];
        const workers = agents.slice(1);

        // 1. Plan.
        const plan = await this._ask(
            orchestrator,
            `${orchestrator.systemPrompt}\n\nYou are the orchestrator. Break the task into clear sub-tasks for the team.`,
            `Task:\n${prompt}\n\nProduce a short plan with numbered sub-tasks.`,
            runId,
            1,
            "plan",
            emit,
        );

        // 2. Workers respond to the plan.
        const contributions: Entry[] = [];
        for (let i = 0; i < workers.length; i++) {
            if (this.aborter?.signal.aborted) break;
            const w = workers[i];
            const content = await this._ask(
                w,
                `${w.systemPrompt}\n\nYou are a specialist (${w.role}). Address the plan from your expertise.`,
                `Task:\n${prompt}\n\nPlan:\n${plan}\n\nYour contribution (${w.name}, ${w.role}):`,
                runId,
                2,
                "respond",
                emit,
            );
            contributions.push({ speaker: `${w.name} (${w.role})`, content });
        }

        // 3. Orchestrator synthesizes + reviews.
        if (this.aborter?.signal.aborted) return plan;
        const final = await this._ask(
            orchestrator,
            `${orchestrator.systemPrompt}\n\nReview the team's contributions and produce the final, polished result.`,
            `Task:\n${prompt}\n\nPlan:\n${plan}\n\nContributions:\n${this.renderTranscript(contributions)}\n\nFinal reviewed result:`,
            runId,
            3,
            "synthesize",
            emit,
        );
        return final;
    }
}
