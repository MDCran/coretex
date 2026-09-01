// @ts-nocheck
"use client";

// Coretex — Model Pricing. Connected providers first; cached offline catalog in a
// separate section. Sortable/filterable table with proper labels and capitalization.
import { useMemo, useState } from "react";
import type { ModelCapability, ModelInfo, ProviderType } from "@repo/coretex/types";
import { ArrowDown, ArrowUp, Cloud01, Coins01, Download01, RefreshCcw01, SearchLg, Server01, WifiOff } from "@untitledui/icons";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { cx } from "@/utils/cx";
import { capabilityLabel, familyLabel, modelLabel, providerLabel } from "../labels";
import { LOCAL_PROVIDER_IDS, providerLogoDomain } from "../provider-meta";
import { SettingsSection } from "../settings/controls";
import { SettingsPageHeader, SettingsStatusBadge } from "../settings/settings-shell";
import { BrandLogo } from "../ui/brand-logo";
import type { CoretexActions, CoretexState } from "../use-coretex";

const LOCAL = LOCAL_PROVIDER_IDS;
const CAP_COLOR: Record<ModelCapability, string> = {
    chat: "#3b82f6",
    vision: "#8b5cf6",
    tools: "#f59e0b",
    embedding: "#22c55e",
    audio: "#ec4899",
    image: "#06b6d4",
};

type ConnectionKind = "connected" | "cached";

type Row = {
    provider: ProviderType;
    id: string;
    name: string;
    family: string;
    context?: number;
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    caps: ModelCapability[];
    isLocal: boolean;
    connection: ConnectionKind;
    cost: "local" | "cloud" | "unknown";
};
type SortKey = "provider" | "name" | "context" | "input" | "output" | "est";

function displayModelName(m: ModelInfo): string {
    if (m.displayName?.trim()) return m.displayName.trim();
    return modelLabel(m.id);
}

function rowFrom(m: ModelInfo, connection: ConnectionKind): Row {
    const isLocal = LOCAL.has(m.provider);
    const input = m.pricing?.inputPer1M;
    const output = m.pricing?.outputPer1M;
    const hasPrice = input != null || output != null;
    return {
        provider: m.provider,
        id: m.id,
        name: displayModelName(m),
        family: familyLabel(m.family),
        context: m.contextLength,
        input,
        output,
        cacheRead: m.pricing?.cacheReadPer1M,
        cacheWrite: m.pricing?.cacheWritePer1M,
        caps: m.capabilities ?? ["chat"],
        isLocal,
        connection,
        cost: isLocal ? "local" : hasPrice ? "cloud" : "unknown",
    };
}

/** Merge live catalog + healthy provider probes; split connected vs cached offline. */
function buildCatalog(state: CoretexState): {
    connected: Row[];
    cached: Row[];
} {
    const byKey = new Map<string, ModelInfo>();
    const healthy = new Set((state.health ?? []).filter((h) => h.healthy).map((h) => h.provider));

    for (const m of state.models ?? []) {
        byKey.set(`${m.provider}:${m.id}`, m);
    }
    for (const h of state.health ?? []) {
        if (!h.healthy) continue;
        for (const m of h.models) {
            const key = `${m.provider}:${m.id}`;
            if (!byKey.has(key)) byKey.set(key, { ...m, stale: false });
        }
    }

    const connected: Row[] = [];
    const cached: Row[] = [];
    for (const m of byKey.values()) {
        const isCached = m.stale === true || !healthy.has(m.provider);
        if (isCached) cached.push(rowFrom(m, "cached"));
        else connected.push(rowFrom(m, "connected"));
    }

    return { connected, cached };
}

