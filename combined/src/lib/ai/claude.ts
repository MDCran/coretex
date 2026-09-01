import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";

/**
 * Central Claude client for all LifeOS AI features (nutrition parsing, food photo
 * analysis, bank-statement extraction, insights). Every call is logged to AiCall
 * with token usage and cost. Requires ANTHROPIC_API_KEY.
 */

export const DEFAULT_MODEL = "claude-opus-4-8";
export const CHEAP_CLAUDE_MODEL = "claude-haiku-4-5-20251001";

/**
 * Cheapest model — used for ALL job-search AI calls unless the user explicitly
 * picked a different model for search. Haiku is ~5-25x cheaper than Opus, which
 * matters a lot when a search fans out across many location passes.
 */
export const JOB_SEARCH_MODEL = CHEAP_CLAUDE_MODEL;

/**
 * Statement PDFs are high-volume extraction work, so keep them on the cheapest
 * Claude model unless a caller explicitly requests a different one.
 */
export const PDF_EXTRACTION_MODEL = CHEAP_CLAUDE_MODEL;

/** USD per 1M tokens — input / output. */
const PRICING: Record<string, { input: number; output: number }> = {
    "claude-opus-4-8": { input: 5, output: 25 },
    "claude-opus-4-7": { input: 5, output: 25 },
    "claude-opus-4-6": { input: 5, output: 25 },
    "claude-sonnet-4-6": { input: 3, output: 15 },
    "claude-haiku-4-5": { input: 1, output: 5 },
    "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

export const AVAILABLE_MODELS = Object.keys(PRICING);

export function aiConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
}

let _client: Anthropic | null = null;
function client(): Anthropic {
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");
    }
    if (!_client) _client = new Anthropic();
    return _client;
}

