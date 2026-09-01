// @ts-nocheck
"use client";

// Coretex Relay — React binding for the orchestrator WebSocket bridge.
// Folds the live OrchestratorEvent stream into a single dashboard state object,
// and exposes typed action helpers that send WebCommands back to the Brain.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BridgeClient } from "@repo/coretex/client";
import { healthErrorLabel } from "./labels";
import type {
    AgentState,
    AgentCanvasCardSettings,
    AgentCanvasPoint,
    AgentCanvasState,
    AgentFileChange,
    AgentStatus,
    BadgeColor,
    CalendarCategory,
    CalendarEvent,
    ChatMessage,
    CodeIndexState,
    CoretexConfig,
    ConversationScope,
    ConnectorCredentialInput,
    ConnectorOperationResult,
    DockerAction,
    DockerState,
    DockerPruneTarget,
    EmailAgentConfig,
    EmailCategory,
    EmailConnectInput,
    EmailFolder,
    EmailState,
    EnvManagerState,
    Environment,
    EnvVariable,
    KeyVaultState,
    APIKey,
    ServiceConnection,
    KeyTestResult,
    FilesMetaState,
    FilePathMeta,
    FilePin,
    FileTag,
    SmartCollection,
    CostSummary,
    DriveInfo,
    DriveMeta,
    FsEntry,
    GitStatusCode,
    GitRepoSummary,
    GitBranchInfo,
    GitCommitInfo,
    GitPullRequestInfo,
    GithubOverview,
    GithubRepositoryDetail,
    GithubDeploymentInfo,
    GithubWorkflowRunInfo,
    ProjectRepo,
    FileProperties,
    LeakScanResult,
    IndexState,
    IndexedEntry,
    AgentConfig,
    CreateAgentInput,
    CreateProjectInput,
    CreateTaskInput,
    RefineTaskPatch,
    UploadedDoc,
    LogLevel,
    McpServerStatus,
    MemoryItem,
    ModelInfo,
    OllamaModelDetail,
    OllamaPullProgress,
    OrchestratorEvent,
    PermissionMode,
    Project,
    DbDatabaseInfo,
    DbIntrospection,
    DbIntrospectionTarget,
    DbSchemaTable,
    ProviderHealth,
    ProviderType,
    ProviderAuthState,
    ProviderSessionBackend,
    ProviderSessionDetail,
    ProviderSessionsState,
    SecurityOperation,
    SecurityStatus,
    RemoteEntry,
    RemoteSession,
    RunningServer,
    Task,
    TaskLog,
    TaskPriority,
    TerminalSessionMeta,
    CommandBlockState,
    BrowserPageInfo,
    BrowserControlResult,
    BrowserHostCommand,
    BuddyMode,
    BuddySessionState,
    TopologyKind,
    TopologyTurn,
} from "@repo/coretex/types";
import { CALENDAR_CATEGORIES } from "./calendar/categories";
import { EMPTY_DOCKER_OPERATIONS, reduceDockerOperationState, type DockerOperationsState } from "./docker-operation-state";
import { enqueueDigest, fireNotification, isInQuietHours } from "./ui/notify";
// Locale getters published by SettingsEffects. Safe to import here: settings-effects.tsx
// only imports `react` + `@repo/coretex/types` (never this module), so there is no circular
// dependency. The getters read a module-level snapshot the effect keeps in sync, so a single
// settings write re-formats everything on the next formatter call.
import { getCurrency, getDateFormat, getTimeFormat, getUnits } from "./settings/settings-effects";

export interface CoretexLogLine {
    level: LogLevel;
    message: string;
    timestamp: string;
}

/** Per-agent live activity derived from the event stream. */
export interface AgentActivity {
    /** Accumulated streaming text for the agent's current step. */
    stream: string;
    /** Last completed step number. */
    step: number;
    /** Id of the task the agent is currently working. */
    taskId?: string;
}

export interface CoretexState {
    connected: boolean;
    agents: AgentState[];
    /** Durable presentation-only agent fleet canvas state. */
    agentCanvas: AgentCanvasState;
    /** True only after the Brain has sent an authoritative canvas snapshot. */
    agentCanvasLoaded: boolean;
    tasks: Task[];
    projects: Project[];
    cost: CostSummary | null;
    health: ProviderHealth[];
    models: ModelInfo[];
    /** Codex app-server account, model catalog, usage limits, and recent sessions. */
    providerSessions: ProviderSessionsState | null;
    /** In-flight/sign-in state is separate so opening a browser never exposes credentials. */
    providerAuth: ProviderAuthState | null;
    /** Latest start/resume/open result, including safe text-only turn details. */
    providerSessionResult: {
        operation: "start" | "resume" | "open" | "prompt";
        session?: ProviderSessionDetail;
        turnId?: string;
        error?: string;
    } | null;
    /** Safe text-only history snapshots keyed by session id; concurrent reads cannot replace one another. */
    providerSessionDetails: Record<string, ProviderSessionDetail>;
    /** Live, privacy-filtered Codex turn text/status keyed by Coretex-managed session id. */
    providerSessionLive: Record<
        string,
        {
            turnId?: string;
            itemId?: string;
            status?: string;
            activeFlags?: string[];
            text: string;
            error?: string;
        }
    >;
    logs: CoretexLogLine[];
    /** taskId -> ordered step history (session-scoped — only tasks that ran while
     * this client was connected; the Brain doesn't persist TaskLog entries). */
    taskLogs: Record<string, TaskLog[]>;
    /** agentId -> live activity (streaming text + step). */
    activity: Record<string, AgentActivity>;
    /** projectId -> source-code index status. */
    codeIndex: Record<string, CodeIndexState>;
    /** projectId -> chat history. */
    chat: Record<string, ChatMessage[]>;
    /** projectId -> in-flight assistant stream. */
    chatStreaming: Record<string, { messageId: string; content: string }>;
    /** Latest project-chat execution error, cleared by the next successful stream/message. */
    chatErrors: Record<string, string | null>;
    /** Command-center AI answers, keyed by request id (#32). */
    assistant: Record<string, { content: string; streaming: boolean; error: string | null }>;
    /** projectId -> per-project cost summary. */
    projectBilling: Record<string, CostSummary>;
    /** Full app settings (null until first settings:state). */
    settings: CoretexConfig | null;
    /** Protected-store, local-diagnostics, and redaction status. */
    securityStatus: SecurityStatus | null;
    /** Latest destructive Security operation result. */
    securityOperation: {
        action: SecurityOperation;
        ok: boolean;
        cleared: number;
        error?: string;
        at: number;
    } | null;
    /** Latest non-executing command-policy evaluation. */
    securityCommandCheck: {
        requestId: string;
        allowed: boolean;
        requiresApproval: boolean;
        reason?: string;
        matchedRule?: string;
    } | null;
    /** Filesystem state for the editor + explorer. */
    fs: {
        cwd: string;
        parent: string | null;
        entries: FsEntry[];
        roots: string[];
        home: string;
        error: string | null;
        open: { path: string; content: string; truncated: boolean } | null;
        fileError: string | null;
        lastWrite: { path: string; ok: boolean; error?: string } | null;
        /** Last fs mutation (move/mkdir/newFile/delete) result — drives a refresh + toast. */
        lastOp: {
            op: string;
            ok: boolean;
            from?: string;
            to?: string;
            error?: string;
            at: number;
        } | null;
        /** Image thumbnail data-URLs by path (null = requested, none available). */
        thumbs: Record<string, string | null>;
        /** Last Space-to-preview text peek (separate from the editor's `open`). */
        peek: {
            path: string;
            content: string;
            truncated: boolean;
            error?: string;
        } | null;
        /** Cached directory listings (for the Columns/Miller view), keyed by resolved path. */
        dirs: Record<string, { entries: FsEntry[]; parent: string | null; error?: string }>;
        /** Shared file clipboard (copy/cut → paste); source null when empty. */
        clipboard: { source: string | null; action: "copy" | "cut" | null };
        /** Cached git status per requested dir: absolute path → status code. */
        git: Record<string, { repoRoot: string | null; statuses: Record<string, GitStatusCode> }>;
        /** Mounted drives with capacity (Files "Home" storage overview). */
        drives: DriveInfo[];
        /** Existence of checked paths (broken-starred detection): path → exists. */
        pathExists: Record<string, boolean>;
        /** Active search results (recursive folder search or global index), or null. */
        search: {
            scope: "folder" | "index";
            query: string;
            hits: IndexedEntry[];
        } | null;
        /** Last file Properties result (for the Properties dialog), keyed by requested path. */
        properties: {
            path: string;
            ok: boolean;
            info?: FileProperties;
            error?: string;
        } | null;
    };
    /**
     * Project Source Control cache — summaries / history / PRs keyed by absolute repo path.
     * Populated by git:* WebCommands (GitHub Desktop–style project Git tab).
     */
    sourceControl: Record<
        string,
        {
            summary?: GitRepoSummary;
            branches?: GitBranchInfo[];
            commits?: GitCommitInfo[];
            prs?: GitPullRequestInfo[];
            prsFullName?: string;
            deployments?: GithubDeploymentInfo[];
            workflows?: GithubWorkflowRunInfo[];
            deploymentsError?: string;
            lastOp?: { ok: boolean; message?: string; error?: string; repoPath?: string; resultUrl?: string; linkedProjectIds?: string[]; at: number };
        }
    >;
    /** Global GitHub inventory and selected-repository details. */
    github: {
        overview: GithubOverview | null;
        details: Record<string, GithubRepositoryDetail>;
        detailErrors: Record<string, string>;
    };
    /**
     * Recent filesystem edits from agents (and the Files UI) — used by Source Control
     * to attribute dirty files to who wrote them.
     */
    agentFileChanges: AgentFileChange[];
    /** File-search index: indexed locations + count + freshness. */
    index: IndexState | null;
    /** Live indexing progress (running count + current dir), or null when idle. */
    indexProgress: { count: number; current: string; done: boolean } | null;
    /** Last database query result. */
    db: {
        result: {
            connectionId: string;
            requestId?: string;
            columns: string[];
            rows: unknown[][];
            rowCount: number;
            elapsedMs: number;
            truncated?: boolean;
            error?: string;
        } | null;
        /** Latest schema per connection id. */
        schemas: Record<string, { tables: DbSchemaTable[]; requestId?: string; error?: string }>;
        /** Discoverable databases / Redis indexes per connection. */
        databases: Record<string, { items: DbDatabaseInfo[]; requestId?: string; error?: string }>;
        /** Latest bounded object details / preview per connection. */
        introspections: Record<string, { value?: DbIntrospection; requestId?: string; error?: string }>;
        /** Latest test result per connection id. */
        tests: Record<string, { ok: boolean; requestId?: string; error?: string }>;
    };
    /** User-managed calendar events. */
    calendar: CalendarEvent[];
    /** User-managed calendar categories (drives event colors/labels + filters). */
    calendarCategories: CalendarCategory[];
    /** User-owned assistant memories. */
    memory: MemoryItem[];
    /** Email module state (mail, categories, AI agent, sort log). */
    email: EmailState | null;
    /** Environment variable manager state. */
    env: EnvManagerState | null;
    /** API key vault + integrations hub state. */
    keyvault: KeyVaultState | null;
    /** Last live key-test result (for transient per-card status). */
    keyTest: KeyTestResult | null;
    /** Latest atomic connector lifecycle result, correlated by request id. */
    connectorOperation: ConnectorOperationResult | null;
    /** Local secret-leak scan progress + last result. */
    leakScan: {
        scanning: boolean;
        scanned: number;
        current: string;
        result: LeakScanResult | null;
    };
    /** Last transient notice broadcast by the Brain (shown as a toast). */
    lastNotice: {
        level: "info" | "success" | "warning" | "error";
        message: string;
        at: number;
    } | null;
    /** Files sidecar metadata: per-path icons/colors/tags + the tag DB. */
    filesMeta: FilesMetaState | null;
    /** MCP server connection status + tools, by serverId. */
    mcp: Record<string, McpServerStatus>;
    /** Last MCP tool-call result. */
    mcpToolResult: {
        serverId: string;
        name: string;
        result?: string;
        error?: string;
    } | null;
    /** Multi-agent topology (council) run. */
    topology: {
        running: boolean;
        runId: string | null;
        turns: TopologyTurn[];
        streaming: {
            agentId: string;
            round: number;
            phase: string;
            content: string;
        } | null;
        result: string | null;
        error: string | null;
    };
    /** Plan-mode run: a planner agent streaming a long Markdown plan document. */
    planning: {
        running: boolean;
        runId: string | null;
        taskId: string | null;
        markdown: string;
        error: string | null;
    };
    /** Detected running servers / listening ports. */
    servers: RunningServer[];
    /** Open terminal sessions (PTY metadata; data streams out-of-band). */
    terminals: TerminalSessionMeta[];
    /** Per-terminal Terminal Buddy state, keyed by session id (folded from buddy:* events). */
    buddy: Record<string, BuddySessionState>;
    /** Per-terminal shell-integration block model (shell info + completed command blocks), keyed by session id. */
    blocks: Record<string, CommandBlockState>;
    /** Per browser-session live page state (url/title + AI ownership), keyed by session id (#16). */
    browser: Record<string, BrowserPageInfo>;
    /** Latest browser-control result per session (for surfacing "not available in this host", etc.). */
    browserResults: Record<string, BrowserControlResult>;
    /**
     * Latest DOM/click/eval instruction the Brain asked the host to run, keyed by session id.
     * A scripting-capable BrowserView (Electron <webview>) watches this, performs the action,
     * and replies via browserResultReport. The web/iframe host ignores it.
     */
    browserCommands: Record<string, BrowserHostCommand>;
    /** Docker engine state (null until first docker:state). */
    docker: DockerState | null;
    /** In-flight Docker work plus the latest terminal result for button loading/feedback. */
    dockerOperations: DockerOperationsState;
    /** Live remote (SSH/SFTP/FTP) sessions + the latest directory listing per session id. */
    remote: {
        sessions: RemoteSession[];
        listings: Record<string, { path: string; entries: RemoteEntry[]; error?: string }>;
        lastOp: {
            sessionId: string;
            op: string;
            ok: boolean;
            error?: string;
        } | null;
    };
    /** Ollama model manager (AI providers settings). */
    ollama: {
        models: OllamaModelDetail[];
        modelsError: string | null;
        /** model name -> live pull progress. */
        pulling: Record<string, OllamaPullProgress>;
        /** Last model-info drawer payload. */
        show: {
            model: string;
            details?: Record<string, string>;
            error?: string;
        } | null;
    };
}

