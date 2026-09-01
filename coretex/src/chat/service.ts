// Coretex — Project Chat Service.
//
// Answers questions grounded in a project's unified doc + code retrieval index.
// Streams the assistant response chunk-by-chunk, attaches citations from the
// retrieved chunks, and persists the full message history to disk under
// <dataDir>/projects/<projectId>/chat.json. This service talks to the LLM hub
// directly and never touches the agent pool.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
    ChatCitation,
    ChatMessage,
    LLMMessage,
    ModelRef,
    Project,
} from "../types.js";
import type { LLMHub } from "../llm/hub.js";
import { isProviderUnavailableMessage } from "../llm/hub.js";
import type { CostTracker } from "../cost/tracker.js";
import type { ProjectIndexStore, RetrievedChunk } from "../rag/store.js";

/** Callbacks fired as a chat turn progresses. */
export interface ChatEvents {
    onStream: (messageId: string, chunk: string) => void;
    onMessage: (message: ChatMessage) => void;
    onDone: (messageId: string) => void;
}

/** Everything needed to answer a single chat turn for a project. */
export interface ChatSendArgs {
    project: Project;
    content: string;
    hub: LLMHub;
    cost: CostTracker;
    defaultModel: ModelRef;
    ollamaBaseUrl: string;
    events: ChatEvents;
    /** Profile + enabled memories, injected as a system message for personalization. */
    personalContext?: string;
    /** Capability manifest (integrations + env-var names, no secrets) — partial awareness. */
    capabilityManifest?: string;
    /** Live project state (active agents, terminals, tasks, billing, docs) — full-project awareness. */
    projectState?: string;
}

/** How many prior messages of context to replay into each request. */
const HISTORY_WINDOW = 8;

