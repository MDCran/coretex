// Coretex — config store. Owns the authoritative CoretexConfig: load/merge over
// defaults, validate + enforce cross-setting invariants, persist to disk, and
// broadcast changes. Secrets are kept in a separate file, never in settings.json.

import { EventEmitter } from "eventemitter3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG_VERSION, type CoretexConfig, type ConversationScope } from "./schema.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { protectedStorageInfo, readProtectedJson, writeProtectedJson, type ProtectedStorageInfo } from "../security/protected-file.js";

export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep-merge `patch` into `base` (arrays are replaced wholesale, not merged). */
function deepMerge<T>(base: T, patch: unknown): T {
    if (!isPlainObject(base) || !isPlainObject(patch)) {
        return (patch === undefined ? base : (patch as T));
    }
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
    }
    return out as T;
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

export class ConfigStore extends EventEmitter {
    private config: CoretexConfig;
    private secrets: Record<string, string> = {};
    private secretSaveQueue: Promise<void> = Promise.resolve();
    private readonly dir: string;

    constructor(dataDir: string) {
        super();
        this.dir = dataDir;
        this.config = structuredCloneConfig(DEFAULT_CONFIG);
    }

    private settingsFile(): string {
        return path.join(this.dir, "settings.json");
    }
    private secretsFile(): string {
        return path.join(this.dir, "secrets.json");
    }

    async load(): Promise<CoretexConfig> {
        await mkdir(this.dir, { recursive: true });
        try {
            const raw = await readFile(this.settingsFile(), "utf8");
            const parsed = JSON.parse(raw) as { version?: number; config?: unknown };
            const incoming = parsed.config ?? parsed; // tolerate a bare config object
            this.config = this.normalize(deepMerge(structuredCloneConfig(DEFAULT_CONFIG), incoming));
        } catch {
            this.config = structuredCloneConfig(DEFAULT_CONFIG);
        }
        let migrateSecrets = false;
        try {
            const loaded = await readProtectedJson<Record<string, string>>(this.secretsFile());
            this.secrets = loaded.value;
            migrateSecrets = loaded.needsMigration;
        } catch {
            this.secrets = {};
        }
        if (migrateSecrets) await this.saveSecrets();
        // Create/refresh settings.json on first run (and after default migrations).
        await this.save();
        return this.config;
    }

    get(): CoretexConfig {
        return this.config;
    }

    /** Merge a partial patch, enforce invariants, persist, and broadcast. */
    async update(patch: DeepPartial<CoretexConfig>): Promise<CoretexConfig> {
        this.config = this.normalize(deepMerge(this.config, patch));
        await this.save();
        this.emit("change", this.config);
        return this.config;
    }

    /** Set one value by dot path (e.g. "appearance.application.theme"). */
    async setByPath(dotPath: string, value: unknown): Promise<CoretexConfig> {
        const keys = dotPath.split(".");
        const patch: Record<string, unknown> = {};
        let cursor = patch;
        keys.forEach((k, i) => {
            if (i === keys.length - 1) cursor[k] = value;
            else cursor = (cursor[k] = {}) as Record<string, unknown>;
        });
        return this.update(patch as DeepPartial<CoretexConfig>);
    }

