// Coretex — single source of truth for every shared type across the Brain and the Relay.
// Both the Node orchestrator and the browser dashboard import from this file.

import type { CoretexConfig, ConversationScope, ConversationContextItem } from "./config/schema.js";
export type {
    CoretexConfig,
    ConversationScope,
    ConversationContextItem,
    BadgeColor,
    KeyBinding,
    TerminalProfile,
    TerminalProfileAppearance,
    ColorScheme,
    ProviderConfigState,
    SettingsAgentConfig,
    McpServerConfig,
    CodingAgentHarness,
    BuiltInMcpServer,
    BuiltInMcpId,
    DbConnection,
    DockerSettings,
    DockerRegistry,
    DockerRegistryKind,
    SshHost,
    PairedDevice,
    MeshPairingInvite,
    Integration,
    ExtensionState,
    AutocompleteConfig,
    AutocompleteProviders,
    NativeTabFallback,
} from "./config/schema.js";

// ---- Core unions ----
export type ProviderType = "ollama" | "lmstudio" | "openai" | "anthropic" | "gemini" | "openrouter" | "openclaw";

/** Provider keys that can appear in settings/UI (same as runtime hub set today). */
export type SettingsProvider = ProviderType;

export type AgentRole =
    | "orchestrator"
    | "planner"
    | "researcher"
    | "developer"
    | "reviewer"
    | "writer"
    | "analyst"
    | "devops"
    | "qa"
    | "custom";

export type AgentStatus = "idle" | "thinking" | "working" | "paused" | "error";

/**
 * Which of the 3 Claude tiers an agent (or task) executes on. Optional everywhere — an
 * undefined mode is treated as "autonomous" at runtime, so existing data is unaffected.
 * - "conversational" → a single LLM-hub completion turn (no agent loop).
 * - "assisted"       → a human-in-loop Claude Code harness terminal (PTY) tagged to the agent.
 * - "autonomous"     → the full @anthropic-ai/claude-agent-sdk agent loop (today's behavior).
 */
export type ClaudeExecutionMode = "conversational" | "assisted" | "autonomous";

/** Per-agent / per-terminal execution gating mode. */
export type PermissionMode = "ask" | "accept-edits" | "plan" | "auto" | "bypass";

/** Customizable visual identity for an agent (or terminal/profile). */
export interface VisualIdentity {
    icon:
        | { kind: "untitled-ui"; name: string } // an @untitledui/icons name
        | { kind: "upload"; url: string } // an uploaded logo (data URL / path)
        | { kind: "brand"; domain: string }; // a LogoKit brand mark
    /** Untitled UI color token or hex; tints the avatar ring/badge + terminal accent. */
    themeColor: string;
}

export type TaskStatus = "pending" | "assigned" | "in_progress" | "completed" | "failed" | "cancelled";

export type TaskPriority = "low" | "medium" | "high" | "critical";

export type ProjectStatus = "active" | "paused" | "completed" | "archived";

export type LogLevel = "info" | "warn" | "error";

// ---- LLM layer ----
/** An inline image attached to a user message (base64 payload + mime), threaded into the provider's multimodal API. */
export interface LLMImagePart {
    /** e.g. "image/png", "image/jpeg", "image/webp", "image/gif". */
    mime: string;
    /** Raw base64 (no data: prefix). */
    dataBase64: string;
}

export interface LLMMessage {
    role: "system" | "user" | "assistant";
    content: string;
    /** Optional inline images (multimodal). Only honored on `user` messages by image-capable providers. */
    images?: LLMImagePart[];
}

export interface LLMRequest {
    model: string;
    messages: LLMMessage[];
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    onChunk?: (chunk: string) => void;
    /** Abort signal — halting an agent aborts its in-flight completion. */
    signal?: AbortSignal;
    /** Provider reasoning/effort hint (e.g. "low"|"medium"|"high"); passed through where supported, else ignored. */
    effort?: string;
    /** When true, enable a provider's web-search tool if trivially available; otherwise a no-op seam. */
    search?: boolean;
}

export interface LLMUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface LLMResponse {
    content: string;
    model: string;
    provider: ProviderType;
    usage: LLMUsage;
    /** USD; always 0 for local providers (ollama, lmstudio). */
    cost: number;
    latencyMs: number;
}

export type ModelCapability = "chat" | "vision" | "tools" | "embedding" | "audio" | "image";
export type ModelState = "available" | "downloaded" | "loaded" | "running";

export interface ModelInfo {
    id: string;
    name: string;
    provider: ProviderType;
    contextLength?: number;
    /** Human label (falls back to name in UI). */
    displayName?: string;
    /** llama, qwen, mistral, gpt, claude… */
    family?: string;
    /** Local: 8B/70B + quant + on-disk size. */
    paramSize?: string;
    quantization?: string;
    sizeBytes?: number;
    /** What the model can do (chat/vision/tools/embedding/audio/image); used by picker filters. */
    capabilities?: ModelCapability[];
    /** Local lifecycle: downloaded vs loaded/running. */
    state?: ModelState;
    /** True when served from cache because the provider is currently unreachable. */
    stale?: boolean;
    /** Cloud price per 1M tokens (from the hub pricing map; cache/embedding derived from documented ratios). */
    pricing?: { inputPer1M?: number; outputPer1M?: number; cacheReadPer1M?: number; cacheWritePer1M?: number; embeddingPer1M?: number };
    modifiedAt?: number;
}

export interface ProviderHealth {
    provider: ProviderType;
    healthy: boolean;
    latencyMs: number;
    error?: string;
    models: ModelInfo[];
    /** Epoch milliseconds for the live probe that produced this state. */
    checkedAt?: number;
    /** Distinguishes an untested provider from a confirmed live/offline provider. */
    status?: "checking" | "ready" | "offline";
    /** Which real authentication/transport path this probe verified. */
    channel?: "api" | "subscription" | "local";
}

// ---- Agent layer ----
export interface AgentConfig {
    id: string;
    name: string;
    role: AgentRole;
    provider: ProviderType;
    model: string;
    systemPrompt: string;
    temperature: number;
    maxTokensPerStep: number;
    maxSteps: number;
    /** Lifetime token cap. 0 = unlimited. */
    tokenBudget: number;
    /** Per-day token cap. 0 = unlimited. */
    dailyTokenBudget: number;
    tags?: string[];
    /** Optional uploaded logo/avatar (data URL or path) for the agent. */
    avatarUrl?: string;
    /** Visual identity: icon source + theme color. */
    identity?: VisualIdentity;
    /** Execution gating mode (default for terminals this agent owns). */
    permissionMode?: PermissionMode;
    /** When true, the agent's runtime may use shell/terminal (Bash) tools. */
    terminalAccess?: boolean;
    /** Connector account ids. Empty/undefined inherits project/global access; `__none__` denies all. */
    connectorIds?: string[];
    /** MCP server config ids. Empty/undefined = all enabled settings.mcpServers. */
    mcpServerIds?: string[];
    /** Multiple skill.md files; enabled ones concatenate into the effective system prompt. */
    skills?: AgentSkill[];
    /** Which Claude tier this agent runs on. Undefined === "autonomous" (today's behavior). */
    executionMode?: ClaudeExecutionMode;
}

/** One skill.md file attached to an agent (name + markdown body + enable flag). */
export interface AgentSkill {
    name: string;
    content: string;
    enabled: boolean;
}

export interface AgentState {
    id: string;
    config: AgentConfig;
    status: AgentStatus;
    currentTaskId?: string;
    stepCount: number;
    tokensUsedTotal: number;
    tokensUsedToday: number;
    costTotal: number;
    costToday: number;
    memory: LLMMessage[];
    errorMessage?: string;
    createdAt: string;
    lastActiveAt: string;
}

/** Persisted world-space position for one card on the fleet canvas. */
export interface AgentCanvasPoint {
    x: number;
    y: number;
}

/** Per-card presentation settings; none of these fields affect agent execution. */
export interface AgentCanvasCardSettings {
    density: "compact" | "detailed";
    accentSource: "identity" | "role" | "status" | "custom";
    customColor?: string;
    showModel: boolean;
    showMetrics: boolean;
    pinned: boolean;
}

/**
 * Durable, presentation-only fleet canvas state. Runtime state is deliberately
 * excluded: selecting, dragging, arranging, or changing canvas preferences can
 * never start, pause, resume, halt, or otherwise mutate an agent run.
 */
export interface AgentCanvasState {
    positions: Record<string, AgentCanvasPoint>;
    cards: Record<string, AgentCanvasCardSettings>;
    showConnections: boolean;
    /** Monotonic revision used to order broadcasts from multiple renderer tabs. */
    revision: number;
}

// ---- Task layer ----
export interface Task {
    id: string;
    title: string;
    description: string;
    priority: TaskPriority;
    status: TaskStatus;
    assignedAgentId?: string;
    /** Explicit collaborators dispatched to this task (one or many). */
    assignedAgentIds?: string[];
    requiredRole?: AgentRole;
    projectId?: string;
    dependencies: string[];
    tags: string[];
    result?: string;
    error?: string;
    retryCount: number;
    maxRetries: number;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    estimatedTokens?: number;
    /** Feed the project's indexed source files to the agent as context. */
    useProjectContext?: boolean;
    /** Feed the project's documents to the agent as context. */
    useDocuments?: boolean;
    /** 0–100: how much master-planning effort to spend before executing. */
    planningEffort?: number;
    /** Latest generated plan document for this task, if any. */
    planMarkdown?: string;
    /** Override the executing agent's Claude tier for this task. Undefined === use the agent's mode. */
    executionMode?: ClaudeExecutionMode;
    /** Max identical worker agents the orchestrator may scale this task across (1 === single agent). */
    maxAgents?: number;
}

export interface TaskLog {
    taskId: string;
    agentId: string;
    step: number;
    message: string;
    timestamp: string;
}

// ---- Project layer ----
export interface ModelRef {
    provider: ProviderType;
    model: string;
}

/** Where project task agents may run. Hybrid allows both local and cloud providers. */
export type ProjectExecutionTarget = "local" | "cloud" | "hybrid";

/** Per-project autonomous workflow controls. Destructive remote actions stay opt-in. */
export interface ProjectAutomationConfig {
    /** Continuously dispatch queued work while the Brain is running. */
    unattended: boolean;
    /** Queue a technical-writer pass after an implementation clears review. */
    documentationAgent: boolean;
    /** Require two independent reviewer tasks for completed implementation work. */
    dualReview: boolean;
    /** Create sandbox/devel/staging/main refs when a repository is attached. */
    initializeBranchTaxonomy: boolean;
    /** Create a GitHub pull request after review/docs finish. Requires authenticated `gh`. */
    autoCreatePullRequest: boolean;
    /** Merge that pull request after checks pass. Intentionally opt-in. */
    autoMergePullRequest: boolean;
    /** Review/PR destination branch. */
    targetBranch: string;
}

