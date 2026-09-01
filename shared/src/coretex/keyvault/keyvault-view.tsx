// @ts-nocheck
"use client";

// Coretex — API Key Vault + Integrations Hub. A premium dev-tool surface for
// storing API keys with rich metadata, a key-health dashboard, live key-testing,
// connected service integrations, and per-integration MCP connectors that expose
// stored credentials to in-app AI agents. All UI is Untitled UI + @untitledui/icons;
// logos resolve via <BrandLogo> (LogoKit). Key values live in the Brain's local
// vault (~/.coretex/keyvault.json); the UI masks them by default.

import { useEffect, useMemo, useState } from "react";
import {
    Plus,
    SearchMd,
    Eye,
    EyeOff,
    Copy01,
    Edit01,
    Trash01,
    RefreshCcw01,
    Key01,
    CheckCircle,
    AlertTriangle,
    AlertCircle,
    XCircle,
    Clock,
    LayoutGrid01,
    Rows01,
    Zap,
    ShieldTick,
    Settings01,
    X,
    Loading01,
    PuzzlePiece01,
    Lightning01,
    Activity,
    AlertOctagon,
    Check,
    Power01,
    BarChartSquare02,
} from "@untitledui/icons";
import { cx } from "@/utils/cx";
import type {
    APIKey,
    AuditEntry,
    ServiceConnection,
    KeyEnvironment,
    KeyStatus,
    KeyTestStatus,
    MCPToolBinding,
    Project,
    ServiceCategory,
} from "@repo/coretex/types";
import type { CoretexState, CoretexActions } from "../use-coretex";
import { useContextMenu, type MenuItem } from "../ui/context-menu";
import { BrandLogo } from "../ui/brand-logo";
import { CodeSnippet } from "@/components/application/code-snippet/code-snippet";
import { NativeSelect } from "@/components/base/select/select-native";
import { Input } from "@/components/base/input/input";
import { Button } from "@/components/base/buttons/button";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { TextArea } from "@/components/base/textarea/textarea";
import { Toggle } from "@/components/base/toggle/toggle";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { CATEGORY_COLORS, CATEGORY_LABELS, CONNECTOR_SERVICES, connectorGroups, SERVICES, SERVICE_BY_ID, type ServiceDef } from "./catalog";
import { ConnectConnectorModal } from "./connect-connector-modal";
import { applyVaultConnect, applyVaultDisconnect, applyVaultVerify, syncVaultMcpEnabled, syncAiProviderFromVaultKey } from "./vault-connect";
import { copySecretToClipboard, SecretsEmptyState, SecretsPageLayout, SecretsTabs } from "../secrets/secrets-page";

// ---- shared helpers ----
function relTime(ts: number | null): string {
    if (!ts) return "never";
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return `${Math.floor(d / 30)}mo ago`;
}