    /**
     * Replace (or clear) a conversation's composer scope WHOLESALE. deepMerge can't delete keys
     * (and JSON.stringify drops `undefined`), so removing the env scope must go through here, not
     * setByPath. Sanitizes to the known shape; an empty scope deletes the entry (no settings bloat).
     */
    async setConversationScope(chatId: string, scope: ConversationScope): Promise<CoretexConfig> {
        if (!this.config.composer || typeof this.config.composer !== "object") {
            this.config.composer = { ...DEFAULT_CONFIG.composer, conversationScope: {} };
        }
        const map = this.config.composer.conversationScope;
        const clean: ConversationScope = {
            integrationIds: Array.isArray(scope?.integrationIds) ? scope.integrationIds.filter((x): x is string => typeof x === "string") : [],
            context: Array.isArray(scope?.context)
                ? scope.context.filter((c) => c && typeof c.path === "string").map((c) => ({ kind: c.kind === "folder" || c.kind === "doc" ? c.kind : "file", path: String(c.path), label: String(c.label ?? c.path) }))
                : [],
        };
        if (scope?.envScope && typeof scope.envScope.environmentId === "string") {
            clean.envScope = {
                projectId: String(scope.envScope.projectId ?? ""),
                environmentId: String(scope.envScope.environmentId),
                environment: String(scope.envScope.environment ?? ""),
                varNames: Array.isArray(scope.envScope.varNames) ? scope.envScope.varNames.filter((x): x is string => typeof x === "string") : undefined,
            };
        }
        const empty = clean.integrationIds.length === 0 && !clean.envScope && clean.context.length === 0;
        if (empty) delete map[chatId];
        else map[chatId] = clean;
        this.config = this.normalize(this.config);
        await this.save();
        this.emit("change", this.config);
        return this.config;
    }

    /** Reset to defaults. Optionally keep user profiles + custom color schemes. */
    async reset(opts?: { keepProfilesAndSchemes?: boolean }): Promise<CoretexConfig> {
        const keep = opts?.keepProfilesAndSchemes === true;
        const profiles = keep ? this.config.profiles : DEFAULT_CONFIG.profiles;
        const userSchemes = keep ? this.config.colorSchemes.filter((s) => !s.builtIn) : [];
        this.config = structuredCloneConfig(DEFAULT_CONFIG);
        this.config.profiles = profiles;
        this.config.colorSchemes = [...DEFAULT_CONFIG.colorSchemes, ...userSchemes];
        await this.save();
        this.emit("change", this.config);
        return this.config;
    }

    // ---- Secrets (Windows DPAPI; restrictive file fallback elsewhere) ----
    async setSecret(key: string, value: string): Promise<void> {
        this.secrets[key] = value;
        await this.saveSecrets();
    }
    getSecret(key: string): string | undefined {
        return this.secrets[key];
    }
    hasSecret(key: string): boolean {
        return typeof this.secrets[key] === "string" && this.secrets[key].length > 0;
    }
    /** Values only, for the process-level output redactor. Never exposed over the bridge. */
    secretValues(): string[] {
        return Object.values(this.secrets).filter((value) => value.length > 0);
    }
    secretStoreStatus(): ProtectedStorageInfo & { itemCount: number } {
        return {
            ...protectedStorageInfo(),
            itemCount: this.secretValues().length,
        };
    }
    async deleteSecret(key: string): Promise<void> {
        delete this.secrets[key];
        await this.saveSecrets();
    }
    /** Remove every ConfigStore credential and persist an empty protected payload. */
    async clearSecrets(): Promise<number> {
        const cleared = this.secretValues().length;
        this.secrets = {};
        await this.saveSecrets();
        return cleared;
    }

    private async saveSecrets(): Promise<void> {
        const snapshot = { ...this.secrets };
        this.secretSaveQueue = this.secretSaveQueue.catch(() => undefined).then(() => writeProtectedJson(this.secretsFile(), snapshot));
        await this.secretSaveQueue;
    }

    private async save(): Promise<void> {
        await mkdir(this.dir, { recursive: true });
        const payload = JSON.stringify({ version: CONFIG_VERSION, config: this.config }, null, 2);
        await writeFile(this.settingsFile(), payload, "utf8");
    }

