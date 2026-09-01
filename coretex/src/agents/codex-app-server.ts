// Coretex — managed Codex App Server bridge.
//
// This module talks only to OpenAI's documented `codex app-server` preview
// JSON-RPC surface. In
// particular, it never opens ~/.codex/auth.json (or any other credential file),
// and it deliberately normalizes responses before they can reach the renderer.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import type {
    ProviderAccountState,
    ProviderAuthLogin,
    ProviderAuthState,
    ProviderSessionDetail,
    ProviderSessionItem,
    ProviderSessionLiveEvent,
    ProviderSessionModel,
    ProviderSessionSummary,
    ProviderSessionsState,
    ProviderSessionTurn,
    ProviderUsageState,
    ProviderUsageWindow,
} from "../types.js";

type JsonRecord = Record<string, unknown>;

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

export interface CodexAppServerOptions {
    command?: string;
    args?: string[];
    requestTimeoutMs?: number;
    onNotification?: (method: string) => void;
    onSessionEvent?: (event: ProviderSessionLiveEvent) => void;
}

export interface CodexSessionListOptions {
    cursor?: string;
    limit?: number;
    archived?: boolean;
}

export interface CodexSessionStartOptions {
    model?: string;
    effort?: string;
    cwd?: string;
    permissionMode?: "read-only" | "workspace-write";
    initialPrompt?: string;
}

