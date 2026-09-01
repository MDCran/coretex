// @ts-nocheck
"use client";

// Coretex — the shared model picker. Every model selector in the app (chat, agent
// create/edit, project default, council/compare) hydrates from the live catalog
// (state.models) through this one component: grouped by provider with <BrandLogo>,
// searchable, filterable by capability + local-vs-cloud, showing param/quant/state
// for local models and context/pricing for cloud. No hardcoded model lists.

import { useMemo, useRef, useState, type ReactNode } from "react";
import type { ModelCapability, ModelInfo, ProviderType } from "@repo/coretex/types";
import { ChevronDown, SearchLg, CheckCircle, Server01, Cloud01, XClose, Plus } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { BrandLogo } from "./brand-logo";
import { AnchoredPopover } from "./anchored-popover";
import { providerLabel } from "../labels";
import { LOCAL_PROVIDER_IDS, providerLogoDomain } from "../provider-meta";

const LOCAL_PROVIDERS = LOCAL_PROVIDER_IDS;
const STATE_COLOR: Record<string, string> = { running: "#22c55e", loaded: "#3b82f6", downloaded: "var(--c-text-muted)", available: "var(--c-text-muted)" };

function gb(n?: number): string | null {
    if (!n) return null;
    if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + " GB";
    if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(0) + " MB";
    return null;
}
function priceLabel(m: ModelInfo): string | null {
    const p = m.pricing;
    if (!p || (p.inputPer1M == null && p.outputPer1M == null)) return null;
    return `$${p.inputPer1M ?? "?"}/$${p.outputPer1M ?? "?"} ·1M`;
}
function ctxLabel(n?: number): string | null {
    if (!n) return null;
    if (n >= 1000) return `${Math.round(n / 1000)}k ctx`;
    return `${n} ctx`;
}

interface Props {
    models: ModelInfo[];
    value: { provider: ProviderType; id: string } | null;
    onChange: (provider: ProviderType, id: string) => void;
    /** Only show models with this capability (default chat). Pass undefined for all. */
    capability?: ModelCapability;
    placeholder?: string;
    /** When true, a smaller trigger. */
    compact?: boolean;
    className?: string;
    /** Optional "Compare all pricing →" footer link (e.g. navigate to the Model Pricing view). */
    onComparePricing?: () => void;
    /** Optional "Add AI provider" action shown in the dropdown (navigates to Settings → AI providers). */
    onAddProvider?: () => void;
    /**
     * Render a custom trigger instead of the built-in pill (e.g. the buddy bar's
     * model badge). Receives the current open state + a toggle. The dropdown panel
     * still anchors to it and stays fully on-screen.
     */
    renderTrigger?: (state: { open: boolean; toggle: () => void; current?: ModelInfo }) => ReactNode;
    /** Which trigger edge the dropdown aligns to (default "left"). */
    align?: "left" | "right";
    /** Disable the entire picker when the Brain/AI surface is unavailable. */
    isDisabled?: boolean;
    unavailableReason?: string;
}

