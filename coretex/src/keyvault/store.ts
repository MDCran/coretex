// Coretex — API key vault + integrations hub. Stores API keys with rich
// metadata, connected service integrations (with MCP/AI-agent tool bindings),
// and an audit log. Persists to protected ~/.coretex/keyvault.json. Key values
// remain local; the UI masks them by default. testKey() makes a real, lightweight,
// rate-limited API call to verify a key is still live for supported services.

import path from "node:path";
import type {
    APIKey,
    AuditEntry,
    ConnectorCredentialInput,
    ConnectorToolAuthorizationDenialCode,
    ConnectorToolAuthorizationInput,
    ConnectorToolAuthorizationResult,
    ServiceConnection,
    ServiceCategory,
    KeyStatus,
    KeyTestResult,
    KeyTestStatus,
    KeyVaultState,
    MCPToolBinding,
} from "../types.js";
import { resolveConnectorToolBinding } from "../connectors/access.js";
import { readProtectedJson, writeProtectedJson } from "../security/protected-file.js";

const DAY = 86_400_000;

function genId(p: string): string {
    return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** "sk-ant-...●●●●●●●●●●●●Xk9p" — first 8 + last 4 visible, middle masked. */
export function maskKey(value: string): string {
    if (!value) return "";
    if (value.length <= 14) return `${value.slice(0, 3)}●●●●●●●●`;
    const head = value.slice(0, 8);
    const tail = value.slice(-4);
    return `${head}●●●●●●●●●●●●${tail}`;
}

/** Derive a display status from expiry + verification, never overriding a hard fail. */
export function deriveStatus(k: APIKey): KeyStatus {
    if (k.expiresAt != null) {
        if (k.expiresAt < Date.now()) return "expired";
        if (k.expiresAt < Date.now() + 30 * DAY) return "expiring";
    }
    if (k.testStatus === "invalid") return "expired";
    if (k.testStatus === "untested") return "unverified";
    return "active";
}

// ---- Real verification endpoints (GET, bearer-style) for supported services ----
type Tester = {
    url: string;
    headers: (key: string) => Record<string, string>;
    method?: string;
    body?: string;
    responseKind?: "slack" | "graphql";
};
const TESTERS: Record<string, Tester> = {
    openai: { url: "https://api.openai.com/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    anthropic: {
        url: "https://api.anthropic.com/v1/models",
        headers: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }),
    },
    gemini: { url: "https://generativelanguage.googleapis.com/v1beta/models?key=", headers: () => ({}), /* key appended in testKey */ },
    openrouter: { url: "https://openrouter.ai/api/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    groq: { url: "https://api.groq.com/openai/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    mistral: { url: "https://api.mistral.ai/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    together: { url: "https://api.together.xyz/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    huggingface: { url: "https://huggingface.co/api/whoami-v2", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    replicate: { url: "https://api.replicate.com/v1/account", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    github: { url: "https://api.github.com/user", headers: (k) => ({ Authorization: `Bearer ${k}`, "User-Agent": "Coretex" }) },
    stripe: { url: "https://api.stripe.com/v1/balance", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    vercel: { url: "https://api.vercel.com/v2/user", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    resend: { url: "https://api.resend.com/domains", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    sendgrid: { url: "https://api.sendgrid.com/v3/scopes", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    render: { url: "https://api.render.com/v1/services?limit=1", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    railway: { url: "https://backboard.railway.app/graphql/v2", method: "POST", body: '{"query":"{ me { id } }"}', headers: (k) => ({ Authorization: `Bearer ${k}`, "Content-Type": "application/json" }), responseKind: "graphql" },
    linear: { url: "https://api.linear.app/graphql", method: "POST", body: '{"query":"{ viewer { id } }"}', headers: (k) => ({ Authorization: k, "Content-Type": "application/json" }), responseKind: "graphql" },
    posthog: { url: "https://app.posthog.com/api/users/@me/", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    gitlab: { url: "https://gitlab.com/api/v4/user", headers: (k) => ({ "PRIVATE-TOKEN": k }) },
    flyio: { url: "https://api.machines.dev/v1/apps", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    neon: { url: "https://console.neon.tech/api/v2/projects", headers: (k) => ({ Authorization: `Bearer ${k}`, Accept: "application/json" }) },
    planetscale: { url: "https://api.planetscale.com/v1/organizations", headers: (k) => ({ Authorization: k, Accept: "application/json" }) },
    cloudflare: { url: "https://api.cloudflare.com/client/v4/user/tokens/verify", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    airtable: { url: "https://api.airtable.com/v0/meta/whoami", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    postmark: { url: "https://api.postmarkapp.com/server", headers: (k) => ({ "X-Postmark-Server-Token": k, Accept: "application/json" }) },
    sentry: { url: "https://sentry.io/api/0/projects/", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    notion: { url: "https://api.notion.com/v1/users/me", headers: (k) => ({ Authorization: `Bearer ${k}`, "Notion-Version": "2022-06-28" }) },
    paddle: { url: "https://api.paddle.com/event-types", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    uploadthing: { url: "https://api.uploadthing.com/v6/getAppInfo", method: "POST", body: "{}", headers: (k) => ({ "X-Uploadthing-Api-Key": k, "Content-Type": "application/json" }) },
    netlify: { url: "https://api.netlify.com/api/v1/user", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
    slack: { url: "https://slack.com/api/auth.test", method: "POST", body: "", headers: (k) => ({ Authorization: `Bearer ${k}`, "Content-Type": "application/x-www-form-urlencoded" }), responseKind: "slack" },
    elevenlabs: { url: "https://api.elevenlabs.io/v1/user", headers: (k) => ({ "xi-api-key": k }) },
    google: { url: "https://www.googleapis.com/oauth2/v3/userinfo", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
};

export function canTest(serviceId: string): boolean {
    return serviceId in TESTERS;
}

const KEY_STATUS = new Set<APIKey["status"]>(["active", "expiring", "expired", "unverified"]);
const KEY_TEST_STATUS = new Set<APIKey["testStatus"]>(["valid", "invalid", "untested", "rate_limited", "testing"]);
const KEY_ENVIRONMENT = new Set<APIKey["environment"]>(["production", "staging", "development", "testing"]);
const CONNECTION_STATUS = new Set<ServiceConnection["status"]>(["connected", "disconnected", "partial", "error", "connecting"]);
const AUTH_TYPE = new Set<ServiceConnection["authType"]>(["oauth", "api_key", "basic"]);
const VERIFICATION = new Set<NonNullable<ServiceConnection["verification"]>>(["verified", "unverified", "failed"]);
const TOOL_PERMISSION = new Set<MCPToolBinding["permission"]>(["read", "write", "disabled"]);
const SERVICE_CATEGORY = new Set<ServiceCategory>([
    "ai", "payment", "database", "storage", "auth", "analytics", "communication", "monitoring", "development", "other",
]);

function text(value: unknown, fallback = "", max = 500): string {
    const candidate = typeof value === "string" ? value.trim() : fallback;
    return candidate.slice(0, max);
}

function uniqueStrings(value: unknown, maxItems = 100, maxLength = 240): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
        .slice(0, maxItems)
        .map((item) => item.slice(0, maxLength));
}

function utcDay(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10);
}

function auditToken(value: unknown, fallback = "unknown", max = 240): string {
    if (typeof value !== "string" || value.length === 0) return fallback;
    return value.replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, max);
}

/** Deliberately narrow preset reconciliation: punctuation/case only, never semantic aliases. */
function normalizedPresetToolName(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

/** Runtime validation boundary for renderer-authored vault keys. */
export function sanitizeApiKey(
    value: APIKey,
    before?: APIKey,
    options: { trustedConnectorLink?: boolean } = {},
): APIKey {
    const raw = (value ?? {}) as Partial<APIKey>;
    const now = Date.now();
    const id = text(raw.id, before?.id ?? genId("key"), 160) || genId("key");
    const keyValue = typeof raw.keyValue === "string" ? raw.keyValue.trim() : before?.keyValue ?? "";
    const serviceId = text(raw.serviceId, before?.serviceId ?? "custom", 120) || "custom";
    const serviceName = text(raw.serviceName, before?.serviceName ?? serviceId, 160) || serviceId;
    const candidate: APIKey = {
        id,
        serviceId,
        serviceName,
        serviceDomain: text(raw.serviceDomain, before?.serviceDomain ?? "", 240),
        nickname: text(raw.nickname, before?.nickname ?? `${serviceName} credential`, 240) || `${serviceName} credential`,
        keyValue,
        keyPreview: maskKey(keyValue),
        category: SERVICE_CATEGORY.has(raw.category as ServiceCategory) ? raw.category as ServiceCategory : before?.category ?? "other",
        environment: KEY_ENVIRONMENT.has(raw.environment as APIKey["environment"])
            ? raw.environment as APIKey["environment"]
            : before?.environment ?? "production",
        status: KEY_STATUS.has(raw.status as APIKey["status"])
            ? raw.status as APIKey["status"]
            : before?.status ?? "unverified",
        expiresAt: typeof raw.expiresAt === "number" && Number.isFinite(raw.expiresAt) ? raw.expiresAt : before?.expiresAt ?? null,
        lastUsed: typeof raw.lastUsed === "number" && Number.isFinite(raw.lastUsed) ? raw.lastUsed : before?.lastUsed ?? null,
        lastTested: typeof raw.lastTested === "number" && Number.isFinite(raw.lastTested) ? raw.lastTested : before?.lastTested ?? null,
        testStatus: KEY_TEST_STATUS.has(raw.testStatus as APIKey["testStatus"])
            ? raw.testStatus as APIKey["testStatus"]
            : before?.testStatus ?? "untested",
        aiAgentAccess: typeof raw.aiAgentAccess === "boolean" ? raw.aiAgentAccess : before?.aiAgentAccess ?? false,
        aiAccessScope: raw.aiAccessScope === "write" || raw.aiAccessScope === "full" || raw.aiAccessScope === "read"
            ? raw.aiAccessScope
            : before?.aiAccessScope ?? "read",
        projectId: typeof raw.projectId === "string" ? raw.projectId.slice(0, 160) : raw.projectId === null ? null : before?.projectId ?? null,
        scopes: uniqueStrings(raw.scopes ?? before?.scopes),
        note: text(raw.note, before?.note ?? "", 2_000),
        tags: uniqueStrings(raw.tags ?? before?.tags, 40, 80),
        createdAt: typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : before?.createdAt ?? now,
        updatedAt: now,
    };
    const connectorOwned = Boolean(before?.integrationId);
    const linkedEnvVarId = connectorOwned
        ? before?.linkedEnvVarId ?? ""
        : text(raw.linkedEnvVarId, before?.linkedEnvVarId ?? "", 160);
    const linkedEnvVarName = connectorOwned
        ? before?.linkedEnvVarName ?? ""
        : text(raw.linkedEnvVarName, before?.linkedEnvVarName ?? "", 160);
    const integrationId = before?.integrationId ?? (options.trustedConnectorLink ? text(raw.integrationId, "", 160) : "");
    const credentialLabel = connectorOwned
        ? before?.credentialLabel ?? ""
        : text(raw.credentialLabel, before?.credentialLabel ?? "", 160);
    if (linkedEnvVarId) candidate.linkedEnvVarId = linkedEnvVarId;
    if (linkedEnvVarName && /^[A-Za-z_][A-Za-z0-9_]*$/.test(linkedEnvVarName)) candidate.linkedEnvVarName = linkedEnvVarName;
    if (integrationId) candidate.integrationId = integrationId;
    if (credentialLabel) candidate.credentialLabel = credentialLabel;
    candidate.status = deriveStatus(candidate);
    return candidate;
}

/** Runtime validation boundary for renderer-authored connector metadata. */
export function sanitizeIntegration(
    value: ServiceConnection,
    before?: ServiceConnection,
    options: { trustedToolRuntime?: boolean; trustedConnectorLink?: boolean } = {},
): ServiceConnection {
    const raw = (value ?? {}) as Partial<ServiceConnection>;
    const now = Date.now();
    const id = text(raw.id, before?.id ?? genId("int"), 160) || genId("int");
    const serviceId = text(raw.serviceId, before?.serviceId ?? "custom", 120) || "custom";
    const serviceName = text(raw.serviceName, before?.serviceName ?? serviceId, 160) || serviceId;
    const verification = VERIFICATION.has(raw.verification as NonNullable<ServiceConnection["verification"]>)
        ? raw.verification as NonNullable<ServiceConnection["verification"]>
        : before?.verification ?? "unverified";
    let status = CONNECTION_STATUS.has(raw.status as ServiceConnection["status"])
        ? raw.status as ServiceConnection["status"]
        : before?.status ?? "disconnected";
    // A renderer cannot manufacture a healthy account merely by setting status=connected.
    if (status === "connected" && verification !== "verified") status = "partial";
    const tools = (Array.isArray(raw.mcpTools) ? raw.mcpTools : before?.mcpTools ?? []).slice(0, 100).map((tool, index) => {
        const item = (tool ?? {}) as Partial<MCPToolBinding>;
        const id = text(item.id, `${serviceId}-tool-${index}`, 160) || `${serviceId}-tool-${index}`;
        const beforeTool = before?.mcpTools.find((candidate) => candidate.id === id);
        const runtimeName = beforeTool?.runtimeName ?? (options.trustedToolRuntime ? text(item.runtimeName, "", 240) : "");
        const callsDay = beforeTool?.callsDay ?? (options.trustedToolRuntime && /^\d{4}-\d{2}-\d{2}$/.test(text(item.callsDay, "", 10))
            ? text(item.callsDay, "", 10)
            : undefined);
        const binding: MCPToolBinding = {
            id,
            name: text(item.name, `Tool ${index + 1}`, 160) || `Tool ${index + 1}`,
            description: text(item.description, "", 1_000),
            permission: TOOL_PERMISSION.has(item.permission as MCPToolBinding["permission"])
                ? item.permission as MCPToolBinding["permission"]
                : "disabled",
            requiresConfirmation: item.requiresConfirmation !== false,
            usageLimit: typeof item.usageLimit === "number" && Number.isInteger(item.usageLimit) && item.usageLimit >= 0
                ? Math.min(item.usageLimit, 1_000_000)
                : null,
            // Runtime identity and counters are store-owned. Renderer updates cannot reset them.
            callsToday: beforeTool?.callsToday ?? (options.trustedToolRuntime && typeof item.callsToday === "number" && Number.isInteger(item.callsToday) && item.callsToday >= 0
                ? Math.min(item.callsToday, 1_000_000)
                : 0),
        };
        if (runtimeName) binding.runtimeName = runtimeName;
        if (callsDay) binding.callsDay = callsDay;
        return binding;
    });
    const credentialIds = options.trustedConnectorLink
        ? uniqueStrings(raw.credentialIds ?? before?.credentialIds, 40, 160)
        : uniqueStrings(before?.credentialIds, 40, 160);
    const runtimeServerId = options.trustedConnectorLink
        ? text(raw.runtimeServerId, "", 160)
        : before?.runtimeServerId ?? "";
    const lastError = raw.lastError === null ? null : text(raw.lastError, before?.lastError ?? "", 1_000) || null;
    return {
        id,
        serviceId,
        serviceName,
        serviceDomain: text(raw.serviceDomain, before?.serviceDomain ?? "", 240),
        category: SERVICE_CATEGORY.has(raw.category as ServiceCategory) ? raw.category as ServiceCategory : before?.category ?? "other",
        status,
        authType: AUTH_TYPE.has(raw.authType as ServiceConnection["authType"])
            ? raw.authType as ServiceConnection["authType"]
            : before?.authType ?? "api_key",
        connectedAs: text(raw.connectedAs, before?.connectedAs ?? `${serviceName} account`, 240) || `${serviceName} account`,
        connectedAt: typeof raw.connectedAt === "number" && Number.isFinite(raw.connectedAt) ? raw.connectedAt : before?.connectedAt ?? now,
        lastSyncedAt: typeof raw.lastSyncedAt === "number" && Number.isFinite(raw.lastSyncedAt) ? raw.lastSyncedAt : before?.lastSyncedAt ?? null,
        mcpEnabled: typeof raw.mcpEnabled === "boolean" ? raw.mcpEnabled : before?.mcpEnabled ?? false,
        mcpTools: tools,
        stats: (Array.isArray(raw.stats) ? raw.stats : before?.stats ?? []).slice(0, 40).map((stat) => ({
            label: text(stat?.label, "", 120),
            value: text(stat?.value, "", 240),
        })).filter((stat) => stat.label.length > 0),
        color: /^#[0-9a-f]{3,8}$/i.test(text(raw.color, before?.color ?? "", 16)) ? text(raw.color, before?.color ?? "", 16) : "#64748b",
        requireConfirmWrites: typeof raw.requireConfirmWrites === "boolean" ? raw.requireConfirmWrites : before?.requireConfirmWrites ?? true,
        credentialIds,
        agentEnabled: typeof raw.agentEnabled === "boolean" ? raw.agentEnabled : before?.agentEnabled ?? raw.mcpEnabled !== false,
        ...(runtimeServerId ? { runtimeServerId } : {}),
        verification,
        lastError,
    };
}

export class KeyVaultStore {
    private keys: APIKey[] = [];
    private integrations: ServiceConnection[] = [];
    private audit: AuditEntry[] = [];
    private readonly file: string;
    private lastTestAt = new Map<string, number>();
    /** Serializes live-tool reconciliation with quota reservation. */
    private toolPolicyTail: Promise<void> = Promise.resolve();

    constructor(dataDir: string) {
        this.file = path.join(dataDir, "keyvault.json");
    }

    async load(): Promise<void> {
        // The vault ships EMPTY — no fabricated keys or integrations. Everything here is
        // what the user actually added (persisted to keyvault.json).
        let migrate = false;
        try {
            const loaded = await readProtectedJson<Partial<KeyVaultState>>(this.file);
            const raw = loaded.value;
            migrate = loaded.needsMigration;
            this.keys = Array.isArray(raw.keys)
                ? raw.keys.map((key) => sanitizeApiKey(key, undefined, { trustedConnectorLink: true }))
                : [];
            this.integrations = Array.isArray(raw.integrations)
                ? raw.integrations.map((integration) => sanitizeIntegration(integration, undefined, {
                    trustedToolRuntime: true,
                    trustedConnectorLink: true,
                }))
                : [];
            this.audit = Array.isArray(raw.audit) ? raw.audit : [];
        } catch {
            this.keys = [];
            this.integrations = [];
            this.audit = [];
        }
        if (migrate) await this.save();
    }

    state(): KeyVaultState {
        return {
            keys: this.keys.map((k) => ({ ...k, status: deriveStatus(k) })),
            integrations: this.integrations.slice(),
            audit: this.audit.slice(0, 100),
        };
    }

    private log(action: string, target: string, detail?: string, level: AuditEntry["level"] = "info"): void {
        this.audit.unshift({ id: genId("aud"), ts: Date.now(), action, target, detail, level });
        if (this.audit.length > 400) this.audit.length = 400;
    }

    /** Append an external audit entry (composer scope changes, integration use) + persist. */
    async addAudit(action: string, target: string, detail?: string, level: AuditEntry["level"] = "info"): Promise<void> {
        this.log(action, target, detail, level);
        await this.save();
    }

    private withToolPolicyLock<T>(operation: () => Promise<T>): Promise<T> {
        const pending = this.toolPolicyTail.then(operation);
        this.toolPolicyTail = pending.then(() => undefined, () => undefined);
        return pending;
    }

    private redactConnectorAudit(value: string): string {
        let redacted = value;
        for (const secret of this.secretValues()) {
            redacted = redacted.split(secret).join("[redacted]");
        }
        return redacted;
    }

    /**
     * Reconcile a live MCP tools/list response into persisted account policy.
     * Exact runtime-name matches retain policy. A preset without runtimeName may be claimed only
     * by a unique punctuation/case-normalized display-name match. Every other new tool is disabled.
     */
    reconcileConnectorTools(
        integrationId: string,
        runtimeServerId: string,
        runtimeNames: string[],
    ): Promise<MCPToolBinding[]> {
        return this.withToolPolicyLock(async () => {
            const integration = this.integrations.find((candidate) => candidate.id === integrationId);
            if (!integration) throw new Error("Connector account not found while reconciling MCP tools.");
            if (!integration.runtimeServerId || integration.runtimeServerId !== runtimeServerId) {
                throw new Error("MCP runtime does not belong to this connector account.");
            }

            const liveNames = [...new Set(
                (Array.isArray(runtimeNames) ? runtimeNames : []).filter((name): name is string =>
                    typeof name === "string" &&
                    name.length > 0 &&
                    name.length <= 240 &&
                    name === name.trim() &&
                    !/[\u0000-\u001f\u007f]/.test(name),
                ),
            )].slice(0, 100);
            const exactNames = new Set(
                integration.mcpTools
                    .map((binding) => binding.runtimeName)
                    .filter((name): name is string => typeof name === "string" && name.length > 0),
            );
            const claimedPresetIds = new Set<string>();
            let changed = false;

            for (const runtimeName of liveNames) {
                if (exactNames.has(runtimeName)) continue;
                const normalized = normalizedPresetToolName(runtimeName);
                const presetMatches = normalized
                    ? integration.mcpTools.filter((binding) =>
                        !binding.runtimeName &&
                        !claimedPresetIds.has(binding.id) &&
                        normalizedPresetToolName(binding.name) === normalized,
                    )
                    : [];
                if (presetMatches.length === 1) {
                    presetMatches[0].runtimeName = runtimeName;
                    claimedPresetIds.add(presetMatches[0].id);
                } else {
                    integration.mcpTools.push({
                        id: genId("tool"),
                        name: runtimeName,
                        runtimeName,
                        description: `Discovered from ${runtimeServerId} tools/list. Review before enabling.`,
                        permission: "disabled",
                        requiresConfirmation: true,
                        usageLimit: null,
                        callsToday: 0,
                    });
                }
                exactNames.add(runtimeName);
                changed = true;
            }

            if (changed) {
                this.log(
                    "Connector tools reconciled",
                    this.redactConnectorAudit(integration.serviceName),
                    this.redactConnectorAudit(`connector=${auditToken(integration.id)} · runtime=${auditToken(runtimeServerId)} · live=${liveNames.length}`),
                );
                await this.save();
            }
            return integration.mcpTools.map((binding) => ({ ...binding }));
        });
    }

    /**
     * Authorize and reserve one connector tool call before execution.
     * Every attempt emits a redacted decision audit and performs exactly one protected save.
     */
    authorizeAndReserveConnectorTool(
        input: ConnectorToolAuthorizationInput,
    ): Promise<ConnectorToolAuthorizationResult> {
        return this.withToolPolicyLock(async () => {
            const integrationId = typeof input.integrationId === "string" ? input.integrationId : "";
            const runtimeServerId = typeof input.runtimeServerId === "string" ? input.runtimeServerId : "";
            const runtimeName = typeof input.runtimeName === "string" ? input.runtimeName : "";
            const now = typeof input.now === "number" && Number.isFinite(input.now) && input.now >= 0 && input.now <= 8_640_000_000_000_000
                ? input.now
                : Date.now();
            let integration: ServiceConnection | undefined;
            const auditDetail = (decision: string): string => this.redactConnectorAudit([
                `agent=${auditToken(input.agentId)}`,
                `task=${auditToken(input.taskId)}`,
                ...(input.projectId ? [`project=${auditToken(input.projectId)}`] : []),
                `connector=${auditToken(integrationId)}`,
                `runtime=${auditToken(runtimeServerId)}`,
                `tool=${auditToken(runtimeName)}`,
                `decision=${auditToken(decision)}`,
            ].join(" · "));
            const deny = async (
                code: ConnectorToolAuthorizationDenialCode,
                message: string,
            ): Promise<ConnectorToolAuthorizationResult> => {
                this.log(
                    "Connector tool denied",
                    this.redactConnectorAudit(integration?.serviceName ?? `Connector ${auditToken(integrationId)}`),
                    auditDetail(code),
                    "warn",
                );
                await this.save();
                return { authorized: false, code, message, integrationId, runtimeServerId, runtimeName };
            };

            if (input.effectivePolicy === "plan-only") {
                return deny("execution_policy_plan_only", "Connector tools cannot execute while the effective agent policy is plan-only.");
            }
            if (input.effectivePolicy === "confirm" || (input.effectivePolicy !== "auto" && input.effectivePolicy !== "bypass")) {
                return deny("approval_required", "Connector tool execution requires approval, but no connector approval bridge is available.");
            }
            if (!Array.isArray(input.effectiveConnectorIds) || !input.effectiveConnectorIds.includes(integrationId)) {
                return deny("connector_not_allowed", "This connector account is outside the effective project and agent allowlist.");
            }
            integration = this.integrations.find((candidate) => candidate.id === integrationId);
            if (!integration) return deny("integration_not_found", "Connector account not found.");
            if (integration.status !== "connected" && integration.status !== "partial") {
                return deny("integration_unavailable", `Connector account is ${integration.status} and cannot run tools.`);
            }
            if (integration.agentEnabled !== true) {
                return deny("agent_access_disabled", "Agent access is disabled for this connector account.");
            }
            if (integration.mcpEnabled !== true) {
                return deny("mcp_disabled", "MCP tools are disabled for this connector account.");
            }
            if (!integration.runtimeServerId || integration.runtimeServerId !== runtimeServerId) {
                return deny("runtime_mismatch", "The MCP runtime does not belong to this connector account.");
            }

            const binding = resolveConnectorToolBinding(integration, runtimeServerId, runtimeName);
            if (!binding) return deny("tool_unknown", "This exact runtime tool is not registered for the connector account.");

            const currentDay = utcDay(now);
            if (binding.callsDay !== currentDay) {
                binding.callsDay = currentDay;
                binding.callsToday = 0;
            } else if (!Number.isInteger(binding.callsToday) || binding.callsToday < 0) {
                binding.callsToday = 0;
            }

            if (binding.permission === "disabled") {
                return deny("tool_disabled", "This connector tool is disabled.");
            }
            if (input.globalReadOnly && binding.permission === "write") {
                return deny("global_read_only", "Write connector tools are blocked while global read-only mode is enabled.");
            }
            if (binding.requiresConfirmation || (binding.permission === "write" && integration.requireConfirmWrites)) {
                return deny("approval_required", "This connector tool requires approval, but no connector approval bridge is available.");
            }
            if (binding.usageLimit !== null && binding.callsToday >= binding.usageLimit) {
                return deny("usage_limit_reached", `This connector tool has reached its daily limit of ${binding.usageLimit}.`);
            }

            // Reserve quota before returning authorization to the executor.
            binding.callsToday += 1;
            this.log(
                "Connector tool reserved",
                this.redactConnectorAudit(integration.serviceName),
                auditDetail("allowed"),
            );
            await this.save();
            return {
                authorized: true,
                integrationId,
                runtimeServerId,
                runtimeName,
                bindingId: binding.id,
                permission: binding.permission,
                callsToday: binding.callsToday,
                usageLimit: binding.usageLimit,
            };
        });
    }

    async upsertKey(key: APIKey): Promise<void> {
        const idx = this.keys.findIndex((k) => k.id === key.id);
        key = sanitizeApiKey(key, idx === -1 ? undefined : this.keys[idx]);
        if (idx === -1) {
            key.createdAt = key.createdAt || Date.now();
            this.keys.push(key);
            this.log("Key added", `${key.serviceName} · ${key.nickname}`);
            // Duplicate-value detection.
            const dup = this.keys.filter((k) => k.keyValue === key.keyValue && k.id !== key.id);
            if (dup.length) this.log("Duplicate key detected", `${key.serviceName} · ${key.nickname}`, "Same value stored elsewhere", "warn");
        } else {
            this.keys[idx] = key;
            this.log("Key edited", `${key.serviceName} · ${key.nickname}`);
        }
        await this.save();
    }

    async deleteKey(id: string): Promise<void> {
        const k = this.keys.find((x) => x.id === id);
        this.keys = this.keys.filter((x) => x.id !== id);
        if (k) this.log("Key deleted", `${k.serviceName} · ${k.nickname}`, undefined, "warn");
        await this.save();
    }

    /** Values only, for process-level output redaction. Never included in Security status. */
    secretValues(): string[] {
        return this.keys.map((key) => key.keyValue).filter((value) => typeof value === "string" && value.length > 0);
    }

    /** Remove every API-key value and disconnect integrations that depended on them. */
    async clearSecrets(): Promise<number> {
        const cleared = this.secretValues().length;
        this.keys = [];
        this.integrations = this.integrations.map((integration) => ({
            ...integration,
            status: "disconnected",
            verification: "unverified",
            credentialIds: [],
            lastError: null,
        }));
        if (cleared > 0) this.log("Stored secrets cleared", "API key vault", `${cleared} credential${cleared === 1 ? "" : "s"} removed`, "warn");
        await this.save();
        return cleared;
    }

    async upsertIntegration(integration: ServiceConnection): Promise<void> {
        const idx = this.integrations.findIndex((i) => i.id === integration.id);
        const before = idx === -1 ? undefined : this.integrations[idx];
        integration = sanitizeIntegration(integration, before);
        if (idx === -1) {
            this.integrations.push(integration);
            this.log("Integration connected", integration.serviceName);
        } else {
            this.integrations[idx] = integration;
            if (before && before.mcpEnabled !== integration.mcpEnabled) {
                this.log(integration.mcpEnabled ? "MCP enabled" : "MCP disabled", integration.serviceName);
            } else if (before && before.status === "connected" && integration.status === "disconnected") {
                this.log("Integration disconnected", integration.serviceName, undefined, "warn");
            } else {
                this.log("Integration updated", integration.serviceName);
            }
        }
        await this.save();
    }

    async deleteIntegration(id: string): Promise<void> {
        const i = this.integrations.find((x) => x.id === id);
        this.integrations = this.integrations.filter((x) => x.id !== id);
        if (i) this.log("Integration removed", i.serviceName, undefined, "warn");
        await this.save();
    }

    /** Persist every credential field and verify the account as one serialized vault operation. */
    async connectIntegration(
        input: ServiceConnection,
        credentialInputs: ConnectorCredentialInput[],
    ): Promise<{ integration: ServiceConnection; credentialIds: string[]; message?: string }> {
        const existing = this.integrations.find((integration) => integration.id === input.id);
        let integration = sanitizeIntegration({
            ...input,
            status: "connecting",
            verification: "unverified",
            lastError: null,
        }, existing, { trustedConnectorLink: true });

        const credentials = (Array.isArray(credentialInputs) ? credentialInputs : [])
            .filter((credential) => credential && typeof credential.value === "string" && credential.value.trim().length > 0)
            .slice(0, 40);
        const ordered = [
            ...credentials.filter((credential) => credential.primary === true),
            ...credentials.filter((credential) => credential.primary !== true),
        ];
        if (ordered.length === 0) {
            throw new Error("At least one credential or OAuth access token is required to connect this service.");
        }

        // Validate first, then replace only credentials actually owned by this account.
        // A corrupted credentialIds array must not claim another account's secret.
        const previouslyLinked = new Set([
            ...(existing?.credentialIds ?? []).filter((id) =>
                this.keys.some((key) => key.id === id && key.integrationId === integration.id),
            ),
            ...this.keys.filter((key) => key.integrationId === integration.id).map((key) => key.id),
        ]);
        this.keys = this.keys.filter((key) => !previouslyLinked.has(key.id));

        const credentialIds: string[] = [];
        for (const [index, credential] of ordered.entries()) {
            const requestedId = text(credential.id, "", 160);
            const id = requestedId && !this.keys.some((key) => key.id === requestedId) ? requestedId : genId("key");
            const label = text(credential.label, `Credential ${index + 1}`, 160) || `Credential ${index + 1}`;
            const key = sanitizeApiKey({
                id,
                serviceId: integration.serviceId,
                serviceName: integration.serviceName,
                serviceDomain: integration.serviceDomain,
                nickname: `${integration.connectedAs} · ${label}`,
                keyValue: credential.value,
                keyPreview: "",
                category: integration.category,
                environment: "production",
                status: "unverified",
                expiresAt: null,
                lastUsed: null,
                lastTested: null,
                testStatus: "untested",
                aiAgentAccess: integration.agentEnabled !== false,
                aiAccessScope: "read",
                projectId: null,
                scopes: [],
                note: `Owned by connector account ${integration.connectedAs}.`,
                tags: ["integration", `integration:${integration.id}`],
                createdAt: Date.now(),
                updatedAt: Date.now(),
                integrationId: integration.id,
                credentialLabel: label,
                linkedEnvVarName: credential.linkedEnvVarName,
            }, undefined, { trustedConnectorLink: true });
            this.keys.push(key);
            credentialIds.push(key.id);
        }
        integration = sanitizeIntegration({ ...integration, credentialIds }, integration, { trustedConnectorLink: true });
        const index = this.integrations.findIndex((item) => item.id === integration.id);
        if (index === -1) this.integrations.push(integration);
        else this.integrations[index] = integration;

        const verified = await this.verifyIntegrationRecord(integration);
        this.log(
            existing ? "Connector reconnected" : "Connector connected",
            verified.integration.serviceName,
            verified.message,
            verified.integration.status === "error" ? "error" : verified.integration.status === "partial" ? "warn" : "info",
        );
        await this.save();
        return { integration: verified.integration, credentialIds, message: verified.message };
    }

    /** Disconnect one account and remove only credentials explicitly owned by it. */
    async disconnectIntegration(id: string): Promise<{ integration: ServiceConnection; removedCredentialIds: string[]; message: string } | null> {
        const integration = this.integrations.find((item) => item.id === id);
        if (!integration) return null;
        const linked = new Set([
            ...(integration.credentialIds ?? []).filter((credentialId) =>
                this.keys.some((key) => key.id === credentialId && key.integrationId === id),
            ),
            ...this.keys.filter((key) => key.integrationId === id).map((key) => key.id),
        ]);
        this.keys = this.keys.filter((key) => !linked.has(key.id));
        const disconnected = sanitizeIntegration({
            ...integration,
            status: "disconnected",
            verification: "unverified",
            credentialIds: [],
            lastError: null,
            lastSyncedAt: integration.lastSyncedAt,
        }, integration, { trustedConnectorLink: true });
        this.integrations = this.integrations.map((item) => item.id === id ? disconnected : item);
        this.log("Connector disconnected", disconnected.serviceName, `${linked.size} linked credential${linked.size === 1 ? "" : "s"} removed`, "warn");
        await this.save();
        return {
            integration: disconnected,
            removedCredentialIds: [...linked],
            message: `Disconnected and removed ${linked.size} linked credential${linked.size === 1 ? "" : "s"}.`,
        };
    }

    /** Lightweight, rate-limited (max 1/min/key) live verification call. */
    async testKey(id: string): Promise<KeyTestResult> {
        const key = this.keys.find((k) => k.id === id);
        if (!key) return { id, status: "invalid", message: "Key not found" };

        const last = this.lastTestAt.get(id) ?? 0;
        if (Date.now() - last < 60_000) {
            return { id, status: "rate_limited", message: "Tested less than a minute ago — try again shortly." };
        }
        this.lastTestAt.set(id, Date.now());

        const tester = TESTERS[key.serviceId];
        if (!tester) {
            key.lastTested = Date.now();
            await this.save();
            return { id, status: "untested", message: "Live testing isn't supported for this service yet." };
        }

        const { status, message } = await this.runTester(key.serviceId, tester, key.keyValue);

        key.testStatus = status === "untested" ? key.testStatus : status;
        key.lastTested = Date.now();
        if (status === "valid") key.lastUsed = Date.now();
        key.status = deriveStatus(key);
        this.log(
            "Key tested",
            `${key.serviceName} · ${key.nickname}`,
            status,
            status === "invalid" ? "error" : status === "valid" ? "info" : "warn",
        );
        await this.save();
        return { id, status, message };
    }

    /** Run a verify endpoint for a secret; maps the HTTP result to a test status. */
    private async runTester(serviceId: string, tester: Tester, secret: string): Promise<{ status: KeyTestStatus; message?: string }> {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        try {
            const url = serviceId === "gemini" ? `${tester.url}${encodeURIComponent(secret)}` : tester.url;
            const res = await fetch(url, { method: tester.method ?? "GET", headers: tester.headers(secret), body: tester.body, signal: ctrl.signal });
            if (res.status >= 200 && res.status < 300) {
                if (tester.responseKind) {
                    let body: unknown;
                    try {
                        body = await res.json();
                    } catch {
                        return { status: "untested", message: "Provider returned an unreadable verification response." };
                    }
                    if (tester.responseKind === "slack" && (!body || typeof body !== "object" || (body as { ok?: unknown }).ok !== true)) {
                        const error = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
                            ? (body as { error: string }).error
                            : "authentication failed";
                        return { status: "invalid", message: `Slack rejected the credential (${error}).` };
                    }
                    if (tester.responseKind === "graphql") {
                        const errors = body && typeof body === "object" ? (body as { errors?: unknown }).errors : undefined;
                        if (Array.isArray(errors) && errors.length > 0) {
                            const first = errors[0];
                            const message = first && typeof first === "object" && typeof (first as { message?: unknown }).message === "string"
                                ? (first as { message: string }).message.slice(0, 240)
                                : "GraphQL authentication failed";
                            return { status: "invalid", message };
                        }
                    }
                }
                return { status: "valid" };
            }
            if (res.status === 401 || res.status === 403) return { status: "invalid", message: `Rejected (HTTP ${res.status}) — token may be invalid or lack scope.` };
            if (res.status === 429) return { status: "rate_limited", message: "Rate-limited by the provider." };
            return { status: "untested", message: `Unexpected HTTP ${res.status}.` };
        } catch (err) {
            return { status: "untested", message: err instanceof Error && err.name === "AbortError" ? "Timed out after 10s." : `Network error: ${(err as Error).message}` };
        } finally {
            clearTimeout(timer);
        }
    }

    private async verifyIntegrationRecord(integration: ServiceConnection): Promise<{ integration: ServiceConnection; message?: string }> {
        const tester = TESTERS[integration.serviceId];
        if (!tester) {
            const message = "Credentials are stored, but live verification is not supported for this service yet.";
            Object.assign(integration, {
                status: "partial" as const,
                verification: "unverified" as const,
                lastError: null,
            });
            return { integration, message };
        }
        // The first credential id is canonical primary; never borrow another account's key.
        const primaryId = integration.credentialIds?.[0];
        const key = primaryId
            ? this.keys.find((candidate) => candidate.id === primaryId && candidate.integrationId === integration.id)
            : this.keys.find((candidate) => candidate.integrationId === integration.id);
        if (!key?.keyValue) {
            const message = "This connector has no linked primary credential to verify.";
            Object.assign(integration, {
                status: "error" as const,
                verification: "failed" as const,
                lastError: message,
            });
            return { integration, message };
        }
        const result = await this.runTester(integration.serviceId, tester, key.keyValue);
        key.testStatus = result.status === "untested" ? "untested" : result.status;
        key.lastTested = Date.now();
        if (result.status === "valid") key.lastUsed = Date.now();
        key.status = deriveStatus(key);
        if (result.status === "valid") {
            Object.assign(integration, {
                status: "connected" as const,
                verification: "verified" as const,
                lastError: null,
                lastSyncedAt: Date.now(),
            });
        } else if (result.status === "invalid") {
            Object.assign(integration, {
                status: "error" as const,
                verification: "failed" as const,
                lastError: result.message ?? "Provider rejected the credential.",
            });
        } else {
            Object.assign(integration, {
                status: "partial" as const,
                verification: "unverified" as const,
                lastError: result.message ?? "Live verification could not be completed.",
            });
        }
        return { integration, message: result.message };
    }

    /** Verify the exact credential linked to one connector account. */
    async verifyIntegration(id: string): Promise<{
        id: string;
        status: ServiceConnection["status"];
        verification?: ServiceConnection["verification"];
        message?: string;
    }> {
        const integration = this.integrations.find((item) => item.id === id);
        if (!integration) return { id, status: "error", verification: "failed", message: "Integration not found" };
        const verified = await this.verifyIntegrationRecord(integration);
        this.log(
            "Integration verified",
            integration.serviceName,
            verified.message ?? integration.verification,
            integration.status === "error" ? "error" : integration.status === "partial" ? "warn" : "info",
        );
        await this.save();
        return { id, status: integration.status, verification: integration.verification, message: verified.message };
    }

    private async save(): Promise<void> {
        await writeProtectedJson(this.file, { keys: this.keys, integrations: this.integrations, audit: this.audit.slice(0, 400) });
    }
}