const MAX_LOGS = 250;
const MAX_STREAM_CHARS = 4000;

/** A fresh Terminal Buddy slice for a session before any buddy:* event arrives. */
function defaultBuddy(sessionId: string): BuddySessionState {
    return {
        sessionId,
        env: null,
        probing: false,
        probeError: null,
        status: "idle",
        mode: "suggest",
        taskId: null,
        request: null,
        steps: [],
        activity: null,
        help: null,
        summary: null,
        ok: null,
    };
}

const initialState: CoretexState = {
    connected: false,
    agents: [],
    agentCanvas: { positions: {}, cards: {}, showConnections: true, revision: 0 },
    agentCanvasLoaded: false,
    tasks: [],
    projects: [],
    cost: null,
    health: [],
    models: [],
    providerSessions: null,
    providerAuth: null,
    providerSessionResult: null,
    providerSessionDetails: {},
    providerSessionLive: {},
    logs: [],
    taskLogs: {},
    activity: {},
    codeIndex: {},
    chat: {},
    chatStreaming: {},
    chatErrors: {},
    assistant: {},
    projectBilling: {},
    settings: null,
    securityStatus: null,
    securityOperation: null,
    securityCommandCheck: null,
    fs: {
        cwd: "",
        parent: null,
        entries: [],
        roots: [],
        home: "",
        error: null,
        open: null,
        fileError: null,
        lastWrite: null,
        lastOp: null,
        thumbs: {},
        peek: null,
        dirs: {},
        git: {},
        drives: [],
        pathExists: {},
        search: null,
        clipboard: { source: null, action: null },
        properties: null,
    },
    sourceControl: {},
    github: { overview: null, details: {}, detailErrors: {} },
    agentFileChanges: [],
    index: null,
    indexProgress: null,
    db: {
        result: null,
        schemas: {},
        databases: {},
        introspections: {},
        tests: {},
    },
    calendar: [],
    calendarCategories: CALENDAR_CATEGORIES,
    memory: [],
    email: null,
    env: null,
    keyvault: null,
    keyTest: null,
    connectorOperation: null,
    leakScan: { scanning: false, scanned: 0, current: "", result: null },
    lastNotice: null,
    filesMeta: null,
    mcp: {},
    mcpToolResult: null,
    topology: {
        running: false,
        runId: null,
        turns: [],
        streaming: null,
        result: null,
        error: null,
    },
    planning: {
        running: false,
        runId: null,
        taskId: null,
        markdown: "",
        error: null,
    },
    servers: [],
    terminals: [],
    buddy: {},
    blocks: {},
    browser: {},
    browserResults: {},
    browserCommands: {},
    docker: null,
    dockerOperations: EMPTY_DOCKER_OPERATIONS,
    remote: { sessions: [], listings: {}, lastOp: null },
    ollama: { models: [], modelsError: null, pulling: {}, show: null },
};

type Action = { type: "connection"; connected: boolean } | { type: "event"; event: OrchestratorEvent };

function upsertTask(tasks: Task[], task: Task): Task[] {
    const idx = tasks.findIndex((t) => t.id === task.id);
    if (idx === -1) return [...tasks, task];
    const next = tasks.slice();
    next[idx] = task;
    return next;
}

function upsertProject(projects: Project[], project: Project): Project[] {
    const idx = projects.findIndex((p) => p.id === project.id);
    if (idx === -1) return [...projects, project];
    const next = projects.slice();
    next[idx] = project;
    return next;
}

function patchAgent(agents: AgentState[], agentId: string, patch: Partial<AgentState>): AgentState[] {
    return agents.map((a) => (a.id === agentId ? { ...a, ...patch } : a));
}

