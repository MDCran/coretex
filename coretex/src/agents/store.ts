// Durable, runtime-neutral agent configuration and fleet-canvas persistence.
// This store never owns Agent instances and therefore cannot start, stop, pause,
// resume, deploy, or dispatch work. It only validates and saves configuration and
// presentation state under the configured Coretex data directory.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
    AgentCanvasPoint,
    AgentCanvasCardSettings,
    AgentCanvasState,
    AgentConfig,
    AgentRole,
    ClaudeExecutionMode,
    PermissionMode,
    ProviderType,
    VisualIdentity,
} from "../types.js";

const STORE_VERSION = 1;
const MAX_COORDINATE = 1_000_000;
const MAX_CANVAS_NODES = 1_000;

const ROLES = new Set<AgentRole>([
    "orchestrator", "planner", "researcher", "developer", "reviewer",
    "writer", "analyst", "devops", "qa", "custom",
]);
const PROVIDERS = new Set<ProviderType>(["ollama", "lmstudio", "openai", "anthropic", "gemini", "openrouter", "openclaw"]);
const PERMISSION_MODES = new Set<PermissionMode>(["ask", "accept-edits", "plan", "auto", "bypass"]);
const EXECUTION_MODES = new Set<ClaudeExecutionMode>(["conversational", "assisted", "autonomous"]);

const MUTABLE_AGENT_FIELDS = new Set<keyof AgentConfig>([
    "name",
    "role",
    "provider",
    "model",
    "systemPrompt",
    "temperature",
    "maxTokensPerStep",
    "maxSteps",
    "tokenBudget",
    "dailyTokenBudget",
    "tags",
    "avatarUrl",
    "identity",
    "permissionMode",
    "terminalAccess",
    "connectorIds",
    "mcpServerIds",
    "skills",
    "executionMode",
]);