function groupByProvider(rows: Row[]): [ProviderType, Row[]][] {
    const g = new Map<ProviderType, Row[]>();
    for (const r of rows) (g.get(r.provider) ?? g.set(r.provider, []).get(r.provider)!).push(r);
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Per-1M → display value honoring the /1K toggle. */
function money(v: number | undefined, perK: boolean): string {
    if (v == null) return "—";
    const n = perK ? v / 1000 : v;
    return "$" + (n < 0.01 ? n.toFixed(4) : n.toFixed(2));
}
function estCost(r: Row, inTok: number, outTok: number, reqs: number): number | null {
    if (r.isLocal) return 0;
    if (r.input == null && r.output == null) return null;
    return ((inTok / 1e6) * (r.input ?? 0) + (outTok / 1e6) * (r.output ?? 0)) * reqs;
}

function filterRows(rows: Row[], q: string, capFilter: ModelCapability | "all", scope: string): Row[] {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
        if (capFilter !== "all" && !r.caps.includes(capFilter)) return false;
        if (scope === "local" && !r.isLocal) return false;
        if (scope === "cloud" && r.isLocal) return false;
        if (scope === "paid" && r.cost !== "cloud") return false;
        if (scope === "priced" && r.cost === "unknown") return false;
        if (s && !`${r.name} ${r.id} ${r.provider} ${r.family} ${providerLabel(r.provider)}`.toLowerCase().includes(s)) return false;
        return true;
    });
}

function sortRows(rows: Row[], sortKey: SortKey, sortDir: "asc" | "desc", inTok: number, outTok: number, reqs: number): Row[] {
    const dir = sortDir === "asc" ? 1 : -1;
    const big = Number.MAX_SAFE_INTEGER;
    return [...rows].sort((a, b) => {
        switch (sortKey) {
            case "name":
                return a.name.localeCompare(b.name) * dir;
            case "context":
                return ((a.context ?? -1) - (b.context ?? -1)) * dir;
            case "input":
                return ((a.input ?? (a.isLocal ? 0 : big)) - (b.input ?? (b.isLocal ? 0 : big))) * dir;
            case "output":
                return ((a.output ?? (a.isLocal ? 0 : big)) - (b.output ?? (b.isLocal ? 0 : big))) * dir;
            case "est": {
                const ea = estCost(a, inTok, outTok, reqs) ?? big;
                const eb = estCost(b, inTok, outTok, reqs) ?? big;
                return (ea - eb) * dir;
            }
            case "provider":
            default:
                return (a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name)) * dir;
        }
    });
}