function reducer(state: CoretexState, action: Action): CoretexState {
    if (action.type === "connection") {
        if (action.connected) return { ...state, connected: true, agentCanvasLoaded: false };
        const assistant = Object.fromEntries(
            Object.entries(state.assistant).map(([id, value]) => [
                id,
                value.streaming
                    ? {
                          ...value,
                          streaming: false,
                          error: "Brain disconnected before the response completed.",
                      }
                    : value,
            ]),
        );
        return {
            ...state,
            connected: false,
            agentCanvasLoaded: false,
            assistant,
            chatStreaming: {},
            topology: state.topology.running
                ? {
                      ...state.topology,
                      running: false,
                      streaming: null,
                      error: "Brain disconnected. Council was halted or its state is unknown.",
                  }
                : state.topology,
        };
    }

    const ev = action.event;
    switch (ev.type) {
        case "system:status":
            return {
                ...state,
                agents: ev.agents,
                tasks: ev.tasks,
                projects: ev.projects,
            };

        case "agent:status":
            return {
                ...state,
                agents: patchAgent(state.agents, ev.agentId, {
                    status: ev.status,
                    currentTaskId: ev.taskId,
                }),
                activity: {
                    ...state.activity,
                    [ev.agentId]: {
                        ...(state.activity[ev.agentId] ?? { stream: "", step: 0 }),
                        taskId: ev.taskId ?? state.activity[ev.agentId]?.taskId,
                    },
                },
            };

        case "agent:canvas":
            // Multiple windows can update the same canvas. Never let an older
            // broadcast roll a renderer back after it has observed a newer one.
            if (state.agentCanvasLoaded && ev.state.revision < state.agentCanvas.revision) return state;
            return { ...state, agentCanvas: ev.state, agentCanvasLoaded: true };

        case "agent:stream": {
            const prev = state.activity[ev.agentId] ?? { stream: "", step: 0 };
            const stream = (prev.stream + ev.chunk).slice(-MAX_STREAM_CHARS);
            return {
                ...state,
                activity: {
                    ...state.activity,
                    [ev.agentId]: { ...prev, stream, taskId: ev.taskId },
                },
            };
        }

        case "agent:step": {
            return {
                ...state,
                activity: {
                    ...state.activity,
                    // A new step starts a fresh stream buffer; keep the resolved content.
                    [ev.agentId]: { stream: "", step: ev.step, taskId: ev.taskId },
                },
            };
        }

        case "task:created":
        case "task:updated":
            return { ...state, tasks: upsertTask(state.tasks, ev.task) };

        case "task:completed":
            return { ...state, tasks: upsertTask(state.tasks, ev.task) };

        case "task:failed":
            return { ...state, tasks: upsertTask(state.tasks, ev.task) };

        case "task:deleted": {
            const { [ev.taskId]: _removed, ...taskLogs } = state.taskLogs;
            return {
                ...state,
                tasks: state.tasks.filter((t) => t.id !== ev.taskId),
                taskLogs,
            };
        }

        case "project:created":
        case "project:updated":
            return { ...state, projects: upsertProject(state.projects, ev.project) };

        case "project:deleted":
            return {
                ...state,
                projects: state.projects.filter((p) => p.id !== ev.projectId),
            };

        case "cost:update":
            return { ...state, cost: ev.summary };

        case "providers:health":
            return {
                ...state,
                health: Array.from(new Map([...state.health, ...ev.health].map((health) => [health.provider, health])).values()),
            };

        case "providers:models":
            return { ...state, models: ev.models };

        case "provider:sessions": {
            const { type: _type, requestId: _requestId, ...providerSessions } = ev;
            return { ...state, providerSessions };
        }

        case "provider:auth": {
            const { type: _type, requestId: _requestId, ...providerAuth } = ev;
            return {
                ...state,
                providerAuth,
                providerSessions: state.providerSessions
                    ? {
                          ...state.providerSessions,
                          account: providerAuth.account,
                          usage: providerAuth.usage,
                      }
                    : state.providerSessions,
            };
        }

        case "provider:sessionResult": {
            const result = {
                operation: ev.operation,
                session: ev.session,
                turnId: ev.turnId,
                error: ev.error,
            };
            const providerSessionDetails = ev.session
                ? {
                      ...state.providerSessionDetails,
                      [ev.session.id]: ev.session,
                      [ev.session.sessionId]: ev.session,
                  }
                : state.providerSessionDetails;
            if (!ev.session || !state.providerSessions) return { ...state, providerSessionResult: result, providerSessionDetails };
            const summary = { ...ev.session };
            delete summary.turns;
            const sessions = state.providerSessions.sessions.some((item) => item.id === summary.id)
                ? state.providerSessions.sessions.map((item) => (item.id === summary.id ? summary : item))
                : [summary, ...state.providerSessions.sessions];
            const loadedSessionIds = summary.isLoaded
                ? Array.from(new Set([...state.providerSessions.loadedSessionIds, summary.id]))
                : state.providerSessions.loadedSessionIds;
            return {
                ...state,
                providerSessionResult: result,
                providerSessionDetails,
                providerSessions: {
                    ...state.providerSessions,
                    sessions,
                    loadedSessionIds,
                },
            };
        }

        case "provider:session:event": {
            const event = ev.event;
            const previous = state.providerSessionLive[event.sessionId] ?? {
                text: "",
            };
            const next = {
                ...previous,
                ...(event.turnId ? { turnId: event.turnId } : {}),
                ...(event.itemId ? { itemId: event.itemId } : {}),
                ...(event.status ? { status: event.status } : {}),
                ...(event.activeFlags ? { activeFlags: event.activeFlags } : {}),
                ...(event.error ? { error: event.error } : {}),
                text: event.kind === "messageDelta" ? (previous.text + (event.text ?? "")).slice(-12000) : event.kind === "turnStarted" ? "" : previous.text,
            };
            if (event.kind === "turnStarted") {
                delete next.error;
                delete next.itemId;
            }
            const threadNotLoaded = event.kind === "threadStatus" && event.status === "notLoaded";
            const providerSessions = state.providerSessions
                ? {
                      ...state.providerSessions,
                      loadedSessionIds: threadNotLoaded
                          ? state.providerSessions.loadedSessionIds.filter((id) => id !== event.sessionId)
                          : Array.from(new Set([...state.providerSessions.loadedSessionIds, event.sessionId])),
                      sessions: state.providerSessions.sessions.map((session) =>
                          session.id === event.sessionId || session.sessionId === event.sessionId
                              ? {
                                    ...session,
                                    isLoaded: !threadNotLoaded,
                                    ...(event.kind === "threadStatus" && event.status ? { status: event.status } : {}),
                                    ...(event.kind === "threadStatus" && event.activeFlags ? { activeFlags: event.activeFlags } : {}),
                                }
                              : session,
                      ),
                  }
                : state.providerSessions;
            return {
                ...state,
                providerSessions,
                providerSessionLive: {
                    ...state.providerSessionLive,
                    [event.sessionId]: next,
                },
            };
        }

        case "system:log":
            return {
                ...state,
                logs: [...state.logs, { level: ev.level, message: ev.message, timestamp: ev.timestamp }].slice(-MAX_LOGS),
            };

        case "task:log": {
            // Per-task step logs flow into the same system-log stream so they actually
            // render, AND accumulate per-task so the task detail view can show a full
            // step-by-step history for tasks that ran during this session.
            const taskId = ev.log.taskId;
            const existing = state.taskLogs[taskId] ?? [];
            return {
                ...state,
                logs: [
                    ...state.logs,
                    {
                        level: "info" as const,
                        message: `[task ${taskId.slice(-6)}] step ${ev.log.step}: ${ev.log.message}`,
                        timestamp: ev.log.timestamp,
                    },
                ].slice(-MAX_LOGS),
                taskLogs: {
                    ...state.taskLogs,
                    [taskId]: [...existing, ev.log].slice(-200),
                },
            };
        }

        case "code:indexStatus":
            return {
                ...state,
                codeIndex: { ...state.codeIndex, [ev.state.projectId]: ev.state },
            };

        case "chat:history":
            return { ...state, chat: { ...state.chat, [ev.projectId]: ev.messages } };

        case "chat:message": {
            const pid = ev.message.projectId;
            const existing = state.chat[pid] ?? [];
            const idx = existing.findIndex((m) => m.id === ev.message.id);
            const next = idx === -1 ? [...existing, ev.message] : existing.map((m) => (m.id === ev.message.id ? ev.message : m));
            const streaming = { ...state.chatStreaming };
            if (streaming[pid]?.messageId === ev.message.id) delete streaming[pid];
            return {
                ...state,
                chat: { ...state.chat, [pid]: next },
                chatStreaming: streaming,
                chatErrors: { ...state.chatErrors, [pid]: null },
            };
        }

        case "chat:stream": {
            const prev = state.chatStreaming[ev.projectId];
            const content = (prev?.messageId === ev.messageId ? prev.content : "") + ev.chunk;
            return {
                ...state,
                chatStreaming: {
                    ...state.chatStreaming,
                    [ev.projectId]: { messageId: ev.messageId, content },
                },
                chatErrors: { ...state.chatErrors, [ev.projectId]: null },
            };
        }

        case "chat:done": {
            const streaming = { ...state.chatStreaming };
            delete streaming[ev.projectId];
            return { ...state, chatStreaming: streaming };
        }

        case "chat:error": {
            const streaming = { ...state.chatStreaming };
            delete streaming[ev.projectId];
            return {
                ...state,
                chatStreaming: streaming,
                chatErrors: { ...state.chatErrors, [ev.projectId]: ev.error },
            };
        }

        case "assistant:answer": {
            const prev = state.assistant[ev.id];
            const content = (prev?.content ?? "") + ev.chunk;
            return {
                ...state,
                assistant: {
                    ...state.assistant,
                    [ev.id]: { content, streaming: true, error: null },
                },
            };
        }

        case "assistant:done": {
            const prev = state.assistant[ev.id];
            return {
                ...state,
                assistant: {
                    ...state.assistant,
                    [ev.id]: {
                        content: prev?.content ?? "",
                        streaming: false,
                        error: prev?.error ?? null,
                    },
                },
            };
        }

        case "assistant:error": {
            const prev = state.assistant[ev.id];
            return {
                ...state,
                assistant: {
                    ...state.assistant,
                    [ev.id]: {
                        content: prev?.content ?? "",
                        streaming: false,
                        error: ev.error,
                    },
                },
            };
        }

        case "project:billing":
            return {
                ...state,
                projectBilling: { ...state.projectBilling, [ev.projectId]: ev.summary },
            };

        case "settings:state":
            return { ...state, settings: ev.config };

        case "security:state":
            return { ...state, securityStatus: ev.status };

        case "security:operationResult":
            return {
                ...state,
                securityOperation: {
                    action: ev.action,
                    ok: ev.ok,
                    cleared: ev.cleared,
                    error: ev.error,
                    at: Date.now(),
                },
            };

        case "security:commandCheck":
            return {
                ...state,
                securityCommandCheck: {
                    requestId: ev.requestId,
                    allowed: ev.allowed,
                    requiresApproval: ev.requiresApproval,
                    reason: ev.reason,
                    matchedRule: ev.matchedRule,
                },
            };

        case "fs:listing":
            return {
                ...state,
                fs: {
                    ...state.fs,
                    cwd: ev.path,
                    parent: ev.parent,
                    entries: ev.entries,
                    error: ev.error ?? null,
                },
            };

        case "fs:file":
            return ev.error
                ? { ...state, fs: { ...state.fs, fileError: ev.error } }
                : {
                      ...state,
                      fs: {
                          ...state.fs,
                          open: {
                              path: ev.path,
                              content: ev.content,
                              truncated: ev.truncated,
                          },
                          fileError: null,
                      },
                  };

        case "fs:written":
            return {
                ...state,
                fs: {
                    ...state.fs,
                    lastWrite: { path: ev.path, ok: ev.ok, error: ev.error },
                },
            };

        case "fs:opResult":
            // On a successful mutation, drop the column-view dir + git caches so they re-fetch.
            return {
                ...state,
                fs: {
                    ...state.fs,
                    lastOp: {
                        op: ev.op,
                        ok: ev.ok,
                        from: ev.from,
                        to: ev.to,
                        error: ev.error,
                        at: Date.now(),
                    },
                    dirs: ev.ok ? {} : state.fs.dirs,
                    git: ev.ok ? {} : state.fs.git,
                },
            };

        case "fs:thumb":
            return {
                ...state,
                fs: {
                    ...state.fs,
                    thumbs: { ...state.fs.thumbs, [ev.path]: ev.dataUrl },
                },
            };
        case "fs:propertiesResult":
            return {
                ...state,
                fs: {
                    ...state.fs,
                    properties: {
                        path: ev.path,
                        ok: ev.ok,
                        info: ev.info,
                        error: ev.error,
                    },
                },
            };
        case "fs:peeked":
            return {
                ...state,
                fs: {
                    ...state.fs,
                    peek: {
                        path: ev.path,
                        content: ev.content,
                        truncated: ev.truncated,
                        error: ev.error,
                    },
                },
            };
        case "fs:dirListing":
            return {
                ...state,
                fs: {
                    ...state.fs,
                    dirs: {
                        ...state.fs.dirs,
                        [ev.path]: {
                            entries: ev.entries,
                            parent: ev.parent,
                            error: ev.error,
                        },
                    },
                },
            };
        case "fs:clipboardState":
            return {
                ...state,
                fs: {
                    ...state.fs,
                    clipboard: { source: ev.source, action: ev.action },
                },
            };
        case "fs:gitStatusResult":
            return {
                ...state,
                fs: {
                    ...state.fs,
                    git: {
                        ...state.fs.git,
                        [ev.path]: { repoRoot: ev.repoRoot, statuses: ev.statuses },
                    },
                },
            };
        case "github:overviewResult":
            return {
                ...state,
                github: {
                    ...state.github,
                    overview: ev.overview,
                },
            };
        case "github:detailResult":
            return {
                ...state,
                github: {
                    ...state.github,
                    details: ev.detail
                        ? { ...state.github.details, [ev.requestId]: ev.detail }
                        : state.github.details,
                    detailErrors: ev.error
                        ? { ...state.github.detailErrors, [ev.requestId]: ev.error }
                        : Object.fromEntries(Object.entries(state.github.detailErrors).filter(([key]) => key !== ev.requestId)),
                },
            };
        case "git:summaryResult": {
            const key = ev.requestId;
            const prev = state.sourceControl[key] ?? {};
            return {
                ...state,
                sourceControl: {
                    ...state.sourceControl,
                    [key]: { ...prev, summary: ev.summary },
                },
            };
        }
        case "git:branchesResult": {
            const prev = state.sourceControl[ev.requestId] ?? {};
            return {
                ...state,
                sourceControl: {
                    ...state.sourceControl,
                    [ev.requestId]: { ...prev, branches: ev.branches },
                },
            };
        }
        case "git:logResult": {
            const prev = state.sourceControl[ev.requestId] ?? {};
            return {
                ...state,
                sourceControl: {
                    ...state.sourceControl,
                    [ev.requestId]: { ...prev, commits: ev.commits },
                },
            };
        }
        case "git:prsResult": {
            const prev = state.sourceControl[ev.requestId] ?? {};
            return {
                ...state,
                sourceControl: {
                    ...state.sourceControl,
                    [ev.requestId]: { ...prev, prs: ev.prs, prsFullName: ev.fullName },
                },
            };
        }
        case "git:opResult": {
            const prev = state.sourceControl[ev.requestId] ?? {};
            return {
                ...state,
                sourceControl: {
                    ...state.sourceControl,
                    [ev.requestId]: {
                        ...prev,
                        lastOp: {
                            ok: ev.ok,
                            message: ev.message,
                            error: ev.error,
                            repoPath: ev.repoPath,
                            resultUrl: ev.resultUrl,
                            linkedProjectIds: ev.linkedProjectIds,
                            at: Date.now(),
                        },
                    },
                },
            };
        }
        case "git:deploymentsResult": {
            const prev = state.sourceControl[ev.requestId] ?? {};
            return {
                ...state,
                sourceControl: {
                    ...state.sourceControl,
                    [ev.requestId]: {
                        ...prev,
                        deployments: ev.deployments,
                        workflows: ev.workflows,
                        deploymentsError: ev.error,
                    },
                },
            };
        }

        case "agent:fileChange": {
            const next = [ev.change, ...state.agentFileChanges.filter((c) => c.id !== ev.change.id)];
            return { ...state, agentFileChanges: next.slice(0, 400) };
        }
        case "agent:fileChanges":
            return { ...state, agentFileChanges: ev.changes };
        case "fs:drivesResult":
            return { ...state, fs: { ...state.fs, drives: ev.drives } };
        case "fs:pathsChecked":
            return {
                ...state,
                fs: {
                    ...state.fs,
                    pathExists: { ...state.fs.pathExists, ...ev.exists },
                },
            };
        case "fs:searchResult":
            return {
                ...state,
                fs: {
                    ...state.fs,
                    search: { scope: ev.scope, query: ev.query, hits: ev.hits },
                },
            };
        case "index:state":
            return { ...state, index: ev.state };
        case "index:progress":
            return {
                ...state,
                indexProgress: { count: ev.count, current: ev.current, done: ev.done },
            };

        case "fs:roots":
            return { ...state, fs: { ...state.fs, roots: ev.roots, home: ev.home } };

        case "db:result":
            return {
                ...state,
                db: {
                    ...state.db,
                    result: {
                        connectionId: ev.connectionId,
                        requestId: ev.requestId,
                        columns: ev.columns,
                        rows: ev.rows,
                        rowCount: ev.rowCount,
                        elapsedMs: ev.elapsedMs,
                        truncated: ev.truncated,
                        error: ev.error,
                    },
                },
            };
        case "db:schema":
            return {
                ...state,
                db: {
                    ...state.db,
                    schemas: {
                        ...state.db.schemas,
                        [ev.connectionId]: {
                            tables: ev.tables,
                            requestId: ev.requestId,
                            error: ev.error,
                        },
                    },
                },
            };
        case "db:databases":
            return {
                ...state,
                db: {
                    ...state.db,
                    databases: {
                        ...(state.db.databases ?? {}),
                        [ev.connectionId]: {
                            items: ev.databases,
                            requestId: ev.requestId,
                            error: ev.error,
                        },
                    },
                },
            };
        case "db:introspection":
            return {
                ...state,
                db: {
                    ...state.db,
                    introspections: {
                        ...(state.db.introspections ?? {}),
                        [ev.connectionId]: {
                            value: ev.introspection,
                            requestId: ev.requestId,
                            error: ev.error,
                        },
                    },
                },
            };
        case "db:testResult":
            return {
                ...state,
                db: {
                    ...state.db,
                    tests: {
                        ...state.db.tests,
                        [ev.connectionId]: {
                            ok: ev.ok,
                            requestId: ev.requestId,
                            error: ev.error,
                        },
                    },
                },
            };

        case "calendar:events":
            return {
                ...state,
                calendar: Array.isArray(ev.events) ? ev.events : state.calendar,
                calendarCategories: Array.isArray(ev.categories) && ev.categories.length > 0 ? ev.categories : state.calendarCategories,
            };

        case "memory:items":
            return { ...state, memory: ev.items };

        case "email:state":
            return { ...state, email: ev.state };

        case "env:state":
            return { ...state, env: ev.state };

        case "keyvault:state":
            return { ...state, keyvault: ev.state };

        case "keyvault:testResult":
            return { ...state, keyTest: ev.result };

        case "keyvault:integrationResult":
            // The follow-up keyvault:state carries the new status; this just clears any transient flag.
            return state;
        case "connector:operationResult":
            return { ...state, connectorOperation: ev };
        case "keyvault:scanProgress":
            return {
                ...state,
                leakScan: {
                    ...state.leakScan,
                    scanning: !ev.done,
                    scanned: ev.scanned,
                    current: ev.current,
                },
            };
        case "keyvault:scanResult":
            return {
                ...state,
                leakScan: { ...state.leakScan, scanning: false, result: ev.result },
            };

        case "notice":
            return {
                ...state,
                lastNotice: { level: ev.level, message: ev.message, at: Date.now() },
            };

        case "filesmeta:state":
            return { ...state, filesMeta: ev.state };

        case "mcp:status":
            return {
                ...state,
                mcp: { ...state.mcp, [ev.status.serverId]: ev.status },
            };

        case "mcp:toolResult":
            return {
                ...state,
                mcpToolResult: {
                    serverId: ev.serverId,
                    name: ev.name,
                    result: ev.result,
                    error: ev.error,
                },
            };

        case "topology:started":
            return {
                ...state,
                topology: {
                    running: true,
                    runId: ev.runId,
                    turns: [],
                    streaming: null,
                    result: null,
                    error: null,
                },
            };

        case "topology:turn": {
            const fresh = ev.turn.runId !== state.topology.runId;
            const turns = fresh ? [ev.turn] : [...state.topology.turns, ev.turn];
            return {
                ...state,
                topology: {
                    ...state.topology,
                    running: true,
                    runId: ev.turn.runId,
                    turns,
                    streaming: null,
                    result: null,
                    error: null,
                },
            };
        }

        case "topology:stream": {
            const fresh = ev.runId !== state.topology.runId;
            const cur = fresh
                ? {
                      ...state.topology,
                      running: true,
                      runId: ev.runId,
                      turns: [],
                      streaming: null,
                      result: null,
                      error: null,
                  }
                : state.topology;
            const prev = cur.streaming && cur.streaming.agentId === ev.agentId && cur.streaming.round === ev.round && cur.streaming.phase === ev.phase ? cur.streaming.content : "";
            return {
                ...state,
                topology: {
                    ...cur,
                    streaming: {
                        agentId: ev.agentId,
                        round: ev.round,
                        phase: ev.phase,
                        content: prev + ev.chunk,
                    },
                },
            };
        }

        case "topology:done":
            return {
                ...state,
                topology: {
                    ...state.topology,
                    running: false,
                    streaming: null,
                    result: ev.result,
                },
            };

        case "topology:error":
            return {
                ...state,
                topology: {
                    ...state.topology,
                    running: false,
                    streaming: null,
                    error: ev.error,
                },
            };

        case "plan:stream": {
            // A new run resets the document; same run accumulates.
            const fresh = state.planning.runId !== ev.runId;
            return {
                ...state,
                planning: {
                    running: true,
                    runId: ev.runId,
                    taskId: fresh ? null : state.planning.taskId,
                    markdown: (fresh ? "" : state.planning.markdown) + ev.chunk,
                    error: null,
                },
            };
        }

        case "plan:done":
            return {
                ...state,
                planning: {
                    ...state.planning,
                    running: false,
                    runId: ev.runId,
                    taskId: ev.taskId ?? null,
                    markdown: ev.markdown,
                },
            };

        case "plan:error":
            return {
                ...state,
                planning: { ...state.planning, running: false, error: ev.error },
            };

        case "servers:list":
            return { ...state, servers: ev.servers };

        case "servers:killed":
            return state; // list re-broadcasts right after a kill

        case "terminal:list":
            return { ...state, terminals: ev.sessions };

        case "terminal:created":
            return state.terminals.some((t) => t.id === ev.meta.id) ? state : { ...state, terminals: [...state.terminals, ev.meta] };

        case "terminal:exit": {
            // Drop the session + its derived block/buddy state.
            const blocks = { ...state.blocks };
            delete blocks[ev.id];
            return {
                ...state,
                terminals: state.terminals.filter((t) => t.id !== ev.id),
                blocks,
            };
        }

        case "terminal:data":
            return state; // high-frequency PTY stream handled out-of-band by the xterm view

        case "terminal:shellInfo": {
            // Shell-integration: detected shell + live cwd (OSC 7) for a session.
            const prev = state.blocks[ev.info.sessionId] ?? {
                sessionId: ev.info.sessionId,
                info: null,
                blocks: [],
                current: null,
            };
            return {
                ...state,
                blocks: {
                    ...state.blocks,
                    [ev.info.sessionId]: { ...prev, info: ev.info },
                },
            };
        }

        case "terminal:block": {
            // Shell-integration: a completed command block (command + output + exit + cwd).
            const sid = ev.block.sessionId;
            const prev = state.blocks[sid] ?? {
                sessionId: sid,
                info: null,
                blocks: [],
                current: null,
            };
            const next = [...prev.blocks, ev.block];
            // Cap retained blocks so a long session can't grow unbounded.
            const capped = next.length > 200 ? next.slice(-200) : next;
            return {
                ...state,
                blocks: { ...state.blocks, [sid]: { ...prev, blocks: capped } },
            };
        }

        case "buddy:environment": {
            const prev = state.buddy[ev.sessionId] ?? defaultBuddy(ev.sessionId);
            return {
                ...state,
                buddy: {
                    ...state.buddy,
                    [ev.sessionId]: {
                        ...prev,
                        env: ev.env,
                        mode: ev.env.mode ?? prev.mode,
                        probing: false,
                        probeError: null,
                    },
                },
            };
        }

        case "buddy:probing": {
            const prev = state.buddy[ev.sessionId] ?? defaultBuddy(ev.sessionId);
            return {
                ...state,
                buddy: {
                    ...state.buddy,
                    [ev.sessionId]: {
                        ...prev,
                        probing: ev.probing,
                        probeError: ev.error ?? (ev.probing ? null : prev.probeError),
                    },
                },
            };
        }

        case "buddy:plan": {
            const prev = state.buddy[ev.sessionId] ?? defaultBuddy(ev.sessionId);
            return {
                ...state,
                buddy: {
                    ...state.buddy,
                    [ev.sessionId]: {
                        ...prev,
                        taskId: ev.taskId,
                        request: ev.request,
                        mode: ev.mode,
                        steps: ev.steps,
                        status: "running",
                        help: null,
                        summary: null,
                        ok: null,
                    },
                },
            };
        }

        case "buddy:step": {
            const prev = state.buddy[ev.sessionId] ?? defaultBuddy(ev.sessionId);
            const exists = prev.steps.some((s) => s.id === ev.step.id);
            const steps = exists ? prev.steps.map((s) => (s.id === ev.step.id ? ev.step : s)) : [...prev.steps, ev.step];
            return {
                ...state,
                buddy: { ...state.buddy, [ev.sessionId]: { ...prev, steps } },
            };
        }

        case "buddy:activity": {
            const prev = state.buddy[ev.sessionId] ?? defaultBuddy(ev.sessionId);
            return {
                ...state,
                buddy: {
                    ...state.buddy,
                    [ev.sessionId]: {
                        ...prev,
                        status: ev.status,
                        activity: ev.line,
                        help: ev.status === "needs-help" ? prev.help : null,
                    },
                },
            };
        }

        case "buddy:needsHelp": {
            const prev = state.buddy[ev.sessionId] ?? defaultBuddy(ev.sessionId);
            return {
                ...state,
                buddy: {
                    ...state.buddy,
                    [ev.sessionId]: { ...prev, help: ev.help, status: "needs-help" },
                },
            };
        }

        case "buddy:done": {
            const prev = state.buddy[ev.sessionId] ?? defaultBuddy(ev.sessionId);
            return {
                ...state,
                buddy: {
                    ...state.buddy,
                    [ev.sessionId]: {
                        ...prev,
                        status: ev.ok ? "done" : ev.halted || prev.status === "halted" ? "halted" : "failed",
                        ok: ev.ok,
                        summary: ev.summary,
                        help: null,
                    },
                },
            };
        }

        case "buddy:error": {
            const prev = state.buddy[ev.sessionId] ?? defaultBuddy(ev.sessionId);
            return {
                ...state,
                buddy: {
                    ...state.buddy,
                    [ev.sessionId]: {
                        ...prev,
                        status: "failed",
                        activity: ev.error,
                        probing: false,
                    },
                },
            };
        }

        case "browser:event":
            return {
                ...state,
                browser: { ...state.browser, [ev.info.sessionId]: ev.info },
            };

        case "browser:result":
            return {
                ...state,
                browserResults: {
                    ...state.browserResults,
                    [ev.result.sessionId]: ev.result,
                },
            };

        case "browser:command":
            return {
                ...state,
                browserCommands: {
                    ...state.browserCommands,
                    [ev.command.sessionId]: ev.command,
                },
            };

        case "docker:state":
            return { ...state, docker: ev.state };

        case "docker:operation": {
            return {
                ...state,
                // The helper is deliberately default-safe for live/HMR state created
                // before the Docker operation slice existed.
                dockerOperations: reduceDockerOperationState(state.dockerOperations, ev.operation),
            };
        }

        case "remote:sessions":
            return { ...state, remote: { ...state.remote, sessions: ev.sessions } };

        case "remote:listing":
            return {
                ...state,
                remote: {
                    ...state.remote,
                    listings: {
                        ...state.remote.listings,
                        [ev.sessionId]: {
                            path: ev.path,
                            entries: ev.entries,
                            error: ev.error,
                        },
                    },
                },
            };

        case "remote:opResult":
            return {
                ...state,
                remote: {
                    ...state.remote,
                    lastOp: {
                        sessionId: ev.sessionId,
                        op: ev.op,
                        ok: ev.ok,
                        error: ev.error,
                    },
                },
            };

        case "ollama:models":
            return {
                ...state,
                ollama: {
                    ...state.ollama,
                    models: ev.models,
                    modelsError: ev.error ?? null,
                },
            };

        case "ollama:pullProgress": {
            const next = { ...state.ollama.pulling };
            if (ev.progress.done && !ev.progress.error) {
                // Pull finished cleanly — clear the progress row (models list refreshes separately).
                delete next[ev.progress.model];
            } else {
                next[ev.progress.model] = ev.progress;
            }
            return { ...state, ollama: { ...state.ollama, pulling: next } };
        }

        case "ollama:deleted":
            return state; // list is re-broadcast right after; nothing extra to store

        case "ollama:show":
            return {
                ...state,
                ollama: {
                    ...state.ollama,
                    show: { model: ev.model, details: ev.details, error: ev.error },
                },
            };

        default:
            return state;
    }
}

