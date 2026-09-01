// Coretex — settings schema. The single source of truth for CoretexConfig.
// Persisted to ~/.coretex/settings.json (secrets live separately, never here).
// Every settings control in the desktop app is backed by one key in this tree.

import type { AgentRole, ProviderType, TaskPriority } from "../types.js";

/** Untitled UI badge color tokens (used for customizable priority/role badges). */
export type BadgeColor = "gray" | "brand" | "error" | "warning" | "success" | "slate" | "sky" | "blue" | "indigo" | "purple" | "pink" | "orange";

// ---- Leaf record types ----
export interface KeyBinding {
    actionId: string;
    chords: string[];
    enabled: boolean;
}

export interface TerminalProfileAppearance {
    colorScheme: string; // "Default" inherits the app default
    fontFace: string;
    fontSize: number;
    fontWeight: "normal" | "medium" | "bold";
    ligatures: boolean;
    cursorShape: "bar" | "block" | "underline";
    cursorBlink: boolean;
    bgOpacity: number; // 0..100
    padding: string; // "8" or "8 12"
}

export interface TerminalProfile {
    id: string;
    name: string;
    commandLine: string;
    args: string;
    cwd: string;
    elevated: boolean;
    icon: string;
    tabColor: string | null;
    appearance: TerminalProfileAppearance;
}

export interface ColorScheme {
    name: string;
    builtIn: boolean;
    background: string;
    foreground: string;
    cursor: string;
    cursorAccent: string;
    selectionBackground: string;
    selectionForeground: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    purple: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightPurple: string;
    brightCyan: string;
    brightWhite: string;
}

export interface ProviderConfigState {
    provider: ProviderType;
    enabled: boolean;
    baseUrl?: string;
    keyConfigured: boolean; // the key itself lives in the secret store
    defaultModel?: string;
    /**
     * How agents authenticate / how spend is accounted.
     * - "claude-plan" → Claude Pro / Max / Team via Claude Code login (subscription usage, not API $)
     * - "api-key" → pay-per-token API key (default for cloud providers)
     * - "subscription" → consumer plan billing (ChatGPT Plus, Gemini Advanced, etc.) —
     *   Coretex records tokens but treats USD cost as $0 for agent runs (you pay the plan, not the API).
     */
    authMode?: "api-key" | "claude-plan" | "subscription";
    /** Optional human label for the plan (e.g. "ChatGPT Plus", "Gemini Advanced"). */
    planLabel?: string;
}

export interface SettingsAgentConfig {
    id: string;
    name: string;
    role: AgentRole;
    provider: ProviderType;
    model: string;
    instructions: string;
    scope: string;
    temperature: number;
    maxSteps: number;
    tokenBudget: number;
    dailyTokenBudget: number;
    canUseTerminal: boolean;
    allowedProjectIds: string[];
}

export interface McpServerConfig {
    id: string;
    name: string;
    transport: "stdio" | "url";
    command?: string;
    args?: string;
    url?: string;
    enabled: boolean;
    /** Names of env vars whose values live in the secret store. */
    envKeys: string[];
}

export interface DbConnection {
    id: string;
    name: string;
    engine: "sqlite" | "postgres" | "mysql" | "mariadb" | "mongo" | "redis";
    host?: string;
    port?: number;
    /** Database/catalog name. Redis stores its numeric database index here (defaults to "0"). */
    database?: string;
    user?: string;
    passwordConfigured: boolean;
    /** Negotiate a TLS/SSL connection (server engines only). */
    ssl?: boolean;
}

/** Container registry kind for Docker login / pull credentials. */
export type DockerRegistryKind =
    | "dockerhub"
    | "ghcr"
    | "ecr"
    | "gcr"
    | "gar"
    | "acr"
    | "quay"
    | "gitlab"
    | "custom";

export interface DockerRegistry {
    id: string;
    name: string;
    /** Registry host, e.g. docker.io, ghcr.io, 123.dkr.ecr.us-east-1.amazonaws.com */
    url: string;
    kind: DockerRegistryKind;
    username?: string;
    passwordConfigured: boolean;
    /** AWS region for ECR (kind === "ecr"). */
    awsRegion?: string;
    /** Optional named AWS profile for ECR token refresh hints. */
    awsProfile?: string;
}