function genId(p: string): string {
    return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Right-click menu for a key row/card — mirrors the per-row action buttons. */
function keyMenu(opts: {
    k: APIKey;
    revealed: boolean;
    onReveal: () => void;
    onCopy: () => void;
    onTest: () => void;
    onEdit: () => void;
    onDelete: () => void;
}): MenuItem[] {
    const { k, revealed, onReveal, onCopy, onTest, onEdit, onDelete } = opts;
    return [
        { header: `${k.serviceName} · ${k.nickname}` },
        { key: "copy", label: "Copy key (clears in 30s)", icon: Copy01, onClick: onCopy },
        { key: "reveal", label: revealed ? "Hide" : "Reveal", icon: revealed ? EyeOff : Eye, onClick: onReveal },
        { key: "edit", label: "Edit", icon: Edit01, onClick: onEdit },
        { key: "test", label: "Test connection", icon: RefreshCcw01, onClick: onTest },
        { separator: true },
        { key: "delete", label: "Delete key", icon: Trash01, danger: true, onClick: onDelete },
    ];
}

function strengthOf(v: string): { label: string; pct: number; color: string } {
    let score = 0;
    if (v.length >= 16) score += 2;
    else if (v.length >= 8) score += 1;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score += 1;
    if (/\d/.test(v)) score += 1;
    if (/[^A-Za-z0-9]/.test(v)) score += 1;
    const pct = Math.min(100, (score / 5) * 100);
    if (score >= 4) return { label: "Strong", pct, color: "#22c55e" };
    if (score >= 2) return { label: "Fair", pct, color: "#f59e0b" };
    return { label: "Weak", pct, color: "#ef4444" };
}

const STATUS_META: Record<KeyStatus, { label: string; color: string; Icon: typeof CheckCircle }> = {
    active: { label: "Active", color: "#22c55e", Icon: CheckCircle },
    expiring: { label: "Expiring soon", color: "#f59e0b", Icon: AlertTriangle },
    expired: { label: "Expired", color: "#ef4444", Icon: XCircle },
    unverified: { label: "Unverified", color: "#94a3b8", Icon: AlertCircle },
};

const TEST_META: Record<KeyTestStatus, { label: string; color: string }> = {
    valid: { label: "Valid", color: "#22c55e" },
    invalid: { label: "Invalid", color: "#ef4444" },
    untested: { label: "Untested", color: "#94a3b8" },
    rate_limited: { label: "Rate limited", color: "#f59e0b" },
    testing: { label: "Testing…", color: "#6366f1" },
};

const ENVIRONMENTS: KeyEnvironment[] = ["production", "staging", "development", "testing"];

type Tab = "vault" | "health" | "integrations" | "leakscan" | "audit";
const TABS: { id: Tab; label: string; Icon: typeof Key01 }[] = [
    { id: "vault", label: "API Keys", Icon: Key01 },
    { id: "health", label: "Health", Icon: ShieldTick },
    { id: "integrations", label: "Integrations", Icon: PuzzlePiece01 },
    { id: "leakscan", label: "Leak scan", Icon: SearchMd },
    { id: "audit", label: "Audit log", Icon: Activity },
];

// ====================================================================
export const KeyVaultView = ({ state, actions, lockedProjectId, embedded = false }: { state: CoretexState; actions: CoretexActions; /** When set, only show / create keys for this project. */ lockedProjectId?: string; /** Hide the identity header when a parent Secrets surface owns it. */ embedded?: boolean }) => {
    const kv = state.keyvault;
    // Flat list of all env vars (across environments) for key→env-var linking.
    const envVars = useMemo(
        () => (state.env?.environments ?? [])
            .filter((e) => !lockedProjectId || e.projectId === lockedProjectId)
            .flatMap((e) => e.variables.map((v) => ({ id: v.id, name: v.name, envName: e.name }))),
        [state.env, lockedProjectId],
    );
    const [tab, setTab] = useState<Tab>("vault");
    const [view, setView] = useState<"grid" | "table">("grid");
    const [search, setSearch] = useState("");
    const [catFilter, setCatFilter] = useState<ServiceCategory | null>(null);
    const [statusFilter, setStatusFilter] = useState<KeyStatus | null>(null);
    const [revealed, setRevealed] = useState<Set<string>>(new Set());
    const [testingId, setTestingId] = useState<string | null>(null);
    const [editing, setEditing] = useState<APIKey | null>(null);
    const [showAdd, setShowAdd] = useState(false);
    const [connecting, setConnecting] = useState<{ service: ServiceDef; existing?: ServiceConnection } | null>(null);
    const [configuring, setConfiguring] = useState<ServiceConnection | null>(null);
    const deletion = useConfirm();
    const visibleTabs = lockedProjectId ? TABS.filter((item) => item.id === "vault" || item.id === "health") : TABS;

    useEffect(() => {
        if (lockedProjectId && tab !== "vault" && tab !== "health") setTab("vault");
    }, [lockedProjectId, tab]);

    // Clear the per-key "testing" spinner when a fresh result lands for it.
    useEffect(() => {
        if (state.keyTest && state.keyTest.id === testingId) setTestingId(null);
    }, [state.keyTest, testingId]);

    const keys = useMemo(
        () => (kv?.keys ?? []).filter((k) => !lockedProjectId || k.projectId === lockedProjectId),
        [kv?.keys, lockedProjectId],
    );
    const integrations = kv?.integrations ?? [];
    const audit = kv?.audit ?? [];

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return keys.filter((k) => {
            if (catFilter && k.category !== catFilter) return false;
            if (statusFilter && k.status !== statusFilter) return false;
            if (q && !`${k.serviceName} ${k.nickname} ${k.tags.join(" ")} ${k.note}`.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [keys, search, catFilter, statusFilter]);

    const counts = useMemo(() => {
        const by = (s: KeyStatus) => keys.filter((k) => k.status === s).length;
        return { total: keys.length, active: by("active"), expiring: by("expiring"), expired: by("expired"), unverified: by("unverified") };
    }, [keys]);

    const toggleReveal = (id: string) =>
        setRevealed((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });

    const onTest = (id: string) => {
        setTestingId(id);
        actions.keyvaultTestKey(id);
    };

    const requestDeleteKey = (key: APIKey) => deletion.confirm({
        title: `Delete ${key.nickname || key.serviceName}?`,
        description: `This permanently removes the stored ${key.serviceName} credential and its agent-access settings.`,
        confirmLabel: "Delete API key",
        onConfirm: () => actions.keyvaultDeleteKey(key.id),
    });

    const catsPresent = useMemo(() => {
        const set = new Set<ServiceCategory>();
        keys.forEach((k) => set.add(k.category));
        return [...set];
    }, [keys]);

    if (!kv) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-tertiary">
                <Loading01 className="mr-2 size-4 animate-spin" /> Loading vault…
            </div>
        );
    }

    return (
        <SecretsPageLayout
            icon={Key01}
            title="API keys & integrations"
            description={lockedProjectId
                ? "Project-scoped credentials, connection health, and agent access in one local credential store."
                : "Store credentials, verify connection health, and control which services your AI agents can use."}
            badge={lockedProjectId ? "Project credential store" : "Stored locally"}
            stats={[
                { label: "Total keys", value: counts.total, color: "var(--brand)" },
                { label: "Active", value: counts.active, color: "#22c55e" },
                { label: "Needs attention", value: counts.expiring + counts.expired, color: counts.expiring + counts.expired > 0 ? "#f59e0b" : "#22c55e" },
            ]}
            compact={!!lockedProjectId}
            hideHeader={embedded}
            actions={tab === "vault" ? (
                <>
                    <div className="flex h-9 items-center overflow-hidden rounded-lg" style={{ border: "1px solid var(--c-border)" }}>
                        <button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={cx("flex h-full items-center gap-1.5 px-2.5 text-xs font-medium", view === "grid" ? "text-primary" : "text-tertiary")} style={{ background: view === "grid" ? "var(--surface-2)" : "transparent" }}>
                            <LayoutGrid01 className="size-3.5" /> Grid
                        </button>
                        <button type="button" aria-label="Table view" aria-pressed={view === "table"} onClick={() => setView("table")} className={cx("flex h-full items-center gap-1.5 px-2.5 text-xs font-medium", view === "table" ? "text-primary" : "text-tertiary")} style={{ background: view === "table" ? "var(--surface-2)" : "transparent" }}>
                            <Rows01 className="size-3.5" /> Table
                        </button>
                    </div>
                    <Button size="sm" color="primary" iconLeading={Plus} onClick={() => setShowAdd(true)}>Add API key</Button>
                </>
            ) : undefined}
            navigation={(
                <SecretsTabs
                    items={visibleTabs.map((item) => ({
                        id: item.id,
                        label: item.label,
                        icon: item.Icon,
                        count: item.id === "integrations"
                            ? integrations.length
                            : item.id === "vault" ? keys.length : undefined,
                    }))}
                    value={tab}
                    onChange={(id) => setTab(id as Tab)}
                    ariaLabel="API key vault sections"
                />
            )}
        >

            {/* Body */}
            {tab === "vault" && (
                <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
                    {/* Filter rail */}
                    <aside className="grid w-full shrink-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:flex lg:w-52 lg:flex-col lg:overflow-y-auto">
                        <Input icon={SearchMd} value={search} onChange={setSearch} placeholder="Search keys…" size="sm" />
                        <FilterGroup title="Status">
                            <FilterRow active={statusFilter === null} onClick={() => setStatusFilter(null)} label="All keys" count={counts.total} />
                            {(["active", "expiring", "expired", "unverified"] as KeyStatus[]).map((s) => (
                                <FilterRow key={s} active={statusFilter === s} onClick={() => setStatusFilter(statusFilter === s ? null : s)} label={STATUS_META[s].label} count={keys.filter((k) => k.status === s).length} dot={STATUS_META[s].color} />
                            ))}
                        </FilterGroup>
                        <FilterGroup title="Category">
                            <FilterRow active={catFilter === null} onClick={() => setCatFilter(null)} label="All" count={keys.length} />
                            {catsPresent.map((c) => (
                                <FilterRow key={c} active={catFilter === c} onClick={() => setCatFilter(catFilter === c ? null : c)} label={CATEGORY_LABELS[c]} count={keys.filter((k) => k.category === c).length} dot={CATEGORY_COLORS[c]} />
                            ))}
                        </FilterGroup>
                    </aside>

                    {/* Keys */}
                    <div className="min-w-0 flex-1 overflow-y-auto">
                        {filtered.length === 0 ? (
                            <EmptyState onAdd={() => setShowAdd(true)} />
                        ) : view === "grid" ? (
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {filtered.map((k) => (
                                    <KeyCard key={k.id} k={k} revealed={revealed.has(k.id)} testing={testingId === k.id} onReveal={() => toggleReveal(k.id)} onCopy={() => copySecretToClipboard(k.keyValue)} onTest={() => onTest(k.id)} onEdit={() => setEditing(k)} onDelete={() => requestDeleteKey(k)} />
                                ))}
                            </div>
                        ) : (
                            <KeyTable keys={filtered} revealed={revealed} testingId={testingId} onReveal={toggleReveal} onCopy={(v) => copySecretToClipboard(v)} onTest={onTest} onEdit={setEditing} onDelete={(id) => {
                                const key = keys.find((item) => item.id === id);
                                if (key) requestDeleteKey(key);
                            }} />
                        )}
                    </div>
                </div>
            )}

            {tab === "health" && <HealthDashboard keys={keys} counts={counts} onRotate={setEditing} onTest={onTest} />}
            {tab === "integrations" && (
                <IntegrationsHub
                    integrations={integrations}
                    settings={state.settings}
                    mcp={state.mcp}
                    onConnect={(service, existing) => setConnecting({ service, existing })}
                    onConfigure={setConfiguring}
                    onVerify={(entry) => applyVaultVerify({ entry, actions })}
                    actions={actions}
                />
            )}
            {tab === "leakscan" && <LeakScanPanel state={state} actions={actions} />}
            {tab === "audit" && <AuditLog audit={audit} />}

            {/* Modals */}
            {(showAdd || editing) && (
                <KeyModal
                    keyToEdit={editing}
                    projects={state.projects}
                    envVars={envVars}
                    lockedProjectId={lockedProjectId}
                    onClose={() => { setShowAdd(false); setEditing(null); }}
                    onSave={(k) => {
                        actions.keyvaultUpsertKey(k);
                        syncAiProviderFromVaultKey({ key: k, settings: state.settings, actions });
                        setShowAdd(false);
                        setEditing(null);
                    }}
                />
            )}
            {connecting && (
                <ConnectConnectorModal
                    service={connecting.service}
                    existingIntegration={connecting.existing}
                    operation={state.connectorOperation}
                    onClose={() => setConnecting(null)}
                    onConnect={(integration, credentials) =>
                        applyVaultConnect({
                            service: connecting.service,
                            integration,
                            credentials,
                            actions,
                        })
                    }
                />
            )}
            {configuring && (
                <McpConfigModal
                    integration={configuring}
                    onClose={() => setConfiguring(null)}
                    onSave={(i) => {
                        syncVaultMcpEnabled({ integration: i, settings: state.settings, actions });
                        setConfiguring(null);
                    }}
                />
            )}
            {deletion.dialog}
        </SecretsPageLayout>
    );
};

// ---- filter rail bits ----
const FilterGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-0.5">
        <span className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-quaternary">{title}</span>
        {children}
    </div>
);
const FilterRow = ({ active, onClick, label, count, dot }: { active: boolean; onClick: () => void; label: string; count: number; dot?: string }) => (
    <button type="button" onClick={onClick} className={cx("flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition", active ? "font-medium text-primary" : "text-secondary hover:bg-[var(--surface-2)]")} style={{ background: active ? "var(--surface-2)" : undefined }}>
        <span className="flex items-center gap-2 truncate">
            {dot && <span className="size-2 shrink-0 rounded-full" style={{ background: dot }} />}
            {label}
        </span>
        <span className="text-xs text-quaternary">{count}</span>
    </button>
);