export interface CoretexActions {
    createTask: (input: CreateTaskInput) => boolean;
    cancelTask: (taskId: string) => boolean;
    deleteTask: (taskId: string) => boolean;
    reprioritizeTask: (taskId: string, priority: TaskPriority) => boolean;
    refineTask: (taskId: string, patch: RefineTaskPatch) => boolean;
    pauseAgent: (agentId: string) => boolean;
    resumeAgent: (agentId: string) => boolean;
    setAgentDailyBudget: (agentId: string, tokens: number) => boolean;
    createAgent: (config: CreateAgentInput) => boolean;
    updateAgent: (agentId: string, patch: Partial<AgentConfig>) => boolean;
    createAgents: (config: CreateAgentInput, count: number) => boolean;
    removeAgent: (agentId: string) => boolean;
    haltAgent: (agentId: string) => boolean;
    /** Halt all agents, or only this project's agents when projectId is given. */
    haltAllAgents: (projectId?: string) => boolean;
    pauseAllAgents: (projectId?: string) => boolean;
    resumeAllAgents: (projectId?: string) => boolean;
    setAgentPermissionMode: (agentId: string, mode: PermissionMode) => boolean;
    requestAgentCanvas: () => boolean;
    setAgentCanvasPosition: (agentId: string, position: AgentCanvasPoint) => boolean;
    setAgentCanvasLayout: (positions: Record<string, AgentCanvasPoint>) => boolean;
    resetAgentCanvasLayout: () => boolean;
    setAgentCanvasPreferences: (patch: { showConnections?: boolean }) => boolean;
    setAgentCanvasCardSettings: (agentId: string, patch: Partial<AgentCanvasCardSettings>) => boolean;
    // Plan mode
    runPlan: (plannerAgentId: string, prompt: string, taskId?: string) => boolean;
    stopPlan: () => boolean;
    createProject: (project: CreateProjectInput) => boolean;
    addProjectDocuments: (projectId: string, documents: UploadedDoc[]) => boolean;
    updateProjectDocument: (projectId: string, name: string, patch: { title?: string; description?: string }) => boolean;
    removeProjectDocument: (projectId: string, name: string) => boolean;
    setProjectIcon: (projectId: string, icon?: string, color?: string) => boolean;
    requestStatus: () => void;
    requestHealthCheck: () => void;
    // Project Assistant + code index + per-project billing
    setProjectSource: (projectId: string, sourcePath: string) => boolean;
    setProjectRepos: (projectId: string, repos: ProjectRepo[]) => boolean;
    /** Link one local or remote repository to several projects in one operation. */
    linkRepoToProjects: (projectIds: string[], repo: ProjectRepo) => boolean;
    /** Unlink metadata from a project without deleting the checkout on disk. */
    unlinkProjectRepo: (projectId: string, repoId: string) => boolean;
    updateProject: (
        projectId: string,
        patch: {
            name?: string;
            description?: string;
            status?: Project["status"];
            tags?: string[];
            appearance?: Project["appearance"];
            connectorIds?: string[];
        },
    ) => boolean;
    deleteProject: (projectId: string) => boolean;
    reindexCode: (projectId: string, full?: boolean) => boolean;
    setAssistantModel: (projectId: string, provider: ProviderType, model: string) => boolean;
    setProjectBudget: (projectId: string, budgetUSD: number) => boolean;
    getProjectBilling: (projectId: string) => boolean;
    sendChat: (projectId: string, content: string) => boolean;
    getChatHistory: (projectId: string) => boolean;
    stopChat: (projectId: string) => boolean;
    clearChat: (projectId: string) => boolean;
    /** Command-center AI answer (#32): ask the assistant; returns the request id used to track the streamed answer in `state.assistant`. */
    assistantAsk: (
        prompt: string,
        opts?: {
            projectId?: string;
            agentId?: string;
            /** Explicit provider/model override (e.g. from the AI Chat model picker). */
            provider?: ProviderType;
            model?: string;
            /** Reasoning effort hint ("low" | "medium" | "high" | "max"). */
            effort?: string;
            /** Request a web-search-augmented answer. */
            search?: boolean;
            /** Personal modules explicitly enabled for this turn. */
            contextAreas?: string[];
            /** Allow a safe, non-destructive action in the enabled modules. */
            allowActions?: boolean;
            /** Prior turns to seed multi-turn context (oldest first). */
            history?: { role: "user" | "assistant"; content: string }[];
            /** Inline attachments — base64 data + mime; images go multimodal, files contribute text. */
            attachments?: {
                kind: "image" | "file";
                name: string;
                mime: string;
                data: string;
                text?: string;
            }[];
        },
    ) => string | null;
    /** Stop one in-flight command-center assistant reply. Unknown/completed ids are safe no-ops. */
    assistantStop: (id: string) => boolean;
    // Settings
    getSettings: () => boolean;
    healthCheck: () => boolean;
    modelsGet: () => boolean;
    updateSettings: (patch: Record<string, unknown>) => boolean;
    setSetting: (path: string, value: unknown) => boolean;
    resetSettings: (keepProfilesAndSchemes?: boolean) => boolean;
    composerSetScope: (chatId: string, scope: ConversationScope) => boolean;
    setSecret: (key: string, value: string) => boolean;
    testProvider: (provider: string) => boolean;
    providerSessionsGet: (provider: ProviderSessionBackend, options?: { cursor?: string; limit?: number; archived?: boolean }) => boolean;
    providerSessionStart: (
        provider: ProviderSessionBackend,
        options?: {
            model?: string;
            effort?: string;
            cwd?: string;
            permissionMode?: "read-only" | "workspace-write";
            initialPrompt?: string;
        },
    ) => boolean;
    providerSessionResume: (
        provider: ProviderSessionBackend,
        sessionId: string,
        options?: {
            model?: string;
            effort?: string;
            cwd?: string;
            permissionMode?: "read-only" | "workspace-write";
        },
    ) => boolean;
    providerSessionOpen: (provider: ProviderSessionBackend, sessionId: string, options?: { includeTurns?: boolean }) => boolean;
    providerSessionPrompt: (
        provider: ProviderSessionBackend,
        sessionId: string,
        options: {
            prompt: string;
            model?: string;
            effort?: string;
            cwd?: string;
            permissionMode?: "read-only" | "workspace-write";
        },
    ) => boolean;
    providerAuthGet: (provider: ProviderSessionBackend, refreshToken?: boolean) => boolean;
    providerAuthStart: (provider: ProviderSessionBackend, mode?: "browser" | "deviceCode") => boolean;
    providerAuthCancel: (provider: ProviderSessionBackend, loginId: string) => boolean;
    providerAuthLogout: (provider: ProviderSessionBackend) => boolean;
    securityGet: () => boolean;
    securityClearSecrets: () => boolean;
    securityClearDiagnostics: () => boolean;
    /** Evaluate a command against the live policy without executing it. */
    securityCheckCommand: (command: string) => string | null;
    // Filesystem + database
    fsList: (path: string) => boolean;
    fsRead: (path: string) => boolean;
    fsWrite: (path: string, content: string) => boolean;
    fsMove: (from: string, to: string, copy?: boolean) => boolean;
    fsCopy: (src: string) => boolean;
    fsCut: (src: string) => boolean;
    fsPaste: (dest: string) => boolean;
    fsMkdir: (path: string) => boolean;
    fsNewFile: (path: string) => boolean;
    fsDelete: (path: string) => boolean;
    fsThumbnail: (path: string) => boolean;
    fsProperties: (path: string) => boolean;
    fsExtract: (archivePath: string, destDir: string) => boolean;
    fsCompress: (srcPaths: string[], destPath: string) => boolean;
    fsOpenExternal: (path: string) => boolean;
    fsOpenWith: (path: string) => boolean;
    fsPeek: (path: string) => boolean;
    fsListDir: (path: string) => boolean;
    fsGitStatus: (path: string) => boolean;
    /** Refresh the global local + GitHub repository inventory. Returns its request id. */
    githubOverview: (refresh?: boolean) => string | null;
    /** Load README, history, branches, PRs, and deployments for one repository. */
    githubDetail: (fullName?: string, path?: string) => string | null;
    /** Clone a remote into an explicit local destination. Returns its request id. */
    githubClone: (cloneUrl: string, destinationPath: string, projectIds?: string[]) => string | null;
    gitSummary: (path: string) => boolean;
    gitBranches: (path: string) => boolean;
    gitLog: (path: string, limit?: number) => boolean;
    gitPrs: (path: string, fullName?: string) => boolean;
    gitCheckout: (path: string, branch: string, create?: boolean) => boolean;
    gitFetch: (path: string, fullName?: string) => boolean;
    gitPull: (path: string, fullName?: string) => boolean;
    gitPush: (path: string, setUpstream?: boolean, fullName?: string) => boolean;
    gitStage: (path: string, files: string[]) => boolean;
    gitUnstage: (path: string, files: string[]) => boolean;
    gitCommit: (path: string, message: string, stageAll?: boolean) => boolean;
    gitMerge: (path: string, branch: string, mode?: "ff-only" | "no-ff") => boolean;
    gitCreatePr: (path: string, fullName: string, base: string, title: string, body?: string) => boolean;
    gitMergePr: (path: string, fullName: string, pr: string) => boolean;
    gitDeployments: (fullName: string) => boolean;
    fsDrives: () => boolean;
    fsCheckPaths: (paths: string[]) => boolean;
    filesMetaSetDriveMeta: (path: string, patch: DriveMeta) => boolean;
    fsSearch: (scope: "folder" | "index", root: string, query: string) => boolean;
    indexGet: () => boolean;
    indexAddLocation: (path: string) => boolean;
    indexRemoveLocation: (path: string) => boolean;
    indexReindex: () => boolean;
    indexSetWatch: (enabled: boolean) => boolean;
    fsRoots: () => boolean;
    setDailyLimit: (usd: number) => boolean;
    /** Persist the account-wide daily spend cap (security.dailyCostLimitUSD) AND apply it live. */
    setDailyCostLimit: (usd: number) => boolean;
    /**
     * Central notification gate. Honors settings.notifications.categories[category],
     * .sound and .backgroundOnly (suppressed when the window is focused) before
     * firing the OS notification. Returns true if a notification was actually shown.
     */
    notify: (category: string, title: string, body?: string, opts?: { tag?: string; onClick?: () => void }) => boolean;
    dbQuery: (connectionId: string, sql: string, requestId?: string) => boolean;
    dbSchema: (connectionId: string, requestId?: string) => boolean;
    dbListDatabases: (connectionId: string, requestId?: string) => boolean;
    dbIntrospect: (connectionId: string, target: DbIntrospectionTarget, requestId?: string) => boolean;
    dbTestConnection: (connectionId: string, requestId?: string) => boolean;
    // Calendar
    calendarList: () => boolean;
    calendarUpsert: (event: CalendarEvent) => boolean;
    calendarDelete: (id: string) => boolean;
    calendarSetCategories: (categories: CalendarCategory[]) => boolean;
    // Memory
    memoryList: () => boolean;
    memoryUpsert: (item: MemoryItem) => boolean;
    memoryDelete: (id: string) => boolean;
    memoryGenerate: (projectId?: string) => boolean;
    // Email
    emailGet: () => boolean;
    emailSetFlags: (id: string, flags: { isRead?: boolean; isStarred?: boolean }) => boolean;
    emailMove: (id: string, opts: { folder?: EmailFolder; category?: string | null }) => boolean;
    /** Send and return a request id that can be matched against state.email.sending. */
    emailSend: (to: string, subject: string, body: string, accountId?: string) => string | null;
    emailCategorize: () => boolean;
    emailCorrectSort: (emailId: string, category: string) => boolean;
    emailSetAgent: (config: Partial<EmailAgentConfig>) => boolean;
    emailSetCategories: (categories: EmailCategory[]) => boolean;
    emailConnectGoogle: () => boolean;
    /** Connect and return a request id that can be matched against state.email.connection. */
    emailConnectImap: (input: EmailConnectInput) => string | null;
    emailSyncAccount: (id: string) => boolean;
    emailDisconnectAccount: (id: string) => boolean;
    // Environment variable manager
    envGet: () => boolean;
    envUpsertEnvironment: (environment: Environment) => boolean;
    envDeleteEnvironment: (id: string) => boolean;
    envUpsertVar: (envId: string, variable: EnvVariable) => boolean;
    envDeleteVar: (envId: string, varId: string) => boolean;
    envImport: (envId: string, content: string) => boolean;
    // API key vault + integrations
    keyvaultGet: () => boolean;
    keyvaultUpsertKey: (key: APIKey) => boolean;
    keyvaultDeleteKey: (id: string) => boolean;
    keyvaultTestKey: (id: string) => boolean;
    keyvaultUpsertIntegration: (integration: ServiceConnection) => boolean;
    keyvaultDeleteIntegration: (id: string) => boolean;
    keyvaultVerifyIntegration: (id: string) => boolean;
    /** Atomically persist credentials, verify, and start the account-scoped runtime. */
    connectorConnect: (integration: ServiceConnection, credentials: ConnectorCredentialInput[], runtime?: CoretexConfig["mcpServers"][number]) => string | null;
    connectorVerify: (integrationId: string) => string | null;
    connectorDisconnect: (integrationId: string) => string | null;
    keyvaultScanLeaks: (locations?: string[]) => boolean;
    // Files metadata (icons / colors / tags / collections per path)
    filesMetaSetPath: (path: string, patch: FilePathMeta) => boolean;
    filesMetaClearPath: (path: string) => boolean;
    filesMetaUpsertTag: (tag: FileTag) => boolean;
    filesMetaDeleteTag: (id: string) => boolean;
    filesMetaSetPathTags: (paths: string[], tagIds: string[]) => boolean;
    filesMetaUpsertCollection: (collection: SmartCollection) => boolean;
    filesMetaDeleteCollection: (id: string) => boolean;
    filesMetaUpsertPin: (pin: FilePin) => boolean;
    filesMetaDeletePin: (id: string) => boolean;
    filesMetaSetPins: (pins: FilePin[]) => boolean;
    filesMetaMovePath: (from: string, to: string) => boolean;
    // Multi-agent topology
    runTopology: (kind: TopologyKind, prompt: string, agentIds: string[], rounds?: number) => boolean;
    stopTopology: () => boolean;
    // MCP host
    mcpConnect: (serverId: string) => boolean;
    mcpDisconnect: (serverId: string) => boolean;
    mcpCallTool: (serverId: string, name: string, args: Record<string, unknown>) => boolean;
    // Running servers
    scanServers: () => boolean;
    killServer: (pid: number) => boolean;
    // Terminal multiplexer
    terminalCreate: (opts?: { profileId?: string; shell?: string; cwd?: string; cols?: number; rows?: number; agentId?: string; projectId?: string }) => boolean;
    terminalInput: (id: string, data: string) => boolean;
    terminalResize: (id: string, cols: number, rows: number) => boolean;
    terminalKill: (id: string) => boolean;
    terminalList: () => boolean;
    // Browser control (#16)
    browserNavigate: (sessionId: string, url: string) => boolean;
    browserReadDom: (sessionId: string) => boolean;
    browserClick: (sessionId: string, selector: string) => boolean;
    browserEval: (sessionId: string, js: string) => boolean;
    /** Relay → Brain: report the page's live url/title (from the BrowserView onUrlChange). */
    browserReport: (sessionId: string, url: string, title?: string) => boolean;
    /** Relay → Brain: result of a DOM/click/eval action the host actually ran on the <webview>. */
    browserResultReport: (result: BrowserControlResult) => boolean;
    /** Relay → Brain: declare whether this host can script the page (Electron <webview> present). */
    browserHostCaps: (canScript: boolean) => boolean;
    browserTakeover: (sessionId: string) => boolean;
    // Terminal Buddy
    buddyProbe: (sessionId: string, shell?: string) => boolean;
    buddyRun: (sessionId: string, request: string, mode: BuddyMode) => boolean;
    buddyAccept: (sessionId: string, stepId: string, command?: string) => boolean;
    buddySkip: (sessionId: string, stepId: string) => boolean;
    buddyReject: (sessionId: string) => boolean;
    buddyRetry: (sessionId: string, stepId: string, approach?: string) => boolean;
    buddySetMode: (sessionId: string, mode: BuddyMode) => boolean;
    buddyHalt: (sessionId: string) => boolean;
    // Docker
    dockerRefresh: (operationId?: string) => boolean;
    dockerAction: (action: DockerAction, id: string, operationId?: string) => boolean;
    dockerPrune: (target: DockerPruneTarget, operationId?: string) => boolean;
    // Remote (SSH / SFTP / FTP)
    remoteGet: () => boolean;
    remoteConnect: (hostId: string) => boolean;
    remoteDisconnect: (sessionId: string) => boolean;
    remoteList: (sessionId: string, path: string) => boolean;
    remoteMkdir: (sessionId: string, path: string) => boolean;
    remoteRename: (sessionId: string, from: string, to: string) => boolean;
    remoteDelete: (sessionId: string, path: string, isDir: boolean) => boolean;
    remoteDownload: (sessionId: string, remotePath: string, localPath: string) => boolean;
    remoteUpload: (sessionId: string, localPath: string, remotePath: string) => boolean;
    // Ollama model manager
    ollamaList: () => boolean;
    ollamaPull: (model: string) => boolean;
    ollamaDelete: (model: string) => boolean;
    ollamaShow: (model: string) => boolean;
}