interface AgentStoreDocument {
    version: number;
    agents: AgentConfig[];
    canvas: AgentCanvasState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function boundedString(value: unknown, label: string, maxLength: number, options?: { trim?: boolean; allowEmpty?: boolean }): string {
    if (typeof value !== "string") throw new Error(`${label} must be text.`);
    const normalized = options?.trim === false ? value : value.trim();
    if (!options?.allowEmpty && !normalized) throw new Error(`${label} is required.`);
    if (normalized.length > maxLength) throw new Error(`${label} must be ${maxLength.toLocaleString()} characters or fewer.`);
    return normalized;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new Error(`${label} must be a whole number.`);
    }
    if (value < minimum || value > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
    return value;
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
    if (value < minimum || value > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
    return value;
}

function stringList(value: unknown, label: string, maximumItems = 256): string[] {
    if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
    if (value.length > maximumItems) throw new Error(`${label} may contain at most ${maximumItems} entries.`);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
        const clean = boundedString(entry, `${label} entry`, 240);
        if (!seen.has(clean)) {
            seen.add(clean);
            out.push(clean);
        }
    }
    return out;
}

function normalizeIdentity(value: unknown): VisualIdentity {
    if (!isRecord(value) || !isRecord(value.icon)) throw new Error("Agent identity is invalid.");
    const kind = value.icon.kind;
    let icon: VisualIdentity["icon"];
    if (kind === "untitled-ui") {
        icon = { kind, name: boundedString(value.icon.name, "Identity icon name", 120) };
    } else if (kind === "upload") {
        icon = { kind, url: boundedString(value.icon.url, "Identity upload", 8_000_000, { trim: false }) };
    } else if (kind === "brand") {
        icon = { kind, domain: boundedString(value.icon.domain, "Identity brand domain", 320) };
    } else {
        throw new Error("Agent identity icon kind is unsupported.");
    }
    return { icon, themeColor: boundedString(value.themeColor, "Identity theme color", 80) };
}

function normalizeSkills(value: unknown): AgentConfig["skills"] {
    if (!Array.isArray(value)) throw new Error("Agent skills must be a list.");
    if (value.length > 64) throw new Error("An agent may have at most 64 skills.");
    return value.map((entry, index) => {
        if (!isRecord(entry)) throw new Error(`Skill ${index + 1} is invalid.`);
        if (typeof entry.enabled !== "boolean") throw new Error(`Skill ${index + 1} enabled must be true or false.`);
        return {
            name: boundedString(entry.name, `Skill ${index + 1} name`, 160),
            content: boundedString(entry.content, `Skill ${index + 1} content`, 250_000, { trim: false, allowEmpty: true }),
            enabled: entry.enabled,
        };
    });
}

function normalizeRole(value: unknown): AgentRole {
    if (typeof value !== "string" || !ROLES.has(value as AgentRole)) throw new Error("Agent role is unsupported.");
    return value as AgentRole;
}

function normalizeProvider(value: unknown): ProviderType {
    if (typeof value !== "string" || !PROVIDERS.has(value as ProviderType)) throw new Error("Agent provider is unsupported.");
    return value as ProviderType;
}

function normalizePermissionMode(value: unknown): PermissionMode {
    if (typeof value !== "string" || !PERMISSION_MODES.has(value as PermissionMode)) throw new Error("Agent permission mode is unsupported.");
    return value as PermissionMode;
}

function normalizeExecutionMode(value: unknown): ClaudeExecutionMode {
    if (typeof value !== "string" || !EXECUTION_MODES.has(value as ClaudeExecutionMode)) throw new Error("Agent execution mode is unsupported.");
    return value as ClaudeExecutionMode;
}

/** Strict allow-list validation for settings edits received over the renderer bridge. */
export function normalizeAgentConfigPatch(value: unknown): Partial<AgentConfig> {
    if (!isRecord(value)) throw new Error("Agent settings patch is invalid.");
    for (const key of Object.keys(value)) {
        if (!MUTABLE_AGENT_FIELDS.has(key as keyof AgentConfig)) {
            throw new Error(`Agent setting ${key} cannot be changed.`);
        }
    }
    const patch: Partial<AgentConfig> = {};
    if (own(value, "name")) patch.name = boundedString(value.name, "Agent name", 120);
    if (own(value, "role")) patch.role = normalizeRole(value.role);
    if (own(value, "provider")) patch.provider = normalizeProvider(value.provider);
    if (own(value, "model")) patch.model = boundedString(value.model, "Agent model", 320);
    if (own(value, "systemPrompt")) patch.systemPrompt = boundedString(value.systemPrompt, "System prompt", 500_000, { trim: false, allowEmpty: true });
    if (own(value, "temperature")) patch.temperature = boundedNumber(value.temperature, "Temperature", 0, 2);
    if (own(value, "maxTokensPerStep")) patch.maxTokensPerStep = boundedInteger(value.maxTokensPerStep, "Tokens per step", 1, 2_000_000);
    if (own(value, "maxSteps")) patch.maxSteps = boundedInteger(value.maxSteps, "Maximum steps", 1, 10_000);
    if (own(value, "tokenBudget")) patch.tokenBudget = boundedInteger(value.tokenBudget, "Token budget", 0, Number.MAX_SAFE_INTEGER);
    if (own(value, "dailyTokenBudget")) patch.dailyTokenBudget = boundedInteger(value.dailyTokenBudget, "Daily token budget", 0, Number.MAX_SAFE_INTEGER);
    if (own(value, "tags")) patch.tags = stringList(value.tags, "Agent tags");
    if (own(value, "avatarUrl")) patch.avatarUrl = boundedString(value.avatarUrl, "Agent avatar", 8_000_000, { trim: false, allowEmpty: true });
    if (own(value, "identity")) patch.identity = normalizeIdentity(value.identity);
    if (own(value, "permissionMode")) patch.permissionMode = normalizePermissionMode(value.permissionMode);
    if (own(value, "terminalAccess")) {
        if (typeof value.terminalAccess !== "boolean") throw new Error("Terminal access must be true or false.");
        patch.terminalAccess = value.terminalAccess;
    }
    if (own(value, "connectorIds")) patch.connectorIds = stringList(value.connectorIds, "Connector ids");
    if (own(value, "mcpServerIds")) patch.mcpServerIds = stringList(value.mcpServerIds, "MCP server ids");
    if (own(value, "skills")) patch.skills = normalizeSkills(value.skills);
    if (own(value, "executionMode")) patch.executionMode = normalizeExecutionMode(value.executionMode);
    return patch;
}

/** Validate a complete persisted AgentConfig and return a detached safe copy. */
export function normalizeAgentConfig(value: unknown): AgentConfig {
    if (!isRecord(value)) throw new Error("Agent configuration is invalid.");
    const id = boundedString(value.id, "Agent id", 200);
    if (!/^[A-Za-z0-9._:-]+$/.test(id) || id === "__proto__" || id === "prototype" || id === "constructor") {
        throw new Error("Agent id contains unsupported characters.");
    }
    const required: AgentConfig = {
        id,
        name: boundedString(value.name, "Agent name", 120),
        role: normalizeRole(value.role),
        provider: normalizeProvider(value.provider),
        model: boundedString(value.model, "Agent model", 320),
        systemPrompt: boundedString(value.systemPrompt, "System prompt", 500_000, { trim: false, allowEmpty: true }),
        temperature: boundedNumber(value.temperature, "Temperature", 0, 2),
        maxTokensPerStep: boundedInteger(value.maxTokensPerStep, "Tokens per step", 1, 2_000_000),
        maxSteps: boundedInteger(value.maxSteps, "Maximum steps", 1, 10_000),
        tokenBudget: boundedInteger(value.tokenBudget, "Token budget", 0, Number.MAX_SAFE_INTEGER),
        dailyTokenBudget: boundedInteger(value.dailyTokenBudget, "Daily token budget", 0, Number.MAX_SAFE_INTEGER),
    };
    const optional = normalizeAgentConfigPatch(Object.fromEntries(
        Object.entries(value).filter(([key, entry]) => entry !== undefined && key !== "id" && ![
            "name", "role", "provider", "model", "systemPrompt", "temperature",
            "maxTokensPerStep", "maxSteps", "tokenBudget", "dailyTokenBudget",
        ].includes(key)),
    ));
    return { ...required, ...optional };
}

export function normalizeAgentCanvasPoint(value: unknown): AgentCanvasPoint {
    if (!isRecord(value)) throw new Error("Canvas position is invalid.");
    const x = boundedNumber(value.x, "Canvas x coordinate", -MAX_COORDINATE, MAX_COORDINATE);
    const y = boundedNumber(value.y, "Canvas y coordinate", -MAX_COORDINATE, MAX_COORDINATE);
    return { x, y };
}

function normalizePositions(value: unknown, allowedIds?: ReadonlySet<string>): Record<string, AgentCanvasPoint> {
    if (!isRecord(value)) throw new Error("Canvas positions must be an object.");
    const entries = Object.entries(value);
    if (entries.length > MAX_CANVAS_NODES) throw new Error(`Canvas may contain at most ${MAX_CANVAS_NODES} cards.`);
    const positions: Record<string, AgentCanvasPoint> = Object.create(null) as Record<string, AgentCanvasPoint>;
    for (const [id, point] of entries) {
        if (!id || id === "__proto__" || id === "prototype" || id === "constructor") throw new Error("Canvas agent id is invalid.");
        if (allowedIds && !allowedIds.has(id)) throw new Error(`Canvas agent ${id} does not exist.`);
        positions[id] = normalizeAgentCanvasPoint(point);
    }
    return positions;
}

function cloneConfig(config: AgentConfig): AgentConfig {
    return structuredClone(config);
}

function cloneCanvas(state: AgentCanvasState): AgentCanvasState {
    return {
        positions: Object.fromEntries(Object.entries(state.positions).map(([id, point]) => [id, { ...point }])),
        cards: Object.fromEntries(Object.entries(state.cards).map(([id, settings]) => [id, { ...settings }])),
        showConnections: state.showConnections,
        revision: state.revision,
    };
}

function defaultCanvas(): AgentCanvasState {
    return { positions: {}, cards: {}, showConnections: true, revision: 0 };
}

export const DEFAULT_AGENT_CANVAS_CARD_SETTINGS: AgentCanvasCardSettings = {
    density: "detailed",
    accentSource: "identity",
    showModel: true,
    showMetrics: true,
    pinned: false,
};

function normalizeCardSettings(value: unknown, base: AgentCanvasCardSettings = DEFAULT_AGENT_CANVAS_CARD_SETTINGS): AgentCanvasCardSettings {
    if (!isRecord(value)) throw new Error("Card settings patch is invalid.");
    const supported = new Set(["density", "accentSource", "customColor", "showModel", "showMetrics", "pinned"]);
    for (const key of Object.keys(value)) {
        if (!supported.has(key)) throw new Error(`Card setting ${key} is unsupported.`);
    }
    const result: AgentCanvasCardSettings = { ...base };
    if (own(value, "density")) {
        if (value.density !== "compact" && value.density !== "detailed") throw new Error("Card density is unsupported.");
        result.density = value.density;
    }
    if (own(value, "accentSource")) {
        if (value.accentSource !== "identity" && value.accentSource !== "role" && value.accentSource !== "status" && value.accentSource !== "custom") {
            throw new Error("Card accent source is unsupported.");
        }
        result.accentSource = value.accentSource;
    }
    if (own(value, "customColor")) {
        const color = boundedString(value.customColor, "Card custom color", 80, { allowEmpty: true });
        if (color && !/^#[0-9a-f]{3,8}$/i.test(color) && !/^var\(--[a-z0-9_-]+\)$/i.test(color)) {
            throw new Error("Card custom color must be a hex color or theme variable.");
        }
        if (color) result.customColor = color;
        else delete result.customColor;
    }
    for (const key of ["showModel", "showMetrics", "pinned"] as const) {
        if (!own(value, key)) continue;
        if (typeof value[key] !== "boolean") throw new Error(`Card ${key} must be true or false.`);
        result[key] = value[key];
    }
    return result;
}

function normalizeCards(value: unknown, allowedIds?: ReadonlySet<string>): Record<string, AgentCanvasCardSettings> {
    if (!isRecord(value)) return {};
    const cards: Record<string, AgentCanvasCardSettings> = Object.create(null) as Record<string, AgentCanvasCardSettings>;
    for (const [id, settings] of Object.entries(value)) {
        if (allowedIds && !allowedIds.has(id)) continue;
        cards[id] = normalizeCardSettings(settings);
    }
    return cards;
}

/** File-backed store used by Orchestrator and isolated acceptance tests. */
export class AgentPersistenceStore {
    private readonly file: string;
    private readonly configs = new Map<string, AgentConfig>();
    private canvas: AgentCanvasState = defaultCanvas();
    private saveQueue: Promise<void> = Promise.resolve();