function costUsd(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = PRICING[model] ?? PRICING[DEFAULT_MODEL];
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

function supportsAdaptiveThinking(model: string): boolean {
    return !model.includes("haiku");
}

/** Default wall-clock cap for a single Anthropic call (ms). Long ops can pass a shorter signal. */
const DEFAULT_TIMEOUT_MS = 90_000;

/** Start of the current calendar month (UTC), used to scope monthly AI spend. */
function startOfMonth(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Gate a call before it hits Anthropic:
 *  1. If a Settings row exists AND aiEnabled is explicitly false → throw (feature disabled).
 *     If there's no Settings row, allow (preserves the older key-only gating that other
 *     features relied on — don't break them just because the default flag is false).
 *  2. If aiMonthlyLimitUsd is set and current-month spend has reached it → throw (hard cap).
 *
 * Returns the loaded settings (or null) so callers can reuse it.
 */
async function enforceAiBudget(userId: string): Promise<{ aiModel: string | null } | null> {
    const settings = await db.settings.findUnique({ where: { userId } });

    // (1) Explicit disable only — absence of a row stays permissive.
    if (settings && settings.aiEnabled === false) {
        throw new Error("AI features are disabled — enable them in Settings → AI.");
    }

    // (2) Hard monthly cap.
    if (settings?.aiMonthlyLimitUsd != null) {
        const limit = Number(settings.aiMonthlyLimitUsd);
        if (Number.isFinite(limit) && limit >= 0) {
            // Prefer a live sum of this month's AiCall rows; fall back to the running counter.
            const agg = await db.aiCall.aggregate({
                where: { userId, createdAt: { gte: startOfMonth() } },
                _sum: { costUsd: true },
            });
            const spent = agg._sum.costUsd != null ? Number(agg._sum.costUsd) : Number(settings.aiMonthSpend ?? 0);
            if (spent >= limit) {
                throw new Error("Monthly AI budget reached.");
            }
        }
    }

    return settings ? { aiModel: settings.aiModel } : null;
}

/** Map an aborted/timed-out Anthropic call to a clean, user-facing message. */
function mapAbortError(error: unknown): never {
    if (
        error instanceof Anthropic.APIUserAbortError ||
        (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
    ) {
        throw new Error("AI request timed out or was cancelled.");
    }
    throw error;
}

/**
 * Resolve a request-options object carrying the abort signal + timeout for the
 * Anthropic SDK. Caller-supplied signal wins; otherwise we default to a 90s cap.
 */
function callOptions(opts: { signal?: AbortSignal; timeoutMs?: number }): { signal?: AbortSignal; timeout: number } {
    return { signal: opts.signal, timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS };
}

type ContentPart =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } }
    | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

export interface ClaudeCallOptions {
    /** Logged to AiCall (e.g. "nutrition-parse", "statement-extract", "food-photo"). */
    purpose: string;
    userId: string;
    system?: string;
    /** Plain text prompt, or rich content parts (text + images + PDF documents). */
    content: string | ContentPart[];
    /** JSON schema — when provided, the response is constrained and parsed for you. */
    schema?: Record<string, unknown>;
    model?: string;
    maxTokens?: number;
    /** Abort the underlying Anthropic call (cancellation). */
    signal?: AbortSignal;
    /** Wall-clock cap for the call in ms (default 90s). */
    timeoutMs?: number;
}

export interface ClaudeResult<T> {
    data: T;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}

/**
 * Run a Claude call. With `schema`, returns the parsed JSON object (typed via T);
 * without, returns the response text as T (= string). Logs an AiCall row either way.
 */
export async function runClaude<T = string>(options: ClaudeCallOptions): Promise<ClaudeResult<T>> {
    const model = options.model && PRICING[options.model] ? options.model : DEFAULT_MODEL;
    const started = Date.now();

    // Gate before spending: AI must be enabled and within the monthly budget.
    await enforceAiBudget(options.userId);

    try {
        const response = await client().messages.create(
            {
                model,
                max_tokens: options.maxTokens ?? 16000,
                ...(supportsAdaptiveThinking(model) ? { thinking: { type: "adaptive" as const } } : {}),
                ...(options.system ? { system: options.system } : {}),
                ...(options.schema
                    ? { output_config: { format: { type: "json_schema" as const, schema: options.schema } } }
                    : {}),
                messages: [
                    {
                        role: "user",
                        content: typeof options.content === "string" ? options.content : options.content,
                    },
                ],
            },
            callOptions(options),
        );

        const inputTokens = response.usage.input_tokens;
        const outputTokens = response.usage.output_tokens;
        const cost = costUsd(model, inputTokens, outputTokens);

        await db.aiCall.create({
            data: {
                userId: options.userId,
                provider: "anthropic",
                model,
                purpose: options.purpose,
                inputTokens,
                outputTokens,
                costUsd: cost,
                latencyMs: Date.now() - started,
            },
        });
        // accumulate monthly spend on Settings
        await db.settings.updateMany({
            where: { userId: options.userId },
            data: { aiMonthSpend: { increment: cost } },
        });

        const text = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === "text")
            .map((block) => block.text)
            .join("");

        const data = (options.schema ? JSON.parse(text) : text) as T;
        return { data, model, inputTokens, outputTokens, costUsd: cost };
    } catch (error) {
        await db.aiCall
            .create({
                data: {
                    userId: options.userId,
                    provider: "anthropic",
                    model,
                    purpose: options.purpose,
                    errored: true,
                    errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
                    latencyMs: Date.now() - started,
                },
            })
            .catch(() => undefined);
        mapAbortError(error);
    }
}

/** USD per web search request (Anthropic server tool: $10 / 1,000 searches). */
const WEB_SEARCH_COST = 0.01;

export interface WebSearchResult<T> extends ClaudeResult<T> {
    /** Number of live web searches the model ran. */
    searchCount: number;
}

/**
 * Extract a JSON value from a model's free-text answer. Web search can't be
 * combined with constrained JSON output, so we ask for JSON in the prompt and
 * parse it here — tolerating ```json fences and surrounding prose/citations.
 */
function tryParse<T>(s: string): T | undefined {
    const trimmed = s.trim();
    if (!trimmed) return undefined;
    try {
        return JSON.parse(trimmed) as T;
    } catch {
        return undefined;
    }
}

/**
 * Find the index of the bracket that closes the one opened at `start`, ignoring
 * brackets that appear inside JSON strings (so citations / prose with `]` don't
 * break the scan). Returns -1 if unbalanced.
 */