export const ModelPicker = ({ models, value, onChange, capability = "chat", placeholder = "Select a model", compact, className, onComparePricing, onAddProvider, renderTrigger, align = "left", isDisabled, unavailableReason }: Props) => {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const [scope, setScope] = useState<"all" | "local" | "cloud">("all");
    const triggerRef = useRef<HTMLDivElement | null>(null);

    const current = value ? models.find((m) => m.provider === value.provider && m.id === value.id) : undefined;
    const toggle = () => {
        if (!isDisabled) setOpen((v) => !v);
    };

    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        return models.filter((m) => {
            if (capability && m.capabilities && !m.capabilities.includes(capability)) return false;
            if (scope === "local" && !LOCAL_PROVIDERS.has(m.provider)) return false;
            if (scope === "cloud" && LOCAL_PROVIDERS.has(m.provider)) return false;
            if (s && !`${m.displayName ?? m.name} ${m.family ?? ""} ${m.provider}`.toLowerCase().includes(s)) return false;
            return true;
        });
    }, [models, capability, scope, q]);

    const groups = useMemo(() => {
        const g = new Map<ProviderType, ModelInfo[]>();
        for (const m of filtered) {
            const arr = g.get(m.provider) ?? [];
            arr.push(m);
            g.set(m.provider, arr);
        }
        return [...g.entries()];
    }, [filtered]);

    return (
        <div ref={triggerRef} className={cx("relative min-w-0", className)}>
            {renderTrigger ? (
                renderTrigger({ open, toggle, current })
            ) : (
                <button
                    type="button"
                    onClick={toggle}
                    disabled={isDisabled}
                    title={current
                        ? `${providerLabel(current.provider)} · ${current.displayName ?? current.name}${isDisabled && unavailableReason ? ` — ${unavailableReason}` : ""}`
                        : isDisabled ? unavailableReason ?? placeholder : placeholder}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    className={cx(
                        "flex max-w-full min-w-0 items-center gap-2 rounded-lg text-left transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]",
                        isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-secondary",
                        compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm",
                    )}
                    style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                >
                    {current ? <BrandLogo domain={providerLogoDomain(current.provider)} name={current.provider} size={compact ? 14 : 16} chip={false} /> : null}
                    <span className={cx("min-w-0 max-w-[200px] truncate", current ? "text-primary" : "text-tertiary")}>{current ? current.displayName ?? current.name : placeholder}</span>
                    <ChevronDown className={cx("size-4 shrink-0 text-quaternary transition-transform duration-150 ease-out", open && "rotate-180")} />
                </button>
            )}
            {open && (
                <AnchoredPopover
                    anchorRef={triggerRef}
                    onClose={() => setOpen(false)}
                    align={align}
                    role="listbox"
                    aria-label="Select a model"
                    className="max-h-96 w-80 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl shadow-xl"
                    style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                >
                    <div className="flex flex-col">
                        <div className="flex shrink-0 flex-col gap-2 p-2" style={{ borderBottom: "1px solid var(--c-border)" }}>
                            <div className="flex items-center gap-2 rounded-md px-2" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                                <SearchLg className="size-3.5 shrink-0 text-quaternary" />
                                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-primary outline-none placeholder:text-placeholder" />
                                {q && <button type="button" onClick={() => setQ("")} className="text-quaternary hover:text-primary"><XClose className="size-3" /></button>}
                            </div>
                            <ButtonGroup
                                aria-label="Model location"
                                size="sm"
                                selectedKeys={[scope]}
                                onSelectionChange={(keys) => {
                                    const next = [...keys][0] as typeof scope | undefined;
                                    if (next) setScope(next);
                                }}
                            >
                                <ButtonGroupItem id="all" className="capitalize">all</ButtonGroupItem>
                                <ButtonGroupItem id="local" iconLeading={Server01} className="capitalize">local</ButtonGroupItem>
                                <ButtonGroupItem id="cloud" iconLeading={Cloud01} className="capitalize">cloud</ButtonGroupItem>
                            </ButtonGroup>
                        </div>
                        <div className="max-h-72 overflow-y-auto p-1.5">
                            {groups.length === 0 ? (
                                <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
                                    <p className="text-xs text-quaternary">{models.length === 0 ? "No AI providers connected yet." : "No models match this filter."}</p>
                                    {onAddProvider && (
                                        <button type="button" onClick={() => { onAddProvider(); setOpen(false); }} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110" style={{ background: "var(--brand)" }}>
                                            <Plus className="size-3.5" /> Add AI provider
                                        </button>
                                    )}
                                </div>
                            ) : (
                                groups.map(([prov, list]) => (
                                    <div key={prov} className="mb-1">
                                        <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-1.5 py-1">
                                            <BrandLogo domain={providerLogoDomain(prov)} name={prov} size={13} chip={false} />
                                            <span className="min-w-0 break-words text-[11px] font-semibold uppercase tracking-wider text-quaternary [overflow-wrap:anywhere]" title={providerLabel(prov)}>{providerLabel(prov)}</span>
                                            <span className="text-[11px] text-quaternary">· {list.length}</span>
                                        </div>
                                        {list.map((m) => {
                                            const sel = current?.provider === m.provider && current?.id === m.id;
                                            const size = gb(m.sizeBytes);
                                            const price = priceLabel(m);
                                            const ctx = ctxLabel(m.contextLength);
                                            return (
                                                <button key={m.id} type="button" role="option" aria-selected={sel} aria-disabled={m.stale === true} disabled={m.stale === true} title={`${providerLabel(m.provider)} · ${m.displayName ?? m.name}${m.stale ? " — cached; reconnect the provider before using this model" : ""}`} onClick={() => { if (m.stale) return; onChange(m.provider, m.id); setOpen(false); }} className={cx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]", m.stale ? "cursor-not-allowed opacity-55" : "cursor-pointer", !sel && !m.stale && "hover:bg-secondary")} style={sel ? { background: "color-mix(in srgb, var(--brand) 14%, transparent)" } : undefined}>
                                                    {m.state && <span className="size-1.5 shrink-0 rounded-full" title={m.state} style={{ background: STATE_COLOR[m.state] }} />}
                                                    <span className="flex min-w-0 flex-1 flex-col">
                                                        <span className="flex min-w-0 flex-wrap items-center gap-1.5 break-words text-sm text-primary [overflow-wrap:anywhere]">{m.displayName ?? m.name}{m.stale && <span title="Provider offline — cached list" className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase text-warning-primary" style={{ background: "color-mix(in srgb, #f59e0b 18%, transparent)" }}>cached</span>}</span>
                                                        <span className="flex flex-wrap items-center gap-x-2 text-[10px] text-quaternary">
                                                            {m.paramSize && <span>{m.paramSize}</span>}
                                                            {m.quantization && <span>{m.quantization}</span>}
                                                            {size && <span>{size}</span>}
                                                            {ctx && <span>{ctx}</span>}
                                                            {price && <span>{price}</span>}
                                                        </span>
                                                    </span>
                                                    {sel && <CheckCircle className="size-4 shrink-0 text-brand-secondary" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))
                            )}
                        </div>
                        {onAddProvider && groups.length > 0 && (
                            <button type="button" onClick={() => { onAddProvider(); setOpen(false); }} className="flex w-full items-center justify-center gap-1.5 py-2 text-xs font-medium text-brand-secondary transition hover:underline" style={{ borderTop: "1px solid var(--c-border)" }}>
                                <Plus className="size-3.5" /> Add AI provider
                            </button>
                        )}
                        {onComparePricing && (
                            <button type="button" onClick={() => { onComparePricing(); setOpen(false); }} className="flex w-full items-center justify-center gap-1 py-2 text-xs font-medium text-brand-secondary transition hover:underline" style={{ borderTop: "1px solid var(--c-border)" }}>
                                Compare all pricing →
                            </button>
                        )}
                    </div>
                </AnchoredPopover>
            )}
        </div>
    );
};