    constructor(dataDir: string) {
        this.file = path.join(dataDir, "agents.json");
    }

    async load(): Promise<void> {
        this.configs.clear();
        this.canvas = defaultCanvas();
        try {
            const parsed = JSON.parse(await readFile(this.file, "utf8")) as unknown;
            const rawAgents = Array.isArray(parsed)
                ? parsed
                : isRecord(parsed) && Array.isArray(parsed.agents)
                    ? parsed.agents
                    : [];
            for (const candidate of rawAgents) {
                try {
                    const config = normalizeAgentConfig(candidate);
                    if (!this.configs.has(config.id)) this.configs.set(config.id, config);
                } catch {
                    // Skip malformed records without making every valid agent disappear.
                }
            }
            if (isRecord(parsed) && isRecord(parsed.canvas)) {
                const positions = normalizePositions(parsed.canvas.positions ?? {});
                const showConnections = typeof parsed.canvas.showConnections === "boolean" ? parsed.canvas.showConnections : true;
                const revision = typeof parsed.canvas.revision === "number" && Number.isSafeInteger(parsed.canvas.revision) && parsed.canvas.revision >= 0
                    ? parsed.canvas.revision
                    : 0;
                const ids = new Set(this.configs.keys());
                this.canvas = {
                    positions: Object.fromEntries(Object.entries(positions).filter(([id]) => ids.has(id))),
                    cards: normalizeCards(parsed.canvas.cards ?? {}, ids),
                    showConnections,
                    revision,
                };
            }
        } catch {
            // Missing/malformed file starts from a safe empty state.
        }
    }

