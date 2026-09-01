// Coretex — plan-mode engine. A dedicated planner agent streams a single, long
// Markdown plan document for a goal/task. Unlike the topology runner (many agents,
// short turns), this is one agent producing one comprehensive document, with a
// short continuation loop so long plans aren't truncated by a single completion.
// Reuses the LLM hub + cost tracker; never throws (resolves via onError).

import type { AgentConfig, LLMMessage } from "../types.js";
import type { LLMHub } from "../llm/hub.js";
import type { CostTracker } from "../cost/tracker.js";

export interface PlanEmit {
    onStream: (chunk: string) => void;
    onDone: (markdown: string) => void;
    onError: (error: string) => void;
}

const MAX_PASSES = 3;

export class Planner {
    private aborter: AbortController | undefined;

    constructor(
        private readonly hub: LLMHub,
        private readonly cost: CostTracker,
    ) {}

    stop(): void {
        this.aborter?.abort();
    }

    async run(_runId: string, agent: AgentConfig, prompt: string, emit: PlanEmit): Promise<void> {
        this.aborter = new AbortController();
        const system =
            `${agent.systemPrompt}\n\nProduce a SINGLE comprehensive implementation plan as a long, well-structured Markdown document. ` +
            "Include: a short overview, the affected files/areas, an ordered list of concrete steps (each with the change and the reasoning), risks & edge cases, a testing/verification plan, and open questions. " +
            "Use Markdown headings and numbered lists. Do not include any completion markers or meta commentary.";
        const messages: LLMMessage[] = [
            { role: "system", content: system },
            { role: "user", content: `Goal / task to plan:\n${prompt}\n\nWrite the full plan now.` },
        ];

        try {
            let full = "";
            for (let pass = 0; pass < MAX_PASSES; pass++) {
                if (this.aborter.signal.aborted) break;
                const res = await this.hub.complete(agent.provider, {
                    model: agent.model,
                    messages,
                    temperature: agent.temperature,
                    maxTokens: agent.maxTokensPerStep,
                    stream: true,
                    signal: this.aborter.signal,
                    onChunk: (chunk: string): void => emit.onStream(chunk),
                });
                this.cost.record({
                    agentId: agent.id,
                    provider: agent.provider,
                    model: agent.model,
                    promptTokens: res.usage.promptTokens,
                    completionTokens: res.usage.completionTokens,
                    cost: res.cost,
                });
                const content = res.content.replace(/\[done\]/gi, "").trim();
                full += (full ? "\n" : "") + content;
                messages.push({ role: "assistant", content: res.content });

                // Heuristic: if the model stopped well short of its token ceiling, the
                // document is complete; otherwise ask it to continue.
                if (res.usage.completionTokens < agent.maxTokensPerStep * 0.85) break;
                if (pass < MAX_PASSES - 1) {
                    messages.push({ role: "user", content: "Continue the plan from exactly where you left off. Do not repeat earlier sections." });
                    emit.onStream("\n");
                }
            }
            if (!this.aborter.signal.aborted) emit.onDone(full);
            else emit.onDone(full || "(stopped)");
        } catch (err: unknown) {
            if (this.aborter.signal.aborted) emit.onDone("(stopped)");
            else emit.onError(err instanceof Error ? err.message : String(err));
        }
    }
}