export interface UseCoretexResult {
    state: CoretexState;
    connected: boolean;
    client: BridgeClient;
    actions: CoretexActions;
}

/**
 * Connect to the Coretex Brain and stream live orchestrator state into React.
 * @param url WebSocket URL of the Brain bridge (default ws://localhost:8765).
 * @param authToken Ephemeral token supplied by the trusted host bootstrap.
 */
export function useCoretex(url: string = "ws://localhost:8765", authToken?: string): UseCoretexResult {
    const clientRef = useRef<BridgeClient | null>(null);
    if (clientRef.current === null) {
        clientRef.current = new BridgeClient(url, authToken);
    }
    const client = clientRef.current;

    const [state, dispatch] = useReducer(reducer, initialState);
    const [connected, setConnected] = useState(false);

    // Latest settings snapshot for stable callbacks (e.g. notify) that must not
    // re-create the actions object on every settings change.
    const settingsRef = useRef<CoretexConfig | null>(null);
    settingsRef.current = state.settings;

    useEffect(() => {
        const unsubscribe = client.onAny((event) => dispatch({ type: "event", event }));

        const unsubscribeConnect = client.onConnect(() => {
            setConnected(true);
            dispatch({ type: "connection", connected: true });
            client.requestStatus();
            client.requestHealthCheck();
            client.send({ type: "settings:get" });
            client.send({ type: "security:get" });
            client.send({ type: "fs:roots" });
            client.send({ type: "calendar:list" });
            client.send({ type: "servers:scan" });
            client.send({ type: "terminal:list" });
            client.send({ type: "memory:list" });
            client.send({ type: "email:get" });
            client.send({ type: "env:get" });
            client.send({ type: "keyvault:get" });
            client.send({ type: "filesmeta:get" });
            client.send({ type: "index:get" });
            client.send({ type: "models:get" });
            client.send({
                type: "provider:sessions:get",
                provider: "codex",
                limit: 50,
            });
            client.send({ type: "provider:auth:get", provider: "codex" });
            client.send({ type: "remote:get" });
            client.send({ type: "docker:refresh" });
        });
        const unsubscribeDisconnect = client.onDisconnect(() => {
            setConnected(false);
            dispatch({ type: "connection", connected: false });
        });

        client.connect();

        // Periodic snapshot keeps tasks/agents/projects consistent even if a
        // granular event is missed, while the event stream drives live feel.
        const poll = window.setInterval(() => {
            // Granular bridge events provide the live updates. This is only a
            // consistency repair, so don't serialize the full workspace every
            // three seconds per background window.
            if (client.connected && document.visibilityState === "visible") client.requestStatus();
        }, 30_000);

        return () => {
            window.clearInterval(poll);
            unsubscribe();
            unsubscribeConnect();
            unsubscribeDisconnect();
            client.disconnect();
        };
    }, [client]);

    const actions = useMemo<CoretexActions>(
        () => ({
            createTask: (task) => client.send({ type: "task:create", task }),
            cancelTask: (taskId) => client.send({ type: "task:cancel", taskId }),
            deleteTask: (taskId) => client.send({ type: "task:delete", taskId }),
            reprioritizeTask: (taskId, priority) => client.send({ type: "task:reprioritize", taskId, priority }),
            refineTask: (taskId, patch) => client.send({ type: "task:refine", taskId, patch }),
            pauseAgent: (agentId) => client.send({ type: "agent:pause", agentId }),
            resumeAgent: (agentId) => client.send({ type: "agent:resume", agentId }),
            setAgentDailyBudget: (agentId, tokens) => client.send({ type: "agent:setDailyBudget", agentId, tokens }),
            createAgent: (config) => client.send({ type: "agent:create", config }),
            updateAgent: (agentId, patch) => client.send({ type: "agent:update", agentId, patch }),
            createAgents: (config, count) => client.send({ type: "agent:createMany", config, count }),
            removeAgent: (agentId) => client.send({ type: "agent:remove", agentId }),
            haltAgent: (agentId) => client.send({ type: "agent:halt", agentId }),
            haltAllAgents: (projectId) => client.send({ type: "agent:haltAll", projectId }),
            pauseAllAgents: (projectId) => client.send({ type: "agent:pauseAll", projectId }),
            resumeAllAgents: (projectId) => client.send({ type: "agent:resumeAll", projectId }),
            setAgentPermissionMode: (agentId, mode) => client.send({ type: "agent:setPermissionMode", agentId, mode }),
            requestAgentCanvas: () => client.send({ type: "agent:canvas:get" }),
            setAgentCanvasPosition: (agentId, position) => client.send({ type: "agent:canvas:setPosition", agentId, position }),
            setAgentCanvasLayout: (positions) => client.send({ type: "agent:canvas:setLayout", positions }),
            resetAgentCanvasLayout: () => client.send({ type: "agent:canvas:reset" }),
            setAgentCanvasPreferences: (patch) => client.send({ type: "agent:canvas:updatePreferences", patch }),
            setAgentCanvasCardSettings: (agentId, patch) => client.send({ type: "agent:canvas:updateCard", agentId, patch }),
            runPlan: (plannerAgentId, prompt, taskId) => client.send({ type: "plan:run", plannerAgentId, prompt, taskId }),
            stopPlan: () => client.send({ type: "plan:stop" }),
            createProject: (project) => client.send({ type: "project:create", project }),
            addProjectDocuments: (projectId, documents) => client.send({ type: "project:addDocuments", projectId, documents }),
            updateProjectDocument: (projectId, name, patch) => client.send({ type: "project:updateDocument", projectId, name, patch }),
            removeProjectDocument: (projectId, name) => client.send({ type: "project:removeDocument", projectId, name }),
            setProjectIcon: (projectId, icon, color) => client.send({ type: "project:setIcon", projectId, icon, color }),
            requestStatus: () => client.requestStatus(),
            requestHealthCheck: () => client.requestHealthCheck(),
            setProjectSource: (projectId, sourcePath) => client.send({ type: "project:setSource", projectId, sourcePath }),
            setProjectRepos: (projectId, repos) => client.send({ type: "project:setRepos", projectId, repos }),
            linkRepoToProjects: (projectIds, repo) => client.send({ type: "project:linkRepo", projectIds, repo }),
            unlinkProjectRepo: (projectId, repoId) => client.send({ type: "project:unlinkRepo", projectId, repoId }),
            updateProject: (projectId, patch) => client.send({ type: "project:update", projectId, patch }),
            deleteProject: (projectId) => client.send({ type: "project:delete", projectId }),
            reindexCode: (projectId, full) => client.send({ type: "project:reindexCode", projectId, full }),
            setAssistantModel: (projectId, provider, model) =>
                client.send({
                    type: "project:setAssistantModel",
                    projectId,
                    provider,
                    model,
                }),
            setProjectBudget: (projectId, budgetUSD) => client.send({ type: "project:setBudget", projectId, budgetUSD }),
            getProjectBilling: (projectId) => client.send({ type: "project:getBilling", projectId }),
            sendChat: (projectId, content) => client.send({ type: "chat:send", projectId, content }),
            getChatHistory: (projectId) => client.send({ type: "chat:getHistory", projectId }),
            stopChat: (projectId) => client.send({ type: "chat:stop", projectId }),
            clearChat: (projectId) => client.send({ type: "chat:clear", projectId }),
            assistantAsk: (prompt, opts) => {
                const id = `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                const sent = client.send({
                    type: "assistant:ask",
                    id,
                    prompt,
                    projectId: opts?.projectId,
                    agentId: opts?.agentId,
                    provider: opts?.provider,
                    model: opts?.model,
                    effort: opts?.effort,
                    search: opts?.search,
                    contextAreas: opts?.contextAreas,
                    allowActions: opts?.allowActions,
                    history: opts?.history,
                    attachments: opts?.attachments,
                });
                return sent ? id : null;
            },
            assistantStop: (id) => client.send({ type: "assistant:stop", id }),
            getSettings: () => client.send({ type: "settings:get" }),
            healthCheck: () => client.send({ type: "system:health_check" }),
            modelsGet: () => client.send({ type: "models:get" }),
            updateSettings: (patch) => client.send({ type: "settings:update", patch }),
            setSetting: (path, value) => client.send({ type: "settings:setPath", path, value }),
            composerSetScope: (chatId, scope) => client.send({ type: "composer:setScope", chatId, scope }),
            resetSettings: (keepProfilesAndSchemes) => client.send({ type: "settings:reset", keepProfilesAndSchemes }),
            setSecret: (key, value) => client.send({ type: "settings:setSecret", key, value }),
            testProvider: (provider) => client.send({ type: "settings:testProvider", provider }),
            providerSessionsGet: (provider, options) =>
                client.send({
                    type: "provider:sessions:get",
                    provider,
                    ...(options ?? {}),
                }),
            providerSessionStart: (provider, options) =>
                client.send({
                    type: "provider:session:start",
                    provider,
                    ...(options ?? {}),
                }),
            providerSessionResume: (provider, sessionId, options) =>
                client.send({
                    type: "provider:session:resume",
                    provider,
                    sessionId,
                    ...(options ?? {}),
                }),
            providerSessionOpen: (provider, sessionId, options) =>
                client.send({
                    type: "provider:session:open",
                    provider,
                    sessionId,
                    ...(options ?? {}),
                }),
            providerSessionPrompt: (provider, sessionId, options) =>
                client.send({
                    type: "provider:session:prompt",
                    provider,
                    sessionId,
                    ...options,
                }),
            providerAuthGet: (provider, refreshToken) =>
                client.send({
                    type: "provider:auth:get",
                    provider,
                    ...(refreshToken ? { refreshToken } : {}),
                }),
            providerAuthStart: (provider, mode) =>
                client.send({
                    type: "provider:auth:start",
                    provider,
                    ...(mode ? { mode } : {}),
                }),
            providerAuthCancel: (provider, loginId) => client.send({ type: "provider:auth:cancel", provider, loginId }),
            providerAuthLogout: (provider) => client.send({ type: "provider:auth:logout", provider }),
            securityGet: () => client.send({ type: "security:get" }),
            securityClearSecrets: () => client.send({ type: "security:clearSecrets" }),
            securityClearDiagnostics: () => client.send({ type: "security:clearDiagnostics" }),
            securityCheckCommand: (command) => {
                const requestId = `security_check_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                return client.send({
                    type: "security:checkCommand",
                    requestId,
                    command,
                })
                    ? requestId
                    : null;
            },
            fsList: (path) => client.send({ type: "fs:list", path }),
            fsRead: (path) => client.send({ type: "fs:read", path }),
            fsWrite: (path, content) => client.send({ type: "fs:write", path, content }),
            fsMove: (from, to, copy) => client.send({ type: "fs:move", from, to, copy }),
            fsCopy: (src) => client.send({ type: "fs:copy", src }),
            fsCut: (src) => client.send({ type: "fs:cut", src }),
            fsPaste: (dest) => client.send({ type: "fs:paste", dest }),
            fsMkdir: (path) => client.send({ type: "fs:mkdir", path }),
            fsNewFile: (path) => client.send({ type: "fs:newFile", path }),
            fsDelete: (path) => client.send({ type: "fs:delete", path }),
            fsThumbnail: (path) => client.send({ type: "fs:thumbnail", path }),
            fsProperties: (path) => client.send({ type: "fs:properties", path }),
            fsExtract: (archivePath, destDir) => client.send({ type: "fs:extract", archivePath, destDir }),
            fsCompress: (srcPaths, destPath) => client.send({ type: "fs:compress", srcPaths, destPath }),
            fsOpenExternal: (path) => client.send({ type: "fs:openExternal", path }),
            fsOpenWith: (path) => client.send({ type: "fs:openWith", path }),
            fsPeek: (path) => client.send({ type: "fs:peek", path }),
            fsListDir: (path) => client.send({ type: "fs:listDir", path }),
            fsGitStatus: (path) => client.send({ type: "fs:gitStatus", path }),
            githubOverview: (refresh) => {
                const requestId = `github_overview_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                return client.send({ type: "github:overview", requestId, refresh }) ? requestId : null;
            },
            githubDetail: (fullName, path) => {
                if (!fullName && !path) return null;
                // A stable key lets the repository view read the response directly
                // while independent repositories can load concurrently.
                const requestId = fullName || path!;
                return client.send({ type: "github:detail", requestId, fullName, path }) ? requestId : null;
            },
            githubClone: (cloneUrl, destinationPath, projectIds) => {
                const requestId = `github_clone_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                return client.send({ type: "github:clone", requestId, cloneUrl, destinationPath, projectIds }) ? requestId : null;
            },
            gitSummary: (path) => client.send({ type: "git:summary", requestId: path, path }),
            gitBranches: (path) => client.send({ type: "git:branches", requestId: path, path }),
            gitLog: (path, limit) => client.send({ type: "git:log", requestId: path, path, limit }),
            gitPrs: (path, fullName) => client.send({ type: "git:prs", requestId: path, path, fullName }),
            gitCheckout: (path, branch, create) =>
                client.send({
                    type: "git:checkout",
                    requestId: path,
                    path,
                    branch,
                    create,
                }),
            gitFetch: (path, fullName) => client.send({ type: "git:fetch", requestId: path, path, fullName }),
            gitPull: (path, fullName) => client.send({ type: "git:pull", requestId: path, path, fullName }),
            gitPush: (path, setUpstream, fullName) => client.send({ type: "git:push", requestId: path, path, setUpstream, fullName }),
            gitStage: (path, files) => client.send({ type: "git:stage", requestId: path, path, files }),
            gitUnstage: (path, files) => client.send({ type: "git:unstage", requestId: path, path, files }),
            gitCommit: (path, message, stageAll = true) => client.send({ type: "git:commit", requestId: path, path, message, stageAll }),
            gitMerge: (path, branch, mode) => client.send({ type: "git:merge", requestId: path, path, branch, mode }),
            gitCreatePr: (path, fullName, base, title, body) => client.send({ type: "git:createPr", requestId: path, path, fullName, base, title, body }),
            gitMergePr: (path, fullName, pr) => client.send({ type: "git:mergePr", requestId: path, path, fullName, pr }),
            gitDeployments: (fullName) => client.send({ type: "git:deployments", requestId: fullName, fullName }),
            fsDrives: () => client.send({ type: "fs:drives" }),
            fsCheckPaths: (paths) => client.send({ type: "fs:checkPaths", paths }),
            filesMetaSetDriveMeta: (path, patch) => client.send({ type: "filesmeta:setDriveMeta", path, patch }),
            fsSearch: (scope, root, query) => client.send({ type: "fs:search", scope, root, query }),
            indexGet: () => client.send({ type: "index:get" }),
            indexAddLocation: (path) => client.send({ type: "index:addLocation", path }),
            indexRemoveLocation: (path) => client.send({ type: "index:removeLocation", path }),
            indexReindex: () => client.send({ type: "index:reindex" }),
            indexSetWatch: (enabled) => client.send({ type: "index:setWatch", enabled }),
            fsRoots: () => client.send({ type: "fs:roots" }),
            setDailyLimit: (usd) => client.send({ type: "cost:setDailyLimit", usd }),
            setDailyCostLimit: (usd) => {
                // Persist the cap into settings (Brain reads it into CostTracker on change)
                // and also fire the live runtime command so it applies before the next save.
                const ok = client.send({
                    type: "settings:setPath",
                    path: "security.dailyCostLimitUSD",
                    value: usd,
                });
                client.send({ type: "cost:setDailyLimit", usd });
                return ok;
            },
            notify: (category, title, body, opts) => {
                const n = settingsRef.current?.notifications;
                // Master switch — when off, nothing fires (except we still allow "test" so Enable flow works? No — gate all).
                if (n && n.desktopEnabled === false && category !== "test") return false;
                // Respect the per-category toggle (default on if the category is unknown).
                if (n && n.categories && n.categories[category] === false) return false;
                // Quiet hours — mute non-critical categories overnight. Critical ones still fire.
                if (n?.quietHours?.enabled && category !== "test") {
                    const critical = category === "approvalNeeded" || category === "agentError" || category === "budget" || category === "mcpError";
                    if (!critical && isInQuietHours(n.quietHours.start, n.quietHours.end)) return false;
                }
                // Digest mode — buffer non-critical alerts instead of firing immediately.
                if (n?.digest?.enabled && category !== "test") {
                    const critical = category === "approvalNeeded" || category === "agentError" || category === "budget" || category === "mcpError";
                    if (!critical) {
                        enqueueDigest(category, title, body, n.digest.everyMinutes);
                        return true; // accepted into digest
                    }
                }
                // backgroundOnly → suppress while the window is focused.
                if (n?.backgroundOnly && typeof document !== "undefined" && document.hasFocus()) return false;
                return fireNotification(title, body, {
                    silent: !(n?.sound ?? false),
                    tag: opts?.tag,
                    onClick: opts?.onClick,
                });
            },
            dbQuery: (connectionId, sql, requestId) =>
                client.send({
                    type: "db:query",
                    connectionId,
                    sql,
                    ...(requestId ? { requestId } : {}),
                }),
            dbSchema: (connectionId, requestId) =>
                client.send({
                    type: "db:schema",
                    connectionId,
                    ...(requestId ? { requestId } : {}),
                }),
            dbListDatabases: (connectionId, requestId) =>
                client.send({
                    type: "db:listDatabases",
                    connectionId,
                    ...(requestId ? { requestId } : {}),
                }),
            dbIntrospect: (connectionId, target, requestId) =>
                client.send({
                    type: "db:introspect",
                    connectionId,
                    target,
                    ...(requestId ? { requestId } : {}),
                }),
            dbTestConnection: (connectionId, requestId) =>
                client.send({
                    type: "db:testConnection",
                    connectionId,
                    ...(requestId ? { requestId } : {}),
                }),
            calendarList: () => client.send({ type: "calendar:list" }),
            calendarUpsert: (event) => client.send({ type: "calendar:upsert", event }),
            calendarDelete: (id) => client.send({ type: "calendar:delete", id }),
            calendarSetCategories: (categories) => client.send({ type: "calendar:setCategories", categories }),
            memoryList: () => client.send({ type: "memory:list" }),
            memoryUpsert: (item) => client.send({ type: "memory:upsert", item }),
            memoryDelete: (id) => client.send({ type: "memory:delete", id }),
            memoryGenerate: (projectId) => client.send({ type: "memory:generate", projectId }),
            emailGet: () => client.send({ type: "email:get" }),
            emailSetFlags: (id, flags) => client.send({ type: "email:setFlags", id, ...flags }),
            emailMove: (id, opts) => client.send({ type: "email:move", id, ...opts }),
            emailSend: (to, subject, body, accountId) => {
                const requestId = `email_send_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                return client.send({
                    type: "email:send",
                    requestId,
                    accountId,
                    to,
                    subject,
                    body,
                })
                    ? requestId
                    : null;
            },
            emailCategorize: () => client.send({ type: "email:categorize" }),
            emailCorrectSort: (emailId, category) => client.send({ type: "email:correctSort", emailId, category }),
            emailSetAgent: (config) => client.send({ type: "email:setAgent", config }),
            emailSetCategories: (categories) => client.send({ type: "email:setCategories", categories }),
            emailConnectGoogle: () => client.send({ type: "email:connectGoogle" }),
            emailConnectImap: (input) => {
                const requestId = `email_connect_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                return client.send({ type: "email:connectImap", requestId, input }) ? requestId : null;
            },
            emailSyncAccount: (id) => client.send({ type: "email:syncAccount", id }),
            emailDisconnectAccount: (id) => client.send({ type: "email:disconnectAccount", id }),
            envGet: () => client.send({ type: "env:get" }),
            envUpsertEnvironment: (environment) => client.send({ type: "env:upsertEnvironment", environment }),
            envDeleteEnvironment: (id) => client.send({ type: "env:deleteEnvironment", id }),
            envUpsertVar: (envId, variable) => client.send({ type: "env:upsertVar", envId, variable }),
            envDeleteVar: (envId, varId) => client.send({ type: "env:deleteVar", envId, varId }),
            envImport: (envId, content) => client.send({ type: "env:import", envId, content }),
            keyvaultGet: () => client.send({ type: "keyvault:get" }),
            keyvaultUpsertKey: (key) => client.send({ type: "keyvault:upsertKey", key }),
            keyvaultDeleteKey: (id) => client.send({ type: "keyvault:deleteKey", id }),
            keyvaultTestKey: (id) => client.send({ type: "keyvault:testKey", id }),
            keyvaultUpsertIntegration: (integration) => client.send({ type: "keyvault:upsertIntegration", integration }),
            keyvaultDeleteIntegration: (id) => client.send({ type: "keyvault:deleteIntegration", id }),
            keyvaultVerifyIntegration: (id) => client.send({ type: "keyvault:verifyIntegration", id }),
            connectorConnect: (integration, credentials, runtime) => {
                const requestId = `connector_connect_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                return client.send({
                    type: "connector:connect",
                    requestId,
                    integration,
                    credentials,
                    ...(runtime ? { runtime } : {}),
                })
                    ? requestId
                    : null;
            },
            connectorVerify: (integrationId) => {
                const requestId = `connector_verify_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                return client.send({
                    type: "connector:verify",
                    requestId,
                    integrationId,
                })
                    ? requestId
                    : null;
            },
            connectorDisconnect: (integrationId) => {
                const requestId = `connector_disconnect_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                return client.send({
                    type: "connector:disconnect",
                    requestId,
                    integrationId,
                })
                    ? requestId
                    : null;
            },
            keyvaultScanLeaks: (locations) => client.send({ type: "keyvault:scanLeaks", locations }),
            filesMetaSetPath: (path, patch) => client.send({ type: "filesmeta:setPath", path, patch }),
            filesMetaClearPath: (path) => client.send({ type: "filesmeta:clearPath", path }),
            filesMetaUpsertTag: (tag) => client.send({ type: "filesmeta:upsertTag", tag }),
            filesMetaDeleteTag: (id) => client.send({ type: "filesmeta:deleteTag", id }),
            filesMetaSetPathTags: (paths, tagIds) => client.send({ type: "filesmeta:setPathTags", paths, tagIds }),
            filesMetaUpsertCollection: (collection) => client.send({ type: "filesmeta:upsertCollection", collection }),
            filesMetaDeleteCollection: (id) => client.send({ type: "filesmeta:deleteCollection", id }),
            filesMetaUpsertPin: (pin) => client.send({ type: "filesmeta:upsertPin", pin }),
            filesMetaDeletePin: (id) => client.send({ type: "filesmeta:deletePin", id }),
            filesMetaSetPins: (pins) => client.send({ type: "filesmeta:setPins", pins }),
            filesMetaMovePath: (from, to) => client.send({ type: "filesmeta:movePath", from, to }),
            runTopology: (kind, prompt, agentIds, rounds) => client.send({ type: "topology:run", kind, prompt, agentIds, rounds }),
            stopTopology: () => client.send({ type: "topology:stop" }),
            mcpConnect: (serverId) => client.send({ type: "mcp:connect", serverId }),
            mcpDisconnect: (serverId) => client.send({ type: "mcp:disconnect", serverId }),
            mcpCallTool: (serverId, name, args) => client.send({ type: "mcp:callTool", serverId, name, args }),
            scanServers: () => client.send({ type: "servers:scan" }),
            killServer: (pid) => client.send({ type: "servers:kill", pid }),
            terminalCreate: (opts) => client.send({ type: "terminal:create", ...(opts ?? {}) }),
            terminalInput: (id, data) => client.send({ type: "terminal:input", id, data }),
            terminalResize: (id, cols, rows) => client.send({ type: "terminal:resize", id, cols, rows }),
            terminalKill: (id) => {
                // Optimistic drop so the dock UI (and alwaysShow reopen) don't wait on the WS
                // round-trip — otherwise close-X / confirm-close feel like they do nothing while
                // sessions remain in state.
                const ok = client.send({ type: "terminal:kill", id });
                dispatch({
                    type: "event",
                    event: { type: "terminal:exit", id, code: -1 },
                });
                return ok;
            },
            terminalList: () => client.send({ type: "terminal:list" }),
            browserNavigate: (sessionId, url) => client.send({ type: "browser:navigate", sessionId, url }),
            browserReadDom: (sessionId) => client.send({ type: "browser:readDom", sessionId }),
            browserClick: (sessionId, selector) => client.send({ type: "browser:click", sessionId, selector }),
            browserEval: (sessionId, js) => client.send({ type: "browser:eval", sessionId, js }),
            browserReport: (sessionId, url, title) => client.send({ type: "browser:report", sessionId, url, title }),
            browserResultReport: (result) => client.send({ type: "browser:resultReport", result }),
            browserHostCaps: (canScript) => client.send({ type: "browser:hostCaps", canScript }),
            browserTakeover: (sessionId) => client.send({ type: "browser:takeover", sessionId }),
            buddyProbe: (sessionId, shell) => client.send({ type: "buddy:probe", sessionId, shell }),
            buddyRun: (sessionId, request, mode) => client.send({ type: "buddy:run", sessionId, request, mode }),
            buddyAccept: (sessionId, stepId, command) => client.send({ type: "buddy:accept", sessionId, stepId, command }),
            buddySkip: (sessionId, stepId) => client.send({ type: "buddy:skip", sessionId, stepId }),
            buddyReject: (sessionId) => client.send({ type: "buddy:reject", sessionId }),
            buddyRetry: (sessionId, stepId, approach) => client.send({ type: "buddy:retry", sessionId, stepId, approach }),
            buddySetMode: (sessionId, mode) => client.send({ type: "buddy:setMode", sessionId, mode }),
            buddyHalt: (sessionId) => client.send({ type: "buddy:halt", sessionId }),
            dockerRefresh: (operationId) =>
                client.send({
                    type: "docker:refresh",
                    operationId: operationId ?? `docker_refresh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                }),
            dockerAction: (action, id, operationId) =>
                client.send({
                    type: "docker:action",
                    action,
                    id,
                    operationId: operationId ?? `docker_action_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                }),
            dockerPrune: (target, operationId) =>
                client.send({
                    type: "docker:prune",
                    target,
                    operationId: operationId ?? `docker_prune_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                }),
            remoteGet: () => client.send({ type: "remote:get" }),
            remoteConnect: (hostId) => client.send({ type: "remote:connect", hostId }),
            remoteDisconnect: (sessionId) => client.send({ type: "remote:disconnect", sessionId }),
            remoteList: (sessionId, path) => client.send({ type: "remote:list", sessionId, path }),
            remoteMkdir: (sessionId, path) => client.send({ type: "remote:mkdir", sessionId, path }),
            remoteRename: (sessionId, from, to) => client.send({ type: "remote:rename", sessionId, from, to }),
            remoteDelete: (sessionId, path, isDir) => client.send({ type: "remote:delete", sessionId, path, isDir }),
            remoteDownload: (sessionId, remotePath, localPath) =>
                client.send({
                    type: "remote:download",
                    sessionId,
                    remotePath,
                    localPath,
                }),
            remoteUpload: (sessionId, localPath, remotePath) =>
                client.send({
                    type: "remote:upload",
                    sessionId,
                    localPath,
                    remotePath,
                }),
            ollamaList: () => client.send({ type: "ollama:list" }),
            ollamaPull: (model) => client.send({ type: "ollama:pull", model }),
            ollamaDelete: (model) => client.send({ type: "ollama:delete", model }),
            ollamaShow: (model) => client.send({ type: "ollama:show", model }),
        }),
        [client, dispatch],
    );

    return { state, connected, client, actions };
}

