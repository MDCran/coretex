// @ts-nocheck
// Coretex — service catalog for the API Key Vault + Integrations Hub + Settings
// Remote connectors. One source of truth: logos, categories, auth types, MCP tool
// presets, and optional stdio MCP packages agents can actually run.

import type { ServiceCategory, MCPToolBinding } from "@repo/coretex/types";

export interface ServiceMcpRuntime {
    /** Executable used for the maintained adapter. Defaults to npx. */
    command?: string;
    /** npm package (via npx -y), Docker image, or human-readable adapter id. */
    package: string;
    /** Primary env var the MCP server reads for the API token. */
    envVar: string;
    /** Every protected env var the runtime receives. */
    envVars?: string[];
    /** Full args when command is set; otherwise extra args after `npx -y <package>`. */
    args?: string;
}

/** One credential requested by the shared connector flow. Every field is stored
 * as its own protected API-key record and linked back to the connection. */
export interface ServiceCredentialField {
    id: string;
    label: string;
    placeholder?: string;
    /** Environment name used when a project/agent receives this credential. */
    envVar: string;
    primary?: boolean;
    secret?: boolean;
}

export interface ServiceDef {
    id: string;
    name: string;
    domain: string;
    category: ServiceCategory;
    authType: "oauth" | "api_key" | "basic";
    color: string;
    /** Optional secondary credential field labels (e.g. Twilio SID + Token). */
    fields?: string[];
    /** Preset MCP tool actions surfaced when "AI agent access" is enabled. */
    mcpTools?: { name: string; description: string; write?: boolean }[];
    /** True when the Brain can live-verify an API key (must match keyvault store TESTERS). */
    testable?: boolean;
    /**
     * When set, connecting this service also registers a stdio MCP server under
     * Settings → MCP that injects the vault key into `envVar` so tools actually run.
     */
    mcpRuntime?: ServiceMcpRuntime;
    /** Short capability blurb for Settings connectors grid. */
    caps?: string;
    /** Settings Remote group label (non-AI connectors only). */
    connectorGroup?: string;
}

export const CATEGORY_LABELS: Record<ServiceCategory, string> = {
    ai: "AI / ML",
    payment: "Payment",
    database: "Database",
    storage: "Storage",
    auth: "Auth",
    analytics: "Analytics",
    communication: "Communication",
    monitoring: "Monitoring",
    development: "Development",
    other: "Other",
};

export const CATEGORY_COLORS: Record<ServiceCategory, string> = {
    ai: "#8b5cf6",
    payment: "#22c55e",
    database: "#3b82f6",
    storage: "#f59e0b",
    auth: "#ef4444",
    analytics: "#ec4899",
    communication: "#06b6d4",
    monitoring: "#f97316",
    development: "#6366f1",
    other: "#64748b",
};