export const ModelPricingView = ({ state, actions }: { state: CoretexState; actions: CoretexActions }) => {
    const [q, setQ] = useState("");
    const [grouped, setGrouped] = useState(true);
    const [perK, setPerK] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey>("provider");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
    const [capFilter, setCapFilter] = useState<ModelCapability | "all">("all");
    const [scope, setScope] = useState<"all" | "local" | "cloud" | "paid" | "priced">("all");
    const [estOn, setEstOn] = useState(false);
    const [inTok, setInTok] = useState(2000);
    const [outTok, setOutTok] = useState(500);
    const [reqs, setReqs] = useState(1000);

    const catalog = useMemo(() => buildCatalog(state), [state.models, state.health]);

    const connectedSorted = useMemo(() => {
        const filtered = filterRows(catalog.connected, q, capFilter, scope);
        return sortRows(filtered, sortKey, sortDir, inTok, outTok, reqs);
    }, [catalog.connected, q, capFilter, scope, sortKey, sortDir, inTok, outTok, reqs]);

    const cachedSorted = useMemo(() => {
        const filtered = filterRows(catalog.cached, q, capFilter, scope);
        return sortRows(filtered, sortKey, sortDir, inTok, outTok, reqs);
    }, [catalog.cached, q, capFilter, scope, sortKey, sortDir, inTok, outTok, reqs]);

    const sorted = useMemo(() => [...connectedSorted, ...cachedSorted], [connectedSorted, cachedSorted]);

    const connectedProviders = useMemo(() => new Set(connectedSorted.map((r) => r.provider)).size, [connectedSorted]);

    const cheapestInput = useMemo(
        () => Math.min(...connectedSorted.filter((r) => r.cost === "cloud" && r.input != null).map((r) => r.input!)),
        [connectedSorted],
    );

    const connectedGroups = useMemo(
        () => (grouped ? groupByProvider(connectedSorted) : [["", connectedSorted] as [string, Row[]]]),
        [connectedSorted, grouped],
    );
    const cachedGroups = useMemo(() => (grouped ? groupByProvider(cachedSorted) : [["", cachedSorted] as [string, Row[]]]), [cachedSorted, grouped]);

    const toggleSort = (k: SortKey) => {
        if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else {
            setSortKey(k);
            setSortDir("asc");
        }
    };

    const exportCsv = () => {
        const head = [
            "Connection",
            "Provider",
            "Model",
            "Id",
            "Family",
            "Context",
            "Input/1M",
            "Output/1M",
            "Capabilities",
            "Cost Type",
            ...(estOn ? ["Est. Cost"] : []),
        ];
        const lines = [head.join(",")];
        for (const r of sorted) {
            const est = estOn
                ? (() => {
                      const e = estCost(r, inTok, outTok, reqs);
                      return e == null ? "Unknown" : "$" + e.toFixed(2);
                  })()
                : null;
            const cells = [
                r.connection === "connected" ? "Connected" : "Cached",
                providerLabel(r.provider),
                r.name,
                r.id,
                r.family,
                r.context ?? "",
                r.input ?? (r.isLocal ? "0" : "Unknown"),
                r.output ?? (r.isLocal ? "0" : "Unknown"),
                r.caps.map(capabilityLabel).join("|"),
                r.cost === "local" ? "Local — Free" : r.cost === "unknown" ? "Unknown" : "Cloud",
                ...(est != null ? [est] : []),
            ];
            lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
        }
        const blob = new Blob([lines.join("\n")], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "coretex-model-pricing.csv";
        a.click();
        URL.revokeObjectURL(url);
    };

    const SortHead = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
        <th className={cx("px-3 py-2 text-left text-xs font-semibold text-tertiary", className)}>
            <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-primary">
                {label}
                {sortKey === k && (sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
            </button>
        </th>
    );

    const colSpan = (grouped ? 8 : 9) + (estOn ? 1 : 0);
    const hasConnected = connectedSorted.length > 0;
    const hasCached = cachedSorted.length > 0;
    const healthyCount = (state.health ?? []).filter((h) => h.healthy).length;

    return (
        <div className="flex min-w-0 flex-col gap-6">
            <SettingsPageHeader
                icon={Coins01}
                title="Model pricing"
                subtitle={`Compare token pricing in USD per ${perK ? "1K" : "1M"} tokens across live and cached provider catalogs.`}
                badges={
                    <>
                        <SettingsStatusBadge label={`${connectedSorted.length} connected`} color={hasConnected ? "success" : "gray"} />
                        {hasCached && <SettingsStatusBadge label={`${cachedSorted.length} cached`} color="warning" />}
                        {healthyCount > 0 && <SettingsStatusBadge label={`${healthyCount} live provider${healthyCount === 1 ? "" : "s"}`} color="brand" />}
                    </>
                }
            />

            <SettingsSection
                title="Pricing controls"
                description="Choose display units, estimate a workload, refresh provider data, or export the current catalog."
            >
                <div className="flex flex-wrap items-center gap-2 py-1">
                    <Button
                        size="sm"
                        color={estOn ? "primary" : "secondary"}
                        iconLeading={Coins01}
                        onClick={() => {
                            const willBeOn = !estOn;
                            setEstOn(willBeOn);
                            if (willBeOn) setSortKey("est");
                        }}
                    >
                        {estOn ? "Estimator on" : "Cost estimator"}
                    </Button>
                    <Button size="sm" color="secondary" onClick={() => setPerK((v) => !v)}>
                        Prices {perK ? "/1K" : "/1M"}
                    </Button>
                    <Button size="sm" color="secondary" iconLeading={RefreshCcw01} onClick={() => actions.healthCheck?.()}>
                        Refresh
                    </Button>
                    <Button size="sm" color="secondary" iconLeading={Download01} onClick={exportCsv}>
                        Export CSV
                    </Button>
                </div>
            </SettingsSection>

            {estOn && (
                <SettingsSection title="Cost estimator" description="Estimate token spend for one workload, then sort the catalog by its projected cost.">
                    <div className="grid grid-cols-1 items-end gap-3 py-1 sm:grid-cols-3 xl:grid-cols-[repeat(3,minmax(9rem,12rem))_minmax(16rem,1fr)]">
                        <NumField label="Input tokens / request" value={inTok} onChange={setInTok} />
                        <NumField label="Output tokens / request" value={outTok} onChange={setOutTok} />
                        <NumField label="Requests" value={reqs} onChange={setReqs} />
                        <p className="text-xs leading-relaxed text-quaternary sm:col-span-3 xl:col-span-1">
                            Estimated cost = (input + output pricing) × requests. Local models are compute-only ($0). Sort by{" "}
                            <span className="font-medium text-secondary">Est. cost</span> to compare this workload.
                        </p>
                    </div>
                </SettingsSection>
            )}

            <SettingsSection
                title="Model catalog"
                description="Filter, sort, and compare the models reported by your providers. Cached entries are kept visible when a provider is offline."
            >
                <div className="flex min-w-0 flex-col gap-4 py-1">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                        <Input aria-label="Search models" size="sm" icon={SearchLg} value={q} onChange={setQ} placeholder="Search models" className="w-full lg:w-56" />
                        <div className="min-w-0 overflow-x-auto pb-1">
                            <div className="flex w-max items-center gap-2">
                                <Seg
                                    options={[
                                        ["all", "All"],
                                        ["local", "Local"],
                                        ["cloud", "Cloud"],
                                        ["paid", "Paid"],
                                        ["priced", "Has price"],
                                    ]}
                                    value={scope}
                                    onChange={(v) => setScope(v as typeof scope)}
                                />
                                <Seg
                                    options={[
                                        ["all", "All capabilities"],
                                        ["chat", "Chat"],
                                        ["vision", "Vision"],
                                        ["tools", "Tools"],
                                        ["embedding", "Embedding"],
                                    ]}
                                    value={capFilter}
                                    onChange={(v) => setCapFilter(v as typeof capFilter)}
                                />
                                <Button size="sm" color="secondary" onClick={() => setGrouped((v) => !v)}>
                                    {grouped ? "Grouped" : "Flat"}
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div
                        className="max-h-[min(65vh,48rem)] min-h-80 overflow-auto rounded-xl"
                        style={{
                            background: "var(--surface-2)",
                            border: "1px solid var(--c-border)",
                        }}
                    >
                        <table className="w-full min-w-[980px] border-collapse text-sm">
                            <thead className="sticky top-0 z-10" style={{ background: "var(--surface-2)" }}>
                                <tr style={{ borderBottom: "1px solid var(--c-border)" }}>
                                    {!grouped && <SortHead k="provider" label="Provider" />}
                                    <SortHead k="name" label="Model" />
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-tertiary">Family</th>
                                    <SortHead k="context" label="Context" />
                                    <SortHead k="input" label={`Input /${perK ? "1K" : "1M"}`} />
                                    <SortHead k="output" label={`Output /${perK ? "1K" : "1M"}`} />
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-tertiary">Cache R/W</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-tertiary">Capabilities</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-tertiary">Cost Type</th>
                                    {estOn && <SortHead k="est" label="Est. Cost" />}
                                </tr>
                            </thead>
                            <tbody>
                                {!hasConnected && !hasCached && (
                                    <tr>
                                        <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-quaternary">
                                            No models match. Connect a provider, refresh health, or clear filters.
                                        </td>
                                    </tr>
                                )}

                                {hasConnected && (
                                    <SectionBlock
                                        title="Connected Providers"
                                        subtitle={`${connectedSorted.length} models · ${connectedProviders} provider${connectedProviders === 1 ? "" : "s"} live`}
                                        icon={Cloud01}
                                        groups={connectedGroups}
                                        grouped={grouped}
                                        perK={perK}
                                        cheapestInput={cheapestInput}
                                        estOn={estOn}
                                        estFn={(r) => estCost(r, inTok, outTok, reqs)}
                                        colSpan={colSpan}
                                    />
                                )}

                                {hasCached && (
                                    <SectionBlock
                                        title="Cached Catalog"
                                        subtitle={`${cachedSorted.length} models · provider offline — last known prices`}
                                        icon={WifiOff}
                                        muted
                                        groups={cachedGroups}
                                        grouped={grouped}
                                        perK={perK}
                                        cheapestInput={Number.NaN}
                                        estOn={estOn}
                                        estFn={(r) => estCost(r, inTok, outTok, reqs)}
                                        colSpan={colSpan}
                                    />
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </SettingsSection>

            <p className="text-[11px] text-quaternary">
                Source: provider model APIs + Coretex pricing map · token pricing only, not billing advice.{" "}
                <span className="text-tertiary">Prices are estimates and may change — verify with the provider.</span> Cache read/write are derived from
                documented provider ratios (Anthropic 0.1×/1.25× input, OpenAI 0.5× input).
            </p>
        </div>
    );
};

const SectionBlock = ({
    title,
    subtitle,
    icon: Icon,
    muted,
    groups,
    grouped,
    perK,
    cheapestInput,
    estOn,
    estFn,
    colSpan,
}: {
    title: string;
    subtitle: string;
    icon: typeof Cloud01;
    muted?: boolean;
    groups: [string, Row[]][];
    grouped: boolean;
    perK: boolean;
    cheapestInput: number;
    estOn: boolean;
    estFn: (r: Row) => number | null;
    colSpan: number;
}) => (
    <>
        <tr
            style={{
                background: muted ? "color-mix(in srgb, var(--c-warning, #f59e0b) 6%, var(--surface-2))" : "var(--surface-2)",
            }}
        >
            <td colSpan={colSpan} className="px-3 py-2">
                <span className="flex items-center gap-2">
                    <Icon className={cx("size-4", muted ? "text-warning-primary" : "text-brand-secondary")} />
                    <span className="text-sm font-semibold text-primary">{title}</span>
                    <span className="text-xs text-quaternary">· {subtitle}</span>
                </span>
            </td>
        </tr>
        {groups.map(([prov, list]) => (
            <GroupBlock
                key={`${title}:${prov || "flat"}`}
                prov={prov as ProviderType | ""}
                list={list}
                grouped={grouped}
                perK={perK}
                cheapestInput={cheapestInput}
                estOn={estOn}
                estFn={estFn}
                cached={muted}
                colSpan={colSpan}
            />
        ))}
    </>
);

const GroupBlock = ({
    prov,
    list,
    grouped,
    perK,
    cheapestInput,
    estOn,
    estFn,
    cached,
    colSpan,
}: {
    prov: ProviderType | "";
    list: Row[];
    grouped: boolean;
    perK: boolean;
    cheapestInput: number;
    estOn: boolean;
    estFn: (r: Row) => number | null;
    cached?: boolean;
    colSpan: number;
}) => (
    <>
        {grouped && prov && (
            <tr style={{ background: "var(--surface-2)" }}>
                <td colSpan={colSpan} className="px-3 py-1.5">
                    <span className="flex items-center gap-1.5">
                        <BrandLogo domain={providerLogoDomain(prov)} name={providerLabel(prov)} size={14} chip={false} />
                        <span className="text-xs font-semibold text-secondary">{providerLabel(prov)}</span>
                        <span className="text-xs text-quaternary">· {list.length}</span>
                    </span>
                </td>
            </tr>
        )}
        {list.map((r) => {
            const est = estOn ? estFn(r) : null;
            const cheapest = !cached && r.cost === "cloud" && r.input != null && r.input === cheapestInput && Number.isFinite(cheapestInput);
            return (
                <tr key={`${r.provider}:${r.id}`} className="transition hover:bg-[var(--surface-2)]" style={{ borderBottom: "1px solid var(--c-border)" }}>
                    {!grouped && (
                        <td className="px-3 py-2">
                            <span className="flex items-center gap-1.5">
                                <BrandLogo domain={providerLogoDomain(r.provider)} name={providerLabel(r.provider)} size={14} chip={false} />
                                <span className="text-xs text-secondary">{providerLabel(r.provider)}</span>
                            </span>
                        </td>
                    )}
                    <td className="px-3 py-2">
                        <span className="flex flex-col">
                            <span className="flex items-center gap-1.5 font-medium text-primary">
                                {r.name}
                                {cheapest && (
                                    <span className="rounded px-1 py-0.5 text-[9px] font-bold text-white" style={{ background: "#22c55e" }}>
                                        Cheapest
                                    </span>
                                )}
                                {cached && (
                                    <span
                                        title="Provider offline — cached catalog"
                                        className="rounded px-1 py-0.5 text-[9px] font-semibold text-warning-primary"
                                        style={{
                                            background: "color-mix(in srgb, #f59e0b 18%, transparent)",
                                        }}
                                    >
                                        Cached
                                    </span>
                                )}
                            </span>
                            <span className="font-mono text-[10px] text-quaternary">{r.id}</span>
                        </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-tertiary">{r.family}</td>
                    <td className="px-3 py-2 text-xs text-tertiary tabular-nums">
                        {r.context ? (r.context >= 1000 ? `${Math.round(r.context / 1000)}k` : r.context) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-secondary tabular-nums">
                        {r.isLocal ? <span className="text-success-primary">Free</span> : money(r.input, perK)}
                    </td>
                    <td className="px-3 py-2 text-xs text-secondary tabular-nums">
                        {r.isLocal ? <span className="text-success-primary">Free</span> : money(r.output, perK)}
                    </td>
                    <td className="px-3 py-2 text-xs text-quaternary tabular-nums">
                        {r.cacheRead != null || r.cacheWrite != null ? `${money(r.cacheRead, perK)} / ${money(r.cacheWrite, perK)}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                            {r.caps.map((c) => (
                                <span key={c} className="rounded px-1 py-0.5 text-[9px] font-semibold text-white" style={{ background: CAP_COLOR[c] }}>
                                    {capabilityLabel(c)}
                                </span>
                            ))}
                        </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                        {r.cost === "local" ? (
                            <span className="inline-flex items-center gap-1 text-success-primary">
                                <Server01 className="size-3" /> Local — Free
                            </span>
                        ) : r.cost === "cloud" ? (
                            <span className="inline-flex items-center gap-1 text-tertiary">
                                <Cloud01 className="size-3" /> Cloud
                            </span>
                        ) : (
                            <span className="text-quaternary">Unknown</span>
                        )}
                    </td>
                    {estOn && (
                        <td className="px-3 py-2 text-xs font-medium text-primary tabular-nums">
                            {est == null ? (
                                <span className="text-quaternary">—</span>
                            ) : est === 0 ? (
                                <span className="text-success-primary">$0</span>
                            ) : (
                                "$" + est.toFixed(2)
                            )}
                        </td>
                    )}
                </tr>
            );
        })}
    </>
);

const Seg = ({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) => (
    <ButtonGroup
        size="sm"
        selectedKeys={[value]}
        onSelectionChange={(keys) => {
            const next = [...keys][0] as string | undefined;
            if (next) onChange(next);
        }}
    >
        {options.map(([v, label]) => (
            <ButtonGroupItem key={v} id={v}>
                {label}
            </ButtonGroupItem>
        ))}
    </ButtonGroup>
);

const NumField = ({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) => (
    <label className="flex w-full flex-col gap-1">
        <span className="text-[11px] font-medium text-tertiary">{label}</span>
        <Input aria-label={label} type="number" size="sm" value={String(value)} onChange={(v) => onChange(Math.max(0, Number(v) || 0))} />
    </label>
);