export interface Project {
    id: string;
    name: string;
    description: string;
    status: ProjectStatus;
    taskIds: string[];
    tags: string[];
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
    /** Local project / monorepo root — documents, RAG index, and base for relative repo paths. */
    sourcePath?: string;
    /**
     * Git repositories belonging to this project. Paths may be absolute or relative
     * to `sourcePath` (e.g. `.` for the root, `apps/web` for a nested package).
     * Local-only repos omit `github`; linked remotes fill GitHub metadata.
     */
    repos?: ProjectRepo[];
    /** Model used by this project's chat assistant. */
    assistantModel?: ModelRef;
    /** Optional per-project spend cap in USD (0/undefined = none). */
    budgetUSD?: number;
    /** Uploaded context documents attached to this project (metadata only). */
    documents?: ProjectDocMeta[];
    /** Display icon (an @untitledui/icons name) shown in the sidebar/list. */
    icon?: string;
    /** Display accent color (hex) for the project icon. */
    color?: string;
    /** Optional cover artwork (URL or data URI) shown on project cards and the header. */
    coverImageUrl?: string;
    /** Extra presentation preferences for lists and the project chrome. */
    appearance?: ProjectAppearance;
    /** Local-only, cloud-only, or hybrid agent placement for project tasks. */
    executionTarget?: ProjectExecutionTarget;
    /** Autonomous review, docs, branch, and PR workflow settings. */
    automation?: ProjectAutomationConfig;
    /** Connector accounts explicitly allowed for this project. Project tasks require this allowlist. */
    connectorIds?: string[];
}

/** How a project presents itself in the sidebar, lists, and header. */
export interface ProjectAppearance {
    /** Soft glow behind the project icon using the accent color. */
    glow?: boolean;
    /** Colored accent rail on project rows in the sidebar/list. */
    accentRail?: boolean;
    /** Larger icon treatment in the project header. */
    largeHeaderIcon?: boolean;
}

/** A git repository attached to a project (local path + optional GitHub remote). */
export interface ProjectRepo {
    id: string;
    /** Display name (defaults to folder name). */
    name: string;
    /**
     * Folder of the git worktree. Absolute, or relative to the project's `sourcePath`
     * (use `.` for the project root itself). An empty string means the GitHub
     * repository is linked for metadata only and has not been cloned locally.
     */
    path: string;
    /** GitHub remote, when linked. */
    github?: ProjectGithubRemote | null;
    /** Optional notes shown in Source Control. */
    notes?: string;
    /** Desired GitHub visibility when a remote is created or linked. */
    visibility?: "public" | "private";
    /** Include this local checkout in project file search and assistant indexing. */
    includeInIndex?: boolean;
    /** Preferred checkout for project-level git actions when several repos are linked. */
    isPrimary?: boolean;
    createdAt: number;
}

export interface ProjectGithubRemote {
    owner: string;
    repo: string;
    /** Canonical HTTPS or SSH remote URL when known. */
    url?: string;
    /** Default branch on the remote (e.g. main). */
    defaultBranch?: string;
}

/** A document uploaded as project context (raw bytes/text travel inside the command). */
export interface UploadedDoc {
    name: string;
    mime?: string;
    /** UTF-8 text or a base64/data-URL string. */
    content: string;
    /** Optional user-facing title set at upload time (defaults to the file name). */
    title?: string;
    /** Optional description set at upload time. */
    description?: string;
}

/** Lightweight record of an attached project document (no chunk text). */
export interface ProjectDocMeta {
    name: string;
    bytes: number;
    addedAt: number;
    /** User-facing title (defaults to the file name). */
    title?: string;
    /** Optional description. */
    description?: string;
    /** Last time the title/description/content was modified. */
    modifiedAt?: number;
    mime?: string;
    /** First ~6KB of decoded text, retained for in-app preview. */
    preview?: string;
}

// ---- Project Assistant: code index + chat (RAG over docs + source) ----
export type IndexStatus = "idle" | "indexing" | "ready" | "error";

export interface CodeIndexState {
    projectId: string;
    sourcePath?: string;
    /** Every distinct local checkout included in the latest project index. */
    sourcePaths?: string[];
    /** Repository ids included in the latest project index. */
    indexedRepoIds?: string[];
    status: IndexStatus;
    filesScanned: number;
    chunks: number;
    docChunks: number;
    lastIndexedAt?: number;
    error?: string;
}

export type ChatSourceKind = "doc" | "code";

export interface ChatCitation {
    /** File path (code) or document name (doc). */
    path: string;
    kind: ChatSourceKind;
    lineStart?: number;
    lineEnd?: number;
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
    id: string;
    projectId: string;
    role: ChatRole;
    content: string;
    citations?: ChatCitation[];
    model?: string;
    createdAt: number;
}

// ---- Cost layer ----
export interface CostEntry {
    id: string;
    agentId: string;
    taskId?: string;
    projectId?: string;
    provider: ProviderType;
    model: string;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    timestamp: string;
}

export interface CostBucket {
    cost: number;
    tokens: number;
}

export interface CostAgentBucket {
    cost: number;
    tokens: number;
    costToday: number;
    tokensToday: number;
}

export interface CostModelBucket {
    cost: number;
    tokens: number;
    provider: ProviderType;
    model: string;
    calls: number;
}

export interface CostSummary {
    totalCostAllTime: number;
    totalCostToday: number;
    totalTokensAllTime: number;
    totalTokensToday: number;
    byProvider: Partial<Record<ProviderType, CostBucket>>;
    byAgent: Record<string, CostAgentBucket>;
    /** Spend rolled up by "provider::model" key for analytics. */
    byModel: Record<string, CostModelBucket>;
    /** Recent raw entries (newest first) for detailed usage tables. */
    recent?: CostEntry[];
    dailyLimit: number;
    dailyLimitRemaining: number;
}

// ---- Provider + orchestrator config ----
export interface ProviderConfig {
    ollama?: { baseUrl: string };
    lmstudio?: { baseUrl: string };
    openai?: { apiKey: string; baseUrl?: string };
    anthropic?: { apiKey: string };
    gemini?: { apiKey: string };
    openrouter?: { apiKey: string; baseUrl?: string };
    openclaw?: { apiKey?: string; baseUrl: string };
}

export interface OrchestratorConfig {
    wsPort: number;
    tickIntervalMs: number;
    maxConcurrentAgents: number;
    dailyCostLimitUSD: number;
    memoryWindowSize: number;
    providers: ProviderConfig;
}

// ---- Create inputs (used by public API + WebCommand) ----
export interface CreateAgentInput {
    name: string;
    role: AgentRole;
    provider: ProviderType;
    model: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokensPerStep?: number;
    maxSteps?: number;
    tokenBudget?: number;
    dailyTokenBudget?: number;
    tags?: string[];
    /** Optional uploaded logo/avatar (data URL) for the agent. */
    avatarUrl?: string;
    /** Visual identity: icon source + theme color. */
    identity?: VisualIdentity;
    /** Execution gating mode. */
    permissionMode?: PermissionMode;
    /** When true, the agent's runtime may use shell/terminal (Bash) tools. */
    terminalAccess?: boolean;
    /** Connector account ids. Empty/undefined inherits project/global access; `__none__` denies all. */
    connectorIds?: string[];
    /** MCP server ids scoped to this agent. Empty/undefined = inherit all enabled. */
    mcpServerIds?: string[];
    /** Multiple skill.md files; enabled ones concatenate into the system prompt. */
    skills?: AgentSkill[];
    /** Which Claude tier this agent runs on. Undefined === "autonomous" (today's behavior). */
    executionMode?: ClaudeExecutionMode;
}

export interface CreateTaskInput {
    title: string;
    description: string;
    priority?: TaskPriority;
    requiredRole?: AgentRole;
    projectId?: string;
    dependencies?: string[];
    tags?: string[];
    maxRetries?: number;
    estimatedTokens?: number;
    /** Explicit agents to dispatch (one or many collaborators). */
    assignedAgentIds?: string[];
    /** 0–100 master-planning effort. */
    planningEffort?: number;
    /** Feed the project's indexed source files to the agent as context. */
    useProjectContext?: boolean;
    /** Feed the project's documents to the agent as context. */
    useDocuments?: boolean;
    /** Override the executing agent's Claude tier for this task. Undefined === use the agent's mode. */
    executionMode?: ClaudeExecutionMode;
    /** Max identical worker agents the orchestrator may scale this task across (1 === single agent). */
    maxAgents?: number;
}

/** Fields that can be edited when refining an existing task. */
export type RefineTaskPatch = Partial<
    Pick<
        CreateTaskInput,
        "title" | "description" | "priority" | "requiredRole" | "projectId" | "tags" | "assignedAgentIds" | "planningEffort"
    >
>;

export interface CreateProjectInput {
    name: string;
    description?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    /** Optional local repository directory to index immediately. */
    sourcePath?: string;
    /** Optional context documents to ingest immediately. */
    documents?: UploadedDoc[];
    /** Repositories configured during project creation. */
    repos?: ProjectRepo[];
    executionTarget?: ProjectExecutionTarget;
    automation?: Partial<ProjectAutomationConfig>;
}

// ---- Filesystem (editor + file explorer over the Brain's fs) ----
export interface FsEntry {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    modified: number;
    /** True when the owner-write bit is unset (read-only file). */
    readOnly?: boolean;
}
/** A live remote (SSH/SFTP/FTP) session managed by the Brain's RemoteService. */
export interface RemoteSession {
    id: string;
    hostId: string;
    label: string;
    protocol: "ssh" | "sftp" | "ftp";
    host: string;
    user: string;
    cwd: string;
    status: "connecting" | "connected" | "error" | "closed";
    error?: string;
}
/** A directory entry on a remote host. */
export interface RemoteEntry {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    modified: number;
}
/** A search hit (from recursive folder search or the global index). */
export interface IndexedEntry {
    name: string;
    path: string;
    isDir: boolean;
}
/** The file-search index: which locations are indexed + how many entries + freshness. */
export interface IndexState {
    locations: string[];
    count: number;
    indexedAt: number;
    indexing: boolean;
    /** Live file-watching keeps the index fresh on create/delete/modify. */
    watching?: boolean;
}
/** Rich filesystem properties for the Properties dialog. */
export interface FileProperties {
    path: string;
    name: string;
    isDir: boolean;
    /** Size in bytes (the file's own size; folders report 0 here — see itemCount). */
    size: number;
    created: number;
    modified: number;
    accessed: number;
    readOnly: boolean;
    /** POSIX mode bits (octal-renderable). */
    mode: number;
    /** Human-friendly type label, e.g. "PNG image", "Folder", "ZIP archive". */
    type: string;
    ext?: string;
    /** True when this is an extractable archive (zip/tar/gz/tgz). */
    archive?: boolean;
    /** Immediate child count for folders. */
    itemCount?: number;
    /** Best-effort text encoding label, or "Binary" when the sample is not text. */
    encoding?: string;
    /** SHA-256 digest of the complete file contents. */
    checksumSha256?: string;
}
/** A mounted drive/volume with capacity, for the Files "Home" storage overview. */
export interface DriveInfo {
    /** Root path, e.g. "C:\\" or "/". */
    path: string;
    /** Volume label from the OS (may be empty). */
    label: string;
    /** Total + free bytes (0 when unknown). */
    total: number;
    free: number;
}
/** Normalized git status for a path (relative to a repo). */
export type GitStatusCode = "modified" | "added" | "deleted" | "renamed" | "untracked" | "ignored" | "conflict";

/** One dirty file in a worktree (Changes pane). */
export interface GitFileChange {
    /** Path relative to the repo root (posix-ish forward slashes). */
    path: string;
    status: GitStatusCode;
    /** True when the index side differs from HEAD. */
    staged: boolean;
    /** True when the worktree side differs from the index (or untracked). */
    unstaged: boolean;
    /** Lines added (from numstat; 0 for binary / unknown). */
    additions: number;
    /** Lines removed (from numstat; 0 for binary / unknown). */
    deletions: number;
}