export const SERVICES: ServiceDef[] = [
    // Development
    {
        id: "supabase", name: "Supabase", domain: "supabase.com", category: "database", authType: "api_key", color: "#3ecf8e",
        testable: false, caps: "Postgres & auth tools", connectorGroup: "Cloud & hosting",
        mcpTools: [{ name: "Query DB", description: "Run a read-only query" }, { name: "List Tables", description: "List tables in a schema" }, { name: "Run SQL", description: "Execute SQL", write: true }, { name: "Insert Record", description: "Insert a row", write: true }, { name: "Update Record", description: "Update rows", write: true }, { name: "Delete Record", description: "Delete rows", write: true }],
    },
    {
        id: "vercel", name: "Vercel", domain: "vercel.com", category: "development", authType: "api_key", color: "#000000",
        testable: true, caps: "Deploy / preview / env", connectorGroup: "Cloud & hosting",
        mcpTools: [{ name: "List Deployments", description: "List recent deploys" }, { name: "Deploy", description: "Trigger a deployment", write: true }, { name: "Get Logs", description: "Read build/runtime logs" }, { name: "Manage Domains", description: "Add/remove domains", write: true }, { name: "Env Vars", description: "Read/write env vars", write: true }],
    },
    {
        id: "github", name: "GitHub", domain: "github.com", category: "development", authType: "api_key", color: "#1f2328",
        testable: true, caps: "Repos, CI, issues, PRs", connectorGroup: "Dev & project tools",
        mcpRuntime: {
            command: "docker",
            package: "ghcr.io/github/github-mcp-server",
            envVar: "GITHUB_PERSONAL_ACCESS_TOKEN",
            envVars: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
            args: "run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server",
        },
        mcpTools: [{ name: "Read Repo", description: "Read files & metadata" }, { name: "Create Issue", description: "Open an issue", write: true }, { name: "Create PR", description: "Open a pull request", write: true }, { name: "Commit Code", description: "Push a commit", write: true }, { name: "List Issues", description: "List issues & PRs" }],
    },
    {
        id: "gitlab", name: "GitLab", domain: "gitlab.com", category: "development", authType: "api_key", color: "#fc6d26",
        testable: true, caps: "Repos & pipelines", connectorGroup: "Dev & project tools",
        mcpTools: [{ name: "List Projects", description: "List GitLab projects" }, { name: "Create Issue", description: "Open an issue", write: true }, { name: "List Pipelines", description: "List CI pipelines" }],
    },
    {
        id: "railway", name: "Railway", domain: "railway.app", category: "development", authType: "api_key", color: "#0b0d0e",
        testable: true, caps: "Services & DBs", connectorGroup: "Cloud & hosting",
        mcpTools: [{ name: "List Projects", description: "List Railway projects" }, { name: "List Services", description: "List services in a project" }],
    },
    {
        id: "planetscale", name: "PlanetScale", domain: "planetscale.com", category: "database", authType: "api_key", color: "#000000",
        testable: true, caps: "Serverless MySQL", connectorGroup: "Data & payments",
        mcpTools: [{ name: "List Databases", description: "List databases" }, { name: "List Branches", description: "List database branches" }],
    },
    {
        id: "neon", name: "Neon", domain: "neon.tech", category: "database", authType: "api_key", color: "#00e599",
        testable: true, caps: "Serverless Postgres", connectorGroup: "Data & payments",
        mcpTools: [{ name: "List Projects", description: "List Neon projects" }, { name: "List Branches", description: "List branches" }],
    },
    {
        id: "render", name: "Render", domain: "render.com", category: "development", authType: "api_key", color: "#46e3b7",
        testable: true, caps: "Web services & DBs", connectorGroup: "Cloud & hosting",
        mcpTools: [{ name: "List Services", description: "List Render services" }, { name: "Deploy", description: "Trigger a deploy", write: true }],
    },
    {
        id: "flyio", name: "Fly.io", domain: "fly.io", category: "development", authType: "api_key", color: "#8b5cf6",
        testable: true, caps: "Edge apps & machines", connectorGroup: "Cloud & hosting",
        mcpTools: [{ name: "List Apps", description: "List Fly apps" }, { name: "List Machines", description: "List machines" }],
    },
    {
        id: "netlify", name: "Netlify", domain: "netlify.com", category: "development", authType: "api_key", color: "#00c7b7",
        testable: true, caps: "Sites & deploys", connectorGroup: "Cloud & hosting",
        mcpTools: [{ name: "List Sites", description: "List Netlify sites" }, { name: "List Deploys", description: "List deploys" }],
    },
    // AI / ML (Keyvault + AI providers — not under Settings Remote connectors)
    { id: "openai", name: "OpenAI", domain: "openai.com", category: "ai", authType: "api_key", color: "#10a37f", testable: true, mcpTools: [{ name: "Chat Completion", description: "Generate a chat response" }, { name: "Generate Image", description: "Create an image", write: true }, { name: "Transcribe Audio", description: "Speech-to-text" }] },
    { id: "anthropic", name: "Anthropic", domain: "anthropic.com", category: "ai", authType: "api_key", color: "#d97757", testable: true, mcpTools: [{ name: "Chat Completion", description: "Generate a Claude response (API). Prefer Claude Pro/Max in AI providers for agents." }] },
    { id: "gemini", name: "Google Gemini", domain: "google.com", category: "ai", authType: "api_key", color: "#4285f4", testable: true, mcpTools: [{ name: "Chat Completion", description: "Generate a Gemini response" }] },
    { id: "openrouter", name: "OpenRouter", domain: "openrouter.ai", category: "ai", authType: "api_key", color: "#6566f1", testable: true, mcpTools: [{ name: "Chat Completion", description: "Route a chat completion through OpenRouter" }] },
    { id: "groq", name: "Groq", domain: "groq.com", category: "ai", authType: "api_key", color: "#f55036", testable: true },
    { id: "replicate", name: "Replicate", domain: "replicate.com", category: "ai", authType: "api_key", color: "#000000", testable: true },
    { id: "huggingface", name: "Hugging Face", domain: "huggingface.co", category: "ai", authType: "api_key", color: "#ff9d00", testable: true },
    { id: "ollama", name: "Ollama", domain: "ollama.com", category: "ai", authType: "basic", color: "#000000", testable: false },
    { id: "lmstudio", name: "LM Studio", domain: "lmstudio.ai", category: "ai", authType: "basic", color: "#6b7280", testable: false },
    { id: "openclaw", name: "OpenClaw", domain: "openclaw.ai", category: "ai", authType: "basic", color: "#0f172a", testable: false },
    { id: "together", name: "Together AI", domain: "together.ai", category: "ai", authType: "api_key", color: "#0f6fff", testable: true },
    { id: "mistral", name: "Mistral", domain: "mistral.ai", category: "ai", authType: "api_key", color: "#fa520f", testable: true },
    // Payment
    {
        id: "stripe", name: "Stripe", domain: "stripe.com", category: "payment", authType: "api_key", color: "#635bff",
        testable: true, fields: ["Secret key", "Publishable key"], caps: "Customers & payments", connectorGroup: "Data & payments",
        mcpTools: [{ name: "List Customers", description: "List customers" }, { name: "Check Balance", description: "Read account balance" }, { name: "Create Payment Link", description: "Generate a payment link", write: true }],
    },
    {
        id: "paddle", name: "Paddle", domain: "paddle.com", category: "payment", authType: "api_key", color: "#ffdd00",
        testable: true, caps: "Subscriptions & billing", connectorGroup: "Data & payments",
        mcpTools: [{ name: "List Products", description: "List products" }, { name: "List Subscriptions", description: "List subscriptions" }],
    },
    // Communication
    {
        id: "twilio", name: "Twilio", domain: "twilio.com", category: "communication", authType: "basic", color: "#f22f46",
        testable: false, fields: ["Account SID", "Auth Token"], caps: "SMS / voice", connectorGroup: "Messaging & voice",
        mcpTools: [{ name: "Send SMS", description: "Send a text message", write: true }, { name: "List Messages", description: "List recent messages" }],
    },
    {
        id: "sendgrid", name: "SendGrid", domain: "sendgrid.com", category: "communication", authType: "api_key", color: "#1a82e2",
        testable: true, caps: "Transactional email", connectorGroup: "Messaging & voice",
        mcpTools: [{ name: "Send Email", description: "Send a transactional email", write: true }, { name: "List Templates", description: "List email templates" }],
    },
    {
        id: "resend", name: "Resend", domain: "resend.com", category: "communication", authType: "api_key", color: "#000000",
        testable: true, caps: "Developer email API", connectorGroup: "Messaging & voice",
        mcpTools: [{ name: "Send Email", description: "Send an email", write: true }, { name: "List Domains", description: "List verified domains" }],
    },
    {
        id: "postmark", name: "Postmark", domain: "postmarkapp.com", category: "communication", authType: "api_key", color: "#ffde00",
        testable: true, caps: "Transactional email", connectorGroup: "Messaging & voice",
        mcpTools: [{ name: "Send Email", description: "Send an email", write: true }],
    },
    {
        id: "elevenlabs", name: "ElevenLabs", domain: "elevenlabs.io", category: "communication", authType: "api_key", color: "#000000",
        testable: true, caps: "TTS connector", connectorGroup: "Messaging & voice",
        mcpTools: [{ name: "List Voices", description: "List available voices" }, { name: "Text to Speech", description: "Synthesize speech", write: true }],
    },
    {
        id: "slack", name: "Slack", domain: "slack.com", category: "communication", authType: "api_key", color: "#4a154b",
        testable: true, fields: ["Bot token", "Team ID"], caps: "Credential environment for Slack apps", connectorGroup: "Messaging & voice",
        mcpTools: [{ name: "List Channels", description: "List Slack channels" }, { name: "Post Message", description: "Post to a channel", write: true }, { name: "Read History", description: "Read channel history" }],
    },
    // Storage
    {
        id: "aws", name: "AWS S3", domain: "aws.amazon.com", category: "storage", authType: "basic", color: "#ff9900",
        testable: false, fields: ["Access Key ID", "Secret Access Key"], caps: "S3 / EC2 / Lambda", connectorGroup: "Cloud & hosting",
        mcpTools: [{ name: "List Buckets", description: "List S3 buckets" }, { name: "List Objects", description: "List objects in a bucket" }],
    },
    {
        id: "cloudflare", name: "Cloudflare R2", domain: "cloudflare.com", category: "storage", authType: "api_key", color: "#f38020",
        testable: true, caps: "R2 object storage", connectorGroup: "Cloud & hosting",
        mcpTools: [{ name: "List Buckets", description: "List R2 buckets" }],
    },
    {
        id: "uploadthing", name: "Uploadthing", domain: "uploadthing.com", category: "storage", authType: "api_key", color: "#e91e63",
        testable: true, caps: "File uploads", connectorGroup: "Cloud & hosting",
        mcpTools: [{ name: "List Files", description: "List uploaded files" }],
    },
    // Monitoring
    {
        id: "sentry", name: "Sentry", domain: "sentry.io", category: "monitoring", authType: "api_key", color: "#362d59",
        testable: true, fields: ["API Token"], caps: "Error monitoring", connectorGroup: "Data & payments",
        mcpTools: [{ name: "List Projects", description: "List Sentry projects" }, { name: "List Issues", description: "List recent issues" }],
    },
    {
        id: "datadog", name: "Datadog", domain: "datadoghq.com", category: "monitoring", authType: "api_key", color: "#632ca6",
        testable: false, fields: ["API Key", "App Key"], caps: "Metrics & logs", connectorGroup: "Data & payments",
        mcpTools: [{ name: "Query Metrics", description: "Query timeseries metrics" }],
    },
    {
        id: "posthog", name: "PostHog", domain: "posthog.com", category: "analytics", authType: "api_key", color: "#f54e00",
        testable: true, caps: "Product analytics", connectorGroup: "Data & payments",
        mcpTools: [{ name: "List Insights", description: "List insights" }, { name: "Capture Event", description: "Capture an analytics event", write: true }],
    },
    {
        id: "mixpanel", name: "Mixpanel", domain: "mixpanel.com", category: "analytics", authType: "api_key", color: "#7856ff",
        testable: false, caps: "Product analytics", connectorGroup: "Data & payments",
        mcpTools: [{ name: "Export Events", description: "Export event data" }],
    },
    // Databases (extra)
    {
        id: "mongodb", name: "MongoDB Atlas", domain: "mongodb.com", category: "database", authType: "api_key", color: "#00684a",
        testable: false, fields: ["API public key", "API private key"], caps: "Cloud Mongo tools", connectorGroup: "Data & payments",
        mcpTools: [{ name: "List Clusters", description: "List Atlas clusters" }, { name: "List Databases", description: "List databases" }],
    },
    // Other
    {
        id: "notion", name: "Notion", domain: "notion.so", category: "other", authType: "api_key", color: "#000000",
        testable: true, caps: "Pages & databases", connectorGroup: "Dev & project tools",
        mcpRuntime: { package: "@notionhq/notion-mcp-server", envVar: "NOTION_TOKEN" },
        mcpTools: [{ name: "Search", description: "Search pages & databases" }, { name: "Read Page", description: "Read a page" }, { name: "Create Page", description: "Create a page", write: true }],
    },
    {
        id: "linear", name: "Linear", domain: "linear.app", category: "other", authType: "api_key", color: "#5e6ad2",
        testable: true, caps: "Issues & cycles", connectorGroup: "Dev & project tools",
        mcpTools: [{ name: "List Issues", description: "List Linear issues" }, { name: "Create Issue", description: "Create an issue", write: true }, { name: "Update Issue", description: "Update an issue", write: true }],
    },
    {
        id: "jira", name: "Jira", domain: "atlassian.com", category: "other", authType: "api_key", color: "#0052cc",
        testable: false, fields: ["Email", "API Token"], caps: "Issues & boards", connectorGroup: "Dev & project tools",
        mcpTools: [{ name: "Search Issues", description: "JQL search" }, { name: "Create Issue", description: "Create an issue", write: true }],
    },
    {
        id: "airtable", name: "Airtable", domain: "airtable.com", category: "database", authType: "api_key", color: "#fcb400",
        testable: true, caps: "Bases & records", connectorGroup: "Data & payments",
        mcpTools: [{ name: "List Bases", description: "List Airtable bases" }, { name: "List Records", description: "List records in a table" }],
    },
    {
        id: "google", name: "Google", domain: "google.com", category: "auth", authType: "oauth", color: "#4285f4",
        testable: false, caps: "Google account (OAuth)", connectorGroup: "Dev & project tools",
        mcpTools: [{ name: "User Info", description: "Read account profile" }],
    },
];