function matchBalanced(text: string, start: number): number {
    const open = text[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === "\\") esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') inStr = true;
        else if (c === open) depth++;
        else if (c === close) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * Extract a JSON value from a model's free-text answer. Web search can't be
 * combined with constrained JSON output, so we ask for JSON in the prompt and
 * parse it here — robustly tolerating ```json fences, leading/trailing prose,
 * inline citations like [1], and multiple bracketed spans. Strategy: try every
 * fenced block (last first), then the whole text, then scan for the first
 * balanced {...}/[...] span (string-aware) that actually parses.
 */
function extractJson<T>(text: string): T {
    // 1) Fenced code blocks — models often explain, then fence the JSON. Try last → first.
    const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
    for (let i = fences.length - 1; i >= 0; i--) {
        const v = tryParse<T>(fences[i]);
        if (v !== undefined) return v;
    }
    // 2) Whole response (clean JSON-only answers).
    const whole = tryParse<T>(text);
    if (whole !== undefined) return whole;
    // 3) Scan for the first balanced {...} or [...] region that parses.
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c !== "{" && c !== "[") continue;
        const close = matchBalanced(text, i);
        if (close === -1) continue;
        const v = tryParse<T>(text.slice(i, close + 1));
        if (v !== undefined) return v;
        // skip past this open bracket's region to avoid O(n^2) rescans of the same prefix
        if (close > i) i = close;
    }
    throw new Error("AI did not return valid JSON.");
}

/**
 * Run a Claude call with the live web-search server tool enabled. The model
 * autonomously searches the web (executed server-side by Anthropic) and we parse
 * a JSON payload out of its final text. Logs an AiCall including web-search cost.
 */
export async function runClaudeWithWebSearch<T>(options: ClaudeCallOptions & { maxSearches?: number }): Promise<WebSearchResult<T>> {
    const model = options.model && PRICING[options.model] ? options.model : DEFAULT_MODEL;
    const started = Date.now();

    // Gate before spending: AI must be enabled and within the monthly budget.
    await enforceAiBudget(options.userId);

    try {
        const response = await client().messages.create(
            {
                model,
                max_tokens: options.maxTokens ?? 16000,
                ...(options.system ? { system: options.system } : {}),
                tools: [{ type: "web_search_20250305", name: "web_search", max_uses: options.maxSearches ?? 5 }],
                messages: [{ role: "user", content: typeof options.content === "string" ? options.content : options.content }],
            },
            callOptions(options),
        );

        const inputTokens = response.usage.input_tokens;
        const outputTokens = response.usage.output_tokens;
        const searchCount =
            (response.usage as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0;
        const cost = costUsd(model, inputTokens, outputTokens) + searchCount * WEB_SEARCH_COST;

        await db.aiCall.create({
            data: {
                userId: options.userId,
                provider: "anthropic",
                model,
                purpose: options.purpose,
                inputTokens,
                outputTokens,
                costUsd: cost,
                latencyMs: Date.now() - started,
            },
        });
        await db.settings.updateMany({ where: { userId: options.userId }, data: { aiMonthSpend: { increment: cost } } });

        const text = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === "text")
            .map((block) => block.text)
            .join("");

        return { data: extractJson<T>(text), model, inputTokens, outputTokens, costUsd: cost, searchCount };
    } catch (error) {
        await db.aiCall
            .create({
                data: {
                    userId: options.userId,
                    provider: "anthropic",
                    model,
                    purpose: options.purpose,
                    errored: true,
                    errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
                    latencyMs: Date.now() - started,
                },
            })
            .catch(() => undefined);
        mapAbortError(error);
    }
}

/** Convenience: analyze an image (food photo etc.) against a schema. */
export async function analyzeImage<T>(opts: {
    purpose: string;
    userId: string;
    prompt: string;
    imageBase64: string;
    mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    schema: Record<string, unknown>;
    model?: string;
}): Promise<ClaudeResult<T>> {
    return runClaude<T>({
        purpose: opts.purpose,
        userId: opts.userId,
        model: opts.model,
        schema: opts.schema,
        content: [
            { type: "image", source: { type: "base64", media_type: opts.mimeType, data: opts.imageBase64 } },
            { type: "text", text: opts.prompt },
        ],
    });
}

/** Convenience: extract structured data from a PDF (bank statements etc.). */
export async function extractFromPdf<T>(opts: {
    purpose: string;
    userId: string;
    prompt: string;
    pdfBase64: string;
    schema: Record<string, unknown>;
    model?: string;
    system?: string;
}): Promise<ClaudeResult<T>> {
    return runClaude<T>({
        purpose: opts.purpose,
        userId: opts.userId,
        model: opts.model ?? PDF_EXTRACTION_MODEL,
        system: opts.system,
        schema: opts.schema,
        maxTokens: 16000,
        content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: opts.pdfBase64 } },
            { type: "text", text: opts.prompt },
        ],
    });
}