/** Snapshot of a local git worktree for Source Control UI. */
export interface GitRepoSummary {
    cwd: string;
    isRepo: boolean;
    branch: string | null;
    upstream: string | null;
    ahead: number;
    behind: number;
    staged: number;
    unstaged: number;
    untracked: number;
    conflicts: number;
    /** Aggregate line stats across dirty files. */
    additions: number;
    deletions: number;
    /** Per-file dirty list (staged + unstaged + untracked). */
    files: GitFileChange[];
    headSha: string | null;
    headSubject: string | null;
    remotes: { name: string; url: string; fetch: boolean; push: boolean }[];
    github: { owner: string; repo: string; url: string } | null;
    error?: string;
}

/**
 * A logged filesystem edit from an agent (or the Files UI) — used by Source Control
 * to show who changed what before a commit.
 */
export interface AgentFileChange {
    id: string;
    ts: number;
    agentId: string;
    agentName: string;
    /** Absolute path when known; otherwise relative. */
    path: string;
    tool: string;
    taskId?: string;
    projectId?: string;
}

export interface GitBranchInfo {
    name: string;
    current: boolean;
    remote: boolean;
    upstream: string | null;
    sha: string | null;
    date: string | null;
    subject: string | null;
}

export interface GitCommitInfo {
    shortSha: string;
    sha: string;
    /** Full parent SHAs, used to draw truthful branch/merge edges. */
    parents?: string[];
    /** Canonical GitHub commit URL for remote history, when available. */
    url?: string;
    author: string;
    email: string;
    date: string;
    refs: string[];
    subject: string;
    /** Files touched in this commit (from --name-status; capped). */
    files?: string[];
    additions?: number;
    deletions?: number;
}

export interface GitPullRequestInfo {
    number: number;
    title: string;
    state: string;
    url: string;
    author: string;
    branch: string;
    baseBranch?: string;
    isDraft?: boolean;
    createdAt?: string;
    updatedAt?: string;
    mergeStateStatus?: string;
    reviewDecision?: string;
}

export interface GithubAccountInfo {
    login: string;
    name: string | null;
    avatarUrl: string | null;
    url: string | null;
}

export interface GithubReadmeInfo {
    name: string;
    content: string;
    truncated: boolean;
    url: string | null;
}

/** Renderer-safe local + remote repository record. Credentials are never included. */
export interface GithubRepositoryInfo {
    id: string;
    owner: string | null;
    name: string;
    fullName: string;
    description: string | null;
    url: string | null;
    cloneUrl: string | null;
    sshUrl: string | null;
    visibility: "public" | "private" | "internal" | "unknown";
    defaultBranch: string | null;
    language: string | null;
    stargazers: number;
    forks: number;
    openIssues: number;
    updatedAt: string | null;
    pushedAt: string | null;
    isFork: boolean;
    isArchived: boolean;
    /** Preferred local checkout, when the repository is attached more than once. */
    localPath: string | null;
    /** Every known local checkout path, de-duplicated. */
    localPaths: string[];
    /** Coretex projects that currently link this repository. */
    projectIds: string[];
    /** Present for local worktrees, allowing the global page to show exact dirty state. */
    summary?: GitRepoSummary;
}

export interface GithubDeploymentInfo {
    id: string;
    environment: string;
    state: string;
    ref: string;
    sha: string;
    description: string | null;
    creator: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    url: string | null;
}

export interface GithubWorkflowRunInfo {
    id: string;
    name: string;
    workflowName: string;
    event: string;
    branch: string | null;
    sha: string;
    status: string;
    conclusion: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    url: string | null;
}

export interface GithubOverview {
    cliAvailable: boolean;
    connected: boolean;
    account: GithubAccountInfo | null;
    repositories: GithubRepositoryInfo[];
    checkedAt: number;
    error?: string;
}

export interface GithubRepositoryDetail {
    repository: GithubRepositoryInfo;
    readme: GithubReadmeInfo | null;
    commits: GitCommitInfo[];
    branches: GitBranchInfo[];
    pullRequests: GitPullRequestInfo[];
    deployments: GithubDeploymentInfo[];
    workflows: GithubWorkflowRunInfo[];
    /** A deployment/workflow fetch can fail independently of repository metadata. */
    deploymentsError?: string;
    error?: string;
}

// ---- Ollama model manager (AI providers settings) ----
export interface OllamaModelDetail {
    name: string;
    /** Bytes on disk. */
    size: number;
    /** e.g. "8.0B". */
    parameterSize?: string;
    /** e.g. "Q4_K_M". */
    quantization?: string;
    /** e.g. "llama". */
    family?: string;
    modifiedAt?: string;
}

export interface OllamaPullProgress {
    model: string;
    status: string;
    completed?: number;
    total?: number;
    /** 0-100; -1 while the layer total is unknown. */
    percent: number;
    done: boolean;
    error?: string;
}

// ---- Files metadata (per-path icons / colors / emblems / tags + tag DB) ----
export type FileIconKind = "auto" | "library" | "emoji" | "upload";
/** A custom icon for a path. value = @untitledui name (library), emoji char, or a data URL (upload). */
export interface FileIconSpec {
    kind: FileIconKind;
    value?: string;
}
export interface FileTag {
    id: string;
    name: string;
    color: string;
    icon?: string;
}
export interface FilePathMeta {
    icon?: FileIconSpec;
    color?: string;
    emblems?: string[];
    tagIds?: string[];
}
/** A pinned virtual folder = a saved tag/color filter. */
export interface SmartCollection {
    id: string;
    name: string;
    color?: string;
    tagIds?: string[];
}
/** A pinned starting location in the Files sidebar (custom name / icon / color / order). */
export interface FilePin {
    id: string;
    path: string;
    name: string;
    icon?: FileIconSpec;
    color?: string;
    order: number;
}
/** Per-drive customization (nickname + custom icon/color), keyed by root path. */
export interface DriveMeta {
    nickname?: string;
    icon?: FileIconSpec;
    color?: string;
}
export interface FilesMetaState {
    byPath: Record<string, FilePathMeta>;
    tags: FileTag[];
    collections: SmartCollection[];
    pins: FilePin[];
    driveMeta: Record<string, DriveMeta>;
}

// ---- Capability manifest (default awareness) — names/categories/capabilities only, NEVER secret values ----
export interface ManifestConnector {
    id: string;
    name: string;
    category: ServiceCategory;
    connected: boolean;
    capabilities: string[];
}
export interface ManifestEnvironment {
    projectId: string;
    environmentId: string;
    environment: string;
    /** Variable NAMES only — values are resolved from the vault at runtime, never shown. */
    varNames: string[];
}
export interface CapabilityManifest {
    connectors: ManifestConnector[];
    environments: ManifestEnvironment[];
}

// ---- API key vault + integrations ----
export type ServiceCategory =
    | "ai" | "payment" | "database" | "storage" | "auth" | "analytics"
    | "communication" | "monitoring" | "development" | "other";
export type KeyStatus = "active" | "expiring" | "expired" | "unverified";
export type KeyTestStatus = "valid" | "invalid" | "untested" | "rate_limited" | "testing";
export type KeyEnvironment = "production" | "staging" | "development" | "testing";

export interface APIKey {
    id: string;
    serviceId: string;
    serviceName: string;
    serviceDomain: string;
    nickname: string;
    keyValue: string;
    keyPreview: string;
    category: ServiceCategory;
    environment: KeyEnvironment;
    status: KeyStatus;
    expiresAt: number | null;
    lastUsed: number | null;
    lastTested: number | null;
    testStatus: KeyTestStatus;
    aiAgentAccess: boolean;
    aiAccessScope: "read" | "write" | "full";
    projectId: string | null;
    scopes: string[];
    note: string;
    tags: string[];
    createdAt: number;
    updatedAt: number;
    /** Optional link to an env-var this key populates (association only — no value sync). */
    linkedEnvVarId?: string;
    linkedEnvVarName?: string;
    /** Connector account that owns this credential. Undefined for standalone vault keys. */
    integrationId?: string;
    /** Provider field name, for example "API key", "Account SID", or "Auth Token". */
    credentialLabel?: string;
}

export interface MCPToolBinding {
    id: string;
    name: string;
    /** Exact name reported by this connector account's MCP tools/list response. */
    runtimeName?: string;
    description: string;
    permission: "read" | "write" | "disabled";
    requiresConfirmation: boolean;
    usageLimit: number | null;
    callsToday: number;
    /** UTC calendar day for callsToday, formatted YYYY-MM-DD. */
    callsDay?: string;
}

export type ConnectorExecutionPolicy = "plan-only" | "confirm" | "auto" | "bypass";

export interface ConnectorToolAuthorizationInput {
    integrationId: string;
    /** Canonical account ids already resolved from project + agent connector access. */
    effectiveConnectorIds: string[];
    /** Exact account-scoped MCP server id receiving the call. */
    runtimeServerId: string;
    /** Exact tools/list name, without aliases or display-name matching. */
    runtimeName: string;
    globalReadOnly: boolean;
    effectivePolicy: ConnectorExecutionPolicy;
    /** Trusted outer execution principal. Never source these values from an SDK tool request. */
    readonly agentId: string;
    readonly taskId: string;
    readonly projectId?: string;
    /** Deterministic clock override for focused tests; production callers omit this. */
    now?: number;
}

export type ConnectorToolAuthorizationDenialCode =
    | "execution_policy_plan_only"
    | "approval_required"
    | "connector_not_allowed"
    | "integration_not_found"
    | "integration_unavailable"
    | "agent_access_disabled"
    | "mcp_disabled"
    | "runtime_mismatch"
    | "tool_unknown"
    | "tool_disabled"
    | "global_read_only"
    | "usage_limit_reached";

export type ConnectorToolAuthorizationResult =
    | {
          authorized: true;
          integrationId: string;
          runtimeServerId: string;
          runtimeName: string;
          bindingId: string;
          permission: "read" | "write";
          callsToday: number;
          usageLimit: number | null;
      }
    | {
          authorized: false;
          code: ConnectorToolAuthorizationDenialCode;
          message: string;
          integrationId: string;
          runtimeServerId: string;
          runtimeName: string;
      };

export type ConnectorVerification = "verified" | "unverified" | "failed";

/** Secret input accepted by the atomic connector lifecycle. Values never appear in operation results. */
export interface ConnectorCredentialInput {
    id?: string;
    label: string;
    value: string;
    /** Optional environment variable name used when this connector is authorized for an agent. */
    linkedEnvVarName?: string;
    /** The primary credential is used by the provider verifier. Defaults to the first item. */
    primary?: boolean;
}

export interface ServiceConnection {
    id: string;
    serviceId: string;
    serviceName: string;
    serviceDomain: string;
    category: ServiceCategory;
    status: "connected" | "disconnected" | "partial" | "error" | "connecting";
    authType: "oauth" | "api_key" | "basic";
    connectedAs: string;
    connectedAt: number;
    lastSyncedAt: number | null;
    mcpEnabled: boolean;
    mcpTools: MCPToolBinding[];
    /** Service-specific quick stats, e.g. {label:"repos", value:"12"}. */
    stats: { label: string; value: string }[];
    color: string;
    requireConfirmWrites: boolean;
    /** Vault APIKey ids owned by this connector account. */
    credentialIds?: string[];
    /** Whether agents may receive this connector's runtime. */
    agentEnabled?: boolean;
    /** Settings MCP server id backing this account, when executable. */
    runtimeServerId?: string;
    verification?: ConnectorVerification;
    lastError?: string | null;
}