/** Generate an id of the form "<prefix>_<epochMillis>_<rand>". */
function generateId(prefix: string): string {
    const epochMillis = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${epochMillis}_${rand}`;
}

/**
 * The Project Assistant. Owns per-project chat history (in memory + on disk) and
 * answers questions by retrieving from the project's index and streaming an LLM
 * completion grounded in that context.
 */
export class ProjectChatService {
    private readonly store: ProjectIndexStore;
    private readonly dataDir: string;
    private readonly byProject = new Map<string, ChatMessage[]>();
    private readonly cancelled = new Set<string>();
    /** In-flight request aborters, keyed by projectId, so stop() can cancel the HTTP call. */
    private readonly aborters = new Map<string, AbortController>();

    constructor(store: ProjectIndexStore, dataDir: string) {
        this.store = store;
        this.dataDir = dataDir;
    }

    /** Absolute path to a project's persisted chat history file. */
    private fileFor(projectId: string): string {
        return join(this.dataDir, "projects", projectId, "chat.json");
    }

    /**
     * Load a project's chat history from disk into memory. A missing or
     * unparseable file is treated as an empty history. Never throws on ENOENT.
     */
    async load(projectId: string): Promise<ChatMessage[]> {
        const file = this.fileFor(projectId);
        await mkdir(dirname(file), { recursive: true });

        let raw: string;
        try {
            raw = await readFile(file, "utf8");
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                this.byProject.set(projectId, []);
                return [];
            }
            throw err;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            this.byProject.set(projectId, []);
            return [];
        }

        const messages = Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
        this.byProject.set(projectId, messages);
        return messages;
    }

    /** All in-memory messages for a project (empty array if none loaded). */
    getHistory(projectId: string): ChatMessage[] {
        return this.byProject.get(projectId) ?? [];
    }

    /** Persist a project's in-memory chat history to disk as JSON. */
    private async save(projectId: string): Promise<void> {
        const file = this.fileFor(projectId);
        await mkdir(dirname(file), { recursive: true });
        const messages = this.byProject.get(projectId) ?? [];
        await writeFile(file, JSON.stringify(messages), "utf8");
    }

    /** Empty a project's chat history and persist the cleared state. */
    async clear(projectId: string): Promise<void> {
        this.byProject.set(projectId, []);
        await this.save(projectId);
    }

    /**
     * Stop the in-flight stream for a project: aborts the underlying HTTP request
     * (so no further tokens are generated or billed) and keeps whatever streamed so far.
     */
    stop(projectId: string): void {
        const aborter = this.aborters.get(projectId);
        if (!aborter) return;
        this.cancelled.add(projectId);
        aborter.abort();
    }

    stopAll(): void {
        for (const projectId of this.aborters.keys()) this.stop(projectId);
    }

    /**
     * Answer a single chat turn: record the user message, retrieve grounding
     * context, stream a grounded assistant reply, attach citations, persist
     * history, and record cost. Always resolves with the assistant message,
     * even on error.
     */
    async send(args: ChatSendArgs): Promise<ChatMessage> {
        const { project, content, hub, cost, defaultModel, ollamaBaseUrl, events, personalContext, capabilityManifest, projectState } = args;

        const history = this.byProject.get(project.id) ?? [];
        this.byProject.set(project.id, history);

        const model = project.assistantModel ?? defaultModel;
        const aborter = new AbortController();
        this.aborters.set(project.id, aborter);

        // 1. Resolve grounding before committing a turn. If the index/embedder is
        // unavailable, the caller can report a typed error without leaving a half-turn.
        let retrieved: RetrievedChunk[];
        try {
            retrieved = await this.store.retrieve(project.id, content, {
                codeK: 6,
                docK: 4,
                ollamaBaseUrl,
            });
            if (aborter.signal.aborted) throw new DOMException("Project chat was stopped.", "AbortError");
        } catch (err) {
            this.cancelled.delete(project.id);
            this.aborters.delete(project.id);
            throw err;
        }

        // 2. Record + announce the user's message.
        const userMsg: ChatMessage = {
            id: generateId("msg"),
            projectId: project.id,
            role: "user",
            content,
            createdAt: Date.now(),
        };
        history.push(userMsg);
        events.onMessage(userMsg);

        // 3. Build the request messages: system + context + recent history + question.
        const messages: LLMMessage[] = [];
        messages.push({
            role: "system",
            content:
                `You are the Coretex Project Assistant for "${project.name}". ` +
                "Answer ONLY from the provided context drawn from this project's reference documents " +
                "and source code. Cite the file paths you used. If the answer is not in the context, " +
                "say so plainly.",
        });

        // Personalization: who the user is + their saved memories.
        if (personalContext && personalContext.trim().length > 0) {
            messages.push({ role: "system", content: personalContext.trim() });
        }

        // Partial capability awareness: what integrations + env-var names exist (no secrets).
        if (capabilityManifest && capabilityManifest.trim().length > 0) {
            messages.push({ role: "system", content: capabilityManifest.trim() });
        }

        // Full-project awareness: live state across agents/terminals/tasks/billing/docs.
        if (projectState && projectState.trim().length > 0) {
            messages.push({ role: "system", content: projectState.trim() });
        }

        if (retrieved.length > 0) {
            messages.push({
                role: "system",
                content: "Context:\n\n" + this.formatContext(retrieved),
            });
        }

        // Replay the last ~HISTORY_WINDOW messages (excluding the just-added
        // user turn, which we append explicitly below).
        const prior = history.slice(0, history.length - 1).slice(-HISTORY_WINDOW);
        for (const msg of prior) {
            messages.push({ role: msg.role, content: msg.content });
        }
        messages.push({ role: "user", content });

        // 4. Prepare the assistant shell and stream into it.
        const assistant: ChatMessage = {
            id: generateId("msg"),
            projectId: project.id,
            role: "assistant",
            content: "",
            model: model.model,
            createdAt: Date.now(),
        };

        try {
            const res = await hub.complete(model.provider, {
                model: model.model,
                messages,
                temperature: 0.2,
                maxTokens: 1024,
                stream: true,
                signal: aborter.signal,
                onChunk: (c: string): void => {
                    if (!this.cancelled.has(project.id)) {
                        assistant.content += c;
                        events.onStream(assistant.id, c);
                    }
                },
            });

            const citations: ChatCitation[] = this.store.toCitations(retrieved);
            if (citations.length > 0) {
                assistant.citations = citations;
            }

            history.push(assistant);
            await this.save(project.id);

            if (res.cost > 0) {
                cost.record({
                    agentId: "project-assistant",
                    projectId: project.id,
                    provider: model.provider,
                    model: model.model,
                    promptTokens: res.usage.promptTokens,
                    completionTokens: res.usage.completionTokens,
                    cost: res.cost,
                });
            }

            events.onMessage(assistant);
            events.onDone(assistant.id);
            this.cancelled.delete(project.id);
            this.aborters.delete(project.id);
            return assistant;
        } catch (err) {
            const wasCancelled = this.cancelled.has(project.id) || (err instanceof Error && err.name === "AbortError");
            const failureDetail = err instanceof Error ? err.message : String(err);
            if (isProviderUnavailableMessage(failureDetail)) {
                try {
                    await this.save(project.id);
                } catch {
                    // Keep the live typed error even if history persistence fails.
                }
                this.cancelled.delete(project.id);
                this.aborters.delete(project.id);
                throw err;
            }
            if (wasCancelled) {
                // User stopped it — keep whatever streamed so far rather than clobbering it.
                if (assistant.content.length === 0) assistant.content = "_(stopped)_";
            } else {
                const detail = err instanceof Error ? err.message : String(err);
                assistant.content = "I'm sorry — I ran into an error answering that: " + detail;
            }

            const citations: ChatCitation[] = this.store.toCitations(retrieved);
            if (citations.length > 0) {
                assistant.citations = citations;
            }

            history.push(assistant);
            try {
                await this.save(project.id);
            } catch {
                // Best-effort persistence; surface the assistant message regardless.
            }

            events.onMessage(assistant);
            events.onDone(assistant.id);
            this.cancelled.delete(project.id);
            this.aborters.delete(project.id);
            return assistant;
        }
    }

    /** Render retrieved chunks into a single labeled, cited context block. */
    private formatContext(chunks: RetrievedChunk[]): string {
        const blocks: string[] = [];
        for (const chunk of chunks) {
            let header: string;
            if (chunk.source === "code") {
                const start = chunk.lineStart ?? 0;
                const end = chunk.lineEnd ?? start;
                header = `[code] ${chunk.path} (L${start}-L${end}):`;
            } else {
                header = `[doc] ${chunk.path}:`;
            }
            blocks.push(header + "\n" + chunk.text);
        }
        return blocks.join("\n\n");
    }
}