// ---- Shared presentation helpers (used across dashboard panels) ----

export const AGENT_STATUS_COLOR: Record<AgentStatus, "gray" | "brand" | "success" | "warning" | "error"> = {
    idle: "gray",
    thinking: "brand",
    working: "success",
    paused: "warning",
    error: "error",
};

export const TASK_PRIORITY_COLOR: Record<TaskPriority, "gray" | "blue" | "warning" | "error"> = {
    low: "gray",
    medium: "blue",
    high: "warning",
    critical: "error",
};

// ---- Customizable badge colors (priority + role), read from settings ----
export const DEFAULT_PRIORITY_COLOR: Record<string, BadgeColor> = {
    low: "gray",
    medium: "blue",
    high: "warning",
    critical: "error",
};
export const DEFAULT_ROLE_COLOR: Record<string, BadgeColor> = {
    orchestrator: "purple",
    planner: "slate",
    researcher: "blue",
    developer: "indigo",
    reviewer: "orange",
    writer: "pink",
    analyst: "sky",
    devops: "warning",
    qa: "success",
    custom: "gray",
};

/** Badge color for a task priority — from settings if customized, else the default scale. */
export function priorityColor(priority: string, settings: CoretexConfig | null): BadgeColor {
    return settings?.appearance.badges?.priority?.[priority as TaskPriority] ?? DEFAULT_PRIORITY_COLOR[priority] ?? "gray";
}