export interface AuditEntry {
    id: string;
    ts: number;
    action: string;
    target: string;
    detail?: string;
    level: "info" | "warn" | "error";
}

export interface KeyVaultState {
    keys: APIKey[];
    integrations: ServiceConnection[];
    audit: AuditEntry[];
}

export interface KeyTestResult {
    id: string;
    status: KeyTestStatus;
    message?: string;
}

/** One leaked/secret-shaped finding from the local-only leak scan. Never carries the raw value. */
export interface LeakFinding {
    /** File the match was found in. */
    file: string;
    line: number;
    /** Masked preview of the matched token (e.g. "sk-…a1b2"). */
    matchPreview: string;
    /** When set, the matched value equals a stored vault key (rotate it!). */
    matchedKeyId?: string;
    matchedKeyName?: string;
    severity: "critical" | "warning";
}

export interface LeakScanResult {
    scanned: number;
    findings: LeakFinding[];
    finishedAt: number;
    error?: string;
}

// ---- Environment variable manager ----
export type EnvCategory =
    | "database" | "auth" | "api" | "storage" | "payment" | "analytics"
    | "email" | "ai" | "cdn" | "cache" | "queue" | "custom";
export type EnvKind = "production" | "staging" | "sandbox" | "local" | "testing" | "preview" | "custom";

export interface EnvVariable {
    id: string;
    name: string;
    value: string;
    category: EnvCategory;
    companyDomain?: string;
    companyName?: string;
    note?: string;
    tags: string[];
}

export interface Environment {
    id: string;
    projectId: string;
    name: string;
    kind: EnvKind;
    color: string;
    description?: string;
    isDefault: boolean;
    variables: EnvVariable[];
    updatedAt: number;
}

export interface EnvManagerState {
    environments: Environment[];
}

// ---- Email management ----
export interface EmailAddress {
    name: string;
    email: string;
}
export interface EmailAttachment {
    id: string;
    name: string;
    sizeBytes: number;
    mimeType: string;
}
export type EmailFolder = "inbox" | "sent" | "drafts" | "starred" | "archive" | "trash";

export interface EmailMessage {
    id: string;
    threadId: string;
    accountId: string;
    from: EmailAddress;
    to: EmailAddress[];
    cc: EmailAddress[];
    subject: string;
    bodyHtml: string;
    bodyText: string;
    snippet: string;
    attachments: EmailAttachment[];
    folder: EmailFolder;
    labels: string[];
    aiCategory: string | null;
    aiConfidence?: number;
    isRead: boolean;
    isStarred: boolean;
    timestamp: number;
    inReplyTo: string | null;
}

export interface EmailCategory {
    id: string;
    name: string;
    color: string;
    emoji: string;
    /** Optional Untitled UI icon name (rendered in preference to the emoji). */
    icon?: string;
    /** Optional one-line description shown in the category manager + used to guide the AI sorter. */
    description?: string;
}

export type EmailBackend = "ollama" | "openai" | "anthropic" | "gemini" | "lmstudio";

export interface EmailAgentConfig {
    enabled: boolean;
    backend: EmailBackend;
    model: string;
    systemPrompt: string;
    autoSortOnReceive: boolean;
    sortBatch: number;
    confidenceThreshold: number;
    /** User corrections the sorter learns from (injected as few-shot examples next sort). */
    corrections?: EmailCorrection[];
}

/** A user correction: "mail like this should be category X" — fed back into future sorting. */
export interface EmailCorrection {
    from: string;
    subject: string;
    category: string;
    at: number;
}

export interface EmailSortDecision {
    id: string;
    emailId: string;
    subject: string;
    from: string;
    category: string;
    confidence?: number;
    timestamp: number;
    /** Which backend + model performed this sort (provenance — stays accurate when settings change). */
    backend?: EmailBackend;
    model?: string;
    /** True when this entry records a manual user correction rather than an AI decision. */
    corrected?: boolean;
}

/** How a mailbox is reached. "demo" = the built-in seed inbox; "imap" = a real account. */
export type EmailAccountKind = "demo" | "imap";

/** Well-known providers with baked-in IMAP/SMTP endpoints; "custom" means the user supplies them. */
export type EmailProvider = "gmail" | "outlook" | "yahoo" | "icloud" | "fastmail" | "custom";

export interface EmailAccount {
    id: string;
    email: string;
    name: string;
    avatar: string;
    connected: boolean;
    /** Defaults to "demo" for the legacy seed account; real accounts are "imap". */
    kind?: EmailAccountKind;
    provider?: EmailProvider;
    /** IMAP (incoming) endpoint. */
    imapHost?: string;
    imapPort?: number;
    imapSecure?: boolean;
    /** SMTP (outgoing) endpoint. */
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
    /** Login user (usually the full email address). The password lives in the secret store. */
    user?: string;
    /** Optional distinct SMTP login for providers whose incoming/outgoing usernames differ. */
    smtpUser?: string;
    /** Live sync status surfaced in the UI. */
    syncing?: boolean;
    lastSync?: number;
    lastError?: string;
}

/** Everything needed to connect a real IMAP/SMTP mailbox. The password is sent once and stored as a secret. */
export interface EmailConnectInput {
    provider: EmailProvider;
    email: string;
    name?: string;
    /** Defaults to the email address when omitted. */
    user?: string;
    /** Defaults to user/email when omitted. */
    smtpUser?: string;
    password: string;
    /** Required for provider "custom"; otherwise derived from the provider preset. */
    imapHost?: string;
    imapPort?: number;
    imapSecure?: boolean;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
}

/** Transient result for a mailbox connection attempt. Passwords are never echoed here. */
export interface EmailConnectionStatus {
    requestId: string;
    email: string;
    status: "connecting" | "success" | "error";
    accountId?: string;
    error?: string;
}

/** Transient result for an outgoing message. Used to keep Compose open on SMTP failure. */
export interface EmailSendStatus {
    requestId: string;
    status: "sending" | "success" | "error";
    error?: string;
}

export interface EmailState {
    accounts: EmailAccount[];
    messages: EmailMessage[];
    categories: EmailCategory[];
    agent: EmailAgentConfig;
    sortLog: EmailSortDecision[];
    sorting: boolean;
    sortProgress?: { done: number; total: number };
    connection?: EmailConnectionStatus;
    sending?: EmailSendStatus;
}

// ---- MCP (Model Context Protocol) host/client ----
export interface McpTool {
    name: string;
    description?: string;
    inputSchema?: unknown;
}

export interface McpServerStatus {
    serverId: string;
    connected: boolean;
    connecting?: boolean;
    tools: McpTool[];
    serverName?: string;
    serverVersion?: string;
    error?: string;
    /** Epoch milliseconds of the last successful initialize + tools/list handshake. */
    connectedAt?: number;
}

// ---- Multi-agent topologies (council / debate / chain) ----
export type TopologyKind = "sequential" | "debate" | "orchestrator";

export interface TopologyTurn {
    runId: string;
    agentId: string;
    agentName: string;
    role: string;
    /** 1-based round (debate) or step (sequential). */
    round: number;
    /** "plan" | "respond" | "synthesize" | "turn". */
    phase: string;
    content: string;
}

// ---- Memory (user-owned assistant memory) ----
export type MemoryCategory = "fact" | "preference" | "project" | "person" | "instruction" | "other";
export type MemorySource = "generated" | "manual" | "imported";
export type MemoryScopeType = "global" | "project" | "agent";

export interface MemoryItem {
    id: string;
    text: string;
    category: MemoryCategory;
    source: MemorySource;
    /**
     * Canonical scope key: "global", "project:<projectId>", or "agent:<agentId>".
     * Legacy project ids are still accepted and normalized by MemoryStore on load.
     */
    scope: string;
    createdAt: number;
    enabled: boolean;
}

// ---- Docker Desktop integration ----
export type DbSchemaKind = "table" | "view" | "collection" | "key";

export interface DbSchemaColumn {
    name: string;
    type: string;
    nullable?: boolean;
    defaultValue?: string;
    primaryKey?: boolean;
}

/** One table/view/collection/key in a database connection's schema. */
export interface DbSchemaTable {
    name: string;
    kind: DbSchemaKind;
    /** Postgres schema name when not using the bare public table name. */
    schema?: string;
    columns?: DbSchemaColumn[];
    /** Bounded provider-specific facts such as Redis dataType/ttlSeconds. */
    metadata?: Record<string, string | number | boolean | null>;
}

export interface DbDatabaseInfo {
    name: string;
    default?: boolean;
    system?: boolean;
    sizeBytes?: number;
    itemCount?: number;
    metadata?: Record<string, string | number | boolean | null>;
}

export interface DbSchemaIndex {
    name: string;
    columns: string[];
    unique?: boolean;
    primary?: boolean;
    type?: string;
}

export interface DbIntrospectionTarget {
    name: string;
    schema?: string;
    kind?: DbSchemaKind;
}

export interface DbIntrospection {
    target: DbIntrospectionTarget;
    columns: DbSchemaColumn[];
    indexes: DbSchemaIndex[];
    metadata?: Record<string, string | number | boolean | null>;
    preview?: {
        columns: string[];
        rows: unknown[][];
        rowCount: number;
        truncated?: boolean;
    };
}

export interface DockerContainerInfo {
    id: string;
    name: string;
    image: string;
    state: string; // running | exited | paused | …
    status: string; // "Up 3 minutes" etc.
    ports: { privatePort: number; publicPort?: number; type: string }[];
    composeProject?: string;
}
export interface DockerImageInfo {
    id: string;
    tags: string[];
    sizeBytes: number;
    created: number;
}
export interface DockerVolumeInfo {
    name: string;
    driver: string;
}
export interface DockerNetworkInfo {
    id: string;
    name: string;
    driver: string;
}

/** Snapshot of `docker info` / `docker version` / `docker system df` for settings + dashboards. */
export interface DockerEngineInfo {
    /** Engine API / server version string. */
    version?: string;
    apiVersion?: string;
    platformName?: string;
    osType?: string;
    architecture?: string;
    kernelVersion?: string;
    operatingSystem?: string;
    ncpu?: number;
    memTotal?: number;
    driver?: string;
    dockerRootDir?: string;
    name?: string;
    serverVersion?: string;
    containers?: number;
    containersRunning?: number;
    containersPaused?: number;
    containersStopped?: number;
    images?: number;
    /** Disk reclaim estimate from `system df` (bytes that prune can free). */
    reclaimableBytes?: number;
    imagesSizeBytes?: number;
    containersSizeBytes?: number;
    volumesSizeBytes?: number;
    buildCacheSizeBytes?: number;
}

export interface DockerState {
    available: boolean;
    version?: string;
    error?: string;
    info?: DockerEngineInfo;
    containers: DockerContainerInfo[];
    images: DockerImageInfo[];
    volumes: DockerVolumeInfo[];
    networks: DockerNetworkInfo[];
}
export type DockerAction = "start" | "stop" | "restart" | "pause" | "unpause" | "remove";
/** Targets for docker:prune — maps to dockerode prune* / pruneBuilder. */
export type DockerPruneTarget = "containers" | "images" | "volumes" | "networks" | "buildcache" | "all";