    listConfigs(): AgentConfig[] {
        return Array.from(this.configs.values(), cloneConfig);
    }

    getConfig(id: string): AgentConfig | undefined {
        const config = this.configs.get(id);
        return config ? cloneConfig(config) : undefined;
    }

    isEmpty(): boolean {
        return this.configs.size === 0;
    }

    upsertConfig(value: unknown): AgentConfig {
        const config = normalizeAgentConfig(value);
        this.configs.set(config.id, config);
        this.persist();
        return cloneConfig(config);
    }

    updateConfig(id: string, value: unknown): AgentConfig {
        const existing = this.configs.get(id);
        if (!existing) throw new Error("Agent not found.");
        const patch = normalizeAgentConfigPatch(value);
        const updated = normalizeAgentConfig({ ...existing, ...patch, id: existing.id });
        this.configs.set(id, updated);
        this.persist();
        return cloneConfig(updated);
    }

    removeConfig(id: string): boolean {
        const removed = this.configs.delete(id);
        if (!removed) return false;
        if (own(this.canvas.positions, id)) {
            const positions = { ...this.canvas.positions };
            delete positions[id];
            const cards = { ...this.canvas.cards };
            delete cards[id];
            this.canvas = { ...this.canvas, positions, cards, revision: this.canvas.revision + 1 };
        } else if (own(this.canvas.cards, id)) {
            const cards = { ...this.canvas.cards };
            delete cards[id];
            this.canvas = { ...this.canvas, cards, revision: this.canvas.revision + 1 };
        }
        this.persist();
        return true;
    }

