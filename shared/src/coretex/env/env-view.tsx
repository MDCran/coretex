// @ts-nocheck
"use client";

// Coretex — Environment Variable Manager. Per-project environments → variables,
// each tied to a company (LogoKit logo) + a use-category. Values hidden by
// default (revealable), with .env import, export (download/copy), and a code-
// block viewer. Persists on the Brain.

import { useEffect, useMemo, useRef, useState } from "react";
import {
    Copy01, Copy04, Download01, Edit01, Eye, EyeOff, FileCode01, Plus, RefreshCcw05, SearchLg, Star01, Trash01, UploadCloud02, X, Key01, Link01, Database01, Hash01, Type01, LayersTwo01,
} from "@untitledui/icons";
import type { Environment, EnvVariable, EnvCategory, EnvKind } from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { Select } from "@/components/base/select/select";
import type { SelectItemType } from "@/components/base/select/select-shared";
import { TextArea } from "@/components/base/textarea/textarea";
import { ConfirmDialog, useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { cx } from "@/utils/cx";
import { BrandLogo } from "../ui/brand-logo";
import { ProjectIcon } from "../ui/project-icon";
import { ColorPicker } from "../ui/color-picker";
import { useContextMenu, type MenuItem } from "../ui/context-menu";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { copySecretToClipboard, SecretsEmptyState, SecretsPageLayout, SecretsToolbar } from "../secrets/secrets-page";

const CATEGORIES: { id: EnvCategory; label: string; color: string; emoji: string }[] = [
    { id: "database", label: "Database", color: "#22c55e", emoji: "🗄️" },
    { id: "auth", label: "Auth", color: "#ef4444", emoji: "🔐" },
    { id: "api", label: "API", color: "#3b82f6", emoji: "🔌" },
    { id: "storage", label: "Storage", color: "#8b5cf6", emoji: "📦" },
    { id: "payment", label: "Payment", color: "#f59e0b", emoji: "💳" },
    { id: "analytics", label: "Analytics", color: "#6366f1", emoji: "📊" },
    { id: "email", label: "Email", color: "#ec4899", emoji: "✉️" },
    { id: "ai", label: "AI/ML", color: "#14b8a6", emoji: "🤖" },
    { id: "cdn", label: "CDN", color: "#f97316", emoji: "🌐" },
    { id: "cache", label: "Cache", color: "#0ea5e9", emoji: "⚡" },
    { id: "queue", label: "Queue", color: "#64748b", emoji: "📬" },
    { id: "custom", label: "Custom", color: "#667085", emoji: "⚙️" },
];
const catMeta = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[11];

const KIND_META: Record<EnvKind, { emoji: string; color: string }> = {
    production: { emoji: "🟢", color: "#22c55e" },
    staging: { emoji: "🟡", color: "#f59e0b" },
    sandbox: { emoji: "🟠", color: "#f97316" },
    local: { emoji: "🔵", color: "#3b82f6" },
    testing: { emoji: "⚪", color: "#94a3b8" },
    preview: { emoji: "🟣", color: "#8b5cf6" },
    custom: { emoji: "⚙️", color: "#667085" },
};

function valueType(v: string): { icon: typeof Key01; label: string } {
    if (/^https?:\/\//i.test(v)) return { icon: Link01, label: "URL" };
    if (v.includes("://")) return { icon: Database01, label: "Connection string" };
    if (/^\d+$/.test(v)) return { icon: Hash01, label: "Number" };
    if (v.length >= 20 && /^[A-Za-z0-9_\-.]+$/.test(v)) return { icon: Key01, label: "API key / secret" };
    return { icon: Type01, label: "String" };
}

function dots(v: string): string {
    return "●".repeat(Math.min(Math.max(v.length, 6), 28));
}

/** Right-click menu for a variable row — mirrors the per-row action buttons + a "Copy as KEY=VALUE". */
function varMenu(opts: {
    v: EnvVariable;
    revealed: boolean;
    onReveal: () => void;
    onCopyValue: () => void;
    onEdit: () => void;
    onDelete: () => void;
}): MenuItem[] {
    const { v, revealed, onReveal, onCopyValue, onEdit, onDelete } = opts;
    return [
        { header: v.name },
        { key: "copy", label: "Copy value", icon: Copy01, onClick: onCopyValue },
        { key: "copykv", label: "Copy as KEY=VALUE", icon: Copy04, onClick: () => void copySecretToClipboard(`${v.name}=${v.value}`) },
        { key: "reveal", label: revealed ? "Hide value" : "Reveal value", icon: revealed ? EyeOff : Eye, onClick: onReveal },
        { key: "edit", label: "Edit", icon: Edit01, onClick: onEdit },
        { separator: true },
        { key: "delete", label: "Delete variable", icon: Trash01, danger: true, onClick: onDelete },
    ];
}

function genSecret(len = 32): string {
    const a = new Uint8Array(len);
    if (typeof crypto !== "undefined") crypto.getRandomValues(a);
    return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, "").slice(0, len);
}

function genId(): string {
    return `var_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Auto-detect the company (for the logo) from a variable name prefix.
const COMPANY_BY_PREFIX: { re: RegExp; name: string; domain: string }[] = [
    { re: /^SUPABASE/, name: "Supabase", domain: "supabase.com" },
    { re: /^STRIPE/, name: "Stripe", domain: "stripe.com" },
    { re: /^OPENAI/, name: "OpenAI", domain: "openai.com" },
    { re: /^ANTHROPIC|^CLAUDE/, name: "Anthropic", domain: "anthropic.com" },
    { re: /^GEMINI|^GOOGLE/, name: "Google", domain: "google.com" },
    { re: /^REDIS|^UPSTASH/, name: "Upstash", domain: "upstash.com" },
    { re: /^AWS|^S3_/, name: "AWS", domain: "aws.amazon.com" },
    { re: /^GITHUB|^GH_/, name: "GitHub", domain: "github.com" },
    { re: /^VERCEL/, name: "Vercel", domain: "vercel.com" },
    { re: /^RESEND/, name: "Resend", domain: "resend.com" },
    { re: /^SENDGRID/, name: "SendGrid", domain: "sendgrid.com" },
    { re: /^TWILIO/, name: "Twilio", domain: "twilio.com" },
    { re: /^MONGO/, name: "MongoDB", domain: "mongodb.com" },
    { re: /^CLOUDFLARE|^CF_/, name: "Cloudflare", domain: "cloudflare.com" },
    { re: /^POSTHOG/, name: "PostHog", domain: "posthog.com" },
    { re: /^SENTRY/, name: "Sentry", domain: "sentry.io" },
    { re: /^GROQ/, name: "Groq", domain: "groq.com" },
    { re: /^MISTRAL/, name: "Mistral", domain: "mistral.ai" },
];
function detectCompany(name: string): { name: string; domain: string } | null {
    for (const c of COMPANY_BY_PREFIX) if (c.re.test(name)) return { name: c.name, domain: c.domain };
    return null;
}
function detectUse(name: string): EnvCategory {
    if (/DATABASE|^DB_|POSTGRES|MYSQL|MONGO|SUPABASE/.test(name)) return "database";
    if (/STRIPE|PAYMENT|PADDLE/.test(name)) return "payment";
    if (/OPENAI|ANTHROPIC|GEMINI|GROQ|MISTRAL|^AI_|LLM/.test(name)) return "ai";
    if (/REDIS|UPSTASH|CACHE/.test(name)) return "cache";
    if (/S3|BUCKET|STORAGE|UPLOAD|R2_/.test(name)) return "storage";
    if (/SENDGRID|RESEND|SMTP|EMAIL|^MAIL/.test(name)) return "email";
    if (/ANALYTICS|POSTHOG|MIXPANEL|SEGMENT/.test(name)) return "analytics";
    if (/CDN|CLOUDFLARE/.test(name)) return "cdn";
    if (/AUTH|JWT|SECRET|TOKEN|_KEY|PASSWORD|NEXTAUTH|CLIENT_ID/.test(name)) return "auth";
    return "custom";
}

function toEnvFile(env: Environment, projectName: string, mask: boolean): string {
    const byCat = new Map<string, EnvVariable[]>();
    for (const v of env.variables) {
        const arr = byCat.get(v.category) ?? [];
        arr.push(v);
        byCat.set(v.category, arr);
    }
    const lines: string[] = [
        "# ============================================",
        `# CORETEX — PROJECT: ${projectName}`,
        `# ENVIRONMENT: ${env.name}`,
        "# ============================================",
        "",
    ];
    for (const [cat, vars] of byCat) {
        const m = catMeta(cat);
        const company = vars.find((v) => v.companyName)?.companyName;
        lines.push(`# ── ${m.label.toUpperCase()}${company ? ` (${company})` : ""} ──────────────`);
        // Masked export uses a fixed placeholder so the doc never leaks each secret's length.
        for (const v of vars) lines.push(`${v.name}=${mask ? "<redacted>" : v.value}`);
        lines.push("");
    }
    return lines.join("\n");
}