/** One concrete prune target after expanding the aggregate `all` cleanup. */
export type DockerConcretePruneTarget = Exclude<DockerPruneTarget, "all">;

/** Structured cleanup totals returned by Docker instead of an ambiguous success flag. */
export interface DockerPruneSummary {
    targets: DockerConcretePruneTarget[];
    deletedByTarget: Partial<Record<DockerConcretePruneTarget, number>>;
    spaceReclaimedBytes: number;
    failures: Array<{ target: DockerConcretePruneTarget; error: string }>;
}

/** Lifecycle event for refreshes, container actions, and prune operations. */
export interface DockerOperationState {
    id: string;
    kind: "refresh" | "container-action" | "prune";
    status: "running" | "succeeded" | "failed";
    startedAt: number;
    finishedAt?: number;
    action?: DockerAction;
    containerId?: string;
    target?: DockerPruneTarget;
    summary?: DockerPruneSummary;
    message?: string;
    error?: string;
}

// ---- Terminal multiplexer (PTY sessions in the dock) ----
export interface TerminalSessionMeta {
    id: string;
    title: string;
    profileId?: string;
    shell: string;
    cwd: string;
    agentId?: string;
    /** Project this terminal belongs to (project-scoped terminals tab). */
    projectId?: string;
    /** "shell" = a real PTY; "agent" = a PTY-less read-only console mirroring an agent's run. */
    kind?: "shell" | "agent";
    /** Read-only consoles (agent runs) ignore input/resize/kill. */
    readOnly?: boolean;
    status: "running" | "exited";
    cols: number;
    rows: number;
    createdAt: number;
}

// ---- Shell integration (OSC 133/7 block model + shell detection) ----
/** What we know about the shell powering a live PTY session (from probe + profile). */
export interface SessionShellInfo {
    sessionId: string;
    /** Normalized shell kind: "bash" | "zsh" | "fish" | "sh" | "powershell" | "cmd" | "unknown". */
    shell: string;
    /** Resolved version string when a probe succeeded (e.g. "5.1.19041.4894", "5.2.15"). */
    version?: string;
    /** OS family: "windows" | "macos" | "linux" | "unknown". */
    os: string;
    /** True when the shell is a WSL distro (Linux shell on Windows). */
    isWSL?: boolean;
    /** Current working directory (tracked from OSC 7 / cd, seeded from the session cwd). */
    cwd: string;
    /** True when shell-integration markers were injected (block model is reliable). */
    integrated?: boolean;
}

/** A completed (or in-flight) command block captured from the shell-integration stream. */
export interface CommandBlock {
    sessionId: string;
    /** The command line as typed (without the prompt). */
    command: string;
    /** Captured stdout/stderr between command-start and command-end. */
    output: string;
    /** Exit code reported by the shell (undefined while still running / unknown). */
    exitCode?: number;
    /** Epoch ms when the command started executing. */
    startedAt: number;
    /** Epoch ms when the command finished (undefined while running). */
    endedAt?: number;
    /** Working directory the command ran in. */
    cwd: string;
}

/** Relay-side aggregate of one session's shell integration (folded from terminal:shellInfo/block). */
export interface CommandBlockState {
    sessionId: string;
    info: SessionShellInfo | null;
    /** Completed command blocks, most-recent last. */
    blocks: CommandBlock[];
    /** The command currently executing, if any. */
    current: CommandBlock | null;
}

// ---- Running-server / port detection ----
export type ServerType = "web" | "api" | "database" | "dev" | "unknown";
/** Relevance tier — what's "yours" floats above background/system listeners. */
export type ServerTier = "project" | "dev" | "docker" | "coretex" | "system";

export interface RunningServer {
    port: number;
    type: ServerType;
    /** Framework/tech guess (Next.js / Vite / Postgres / Ollama / …). */
    tech?: string;
    pid?: number;
    process?: string;
    /** local | docker | agent (docker/agent attribution lands with those subsystems). */
    owner: "local" | "docker" | "agent";
    ownerId?: string;
    url?: string;
    /** HTTP probe succeeded (web/dev ports). */
    statusOk?: boolean;
    lastSeen: number;
    /** Relevance tier (computed each scan). */
    tier: ServerTier;
    /** Milliseconds the port has been listening (since first detected). */
    uptimeMs?: number;
    /** Docker stack/container when the port is backed by Docker. */
    composeProject?: string;
    containerName?: string;
    /** Coretex project this server was attributed to (by process command line / cwd). */
    projectId?: string;
}

// ---- Terminal Buddy (shell-aware command assistant) ----
/** Suggest = propose commands for confirmation; Auto = run them autonomously (within guardrails). */
export type BuddyMode = "suggest" | "auto";

/** A detected package manager on the target environment. */
export interface PackageManagerInfo {
    /** apt, dnf, yum, pacman, apk, brew, choco, scoop, winget, npm, pip, cargo, … */
    name: string;
    /** Resolved version string, if probed. */
    version?: string;
    /** Absolute path to the executable, if known. */
    path?: string;
    /** True when this is the environment's primary system package manager. */
    primary?: boolean;
}

/** The probed shell/OS environment a Terminal Buddy operates against. */
export interface TerminalEnvironment {
    /** How the buddy reaches the shell. */
    connectionKind: "local" | "ssh" | "docker" | "wsl";
    /** SSH target details (when connectionKind === "ssh"). */
    sshHost?: string;
    sshPort?: number;
    sshUser?: string;
    /** Docker container id/name (when connectionKind === "docker"). */
    dockerContainer?: string;
    // OS
    os?: "linux" | "macos" | "windows" | "bsd" | "unknown";
    osName?: string;
    osVersion?: string;
    kernelVersion?: string;
    arch?: string;
    // WSL
    isWSL?: boolean;
    wslDistro?: string;
    // Shell
    shell?: string;
    shellVersion?: string;
    shellPath?: string;
    isLoginShell?: boolean;
    isInteractive?: boolean;
    // Distro
    distro?: string;
    distroVersion?: string;
    initSystem?: string;
    // Toolchain
    packageManagers?: PackageManagerInfo[];
    runtimes?: PackageManagerInfo[];
    tools?: PackageManagerInfo[];
    // User / perms
    username?: string;
    homeDir?: string;
    cwd?: string;
    isRoot?: boolean;
    hasSudo?: boolean;
    sudoPasswordless?: boolean;
    // Hardware
    cpuCount?: number;
    totalRamMb?: number;
    diskGb?: number;
    // Assignment
    assignedModel?: string;
    assignedProvider?: ProviderType;
    mode?: BuddyMode;
    // Probe metadata
    probeCompletedAt?: number;
    probeVersion?: string;
    /** True when only partial details were available before the bounded probe timeout. */
    probeTimedOut?: boolean;
}

/** One executable step in a buddy plan (with optional verification + recovery hints). */
export interface BuddyStep {
    id: string;
    description: string;
    command: string;
    /** A substring/regex the command's output should contain on success. */
    expectedOutput?: string;
    /** Regex patterns that, if matched in output, indicate failure. */
    errorPatterns?: string[];
    /** How to recover when this step fails. */
    retryStrategy?: string;
    /** How dangerous this step is — gates confirmation in auto mode. */
    riskLevel: "safe" | "caution" | "destructive";
}

/** Lifecycle of a buddy session/task, surfaced to the UI. */
export type BuddyStatus =
    | "idle"
    | "probing"
    | "planning"
    | "awaiting" // suggest-mode: waiting for the user to accept/edit/skip a step
    | "confirm" // auto-mode: waiting for confirmation of a destructive step
    | "running"
    | "recovering" // a step failed; the buddy is diagnosing/retrying
    | "needs-help" // automatic recovery exhausted; handed back to the user
    | "done"
    | "failed"
    | "halted";

/** Per-step execution state surfaced to the UI (extends the planned BuddyStep). */
export interface BuddyStepRuntime extends BuddyStep {
    status: "pending" | "awaiting" | "running" | "success" | "failed" | "skipped";
    /** 1-based attempt counter, incremented on each automatic recovery retry. */
    attempt: number;
    /** Exit code of the last execution (when the step ran). */
    exitCode?: number;
    /** Captured output (trimmed + truncated for display). */
    output?: string;
    /** Diagnosis / failure classification when the step failed. */
    diagnosis?: string;
}

/** A "buddy needs help" hand-off, emitted when automatic recovery is exhausted. */
export interface BuddyHelp {
    stepId: string;
    command: string;
    error: string;
    diagnosis: string;
    /** Short failure classification (e.g. "package-not-found", "permission-denied"). */
    classification?: string;
}

/** Relay-side aggregate of one terminal's buddy, folded from the buddy:* events. */
export interface BuddySessionState {
    sessionId: string;
    env: TerminalEnvironment | null;
    probing: boolean;
    probeError: string | null;
    status: BuddyStatus;
    mode: BuddyMode;
    taskId: string | null;
    request: string | null;
    steps: BuddyStepRuntime[];
    /** One-line activity status (what the buddy last did / is doing). */
    activity: string | null;
    help: BuddyHelp | null;
    summary: string | null;
    /** Whether the last completed task succeeded (null while running / before any run). */
    ok: boolean | null;
}

// ---- Calendar ----
export interface CalendarCategory {
    id: string;
    label: string;
    color: string;
    /** Optional @untitledui/icons name. */
    icon?: string;
    /** Default reminder offsets (minutes before start) applied to new events of this category. */
    reminderOffsets?: number[];
}

export type CalendarEventSourceKind =
    | "user"
    | "agent"
    | "project"
    | "email"
    | "financial"
    | "social"
    | "workout"
    | "nutrition"
    | "health"
    | "todo";

export interface CalendarEventSource {
    kind: CalendarEventSourceKind;
    /** Stable identifier in the source module (never a display label). */
    id?: string;
    label?: string;
    /** False for derived records that must be edited in their source module. */
    editable?: boolean;
    /** In-app destination for viewing/editing the authoritative source record. */
    href?: string;
}

export interface CalendarEventRecurrence {
    frequency: "daily" | "weekly" | "monthly" | "yearly";
    interval: number;
    /** Local weekday numbers, Sunday=0 through Saturday=6. */
    weekDays?: number[];
    end?: {
        type: "never" | "date" | "count";
        /** Epoch ms, used when type=date. */
        date?: number;
        /** Occurrence count, used when type=count. */
        count?: number;
    };
}

export interface CalendarEventAttendee {
    id: string;
    name?: string;
    email: string;
    response?: "needsAction" | "accepted" | "declined" | "tentative";
    optional?: boolean;
}

export interface CalendarEventCustomField {
    id: string;
    label: string;
    value: string;
}

export interface CalendarEvent {
    id: string;
    title: string;
    /** Category id (drives the color/label). */
    category: string;
    /** Color token / hex for the event chip. */
    color: string;
    /** Optional @untitledui/icons name. */
    icon?: string;
    allDay: boolean;
    /** Epoch ms. For all-day events, start-of-day. */
    start: number;
    /** Epoch ms. */
    end: number;
    location?: string;
    description?: string;
    attendees: string[];
    /** Reminder offsets in minutes before start (multiple allowed). */
    reminders: number[];
    /** IANA time zone. Wall-clock values fall back to the host zone when omitted. */
    timezone?: string;
    status?: "confirmed" | "tentative" | "cancelled";
    priority?: "none" | "low" | "medium" | "high" | "urgent";
    availability?: "busy" | "free";
    visibility?: "default" | "public" | "private";
    recurrence?: CalendarEventRecurrence | null;
    tags?: string[];
    url?: string;
    conferenceUrl?: string;
    customFields?: CalendarEventCustomField[];
    attendeeDetails?: CalendarEventAttendee[];
    /** Provenance, navigation, and editability for a unified cross-module feed. */
    source?: CalendarEventSource;
    createdAt: number;
    updatedAt: number;
}