export const SERVICE_BY_ID: Record<string, ServiceDef> = Object.fromEntries(SERVICES.map((s) => [s.id, s]));

/** Non-AI services shown in Settings → Remote connectors (and Keyvault Integrations). */
export const CONNECTOR_SERVICES: ServiceDef[] = SERVICES.filter((s) => s.category !== "ai" && s.connectorGroup);

/** Grouped for Settings Remote connectors grid — same list as Keyvault non-AI integrations. */
export function connectorGroups(): { category: string; items: ServiceDef[] }[] {
    const order = ["Cloud & hosting", "Dev & project tools", "Messaging & voice", "Data & payments"];
    const map = new Map<string, ServiceDef[]>();
    for (const s of CONNECTOR_SERVICES) {
        const g = s.connectorGroup ?? "Other";
        if (!map.has(g)) map.set(g, []);
        map.get(g)!.push(s);
    }
    const groups = order.filter((g) => map.has(g)).map((category) => ({ category, items: map.get(category)! }));
    for (const [category, items] of map) {
        if (!order.includes(category)) groups.push({ category, items });
    }
    return groups;
}

export function presetMcpBindings(serviceId: string): MCPToolBinding[] {
    const def = SERVICE_BY_ID[serviceId];
    return (def?.mcpTools ?? []).map((t, i) => ({
        id: `${serviceId}-tool-${i}`,
        name: t.name,
        description: t.description,
        permission: t.write ? "write" : "read",
        requiresConfirmation: Boolean(t.write),
        usageLimit: null,
        callsToday: 0,
    }));
}

function envToken(value: string): string {
    return value
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
}

/** The complete credential schema for a service. OAuth entries use a manual
 * access-token flow in this build; they are never represented as a fake login. */
export function credentialFields(service: ServiceDef): ServiceCredentialField[] {
    const labels = service.authType === "oauth" ? ["Access token"] : (service.fields?.length ? service.fields : ["API key"]);
    return labels.map((label, index) => {
        const primary = index === 0;
        const envVar = primary && service.mcpRuntime?.envVar
            ? service.mcpRuntime.envVar
            : `${envToken(service.id)}_${envToken(label)}`;
        return {
            id: `${service.id}-${envToken(label).toLowerCase()}`,
            label,
            envVar,
            primary,
            secret: !/^(account|email|user|workspace|client id|access key id|api public key|publishable key)$/i.test(label),
            placeholder: service.authType === "oauth"
                ? "Paste a provider-issued access token"
                : `Enter ${label.toLowerCase()}`,
        };
    });
}

/** Account-scoped Settings MCP id for a vault-backed connector. A connection
 * never overwrites another account for the same service. */
export function vaultMcpServerId(serviceId: string, integrationId: string): string {
    return `vault-${envToken(serviceId).toLowerCase()}-${integrationId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}