/** Persisted Docker engine preferences (Settings → Docker). Live objects live in DockerState. */
export interface DockerSettings {
    /** When false, Coretex skips Docker polling / refresh. */
    enabled: boolean;
    /** Override engine socket (e.g. //./pipe/docker_engine or /var/run/docker.sock). Empty = dockerode default. */
    socketPath: string;
    /** DOCKER_HOST-style override (tcp://host:2375 or ssh://…). Empty = use socket / default. */
    host: string;
    /** Require TLS when connecting over TCP. */
    tlsVerify: boolean;
    /** Auto-refresh the Docker view while it is open. */
    autoRefresh: boolean;
    /** Poll interval seconds when autoRefresh is on (3–60). */
    pollIntervalSec: number;
    /** Include stopped/exited containers in the Docker view list. */
    showStoppedContainers: boolean;
    /** Require an arm-to-confirm click before remove/prune actions. */
    confirmDestructive: boolean;
    /** What the dashboard "Clean up" (prune all) action should reclaim. */
    pruneDefaults: {
        containers: boolean;
        images: boolean;
        volumes: boolean;
        networks: boolean;
        buildCache: boolean;
    };
    /** Saved registry logins (password in secret store: docker.registry.<id>.password). */
    registries: DockerRegistry[];
}

export interface SshHost {
    id: string;
    label: string;
    /** Transport: ssh/sftp browse over the SFTP subsystem; ftp uses plain FTP. Defaults to "sftp" when absent. */
    protocol?: "ssh" | "sftp" | "ftp";
    host: string;
    port: number;
    user: string;
    auth: "key" | "agent" | "password";
}

export interface PairedDevice {
    id: string;
    name: string;
    pairedAt: number;
    /** Device OS when known. */
    platform?: "ios" | "android" | "other";
    /** Last heartbeat from the companion (ms since epoch). */
    lastSeenAt?: number;
    /** Connection status; absent devices treated as offline. */
    status?: "online" | "offline" | "pending";
    /** Optional short pair code used when this device joined. */
    pairCode?: string;
}

/** Open one-time invite for scanning the pair QR on mobile. */
export interface MeshPairingInvite {
    code: string;
    createdAt: number;
    expiresAt: number;
}

export interface Integration {
    id: string;
    name: string;
    enabled: boolean;
}

export interface ExtensionState {
    id: string;
    name: string;
    enabled: boolean;
    permissions: string[];
}

/** A coding-agent execution harness (Claude Code, Codex, OpenCode, Ollama, …). */
export interface CodingAgentHarness {
    id: string;
    name: string;
    provider: ProviderType;
    enabled: boolean;
    /** LogoKit brand domain for the harness mark. */
    logoDomain: string;
}

/** A built-in MCP server bundled with Coretex (coretex-*). */
export type BuiltInMcpId =
    | "coretex-browser"
    | "coretex-filesystem"
    | "coretex-git"
    | "coretex-ssh"
    | "coretex-terminal";

export interface BuiltInMcpServer {
    id: BuiltInMcpId;
    description: string;
    caps: ("tools" | "resources")[];
    enabled: boolean;
}

// ---- Chat composer scope (per-conversation attached integrations / env / context) ----
/** A file/folder/doc attached to a conversation as context. */
export interface ConversationContextItem {
    kind: "file" | "folder" | "doc";
    path: string;
    label: string;
}
/** What a single conversation has explicitly attached/enabled via the composer "+" menu. */
export interface ConversationScope {
    /** Integration (ServiceConnection) ids enabled for this conversation. */
    integrationIds: string[];
    /** A project+environment whose variable NAMES (optionally a subset) are in scope. */
    envScope?: { projectId: string; environmentId: string; environment: string; varNames?: string[] };
    /** Attached files/docs/source. */
    context: ConversationContextItem[];
}

// ---- Terminal autocomplete (ghost text + completion dropdown) ----
/** When to fall back to the shell's native Tab completion. */
export type NativeTabFallback = "never" | "when-no-suggestion" | "always";

/** Which completion providers feed the CompletionEngine. */
export interface AutocompleteProviders {
    /** Fish-style command history matching (most reliable; on by default). */
    history: boolean;
    /** Filesystem / path completion against the cwd. */
    path: boolean;
    /** Per-command spec database (flags/args). Follow-up provider. */
    specs: boolean;
    /** Scan PATH for executables to complete the first token. Follow-up provider. */
    pathExecutables: boolean;
    /** AI-generated suggestions. Off by default (cost + latency). */
    ai: boolean;
}