// ---- key preview text ----
const KeyMono = ({ k, revealed }: { k: APIKey; revealed: boolean }) => (
    <code className="block truncate rounded-md px-2 py-1 font-mono text-xs" style={{ background: "var(--surface-2)", color: revealed ? "var(--c-text-primary)" : "var(--c-text-muted)" }} title={revealed ? k.keyValue : k.keyPreview}>
        {revealed ? k.keyValue : k.keyPreview}
    </code>
);

const StatusBadge = ({ status }: { status: KeyStatus }) => {
    const m = STATUS_META[status];
    return (
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: m.color + "1f", color: m.color }}>
            <m.Icon className="size-3" /> {m.label}
        </span>
    );
};

const CatBadge = ({ c }: { c: ServiceCategory }) => (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: CATEGORY_COLORS[c] + "1f", color: CATEGORY_COLORS[c] }}>
        {CATEGORY_LABELS[c]}
    </span>
);

const IconBtn = ({ title, onClick, children, danger }: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) => (
    <button type="button" title={title} onClick={onClick} className={cx("rounded-md p-1.5 transition hover:bg-[var(--surface-2)]", danger ? "text-error-primary" : "text-tertiary hover:text-secondary")}>
        {children}
    </button>
);

// ---- key card (grid) ----
const KeyCard = ({ k, revealed, testing, onReveal, onCopy, onTest, onEdit, onDelete }: { k: APIKey; revealed: boolean; testing: boolean; onReveal: () => void; onCopy: () => void; onTest: () => void; onEdit: () => void; onDelete: () => void }) => {
    const test = TEST_META[testing ? "testing" : k.testStatus];
    const ctx = useContextMenu();
    return (
        <div className="group flex flex-col gap-3 rounded-xl p-3.5 transition hover:shadow-md" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onContextMenu={(e) => ctx.open(e, keyMenu({ k, revealed, onReveal, onCopy, onTest, onEdit, onDelete }))}>
            <div className="flex items-start gap-2.5">
                <BrandLogo domain={k.serviceDomain} name={k.serviceName} size={36} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-primary">{k.serviceName}</span>
                        {k.aiAgentAccess && <span title={`AI agents: ${k.aiAccessScope}`} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase" style={{ background: "var(--brand)", color: "#fff" }}><Zap className="size-2.5" />AI</span>}
                    </div>
                    <span className="truncate text-xs text-tertiary">{k.nickname}</span>
                </div>
                <StatusBadge status={k.status} />
            </div>

            <KeyMono k={k} revealed={revealed} />

            <div className="flex flex-wrap items-center gap-1.5">
                <CatBadge c={k.category} />
                <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-quaternary" style={{ border: "1px solid var(--c-border)" }}>{k.environment}</span>
                {k.linkedEnvVarName && (
                    <span title={`Linked to env var ${k.linkedEnvVarName}`} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-brand-secondary" style={{ background: "color-mix(in srgb, var(--brand) 14%, transparent)" }}>
                        ⇄ {k.linkedEnvVarName}
                    </span>
                )}
                <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: test.color }}>
                    {testing ? <Loading01 className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full" style={{ background: test.color }} />}
                    {test.label}
                </span>
            </div>

            <div className="flex items-center justify-between border-t pt-2.5" style={{ borderColor: "var(--c-border)" }}>
                <span className="text-[11px] text-quaternary">
                    {k.expiresAt ? `Expires ${new Date(k.expiresAt).toLocaleDateString()}` : `Used ${relTime(k.lastUsed)}`}
                </span>
                <div className="flex items-center gap-0.5 opacity-70 transition group-hover:opacity-100">
                    <IconBtn title={revealed ? "Hide" : "Reveal"} onClick={onReveal}>{revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</IconBtn>
                    <IconBtn title="Copy (clears in 30s)" onClick={onCopy}><Copy01 className="size-4" /></IconBtn>
                    <IconBtn title="Test connection" onClick={onTest}><RefreshCcw01 className={cx("size-4", testing && "animate-spin")} /></IconBtn>
                    <IconBtn title="Edit" onClick={onEdit}><Edit01 className="size-4" /></IconBtn>
                    <IconBtn title="Delete" onClick={onDelete} danger><Trash01 className="size-4" /></IconBtn>
                </div>
            </div>
            {ctx.node}
        </div>
    );
};

// ---- key table ----
const KeyTable = ({ keys, revealed, testingId, onReveal, onCopy, onTest, onEdit, onDelete }: { keys: APIKey[]; revealed: Set<string>; testingId: string | null; onReveal: (id: string) => void; onCopy: (v: string) => void; onTest: (id: string) => void; onEdit: (k: APIKey) => void; onDelete: (id: string) => void }) => {
    const ctx = useContextMenu();
    return (
    <div className="overflow-x-auto rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
        <table className="min-w-[880px] w-full text-sm">
            <thead>
                <tr className="text-left text-xs text-quaternary" style={{ borderBottom: "1px solid var(--c-border)" }}>
                    <th className="px-3 py-2 font-medium">Service</th>
                    <th className="px-3 py-2 font-medium">Nickname</th>
                    <th className="px-3 py-2 font-medium">Key</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Last used</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
            </thead>
            <tbody>
                {keys.map((k) => {
                    const open = revealed.has(k.id);
                    const testing = testingId === k.id;
                    return (
                        <tr key={k.id} className="group transition hover:bg-[var(--surface-2)]" style={{ borderBottom: "1px solid var(--c-border)" }} onContextMenu={(e) => ctx.open(e, keyMenu({ k, revealed: open, onReveal: () => onReveal(k.id), onCopy: () => onCopy(k.keyValue), onTest: () => onTest(k.id), onEdit: () => onEdit(k), onDelete: () => onDelete(k.id) }))}>
                            <td className="px-3 py-2"><div className="flex items-center gap-2"><BrandLogo domain={k.serviceDomain} name={k.serviceName} size={24} /><span className="font-medium text-primary">{k.serviceName}</span>{k.aiAgentAccess && <Zap className="size-3 text-[var(--brand)]" />}</div></td>
                            <td className="px-3 py-2 text-secondary">{k.nickname}</td>
                            <td className="px-3 py-2"><code className="font-mono text-xs text-tertiary" title={open ? k.keyValue : k.keyPreview}>{open ? k.keyValue : k.keyPreview}</code></td>
                            <td className="px-3 py-2"><StatusBadge status={k.status} /></td>
                            <td className="px-3 py-2"><CatBadge c={k.category} /></td>
                            <td className="px-3 py-2 text-xs text-quaternary">{relTime(k.lastUsed)}</td>
                            <td className="px-3 py-2">
                                <div className="flex items-center justify-end gap-0.5 opacity-70 transition group-hover:opacity-100">
                                    <IconBtn title={open ? "Hide" : "Reveal"} onClick={() => onReveal(k.id)}>{open ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</IconBtn>
                                    <IconBtn title="Copy" onClick={() => onCopy(k.keyValue)}><Copy01 className="size-4" /></IconBtn>
                                    <IconBtn title="Test" onClick={() => onTest(k.id)}><RefreshCcw01 className={cx("size-4", testing && "animate-spin")} /></IconBtn>
                                    <IconBtn title="Edit" onClick={() => onEdit(k)}><Edit01 className="size-4" /></IconBtn>
                                    <IconBtn title="Delete" onClick={() => onDelete(k.id)} danger><Trash01 className="size-4" /></IconBtn>
                                </div>
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
        {ctx.node}
    </div>
    );
};

const EmptyState = ({ onAdd }: { onAdd: () => void }) => (
    <div className="overflow-hidden rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
        <SecretsEmptyState
            icon={Key01}
            title="No API keys here"
            description="Add a credential to manage its access, health, and project scope."
            action={<Button size="sm" color="primary" iconLeading={Plus} onClick={onAdd}>Add API key</Button>}
        />
    </div>
);

// ====================================================================
// Health dashboard
const HealthDashboard = ({ keys, counts, onRotate }: { keys: APIKey[]; counts: { total: number; active: number; expiring: number; expired: number; unverified: number }; onRotate: (k: APIKey) => void; onTest: (id: string) => void }) => {
    const expired = keys.filter((k) => k.status === "expired");
    const expiring = keys.filter((k) => k.status === "expiring");
    const unused = keys.filter((k) => !k.lastUsed || Date.now() - k.lastUsed > 90 * 86_400_000);

    // Security alerts
    const alerts: { level: "error" | "warn"; text: string }[] = [];
    const seen = new Map<string, number>();
    keys.forEach((k) => seen.set(k.keyValue, (seen.get(k.keyValue) ?? 0) + 1));
    [...seen.entries()].filter(([, n]) => n > 1).forEach(([v, n]) => alerts.push({ level: "error", text: `Duplicate key value stored ${n}× (…${v.slice(-4)})` }));
    keys.filter((k) => k.testStatus === "invalid").forEach((k) => alerts.push({ level: "error", text: `${k.serviceName} · ${k.nickname} failed its last test — may be revoked.` }));
    keys.filter((k) => Date.now() - k.updatedAt > 90 * 86_400_000).forEach((k) => alerts.push({ level: "warn", text: `${k.serviceName} · ${k.nickname} hasn't been rotated in 90+ days.` }));

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Total keys" value={counts.total} color="var(--brand)" Icon={Key01} />
                <Stat label="Active" value={counts.active} color="#22c55e" Icon={CheckCircle} />
                <Stat label="Expiring ≤30d" value={counts.expiring} color="#f59e0b" Icon={AlertTriangle} />
                <Stat label="Expired" value={counts.expired} color="#ef4444" Icon={XCircle} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Panel title="Expired keys" icon={<XCircle className="size-4 text-error-primary" />} empty={expired.length === 0 ? "Nothing expired 🎉" : undefined}>
                    {expired.map((k) => (
                        <HealthRow key={k.id} k={k}>
                            <button type="button" onClick={() => onRotate(k)} className="rounded-md px-2.5 py-1 text-xs font-semibold text-white" style={{ background: "#ef4444" }}>Rotate now</button>
                        </HealthRow>
                    ))}
                </Panel>
                <Panel title="Expiring within 30 days" icon={<Clock className="size-4" style={{ color: "#f59e0b" }} />} empty={expiring.length === 0 ? "Nothing expiring soon" : undefined}>
                    {expiring.map((k) => (
                        <HealthRow key={k.id} k={k}>
                            <span className="text-xs font-medium" style={{ color: "#f59e0b" }}>{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : ""}</span>
                        </HealthRow>
                    ))}
                </Panel>
                <Panel title="Unused 90+ days" icon={<AlertCircle className="size-4 text-tertiary" />} empty={unused.length === 0 ? "All keys recently used" : undefined}>
                    {unused.map((k) => (
                        <HealthRow key={k.id} k={k}>
                            <span className="text-xs text-quaternary">{relTime(k.lastUsed)}</span>
                        </HealthRow>
                    ))}
                </Panel>
                <Panel title="Security alerts" icon={<ShieldTick className="size-4" style={{ color: "#8b5cf6" }} />} empty={alerts.length === 0 ? "No alerts — vault looks healthy" : undefined}>
                    {alerts.map((a, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-lg px-2.5 py-2" style={{ background: "var(--surface-2)" }}>
                            {a.level === "error" ? <AlertOctagon className="mt-0.5 size-4 shrink-0 text-error-primary" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: "#f59e0b" }} />}
                            <span className="text-xs text-secondary">{a.text}</span>
                        </div>
                    ))}
                </Panel>
            </div>

            <Panel title="AI-accessible keys" icon={<Zap className="size-4 text-[var(--brand)]" />} empty={keys.filter((k) => k.aiAgentAccess).length === 0 ? "No keys exposed to AI agents" : undefined}>
                {keys.filter((k) => k.aiAgentAccess).map((k) => (
                    <HealthRow key={k.id} k={k}>
                        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ background: "var(--brand)", color: "#fff" }}>{k.aiAccessScope}</span>
                    </HealthRow>
                ))}
            </Panel>
        </div>
    );
};

const Stat = ({ label, value, color, Icon }: { label: string; value: number; color: string; Icon: typeof Key01 }) => (
    <div className="flex items-center gap-3 rounded-xl p-3.5" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
        <div className="flex size-9 items-center justify-center rounded-lg" style={{ background: color + "1f" }}><Icon className="size-5" style={{ color }} /></div>
        <div><div className="text-xl font-semibold text-primary">{value}</div><div className="text-xs text-tertiary">{label}</div></div>
    </div>
);
const Panel = ({ title, icon, children, empty }: { title: string; icon: React.ReactNode; children?: React.ReactNode; empty?: string }) => (
    <div className="flex flex-col rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
        <div className="flex items-center gap-2 border-b px-3.5 py-2.5" style={{ borderColor: "var(--c-border)" }}>{icon}<span className="text-sm font-semibold text-primary">{title}</span></div>
        <div className="flex flex-col gap-1.5 p-2.5">{empty ? <p className="px-1 py-2 text-xs text-quaternary">{empty}</p> : children}</div>
    </div>
);
const HealthRow = ({ k, children }: { k: APIKey; children: React.ReactNode }) => (
    <div className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-[var(--surface-2)]">
        <div className="flex min-w-0 items-center gap-2"><BrandLogo domain={k.serviceDomain} name={k.serviceName} size={22} /><span className="truncate text-sm text-secondary">{k.serviceName} · <span className="text-tertiary">{k.nickname}</span></span></div>
        {children}
    </div>
);

// ====================================================================
// Integrations hub
const INT_STATUS: Record<ServiceConnection["status"], { label: string; color: string }> = {
    connected: { label: "Connected", color: "#22c55e" },
    connecting: { label: "Connecting…", color: "#3b82f6" },
    partial: { label: "Partial", color: "#f59e0b" },
    error: { label: "Error", color: "#ef4444" },
    disconnected: { label: "Disconnected", color: "#94a3b8" },
};

const IntegrationsHub = ({
    integrations,
    settings,
    mcp,
    onConnect,
    onConfigure,
    onVerify,
    actions,
}: {
    integrations: ServiceConnection[];
    settings: CoretexState["settings"];
    mcp: CoretexState["mcp"];
    onConnect: (s: ServiceDef, existing?: ServiceConnection) => void;
    onConfigure: (i: ServiceConnection) => void;
    onVerify: (entry: ServiceConnection) => void;
    actions: CoretexActions;
}) => {
    const activeConnectors = integrations.filter((i) => {
        const service = SERVICE_BY_ID[i.serviceId];
        const runtime = i.runtimeServerId ? mcp[i.runtimeServerId] : undefined;
        return Boolean(service?.mcpRuntime && (i.agentEnabled ?? i.mcpEnabled) && runtime?.connected);
    });

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
            {/* MCP connector status strip */}
            {activeConnectors.length > 0 && (
                <div className="rounded-xl p-3.5" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                    <div className="mb-2.5 flex items-center gap-2"><Lightning01 className="size-4 text-[var(--brand)]" /><span className="text-sm font-semibold text-primary">Active MCP connectors</span><span className="text-xs text-tertiary">— available to AI agents</span></div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {activeConnectors.map((i) => {
                            const enabled = i.mcpTools.filter((t) => t.permission !== "disabled").length;
                            const calls = i.mcpTools.reduce((n, t) => n + t.callsToday, 0);
                            return (
                                <div key={i.id} className="flex items-center gap-2.5 rounded-lg p-2.5" style={{ background: "var(--surface-2)" }}>
                                    <BrandLogo domain={i.serviceDomain} name={i.serviceName} size={28} />
                                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-primary">{i.serviceName}</div><div className="text-[11px] text-tertiary">{enabled} tools · {calls} calls today</div></div>
                                    <IconBtn title="Configure" onClick={() => onConfigure(i)}><Settings01 className="size-4" /></IconBtn>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Every account instance remains visible, including partial/error
                records that can be repaired with replacement credentials. */}
            <Section title="Accounts" count={integrations.length}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {integrations.map((i) => (
                        <IntegrationCard
                            key={i.id}
                            i={i}
                            onConfigure={() => onConfigure(i)}
                            service={SERVICE_BY_ID[i.serviceId]}
                            runtime={i.runtimeServerId ? mcp[i.runtimeServerId] : undefined}
                            onVerify={() => onVerify(i)}
                            onReconnect={() => {
                                const connector = SERVICE_BY_ID[i.serviceId];
                                if (connector) onConnect(connector, i);
                            }}
                            onToggleMcp={() => {
                                const enabled = !(i.agentEnabled ?? i.mcpEnabled);
                                const connector = SERVICE_BY_ID[i.serviceId];
                                syncVaultMcpEnabled({
                                    integration: {
                                        ...i,
                                        agentEnabled: enabled,
                                        ...(connector?.mcpRuntime ? { mcpEnabled: enabled } : {}),
                                    },
                                    settings,
                                    actions,
                                });
                            }}
                            onDisconnect={() => applyVaultDisconnect({ entry: i, actions })}
                        />
                    ))}
                    {integrations.length === 0 && <p className="text-xs text-quaternary">No connector accounts yet.</p>}
                </div>
            </Section>

            {/* The full catalog remains available because connector runtimes and
                credentials are account-scoped; one service may have many accounts. */}
            <Section title="Add account" count={CONNECTOR_SERVICES.length}>
                <div className="flex flex-col gap-4">
                    {connectorGroups().map((group) => {
                        const items = group.items;
                        if (items.length === 0) return null;
                        return (
                            <div key={group.category}>
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-quaternary">{group.category}</p>
                                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                                    {items.map((s) => (
                                        <button key={s.id} type="button" onClick={() => onConnect(s)} className="flex items-center gap-2.5 rounded-xl p-3 text-left transition hover:shadow-md" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                            <BrandLogo domain={s.domain} name={s.name} size={32} />
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium text-primary">{s.name}</div>
                                                <div className="truncate text-[11px] text-tertiary">
                                                    {s.caps ?? s.authType.replace("_", " ")} · {s.mcpRuntime ? "agent-ready MCP" : "credential environment"}
                                                </div>
                                                {integrations.some((i) => i.serviceId === s.id) && (
                                                    <div className="mt-0.5 text-[10px] font-medium text-brand-secondary">
                                                        {integrations.filter((i) => i.serviceId === s.id).length} account{integrations.filter((i) => i.serviceId === s.id).length === 1 ? "" : "s"} saved · add another
                                                    </div>
                                                )}
                                            </div>
                                            <Plus className="size-4 text-quaternary" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </Section>
        </div>
    );
};

const Section = ({ title, count, children }: { title: string; count: number; children: React.ReactNode }) => (
    <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-primary">{title}</h3><span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-tertiary" style={{ background: "var(--surface-2)" }}>{count}</span></div>
        {children}
    </div>
);

const IntegrationCard = ({ i, service, runtime, onConfigure, onVerify, onReconnect, onToggleMcp, onDisconnect }: { i: ServiceConnection; service?: ServiceDef; runtime?: CoretexState["mcp"][string]; onConfigure: () => void; onVerify: () => void; onReconnect: () => void; onToggleMcp: () => void; onDisconnect: () => void }) => {
    const st = INT_STATUS[i.status];
    const verifying = i.status === "connecting";
    const needsCredentials = i.status === "error" || i.status === "disconnected";
    const canRetryVerification = !needsCredentials || Boolean(i.credentialIds?.length);
    const verification = i.verification === "verified" ? "Verified" : i.verification === "failed" ? "Verification failed" : "Unverified";
    return (
        <div className="flex flex-col gap-3 rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
            <div className="flex items-start gap-3">
                <BrandLogo domain={i.serviceDomain} name={i.serviceName} size={40} />
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-primary">{i.serviceName}</div>
                    <div className="truncate text-xs text-tertiary">{i.connectedAs} · {verification}</div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: st.color + "1f", color: st.color }}><span className="size-1.5 rounded-full" style={{ background: st.color }} />{st.label}</span>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1">
                {i.stats.map((s, idx) => (
                    <div key={idx} className="flex items-baseline gap-1"><span className="text-sm font-semibold text-primary">{s.value}</span><span className="text-[11px] text-tertiary">{s.label}</span></div>
                ))}
            </div>

            {service?.mcpRuntime ? (
                <div className="flex items-center justify-between rounded-lg px-2.5 py-2" style={{ background: "var(--surface-2)" }}>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-secondary"><Zap className="size-3.5 shrink-0 text-[var(--brand)]" /> <span className="truncate">{runtime?.connected ? `${runtime.tools?.length ?? 0} live MCP tools` : runtime?.connecting ? "MCP runtime connecting…" : runtime?.error ? "MCP runtime unavailable" : "MCP runtime not connected"}</span></span>
                    <Toggle size="sm" isSelected={i.agentEnabled ?? i.mcpEnabled} onChange={onToggleMcp} aria-label="Available to supported AI agents" />
                </div>
            ) : (
                <div className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-xs" style={{ background: "var(--surface-2)" }}>
                    <div className="min-w-0">
                        <p className="font-medium text-secondary">Protected credential environment</p>
                        <p className="mt-0.5 text-[11px] text-quaternary">No live agent-tool adapter; supported subprocess agents may receive authorized environment values.</p>
                    </div>
                    <Toggle size="sm" isSelected={i.agentEnabled ?? i.mcpEnabled} onChange={onToggleMcp} aria-label="Available to supported agent subprocesses" />
                </div>
            )}

            <div className="flex items-center gap-1.5 border-t pt-2.5 text-xs text-quaternary" style={{ borderColor: "var(--c-border)" }}>
                <span className="flex-1">Synced {relTime(i.lastSyncedAt)}</span>
                {canRetryVerification && (
                    <button type="button" onClick={onVerify} disabled={verifying} title="Re-check the currently stored credentials" className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-secondary hover:bg-[var(--surface-2)] disabled:opacity-60">
                        {verifying ? <Loading01 className="size-3.5 animate-spin" /> : <RefreshCcw01 className="size-3.5" />} {verifying ? "Checking…" : needsCredentials ? "Retry verification" : "Verify"}
                    </button>
                )}
                {needsCredentials && service && (
                    <button type="button" onClick={onReconnect} className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-secondary hover:bg-[var(--surface-2)]"><Key01 className="size-3.5" /> Replace credentials</button>
                )}
                {service?.mcpRuntime && <button type="button" onClick={onConfigure} className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-secondary hover:bg-[var(--surface-2)]"><Settings01 className="size-3.5" /> Tool access</button>}
                {i.status !== "disconnected" && (
                    <button type="button" onClick={onDisconnect} className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-error-primary hover:bg-[var(--surface-2)]"><Power01 className="size-3.5" /> Disconnect</button>
                )}
            </div>
        </div>
    );
};

// ====================================================================
// Audit log
const AUDIT_ICON: Record<AuditEntry["level"], { Icon: typeof Activity; color: string }> = {
    info: { Icon: Check, color: "#22c55e" },
    warn: { Icon: AlertTriangle, color: "#f59e0b" },
    error: { Icon: AlertOctagon, color: "#ef4444" },
};
const AUDIT_LEVELS: AuditEntry["level"][] = ["info", "warn", "error"];
const AuditLog = ({ audit }: { audit: AuditEntry[] }) => {
    const [q, setQ] = useState("");
    const [level, setLevel] = useState<AuditEntry["level"] | null>(null);
    const query = q.trim().toLowerCase();
    const filtered = audit.filter((a) => {
        if (level && a.level !== level) return false;
        if (query && !`${a.action} ${a.target} ${a.detail ?? ""}`.toLowerCase().includes(query)) return false;
        return true;
    });

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-48 flex-1">
                    <Input icon={SearchMd} value={q} onChange={setQ} placeholder="Search activity…" size="sm" />
                </div>
                <div className="flex items-center overflow-hidden rounded-lg" style={{ border: "1px solid var(--c-border)" }}>
                    <button type="button" onClick={() => setLevel(null)} className={cx("px-2.5 py-1.5 text-xs font-medium", level === null ? "text-primary" : "text-tertiary")} style={{ background: level === null ? "var(--surface-2)" : "transparent" }}>All</button>
                    {AUDIT_LEVELS.map((lv) => (
                        <button key={lv} type="button" onClick={() => setLevel(level === lv ? null : lv)} className={cx("flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium capitalize", level === lv ? "text-primary" : "text-tertiary")} style={{ background: level === lv ? "var(--surface-2)" : "transparent" }}>
                            <span className="size-1.5 rounded-full" style={{ background: AUDIT_ICON[lv].color }} />{lv}
                        </button>
                    ))}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center"><Activity className="size-6 text-tertiary" /><p className="text-sm text-tertiary">{audit.length === 0 ? "No activity recorded yet." : "No activity matches your filters."}</p></div>
                ) : (
                    <div className="divide-y divide-[var(--c-border)]">
                        {filtered.map((a) => {
                            const m = AUDIT_ICON[a.level];
                            return (
                                <div key={a.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderColor: "var(--c-border)" }}>
                                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full" style={{ background: m.color + "1f" }}><m.Icon className="size-3.5" style={{ color: m.color }} /></div>
                                    <div className="min-w-0 flex-1"><span className="text-sm font-medium text-primary">{a.action}</span> <span className="text-sm text-tertiary">· {a.target}</span>{a.detail && <span className="ml-1 text-xs text-quaternary">— {a.detail}</span>}</div>
                                    <span className="shrink-0 text-xs text-quaternary">{relTime(a.ts)}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

// ====================================================================
// Leak scan — search indexed folders for anything shaped like a secret.
const LeakScanPanel = ({ state, actions }: { state: CoretexState; actions: CoretexActions }) => {
    const ls = state.leakScan;
    const result = ls.result;
    const findings = result?.findings ?? [];
    const critical = findings.filter((f) => f.severity === "critical");
    const warnings = findings.filter((f) => f.severity === "warning");

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--brand) 16%, transparent)" }}>
                        <SearchMd className="size-5 text-brand-secondary" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-primary">Scan code for leaked secrets</p>
                        <p className="text-xs text-tertiary">Searches your indexed folders for anything shaped like an API key or token. Matches against a key already in your vault are flagged critical — rotate those. Nothing leaves your machine.</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => actions.keyvaultScanLeaks()}
                    disabled={ls.scanning}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: "var(--brand)" }}
                >
                    {ls.scanning ? <Loading01 className="size-4 animate-spin" /> : <SearchMd className="size-4" />}
                    {ls.scanning ? "Scanning…" : result ? "Scan again" : "Scan now"}
                </button>
            </div>

            {/* Live progress */}
            {ls.scanning && (
                <div className="rounded-xl p-3.5" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                    <div className="flex items-center gap-2 text-sm text-secondary">
                        <Loading01 className="size-4 animate-spin text-brand-secondary" />
                        Scanned {ls.scanned.toLocaleString()} files…
                    </div>
                    {ls.current && <p className="mt-1 truncate font-mono text-[11px] text-quaternary">{ls.current}</p>}
                </div>
            )}

            {/* Error / empty / results */}
            {!ls.scanning && result?.error && (
                <div className="flex items-center gap-2 rounded-xl p-4 text-sm" style={{ background: "var(--surface)", border: "1px solid var(--c-border)", color: "var(--c-text-secondary)" }}>
                    <AlertCircle className="size-4 shrink-0 text-tertiary" /> {result.error}
                </div>
            )}

            {!ls.scanning && result && !result.error && (
                <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Stat label="Files scanned" value={result.scanned} color="var(--brand)" Icon={SearchMd} />
                        <Stat label="Critical" value={critical.length} color="#ef4444" Icon={AlertOctagon} />
                        <Stat label="Warnings" value={warnings.length} color="#f59e0b" Icon={AlertTriangle} />
                    </div>

                    {findings.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 rounded-xl py-14 text-center" style={{ border: "1px dashed var(--c-border)" }}>
                            <CheckCircle className="size-7" style={{ color: "#22c55e" }} />
                            <p className="text-sm font-medium text-primary">No leaked credentials found</p>
                            <p className="text-xs text-tertiary">None of your indexed files contain anything shaped like a secret.</p>
                        </div>
                    ) : (
                        <Panel title={`Findings (${findings.length})`} icon={<AlertOctagon className="size-4 text-error-primary" />}>
                            {findings.map((f, i) => {
                                const crit = f.severity === "critical";
                                return (
                                    <div key={i} className="flex items-start gap-3 rounded-lg px-2.5 py-2" style={{ background: "var(--surface-2)" }}>
                                        {crit ? <AlertOctagon className="mt-0.5 size-4 shrink-0 text-error-primary" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: "#f59e0b" }} />}
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-mono text-xs text-secondary" title={f.file}>{f.file}<span className="text-quaternary">:{f.line}</span></p>
                                            <p className="mt-0.5 font-mono text-[11px] text-quaternary">{f.matchPreview}</p>
                                            {crit && f.matchedKeyName && (
                                                <p className="mt-1 text-[11px] font-medium text-error-primary">Matches your stored key “{f.matchedKeyName}” — rotate it.</p>
                                            )}
                                        </div>
                                        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase" style={{ background: (crit ? "#ef4444" : "#f59e0b") + "1f", color: crit ? "#ef4444" : "#f59e0b" }}>{crit ? "Critical" : "Warning"}</span>
                                    </div>
                                );
                            })}
                        </Panel>
                    )}
                </>
            )}

            {!ls.scanning && !result && (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl py-14 text-center" style={{ border: "1px dashed var(--c-border)" }}>
                    <SearchMd className="size-7 text-tertiary" />
                    <p className="text-sm text-tertiary">Run a scan to check your indexed folders for exposed secrets.</p>
                </div>
            )}
        </div>
    );
};

// ====================================================================
// Shared modal primitives
const Overlay = ({ title, subtitle, children, onClose, wide }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
        <div className={cx("flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl", wide ? "max-w-2xl" : "max-w-lg")} style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-secondary px-5 py-3">
                <div><h2 className="text-md font-semibold text-primary">{title}</h2>{subtitle && <p className="text-xs text-tertiary">{subtitle}</p>}</div>
                <button type="button" onClick={onClose} className="rounded p-1 text-quaternary hover:text-secondary"><X className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </div>
    </div>
);
const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
    <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-secondary">{label}</span>
        {children}
        {hint && <span className="text-[11px] text-quaternary">{hint}</span>}
    </div>
);
const inputCls = "w-full rounded-lg px-3 py-2 text-sm text-primary outline-none";
// Explicit color (not just the class) so native <select>/<option> don't fall back to OS-default black in dark mode.
const inputStyle = { background: "var(--surface-2)", border: "1px solid var(--c-border)", color: "var(--c-text-primary)" } as const;

// ---- Add / edit key modal ----
const KeyModal = ({ keyToEdit, projects, envVars, lockedProjectId, onClose, onSave }: { keyToEdit: APIKey | null; projects: Project[]; envVars: { id: string; name: string; envName: string }[]; lockedProjectId?: string; onClose: () => void; onSave: (k: APIKey) => void }) => {
    const [svcId, setSvcId] = useState(keyToEdit?.serviceId ?? "");
    const [svcSearch, setSvcSearch] = useState("");
    const [svcOpen, setSvcOpen] = useState(false);
    const [customName, setCustomName] = useState(keyToEdit && !SERVICE_BY_ID[keyToEdit.serviceId] ? keyToEdit.serviceName : "");
    const [customDomain, setCustomDomain] = useState(keyToEdit && !SERVICE_BY_ID[keyToEdit.serviceId] ? keyToEdit.serviceDomain : "");
    const [nickname, setNickname] = useState(keyToEdit?.nickname ?? "");
    const [value, setValue] = useState(keyToEdit?.keyValue ?? "");
    const [category, setCategory] = useState<ServiceCategory>(keyToEdit?.category ?? "ai");
    const [environment, setEnvironment] = useState<KeyEnvironment>(keyToEdit?.environment ?? "production");
    const [expiry, setExpiry] = useState(keyToEdit?.expiresAt ? new Date(keyToEdit.expiresAt).toISOString().slice(0, 10) : "");
    const [scopes, setScopes] = useState(keyToEdit?.scopes?.join(", ") ?? "");
    const [note, setNote] = useState(keyToEdit?.note ?? "");
    const [tags, setTags] = useState(keyToEdit?.tags.join(", ") ?? "");
    const [projectId, setProjectId] = useState(keyToEdit?.projectId ?? lockedProjectId ?? "");
    const [linkedEnvVarId, setLinkedEnvVarId] = useState(keyToEdit?.linkedEnvVarId ?? "");
    const [aiAccess, setAiAccess] = useState(keyToEdit?.aiAgentAccess ?? false);
    const [aiScope, setAiScope] = useState<APIKey["aiAccessScope"]>(keyToEdit?.aiAccessScope ?? "read");
    const isCustom = svcId === "__custom__" || (!!keyToEdit && !SERVICE_BY_ID[keyToEdit.serviceId] && svcId === keyToEdit.serviceId);

    const svc = SERVICE_BY_ID[svcId];
    useEffect(() => { if (svc) setCategory(svc.category); }, [svc]);

    const filteredSvcs = useMemo(() => {
        const q = svcSearch.trim().toLowerCase();
        return SERVICES.filter((s) => !q || s.name.toLowerCase().includes(q));
    }, [svcSearch]);

    const strength = strengthOf(value);
    const canSave = (svcId === "__custom__" ? customName.trim() && customDomain.trim() : !!svcId) && nickname.trim() && value.trim();

    const generate = () => {
        const bytes = new Uint8Array(24);
        crypto.getRandomValues(bytes);
        setValue("sk_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
    };

    const save = () => {
        const resolved = svcId === "__custom__"
            ? { serviceId: genId("custom"), serviceName: customName.trim(), serviceDomain: customDomain.trim() }
            : svc
                ? { serviceId: svc.id, serviceName: svc.name, serviceDomain: svc.domain }
                : { serviceId: keyToEdit!.serviceId, serviceName: keyToEdit!.serviceName, serviceDomain: keyToEdit!.serviceDomain };
        const now = Date.now();
        onSave({
            id: keyToEdit?.id ?? genId("key"),
            ...resolved,
            nickname: nickname.trim(),
            keyValue: value.trim(),
            keyPreview: "",
            category,
            environment,
            status: "unverified",
            expiresAt: expiry ? new Date(expiry).getTime() : null,
            lastUsed: keyToEdit?.lastUsed ?? null,
            lastTested: keyToEdit?.lastTested ?? null,
            testStatus: keyToEdit?.testStatus ?? "untested",
            aiAgentAccess: aiAccess,
            aiAccessScope: aiScope,
            projectId: lockedProjectId || projectId || null,
            note: note.trim(),
            tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
            scopes: scopes.split(",").map((s) => s.trim()).filter(Boolean),
            createdAt: keyToEdit?.createdAt ?? now,
            updatedAt: now,
            linkedEnvVarId: linkedEnvVarId || undefined,
            linkedEnvVarName: linkedEnvVarId ? envVars.find((v) => v.id === linkedEnvVarId)?.name : undefined,
        });
    };

    return (
        <Overlay title={keyToEdit ? "Edit API key" : "Add API key"} subtitle="Stored locally; sent only to the selected provider when you test or use it." onClose={onClose} wide>
            <div className="flex flex-col gap-4">
                {/* Service picker */}
                <Field label="Service">
                    {isCustom ? (
                        <div className="flex flex-col gap-2">
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <Input value={customName} onChange={setCustomName} placeholder="Service name" size="sm" />
                                <Input value={customDomain} onChange={setCustomDomain} placeholder="domain.com" size="sm" />
                            </div>
                            <button type="button" onClick={() => { setSvcId(""); }} className="self-start text-xs text-tertiary hover:text-secondary">← Pick from catalog</button>
                        </div>
                    ) : (
                        <div className="relative">
                            <button type="button" onClick={() => setSvcOpen((v) => !v)} className={cx(inputCls, "flex items-center gap-2")} style={inputStyle}>
                                {svc ? <><BrandLogo domain={svc.domain} name={svc.name} size={22} /><span className="text-primary">{svc.name}</span></> : <span className="text-quaternary">Search 36+ services…</span>}
                            </button>
                            {svcOpen && (
                                <div className="absolute z-30 mt-1 max-h-72 w-full overflow-hidden rounded-lg shadow-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                    <div className="border-b p-2" style={{ borderColor: "var(--c-border)" }}>
                                        <Input icon={SearchMd} autoFocus value={svcSearch} onChange={setSvcSearch} placeholder="Filter…" size="sm" />
                                    </div>
                                    <div className="max-h-52 overflow-y-auto p-1">
                                        {filteredSvcs.map((s) => (
                                            <button key={s.id} type="button" onClick={() => { setSvcId(s.id); setSvcOpen(false); setSvcSearch(""); }} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-secondary hover:bg-[var(--surface-2)]">
                                                <BrandLogo domain={s.domain} name={s.name} size={22} /><span className="flex-1 text-primary">{s.name}</span><CatBadge c={s.category} />
                                            </button>
                                        ))}
                                        <button type="button" onClick={() => { setSvcId("__custom__"); setSvcOpen(false); }} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-secondary hover:bg-[var(--surface-2)]">
                                            <span className="flex size-[22px] items-center justify-center rounded-md" style={{ background: "var(--surface-2)" }}><Plus className="size-3.5 text-tertiary" /></span> Custom service…
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </Field>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Nickname"><Input value={nickname} onChange={setNickname} placeholder="Production key" size="sm" /></Field>
                    <Field label="Category">
                        <NativeSelect
                            size="sm"
                            value={category}
                            onChange={(e) => setCategory(e.target.value as ServiceCategory)}
                            options={(Object.keys(CATEGORY_LABELS) as ServiceCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
                        />
                    </Field>
                </div>

                <Field label="API key value">
                    <div className="flex items-center gap-2">
                        <div className="flex-1">
                            <Input type="password" value={value} onChange={setValue} placeholder="sk-…" size="sm" inputClassName="font-mono" />
                        </div>
                        <button type="button" onClick={generate} className="shrink-0 rounded-lg px-2.5 py-2 text-xs font-medium text-secondary hover:bg-[var(--surface-2)]" style={{ border: "1px solid var(--c-border)" }}>Generate</button>
                    </div>
                    {value && (
                        <div className="flex items-center gap-2">
                            <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}><div className="h-full rounded-full transition-all" style={{ width: `${strength.pct}%`, background: strength.color }} /></div>
                            <span className="text-[11px] font-medium" style={{ color: strength.color }}>{strength.label}</span>
                        </div>
                    )}
                </Field>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Environment">
                        <div className="flex overflow-hidden rounded-lg" style={{ border: "1px solid var(--c-border)" }}>
                            {ENVIRONMENTS.map((e) => (
                                <button key={e} type="button" onClick={() => setEnvironment(e)} className={cx("flex-1 py-1.5 text-[11px] font-medium capitalize transition", environment === e ? "text-primary" : "text-quaternary")} style={{ background: environment === e ? "var(--surface-2)" : "transparent" }}>{e}</button>
                            ))}
                        </div>
                    </Field>
                    <Field label="Expiry date" hint="Reminder fires 7 days before."><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputCls} style={inputStyle} /></Field>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Link to project">
                        {lockedProjectId ? (
                            <p className="rounded-lg px-3 py-2 text-sm text-secondary" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                                {projects.find((p) => p.id === lockedProjectId)?.name ?? "This project"}
                            </p>
                        ) : (
                            <NativeSelect
                                size="sm"
                                value={projectId}
                                onChange={(e) => setProjectId(e.target.value)}
                                options={[{ value: "", label: "None" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                            />
                        )}
                    </Field>
                    <Field label="Link to env var" hint="Associates this key with a variable">
                        <NativeSelect
                            size="sm"
                            value={linkedEnvVarId}
                            onChange={(e) => setLinkedEnvVarId(e.target.value)}
                            options={[{ value: "", label: "None" }, ...envVars.map((v) => ({ value: v.id, label: `${v.name} (${v.envName})` }))]}
                        />
                    </Field>
                </div>

                <Field label="Tags" hint="Comma-separated"><Input value={tags} onChange={setTags} placeholder="billing, prod" size="sm" /></Field>

                <Field label="Permissions / scopes" hint="Comma-separated"><Input value={scopes} onChange={setScopes} placeholder="read:user, write:repo" size="sm" /></Field>
                <Field label="Note"><TextArea value={note} onChange={setNote} rows={2} placeholder="What is this key for?" size="sm" /></Field>

                {/* AI agent access */}
                <div className="flex flex-col gap-2.5 rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-medium text-primary"><Zap className="size-4 text-[var(--brand)]" /> AI agent access</span>
                        <Toggle size="sm" isSelected={aiAccess} onChange={setAiAccess} aria-label="AI agent access" />
                    </div>
                    {aiAccess && (
                        <div className="flex overflow-hidden rounded-lg" style={{ border: "1px solid var(--c-border)" }}>
                            {(["read", "write", "full"] as APIKey["aiAccessScope"][]).map((s) => (
                                <button key={s} type="button" onClick={() => setAiScope(s)} className={cx("flex-1 py-1.5 text-xs font-medium capitalize transition", aiScope === s ? "text-white" : "text-secondary")} style={{ background: aiScope === s ? "var(--brand)" : "transparent" }}>{s}</button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 pt-1">
                    <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-secondary hover:bg-[var(--surface-2)]">Cancel</button>
                    <button type="button" disabled={!canSave} onClick={save} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--brand)" }}>{keyToEdit ? "Save changes" : "Add key"}</button>
                </div>
            </div>
        </Overlay>
    );
};

// ---- MCP config modal ----
const PERM_OPTS: MCPToolBinding["permission"][] = ["disabled", "read", "write"];
const PERM_COLOR: Record<MCPToolBinding["permission"], string> = { disabled: "#94a3b8", read: "#22c55e", write: "#f59e0b" };

const McpConfigModal = ({ integration, onClose, onSave }: { integration: ServiceConnection; onClose: () => void; onSave: (i: ServiceConnection) => void }) => {
    const [draft, setDraft] = useState<ServiceConnection>(integration);
    const setTool = (id: string, patch: Partial<MCPToolBinding>) =>
        setDraft((d) => ({ ...d, mcpTools: d.mcpTools.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

    const enabledTools = draft.mcpTools.filter((t) => t.permission !== "disabled");
    const snippet = JSON.stringify({
        connectorId: draft.id,
        runtimeServerId: draft.runtimeServerId,
        access: enabledTools.some((t) => t.permission === "write") ? "read-write" : "read",
        tools: enabledTools.map((t) => t.name),
    }, null, 2);

    return (
        <Overlay title={`${integration.serviceName} — MCP connector`} subtitle="Choose what AI agents can do with this integration." onClose={onClose} wide>
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                    <span className="flex items-center gap-2 text-sm font-medium text-primary"><Lightning01 className="size-4 text-[var(--brand)]" /> Enable for AI agents</span>
                    <Toggle size="sm" isSelected={draft.agentEnabled ?? draft.mcpEnabled} onChange={(v) => setDraft((d) => ({ ...d, mcpEnabled: v, agentEnabled: v }))} aria-label="Enable for supported AI agents" />
                </div>

                <div className={cx("flex flex-col gap-2", !(draft.agentEnabled ?? draft.mcpEnabled) && "pointer-events-none opacity-50")}>
                    <span className="text-xs font-medium text-secondary">Available tools / actions</span>
                    {draft.mcpTools.map((t) => (
                        <div key={t.id} className="flex flex-col gap-2 rounded-lg p-2.5" style={{ background: "var(--surface-2)" }}>
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0"><div className="text-sm font-medium text-primary">{t.name}</div><div className="truncate text-[11px] text-tertiary">{t.description}</div></div>
                                <div className="flex overflow-hidden rounded-md" style={{ border: "1px solid var(--c-border)" }}>
                                    {PERM_OPTS.map((p) => (
                                        <button key={p} type="button" onClick={() => setTool(t.id, { permission: p })} className={cx("px-2 py-1 text-[11px] font-medium capitalize transition", t.permission === p ? "text-white" : "text-tertiary")} style={{ background: t.permission === p ? PERM_COLOR[p] : "transparent" }}>{p}</button>
                                    ))}
                                </div>
                            </div>
                            {t.permission === "write" && (
                                <div className="flex items-center justify-between border-t pt-2" style={{ borderColor: "var(--c-border)" }}>
                                    <Checkbox size="sm" isSelected={t.requiresConfirmation} onChange={(v) => setTool(t.id, { requiresConfirmation: v })} label="Require confirmation before running" />
                                    <div className="flex items-center gap-1.5 text-[11px] text-tertiary">Limit/day <div className="w-16"><Input type="number" value={t.usageLimit != null ? String(t.usageLimit) : ""} onChange={(v) => setTool(t.id, { usageLimit: v && Number(v) >= 0 ? Number(v) : null })} placeholder="∞" size="sm" inputClassName="text-xs" /></div></div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <Field label="Runtime assignment">
                    <CodeSnippet code={snippet} title={`${draft.serviceId} connector`} language="json" />
                </Field>

                <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: "var(--c-border)" }}>
                    <span className="flex items-center gap-1.5 text-xs text-tertiary"><BarChartSquare02 className="size-3.5" /> {enabledTools.length} of {draft.mcpTools.length} tools enabled</span>
                    <div className="flex gap-2">
                        <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-secondary hover:bg-[var(--surface-2)]">Cancel</button>
                        <button type="button" onClick={() => onSave(draft)} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--brand)" }}>Save connector</button>
                    </div>
                </div>
            </div>
        </Overlay>
    );
};