// ---- Browser control (#16) ----
// The embedded browser is an <iframe> in the web/Relay host and (potentially) a
// <webview>/BrowserView in Electron. Navigation works in BOTH hosts (we just swap the
// URL the view loads). DOM read / click / arbitrary eval require a same-process page
// bridge — only the Electron <webview>.executeJavaScript() path can satisfy them; in the
// cross-origin iframe host they are intentionally refused rather than silently faked.

/** Which browser-control action an agent (or the UI) is requesting. */
export type BrowserActionKind = "navigate" | "readDom" | "click" | "eval";

/**
 * Brain → host instruction to actually perform a DOM-level action against the live page.
 * Only a scripting-capable host (the Electron <webview>) acts on this; it runs the action
 * via webview.executeJavaScript and replies over `browser:resultReport` (correlated by
 * requestId). The web/iframe host ignores it (and never flips hostCanScript on).
 */
export interface BrowserHostCommand {
    sessionId: string;
    action: BrowserActionKind;
    requestId: string;
    /** click → CSS selector to click. */
    selector?: string;
    /** eval → JS source to evaluate in the page. */
    js?: string;
}

/** A single page-control result returned to the requester (and audited). */
export interface BrowserControlResult {
    sessionId: string;
    action: BrowserActionKind;
    ok: boolean;
    /** navigate → the resolved URL; readDom → text/html; eval → JSON-stringified result; click → "clicked". */
    value?: string;
    /** Present when ok=false — e.g. "not available in this host (needs Electron <webview>)". */
    error?: string;
    /** Correlates a result with the WebCommand that triggered it (when one did). */
    requestId?: string;
}

/** Live page state for a browser session, pushed as a browser:event stream. */
export interface BrowserPageInfo {
    sessionId: string;
    url: string;
    title?: string;
    /** True while an agent currently owns/drives this session (drives the "AI controlled" badge). */
    aiControlled?: boolean;
    /** The agent id that owns the session, when aiControlled. */
    controllerAgentId?: string;
}

export type LifeOSModule = "financial" | "social" | "workouts" | "health" | "nutrition" | "tasks" | "calendar";
export type LifeOSCommandType = `${LifeOSModule}:${string}`;

export interface SecurityStatus {
    secretStore: {
        backend: "win32-dpapi-current-user" | "file-permissions";
        encryptedAtRest: boolean;
        itemCount: number;
    };
    diagnostics: {
        localOnly: true;
        telemetryEnabled: boolean;
        crashReportsEnabled: boolean;
        telemetryEventCount: number;
        storedCrashCount: number;
        lastCrashAt?: number;
    };
    redaction: {
        enabled: boolean;
        protectedValueCount: number;
    };
}

export type SecurityOperation = "clearSecrets" | "clearDiagnostics";

// ---- Provider sessions (Codex App Server) ----
// These types are deliberately provider-neutral at the renderer boundary. The
// first implementation is Codex, backed by the official local app-server.

export type ProviderSessionBackend = "codex";
export type ProviderSessionStatus = "active" | "idle" | "notLoaded" | "error";

export interface ProviderAccountState {
    status: "connected" | "signedOut" | "authRequired" | "unavailable";
    authMode: "chatgpt" | "apiKey" | "amazonBedrock" | null;
    plan: string | null;
    requiresOpenaiAuth: boolean;
}

export interface ProviderUsageWindow {
    usedPercent: number;
    windowDurationMins: number | null;
    /** Unix timestamp in seconds, matching the Codex App Server contract. */
    resetsAt: number | null;
}

export interface ProviderUsageState {
    primary: ProviderUsageWindow | null;
    secondary: ProviderUsageWindow | null;
    planType: string | null;
    rateLimitReachedType: string | null;
    credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
    resetCreditsAvailable: number;
}

export interface ProviderSessionModel {
    id: string;
    model: string;
    displayName: string;
    description: string;
    hidden: boolean;
    defaultReasoningEffort: string;
    supportedReasoningEfforts: { effort: string; description: string }[];
    inputModalities: string[];
    supportsPersonality: boolean;
    isDefault: boolean;
}

export interface ProviderSessionSummary {
    id: string;
    /** Root session-tree id reported by Codex; do not derive it from `id`. */
    sessionId: string;
    title: string;
    preview: string;
    status: ProviderSessionStatus;
    activeFlags: string[];
    /** Loaded into Coretex's managed app-server process, not another Codex client. */
    isLoaded: boolean;
    model: string | null;
    modelProvider: string;
    source: string;
    cwd: string;
    /** Epoch milliseconds (normalized from Codex's seconds-based timestamps). */
    createdAt: number;
    /** Epoch milliseconds (normalized from Codex's seconds-based timestamps). */
    updatedAt: number;
}

export interface ProviderSessionItem {
    id: string;
    type: string;
    /** Present for user/agent/plan text only; tool payloads are intentionally omitted. */
    text?: string;
    status?: string;
    durationMs?: number;
    exitCode?: number;
}

export interface ProviderSessionTurn {
    id: string;
    status: string;
    startedAt: number;
    completedAt: number;
    durationMs: number | null;
    items: ProviderSessionItem[];
}

export interface ProviderSessionDetail extends ProviderSessionSummary {
    turns: ProviderSessionTurn[];
    /** Present when metadata loaded but this App Server cannot decode turn history. */
    historyWarning?: string;
}

export interface ProviderSessionLiveEvent {
    kind: "threadStatus" | "turnStarted" | "turnCompleted" | "messageDelta" | "error";
    sessionId: string;
    turnId?: string;
    itemId?: string;
    status?: string;
    activeFlags?: string[];
    text?: string;
    error?: string;
}

export interface ProviderSessionsState {
    provider: ProviderSessionBackend;
    account: ProviderAccountState;
    usage: ProviderUsageState | null;
    models: ProviderSessionModel[];
    sessions: ProviderSessionSummary[];
    /** Threads loaded into Coretex's app-server process only. */
    loadedSessionIds: string[];
    nextCursor: string | null;
    error?: string;
}

export interface ProviderAuthLogin {
    type: "browser" | "deviceCode";
    loginId: string;
    authUrl: string | null;
    verificationUrl: string | null;
    userCode: string | null;
}

export interface ProviderAuthState {
    provider: ProviderSessionBackend;
    account: ProviderAccountState;
    usage: ProviderUsageState | null;
    login: ProviderAuthLogin | null;
    error?: string;
}