    /** Enforce validation + cross-setting invariants (clamps, mirrors). */
    private normalize(cfg: CoretexConfig): CoretexConfig {
        // Launch size clamps to 20..500.
        cfg.startup.launchCols = clamp(Math.round(cfg.startup.launchCols), 20, 500);
        cfg.startup.launchRows = clamp(Math.round(cfg.startup.launchRows), 20, 500);
        // Opacity / sidebar bounds.
        cfg.appearance.coretex.windowOpacity = clamp(cfg.appearance.coretex.windowOpacity, 20, 100);
        cfg.appearance.coretex.blurRadius = clamp(cfg.appearance.coretex.blurRadius, 0, 64);
        cfg.appearance.coretex.sidebarWidth = clamp(cfg.appearance.coretex.sidebarWidth, 160, 420);
        // Backfill sidebar appearance fields (added in a newer version).
        if (cfg.appearance.coretex.sidebarDensity !== "comfortable" && cfg.appearance.coretex.sidebarDensity !== "compact") {
            cfg.appearance.coretex.sidebarDensity = DEFAULT_CONFIG.appearance.coretex.sidebarDensity;
        }
        if (typeof cfg.appearance.coretex.sidebarShowProjects !== "boolean") {
            cfg.appearance.coretex.sidebarShowProjects = DEFAULT_CONFIG.appearance.coretex.sidebarShowProjects;
        }
        // Mirror: startup.onStart === "restore"  <->  session.restore.
        cfg.session.restore = cfg.startup.onStart === "restore";
        // Backfill the active color-scheme pointer (added in a newer version) and
        // drop a dangling pointer to a scheme that no longer exists.
        if (cfg.appearance.application.activeColorScheme === undefined) cfg.appearance.application.activeColorScheme = null;
        // Backfill the app accent color (added in a newer version).
        if (typeof cfg.appearance.application.accent !== "string") cfg.appearance.application.accent = DEFAULT_CONFIG.appearance.application.accent;
        // Backfill missing built-in color schemes (arrays merge wholesale, so an older
        // settings.json won't gain new built-ins like Campbell without re-introducing them).
        if (!Array.isArray(cfg.colorSchemes)) cfg.colorSchemes = [];
        const knownSchemes = new Set(cfg.colorSchemes.map((s) => s.name));
        for (const def of DEFAULT_CONFIG.colorSchemes) {
            if (!knownSchemes.has(def.name)) cfg.colorSchemes.push({ ...def });
        }
        // Campbell is the default scheme: an unset (null) active pointer adopts Campbell when present.
        if (!cfg.appearance.application.activeColorScheme && cfg.colorSchemes.some((s) => s.name === "Campbell")) {
            cfg.appearance.application.activeColorScheme = "Campbell";
        }
        const activeScheme = cfg.appearance.application.activeColorScheme;
        if (activeScheme && !cfg.colorSchemes.some((s) => s.name === activeScheme)) cfg.appearance.application.activeColorScheme = null;
        // Seed a Default terminal profile when the array is empty, and keep defaultProfileId valid.
        if (!Array.isArray(cfg.profiles) || cfg.profiles.length === 0) {
            cfg.profiles = DEFAULT_CONFIG.profiles.map((p) => ({ ...p, appearance: { ...p.appearance } }));
        }
        if (!cfg.startup.defaultProfileId || !cfg.profiles.some((p) => p.id === cfg.startup.defaultProfileId)) {
            cfg.startup.defaultProfileId = cfg.profiles[0]?.id ?? null;
        }
        // Backfill notification mobile agent-control prefs + new categories for older settings.json.
        if (!cfg.notifications.mobile || typeof cfg.notifications.mobile !== "object") {
            cfg.notifications.mobile = { ...DEFAULT_CONFIG.notifications.mobile, categories: { ...DEFAULT_CONFIG.notifications.mobile.categories } };
        } else {
            const m = cfg.notifications.mobile;
            const dm = DEFAULT_CONFIG.notifications.mobile;
            if (typeof m.approveFromMobile !== "boolean") m.approveFromMobile = dm.approveFromMobile;
            if (typeof m.startAgents !== "boolean") m.startAgents = dm.startAgents;
            if (typeof m.pauseResumeAgents !== "boolean") m.pauseResumeAgents = dm.pauseResumeAgents;
            if (typeof m.haltAgents !== "boolean") m.haltAgents = dm.haltAgents;
            if (typeof m.viewAgentStatus !== "boolean") m.viewAgentStatus = dm.viewAgentStatus;
            if (typeof m.showPreview !== "boolean") m.showPreview = dm.showPreview;
            if (typeof m.badgeCount !== "boolean") m.badgeCount = dm.badgeCount;
            if (!m.categories || typeof m.categories !== "object") m.categories = { ...dm.categories };
        }
        // Backfill the Docker compose→project + Database conn→project link maps (newer versions).
        if (cfg.dockerLinks === undefined || cfg.dockerLinks === null || typeof cfg.dockerLinks !== "object") cfg.dockerLinks = {};
        // Backfill remote mesh pairing invite + richer paired-device fields.
        if (!cfg.remote || typeof cfg.remote !== "object") {
            cfg.remote = structuredCloneConfig(DEFAULT_CONFIG).remote;
        } else {
            if (!cfg.remote.mesh || typeof cfg.remote.mesh !== "object") {
                cfg.remote.mesh = { enabled: false, pairedDevices: [], pairingInvite: null };
            } else {
                if (typeof cfg.remote.mesh.enabled !== "boolean") cfg.remote.mesh.enabled = false;
                if (!Array.isArray(cfg.remote.mesh.pairedDevices)) cfg.remote.mesh.pairedDevices = [];
                if (cfg.remote.mesh.pairingInvite === undefined) cfg.remote.mesh.pairingInvite = null;
            }
            if (!Array.isArray(cfg.remote.sshHosts)) cfg.remote.sshHosts = [];
            if (!Array.isArray(cfg.remote.integrations)) cfg.remote.integrations = [];
        }
        // Backfill Docker engine settings for older settings.json files.
        if (!cfg.docker || typeof cfg.docker !== "object") {
            cfg.docker = structuredCloneConfig(DEFAULT_CONFIG).docker;
        } else {
            const d = cfg.docker;
            const def = DEFAULT_CONFIG.docker;
            if (typeof d.enabled !== "boolean") d.enabled = def.enabled;
            if (typeof d.socketPath !== "string") d.socketPath = def.socketPath;
            if (typeof d.host !== "string") d.host = def.host;
            if (typeof d.tlsVerify !== "boolean") d.tlsVerify = def.tlsVerify;
            if (typeof d.autoRefresh !== "boolean") d.autoRefresh = def.autoRefresh;
            if (typeof d.pollIntervalSec !== "number" || Number.isNaN(d.pollIntervalSec)) d.pollIntervalSec = def.pollIntervalSec;
            d.pollIntervalSec = clamp(Math.round(d.pollIntervalSec), 3, 60);
            if (typeof d.showStoppedContainers !== "boolean") d.showStoppedContainers = def.showStoppedContainers;
            if (typeof d.confirmDestructive !== "boolean") d.confirmDestructive = def.confirmDestructive;
            if (!d.pruneDefaults || typeof d.pruneDefaults !== "object") {
                d.pruneDefaults = { ...def.pruneDefaults };
            } else {
                const p = d.pruneDefaults;
                if (typeof p.containers !== "boolean") p.containers = def.pruneDefaults.containers;
                if (typeof p.images !== "boolean") p.images = def.pruneDefaults.images;
                if (typeof p.volumes !== "boolean") p.volumes = def.pruneDefaults.volumes;
                if (typeof p.networks !== "boolean") p.networks = def.pruneDefaults.networks;
                if (typeof p.buildCache !== "boolean") p.buildCache = def.pruneDefaults.buildCache;
            }
            if (!Array.isArray(d.registries)) d.registries = [];
            else {
                d.registries = d.registries.filter((r) => r && typeof r === "object" && typeof r.id === "string").map((r) => ({
                    id: r.id,
                    name: typeof r.name === "string" ? r.name : r.id,
                    url: typeof r.url === "string" ? r.url : "",
                    kind: (["dockerhub", "ghcr", "ecr", "gcr", "gar", "acr", "quay", "gitlab", "custom"] as const).includes(r.kind as never)
                        ? r.kind
                        : "custom",
                    username: typeof r.username === "string" ? r.username : undefined,
                    passwordConfigured: r.passwordConfigured === true,
                    awsRegion: typeof r.awsRegion === "string" ? r.awsRegion : undefined,
                    awsProfile: typeof r.awsProfile === "string" ? r.awsProfile : undefined,
                }));
            }
        }
        // Whitelist persisted database fields. In particular, never allow a renderer
        // patch to smuggle a plaintext password into settings.json; credentials live
        // only under db.<connectionId>.password in the protected secret store.
        if (!cfg.database || typeof cfg.database !== "object") {
            cfg.database = structuredCloneConfig(DEFAULT_CONFIG).database;
        } else {
            if (typeof cfg.database.defaultStore !== "string") cfg.database.defaultStore = DEFAULT_CONFIG.database.defaultStore;
            const engines = new Set(["sqlite", "postgres", "mysql", "mariadb", "mongo", "redis"]);
            cfg.database.connections = (Array.isArray(cfg.database.connections) ? cfg.database.connections : [])
                .filter((connection) => connection && typeof connection === "object" && typeof connection.id === "string" && connection.id.trim().length > 0)
                .slice(0, 200)
                .map((connection) => {
                    const engine = engines.has(String(connection.engine)) ? connection.engine : "sqlite";
                    const port = typeof connection.port === "number" && Number.isInteger(connection.port)
                        ? clamp(connection.port, 1, 65_535)
                        : undefined;
                    return {
                        id: connection.id.slice(0, 200),
                        name: typeof connection.name === "string" && connection.name.trim() ? connection.name.trim().slice(0, 200) : connection.id.slice(0, 200),
                        engine,
                        host: typeof connection.host === "string" ? connection.host.trim().slice(0, 500) : undefined,
                        port,
                        database: engine === "redis"
                            ? (typeof connection.database === "string" && /^\d+$/.test(connection.database.trim()) ? connection.database.trim().slice(0, 10) : "0")
                            : typeof connection.database === "string" ? connection.database.trim().slice(0, 2_000) : undefined,
                        user: typeof connection.user === "string" ? connection.user.trim().slice(0, 500) : undefined,
                        passwordConfigured: connection.passwordConfigured === true,
                        ssl: engine === "sqlite" ? undefined : connection.ssl === true,
                    };
                });
        }
        if (cfg.databaseLinks === undefined || cfg.databaseLinks === null || typeof cfg.databaseLinks !== "object") cfg.databaseLinks = {};
        // Backfill collections added in newer versions. Arrays are replaced
        // wholesale on merge, so a provider/server added to the defaults won't
        // appear in an older settings.json unless we re-introduce it here.
        const knownProviders = new Set(cfg.aiProviders.map((p) => p.provider));
        for (const def of DEFAULT_CONFIG.aiProviders) {
            if (!knownProviders.has(def.provider)) {
                cfg.aiProviders.push({ ...def });
            }
        }
        // Backfill Anthropic authMode: prefer Claude Pro/Max plan when no API key is set.
        for (const p of cfg.aiProviders) {
            if (p.provider !== "anthropic") continue;
            if (p.authMode !== "api-key" && p.authMode !== "claude-plan") {
                p.authMode = p.keyConfigured ? "api-key" : "claude-plan";
            }
        }
        // Backfill new coding harnesses (e.g. OpenClaw) into older settings files.
        if (Array.isArray(cfg.codingAgents)) {
            const knownHarness = new Set(cfg.codingAgents.map((h) => h.id));
            for (const def of DEFAULT_CONFIG.codingAgents) {
                if (!knownHarness.has(def.id)) cfg.codingAgents.push({ ...def });
            }
        }
        if (!Array.isArray(cfg.codingAgents) || cfg.codingAgents.length === 0) {
            cfg.codingAgents = DEFAULT_CONFIG.codingAgents.map((h) => ({ ...h }));
        }
        if (!Array.isArray(cfg.mcpBuiltIns) || cfg.mcpBuiltIns.length === 0) {
            cfg.mcpBuiltIns = DEFAULT_CONFIG.mcpBuiltIns.map((s) => ({ ...s }));
        }
        // Backfill the agent-runtime block for older settings.json files.
        if (!cfg.agentRuntime || typeof cfg.agentRuntime !== "object") {
            cfg.agentRuntime = { ...DEFAULT_CONFIG.agentRuntime };
        } else {
            if (!cfg.agentRuntime.claudeAuth) cfg.agentRuntime.claudeAuth = DEFAULT_CONFIG.agentRuntime.claudeAuth;
            if (typeof cfg.agentRuntime.useClaudeSdkForClaude !== "boolean") cfg.agentRuntime.useClaudeSdkForClaude = DEFAULT_CONFIG.agentRuntime.useClaudeSdkForClaude;
            if (typeof cfg.agentRuntime.useCodexCliForOpenAI !== "boolean") cfg.agentRuntime.useCodexCliForOpenAI = DEFAULT_CONFIG.agentRuntime.useCodexCliForOpenAI;
            if (typeof cfg.agentRuntime.useGeminiCliForGemini !== "boolean") cfg.agentRuntime.useGeminiCliForGemini = DEFAULT_CONFIG.agentRuntime.useGeminiCliForGemini;
            cfg.agentRuntime.defaultNonClaudeRuntime = "universal";
        }
        // Backfill the composer block for settings.json files written before it existed.
        if (!cfg.composer || typeof cfg.composer !== "object") {
            cfg.composer = { ...DEFAULT_CONFIG.composer, conversationScope: {} };
        } else {
            if (typeof cfg.composer.defaultAwareness !== "boolean") cfg.composer.defaultAwareness = DEFAULT_CONFIG.composer.defaultAwareness;
            if (typeof cfg.composer.allowAutoBypass !== "boolean") cfg.composer.allowAutoBypass = DEFAULT_CONFIG.composer.allowAutoBypass;
            if (!cfg.composer.conversationScope || typeof cfg.composer.conversationScope !== "object") cfg.composer.conversationScope = {};
        }
        // Backfill and sanitize terminal security controls. Command patterns are
        // literal fragments; cap their count/length so a corrupted settings file
        // cannot turn policy evaluation into an unbounded hot path.
        if (!cfg.security || typeof cfg.security !== "object") {
            cfg.security = { ...DEFAULT_CONFIG.security, denylist: [...DEFAULT_CONFIG.security.denylist], allowlist: [] };
        } else {
            const security = cfg.security;
            const def = DEFAULT_CONFIG.security;
            if (security.autonomousTerminal !== "off" && security.autonomousTerminal !== "approval" && security.autonomousTerminal !== "auto") {
                security.autonomousTerminal = def.autonomousTerminal;
            }
            const cleanPatterns = (value: unknown): string[] =>
                Array.isArray(value)
                    ? value
                          .filter((item): item is string => typeof item === "string")
                          .map((item) => item.trim().slice(0, 500))
                          .filter(Boolean)
                          .slice(0, 500)
                    : [];
            security.denylist = cleanPatterns(security.denylist);
            security.allowlist = cleanPatterns(security.allowlist);
            if (typeof security.maxCommandLength !== "number" || !Number.isFinite(security.maxCommandLength)) {
                security.maxCommandLength = def.maxCommandLength;
            }
            security.maxCommandLength = clamp(Math.round(security.maxCommandLength), 256, 65_536);
            if (typeof security.telemetry !== "boolean") security.telemetry = def.telemetry;
            if (typeof security.crashReports !== "boolean") security.crashReports = def.crashReports;
            if (typeof security.redactSecrets !== "boolean") security.redactSecrets = def.redactSecrets;
            if (typeof security.dailyCostLimitUSD !== "number" || !Number.isFinite(security.dailyCostLimitUSD)) {
                security.dailyCostLimitUSD = def.dailyCostLimitUSD;
            }
            security.dailyCostLimitUSD = Math.max(0, security.dailyCostLimitUSD);
        }
        // Backfill the Terminal Buddy block for settings.json files written before it existed.
        if (!cfg.terminalBuddy || typeof cfg.terminalBuddy !== "object") {
            cfg.terminalBuddy = { ...DEFAULT_CONFIG.terminalBuddy, perTerminal: {} };
        } else {
            const tb = cfg.terminalBuddy;
            const def = DEFAULT_CONFIG.terminalBuddy;
            if (typeof tb.enabled !== "boolean") tb.enabled = def.enabled;
            if (typeof tb.defaultModel !== "string") tb.defaultModel = def.defaultModel;
            if (typeof tb.defaultProvider !== "string") tb.defaultProvider = def.defaultProvider;
            if (tb.defaultMode !== "suggest" && tb.defaultMode !== "auto") tb.defaultMode = def.defaultMode;
            if (typeof tb.maxRetries !== "number") tb.maxRetries = def.maxRetries;
            if (typeof tb.webSearch !== "boolean") tb.webSearch = def.webSearch;
            if (typeof tb.alwaysConfirmDestructive !== "boolean") tb.alwaysConfirmDestructive = def.alwaysConfirmDestructive;
            if (typeof tb.probeOnStart !== "boolean") tb.probeOnStart = def.probeOnStart;
            if (tb.buddyBarPosition !== "bottom" && tb.buddyBarPosition !== "side") tb.buddyBarPosition = def.buddyBarPosition;
            if (!tb.perTerminal || typeof tb.perTerminal !== "object") tb.perTerminal = {};
        }
        // Backfill the terminal-autocomplete block for settings.json files written before it existed.
        if (!cfg.autocomplete || typeof cfg.autocomplete !== "object") {
            cfg.autocomplete = { ...DEFAULT_CONFIG.autocomplete, providers: { ...DEFAULT_CONFIG.autocomplete.providers } };
        } else {
            const ac = cfg.autocomplete;
            const def = DEFAULT_CONFIG.autocomplete;
            if (typeof ac.enabled !== "boolean") ac.enabled = def.enabled;
            if (typeof ac.ghostText !== "boolean") ac.ghostText = def.ghostText;
            if (typeof ac.dropdown !== "boolean") ac.dropdown = def.dropdown;
            if (!ac.providers || typeof ac.providers !== "object") {
                ac.providers = { ...def.providers };
            } else {
                const p = ac.providers;
                const dp = def.providers;
                if (typeof p.history !== "boolean") p.history = dp.history;
                if (typeof p.path !== "boolean") p.path = dp.path;
                if (typeof p.specs !== "boolean") p.specs = dp.specs;
                if (typeof p.pathExecutables !== "boolean") p.pathExecutables = dp.pathExecutables;
                if (typeof p.ai !== "boolean") p.ai = dp.ai;
            }
            if (ac.nativeTabFallback !== "never" && ac.nativeTabFallback !== "when-no-suggestion" && ac.nativeTabFallback !== "always") {
                ac.nativeTabFallback = def.nativeTabFallback;
            }
            if (typeof ac.debounceMs !== "number" || Number.isNaN(ac.debounceMs)) ac.debounceMs = def.debounceMs;
            ac.debounceMs = clamp(Math.round(ac.debounceMs), 0, 2000);
        }
        // Backfill speech-to-text / microphone block for older settings.json files.
        if (!cfg.speech || typeof cfg.speech !== "object") {
            cfg.speech = { ...DEFAULT_CONFIG.speech };
        } else {
            const sp = cfg.speech;
            const def = DEFAULT_CONFIG.speech;
            if (typeof sp.enabled !== "boolean") sp.enabled = def.enabled;
            if (typeof sp.language !== "string") sp.language = def.language;
            if (typeof sp.pushToTalk !== "boolean") sp.pushToTalk = def.pushToTalk;
            if (typeof sp.autoSpace !== "boolean") sp.autoSpace = def.autoSpace;
            if (typeof sp.showInAskAi !== "boolean") sp.showInAskAi = def.showInAskAi;
            if (typeof sp.showInCommandBar !== "boolean") sp.showInCommandBar = def.showInCommandBar;
            if (typeof sp.showInTerminalBuddy !== "boolean") sp.showInTerminalBuddy = def.showInTerminalBuddy;
            if (typeof sp.showInProjectChat !== "boolean") sp.showInProjectChat = def.showInProjectChat;
            if (typeof sp.injectIntoTerminal !== "boolean") sp.injectIntoTerminal = def.injectIntoTerminal;
        }
        // Backfill the files-view block for settings.json files written before it existed.
        if (!cfg.filesView || typeof cfg.filesView !== "object") {
            cfg.filesView = { ...DEFAULT_CONFIG.filesView };
        } else {
            const fv = cfg.filesView;
            const def = DEFAULT_CONFIG.filesView;
            if (fv.defaultView !== "columns" && fv.defaultView !== "table" && fv.defaultView !== "grid") fv.defaultView = def.defaultView;
            if (fv.density !== "comfortable" && fv.density !== "compact") fv.density = def.density;
            if (typeof fv.showHidden !== "boolean") fv.showHidden = def.showHidden;
            if (fv.sortBy !== "name" && fv.sortBy !== "modified" && fv.sortBy !== "size" && fv.sortBy !== "type") fv.sortBy = def.sortBy;
            if (fv.sortDir !== "asc" && fv.sortDir !== "desc") fv.sortDir = def.sortDir;
            if (typeof fv.confirmDelete !== "boolean") fv.confirmDelete = def.confirmDelete;
            if (typeof fv.gridSize !== "number" || Number.isNaN(fv.gridSize)) fv.gridSize = def.gridSize;
            fv.gridSize = clamp(Math.round(fv.gridSize), 48, 256);
            if (typeof fv.showGitStatus !== "boolean") fv.showGitStatus = def.showGitStatus;
            if (typeof fv.showSizeColumn !== "boolean") fv.showSizeColumn = def.showSizeColumn;
            if (typeof fv.showModifiedColumn !== "boolean") fv.showModifiedColumn = def.showModifiedColumn;
            if (typeof fv.showTypeColumn !== "boolean") fv.showTypeColumn = def.showTypeColumn;
            if (fv.openOn !== "single-click" && fv.openOn !== "double-click") fv.openOn = def.openOn;
            if (typeof fv.enableQuickLook !== "boolean") fv.enableQuickLook = def.enableQuickLook;
            if (fv.defaultSearchScope !== "folder" && fv.defaultSearchScope !== "index") fv.defaultSearchScope = def.defaultSearchScope;
            if (typeof fv.sidebarWidth !== "number" || Number.isNaN(fv.sidebarWidth)) fv.sidebarWidth = def.sidebarWidth;
            fv.sidebarWidth = clamp(Math.round(fv.sidebarWidth), 160, 360);
            if (typeof fv.listingWidthWhenEditorOpen !== "number" || Number.isNaN(fv.listingWidthWhenEditorOpen)) fv.listingWidthWhenEditorOpen = def.listingWidthWhenEditorOpen;
            fv.listingWidthWhenEditorOpen = clamp(Math.round(fv.listingWidthWhenEditorOpen), 260, 560);
            if (typeof fv.editorWordWrap !== "boolean") fv.editorWordWrap = def.editorWordWrap;
            if (typeof fv.editorFontSize !== "number" || Number.isNaN(fv.editorFontSize)) fv.editorFontSize = def.editorFontSize;
            fv.editorFontSize = clamp(Math.round(fv.editorFontSize), 10, 22);
            if (typeof fv.editorMinimap !== "boolean") fv.editorMinimap = def.editorMinimap;
            if (typeof fv.hideSystemFolders !== "boolean") fv.hideSystemFolders = def.hideSystemFolders;
            if (typeof fv.hidePatterns !== "string") fv.hidePatterns = def.hidePatterns;
        }
        // Acrylic chain: dependents are no-ops when acrylic is off (kept in config, gated in UI).
        return cfg;
    }
}

function structuredCloneConfig(cfg: CoretexConfig): CoretexConfig {
    return JSON.parse(JSON.stringify(cfg)) as CoretexConfig;
}
