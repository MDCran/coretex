// Coretex LLM hub — unifies local (ollama, lmstudio) and cloud (openai, anthropic) providers
// behind one interface. Transport is the global fetch only; streaming via req.onChunk.

import type {
    LLMRequest,
    LLMResponse,
    ModelInfo,
    ProviderHealth,
    ProviderType,
    ProviderConfig,
    LLMMessage,
    OllamaModelDetail,
    OllamaPullProgress,
} from "../types.js";
import { detectCapabilities, detectFamily, enrichPricing } from "./model-meta.js";

// ---- Internal provider contract ----
interface Provider {
    complete(req: LLMRequest): Promise<LLMResponse>;
    listModels(): Promise<ModelInfo[]>;
    healthCheck(): Promise<ProviderHealth>;
}

// ---- Network timeouts ----
// Without these a TCP-open-but-silent endpoint (e.g. LM Studio's port open with no model
// loaded) wedges a fetch forever, which — through Promise.allSettled — would freeze the
// whole health/model refresh and any caller. AbortSignal.timeout throws a TimeoutError
// (distinct from the AbortError used for user cancellation) so callers can still tell them apart.
const COMPLETE_TIMEOUT_MS = 120_000; // generous: long completions/streams are normal
const HEALTH_TIMEOUT_MS = 8_000; // health checks + model listings must fail fast

/** Combine an optional caller signal with a fresh timeout signal. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
    const timeout = AbortSignal.timeout(ms);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** One-time warning when a cloud completion has token usage but no pricing entry (cost would be $0). */
const warnedNoPricing = new Set<string>();
function warnNoPricing(provider: ProviderType, model: string, cost: number, tokens: number): void {
    if (cost > 0 || tokens <= 0 || provider === "ollama" || provider === "lmstudio" || provider === "openclaw") return;
    const key = `${provider}:${model}`;
    if (warnedNoPricing.has(key)) return;
    warnedNoPricing.add(key);
    console.warn(`[llm-hub] no pricing entry for ${provider}/${model}; cost recorded as $0`);
}

// ---- Pricing tables (per 1,000,000 tokens, [inputPrice, outputPrice]) ----
type PricingTable = Record<string, [number, number]>;

const OPENAI_PRICING: PricingTable = {
    "gpt-4o": [5, 15],
    "gpt-4o-mini": [0.15, 0.6],
    "o1": [15, 60],
    "o1-mini": [1.1, 4.4],
    "o3-mini": [1.1, 4.4],
    "gpt-4-turbo": [10, 30],
    "gpt-3.5-turbo": [0.5, 1.5],
};

const ANTHROPIC_PRICING: PricingTable = {
    "claude-opus-4-5": [15, 75],
    "claude-sonnet-4-5": [3, 15],
    "claude-haiku-4-5": [0.25, 1.25],
    "claude-3-5-sonnet": [3, 15],
    "claude-3-5-haiku": [0.8, 4],
    "claude-3-opus": [15, 75],
};

function calcCost(
    pricing: PricingTable,
    model: string,
    promptTok: number,
    compTok: number,
): number {
    for (const key of Object.keys(pricing)) {
        if (model.includes(key)) {
            const entry: [number, number] = pricing[key];
            const inPrice: number = entry[0];
            const outPrice: number = entry[1];
            return (promptTok * inPrice + compTok * outPrice) / 1e6;
        }
    }
    return 0;
}

/** Look up a model's per-1M pricing from a table (same key-substring match as calcCost). */
function pricingFor(pricing: PricingTable, model: string): { inputPer1M?: number; outputPer1M?: number } | undefined {
    for (const key of Object.keys(pricing)) {
        if (model.includes(key)) return { inputPer1M: pricing[key][0], outputPer1M: pricing[key][1] };
    }
    return undefined;
}

// ---- SSE / stream helpers ----
async function* iterStreamLines(res: Response): AsyncGenerator<string> {
    const body: ReadableStream<Uint8Array> | null = res.body;
    if (!body) {
        return;
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
    const decoder: TextDecoder = new TextDecoder();
    let buffer: string = "";
    for (;;) {
        const result: ReadableStreamReadResult<Uint8Array> = await reader.read();
        if (result.done) {
            break;
        }
        buffer += decoder.decode(result.value, { stream: true });
        let newlineIndex: number = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
            const line: string = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            yield line;
            newlineIndex = buffer.indexOf("\n");
        }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) {
        const remaining: string[] = buffer.split("\n");
        for (const line of remaining) {
            yield line;
        }
    }
}