// ---- WebSocket protocol: Brain -> Relay ----
export type OrchestratorEvent =
    | { type: "agent:status"; agentId: string; status: AgentStatus; taskId?: string }
    | { type: "agent:canvas"; state: AgentCanvasState }
    | { type: "agent:stream"; agentId: string; taskId: string; chunk: string }
    | { type: "agent:step"; agentId: string; taskId: string; step: number; content: string }
    /** One agent/UI filesystem edit — mirrored into Source Control attribution. */
    | { type: "agent:fileChange"; change: AgentFileChange }
    /** Recent agent/UI file-edit ring buffer (sent on connect / refresh). */
    | { type: "agent:fileChanges"; changes: AgentFileChange[] }
    | { type: "task:created"; task: Task }
    | { type: "task:updated"; task: Task }
    | { type: "task:completed"; task: Task; result: string }
    | { type: "task:failed"; task: Task; error: string }
    | { type: "task:deleted"; taskId: string }
    | { type: "task:log"; log: TaskLog }
    | { type: "project:created"; project: Project }
    | { type: "project:updated"; project: Project }
    | { type: "project:deleted"; projectId: string }
    | { type: "cost:update"; summary: CostSummary }
    | { type: "providers:health"; health: ProviderHealth[] }
    | { type: "providers:models"; models: ModelInfo[] }
    | ({ type: "provider:sessions"; requestId?: string } & ProviderSessionsState)
    | { type: "provider:sessionResult"; provider: ProviderSessionBackend; requestId?: string; operation: "start" | "resume" | "open" | "prompt"; session?: ProviderSessionDetail; turnId?: string; error?: string }
    | { type: "provider:session:event"; provider: ProviderSessionBackend; event: ProviderSessionLiveEvent }
    | ({ type: "provider:auth"; requestId?: string } & ProviderAuthState)
    | { type: "system:status"; agents: AgentState[]; tasks: Task[]; projects: Project[] }
    | { type: "system:log"; level: LogLevel; message: string; timestamp: string }
    | { type: "code:indexStatus"; state: CodeIndexState }
    | { type: "chat:message"; message: ChatMessage }
    | { type: "chat:stream"; projectId: string; messageId: string; chunk: string }
    | { type: "chat:history"; projectId: string; messages: ChatMessage[] }
    | { type: "chat:done"; projectId: string; messageId: string }
    | { type: "chat:error"; projectId: string; error: string }
    // ---- Command-center AI answer (#32) ----
    | { type: "assistant:answer"; id: string; chunk: string }
    | { type: "assistant:done"; id: string }
    | { type: "assistant:error"; id: string; error: string }
    | { type: "project:billing"; projectId: string; summary: CostSummary }
    | { type: "settings:state"; config: CoretexConfig }
    | { type: "security:state"; status: SecurityStatus }
    | { type: "security:operationResult"; action: SecurityOperation; ok: boolean; cleared: number; error?: string }
    | { type: "security:commandCheck"; requestId: string; allowed: boolean; requiresApproval: boolean; reason?: string; matchedRule?: string }
    | { type: "fs:listing"; path: string; parent: string | null; entries: FsEntry[]; error?: string }
    | { type: "fs:file"; path: string; content: string; truncated: boolean; error?: string }
    | { type: "fs:written"; path: string; ok: boolean; error?: string }
    | { type: "fs:opResult"; op: "move" | "mkdir" | "newFile" | "delete" | "paste" | "extract" | "compress" | "open"; ok: boolean; from?: string; to?: string; error?: string }
    | { type: "fs:propertiesResult"; path: string; ok: boolean; info?: FileProperties; error?: string }
    | { type: "fs:clipboardState"; source: string | null; action: "copy" | "cut" | null }
    | { type: "fs:thumb"; path: string; dataUrl: string | null }
    | { type: "fs:peeked"; path: string; content: string; truncated: boolean; error?: string }
    | { type: "fs:dirListing"; path: string; parent: string | null; entries: FsEntry[]; error?: string }
    | { type: "fs:gitStatusResult"; path: string; repoRoot: string | null; statuses: Record<string, GitStatusCode> }
    | { type: "github:overviewResult"; requestId: string; overview: GithubOverview }
    | { type: "github:detailResult"; requestId: string; detail?: GithubRepositoryDetail; error?: string }
    | { type: "git:summaryResult"; requestId: string; summary: GitRepoSummary }
    | { type: "git:branchesResult"; requestId: string; branches: GitBranchInfo[]; error?: string }
    | { type: "git:logResult"; requestId: string; commits: GitCommitInfo[]; error?: string }
    | { type: "git:prsResult"; requestId: string; prs: GitPullRequestInfo[]; fullName?: string; error?: string }
    | { type: "git:deploymentsResult"; requestId: string; deployments: GithubDeploymentInfo[]; workflows: GithubWorkflowRunInfo[]; error?: string }
    | { type: "git:opResult"; requestId: string; ok: boolean; message?: string; error?: string; repoPath?: string; resultUrl?: string; linkedProjectIds?: string[] }
    | { type: "fs:drivesResult"; drives: DriveInfo[] }
    | { type: "fs:pathsChecked"; exists: Record<string, boolean> }
    | { type: "fs:searchResult"; scope: "folder" | "index"; query: string; hits: IndexedEntry[] }
    | { type: "index:state"; state: IndexState }
    | { type: "index:progress"; count: number; current: string; done: boolean }
    | { type: "fs:roots"; roots: string[]; home: string }
    | { type: "db:result"; connectionId: string; requestId?: string; columns: string[]; rows: unknown[][]; rowCount: number; elapsedMs: number; truncated?: boolean; error?: string }
    | { type: "db:schema"; connectionId: string; requestId?: string; tables: DbSchemaTable[]; error?: string }
    | { type: "db:databases"; connectionId: string; requestId?: string; databases: DbDatabaseInfo[]; error?: string }
    | { type: "db:introspection"; connectionId: string; requestId?: string; introspection?: DbIntrospection; error?: string }
    | { type: "db:testResult"; connectionId: string; requestId?: string; ok: boolean; error?: string }
    | { type: "ollama:models"; models: OllamaModelDetail[]; error?: string }
    | { type: "ollama:pullProgress"; progress: OllamaPullProgress }
    | { type: "ollama:deleted"; model: string; ok: boolean; error?: string }
    | { type: "ollama:show"; model: string; details?: Record<string, string>; error?: string }
    | { type: "calendar:events"; events: CalendarEvent[]; categories: CalendarCategory[] }
    | { type: "memory:items"; items: MemoryItem[] }
    | { type: "email:state"; state: EmailState }
    | { type: "env:state"; state: EnvManagerState }
    | { type: "keyvault:state"; state: KeyVaultState }
    | { type: "keyvault:testResult"; result: KeyTestResult }
    | { type: "keyvault:integrationResult"; id: string; status: ServiceConnection["status"]; message?: string }
    | {
          type: "connector:operationResult";
          requestId: string;
          operation: "connect" | "verify" | "disconnect";
          integrationId: string;
          ok: boolean;
          status?: ServiceConnection["status"];
          verification?: ConnectorVerification;
          message?: string;
          credentialIds?: string[];
      }
    | { type: "keyvault:scanProgress"; scanned: number; current: string; done: boolean }
    | { type: "keyvault:scanResult"; result: LeakScanResult }
    | { type: "filesmeta:state"; state: FilesMetaState }
    | { type: "mcp:status"; status: McpServerStatus }
    | { type: "mcp:toolResult"; serverId: string; name: string; result?: string; error?: string }
    | { type: "topology:started"; runId: string }
    | { type: "topology:turn"; turn: TopologyTurn }
    | { type: "topology:stream"; runId: string; agentId: string; round: number; phase: string; chunk: string }
    | { type: "topology:done"; runId: string; result: string }
    | { type: "topology:error"; runId: string; error: string }
    | { type: "plan:stream"; runId: string; chunk: string }
    | { type: "plan:done"; runId: string; taskId?: string; markdown: string }
    | { type: "plan:error"; runId: string; error: string }
    | { type: "servers:list"; servers: RunningServer[] }
    | { type: "servers:killed"; pid: number; ok: boolean; error?: string }
    | { type: "terminal:created"; meta: TerminalSessionMeta }
    | { type: "terminal:data"; id: string; data: string }
    | { type: "terminal:replay"; id: string; data: string }
    | { type: "terminal:exit"; id: string; code: number }
    | { type: "terminal:list"; sessions: TerminalSessionMeta[] }
    | { type: "terminal:shellInfo"; info: SessionShellInfo }
    | { type: "terminal:block"; block: CommandBlock }
    | { type: "terminal:pathExecutables"; sessionId: string; names: string[] }
    | { type: "buddy:environment"; sessionId: string; env: TerminalEnvironment }
    | { type: "buddy:probing"; sessionId: string; probing: boolean; error?: string }
    | { type: "buddy:plan"; sessionId: string; taskId: string; request: string; mode: BuddyMode; steps: BuddyStepRuntime[] }
    | { type: "buddy:step"; sessionId: string; taskId: string; step: BuddyStepRuntime }
    | { type: "buddy:activity"; sessionId: string; status: BuddyStatus; line: string }
    | { type: "buddy:needsHelp"; sessionId: string; taskId: string; help: BuddyHelp }
    | { type: "buddy:done"; sessionId: string; taskId: string; ok: boolean; summary: string; halted?: boolean }
    | { type: "buddy:error"; sessionId: string; error: string }
    | { type: "docker:state"; state: DockerState }
    | { type: "docker:operation"; operation: DockerOperationState }
    | { type: "remote:sessions"; sessions: RemoteSession[] }
    | { type: "remote:listing"; sessionId: string; path: string; entries: RemoteEntry[]; error?: string }
    | { type: "remote:opResult"; sessionId: string; op: "mkdir" | "delete" | "download" | "upload" | "rename"; ok: boolean; error?: string }
    | { type: "browser:event"; info: BrowserPageInfo }
    | { type: "browser:result"; result: BrowserControlResult }
    // Brain → host: perform a DOM/click/eval action against the live <webview> (Electron only).
    | { type: "browser:command"; command: BrowserHostCommand }
    | { type: "notice"; level: "info" | "success" | "warning" | "error"; message: string }
    | { type: LifeOSCommandType; requestId?: string; result?: unknown; error?: string; errorCode?: string; retryable?: boolean };

export type OrchestratorEventType = OrchestratorEvent["type"];
export type ConnectorOperationResult = Extract<OrchestratorEvent, { type: "connector:operationResult" }>;