/** Terminal autocomplete configuration (drives the xterm host's ghost text + dropdown). */
export interface AutocompleteConfig {
    /** Master switch for the whole autocomplete subsystem. */
    enabled: boolean;
    /** Show the top suggestion as inline ghost text (fish-style). */
    ghostText: boolean;
    /** Show the multi-suggestion completion dropdown. */
    dropdown: boolean;
    /** Per-provider toggles. */
    providers: AutocompleteProviders;
    /** When to defer to the shell's native Tab completion. */
    nativeTabFallback: NativeTabFallback;
    /** Debounce (ms) before recomputing completions as the user types. */
    debounceMs: number;
}

// ---- The config tree ----
export interface CoretexConfig {
    account: {
        connected: boolean;
        sync: { settings: boolean; themes: boolean; profiles: boolean; sshConnections: boolean };
    };
    startup: {
        defaultProfileId: string | null;
        defaultTerminalApp: boolean;
        language: string;
        imeMode: string;
        launchOnLogin: boolean;
        onStart: "new-tab" | "restore";
        newInstance: "window" | "tab" | "focus";
        launchCols: number;
        launchRows: number;
        launchArgs: string;
    };
    session: { restore: boolean; workspacePresetId: string | null };
    interaction: {
        clipboard: {
            autoCopySelection: boolean;
            copyFormats: "plain" | "plain-html" | "plain-rtf";
            trimBlockSelection: boolean;
            trimOnPaste: boolean;
            wordDelimiters: string;
        };
        windowPanes: {
            snapToGrid: boolean;
            tabSwitcherStyle: "strip" | "mru";
            focusFollowsMouse: boolean;
            ctrlScrollFontSize: boolean;
            ctrlShiftScrollOpacity: boolean;
        };
        linksSelection: { detectUrls: boolean; searchUrlTemplate: string; colorSelectedText: boolean };
        ai: { assistOnError: boolean; commandBar: boolean; smartPasteGuard: boolean };
    };
    appearance: {
        application: { theme: "dark" | "light" | "system"; newTabPosition: "end" | "after-current" | "start"; activeColorScheme?: string | null; accent?: string };
        tabs: {
            alwaysShow: boolean;
            showInFullScreen: boolean;
            acrylic: boolean;
            widthMode: "equal" | "title" | "compact";
            titleFromActiveTerminal: boolean;
        };
        window: {
            hideTitleBar: boolean;
            alwaysOnTop: boolean;
            paneAnimations: boolean;
            autoHideOnBlur: boolean;
            adminShield: boolean;
            acrylicWhenUnfocused: boolean;
        };
        tray: { alwaysShowIcon: boolean; minimizeToTray: boolean };
        coretex: {
            sidebarWidth: number;
            sidebarCollapse: "hover" | "expanded" | "collapsed" | "manual";
            sidebarDensity: "comfortable" | "compact";
            sidebarShowProjects: boolean;
            statusBar: boolean;
            windowOpacity: number;
            blurRadius: number;
        };
        /** Customizable badge colors for task priorities and agent roles. */
        badges: {
            priority: Record<TaskPriority, BadgeColor>;
            role: Record<AgentRole, BadgeColor>;
        };
        /** Locale / formatting preferences (date, time, units, currency). Drives the shared formatters. */
        locale: {
            /** strftime-like date token, e.g. "YYYY-MM-DD" or "MM/DD/YYYY". */
            dateFormat: string;
            /** Clock format. */
            timeFormat: "12h" | "24h";
            /** Measurement system for sizes/speeds. */
            units: "imperial" | "metric";
            /** ISO 4217 currency code used by cost/money formatters, e.g. "USD". */
            currency: string;
        };
    };
    rendering: {
        render: {
            graphicsApi: "auto" | "d3d11" | "d3d12" | "opengl" | "software";
            disablePartialSwapchain: boolean;
            softwareRendering: boolean;
            webglTerminals: boolean;
            fontLigatures: boolean;
            antialiasing: "grayscale" | "subpixel" | "none";
        };
        compat: { runInBackground: boolean; textMeasurement: "grapheme" | "wcswidth" | "console" };
    };
    keybinds: KeyBinding[];
    profiles: TerminalProfile[];
    colorSchemes: ColorScheme[];
    aiProviders: ProviderConfigState[];
    agents: SettingsAgentConfig[];
    /** Coding-agent execution harnesses (settings → Agents). */
    codingAgents: CodingAgentHarness[];
    mcpServers: McpServerConfig[];
    /** Built-in coretex-* MCP servers bundled with the app. */
    mcpBuiltIns: BuiltInMcpServer[];
    database: { connections: DbConnection[]; defaultStore: string };
    /** Docker engine preferences and container registries (Settings → Docker). */
    docker: DockerSettings;
    /** Docker compose-project name → Coretex project id (user-managed links). */
    dockerLinks: Record<string, string>;
    /** Database connection id → Coretex project id (user-managed links). */
    databaseLinks: Record<string, string>;
    remote: { sshHosts: SshHost[]; mesh: { enabled: boolean; pairedDevices: PairedDevice[]; pairingInvite?: MeshPairingInvite | null }; integrations: Integration[] };
    security: {
        autonomousTerminal: "off" | "approval" | "auto";
        denylist: string[];
        allowlist: string[];
        /** Maximum AI-generated shell command length. Hard-clamped by ConfigStore. */
        maxCommandLength: number;
        telemetry: boolean;
        crashReports: boolean;
        redactSecrets: boolean;
        /** Account-wide daily spend cap (USD). 0 disables the cap. Read by the Brain into CostTracker. */
        dailyCostLimitUSD: number;
    };
    /** Global AI master switch — when false, orchestrator readiness loops idle. */
    ai: {
        /** Master kill-switch for all AI/agent execution. */
        enabled: boolean;
    };
    extensions: ExtensionState[];
    /** User profile — feeds the assistant's personalization context. */
    profile: {
        fullName: string;
        nickname: string;
        email: string;
        about: string;
        pronouns: string;
        avatarUrl: string;
    };
    /** Memory system (items live in ~/.coretex/memory.json, not here). */
    memory: {
        enabled: boolean;
        autoGenerate: boolean;
        referencePastChats: boolean;
    };
    /** Global tool-access posture for the assistant/agents. */
    toolAccess: {
        mode: "ask" | "auto-safe" | "read-only" | "full" | "plan";
        tools: { filesystem: boolean; terminal: boolean; web: boolean; browser: boolean; codeExec: boolean; database: boolean };
    };
    /** Desktop notification preferences. */
    notifications: {
        categories: Record<string, boolean>;
        sound: boolean;
        backgroundOnly: boolean;
        /** Master switch for desktop/native notifications. */
        desktopEnabled: boolean;
        /** Suppress non-critical notifications during a nightly window. */
        quietHours: { enabled: boolean; start: string; end: string };
        /** Roll routine notifications into a periodic digest instead of firing each one. */
        digest: { enabled: boolean; everyMinutes: number };
        /** Push + remote agent-control preferences for the (upcoming) Coretex mobile app. */
        mobile: {
            /** Master switch for mobile push (delivery begins once a device is paired). */
            enabled: boolean;
            /** Which categories push to mobile (mirrors desktop keys). */
            categories: Record<string, boolean>;
            /** Allow starting/pausing/halting agents and approving actions from mobile. */
            agentControls: boolean;
            /** Approve / deny agent actions from the phone. */
            approveFromMobile: boolean;
            /** Start new agent runs from mobile. */
            startAgents: boolean;
            /** Pause / resume running agents from mobile. */
            pauseResumeAgents: boolean;
            /** Halt (force-stop) agents from mobile. */
            haltAgents: boolean;
            /** View live agent status + recent logs on mobile. */
            viewAgentStatus: boolean;
            /** Only push high-priority events (errors, approvals, budget) to mobile. */
            criticalOnly: boolean;
            /** Vibrate on mobile alerts. */
            vibrate: boolean;
            /** Show a preview of the notification body on the lock screen. */
            showPreview: boolean;
            /** Badge the mobile app icon with unread alert count. */
            badgeCount: boolean;
        };
    };
    /** Agent execution engine selection (Claude Agent SDK / Codex CLI / Gemini CLI vs Coretex's universal loop). */
    agentRuntime: {
        /** How Claude-runtime agents authenticate (creds in vault/env). */
        claudeAuth: "anthropic-api" | "bedrock" | "vertex" | "azure";
        /** Route Claude (anthropic) agents through the Claude Agent SDK. Off → universal loop for all. */
        useClaudeSdkForClaude: boolean;
        /** Route OpenAI agents through Codex CLI when the provider's auth mode is "subscription" (ChatGPT Plus/Pro/Team). Off → universal loop even under plan auth. */
        useCodexCliForOpenAI: boolean;
        /** Route Gemini agents through Gemini CLI when the provider's auth mode is "subscription" (Google AI Pro/Ultra). Off → universal loop even under plan auth. */
        useGeminiCliForGemini: boolean;
        /** Engine for non-Claude providers (pluggable; only "universal" today). */
        defaultNonClaudeRuntime: "universal";
    };
    /** Chat composer: inject a capability manifest by default + per-conversation attached scope. */
    composer: {
        /** When true, the AI receives a compact capability manifest (names/categories only, no secrets). */
        defaultAwareness: boolean;
        /** Allow Auto/Bypass permission modes to call integrations without per-call prompts (admin gate). */
        allowAutoBypass: boolean;
        /** Per-conversation attached scope, keyed by chat id (project id, or "global"). */
        conversationScope: Record<string, ConversationScope>;
    };
    /** Terminal Buddy — the shell-aware command assistant attached to terminals. */
    terminalBuddy: {
        enabled: boolean;
        /** Empty string = inherit the global default model. */
        defaultModel: string;
        /** Empty string = inherit the global default provider. */
        defaultProvider: string;
        /** Default operating mode for new buddies. */
        defaultMode: "suggest" | "auto";
        /** Max automatic recovery attempts per failing step. */
        maxRetries: number;
        /** Allow the buddy to use web search when reasoning about commands. */
        webSearch: boolean;
        /** Always require explicit confirmation for destructive commands (even in auto mode). */
        alwaysConfirmDestructive: boolean;
        /** Probe the environment automatically when a terminal opens. */
        probeOnStart: boolean;
        /** Where the buddy UI bar docks relative to the terminal. */
        buddyBarPosition: "bottom" | "side";
        /** Per-terminal overrides, keyed by terminal session id. */
        perTerminal: Record<string, { enabled?: boolean; model?: string; provider?: string; mode?: "suggest" | "auto" }>;
    };
    /** Terminal autocomplete — fish-style ghost text + completion dropdown. */
    autocomplete: AutocompleteConfig;
    /**
     * Speech-to-text (microphone). Uses the browser Web Speech API when available.
     * Surfaces: Ask AI chat, command-center Ask bar, Terminal Buddy, project chat.
     */
    speech: {
        enabled: boolean;
        /** BCP-47 language tag for recognition (e.g. "en-US"). Empty = browser default. */
        language: string;
        /** Hold-to-talk when true; click to toggle continuous listen when false. */
        pushToTalk: boolean;
        /** Append a space before new transcripts when the field already has text. */
        autoSpace: boolean;
        showInAskAi: boolean;
        showInCommandBar: boolean;
        showInTerminalBuddy: boolean;
        showInProjectChat: boolean;
        /** When true, final transcripts can also be typed into the focused terminal PTY. */
        injectIntoTerminal: boolean;
    };
    /** File manager view preferences. */
    filesView: {
        defaultView: "columns" | "table" | "grid";
        density: "comfortable" | "compact";
        showHidden: boolean;
        sortBy: "name" | "modified" | "size" | "type";
        sortDir: "asc" | "desc";
        confirmDelete: boolean;
        gridSize: number;
        /** Show git status emblems when inside a repository. */
        showGitStatus: boolean;
        showSizeColumn: boolean;
        showModifiedColumn: boolean;
        showTypeColumn: boolean;
        /** Single-click opens entries; double-click only selects. */
        openOn: "single-click" | "double-click";
        /** Space bar quick-look preview overlay. */
        enableQuickLook: boolean;
        defaultSearchScope: "folder" | "index";
        /** Locations sidebar width in pixels. */
        sidebarWidth: number;
        /** Explorer listing width when the editor panel is open. */
        listingWidthWhenEditorOpen: number;
        editorWordWrap: boolean;
        editorFontSize: number;
        editorMinimap: boolean;
        /** Hide common heavy folders (node_modules, .git, dist, …). */
        hideSystemFolders: boolean;
        /** Comma- or newline-separated names/globs to hide from listings (e.g. *.log, .DS_Store). */
        hidePatterns: string;
    };
}

/** Schema version, bumped when the shape changes so the store can migrate. */
export const CONFIG_VERSION = 1;