// ---- Shared OpenAI-compatible completion ----
async function openAICompatComplete(
    baseUrl: string,
    apiKey: string,
    provider: ProviderType,
    req: LLMRequest,
    pricingTable: PricingTable,
): Promise<LLMResponse> {
    const url: string = baseUrl + "/v1/chat/completions";
    const headers: Record<string, string> = {
        "content-type": "application/json",
    };
    if (apiKey) {
        headers["Authorization"] = "Bearer " + apiKey;
    }

    const stream: boolean = !!req.stream;
    // OpenAI reasoning models (o1/o3/o4) reject `temperature` and use `max_completion_tokens`
    // instead of `max_tokens`. Scope this to OpenAI so LM Studio (which shares this helper) is
    // unaffected, and anchor the regex so gpt-4o isn't matched.
    const isReasoning: boolean = provider === "openai" && /^(o1|o3|o4)(-|$)/.test(req.model);
    // Transform any message carrying inline images into OpenAI's multimodal content-array shape
    // (text part + image_url data-URLs). Text-only messages stay as plain strings.
    const wireMessages = req.messages.map((m: LLMMessage): Record<string, unknown> => {
        if (m.images && m.images.length > 0) {
            const parts: Record<string, unknown>[] = [];
            if (m.content) parts.push({ type: "text", text: m.content });
            for (const img of m.images) {
                parts.push({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.dataBase64}` } });
            }
            return { role: m.role, content: parts };
        }
        return { role: m.role, content: m.content };
    });
    const body: string = JSON.stringify({
        model: req.model,
        messages: wireMessages,
        ...(isReasoning ? {} : { temperature: req.temperature }),
        // OpenAI reasoning effort hint (gpt-5/o-series). Harmless seam for others (only sent to openai).
        ...(provider === "openai" && req.effort ? { reasoning_effort: req.effort } : {}),
        ...(isReasoning
            ? req.maxTokens != null ? { max_completion_tokens: req.maxTokens } : {}
            : { max_tokens: req.maxTokens }),
        stream,
        // Ask for a final usage chunk on streamed responses so cost isn't silently $0.
        ...(stream ? { stream_options: { include_usage: true } } : {}),
    });

    const startedAt: number = Date.now();
    const res: Response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: withTimeout(req.signal, COMPLETE_TIMEOUT_MS),
    });
    if (!res.ok) {
        const detail: string = await res.text().catch((): string => "");
        throw new Error(
            `${provider} completion failed: ${res.status} ${res.statusText} ${detail}`.trim(),
        );
    }

    let content: string = "";
    let promptTokens: number = 0;
    let completionTokens: number = 0;

    const hasPricing: boolean = Object.keys(pricingTable).length > 0;

    if (stream) {
        for await (const rawLine of iterStreamLines(res)) {
            const line: string = rawLine.trim();
            if (!line.startsWith("data:")) {
                continue;
            }
            const data: string = line.slice("data:".length).trim();
            if (data === "[DONE]" || data.length === 0) {
                continue;
            }
            let parsed: unknown;
            try {
                parsed = JSON.parse(data);
            } catch {
                continue;
            }
            const obj: Record<string, unknown> = parsed as Record<string, unknown>;
            const choices: unknown = obj["choices"];
            if (Array.isArray(choices) && choices.length > 0) {
                const first: Record<string, unknown> = choices[0] as Record<string, unknown>;
                const delta: unknown = first["delta"];
                if (delta && typeof delta === "object") {
                    const deltaContent: unknown = (delta as Record<string, unknown>)["content"];
                    if (typeof deltaContent === "string" && deltaContent.length > 0) {
                        content += deltaContent;
                        if (req.onChunk) {
                            req.onChunk(deltaContent);
                        }
                    }
                }
            }
            const usage: unknown = obj["usage"];
            if (usage && typeof usage === "object") {
                const u: Record<string, unknown> = usage as Record<string, unknown>;
                if (typeof u["prompt_tokens"] === "number") {
                    promptTokens = u["prompt_tokens"];
                }
                if (typeof u["completion_tokens"] === "number") {
                    completionTokens = u["completion_tokens"];
                }
            }
        }
    } else {
        const json: unknown = await res.json();
        const obj: Record<string, unknown> = json as Record<string, unknown>;
        const choices: unknown = obj["choices"];
        if (Array.isArray(choices) && choices.length > 0) {
            const first: Record<string, unknown> = choices[0] as Record<string, unknown>;
            const message: unknown = first["message"];
            if (message && typeof message === "object") {
                const msgContent: unknown = (message as Record<string, unknown>)["content"];
                if (typeof msgContent === "string") {
                    content = msgContent;
                }
            }
        }
        const usage: unknown = obj["usage"];
        if (usage && typeof usage === "object") {
            const u: Record<string, unknown> = usage as Record<string, unknown>;
            if (typeof u["prompt_tokens"] === "number") {
                promptTokens = u["prompt_tokens"];
            }
            if (typeof u["completion_tokens"] === "number") {
                completionTokens = u["completion_tokens"];
            }
        }
    }

    const latencyMs: number = Date.now() - startedAt;
    const cost: number = hasPricing
        ? calcCost(pricingTable, req.model, promptTokens, completionTokens)
        : 0;
    warnNoPricing(provider, req.model, cost, promptTokens + completionTokens);

    return {
        content,
        model: req.model,
        provider,
        usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
        },
        cost,
        latencyMs,
    };
}

// ---- Ollama (local) ----
class OllamaProvider implements Provider {
    private readonly baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    async complete(req: LLMRequest): Promise<LLMResponse> {
        const url: string = this.baseUrl + "/api/chat";
        const stream: boolean = !!req.stream;
        // Ollama chat carries images as a per-message base64 array (vision models); text-only unchanged.
        const wireMessages = req.messages.map((m: LLMMessage): Record<string, unknown> =>
            m.images && m.images.length > 0
                ? { role: m.role, content: m.content, images: m.images.map((img) => img.dataBase64) }
                : { role: m.role, content: m.content },
        );
        const body: string = JSON.stringify({
            model: req.model,
            messages: wireMessages,
            stream,
            options: {
                temperature: req.temperature,
                num_predict: req.maxTokens,
            },
        });

        const startedAt: number = Date.now();
        const res: Response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            signal: withTimeout(req.signal, COMPLETE_TIMEOUT_MS),
        });
        if (!res.ok) {
            const detail: string = await res.text().catch((): string => "");
            throw new Error(
                `ollama completion failed: ${res.status} ${res.statusText} ${detail}`.trim(),
            );
        }

        let content: string = "";
        let promptTokens: number = 0;
        let completionTokens: number = 0;

        if (stream) {
            for await (const rawLine of iterStreamLines(res)) {
                const line: string = rawLine.trim();
                if (line.length === 0) {
                    continue;
                }
                let parsed: unknown;
                try {
                    parsed = JSON.parse(line);
                } catch {
                    continue;
                }
                const obj: Record<string, unknown> = parsed as Record<string, unknown>;
                const message: unknown = obj["message"];
                if (message && typeof message === "object") {
                    const msgContent: unknown = (message as Record<string, unknown>)["content"];
                    if (typeof msgContent === "string" && msgContent.length > 0) {
                        content += msgContent;
                        if (req.onChunk) {
                            req.onChunk(msgContent);
                        }
                    }
                }
                if (obj["done"] === true) {
                    if (typeof obj["prompt_eval_count"] === "number") {
                        promptTokens = obj["prompt_eval_count"];
                    }
                    if (typeof obj["eval_count"] === "number") {
                        completionTokens = obj["eval_count"];
                    }
                }
            }
        } else {
            const json: unknown = await res.json();
            const obj: Record<string, unknown> = json as Record<string, unknown>;
            const message: unknown = obj["message"];
            if (message && typeof message === "object") {
                const msgContent: unknown = (message as Record<string, unknown>)["content"];
                if (typeof msgContent === "string") {
                    content = msgContent;
                }
            }
            if (typeof obj["prompt_eval_count"] === "number") {
                promptTokens = obj["prompt_eval_count"];
            }
            if (typeof obj["eval_count"] === "number") {
                completionTokens = obj["eval_count"];
            }
        }

        const latencyMs: number = Date.now() - startedAt;
        return {
            content,
            model: req.model,
            provider: "ollama",
            usage: {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
            },
            cost: 0,
            latencyMs,
        };
    }

    async listModels(): Promise<ModelInfo[]> {
        const url: string = this.baseUrl + "/api/tags";
        const res: Response = await fetch(url, { method: "GET", signal: withTimeout(undefined, HEALTH_TIMEOUT_MS) });
        if (!res.ok) {
            const detail: string = await res.text().catch((): string => "");
            throw new Error(
                `ollama listModels failed: ${res.status} ${res.statusText} ${detail}`.trim(),
            );
        }
        const json: unknown = await res.json();
        const obj: Record<string, unknown> = json as Record<string, unknown>;
        const models: unknown = obj["models"];

        // Best-effort: which models are currently loaded/running (GET /api/ps).
        const running: Set<string> = new Set<string>();
        try {
            const psRes: Response = await fetch(this.baseUrl + "/api/ps", { method: "GET", signal: withTimeout(undefined, HEALTH_TIMEOUT_MS) });
            if (psRes.ok) {
                const ps: Record<string, unknown> = (await psRes.json()) as Record<string, unknown>;
                if (Array.isArray(ps["models"])) {
                    for (const r of ps["models"] as Array<Record<string, unknown>>) {
                        if (typeof r?.["name"] === "string") running.add(r["name"] as string);
                    }
                }
            }
        } catch {
            // /api/ps is optional — running state just won't be shown.
        }

        const out: ModelInfo[] = [];
        if (Array.isArray(models)) {
            for (const entry of models) {
                if (!entry || typeof entry !== "object") continue;
                const e: Record<string, unknown> = entry as Record<string, unknown>;
                const name: unknown = e["name"];
                if (typeof name !== "string") continue;
                const details: Record<string, unknown> = e["details"] && typeof e["details"] === "object" ? (e["details"] as Record<string, unknown>) : {};
                out.push({
                    id: name,
                    name,
                    provider: "ollama",
                    displayName: name,
                    family: typeof details["family"] === "string" ? (details["family"] as string) : detectFamily(name),
                    paramSize: typeof details["parameter_size"] === "string" ? (details["parameter_size"] as string) : undefined,
                    quantization: typeof details["quantization_level"] === "string" ? (details["quantization_level"] as string) : undefined,
                    sizeBytes: typeof e["size"] === "number" ? (e["size"] as number) : undefined,
                    modifiedAt: typeof e["modified_at"] === "string" ? Date.parse(e["modified_at"] as string) || undefined : undefined,
                    capabilities: detectCapabilities("ollama", name),
                    state: running.has(name) ? "running" : "downloaded",
                });
            }
        }
        return out;
    }

    async healthCheck(): Promise<ProviderHealth> {
        const startedAt: number = Date.now();
        try {
            const models: ModelInfo[] = await this.listModels();
            return {
                provider: "ollama",
                healthy: true,
                latencyMs: Date.now() - startedAt,
                models,
            };
        } catch (err: unknown) {
            return {
                provider: "ollama",
                healthy: false,
                latencyMs: Date.now() - startedAt,
                error: err instanceof Error ? err.message : String(err),
                models: [],
            };
        }
    }

    // ---- Model management (AI providers settings) ----

    /** Rich model list (size, params, quantization) via GET /api/tags. */
    async listModelsDetailed(): Promise<OllamaModelDetail[]> {
        const res: Response = await fetch(this.baseUrl + "/api/tags", { method: "GET", signal: withTimeout(undefined, HEALTH_TIMEOUT_MS) });
        if (!res.ok) {
            const detail: string = await res.text().catch((): string => "");
            throw new Error(`ollama tags failed: ${res.status} ${res.statusText} ${detail}`.trim());
        }
        const json: unknown = await res.json();
        const obj: Record<string, unknown> = json as Record<string, unknown>;
        const models: unknown = obj["models"];
        const out: OllamaModelDetail[] = [];
        if (Array.isArray(models)) {
            for (const entry of models) {
                if (!entry || typeof entry !== "object") {
                    continue;
                }
                const e: Record<string, unknown> = entry as Record<string, unknown>;
                const name: unknown = e["name"];
                if (typeof name !== "string") {
                    continue;
                }
                const details: Record<string, unknown> =
                    e["details"] && typeof e["details"] === "object"
                        ? (e["details"] as Record<string, unknown>)
                        : {};
                out.push({
                    name,
                    size: typeof e["size"] === "number" ? e["size"] : 0,
                    parameterSize: typeof details["parameter_size"] === "string" ? details["parameter_size"] : undefined,
                    quantization: typeof details["quantization_level"] === "string" ? details["quantization_level"] : undefined,
                    family: typeof details["family"] === "string" ? details["family"] : undefined,
                    modifiedAt: typeof e["modified_at"] === "string" ? e["modified_at"] : undefined,
                });
            }
        }
        out.sort((a, b): number => a.name.localeCompare(b.name));
        return out;
    }

    /** Download a model from the registry, streaming progress via POST /api/pull. */
    async pull(model: string, onProgress: (p: OllamaPullProgress) => void): Promise<void> {
        const res: Response = await fetch(this.baseUrl + "/api/pull", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model, stream: true }),
        });
        if (!res.ok) {
            const detail: string = await res.text().catch((): string => "");
            throw new Error(`ollama pull failed: ${res.status} ${res.statusText} ${detail}`.trim());
        }
        for await (const rawLine of iterStreamLines(res)) {
            const line: string = rawLine.trim();
            if (line.length === 0) {
                continue;
            }
            let parsed: unknown;
            try {
                parsed = JSON.parse(line);
            } catch {
                continue;
            }
            const obj: Record<string, unknown> = parsed as Record<string, unknown>;
            const errVal: unknown = obj["error"];
            if (typeof errVal === "string") {
                onProgress({ model, status: "error", percent: 0, done: true, error: errVal });
                throw new Error(errVal);
            }
            const status: string = typeof obj["status"] === "string" ? (obj["status"] as string) : "";
            const completed: number | undefined = typeof obj["completed"] === "number" ? (obj["completed"] as number) : undefined;
            const total: number | undefined = typeof obj["total"] === "number" ? (obj["total"] as number) : undefined;
            const percent: number =
                total && total > 0 && completed !== undefined ? Math.round((completed / total) * 100) : -1;
            const done: boolean = status === "success";
            onProgress({ model, status, completed, total, percent, done });
        }
        onProgress({ model, status: "success", percent: 100, done: true });
    }

    /** Remove a model via DELETE /api/delete. */
    async deleteModel(model: string): Promise<void> {
        const res: Response = await fetch(this.baseUrl + "/api/delete", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model }),
            signal: withTimeout(undefined, HEALTH_TIMEOUT_MS),
        });
        if (!res.ok) {
            const detail: string = await res.text().catch((): string => "");
            throw new Error(`ollama delete failed: ${res.status} ${res.statusText} ${detail}`.trim());
        }
    }

    /** Model info (params, template, license, quantization) via POST /api/show. */
    async show(model: string): Promise<Record<string, string>> {
        const res: Response = await fetch(this.baseUrl + "/api/show", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model }),
            signal: withTimeout(undefined, HEALTH_TIMEOUT_MS),
        });
        if (!res.ok) {
            const detail: string = await res.text().catch((): string => "");
            throw new Error(`ollama show failed: ${res.status} ${res.statusText} ${detail}`.trim());
        }
        const json: unknown = await res.json();
        const obj: Record<string, unknown> = json as Record<string, unknown>;
        const out: Record<string, string> = {};
        const details: unknown = obj["details"];
        if (details && typeof details === "object") {
            for (const [k, v] of Object.entries(details as Record<string, unknown>)) {
                out[k] = typeof v === "string" ? v : JSON.stringify(v);
            }
        }
        if (typeof obj["parameters"] === "string") {
            out["parameters"] = obj["parameters"] as string;
        }
        if (typeof obj["template"] === "string") {
            out["template"] = obj["template"] as string;
        }
        if (typeof obj["license"] === "string") {
            out["license"] = (obj["license"] as string).slice(0, 4000);
        }
        const modelInfo: unknown = obj["model_info"];
        if (modelInfo && typeof modelInfo === "object") {
            const mi: Record<string, unknown> = modelInfo as Record<string, unknown>;
            const arch: unknown = mi["general.architecture"];
            if (typeof arch === "string") {
                out["architecture"] = arch;
            }
        }
        return out;
    }
}

// ---- LM Studio (local, OpenAI-compatible) ----
class LMStudioProvider implements Provider {
    private readonly baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    async complete(req: LLMRequest): Promise<LLMResponse> {
        return openAICompatComplete(this.baseUrl, "", "lmstudio", req, {});
    }

    async listModels(): Promise<ModelInfo[]> {
        const url: string = this.baseUrl + "/v1/models";
        const res: Response = await fetch(url, { method: "GET", signal: withTimeout(undefined, HEALTH_TIMEOUT_MS) });
        if (!res.ok) {
            const detail: string = await res.text().catch((): string => "");
            throw new Error(
                `lmstudio listModels failed: ${res.status} ${res.statusText} ${detail}`.trim(),
            );
        }
        const json: unknown = await res.json();
        const obj: Record<string, unknown> = json as Record<string, unknown>;
        const data: unknown = obj["data"];
        const out: ModelInfo[] = [];
        if (Array.isArray(data)) {
            for (const entry of data) {
                if (entry && typeof entry === "object") {
                    const e = entry as Record<string, unknown>;
                    const id: unknown = e["id"];
                    if (typeof id === "string") {
                        // LM Studio's native /api/v0/models adds arch/quant/state/context; tolerate either shape.
                        out.push({
                            id,
                            name: id,
                            provider: "lmstudio",
                            displayName: id,
                            family: typeof e["arch"] === "string" ? (e["arch"] as string) : detectFamily(id),
                            quantization: typeof e["quantization"] === "string" ? (e["quantization"] as string) : undefined,
                            contextLength: typeof e["max_context_length"] === "number" ? (e["max_context_length"] as number) : typeof e["loaded_context_length"] === "number" ? (e["loaded_context_length"] as number) : undefined,
                            capabilities: detectCapabilities("lmstudio", id),
                            state: e["state"] === "loaded" ? "loaded" : "downloaded",
                        });
                    }
                }
            }
        }
        return out;
    }

    async healthCheck(): Promise<ProviderHealth> {
        const startedAt: number = Date.now();
        try {
            const models: ModelInfo[] = await this.listModels();
            return {
                provider: "lmstudio",
                healthy: true,
                latencyMs: Date.now() - startedAt,
                models,
            };
        } catch (err: unknown) {
            return {
                provider: "lmstudio",
                healthy: false,
                latencyMs: Date.now() - startedAt,
                error: err instanceof Error ? err.message : String(err),
                models: [],
            };
        }
    }
}

// ---- OpenAI (cloud) ----
class OpenAIProvider implements Provider {
    private readonly apiKey: string;
    private readonly baseUrl: string;

    constructor(apiKey: string, baseUrl: string = "https://api.openai.com") {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }

    async complete(req: LLMRequest): Promise<LLMResponse> {
        if (!this.apiKey) throw new Error("OpenAI API key not configured");
        return openAICompatComplete(this.baseUrl, this.apiKey, "openai", req, OPENAI_PRICING);
    }

    async listModels(): Promise<ModelInfo[]> {
        const url: string = this.baseUrl + "/v1/models";
        const headers: Record<string, string> = {};
        if (this.apiKey) {
            headers["Authorization"] = "Bearer " + this.apiKey;
        }
        const res: Response = await fetch(url, { method: "GET", headers, signal: withTimeout(undefined, HEALTH_TIMEOUT_MS) });
        if (!res.ok) {
            const detail: string = await res.text().catch((): string => "");
            throw new Error(
                `openai listModels failed: ${res.status} ${res.statusText} ${detail}`.trim(),
            );
        }
        const json: unknown = await res.json();
        const obj: Record<string, unknown> = json as Record<string, unknown>;
        const data: unknown = obj["data"];
        const out: ModelInfo[] = [];
        if (Array.isArray(data)) {
            for (const entry of data) {
                if (entry && typeof entry === "object") {
                    const id: unknown = (entry as Record<string, unknown>)["id"];
                    if (typeof id === "string") {
                        // Include all account models; capabilities bucket chat/embedding/audio/image so pickers can filter.
                        out.push({
                            id,
                            name: id,
                            provider: "openai",
                            displayName: id,
                            family: detectFamily(id),
                            capabilities: detectCapabilities("openai", id),
                            pricing: enrichPricing("openai", pricingFor(OPENAI_PRICING, id), detectCapabilities("openai", id)),
                        });
                    }
                }
            }
        }
        return out;
    }

    async healthCheck(): Promise<ProviderHealth> {
        const startedAt: number = Date.now();
        try {
            const models: ModelInfo[] = await this.listModels();
            return {
                provider: "openai",
                healthy: true,
                latencyMs: Date.now() - startedAt,
                models,
            };
        } catch (err: unknown) {
            return {
                provider: "openai",
                healthy: false,
                latencyMs: Date.now() - startedAt,
                error: err instanceof Error ? err.message : String(err),
                models: [],
            };
        }
    }
}

/**
 * Generic OpenAI-compatible cloud/gateway provider (OpenRouter, OpenClaw gateway, etc.).
 * Same /v1/chat/completions + /v1/models surface; provider id is preserved on ModelInfo.
 */
class OpenAICompatProvider implements Provider {
    constructor(
        private readonly providerId: ProviderType,
        private readonly apiKey: string,
        private readonly baseUrl: string,
    ) {}

    async complete(req: LLMRequest): Promise<LLMResponse> {
        // OpenClaw local gateways often don't need a key; OpenRouter does.
        if (this.providerId === "openrouter" && !this.apiKey) {
            throw new Error("OpenRouter API key not configured");
        }
        return openAICompatComplete(this.baseUrl, this.apiKey, this.providerId, req, {});
    }

    async listModels(): Promise<ModelInfo[]> {
        const url: string = this.baseUrl.replace(/\/$/, "") + "/v1/models";
        const headers: Record<string, string> = {};
        if (this.apiKey) headers["Authorization"] = "Bearer " + this.apiKey;
        const res: Response = await fetch(url, { method: "GET", headers, signal: withTimeout(undefined, HEALTH_TIMEOUT_MS) });
        if (!res.ok) {
            const detail: string = await res.text().catch((): string => "");
            throw new Error(`${this.providerId} listModels failed: ${res.status} ${res.statusText} ${detail}`.trim());
        }
        const json: unknown = await res.json();
        const data: unknown = (json as Record<string, unknown>)["data"];
        const out: ModelInfo[] = [];
        if (Array.isArray(data)) {
            for (const entry of data) {
                if (entry && typeof entry === "object") {
                    const id: unknown = (entry as Record<string, unknown>)["id"];
                    if (typeof id === "string") {
                        out.push({
                            id,
                            name: id,
                            provider: this.providerId,
                            displayName: id,
                            family: detectFamily(id),
                            capabilities: detectCapabilities(this.providerId, id),
                            pricing: enrichPricing(this.providerId, undefined, detectCapabilities(this.providerId, id)),
                        });
                    }
                }
            }
        }
        return out;
    }

    async healthCheck(): Promise<ProviderHealth> {
        const startedAt: number = Date.now();
        try {
            const models: ModelInfo[] = await this.listModels();
            return { provider: this.providerId, healthy: true, latencyMs: Date.now() - startedAt, models };
        } catch (err: unknown) {
            return {
                provider: this.providerId,
                healthy: false,
                latencyMs: Date.now() - startedAt,
                error: err instanceof Error ? err.message : String(err),
                models: [],
            };
        }
    }
}

// ---- Anthropic (cloud) ----
class AnthropicProvider implements Provider {
    /** Offline fallback when /v1/models is unreachable; live discovery is preferred. */
    private static readonly MODELS: ModelInfo[] = ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-3-5-sonnet", "claude-3-5-haiku"].map((id) =>
        AnthropicProvider.toModel(id, id),
    );

    /** Normalize an anthropic model id → enriched ModelInfo (caps + pricing + family). */
    private static toModel(id: string, displayName?: string): ModelInfo {
        return {
            id,
            name: id,
            provider: "anthropic",
            displayName: displayName ?? id,
            family: "claude",
            contextLength: 200000,
            capabilities: detectCapabilities("anthropic", id),
            pricing: enrichPricing("anthropic", pricingFor(ANTHROPIC_PRICING, id), detectCapabilities("anthropic", id)),
        };
    }

    private readonly apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async complete(req: LLMRequest): Promise<LLMResponse> {
        if (!this.apiKey) throw new Error("Anthropic API key not configured");
        const url: string = "https://api.anthropic.com/v1/messages";
        const headers: Record<string, string> = {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        };

        let system: string = "";
        // Anthropic messages: text-only stay as {role, content:string}; image-bearing user messages
        // become a content-block array ([{type:"text"}, {type:"image", source:{type:"base64",…}}]).
        const messages: Record<string, unknown>[] = [];
        for (const msg of req.messages) {
            if (msg.role === "system") {
                system = system.length > 0 ? system + "\n" + msg.content : msg.content;
            } else if (msg.images && msg.images.length > 0) {
                const blocks: Record<string, unknown>[] = [];
                if (msg.content) blocks.push({ type: "text", text: msg.content });
                for (const img of msg.images) {
                    blocks.push({ type: "image", source: { type: "base64", media_type: img.mime, data: img.dataBase64 } });
                }
                messages.push({ role: msg.role, content: blocks });
            } else {
                messages.push({ role: msg.role, content: msg.content });
            }
        }

        const stream: boolean = !!req.stream;
        const body: string = JSON.stringify({
            model: req.model,
            system,
            messages,
            max_tokens: req.maxTokens ?? 1024,
            temperature: req.temperature,
            stream,
            // Server-side web search tool is trivially available on Anthropic — enable it on request.
            ...(req.search ? { tools: [{ type: "web_search_20250305", name: "web_search" }] } : {}),
        });

        const startedAt: number = Date.now();
        const res: Response = await fetch(url, {
            method: "POST",
            headers,
            body,
            signal: withTimeout(req.signal, COMPLETE_TIMEOUT_MS),
        });
        if (!res.ok) {
            const detail: string = await res.text().catch((): string => "");
            throw new Error(
                `anthropic completion failed: ${res.status} ${res.statusText} ${detail}`.trim(),
            );
        }

        let content: string = "";
        let promptTokens: number = 0;
        let completionTokens: number = 0;

        if (stream) {
            for await (const rawLine of iterStreamLines(res)) {
                const line: string = rawLine.trim();
                if (!line.startsWith("data:")) {
                    continue;
                }
                const data: string = line.slice("data:".length).trim();
                if (data === "[DONE]" || data.length === 0) {
                    continue;
                }
                let parsed: unknown;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    continue;
                }
                const obj: Record<string, unknown> = parsed as Record<string, unknown>;
                const type: unknown = obj["type"];
                if (type === "message_start") {
                    const message: unknown = obj["message"];
                    if (message && typeof message === "object") {
                        const usage: unknown = (message as Record<string, unknown>)["usage"];
                        if (usage && typeof usage === "object") {
                            const inTok: unknown = (usage as Record<string, unknown>)["input_tokens"];
                            if (typeof inTok === "number") {
                                promptTokens = inTok;
                            }
                        }
                    }
                } else if (type === "content_block_delta") {
                    const delta: unknown = obj["delta"];
                    if (delta && typeof delta === "object") {
                        const text: unknown = (delta as Record<string, unknown>)["text"];
                        if (typeof text === "string" && text.length > 0) {
                            content += text;
                            if (req.onChunk) {
                                req.onChunk(text);
                            }
                        }
                    }
                } else if (type === "message_delta") {
                    const usage: unknown = obj["usage"];
                    if (usage && typeof usage === "object") {
                        const outTok: unknown = (usage as Record<string, unknown>)["output_tokens"];
                        if (typeof outTok === "number") {
                            completionTokens = outTok;
                        }
                    }
                }
            }
        } else {
            const json: unknown = await res.json();
            const obj: Record<string, unknown> = json as Record<string, unknown>;
            const contentArr: unknown = obj["content"];
            if (Array.isArray(contentArr) && contentArr.length > 0) {
                const first: unknown = contentArr[0];
                if (first && typeof first === "object") {
                    const text: unknown = (first as Record<string, unknown>)["text"];
                    if (typeof text === "string") {
                        content = text;
                    }
                }
            }
            const usage: unknown = obj["usage"];
            if (usage && typeof usage === "object") {
                const u: Record<string, unknown> = usage as Record<string, unknown>;
                if (typeof u["input_tokens"] === "number") {
                    promptTokens = u["input_tokens"];
                }
                if (typeof u["output_tokens"] === "number") {
                    completionTokens = u["output_tokens"];
                }
            }
        }

        const latencyMs: number = Date.now() - startedAt;
        const cost: number = calcCost(ANTHROPIC_PRICING, req.model, promptTokens, completionTokens);
        warnNoPricing("anthropic", req.model, cost, promptTokens + completionTokens);

        return {
            content,
            model: req.model,
            provider: "anthropic",
            usage: {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
            },
            cost,
            latencyMs,
        };
    }

    async listModels(): Promise<ModelInfo[]> {
        // Live discovery via GET /v1/models; fall back to the known set if unreachable/no key.
        if (!this.apiKey) return AnthropicProvider.MODELS.map((model) => ({ ...model, stale: true }));
        try {
            const res: Response = await fetch("https://api.anthropic.com/v1/models?limit=100", {
                method: "GET",
                headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
                signal: withTimeout(undefined, HEALTH_TIMEOUT_MS),
            });
            if (!res.ok) return AnthropicProvider.MODELS.map((model) => ({ ...model, stale: true }));
            const json = (await res.json()) as Record<string, unknown>;
            const data = json["data"];
            if (!Array.isArray(data)) return AnthropicProvider.MODELS.map((model) => ({ ...model, stale: true }));
            const out: ModelInfo[] = [];
            for (const entry of data as Array<Record<string, unknown>>) {
                if (typeof entry?.["id"] === "string") {
                    out.push(AnthropicProvider.toModel(entry["id"] as string, typeof entry["display_name"] === "string" ? (entry["display_name"] as string) : undefined));
                }
            }
            return out.length > 0 ? out : AnthropicProvider.MODELS.map((model) => ({ ...model, stale: true }));
        } catch {
            return AnthropicProvider.MODELS.map((model) => ({ ...model, stale: true }));
        }
    }

    async healthCheck(): Promise<ProviderHealth> {
        const startedAt: number = Date.now();
        try {
            // Model-agnostic probe (GET /v1/models) — avoids a false-negative if a specific
            // hardcoded model is retired or not enabled on the account.
            const res: Response = await fetch("https://api.anthropic.com/v1/models?limit=100", {
                method: "GET",
                headers: {
                    "x-api-key": this.apiKey,
                    "anthropic-version": "2023-06-01",
                },
                signal: withTimeout(undefined, HEALTH_TIMEOUT_MS),
            });
            if (!res.ok) {
                const detail: string = await res.text().catch((): string => "");
                return {
                    provider: "anthropic",
                    healthy: false,
                    latencyMs: Date.now() - startedAt,
                    error: `${res.status} ${res.statusText} ${detail}`.trim(),
                    models: [],
                };
            }
            const json = (await res.json()) as Record<string, unknown>;
            const data = json["data"];
            const models: ModelInfo[] = [];
            if (Array.isArray(data)) {
                for (const entry of data as Array<Record<string, unknown>>) {
                    if (typeof entry?.["id"] !== "string") continue;
                    models.push(AnthropicProvider.toModel(entry["id"] as string, typeof entry["display_name"] === "string" ? (entry["display_name"] as string) : undefined));
                }
            }
            if (models.length === 0) {
                return {
                    provider: "anthropic",
                    healthy: false,
                    latencyMs: Date.now() - startedAt,
                    error: "Anthropic responded but returned no live models for this account.",
                    models: [],
                };
            }
            return {
                provider: "anthropic",
                healthy: true,
                latencyMs: Date.now() - startedAt,
                models,
            };
        } catch (err: unknown) {
            return {
                provider: "anthropic",
                healthy: false,
                latencyMs: Date.now() - startedAt,
                error: err instanceof Error ? err.message : String(err),
                models: [],
            };
        }
    }
}

const GEMINI_PRICING: PricingTable = {
    "gemini-2.0-flash": [0.1, 0.4],
    "gemini-1.5-flash": [0.075, 0.3],
    "gemini-1.5-pro": [1.25, 5],
    "gemini-2.5-pro": [1.25, 10],
};

// ---- Gemini (Google) ----
// Google's API differs from OpenAI/Anthropic: a `systemInstruction`, a
// `contents` array of {role:"user"|"model", parts:[{text}]}, and a
// `generationConfig`. This wrapper normalizes our LLMRequest into that shape.
class GeminiProvider implements Provider {
    // Offline fallback, enriched with capabilities + pricing so capability-filtered pickers
    // still surface Gemini when discovery is unreachable.
    private static readonly MODELS: ModelInfo[] = ["gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"].map((id) => ({
        id,
        name: id,
        provider: "gemini" as ProviderType,
        displayName: id,
        family: detectFamily(id),
        contextLength: id.includes("1.5-pro") ? 2_000_000 : 1_000_000,
        capabilities: detectCapabilities("gemini", id),
        pricing: enrichPricing("gemini", pricingFor(GEMINI_PRICING, id), detectCapabilities("gemini", id)),
    }));

    private readonly apiKey: string;
    private readonly base = "https://generativelanguage.googleapis.com/v1beta";

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async complete(req: LLMRequest): Promise<LLMResponse> {
        if (!this.apiKey) throw new Error("Gemini API key not configured");
        let system = "";
        // Gemini parts: text + optional inlineData (base64 image) blocks per message.
        const contents: { role: string; parts: Record<string, unknown>[] }[] = [];
        for (const msg of req.messages) {
            if (msg.role === "system") {
                system = system.length > 0 ? system + "\n" + msg.content : msg.content;
            } else {
                const parts: Record<string, unknown>[] = [];
                if (msg.content) parts.push({ text: msg.content });
                for (const img of msg.images ?? []) {
                    parts.push({ inlineData: { mimeType: img.mime, data: img.dataBase64 } });
                }
                if (parts.length === 0) parts.push({ text: "" });
                contents.push({ role: msg.role === "assistant" ? "model" : "user", parts });
            }
        }

        const stream: boolean = !!req.stream;
        const method = stream ? "streamGenerateContent" : "generateContent";
        const url = `${this.base}/models/${req.model}:${method}?key=${this.apiKey}${stream ? "&alt=sse" : ""}`;
        const body = JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents,
            generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens },
            // Google Search grounding tool is trivially available — enable it on request.
            ...(req.search ? { tools: [{ google_search: {} }] } : {}),
        });

        const startedAt = Date.now();
        const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            signal: withTimeout(req.signal, COMPLETE_TIMEOUT_MS),
        });
        if (!res.ok) {
            const detail = await res.text().catch((): string => "");
            throw new Error(`gemini completion failed: ${res.status} ${res.statusText} ${detail}`.trim());
        }

        let content = "";
        let promptTokens = 0;
        let completionTokens = 0;

        const handleObj = (obj: Record<string, unknown>): void => {
            const candidates = obj["candidates"];
            if (Array.isArray(candidates) && candidates.length > 0) {
                const first = candidates[0] as Record<string, unknown>;
                const c = first["content"];
                if (c && typeof c === "object") {
                    const parts = (c as Record<string, unknown>)["parts"];
                    if (Array.isArray(parts)) {
                        for (const p of parts) {
                            const text = (p as Record<string, unknown>)?.["text"];
                            if (typeof text === "string" && text.length > 0) {
                                content += text;
                                if (stream && req.onChunk) req.onChunk(text);
                            }
                        }
                    }
                }
            }
            const usage = obj["usageMetadata"];
            if (usage && typeof usage === "object") {
                const u = usage as Record<string, unknown>;
                if (typeof u["promptTokenCount"] === "number") promptTokens = u["promptTokenCount"];
                if (typeof u["candidatesTokenCount"] === "number") completionTokens = u["candidatesTokenCount"];
            }
        };

        if (stream) {
            for await (const rawLine of iterStreamLines(res)) {
                const line = rawLine.trim();
                if (!line.startsWith("data:")) continue;
                const data = line.slice("data:".length).trim();
                if (data.length === 0 || data === "[DONE]") continue;
                try {
                    handleObj(JSON.parse(data) as Record<string, unknown>);
                } catch {
                    /* partial line */
                }
            }
        } else {
            handleObj((await res.json()) as Record<string, unknown>);
        }

        const cost = calcCost(GEMINI_PRICING, req.model, promptTokens, completionTokens);
        warnNoPricing("gemini", req.model, cost, promptTokens + completionTokens);
        return {
            content,
            model: req.model,
            provider: "gemini",
            usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
            cost,
            latencyMs: Date.now() - startedAt,
        };
    }

    async listModels(): Promise<ModelInfo[]> {
        // Live discovery via GET /models; fall back to the enriched static set if unreachable/no key.
        if (!this.apiKey) return GeminiProvider.MODELS.map((model) => ({ ...model, stale: true }));
        try {
            const res = await fetch(`${this.base}/models?key=${this.apiKey}`, { method: "GET", signal: withTimeout(undefined, HEALTH_TIMEOUT_MS) });
            if (!res.ok) return GeminiProvider.MODELS.map((model) => ({ ...model, stale: true }));
            const json = (await res.json()) as Record<string, unknown>;
            const models = json["models"];
            if (!Array.isArray(models)) return GeminiProvider.MODELS.map((model) => ({ ...model, stale: true }));
            const out: ModelInfo[] = [];
            for (const entry of models as Array<Record<string, unknown>>) {
                const rawName = entry?.["name"];
                if (typeof rawName !== "string") continue;
                const id = rawName.replace(/^models\//, "");
                const caps = detectCapabilities("gemini", id);
                out.push({
                    id,
                    name: id,
                    provider: "gemini",
                    displayName: typeof entry["displayName"] === "string" ? (entry["displayName"] as string) : id,
                    family: detectFamily(id),
                    contextLength: typeof entry["inputTokenLimit"] === "number" ? (entry["inputTokenLimit"] as number) : 1_000_000,
                    capabilities: caps,
                    pricing: enrichPricing("gemini", pricingFor(GEMINI_PRICING, id), caps),
                });
            }
            return out.length > 0 ? out : GeminiProvider.MODELS.map((model) => ({ ...model, stale: true }));
        } catch {
            return GeminiProvider.MODELS.map((model) => ({ ...model, stale: true }));
        }
    }

    async healthCheck(): Promise<ProviderHealth> {
        const startedAt = Date.now();
        try {
            const res = await fetch(`${this.base}/models?key=${this.apiKey}`, { method: "GET", signal: withTimeout(undefined, HEALTH_TIMEOUT_MS) });
            if (!res.ok) {
                const detail = await res.text().catch((): string => "");
                return { provider: "gemini", healthy: false, latencyMs: Date.now() - startedAt, error: `${res.status} ${res.statusText} ${detail}`.trim(), models: [] };
            }
            const json = (await res.json()) as Record<string, unknown>;
            const data = json["models"];
            const models: ModelInfo[] = [];
            if (Array.isArray(data)) {
                for (const entry of data as Array<Record<string, unknown>>) {
                    const rawName = entry?.["name"];
                    if (typeof rawName !== "string") continue;
                    const id = rawName.replace(/^models\//, "");
                    const caps = detectCapabilities("gemini", id);
                    models.push({
                        id,
                        name: id,
                        provider: "gemini",
                        displayName: typeof entry["displayName"] === "string" ? (entry["displayName"] as string) : id,
                        family: detectFamily(id),
                        contextLength: typeof entry["inputTokenLimit"] === "number" ? (entry["inputTokenLimit"] as number) : 1_000_000,
                        capabilities: caps,
                        pricing: enrichPricing("gemini", pricingFor(GEMINI_PRICING, id), caps),
                    });
                }
            }
            if (models.length === 0) return { provider: "gemini", healthy: false, latencyMs: Date.now() - startedAt, error: "Gemini responded but returned no live models for this account.", models: [] };
            return { provider: "gemini", healthy: true, latencyMs: Date.now() - startedAt, models };
        } catch (err: unknown) {
            return { provider: "gemini", healthy: false, latencyMs: Date.now() - startedAt, error: err instanceof Error ? err.message : String(err), models: [] };
        }
    }
}

// ---- LLM Hub ----
export class ProviderUnavailableError extends Error {
    readonly code = "PROVIDER_UNAVAILABLE";

    constructor(
        readonly provider: ProviderType,
        readonly model: string | undefined,
        reason: string,
    ) {
        super(`[PROVIDER_UNAVAILABLE] ${provider}${model ? `/${model}` : ""}: ${reason}`);
        this.name = "ProviderUnavailableError";
    }
}

export function isProviderUnavailableMessage(message: string): boolean {
    return message.startsWith("[PROVIDER_UNAVAILABLE]");
}

function looksLikeAvailabilityFailure(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b(401|403|408|429|500|502|503|504)\b|auth|credential|connect|connection|network|fetch failed|offline|timed?\s*out|timeout|unreachable|refused|socket|econn|enotfound/i.test(message);
}

export class LLMHub {
    private providers: Map<ProviderType, Provider> = new Map<ProviderType, Provider>();
    private readonly liveHealth: Map<ProviderType, ProviderHealth> = new Map<ProviderType, ProviderHealth>();
    private ollamaImpl: OllamaProvider | undefined;
    /** Called whenever a probe or completion failure changes authoritative live readiness. */
    onHealthChange?: (health: ProviderHealth[]) => void;

    configure(cfg: ProviderConfig): void {
        this.providers.clear();
        this.liveHealth.clear();
        this.ollamaImpl = undefined;
        if (cfg.ollama) {
            const impl = new OllamaProvider(cfg.ollama.baseUrl);
            this.ollamaImpl = impl;
            this.providers.set("ollama", impl);
        }
        if (cfg.lmstudio) {
            this.providers.set("lmstudio", new LMStudioProvider(cfg.lmstudio.baseUrl));
        }
        if (cfg.openai) {
            this.providers.set("openai", new OpenAIProvider(cfg.openai.apiKey, cfg.openai.baseUrl));
        }
        if (cfg.anthropic) {
            this.providers.set("anthropic", new AnthropicProvider(cfg.anthropic.apiKey));
        }
        if (cfg.gemini) {
            this.providers.set("gemini", new GeminiProvider(cfg.gemini.apiKey));
        }
        if (cfg.openrouter) {
            this.providers.set(
                "openrouter",
                new OpenAICompatProvider("openrouter", cfg.openrouter.apiKey, cfg.openrouter.baseUrl ?? "https://openrouter.ai/api"),
            );
        }
        if (cfg.openclaw) {
            this.providers.set(
                "openclaw",
                new OpenAICompatProvider("openclaw", cfg.openclaw.apiKey ?? "", cfg.openclaw.baseUrl || "http://127.0.0.1:18789"),
            );
        }
        const checkedAt = Date.now();
        for (const provider of this.providers.keys()) {
            this.liveHealth.set(provider, {
                provider,
                healthy: false,
                latencyMs: 0,
                error: "Checking live provider connection...",
                models: [],
                checkedAt,
                status: "checking",
            });
        }
        this.onHealthChange?.(this.healthSnapshot());
    }

    hasProvider(p: ProviderType): boolean {
        return this.providers.has(p);
    }

    /** Full configured-provider readiness snapshot. Cached catalogs never enter this map. */
    healthSnapshot(): ProviderHealth[] {
        return Array.from(this.providers.keys()).map((provider) =>
            this.liveHealth.get(provider) ?? {
                provider,
                healthy: false,
                latencyMs: 0,
                error: "Provider has not been checked yet.",
                models: [],
                checkedAt: Date.now(),
                status: "checking" as const,
            },
        );
    }

    availabilityReason(provider: ProviderType, model?: string): string | undefined {
        if (!this.providers.has(provider)) return `Provider ${provider} is disabled or not configured.`;
        const health = this.liveHealth.get(provider);
        if (!health || health.status === "checking") return `Provider ${provider} is still checking its live connection.`;
        if (!health.healthy) return health.error || `Provider ${provider} is offline.`;
        if (model) {
            if (health.models.length === 0) return `Provider ${provider} returned no live models.`;
            const found = health.models.some((entry) => entry.id === model || entry.name === model);
            if (!found) return `Model ${model} is not present in ${provider}'s live catalog.`;
        }
        return undefined;
    }

    isReady(provider: ProviderType, model?: string): boolean {
        return this.availabilityReason(provider, model) === undefined;
    }

    /**
     * Blended per-1M-token cost estimate (average of input/output pricing) for a
     * provider/model, used to prefer cheaper agents when several are otherwise
     * equally suited for a task. Local runtimes are free; an unrecognized paid
     * model falls back to $0 too (same "no pricing entry" convention as calcCost),
     * so it never gets penalized for being new/unlisted.
     */
    estimatedCostPer1M(provider: ProviderType, model: string): number {
        if (provider === "ollama" || provider === "lmstudio" || provider === "openclaw") return 0;
        const table = provider === "openai" ? OPENAI_PRICING : provider === "anthropic" ? ANTHROPIC_PRICING : provider === "gemini" ? GEMINI_PRICING : undefined;
        if (!table) return 0;
        const entry = pricingFor(table, model);
        if (!entry) return 0;
        return ((entry.inputPer1M ?? 0) + (entry.outputPer1M ?? 0)) / 2;
    }

    assertReady(provider: ProviderType, model?: string): void {
        const reason = this.availabilityReason(provider, model);
        if (reason) throw new ProviderUnavailableError(provider, model, reason);
    }

    private recordHealth(health: ProviderHealth): ProviderHealth {
        const next: ProviderHealth = {
            ...health,
            checkedAt: Date.now(),
            status: health.healthy ? "ready" : "offline",
        };
        this.liveHealth.set(next.provider, next);
        this.onHealthChange?.(this.healthSnapshot());
        return next;
    }

    // ---- Ollama model management (delegates to the configured Ollama provider) ----
    private requireOllama(): OllamaProvider {
        if (!this.ollamaImpl) {
            throw new Error("Ollama is not configured");
        }
        return this.ollamaImpl;
    }

    listOllamaModels(): Promise<OllamaModelDetail[]> {
        return this.requireOllama().listModelsDetailed();
    }

    pullOllamaModel(model: string, onProgress: (p: OllamaPullProgress) => void): Promise<void> {
        return this.requireOllama().pull(model, onProgress);
    }

    deleteOllamaModel(model: string): Promise<void> {
        return this.requireOllama().deleteModel(model);
    }

    showOllamaModel(model: string): Promise<Record<string, string>> {
        return this.requireOllama().show(model);
    }

    configuredProviders(): ProviderType[] {
        return Array.from(this.providers.keys());
    }

    async complete(provider: ProviderType, req: LLMRequest): Promise<LLMResponse> {
        const impl: Provider | undefined = this.providers.get(provider);
        if (!impl) {
            throw new ProviderUnavailableError(provider, req.model, `Provider ${provider} is disabled or not configured.`);
        }
        this.assertReady(provider, req.model);
        try {
            return await impl.complete(req);
        } catch (err: unknown) {
            if (err instanceof ProviderUnavailableError || (err instanceof Error && err.name === "AbortError")) throw err;
            if (looksLikeAvailabilityFailure(err)) {
                const prior = this.liveHealth.get(provider);
                const message = err instanceof Error ? err.message : String(err);
                this.recordHealth({
                    provider,
                    healthy: false,
                    latencyMs: 0,
                    error: message,
                    models: prior?.models ?? [],
                });
                throw new ProviderUnavailableError(provider, req.model, message);
            }
            throw err;
        }
    }

    async listModels(provider?: ProviderType): Promise<ModelInfo[]> {
        if (provider) {
            const impl: Provider | undefined = this.providers.get(provider);
            if (!impl) {
                throw new Error(`Provider not configured: ${provider}`);
            }
            return impl.listModels();
        }
        const entries: Provider[] = Array.from(this.providers.values());
        const settled: PromiseSettledResult<ModelInfo[]>[] = await Promise.allSettled(
            entries.map((impl: Provider): Promise<ModelInfo[]> => impl.listModels()),
        );
        const out: ModelInfo[] = [];
        for (const result of settled) {
            if (result.status === "fulfilled") {
                for (const model of result.value) {
                    out.push(model);
                }
            } else {
                console.error("[LLMHub] provider listModels() failed:", result.reason);
            }
        }
        return out;
    }

    async healthCheck(provider?: ProviderType): Promise<ProviderHealth[]> {
        if (provider) {
            const impl: Provider | undefined = this.providers.get(provider);
            if (!impl) {
                return [
                    {
                        provider,
                        healthy: false,
                        latencyMs: 0,
                        error: `Provider not configured: ${provider}`,
                        models: [],
                    },
                ];
            }
            try {
                const health: ProviderHealth = await impl.healthCheck();
                return [this.recordHealth(health)];
            } catch (err: unknown) {
                return [this.recordHealth({
                    provider,
                    healthy: false,
                    latencyMs: 0,
                    error: err instanceof Error ? err.message : String(err),
                    models: [],
                })];
            }
        }

        const providerTypes: ProviderType[] = Array.from(this.providers.keys());
        const impls: Provider[] = Array.from(this.providers.values());
        const settled: PromiseSettledResult<ProviderHealth>[] = await Promise.allSettled(
            impls.map((impl: Provider): Promise<ProviderHealth> => impl.healthCheck()),
        );
        const out: ProviderHealth[] = [];
        for (let i = 0; i < settled.length; i++) {
            const result: PromiseSettledResult<ProviderHealth> = settled[i];
            if (result.status === "fulfilled") {
                out.push(this.recordHealth(result.value));
            } else {
                const reason: unknown = result.reason;
                out.push(this.recordHealth({
                    provider: providerTypes[i],
                    healthy: false,
                    latencyMs: 0,
                    error: reason instanceof Error ? reason.message : String(reason),
                    models: [],
                }));
            }
        }
        return out;
    }
}