// ---- WebSocket protocol: Relay -> Brain ----
export type WebCommand =
    | { type: "task:create"; task: CreateTaskInput }
    | { type: "task:cancel"; taskId: string }
    | { type: "task:delete"; taskId: string }
    | { type: "task:reprioritize"; taskId: string; priority: TaskPriority }
    | { type: "task:refine"; taskId: string; patch: RefineTaskPatch }
    | { type: "agent:pause"; agentId: string }
    | { type: "agent:resume"; agentId: string }
    | { type: "agent:setDailyBudget"; agentId: string; tokens: number }
    | { type: "agent:create"; config: CreateAgentInput }
    | { type: "agent:createMany"; config: CreateAgentInput; count: number }
    | { type: "agent:update"; agentId: string; patch: Partial<AgentConfig> }
    | { type: "agent:remove"; agentId: string }
    | { type: "agent:halt"; agentId: string }
    | { type: "agent:haltAll"; projectId?: string }
    | { type: "agent:pauseAll"; projectId?: string }
    | { type: "agent:resumeAll"; projectId?: string }
    | { type: "agent:setPermissionMode"; agentId: string; mode: PermissionMode }
    | { type: "agent:canvas:get" }
    | { type: "agent:canvas:setPosition"; agentId: string; position: AgentCanvasPoint }
    | { type: "agent:canvas:setLayout"; positions: Record<string, AgentCanvasPoint> }
    | { type: "agent:canvas:reset" }
    | { type: "agent:canvas:updatePreferences"; patch: { showConnections?: boolean } }
    | { type: "agent:canvas:updateCard"; agentId: string; patch: Partial<AgentCanvasCardSettings> }
    | { type: "plan:run"; taskId?: string; prompt: string; plannerAgentId: string }
    | { type: "plan:stop" }
    | { type: "project:create"; project: CreateProjectInput }
    | { type: "project:addDocuments"; projectId: string; documents: UploadedDoc[] }
    | { type: "project:updateDocument"; projectId: string; name: string; patch: { title?: string; description?: string } }
    | { type: "project:removeDocument"; projectId: string; name: string }
    | { type: "project:delete"; projectId: string }
    | { type: "project:setIcon"; projectId: string; icon?: string; color?: string }
    | { type: "project:update"; projectId: string; patch: { name?: string; description?: string; status?: ProjectStatus; tags?: string[]; appearance?: ProjectAppearance; connectorIds?: string[] } }
    | { type: "project:setSource"; projectId: string; sourcePath: string }
    | { type: "project:setRepos"; projectId: string; repos: ProjectRepo[] }
    /** Atomically associate one repository with one or more projects. */
    | { type: "project:linkRepo"; projectIds: string[]; repo: ProjectRepo }
    /** Remove only the project association. Never deletes the local worktree. */
    | { type: "project:unlinkRepo"; projectId: string; repoId: string }
    | { type: "project:reindexCode"; projectId: string; full?: boolean }
    | { type: "project:setAssistantModel"; projectId: string; provider: ProviderType; model: string }
    | { type: "project:setBudget"; projectId: string; budgetUSD: number }
    | { type: "project:getBilling"; projectId: string }
    | { type: "chat:send"; projectId: string; content: string }
    | { type: "chat:getHistory"; projectId: string }
    | { type: "chat:stop"; projectId: string }
    | { type: "chat:clear"; projectId: string }
    // ---- Command-center AI answer (#32) ----
    | {
          type: "assistant:ask";
          id: string;
          prompt: string;
          projectId?: string;
          agentId?: string;
          /** Explicit provider/model override (skips automatic resolution when both supplied). */
          provider?: ProviderType;
          model?: string;
          /** Reasoning/effort hint passed through to the hub. */
          effort?: string;
          /** Request a web-search-augmented answer (best-effort; no-op if no search tool is available). */
          search?: boolean;
          /** Personal modules explicitly enabled for this turn. Omitted means no LifeOS module data. */
          contextAreas?: string[];
          /** Permit a safe, non-destructive LifeOS mutation when the user explicitly requests it. */
          allowActions?: boolean;
          /** Prior turns to seed multi-turn context (in order, oldest first). */
          history?: { role: "user" | "assistant"; content: string }[];
          /** Inline attachments — images go multimodal; files contribute text; videos/unsupported are noted by name. */
          attachments?: { kind: "image" | "file"; name: string; mime: string; data: string; text?: string }[];
      }
    | { type: "assistant:stop"; id: string }
    | { type: "settings:get" }
    | { type: "settings:update"; patch: Record<string, unknown> }
    | { type: "settings:setPath"; path: string; value: unknown }
    | { type: "settings:reset"; keepProfilesAndSchemes?: boolean }
    | { type: "settings:setSecret"; key: string; value: string }
    | { type: "settings:testProvider"; provider: string }
    | { type: "provider:sessions:get"; provider: ProviderSessionBackend; requestId?: string; cursor?: string; limit?: number; archived?: boolean }
    | { type: "provider:session:start"; provider: ProviderSessionBackend; requestId?: string; model?: string; effort?: string; cwd?: string; permissionMode?: "read-only" | "workspace-write"; initialPrompt?: string }
    | { type: "provider:session:resume"; provider: ProviderSessionBackend; requestId?: string; sessionId: string; model?: string; effort?: string; cwd?: string; permissionMode?: "read-only" | "workspace-write" }
    | { type: "provider:session:open"; provider: ProviderSessionBackend; requestId?: string; sessionId: string; includeTurns?: boolean }
    | { type: "provider:session:prompt"; provider: ProviderSessionBackend; requestId?: string; sessionId: string; prompt: string; model?: string; effort?: string; cwd?: string; permissionMode?: "read-only" | "workspace-write" }
    | { type: "provider:auth:get"; provider: ProviderSessionBackend; requestId?: string; refreshToken?: boolean }
    | { type: "provider:auth:start"; provider: ProviderSessionBackend; requestId?: string; mode?: "browser" | "deviceCode" }
    | { type: "provider:auth:cancel"; provider: ProviderSessionBackend; requestId?: string; loginId: string }
    | { type: "provider:auth:logout"; provider: ProviderSessionBackend; requestId?: string }
    | { type: "security:get" }
    | { type: "security:clearSecrets" }
    | { type: "security:clearDiagnostics" }
    | { type: "security:checkCommand"; requestId: string; command: string }
    // ---- Electron-native LifeOS modules ----
    | { type: LifeOSCommandType; requestId?: string; userId?: string; payload?: Record<string, unknown> }
    | { type: "fs:list"; path: string }
    | { type: "fs:read"; path: string }
    | { type: "fs:write"; path: string; content: string }
    | { type: "fs:move"; from: string; to: string; copy?: boolean }
    | { type: "fs:copy"; src: string }
    | { type: "fs:cut"; src: string }
    | { type: "fs:paste"; dest: string }
    | { type: "fs:mkdir"; path: string }
    | { type: "fs:newFile"; path: string }
    | { type: "fs:delete"; path: string }
    | { type: "fs:thumbnail"; path: string }
    | { type: "fs:properties"; path: string }
    | { type: "fs:extract"; archivePath: string; destDir: string }
    | { type: "fs:compress"; srcPaths: string[]; destPath: string }
    | { type: "fs:openExternal"; path: string }
    | { type: "fs:openWith"; path: string }
    | { type: "models:get" }
    | { type: "fs:peek"; path: string }
    | { type: "fs:listDir"; path: string }
    | { type: "fs:gitStatus"; path: string }
    | { type: "github:overview"; requestId: string; refresh?: boolean }
    | { type: "github:detail"; requestId: string; fullName?: string; path?: string }
    | { type: "github:clone"; requestId: string; cloneUrl: string; destinationPath: string; projectIds?: string[] }
    | { type: "git:summary"; requestId: string; path: string }
    | { type: "git:branches"; requestId: string; path: string }
    | { type: "git:log"; requestId: string; path: string; limit?: number }
    | { type: "git:prs"; requestId: string; path: string; fullName?: string }
    | { type: "git:checkout"; requestId: string; path: string; branch: string; create?: boolean }
    | { type: "git:fetch"; requestId: string; path: string; fullName?: string }
    | { type: "git:pull"; requestId: string; path: string; fullName?: string }
    | { type: "git:push"; requestId: string; path: string; setUpstream?: boolean; fullName?: string }
    | { type: "git:stage"; requestId: string; path: string; files: string[] }
    | { type: "git:unstage"; requestId: string; path: string; files: string[] }
    | { type: "git:commit"; requestId: string; path: string; message: string; stageAll?: boolean }
    | { type: "git:merge"; requestId: string; path: string; branch: string; mode?: "ff-only" | "no-ff" }
    | { type: "git:createPr"; requestId: string; path: string; fullName: string; base: string; title: string; body?: string }
    | { type: "git:mergePr"; requestId: string; path: string; fullName: string; pr: string }
    | { type: "git:deployments"; requestId: string; fullName: string }
    | { type: "fs:drives" }
    | { type: "fs:checkPaths"; paths: string[] }
    | { type: "fs:search"; scope: "folder" | "index"; root: string; query: string }
    | { type: "index:get" }
    | { type: "index:addLocation"; path: string }
    | { type: "index:removeLocation"; path: string }
    | { type: "index:reindex" }
    | { type: "index:setWatch"; enabled: boolean }
    | { type: "fs:roots" }
    | { type: "db:query"; connectionId: string; sql: string; requestId?: string }
    | { type: "db:schema"; connectionId: string; requestId?: string }
    | { type: "db:listDatabases"; connectionId: string; requestId?: string }
    | { type: "db:introspect"; connectionId: string; target: DbIntrospectionTarget; requestId?: string }
    | { type: "db:testConnection"; connectionId: string; requestId?: string }
    | { type: "ollama:list" }
    | { type: "ollama:pull"; model: string }
    | { type: "ollama:delete"; model: string }
    | { type: "ollama:show"; model: string }
    | { type: "calendar:list" }
    | { type: "calendar:upsert"; event: CalendarEvent }
    | { type: "calendar:delete"; id: string }
    | { type: "calendar:setCategories"; categories: CalendarCategory[] }
    | { type: "memory:list" }
    | { type: "memory:upsert"; item: MemoryItem }
    | { type: "memory:delete"; id: string }
    | { type: "memory:generate"; projectId?: string }
    | { type: "email:get" }
    | { type: "email:setFlags"; id: string; isRead?: boolean; isStarred?: boolean }
    | { type: "email:move"; id: string; folder?: EmailFolder; category?: string | null }
    | { type: "email:send"; requestId: string; accountId?: string; to: string; subject: string; body: string }
    | { type: "email:categorize" }
    | { type: "email:setAgent"; config: Partial<EmailAgentConfig> }
    | { type: "email:setCategories"; categories: EmailCategory[] }
    | { type: "email:correctSort"; emailId: string; category: string }
    | { type: "email:connectGoogle" }
    | { type: "email:connectImap"; requestId: string; input: EmailConnectInput }
    | { type: "email:syncAccount"; id: string }
    | { type: "email:disconnectAccount"; id: string }
    | { type: "env:get" }
    | { type: "env:upsertEnvironment"; environment: Environment }
    | { type: "env:deleteEnvironment"; id: string }
    | { type: "env:upsertVar"; envId: string; variable: EnvVariable }
    | { type: "env:deleteVar"; envId: string; varId: string }
    | { type: "env:import"; envId: string; content: string }
    | { type: "keyvault:get" }
    | { type: "keyvault:upsertKey"; key: APIKey }
    | { type: "keyvault:deleteKey"; id: string }
    | { type: "keyvault:testKey"; id: string }
    | { type: "keyvault:upsertIntegration"; integration: ServiceConnection }
    | { type: "keyvault:deleteIntegration"; id: string }
    | { type: "keyvault:verifyIntegration"; id: string }
    | {
          type: "connector:connect";
          requestId: string;
          integration: ServiceConnection;
          credentials: ConnectorCredentialInput[];
          /** Optional account-scoped MCP runtime registered atomically with the connector. */
          runtime?: CoretexConfig["mcpServers"][number];
      }
    | { type: "connector:verify"; requestId: string; integrationId: string }
    | { type: "connector:disconnect"; requestId: string; integrationId: string }
    | { type: "keyvault:scanLeaks"; locations?: string[] }
    | { type: "filesmeta:get" }
    | { type: "filesmeta:setPath"; path: string; patch: FilePathMeta }
    | { type: "filesmeta:clearPath"; path: string }
    | { type: "filesmeta:upsertTag"; tag: FileTag }
    | { type: "filesmeta:deleteTag"; id: string }
    | { type: "filesmeta:setPathTags"; paths: string[]; tagIds: string[] }
    | { type: "filesmeta:upsertCollection"; collection: SmartCollection }
    | { type: "filesmeta:deleteCollection"; id: string }
    | { type: "filesmeta:upsertPin"; pin: FilePin }
    | { type: "filesmeta:deletePin"; id: string }
    | { type: "filesmeta:setPins"; pins: FilePin[] }
    | { type: "filesmeta:setDriveMeta"; path: string; patch: DriveMeta }
    | { type: "composer:setScope"; chatId: string; scope: ConversationScope }
    | { type: "filesmeta:movePath"; from: string; to: string }
    | { type: "topology:run"; kind: TopologyKind; prompt: string; agentIds: string[]; rounds?: number }
    | { type: "topology:stop" }
    | { type: "mcp:connect"; serverId: string }
    | { type: "mcp:disconnect"; serverId: string }
    | { type: "mcp:callTool"; serverId: string; name: string; args: Record<string, unknown> }
    | { type: "servers:scan" }
    | { type: "servers:kill"; pid: number }
    | { type: "terminal:create"; profileId?: string; shell?: string; cwd?: string; cols?: number; rows?: number; agentId?: string; projectId?: string }
    | { type: "terminal:input"; id: string; data: string }
    | { type: "terminal:resize"; id: string; cols: number; rows: number }
    | { type: "terminal:kill"; id: string }
    | { type: "terminal:list" }
    | { type: "terminal:replay"; id: string }
    | { type: "buddy:probe"; sessionId: string; shell?: string; cwd?: string }
    | { type: "buddy:run"; sessionId: string; request: string; mode: BuddyMode }
    | { type: "buddy:accept"; sessionId: string; stepId: string; command?: string }
    | { type: "buddy:skip"; sessionId: string; stepId: string }
    | { type: "buddy:reject"; sessionId: string }
    | { type: "buddy:retry"; sessionId: string; stepId: string; approach?: string }
    | { type: "buddy:setMode"; sessionId: string; mode: BuddyMode }
    | { type: "buddy:halt"; sessionId: string }
    | { type: "docker:refresh"; operationId?: string }
    | { type: "docker:action"; action: DockerAction; id: string; operationId?: string }
    | { type: "docker:prune"; target: DockerPruneTarget; operationId?: string }
    | { type: "remote:get" }
    | { type: "remote:connect"; hostId: string }
    | { type: "remote:disconnect"; sessionId: string }
    | { type: "remote:list"; sessionId: string; path: string }
    | { type: "remote:mkdir"; sessionId: string; path: string }
    | { type: "remote:rename"; sessionId: string; from: string; to: string }
    | { type: "remote:delete"; sessionId: string; path: string; isDir: boolean }
    | { type: "remote:download"; sessionId: string; remotePath: string; localPath: string }
    | { type: "remote:upload"; sessionId: string; localPath: string; remotePath: string }
    | { type: "cost:setDailyLimit"; usd: number }
    // ---- Browser control (#16) ----
    | { type: "browser:navigate"; sessionId: string; url: string; requestId?: string; agentId?: string }
    | { type: "browser:readDom"; sessionId: string; requestId?: string; agentId?: string }
    | { type: "browser:click"; sessionId: string; selector: string; requestId?: string; agentId?: string }
    | { type: "browser:eval"; sessionId: string; js: string; requestId?: string; agentId?: string }
    // Relay → Brain: report the page's current url/title back (from the iframe/webview onUrlChange).
    | { type: "browser:report"; sessionId: string; url: string; title?: string }
    // Relay → Brain: the result of a DOM/eval round-trip that the host actually performed (Electron webview).
    | { type: "browser:resultReport"; result: BrowserControlResult }
    // Relay → Brain: declare whether this host can script the page (Electron <webview> present).
    | { type: "browser:hostCaps"; canScript: boolean }
    | { type: "browser:takeover"; sessionId: string }
    | { type: "system:status" }
    | { type: "system:health_check" };

export type WebCommandType = WebCommand["type"];