/** Badge color for an agent role — from settings if customized, else the default hue. */
export function roleColor(role: string, settings: CoretexConfig | null): BadgeColor {
    const map = settings?.appearance.badges?.role as Record<string, BadgeColor> | undefined;
    return map?.[role] ?? DEFAULT_ROLE_COLOR[role] ?? "gray";
}

export const TASK_STATUS_LABEL: Record<string, string> = {
    pending: "Pending",
    assigned: "Assigned",
    in_progress: "In Progress",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
};

/**
 * Agents belonging to a project: tagged/owned by it (config.tags includes the
 * project id), OR currently running one of the project's tasks. Mirrors the
 * Brain's _projectAgentIds so project-scoped controls and panels agree.
 */
export function agentsForProject(agents: AgentState[], tasks: Task[], projectId: string): AgentState[] {
    const taskProject = new Map<string, string | undefined>(tasks.map((t) => [t.id, t.projectId]));
    return agents.filter((a) => {
        if (a.config.tags?.includes(projectId)) return true;
        if (a.currentTaskId && taskProject.get(a.currentTaskId) === projectId) return true;
        return false;
    });
}

/** An agent is "active" when it is working or thinking. */
export function isAgentActive(a: AgentState): boolean {
    return a.status === "working" || a.status === "thinking";
}

