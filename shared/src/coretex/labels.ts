// @ts-nocheck
// Coretex Relay — centralized display labels & capitalization.
// All user-facing strings derived from ids/enums flow through here so casing
// stays consistent (roles, providers, model ids, languages, statuses).

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "via"]);

/** Title Case a free string, keeping common small words lowercase (except first). */
export function titleCase(input: string): string {
    const words = input
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .trim()
        .split(/\s+/);
    return words
        .map((w, i) => {
            const lower = w.toLowerCase();
            if (i !== 0 && SMALL_WORDS.has(lower)) return lower;
            if (/^[A-Z0-9]{2,}$/.test(w)) return w; // keep acronyms (API, QA, LLM)
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(" ");
}

const ROLE_LABELS: Record<string, string> = {
    orchestrator: "Orchestrator",
    planner: "Planner",
    researcher: "Researcher",
    developer: "Developer",
    reviewer: "Reviewer",
    writer: "Writer",
    analyst: "Analyst",
    devops: "DevOps",
    qa: "QA",
    custom: "Custom",
};

const PROVIDER_LABELS: Record<string, string> = {
    ollama: "Ollama",
    lmstudio: "LM Studio",
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Gemini",
    openrouter: "OpenRouter",
    openclaw: "OpenClaw",
};

const STATUS_LABELS: Record<string, string> = {
    idle: "Idle",
    thinking: "Thinking",
    working: "Working",
    paused: "Paused",
    error: "Error",
    pending: "Pending",
    assigned: "Assigned",
    in_progress: "In Progress",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    active: "Active",
    ready: "Ready",
    indexing: "Indexing",
    archived: "Archived",
};

export function roleLabel(role: string): string {
    return ROLE_LABELS[role] ?? titleCase(role);
}

export function providerLabel(provider: string): string {
    return PROVIDER_LABELS[provider] ?? titleCase(provider);
}

export function statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? titleCase(status);
}

/**
 * Turn raw provider health / network errors into short Untitled-UI status copy.
 * Keeps badges readable — never dump "fetch failed" or "unconfigured" raw.
 */
export function healthErrorLabel(error: string | undefined | null): string {
    if (!error || !error.trim()) return "Not configured";
    const raw = error.trim();
    const lower = raw.toLowerCase();
    if (
        lower === "fetch failed" ||
        lower === "failed to fetch" ||
        lower.includes("networkerror") ||
        lower.includes("network request failed") ||
        lower.includes("econnrefused") ||
        lower.includes("enotfound")
    ) {
        return "Couldn't reach provider";
    }
    if (lower.includes("not configured") || lower === "unconfigured") {
        return "Not configured";
    }
    if (lower.includes("api key") && (lower.includes("not") || lower.includes("missing") || lower.includes("invalid"))) {
        return lower.includes("invalid") ? "Invalid API key" : "API key required";
    }
    if (lower.includes("unauthorized") || lower.includes("401")) return "Unauthorized";
    if (lower.includes("forbidden") || lower.includes("403")) return "Access denied";
    if (lower.includes("timeout") || lower.includes("timed out")) return "Timed out";
    // Prefer a clean sentence over a raw stack fragment.
    const firstLine = raw.split(/[\n\r]/)[0]!.slice(0, 80);
    return titleCase(firstLine.replace(/^error:\s*/i, ""));
}

/** Pretty-print a model id, keeping version numerals intact (e.g. "llama3.1:latest" -> "Llama 3.1"). */
export function modelLabel(model: string): string {
    const base = model.split(":")[0];
    const cleaned = base.replace(/[_/]+/g, "-");
    return titleCase(cleaned).replace(/\b(\d)\s(\d)/g, "$1.$2");
}

/** "ollama · llama3.1:latest" style provider+model line. */
export function providerModel(provider: string, model: string): string {
    return `${providerLabel(provider)} · ${modelLabel(model)}`;
}

const CAPABILITY_LABELS: Record<string, string> = {
    chat: "Chat",
    vision: "Vision",
    tools: "Tools",
    embedding: "Embedding",
    audio: "Audio",
    image: "Image",
};

export function capabilityLabel(cap: string): string {
    return CAPABILITY_LABELS[cap] ?? titleCase(cap);
}

/** Model family bucket (Llama, GPT, Claude, …). */
export function familyLabel(family: string | undefined): string {
    if (!family?.trim() || family === "—") return "—";
    const known: Record<string, string> = {
        llama: "Llama",
        qwen: "Qwen",
        mistral: "Mistral",
        mixtral: "Mixtral",
        gemma: "Gemma",
        gemini: "Gemini",
        gpt: "GPT",
        claude: "Claude",
        phi: "Phi",
        deepseek: "DeepSeek",
        commandr: "Command R",
        codestral: "Codestral",
        dolphin: "Dolphin",
        hermes: "Hermes",
        yi: "Yi",
        grok: "Grok",
    };
    const key = family.toLowerCase().replace(/-r$/, "r");
    return known[key] ?? titleCase(family);
}

const LANGUAGE_LABELS: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    py: "Python",
    go: "Go",
    rs: "Rust",
    java: "Java",
    md: "Markdown",
    css: "CSS",
    html: "HTML",
    json: "JSON",
    yml: "YAML",
    yaml: "YAML",
    sh: "Shell",
};

export function languageLabel(ext: string): string {
    const key = ext.replace(/^\./, "").toLowerCase();
    return LANGUAGE_LABELS[key] ?? key.toUpperCase();
}

/** Short basename of a file path for citation chips. */
export function fileLabel(path: string): string {
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
}