    getCanvas(): AgentCanvasState {
        return cloneCanvas(this.canvas);
    }

    setPosition(agentId: string, value: unknown, allowedIds?: ReadonlySet<string>): AgentCanvasState {
        if (allowedIds && !allowedIds.has(agentId)) throw new Error("Agent not found.");
        const point = normalizeAgentCanvasPoint(value);
        this.canvas = {
            ...this.canvas,
            positions: { ...this.canvas.positions, [agentId]: point },
            revision: this.canvas.revision + 1,
        };
        this.persist();
        return this.getCanvas();
    }

    setLayout(value: unknown, allowedIds?: ReadonlySet<string>): AgentCanvasState {
        const positions = normalizePositions(value, allowedIds);
        this.canvas = { ...this.canvas, positions, revision: this.canvas.revision + 1 };
        this.persist();
        return this.getCanvas();
    }

    resetLayout(): AgentCanvasState {
        this.canvas = { ...this.canvas, positions: {}, revision: this.canvas.revision + 1 };
        this.persist();
        return this.getCanvas();
    }

    updatePreferences(value: unknown): AgentCanvasState {
        if (!isRecord(value)) throw new Error("Canvas preferences patch is invalid.");
        for (const key of Object.keys(value)) {
            if (key !== "showConnections") throw new Error(`Canvas preference ${key} is unsupported.`);
        }
        if (!own(value, "showConnections")) return this.getCanvas();
        if (typeof value.showConnections !== "boolean") throw new Error("Show connections must be true or false.");
        this.canvas = { ...this.canvas, showConnections: value.showConnections, revision: this.canvas.revision + 1 };
        this.persist();
        return this.getCanvas();
    }

    updateCard(agentId: string, value: unknown, allowedIds?: ReadonlySet<string>): AgentCanvasState {
        if (allowedIds && !allowedIds.has(agentId)) throw new Error("Agent not found.");
        const current = this.canvas.cards[agentId] ?? DEFAULT_AGENT_CANVAS_CARD_SETTINGS;
        const settings = normalizeCardSettings(value, current);
        this.canvas = {
            ...this.canvas,
            cards: { ...this.canvas.cards, [agentId]: settings },
            revision: this.canvas.revision + 1,
        };
        this.persist();
        return this.getCanvas();
    }

    async flush(): Promise<void> {
        await this.saveQueue;
    }

    private document(): AgentStoreDocument {
        return {
            version: STORE_VERSION,
            agents: this.listConfigs(),
            canvas: this.getCanvas(),
        };
    }

    private persist(): void {
        const snapshot = JSON.stringify(this.document(), null, 2);
        const file = this.file;
        const temp = `${file}.tmp`;
        this.saveQueue = this.saveQueue
            .catch(() => undefined)
            .then(async () => {
                await mkdir(path.dirname(file), { recursive: true });
                await writeFile(temp, snapshot, { encoding: "utf8", mode: 0o600 });
                await rename(temp, file);
            });
    }
}

/**
 * Register persisted definitions in an execution-inert state. Kept as a small
 * exported seam so acceptance tests can prove restore never invokes a provider,
 * dispatcher, resume path, or task runtime.
 */
export function restorePersistedAgentsPaused(
    configs: readonly AgentConfig[],
    registry: {
        get(id: string): { id: string } | undefined;
        add(config: AgentConfig): { id: string; setStatus(status: "paused"): void };
    },
): string[] {
    const restored: string[] = [];
    for (const config of configs) {
        if (registry.get(config.id)) continue;
        const agent = registry.add(cloneConfig(config));
        agent.setStatus("paused");
        restored.push(agent.id);
    }
    return restored;
}