export interface AiAvailability {
    available: boolean;
    reason?: string;
}

/** Live, executable models only. Cached entries remain in state.models for reference. */
export function liveModels(state: CoretexState): ModelInfo[] {
    const healthy = new Set(state.health.filter((health) => health.healthy && health.status !== "checking").map((health) => health.provider));
    return state.models.filter((model) => !model.stale && healthy.has(model.provider));
}

export function modelAvailability(state: CoretexState, provider?: ProviderType, model?: string): AiAvailability {
    if (!state.connected)
        return {
            available: false,
            reason: "Brain is disconnected. Reconnect before using AI.",
        };
    if (state.settings && !state.settings.ai.enabled) return { available: false, reason: "AI is disabled in Settings." };
    if (!provider || !model) return { available: false, reason: "Select a live model." };
    const health = state.health.find((entry) => entry.provider === provider);
    if (!health)
        return {
            available: false,
            reason: `${provider} is disabled or not configured.`,
        };
    if (health.status === "checking")
        return {
            available: false,
            reason: `${provider} is checking its live connection.`,
        };
    if (!health.healthy) return { available: false, reason: healthErrorLabel(health.error) };
    const live = state.models.some((entry) => entry.provider === provider && entry.id === model && !entry.stale);
    if (!live)
        return {
            available: false,
            reason: `${model} is cached or unavailable from ${provider}.`,
        };
    return { available: true };
}

export function agentAvailability(state: CoretexState, agent: AgentState, requireIdle: boolean = false): AiAvailability {
    const model = modelAvailability(state, agent.config.provider, agent.config.model);
    if (!model.available) return model;
    if (agent.status === "paused") return { available: false, reason: `${agent.config.name} is paused.` };
    if (agent.status === "error")
        return {
            available: false,
            reason: agent.errorMessage || `${agent.config.name} is in an error state.`,
        };
    if (requireIdle && agent.status !== "idle")
        return {
            available: false,
            reason: `${agent.config.name} is currently ${agent.status}.`,
        };
    return { available: true };
}

/** Ordered columns for the kanban task board. */
export const TASK_BOARD_COLUMNS: { status: string; label: string }[] = [
    { status: "pending", label: "Pending" },
    { status: "assigned", label: "Assigned" },
    { status: "in_progress", label: "In Progress" },
    { status: "completed", label: "Completed" },
    { status: "failed", label: "Failed" },
    { status: "cancelled", label: "Cancelled" },
];

/**
 * Format a money amount in the user's chosen currency (appearance.locale.currency).
 * Despite the legacy name, this is now currency-aware: it uses Intl.NumberFormat with
 * the active currency, falling back to the original "$" formatting if the currency code
 * is invalid or Intl is unavailable. The name + signature are kept so every existing
 * caller stays working and instantly becomes currency-aware.
 */
export function formatUSD(n: number): string {
    const currency = getCurrency() || "USD";
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
            // Keep extra precision for sub-dollar amounts (matches the legacy 4-decimal behavior).
            minimumFractionDigits: n < 1 ? 4 : 2,
            maximumFractionDigits: n < 1 ? 4 : 2,
        }).format(n);
    } catch {
        // Invalid currency code (or no Intl) — fall back to the original "$" formatting.
        return "$" + n.toFixed(n < 1 ? 4 : 2);
    }
}

/** Currency-aware money formatter (alias of {@link formatUSD}). */
export const formatMoney = formatUSD;

/** Coerce a Date | number | string into a Date (invalid values → current time). */
function toDate(d: Date | number | string): Date {
    const date = d instanceof Date ? d : new Date(d);
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Format a date honoring appearance.locale.dateFormat (a token string like "YYYY-MM-DD"
 * or "MM/DD/YYYY"). Supported tokens: YYYY, YY, MMMM, MMM, MM, M, DD, D. Unknown tokens
 * are left as-is, so any literal separators in the format string pass through unchanged.
 */
export function formatDate(d: Date | number | string): string {
    const date = toDate(d);
    const fmt = getDateFormat() || "YYYY-MM-DD";
    const yyyy = date.getFullYear();
    const m = date.getMonth(); // 0-based
    const day = date.getDate();
    const pad = (n: number) => String(n).padStart(2, "0");
    // Order matters: replace longer tokens before their prefixes (YYYY before YY, MMMM/MMM before MM/M, DD before D).
    return fmt
        .replace(/YYYY/g, String(yyyy))
        .replace(/YY/g, pad(yyyy % 100))
        .replace(/MMMM/g, MONTHS_LONG[m]!)
        .replace(/MMM/g, MONTHS_SHORT[m]!)
        .replace(/MM/g, pad(m + 1))
        .replace(/M/g, String(m + 1))
        .replace(/DD/g, pad(day))
        .replace(/D/g, String(day));
}

/**
 * Format a time honoring appearance.locale.timeFormat (12h vs 24h). When `withSeconds`
 * is true the seconds component is included.
 */
export function formatTime(d: Date | number | string, withSeconds = false): string {
    const date = toDate(d);
    const hour12 = getTimeFormat() === "12h";
    try {
        return new Intl.DateTimeFormat(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            ...(withSeconds ? { second: "2-digit" } : {}),
            hour12,
        }).format(date);
    } catch {
        // No Intl — manual fallback respecting the 12h/24h preference.
        const h24 = date.getHours();
        const min = String(date.getMinutes()).padStart(2, "0");
        const sec = withSeconds ? ":" + String(date.getSeconds()).padStart(2, "0") : "";
        if (!hour12) return `${String(h24).padStart(2, "0")}:${min}${sec}`;
        const ampm = h24 < 12 ? "AM" : "PM";
        const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
        return `${h12}:${min}${sec} ${ampm}`;
    }
}

/** Convenience: format a date and time together using the locale-aware helpers. */
export function formatDateTime(d: Date | number | string, withSeconds = false): string {
    return `${formatDate(d)} ${formatTime(d, withSeconds)}`;
}

/**
 * Format a distance honoring appearance.locale.units. Input is meters; metric users get
 * m/km, imperial users get ft/mi. Returns a short human string.
 */
export function formatDistance(meters: number): string {
    if (getUnits() === "imperial") {
        const feet = meters * 3.28084;
        return feet >= 5280 ? `${(feet / 5280).toFixed(2)} mi` : `${Math.round(feet)} ft`;
    }
    return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

export function formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
    return String(n);
}