export const EnvView = ({ state, actions, lockedProjectId, embedded = false }: { state: CoretexState; actions: CoretexActions; /** When set, lock the UI to this project (no project picker). */ lockedProjectId?: string; /** Hide the identity header when a parent Secrets surface owns it. */ embedded?: boolean }) => {
    const env = state.env;
    const projects = useMemo(() => [{ id: "default", name: "Default", icon: undefined as string | undefined, color: undefined as string | undefined }, ...state.projects.map((p) => ({ id: p.id, name: p.name, icon: p.icon, color: p.color }))], [state.projects]);
    const [mode, setMode] = useState<"project" | "all">("project");
    const [projectId, setProjectId] = useState(lockedProjectId ?? "default");
    const [envId, setEnvId] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [revealed, setRevealed] = useState<Set<string>>(new Set());
    const [editing, setEditing] = useState<{ envId: string; variable: EnvVariable | null } | null>(null);
    const [editEnv, setEditEnv] = useState<Environment | null>(null);
    const [showCode, setShowCode] = useState(false);
    const [showExport, setShowExport] = useState(false);
    /** Pending plaintext-export action awaiting confirmation, or null. */
    const [confirmExport, setConfirmExport] = useState<"download" | "copy" | null>(null);
    const [newEnv, setNewEnv] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    // All-variables view filters.
    const [fProject, setFProject] = useState("");
    const [fEnv, setFEnv] = useState("");
    const [fUse, setFUse] = useState("");

    useEffect(() => {
        actions.envGet();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (lockedProjectId) {
            setProjectId(lockedProjectId);
            setMode("project");
        }
    }, [lockedProjectId]);

    const environments = (env?.environments ?? []).filter((e) => e.projectId === projectId);
    useEffect(() => {
        if (environments.length > 0 && (!envId || !environments.some((e) => e.id === envId))) {
            setEnvId(environments.find((e) => e.isDefault)?.id ?? environments[0].id);
        }
    }, [environments, envId]);

    const current = environments.find((e) => e.id === envId) ?? null;
    const projectName = projects.find((p) => p.id === projectId)?.name ?? "Default";

    const variables = useMemo(() => {
        const vars = current?.variables ?? [];
        const q = search.trim().toLowerCase();
        return q ? vars.filter((v) => `${v.name} ${v.value} ${v.companyName ?? ""}`.toLowerCase().includes(q)) : vars;
    }, [current, search]);

    const toggleReveal = (id: string) => setRevealed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const ctx = useContextMenu();
    const deletion = useConfirm();

    const requestDeleteVariable = (environmentId: string, variable: EnvVariable) => deletion.confirm({
        title: `Delete ${variable.name}?`,
        description: "This removes the variable and its stored value from this environment. This action cannot be undone.",
        confirmLabel: "Delete variable",
        onConfirm: () => actions.envDeleteVar(environmentId, variable.id),
    });

    const requestDeleteEnvironment = (environment: Environment) => deletion.confirm({
        title: `Delete ${environment.name}?`,
        description: `This permanently removes the environment and ${environment.variables.length} stored variable${environment.variables.length === 1 ? "" : "s"}.`,
        confirmLabel: "Delete environment",
        onConfirm: () => actions.envDeleteEnvironment(environment.id),
    });

    const onImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !current) return;
        const r = new FileReader();
        r.onload = () => actions.envImport(current.id, typeof r.result === "string" ? r.result : "");
        r.readAsText(file);
    };

    const downloadText = (text: string, filename: string) => {
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };
    /** Download the .env WITH plaintext values (gated behind a confirm). */
    const exportValues = () => {
        if (!current) return;
        downloadText(toEnvFile(current, projectName, false), `.env.${current.name.toLowerCase()}`);
        setConfirmExport(null);
        setShowExport(false);
    };
    /** Copy the .env WITH plaintext values to the clipboard (gated behind a confirm). */
    const copyValues = () => {
        if (current) void copySecretToClipboard(toEnvFile(current, projectName, false));
        setConfirmExport(null);
        setShowExport(false);
    };
    /** Download an env DOC: variable names with masked values — safe to share, no secrets. */
    const exportDoc = () => {
        if (!current) return;
        downloadText(toEnvFile(current, projectName, true), `.env.${current.name.toLowerCase()}.doc`);
        setShowExport(false);
    };

    const createEnvironment = (name: string, kind: EnvKind, color: string) => {
        actions.envUpsertEnvironment({ id: `env_${Date.now().toString(36)}`, projectId, name, kind, color, isDefault: false, variables: [], updatedAt: Date.now() });
        setNewEnv(false);
    };
    const setDefaultEnv = (e: Environment) => environments.forEach((x) => actions.envUpsertEnvironment({ ...x, isDefault: x.id === e.id }));
    const cloneEnv = (e: Environment) => actions.envUpsertEnvironment({
        id: `env_${Date.now().toString(36)}`, projectId, name: `${e.name} copy`, kind: e.kind, color: e.color, isDefault: false,
        variables: e.variables.map((v) => ({ ...v, id: genId() })), updatedAt: Date.now(),
    });

    // Global "All variables" aggregate (every project + environment), filterable.
    const projName = (pid: string) => projects.find((p) => p.id === pid)?.name ?? pid;
    const allEnvNames = useMemo(() => Array.from(new Set((env?.environments ?? []).map((e) => e.name))), [env]);
    const allRows = useMemo(() => {
        const rows = (env?.environments ?? []).flatMap((e) => e.variables.map((v) => ({ env: e, v })));
        const q = search.trim().toLowerCase();
        return rows.filter(({ env: e, v }) => {
            if (fProject && e.projectId !== fProject) return false;
            if (fEnv && e.name !== fEnv) return false;
            if (fUse && v.category !== fUse) return false;
            if (q && !`${v.name} ${v.value} ${v.companyName ?? ""} ${v.note ?? ""} ${projName(e.projectId)}`.toLowerCase().includes(q)) return false;
            return true;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [env, search, fProject, fEnv, fUse]);

    return (
        <SecretsPageLayout
            icon={FileCode01}
            title="Environment variables"
            description={lockedProjectId
                ? "Manage this project's runtime configuration across local, staging, and production environments."
                : "Keep per-project runtime configuration organized, stored locally, and ready for your agents and tools."}
            badge={lockedProjectId ? "Project secrets" : "Stored locally"}
            stats={[
                { label: "Environments", value: environments.length, color: "#3b82f6" },
                { label: "Variables", value: environments.reduce((total, item) => total + item.variables.length, 0), color: "var(--brand)" },
                { label: "Selected", value: current?.name ?? "—", color: current?.color ?? "#94a3b8" },
            ]}
            compact={!!lockedProjectId}
            hideHeader={embedded}
            actions={!embedded ? (
                <Button size="sm" color="primary" iconLeading={Plus} onClick={() => current && setEditing({ envId: current.id, variable: null })} isDisabled={!current || mode === "all"}>
                    Add variable
                </Button>
            ) : undefined}
        >
            {/* TOP BAR */}
            <SecretsToolbar className="mb-4 shrink-0">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    {/* Project picker sits to the LEFT of the scope toggle with its width always reserved,
                        so switching between "By project" and "All variables" never shifts the toggle. */}
                    {!lockedProjectId && (
                        <div className="w-48 shrink-0">
                            {mode === "project" && <ProjectSelect projects={projects} value={projectId} onChange={setProjectId} />}
                        </div>
                    )}
                    {/* Scope: pick a project vs the global aggregate (no implicit "current project" here) */}
                    {!lockedProjectId && (
                        <div className="flex h-9 shrink-0 overflow-hidden rounded-lg" style={{ border: "1px solid var(--c-border)" }}>
                            <button type="button" onClick={() => setMode("project")} className={cx("flex items-center px-3 text-xs font-medium transition", mode === "project" ? "text-primary" : "text-tertiary")} style={{ background: mode === "project" ? "var(--surface-2)" : "transparent" }}>By project</button>
                            <button type="button" onClick={() => setMode("all")} className={cx("flex items-center gap-1 px-3 text-xs font-medium transition", mode === "all" ? "text-primary" : "text-tertiary")} style={{ background: mode === "all" ? "var(--surface-2)" : "transparent" }}><LayersTwo01 className="size-3.5" /> All variables</button>
                        </div>
                    )}
                    {/* Import / View-as-code / Export stay visible in BOTH modes (disabled until a project's env is selected). */}
                    <>
                            <Button size="sm" color="secondary" iconLeading={UploadCloud02} onClick={() => fileRef.current?.click()} isDisabled={!current}>Import .env</Button>
                            <input ref={fileRef} type="file" accept=".env,text/plain" hidden onChange={onImport} />
                            <Button size="sm" color="secondary" iconLeading={FileCode01} onClick={() => setShowCode(true)} isDisabled={!current}>View as code</Button>
                            <div className="relative">
                                <Button size="sm" color="secondary" iconLeading={Download01} onClick={() => setShowExport((v) => !v)} isDisabled={!current}>Export</Button>
                                {showExport && (
                                    <>
                                        <div className="fixed inset-0 z-20" onClick={() => setShowExport(false)} />
                                        <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-lg p-1 shadow-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                            <button type="button" onClick={exportDoc} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-secondary hover:bg-[var(--surface-2)]"><FileCode01 className="size-3.5" /> Download env doc (masked)</button>
                                            <div className="my-1" style={{ borderTop: "1px solid var(--c-border)" }} />
                                            <p className="px-2.5 pb-0.5 pt-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--c-text-muted)" }}>Includes secret values</p>
                                            <button type="button" onClick={() => { setConfirmExport("download"); setShowExport(false); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-secondary hover:bg-[var(--surface-2)]"><Download01 className="size-3.5" /> Download .env (with values)</button>
                                            <button type="button" onClick={() => { setConfirmExport("copy"); setShowExport(false); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-secondary hover:bg-[var(--surface-2)]"><Copy01 className="size-3.5" /> Copy .env (with values)</button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </>
                </div>
                {embedded && (
                    <Button size="sm" color="primary" iconLeading={Plus} onClick={() => current && setEditing({ envId: current.id, variable: null })} isDisabled={!current || mode === "all"}>
                        Add variable
                    </Button>
                )}
            </SecretsToolbar>

            {mode === "all" ? (
                <AllVarsTable
                    rows={allRows}
                    search={search}
                    setSearch={setSearch}
                    projects={projects}
                    envNames={allEnvNames}
                    fProject={fProject} setFProject={setFProject}
                    fEnv={fEnv} setFEnv={setFEnv}
                    fUse={fUse} setFUse={setFUse}
                    revealed={revealed} toggleReveal={toggleReveal} projName={projName}
                    onEdit={(envObj, v) => setEditing({ envId: envObj.id, variable: v })}
                    onDelete={(envObj, v) => requestDeleteVariable(envObj.id, v)}
                />
            ) : (
            <div className="flex min-h-0 flex-1 gap-4">
                {/* LEFT — environment tabs */}
                <aside className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto rounded-xl p-2" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                    <span className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-quaternary">Environments</span>
                    {environments.map((e) => {
                        const active = e.id === envId;
                        const km = KIND_META[e.kind];
                        return (
                            <div key={e.id} onClick={() => setEnvId(e.id)} className={cx("group flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition", active ? "" : "hover:bg-[var(--surface-2)]")} style={{ background: active ? "var(--surface-2)" : undefined, borderLeft: `2px solid ${active ? e.color : "transparent"}` }}>
                                <span className="text-sm">{km.emoji}</span>
                                <div className="min-w-0 flex-1">
                                    <p className={cx("truncate text-sm", active ? "font-semibold text-primary" : "text-secondary")}>{e.name}</p>
                                    <p className="text-xs text-quaternary">{e.variables.length} vars{e.isDefault ? " · default" : ""}</p>
                                </div>
                                <span className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100" onClick={(ev) => ev.stopPropagation()}>
                                    {!e.isDefault && <button type="button" title="Set as default" onClick={() => setDefaultEnv(e)} className="rounded p-1 text-quaternary hover:text-warning-primary"><Star01 className="size-3.5" /></button>}
                                    <button type="button" title="Edit environment" onClick={() => setEditEnv(e)} className="rounded p-1 text-quaternary hover:text-secondary"><Edit01 className="size-3.5" /></button>
                                    <button type="button" title="Duplicate" onClick={() => cloneEnv(e)} className="rounded p-1 text-quaternary hover:text-secondary"><Copy04 className="size-3.5" /></button>
                                    {environments.length > 1 && <button type="button" title="Delete environment" onClick={() => requestDeleteEnvironment(e)} className="rounded p-1 text-quaternary hover:text-error-primary"><Trash01 className="size-3.5" /></button>}
                                </span>
                            </div>
                        );
                    })}
                    <Button size="sm" color="tertiary" iconLeading={Plus} className="mt-1" onClick={() => setNewEnv(true)}>Add environment</Button>
                </aside>

                {/* CENTER — variable table */}
                <div className="flex min-w-0 flex-1 flex-col rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                    <div className="flex items-center gap-2 border-b border-secondary p-3">
                        <div className="flex-1 max-w-sm">
                            <Input value={search} onChange={setSearch} placeholder="Filter by name, company, or value" icon={SearchLg} size="sm" />
                        </div>
                        <span className="ml-auto text-xs text-quaternary">{variables.length} variable{variables.length === 1 ? "" : "s"}</span>
                        <Button size="sm" color="secondary" iconLeading={RefreshCcw05} onClick={() => actions.envGet()} />
                    </div>

                    <div className="min-h-0 flex-1 overflow-auto">
                        {!current ? (
                            <SecretsEmptyState icon={LayersTwo01} title="No environment selected" description="Choose an environment from the left, or create one to start storing variables." />
                        ) : variables.length === 0 ? (
                            <SecretsEmptyState
                                icon={FileCode01}
                                title={`No variables in ${current.name}`}
                                description="Add a variable manually or import an existing .env file."
                                action={<Button size="sm" color="primary" iconLeading={Plus} onClick={() => setEditing({ envId: current.id, variable: null })}>Add variable</Button>}
                            />
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs text-quaternary" style={{ borderBottom: "1px solid var(--c-border)" }}>
                                        <th className="px-4 py-2 font-medium">Company</th>
                                        <th className="px-2 py-2 font-medium">Use</th>
                                        <th className="px-2 py-2 font-medium">Variable</th>
                                        <th className="px-2 py-2 font-medium">Value</th>
                                        <th className="px-2 py-2 font-medium"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {variables.map((v) => {
                                        const m = catMeta(v.category);
                                        const vt = valueType(v.value);
                                        const VtIcon = vt.icon;
                                        const open = revealed.has(v.id);
                                        return (
                                            <tr key={v.id} className="group transition hover:bg-[var(--surface-2)]" style={{ borderBottom: "1px solid var(--c-border)" }} onContextMenu={(e) => current && ctx.open(e, varMenu({ v, revealed: open, onReveal: () => toggleReveal(v.id), onCopyValue: () => void copySecretToClipboard(v.value), onEdit: () => setEditing({ envId: current.id, variable: v }), onDelete: () => requestDeleteVariable(current.id, v) }))}>
                                                <td className="px-4 py-2.5">
                                                    {v.companyDomain ? (
                                                        <span className="flex items-center gap-2">
                                                            <BrandLogo domain={v.companyDomain} name={v.companyName} size={20} />
                                                            <span className="truncate text-xs text-secondary">{v.companyName}</span>
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-quaternary">—</span>
                                                    )}
                                                </td>
                                                <td className="px-2 py-2.5">
                                                    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium" style={{ background: m.color + "22", color: m.color }}>{m.emoji} {m.label}</span>
                                                </td>
                                                <td className="px-2 py-2.5">
                                                    <span className="font-mono text-xs font-semibold" style={{ color: "var(--brand)" }}>{v.name}</span>
                                                    {v.note && <p className="truncate text-[11px] text-quaternary" title={v.note}>{v.note}</p>}
                                                </td>
                                                <td className="px-2 py-2.5">
                                                    <span className="flex items-center gap-2">
                                                        <VtIcon className="size-3.5 shrink-0 text-quaternary" />
                                                        <span className="max-w-[280px] truncate font-mono text-xs text-secondary">{open ? v.value : dots(v.value)}</span>
                                                    </span>
                                                </td>
                                                <td className="px-2 py-2.5">
                                                    <span className="flex items-center justify-end gap-0.5 opacity-60 transition group-hover:opacity-100">
                                                        <button type="button" title={open ? "Hide" : "Reveal"} onClick={() => toggleReveal(v.id)} className="rounded p-1 hover:bg-[var(--surface)]">{open ? <EyeOff className="size-3.5 text-tertiary" /> : <Eye className="size-3.5 text-tertiary" />}</button>
                                                        <button type="button" title="Copy value (clears in 30s)" onClick={() => void copySecretToClipboard(v.value)} className="rounded p-1 hover:bg-[var(--surface)]"><Copy01 className="size-3.5 text-tertiary" /></button>
                                                        <button type="button" title="Edit" onClick={() => current && setEditing({ envId: current.id, variable: v })} className="rounded p-1 hover:bg-[var(--surface)]"><Edit01 className="size-3.5 text-tertiary" /></button>
                                                        <button type="button" title="Delete" onClick={() => current && requestDeleteVariable(current.id, v)} className="rounded p-1 hover:bg-[var(--surface)]"><Trash01 className="size-3.5 text-error-primary" /></button>
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>
            )}

            {editing && (() => {
                const srcEnv = (env?.environments ?? []).find((x) => x.id === editing.envId);
                const source = srcEnv ? `${projName(srcEnv.projectId)} · ${srcEnv.name}` : undefined;
                return <VarModal variable={editing.variable} source={source} onSave={(vr) => { actions.envUpsertVar(editing.envId, vr); setEditing(null); }} onClose={() => setEditing(null)} />;
            })()}
            {showCode && current && <CodeViewer env={current} projectName={projectName} onClose={() => setShowCode(false)} />}
            {newEnv && <NewEnvModal onCreate={createEnvironment} onClose={() => setNewEnv(false)} />}
            {editEnv && <EditEnvModal env={editEnv} onSave={(patch) => { actions.envUpsertEnvironment({ ...editEnv, ...patch, updatedAt: Date.now() }); setEditEnv(null); }} onClose={() => setEditEnv(null)} />}
            <ConfirmDialog
                isOpen={confirmExport !== null}
                onOpenChange={(open) => !open && setConfirmExport(null)}
                title="Export plaintext secret values?"
                description={(
                    <>
                        This {confirmExport === "download" ? "downloads a .env file" : "copies the .env"} for <span className="font-medium text-secondary">{projectName} · {current?.name}</span> with plaintext values. Keep it safe and never commit it.
                    </>
                )}
                confirmLabel={confirmExport === "download" ? "Download with values" : "Copy with values"}
                destructive={false}
                onConfirm={() => confirmExport === "download" ? exportValues() : copyValues()}
            />
            {ctx.node}
            {deletion.dialog}
        </SecretsPageLayout>
    );
};

// ---- add/edit variable modal ----
const VarModal = ({ variable, source, onSave, onClose }: { variable: EnvVariable | null; source?: string; onSave: (v: EnvVariable) => void; onClose: () => void }) => {
    const [name, setName] = useState(variable?.name ?? "");
    const [value, setValue] = useState(variable?.value ?? "");
    const [category, setCategory] = useState<EnvCategory>(variable?.category ?? "custom");
    const [companyName, setCompanyName] = useState(variable?.companyName ?? "");
    const [companyDomain, setCompanyDomain] = useState(variable?.companyDomain ?? "");
    const [note, setNote] = useState(variable?.note ?? "");
    const [reveal, setReveal] = useState(false);

    // Auto-detect the company (logo) + use category from the variable name.
    const onName = (raw: string) => {
        const n = raw.toUpperCase().replace(/\s+/g, "_");
        setName(n);
        if (!companyName.trim()) {
            const c = detectCompany(n);
            if (c) { setCompanyName(c.name); setCompanyDomain(c.domain); }
        }
        if (category === "custom") {
            const u = detectUse(n);
            if (u !== "custom") setCategory(u);
        }
    };

    const save = () => {
        if (!name.trim()) return;
        onSave({
            id: variable?.id ?? genId(),
            name: name.trim().toUpperCase().replace(/\s+/g, "_"),
            value,
            category,
            companyName: companyName.trim() || undefined,
            companyDomain: companyDomain.trim() || undefined,
            note: note.trim() || undefined,
            tags: variable?.tags ?? [],
        });
    };

    return (
        <Overlay onClose={onClose} title={variable ? "Edit variable" : "Add variable"}>
            <div className="flex flex-col gap-4">
                {source && (
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                        <LayersTwo01 className="size-3.5 text-quaternary" />
                        <span className="text-tertiary">From</span>
                        <span className="font-medium text-secondary">{source}</span>
                    </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Company name"><Input value={companyName} onChange={setCompanyName} placeholder="Supabase" size="sm" /></Field>
                    <Field label="Company domain">
                        <span className="flex items-center gap-2">
                            {companyDomain && <BrandLogo domain={companyDomain} name={companyName} size={22} />}
                            <Input value={companyDomain} onChange={setCompanyDomain} placeholder="supabase.com" size="sm" />
                        </span>
                    </Field>
                </div>
                <Field label="Variable name"><Input value={name} onChange={onName} placeholder="DATABASE_URL" /></Field>
                <Field label="Value">
                    <div className="flex items-center gap-2">
                        <div className="flex-1"><Input type={reveal ? "text" : "password"} value={value} onChange={setValue} placeholder="value" /></div>
                        <Button size="sm" color="tertiary" iconLeading={reveal ? EyeOff : Eye} onClick={() => setReveal((v) => !v)} />
                        <Button size="sm" color="secondary" iconLeading={Key01} onClick={() => { setValue(genSecret()); setReveal(true); }}>Generate</Button>
                    </div>
                </Field>
                <Field label="Use / category">
                    <div className="flex flex-wrap gap-1.5">
                        {CATEGORIES.map((c) => (
                            <button key={c.id} type="button" onClick={() => setCategory(c.id)} className={cx("rounded-md px-2 py-1 text-xs font-medium transition", category === c.id ? "" : "text-tertiary hover:bg-[var(--surface-2)]")} style={category === c.id ? { background: c.color + "22", color: c.color, border: `1px solid ${c.color}` } : { border: "1px solid var(--c-border)" }}>{c.emoji} {c.label}</button>
                        ))}
                    </div>
                </Field>
                <Field label="Note">
                    <TextArea value={note} onChange={setNote} rows={2} placeholder="Optional note (markdown)…" />
                </Field>
                <div className="flex justify-end gap-2">
                    <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                    <Button size="sm" color="primary" onClick={save}>{variable ? "Save" : "Add variable"}</Button>
                </div>
            </div>
        </Overlay>
    );
};

// ---- new environment modal ----
const NewEnvModal = ({ onCreate, onClose }: { onCreate: (name: string, kind: EnvKind, color: string) => void; onClose: () => void }) => {
    const [name, setName] = useState("");
    const [kind, setKind] = useState<EnvKind>("staging");
    const [color, setColor] = useState(KIND_META.staging.color);
    return (
        <Overlay onClose={onClose} title="New environment">
            <div className="flex flex-col gap-4">
                <Field label="Name"><Input value={name} onChange={setName} placeholder="Staging" /></Field>
                <Field label="Type">
                    <NativeSelect options={(Object.keys(KIND_META) as EnvKind[]).map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: k }))} value={kind} onChange={(e) => { const k = e.target.value as EnvKind; setKind(k); setColor(KIND_META[k].color); }} />
                </Field>
                <Field label="Color"><ColorPicker value={color} onChange={setColor} allowCustom={false} /></Field>
                <div className="flex justify-end gap-2">
                    <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                    <Button size="sm" color="primary" onClick={() => name.trim() && onCreate(name.trim(), kind, color)}>Create</Button>
                </div>
            </div>
        </Overlay>
    );
};

// ---- global "All variables" aggregate table ----
// ---- project picker with project icons (Untitled UI Select) ----
const ProjectSelect = ({ projects, value, onChange }: { projects: { id: string; name: string; icon?: string; color?: string }[]; value: string; onChange: (id: string) => void }) => {
    const items: SelectItemType[] = projects.map((p) => ({ id: p.id, label: p.name, icon: <ProjectIcon icon={p.icon} color={p.color} size={18} tile={false} /> }));
    return (
        <Select aria-label="Project" size="sm" items={items} selectedKey={value || null} onSelectionChange={(k) => onChange(String(k))}>
            {(item: SelectItemType) => (
                <Select.Item id={item.id} icon={item.icon}>
                    {item.label}
                </Select.Item>
            )}
        </Select>
    );
};

const AllVarsTable = ({
    rows, search, setSearch, projects, envNames, fProject, setFProject, fEnv, setFEnv, fUse, setFUse, revealed, toggleReveal, projName, onEdit, onDelete,
}: {
    rows: { env: Environment; v: EnvVariable }[];
    search: string; setSearch: (s: string) => void;
    projects: { id: string; name: string }[]; envNames: string[];
    fProject: string; setFProject: (s: string) => void;
    fEnv: string; setFEnv: (s: string) => void;
    fUse: string; setFUse: (s: string) => void;
    revealed: Set<string>; toggleReveal: (id: string) => void; projName: (pid: string) => string;
    onEdit: (env: Environment, v: EnvVariable) => void; onDelete: (env: Environment, v: EnvVariable) => void;
}) => {
    const ctx = useContextMenu();
    return (
    <div className="flex min-w-0 flex-1 flex-col rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
        <div className="flex flex-wrap items-center gap-2 border-b border-secondary p-3">
            <div className="min-w-48 flex-1 max-w-sm"><Input value={search} onChange={setSearch} placeholder="Search across all projects" icon={SearchLg} size="sm" /></div>
            <div className="w-40"><NativeSelect options={[{ label: "All projects", value: "" }, ...projects.map((p) => ({ label: p.name, value: p.id }))]} value={fProject} onChange={(e) => setFProject(e.target.value)} /></div>
            <div className="w-36"><NativeSelect options={[{ label: "All environments", value: "" }, ...envNames.map((n) => ({ label: n, value: n }))]} value={fEnv} onChange={(e) => setFEnv(e.target.value)} /></div>
            <div className="w-32"><NativeSelect options={[{ label: "All uses", value: "" }, ...CATEGORIES.map((c) => ({ label: c.label, value: c.id }))]} value={fUse} onChange={(e) => setFUse(e.target.value)} /></div>
            <span className="ml-auto text-xs text-quaternary">{rows.length} variable{rows.length === 1 ? "" : "s"}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
            {rows.length === 0 ? (
                <SecretsEmptyState icon={SearchLg} title="No variables match" description="Try a different search or clear one of the project, environment, or use filters." />
            ) : (
                <table className="min-w-[900px] w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-quaternary" style={{ borderBottom: "1px solid var(--c-border)" }}>
                            <th className="px-4 py-2 font-medium">Project</th>
                            <th className="px-2 py-2 font-medium">Env</th>
                            <th className="px-2 py-2 font-medium">Company</th>
                            <th className="px-2 py-2 font-medium">Use</th>
                            <th className="px-2 py-2 font-medium">Variable</th>
                            <th className="px-2 py-2 font-medium">Value</th>
                            <th className="px-2 py-2 font-medium"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(({ env: e, v }) => {
                            const m = catMeta(v.category);
                            const vt = valueType(v.value);
                            const VtIcon = vt.icon;
                            const open = revealed.has(v.id);
                            const km = KIND_META[e.kind];
                            return (
                                <tr key={`${e.id}:${v.id}`} onClick={() => onEdit(e, v)} onContextMenu={(ev) => ctx.open(ev, varMenu({ v, revealed: open, onReveal: () => toggleReveal(v.id), onCopyValue: () => void copySecretToClipboard(v.value), onEdit: () => onEdit(e, v), onDelete: () => onDelete(e, v) }))} className="group cursor-pointer transition hover:bg-[var(--surface-2)]" title="Click to view / edit" style={{ borderBottom: "1px solid var(--c-border)" }}>
                                    <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium" style={{ background: "var(--surface-2)", color: "var(--c-text-secondary)" }}>{projName(e.projectId)}</span></td>
                                    <td className="px-2 py-2.5"><span className="inline-flex items-center gap-1 text-xs" style={{ color: e.color }}>{km.emoji} {e.name}</span></td>
                                    <td className="px-2 py-2.5">{v.companyDomain ? <span className="flex items-center gap-1.5"><BrandLogo domain={v.companyDomain} name={v.companyName} size={18} /><span className="truncate text-xs text-secondary">{v.companyName}</span></span> : <span className="text-xs text-quaternary">—</span>}</td>
                                    <td className="px-2 py-2.5"><span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium" style={{ background: m.color + "22", color: m.color }}>{m.emoji} {m.label}</span></td>
                                    <td className="px-2 py-2.5"><span className="font-mono text-xs font-semibold" style={{ color: "var(--brand)" }}>{v.name}</span>{v.note && <p className="truncate text-[11px] text-quaternary" title={v.note}>{v.note}</p>}</td>
                                    <td className="px-2 py-2.5"><span className="flex items-center gap-2"><VtIcon className="size-3.5 shrink-0 text-quaternary" /><span className="max-w-[220px] truncate font-mono text-xs text-secondary">{open ? v.value : dots(v.value)}</span></span></td>
                                    <td className="px-2 py-2.5">
                                        <span className="flex items-center justify-end gap-0.5 opacity-60 transition group-hover:opacity-100" onClick={(ev) => ev.stopPropagation()}>
                                            <button type="button" title={open ? "Hide" : "Reveal"} onClick={() => toggleReveal(v.id)} className="rounded p-1 hover:bg-[var(--surface)]">{open ? <EyeOff className="size-3.5 text-tertiary" /> : <Eye className="size-3.5 text-tertiary" />}</button>
                                            <button type="button" title="Copy value (clears in 30s)" onClick={() => void copySecretToClipboard(v.value)} className="rounded p-1 hover:bg-[var(--surface)]"><Copy01 className="size-3.5 text-tertiary" /></button>
                                            <button type="button" title="Edit" onClick={() => onEdit(e, v)} className="rounded p-1 hover:bg-[var(--surface)]"><Edit01 className="size-3.5 text-tertiary" /></button>
                                            <button type="button" title="Delete" onClick={() => onDelete(e, v)} className="rounded p-1 hover:bg-[var(--surface)]"><Trash01 className="size-3.5 text-error-primary" /></button>
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </div>
        {ctx.node}
    </div>
    );
};

// ---- edit environment modal ----
const EditEnvModal = ({ env, onSave, onClose }: { env: Environment; onSave: (patch: Partial<Environment>) => void; onClose: () => void }) => {
    const [name, setName] = useState(env.name);
    const [kind, setKind] = useState<EnvKind>(env.kind);
    const [color, setColor] = useState(env.color);
    return (
        <Overlay onClose={onClose} title={`Edit · ${env.name}`}>
            <div className="flex flex-col gap-4">
                <Field label="Name"><Input value={name} onChange={setName} /></Field>
                <Field label="Type"><NativeSelect options={(Object.keys(KIND_META) as EnvKind[]).map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: k }))} value={kind} onChange={(e) => { const k = e.target.value as EnvKind; setKind(k); setColor(KIND_META[k].color); }} /></Field>
                <Field label="Color"><ColorPicker value={color} onChange={setColor} allowCustom={false} /></Field>
                <div className="flex justify-end gap-2">
                    <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                    <Button size="sm" color="primary" onClick={() => name.trim() && onSave({ name: name.trim(), kind, color })}>Save</Button>
                </div>
            </div>
        </Overlay>
    );
};

// ---- .env code viewer ----
const CodeViewer = ({ env, projectName, onClose }: { env: Environment; projectName: string; onClose: () => void }) => {
    const [reveal, setReveal] = useState(false);
    const plaintextCopy = useConfirm();
    const text = toEnvFile(env, projectName, !reveal);
    const copy = () => {
        if (!reveal) {
            void navigator.clipboard?.writeText(text);
            return;
        }
        plaintextCopy.confirm({
            title: "Copy plaintext secret values?",
            description: "This copies every value in this environment. The clipboard will be cleared after 30 seconds when system permissions allow it.",
            confirmLabel: "Copy values",
            destructive: false,
            onConfirm: () => copySecretToClipboard(toEnvFile(env, projectName, false)),
        });
    };
    return (
        <Overlay onClose={onClose} title={`.env · ${env.name}`} wide>
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-end gap-2">
                    <Button size="sm" color="secondary" iconLeading={reveal ? EyeOff : Eye} onClick={() => setReveal((v) => !v)}>{reveal ? "Hide values" : "Reveal values"}</Button>
                    <Button size="sm" color="secondary" iconLeading={Copy01} onClick={copy}>{reveal ? "Copy values" : "Copy masked"}</Button>
                </div>
                <pre className="max-h-[60vh] overflow-auto rounded-lg p-4 font-mono text-xs leading-relaxed text-secondary" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>{text}</pre>
            </div>
            {plaintextCopy.dialog}
        </Overlay>
    );
};

// ---- shared overlay + field ----
const Overlay = ({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
        <div className={cx("flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl", wide ? "max-w-3xl" : "max-w-xl")} style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-secondary px-5 py-3">
                <h2 className="text-md font-semibold text-primary">{title}</h2>
                <button type="button" onClick={onClose} className="rounded p-1 text-quaternary hover:text-secondary"><X className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </div>
    </div>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-secondary">{label}</span>
        {children}
    </div>
);