export interface CodexSessionResumeOptions extends CodexSessionStartOptions {
    sessionId: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const INTERACTIVE_THREAD_SOURCE_KINDS = ["cli", "vscode", "exec", "appServer"] as const;

function record(value: unknown): JsonRecord {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

function array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function requireWorkspaceCwd(options: Pick<CodexSessionStartOptions, "cwd" | "permissionMode">): string | undefined {
    const cwd = text(options.cwd);
    if (options.permissionMode !== "workspace-write") return cwd;
    if (!cwd || !isAbsolute(cwd)) {
        throw new Error("Workspace-write Codex sessions require an explicit absolute project folder.");
    }
    return cwd;
}

/** Keep RPC errors useful without ever echoing bearer tokens, API keys, or JWTs. */
function safeErrorMessage(value: unknown, fallback = "Codex App Server request failed."): string {
    const raw = value instanceof Error ? value.message : text(record(value).message) ?? text(value) ?? fallback;
    return raw
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
        .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
        .slice(0, 800);
}

function isPaginatedHistoryCompatibilityError(value: unknown): boolean {
    const message = safeErrorMessage(value).toLowerCase();
    return message.includes("paginated thread") && message.includes("includeturns");
}

function unixSecondsToMillis(value: unknown): number {
    const parsed = number(value) ?? 0;
    return parsed > 0 ? parsed * 1_000 : 0;
}

function sourceLabel(value: unknown): string {
    if (typeof value === "string") return value;
    const source = record(value);
    if (text(source.custom)) return text(source.custom)!;
    if (source.subAgent) return "subAgent";
    return "unknown";
}

function normalizeSessionStatus(value: unknown): ProviderSessionSummary["status"] {
    const rawStatus = text(record(value).type) ?? "notLoaded";
    if (rawStatus === "systemError") return "error";
    return rawStatus === "active" || rawStatus === "idle" || rawStatus === "notLoaded"
        ? rawStatus
        : "notLoaded";
}

function normalizeWindow(value: unknown): ProviderUsageWindow | null {
    if (!value || typeof value !== "object") return null;
    const item = record(value);
    return {
        usedPercent: Math.max(0, Math.min(100, number(item.usedPercent) ?? 0)),
        windowDurationMins: number(item.windowDurationMins) ?? null,
        resetsAt: number(item.resetsAt) ?? null,
    };
}

function normalizeUsage(value: unknown): ProviderUsageState | null {
    if (!value || typeof value !== "object") return null;
    const response = record(value);
    const snapshot = record(response.rateLimits);
    const credits = record(snapshot.credits);
    const resetCredits = record(response.rateLimitResetCredits);
    return {
        primary: normalizeWindow(snapshot.primary),
        secondary: normalizeWindow(snapshot.secondary),
        planType: text(snapshot.planType) ?? null,
        rateLimitReachedType: text(snapshot.rateLimitReachedType) ?? null,
        credits: snapshot.credits
            ? {
                  hasCredits: bool(credits.hasCredits) ?? false,
                  unlimited: bool(credits.unlimited) ?? false,
                  balance: text(credits.balance) ?? null,
              }
            : null,
        resetCreditsAvailable: number(resetCredits.availableCount) ?? 0,
    };
}

function normalizeAccount(value: unknown): ProviderAccountState {
    const response = record(value);
    const accountValue = response.account;
    const requiresOpenaiAuth = bool(response.requiresOpenaiAuth) ?? true;
    if (!accountValue || typeof accountValue !== "object") {
        return {
            status: requiresOpenaiAuth ? "authRequired" : "signedOut",
            authMode: null,
            plan: null,
            requiresOpenaiAuth,
        };
    }
    const account = record(accountValue);
    const accountType = text(account.type);
    const authMode = accountType === "chatgpt" || accountType === "apiKey" || accountType === "amazonBedrock"
        ? accountType
        : null;
    return {
        status: "connected",
        authMode,
        plan: authMode === "chatgpt" ? text(account.planType) ?? null : null,
        requiresOpenaiAuth,
    };
}

function normalizeModel(value: unknown): ProviderSessionModel | null {
    const model = record(value);
    const id = text(model.id) ?? text(model.model);
    if (!id) return null;
    return {
        id,
        model: text(model.model) ?? id,
        displayName: text(model.displayName) ?? id,
        description: text(model.description) ?? "",
        hidden: bool(model.hidden) ?? false,
        defaultReasoningEffort: text(model.defaultReasoningEffort) ?? "medium",
        supportedReasoningEfforts: array(model.supportedReasoningEfforts).map((option) => {
            const item = record(option);
            return {
                effort: text(item.reasoningEffort) ?? "medium",
                description: text(item.description) ?? "",
            };
        }),
        inputModalities: array(model.inputModalities).filter((item): item is string => typeof item === "string"),
        supportsPersonality: bool(model.supportsPersonality) ?? false,
        isDefault: bool(model.isDefault) ?? false,
    };
}

function normalizeSession(value: unknown, loadedIds: ReadonlySet<string>, model?: string): ProviderSessionSummary {
    const thread = record(value);
    const id = text(thread.id) ?? "unknown";
    const statusValue = record(thread.status);
    const status = normalizeSessionStatus(statusValue);
    const preview = text(thread.preview) ?? "";
    const title = text(thread.name) ?? text(preview.split(/\r?\n/, 1)[0]) ?? "Untitled Codex session";
    return {
        id,
        sessionId: text(thread.sessionId) ?? id,
        title,
        preview,
        status,
        activeFlags: array(statusValue.activeFlags).filter((item): item is string => typeof item === "string"),
        isLoaded: loadedIds.has(id) || status !== "notLoaded",
        model: model ?? null,
        modelProvider: text(thread.modelProvider) ?? "openai",
        source: sourceLabel(thread.threadSource ?? thread.source),
        cwd: text(thread.cwd) ?? "",
        createdAt: unixSecondsToMillis(thread.createdAt),
        updatedAt: unixSecondsToMillis(thread.updatedAt),
    };
}

function normalizeUserMessageContent(value: unknown): string {
    return array(value).map((part) => {
        const item = record(part);
        const kind = text(item.type) ?? "attachment";
        if (kind === "text") return text(item.text) ?? "";
        if (kind === "skill" || kind === "mention") return `[${kind}: ${text(item.name) ?? "item"}]`;
        if (/audio/i.test(kind)) return "[audio]";
        if (/image/i.test(kind)) return "[image]";
        return `[${kind}]`;
    }).filter(Boolean).join("\n");
}

/**
 * Thread history is intentionally summarized. Tool arguments, command lines/output,
 * filesystem paths, and MCP payloads can contain credentials and never cross this seam.
 */
function normalizeSessionItem(value: unknown): ProviderSessionItem {
    const item = record(value);
    const type = text(item.type) ?? "unknown";
    let itemText: string | undefined;
    if (type === "userMessage") itemText = normalizeUserMessageContent(item.content);
    else if (type === "agentMessage" || type === "plan") itemText = text(item.text);
    else if (type === "reasoning") itemText = array(item.summary).filter((part): part is string => typeof part === "string").join("\n");
    return {
        id: text(item.id) ?? `${type}-${Math.random().toString(36).slice(2, 10)}`,
        type,
        text: itemText,
        status: text(item.status),
        durationMs: number(item.durationMs),
        exitCode: number(item.exitCode),
    };
}

function normalizeTurn(value: unknown): ProviderSessionTurn {
    const turn = record(value);
    return {
        id: text(turn.id) ?? "unknown",
        status: text(turn.status) ?? "unknown",
        startedAt: unixSecondsToMillis(turn.startedAt),
        completedAt: unixSecondsToMillis(turn.completedAt),
        durationMs: number(turn.durationMs) ?? null,
        items: array(turn.items).map(normalizeSessionItem),
    };
}

function normalizeDetail(value: unknown, loadedIds: ReadonlySet<string>, model?: string): ProviderSessionDetail {
    const thread = record(value);
    return {
        ...normalizeSession(thread, loadedIds, model),
        turns: array(thread.turns).map(normalizeTurn),
    };
}

function normalizeLogin(value: unknown): ProviderAuthLogin | null {
    const response = record(value);
    const type = text(response.type);
    const loginId = text(response.loginId);
    if ((type !== "chatgpt" && type !== "chatgptDeviceCode") || !loginId) return null;
    return {
        type: type === "chatgptDeviceCode" ? "deviceCode" : "browser",
        loginId,
        authUrl: text(response.authUrl) ?? null,
        verificationUrl: text(response.verificationUrl) ?? null,
        userCode: text(response.userCode) ?? null,
    };
}

export class CodexAppServerClient {
    private readonly command: string;
    private readonly args: string[];
    private readonly requestTimeoutMs: number;
    private readonly onNotification?: (method: string) => void;
    private readonly onSessionEvent?: (event: ProviderSessionLiveEvent) => void;
    private child: ChildProcessWithoutNullStreams | undefined;
    private lines: ReadLineInterface | undefined;
    private initializePromise: Promise<void> | undefined;
    private initialized = false;
    private nextRequestId = 1;
    private readonly pending = new Map<string, PendingRequest>();

    constructor(options: CodexAppServerOptions = {}) {
        this.command = options.command ?? process.env.CODEX_CLI_PATH?.trim() ?? "codex";
        this.args = options.args ?? ["app-server", "--stdio"];
        this.requestTimeoutMs = Math.max(1_000, options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
        this.onNotification = options.onNotification;
        this.onSessionEvent = options.onSessionEvent;
    }

    async getSessions(options: CodexSessionListOptions = {}): Promise<ProviderSessionsState> {
        const requestErrors: string[] = [];
        await this.ensureReady();

        const [accountResult, modelsResult, threadsResult, loadedResult] = await Promise.allSettled([
            this.request<JsonRecord>("account/read", { refreshToken: false }),
            this.request<JsonRecord>("model/list", { limit: 100, includeHidden: false }),
            this.request<JsonRecord>("thread/list", {
                cursor: options.cursor ?? null,
                limit: Math.max(1, Math.min(100, Math.floor(options.limit ?? 50))),
                archived: options.archived === true,
                sortKey: "recency_at",
                sortDirection: "desc",
                useStateDbOnly: true,
                // Keep internal sub-agent/review/compaction worker threads out
                // of the user-facing recent-session list.
                sourceKinds: [...INTERACTIVE_THREAD_SOURCE_KINDS],
            }),
            this.request<JsonRecord>("thread/loaded/list", { limit: 500 }),
        ]);

        const account = accountResult.status === "fulfilled"
            ? normalizeAccount(accountResult.value)
            : {
                  status: "unavailable" as const,
                  authMode: null,
                  plan: null,
                  requiresOpenaiAuth: true,
              };
        if (accountResult.status === "rejected") requestErrors.push(safeErrorMessage(accountResult.reason));

        const modelsResponse = modelsResult.status === "fulfilled" ? record(modelsResult.value) : {};
        if (modelsResult.status === "rejected") requestErrors.push(safeErrorMessage(modelsResult.reason));
        const models = array(modelsResponse.data).map(normalizeModel).filter((item): item is ProviderSessionModel => item !== null);

        const loadedResponse = loadedResult.status === "fulfilled" ? record(loadedResult.value) : {};
        if (loadedResult.status === "rejected") requestErrors.push(safeErrorMessage(loadedResult.reason));
        const loadedSessionIds = array(loadedResponse.data).filter((item): item is string => typeof item === "string");
        const loadedIds = new Set(loadedSessionIds);

        const threadsResponse = threadsResult.status === "fulfilled" ? record(threadsResult.value) : {};
        if (threadsResult.status === "rejected") requestErrors.push(safeErrorMessage(threadsResult.reason));
        const sessions = array(threadsResponse.data).map((thread) => normalizeSession(thread, loadedIds));

        let usage: ProviderUsageState | null = null;
        if (account.status === "connected" && account.authMode === "chatgpt") {
            try {
                usage = normalizeUsage(await this.request("account/rateLimits/read"));
            } catch (error) {
                requestErrors.push(safeErrorMessage(error));
            }
        }

        return {
            provider: "codex",
            account,
            usage,
            models,
            sessions,
            loadedSessionIds,
            nextCursor: text(threadsResponse.nextCursor) ?? null,
            error: requestErrors.length ? [...new Set(requestErrors)].join(" ") : undefined,
        };
    }

    async readSession(sessionId: string, includeTurns = true): Promise<ProviderSessionDetail> {
        const loaded = await this.loadedSessionIds();
        try {
            const response = record(await this.request("thread/read", { threadId: sessionId, includeTurns }));
            return normalizeDetail(response.thread, loaded);
        } catch (error) {
            if (!includeTurns || !isPaginatedHistoryCompatibilityError(error)) throw error;
            const response = record(await this.request("thread/read", { threadId: sessionId, includeTurns: false }));
            return {
                ...normalizeDetail(response.thread, loaded),
                historyWarning: "This session uses paginated history that the installed Codex App Server cannot return yet. Session metadata is available, but turn history is unavailable in Coretex.",
            };
        }
    }

    async startSession(options: CodexSessionStartOptions): Promise<ProviderSessionDetail> {
        const cwd = requireWorkspaceCwd(options);
        const effort = text(options.effort);
        const params: JsonRecord = {
            model: text(options.model) ?? null,
            modelProvider: "openai",
            cwd: cwd ?? null,
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandbox: options.permissionMode === "workspace-write" ? "workspace-write" : "read-only",
            serviceName: "coretex",
            threadSource: "coretex",
        };
        // Thread start/resume have no direct `effort` field in App Server v2;
        // the documented Config override uses this snake_case key. Turns use
        // their dedicated `effort` field below.
        if (effort) params.config = { model_reasoning_effort: effort };
        const response = record(await this.request("thread/start", params));
        const thread = record(response.thread);
        return normalizeDetail(thread, new Set([text(thread.id) ?? ""]), text(response.model));
    }

    async resumeSession(options: CodexSessionResumeOptions): Promise<ProviderSessionDetail> {
        const cwd = requireWorkspaceCwd(options);
        const params: JsonRecord = { threadId: options.sessionId };
        if (text(options.model)) params.model = text(options.model);
        if (text(options.effort)) params.config = { model_reasoning_effort: text(options.effort) };
        if (cwd) params.cwd = cwd;
        // Never inherit a more permissive policy from a historical rollout.
        // Omitted permission mode is deliberately read-only.
        params.approvalPolicy = "on-request";
        params.approvalsReviewer = "user";
        params.sandbox = options.permissionMode === "workspace-write" ? "workspace-write" : "read-only";
        const response = record(await this.request("thread/resume", params));
        const thread = record(response.thread);
        return normalizeDetail(thread, new Set([options.sessionId]), text(response.model));
    }

    async promptSession(options: CodexSessionResumeOptions & { prompt: string }): Promise<{ session: ProviderSessionDetail; turnId: string }> {
        const prompt = text(options.prompt);
        if (!prompt) throw new Error("A prompt is required to continue a Codex session.");
        if (prompt.length > 200_000) throw new Error("The Codex session prompt is too large.");
        const workspaceCwd = requireWorkspaceCwd(options);

        const loaded = await this.loadedSessionIds();
        const session = loaded.has(options.sessionId)
            ? await this.readSession(options.sessionId, false)
            : await this.resumeSession(options);
        const cwd = workspaceCwd ?? text(session.cwd);
        const params: JsonRecord = {
            threadId: options.sessionId,
            input: [{ type: "text", text: prompt, text_elements: [] }],
            approvalPolicy: options.permissionMode === "workspace-write" ? "on-request" : "never",
            approvalsReviewer: "user",
            sandboxPolicy: options.permissionMode === "workspace-write"
                ? {
                      type: "workspaceWrite",
                      writableRoots: [cwd],
                      networkAccess: false,
                      excludeTmpdirEnvVar: true,
                      excludeSlashTmp: true,
                  }
                : { type: "readOnly", networkAccess: false },
        };
        if (cwd) params.cwd = cwd;
        if (text(options.model)) params.model = text(options.model);
        if (text(options.effort)) params.effort = text(options.effort);
        const response = record(await this.request("turn/start", params));
        const turnId = text(record(response.turn).id);
        if (!turnId) throw new Error("Codex App Server did not return a turn id.");
        return { session: { ...session, status: "active", isLoaded: true }, turnId };
    }

    async getAuth(refreshToken = false): Promise<ProviderAuthState> {
        const account = normalizeAccount(await this.request("account/read", { refreshToken }));
        let usage: ProviderUsageState | null = null;
        let error: string | undefined;
        if (account.status === "connected" && account.authMode === "chatgpt") {
            try {
                usage = normalizeUsage(await this.request("account/rateLimits/read"));
            } catch (reason) {
                error = safeErrorMessage(reason);
            }
        }
        return { provider: "codex", account, usage, login: null, error };
    }

    async startLogin(mode: "browser" | "deviceCode" = "browser"): Promise<ProviderAuthState> {
        const result = await this.request("account/login/start", mode === "deviceCode"
            ? { type: "chatgptDeviceCode" }
            : { type: "chatgpt", useHostedLoginSuccessPage: true, appBrand: "codex" });
        const current = await this.getAuth(false);
        return { ...current, login: normalizeLogin(result) };
    }

    async cancelLogin(loginId: string): Promise<ProviderAuthState> {
        await this.request("account/login/cancel", { loginId });
        return this.getAuth(false);
    }

    async logout(): Promise<ProviderAuthState> {
        await this.request("account/logout");
        return this.getAuth(false);
    }

    stop(): void {
        const child = this.child;
        this.child = undefined;
        this.initialized = false;
        this.initializePromise = undefined;
        this.lines?.close();
        this.lines = undefined;
        this.rejectPending(new Error("Codex App Server stopped."));
        if (child && child.exitCode === null && !child.killed) {
            try {
                child.kill();
            } catch {
                // Process already exited.
            }
        }
    }

    private async loadedSessionIds(): Promise<Set<string>> {
        const response = record(await this.request("thread/loaded/list", { limit: 500 }));
        return new Set(array(response.data).filter((item): item is string => typeof item === "string"));
    }

    private async request<T = unknown>(method: string, params?: unknown): Promise<T> {
        await this.ensureReady();
        return this.requestRaw<T>(method, params);
    }

    private async ensureReady(): Promise<void> {
        if (this.child && this.child.exitCode === null && this.initialized) return;
        if (!this.initializePromise) {
            this.initializePromise = this.spawnAndInitialize().finally(() => {
                this.initializePromise = undefined;
            });
        }
        return this.initializePromise;
    }

    private async spawnAndInitialize(): Promise<void> {
        this.stop();
        let child: ChildProcessWithoutNullStreams;
        try {
            child = spawn(this.command, this.args, {
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
            });
        } catch (error) {
            throw new Error(safeErrorMessage(error, `Could not start ${this.command}.`));
        }
        this.child = child;
        this.initialized = false;
        // Drain stderr so the child cannot block. Do not retain or forward it: auth
        // implementations may write sensitive diagnostics there.
        child.stderr.resume();
        this.lines = createInterface({ input: child.stdout });
        this.lines.on("line", (line) => this.handleLine(line));
        child.once("exit", (code) => this.handleExit(child, code));

        await new Promise<void>((resolve, reject) => {
            const onSpawn = (): void => {
                child.off("error", onError);
                resolve();
            };
            const onError = (error: NodeJS.ErrnoException): void => {
                child.off("spawn", onSpawn);
                reject(new Error(error.code === "ENOENT"
                    ? `Codex CLI ("${this.command}") was not found. Install it and sign in before connecting Coretex.`
                    : safeErrorMessage(error)));
            };
            child.once("spawn", onSpawn);
            child.once("error", onError);
        });

        await this.requestRaw("initialize", {
            clientInfo: { name: "coretex", title: "Coretex", version: "0.1.0" },
            capabilities: {
                // App Server itself is preview; Coretex avoids its additional
                // experimental method set until version-specific support exists.
                experimentalApi: false,
                optOutNotificationMethods: [
                    "item/reasoning/summaryTextDelta",
                    "item/reasoning/textDelta",
                    "command/exec/outputDelta",
                ],
            },
        });
        this.writeMessage({ method: "initialized", params: {} });
        this.initialized = true;
    }

    private requestRaw<T = unknown>(method: string, params?: unknown): Promise<T> {
        const child = this.child;
        if (!child || child.exitCode !== null || child.killed) {
            return Promise.reject(new Error("Codex App Server is not running."));
        }
        const id = this.nextRequestId++;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(String(id));
                reject(new Error(`Codex App Server timed out while handling ${method}.`));
            }, this.requestTimeoutMs);
            timer.unref?.();
            this.pending.set(String(id), { resolve: resolve as (value: unknown) => void, reject, timer });
            try {
                this.writeMessage({ method, id, ...(params === undefined ? {} : { params }) });
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(String(id));
                reject(new Error(safeErrorMessage(error)));
            }
        });
    }

    private writeMessage(message: JsonRecord): void {
        const stdin = this.child?.stdin;
        if (!stdin || stdin.destroyed || !stdin.writable) throw new Error("Codex App Server input is closed.");
        stdin.write(`${JSON.stringify(message)}\n`);
    }

    private handleLine(line: string): void {
        let message: JsonRecord;
        try {
            message = record(JSON.parse(line));
        } catch {
            return;
        }
        const id = typeof message.id === "string" || typeof message.id === "number" ? String(message.id) : undefined;
        const method = text(message.method);
        if (id && !method) {
            const pending = this.pending.get(id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(id);
            if (message.error) pending.reject(new Error(safeErrorMessage(message.error)));
            else pending.resolve(message.result);
            return;
        }
        if (id && method) {
            // App-server requests (approvals, elicitation, token refresh) are fail-closed.
            // This bridge only exposes session administration and never acts for the user.
            try {
                this.writeMessage({ id: message.id, error: { code: -32601, message: "Coretex does not handle this server request." } });
            } catch {
                // The process may have exited while the request was in flight.
            }
            return;
        }
        if (method) {
            const event = this.normalizeLiveEvent(method, message.params);
            if (event) this.onSessionEvent?.(event);
            this.onNotification?.(method);
        }
    }

    private handleExit(child: ChildProcessWithoutNullStreams, code: number | null): void {
        if (this.child !== child) return;
        this.child = undefined;
        this.initialized = false;
        this.lines?.close();
        this.lines = undefined;
        this.rejectPending(new Error(`Codex App Server exited unexpectedly${code === null ? "" : ` (code ${code})`}.`));
        this.onNotification?.("server/exited");
    }

    private rejectPending(error: Error): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }

    private normalizeLiveEvent(method: string, value: unknown): ProviderSessionLiveEvent | null {
        const params = record(value);
        const sessionId = text(params.threadId) ?? text(record(params.thread).id);
        if (!sessionId) return null;
        if (method === "thread/status/changed") {
            const status = record(params.status);
            return {
                kind: "threadStatus",
                sessionId,
                status: normalizeSessionStatus(status),
                activeFlags: array(status.activeFlags).filter((item): item is string => typeof item === "string"),
            };
        }
        if (method === "turn/started" || method === "turn/completed") {
            const turn = record(params.turn);
            const turnId = text(turn.id);
            const turnError = record(turn.error);
            return {
                kind: method === "turn/started" ? "turnStarted" : "turnCompleted",
                sessionId,
                turnId,
                status: text(turn.status),
                error: turn.error ? safeErrorMessage(turnError) : undefined,
            };
        }
        if (method === "item/agentMessage/delta") {
            return {
                kind: "messageDelta",
                sessionId,
                turnId: text(params.turnId),
                itemId: text(params.itemId),
                text: typeof params.delta === "string" ? params.delta : "",
            };
        }
        if (method === "error") {
            return {
                kind: "error",
                sessionId,
                turnId: text(params.turnId),
                error: safeErrorMessage(params.error),
            };
        }
        return null;
    }
}
