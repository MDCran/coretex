// @ts-nocheck
"use client";

// Coretex Relay — the chat composer "+" menu. Attach/enable connected integrations,
// an environment's variable NAMES (never values), and context files/docs for THIS
// conversation. Selections persist to config.conversationScope[chatId] and are
// inherited by any agent the conversation spawns. Secrets stay in the vault.

import { useEffect, useState } from "react";
import type { ConversationScope } from "@repo/coretex/types";
import type { CoretexState, CoretexActions } from "../use-coretex";
import {
  Plus,
  XClose,
  SearchLg,
  Link01,
  Database01,
  FileCode02,
  Folder,
  CheckCircle,
  LinkExternal01,
  Server01,
} from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { BrandLogo } from "../ui/brand-logo";
import { CATEGORY_LABELS, CATEGORY_COLORS } from "../keyvault/catalog";

const SURFACE = {
  background: "var(--surface)",
  border: "1px solid var(--c-border)",
} as const;
const EMPTY_SCOPE: ConversationScope = { integrationIds: [], context: [] };

type Tab = "integrations" | "env" | "context";

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/** Read a conversation's attached scope from settings (empty when none). */
export function scopeFor(
  state: CoretexState,
  chatId: string,
): ConversationScope {
  return state.settings?.composer?.conversationScope?.[chatId] ?? EMPTY_SCOPE;
}

/** Removable chips shown above the input for the conversation's attached scope. */
export const AttachmentChips = ({
  chatId,
  state,
  actions,
}: {
  chatId: string;
  state: CoretexState;
  actions: CoretexActions;
}) => {
  const scope = scopeFor(state, chatId);
  const integrations = state.keyvault?.integrations ?? [];
  const set = (next: ConversationScope) =>
    actions.composerSetScope(chatId, next);

  const chips: {
    key: string;
    label: string;
    domain?: string;
    icon?: typeof Link01;
    disconnected?: boolean;
    onRemove: () => void;
  }[] = [];
  for (const id of scope.integrationIds) {
    const conn = integrations.find((i) => i.id === id);
    if (!conn) continue;
    chips.push({
      key: `i:${id}`,
      label: conn.serviceName,
      domain: conn.serviceDomain,
      disconnected: conn.status !== "connected",
      onRemove: () =>
        set({
          ...scope,
          integrationIds: scope.integrationIds.filter((x) => x !== id),
        }),
    });
  }
  if (scope.envScope) {
    chips.push({
      key: "env",
      label: `env: ${scope.envScope.environment}`,
      icon: Server01,
      onRemove: () => set({ ...scope, envScope: undefined }),
    });
  }
  if (scope.context.length > 0) {
    chips.push({
      key: "ctx",
      label:
        scope.context.length === 1
          ? scope.context[0].label
          : `${scope.context.length} files`,
      icon: FileCode02,
      onRemove: () => set({ ...scope, context: [] }),
    });
  }
  if (chips.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.key}
          title={
            c.disconnected
              ? `${c.label} — disconnected; reconnect in Settings`
              : undefined
          }
          className={cx(
            "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-secondary",
            c.disconnected && "opacity-50 line-through",
          )}
          style={SURFACE}
        >
          {c.domain ? (
            <BrandLogo
              domain={c.domain}
              name={c.label}
              size={14}
              chip={false}
            />
          ) : c.icon ? (
            <c.icon className="size-3.5 text-tertiary" />
          ) : null}
          <span className="max-w-[160px] truncate">{c.label}</span>
          <button
            type="button"
            onClick={c.onRemove}
            title="Remove"
            className="text-quaternary transition hover:text-error-primary"
          >
            <XClose className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
};

/** The "+" attach button + tabbed popover (Integrations / Env vars / Context). */
export const ComposerAttach = ({
  chatId,
  state,
  actions,
  disabled,
  allowedIntegrationIds,
}: {
  chatId: string;
  state: CoretexState;
  actions: CoretexActions;
  disabled?: boolean;
  /** When set, project policy limits the integrations visible in this composer. */
  allowedIntegrationIds?: string[];
}) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("integrations");
  // Optimistic local scope so rapid toggles don't each compute their delta off a lagging
  // server-broadcast value (last-write-wins data loss). Reconcile when the server value changes.
  const server = scopeFor(state, chatId);
  const serverKey = JSON.stringify(server);
  const [scope, setScope] = useState<ConversationScope>(server);
  useEffect(() => {
    setScope(server);
  }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next: ConversationScope) => {
    setScope(next);
    actions.composerSetScope(chatId, next);
  };
  const count =
    scope.integrationIds.length +
    (scope.envScope ? 1 : 0) +
    (scope.context.length > 0 ? 1 : 0);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="Attach integrations, env vars, or context"
        className="relative flex size-10 items-center justify-center rounded-lg text-tertiary transition hover:bg-secondary hover:text-primary disabled:opacity-50"
        style={SURFACE}
      >
        <Plus className="size-5" />
        {count > 0 && (
          <span
            className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-md px-1 text-[10px] font-bold text-white"
            style={{ background: "var(--brand)" }}
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute bottom-full left-0 z-40 mb-2 w-80 overflow-hidden rounded-xl shadow-xl"
            style={SURFACE}
          >
            {/* Tabs */}
            <div
              className="flex shrink-0 items-center gap-1 p-1.5"
              style={{ borderBottom: "1px solid var(--c-border)" }}
            >
              {(
                [
                  ["integrations", "Integrations", Link01],
                  ["env", "Env vars", Server01],
                  ["context", "Context", Folder],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cxTab(tab === id)}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5">
              {tab === "integrations" && (
                <IntegrationsTab state={state} scope={scope} set={set} allowedIntegrationIds={allowedIntegrationIds} />
              )}
              {tab === "env" && (
                <EnvTab state={state} scope={scope} set={set} />
              )}
              {tab === "context" && <ContextTab scope={scope} set={set} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

function cxTab(active: boolean): string {
  return `flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${active ? "text-primary" : "text-tertiary hover:text-secondary"}`;
}

const IntegrationsTab = ({
  state,
  scope,
  set,
  allowedIntegrationIds,
}: {
  state: CoretexState;
  scope: ConversationScope;
  set: (s: ConversationScope) => void;
  allowedIntegrationIds?: string[];
}) => {
  const [q, setQ] = useState("");
  const allowed = allowedIntegrationIds ? new Set(allowedIntegrationIds) : null;
  const integrations = (state.keyvault?.integrations ?? []).filter(
    (integration) => !allowed || allowed.has(integration.id),
  );
  const filtered = integrations.filter((i) =>
    i.serviceName.toLowerCase().includes(q.trim().toLowerCase()),
  );
  if (integrations.length === 0)
    return (
      <Empty text={allowed ? "No connectors are allowed for this project. Add them in Project secrets → Connectors." : "No integrations yet. Connect services in Settings → Remote & connectors."} />
    );
  return (
    <div className="flex flex-col gap-1">
      <SearchBox value={q} onChange={setQ} placeholder="Search integrations" />
      {filtered.map((i) => {
        const on = scope.integrationIds.includes(i.id);
        const connected = i.status === "connected";
        const toggle = () =>
          set({
            ...scope,
            integrationIds: on
              ? scope.integrationIds.filter((x) => x !== i.id)
              : [...scope.integrationIds, i.id],
          });
        return (
          <button
            key={i.id}
            type="button"
            disabled={!connected}
            onClick={toggle}
            className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${on ? "" : "hover:bg-secondary"} disabled:cursor-default disabled:opacity-60`}
            style={
              on
                ? {
                    background:
                      "color-mix(in srgb, var(--brand) 14%, transparent)",
                  }
                : undefined
            }
          >
            <BrandLogo
              domain={i.serviceDomain}
              name={i.serviceName}
              size={20}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-primary">
                {i.serviceName}
              </span>
              <span
                className="text-[11px]"
                style={{ color: CATEGORY_COLORS[i.category] }}
              >
                {CATEGORY_LABELS[i.category]} · context only
              </span>
            </span>
            {connected ? (
              on ? (
                <CheckCircle className="size-4 shrink-0 text-brand-secondary" />
              ) : (
                <span className="text-[11px] text-quaternary">Enable</span>
              )
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-tertiary">
                <LinkExternal01 className="size-3" /> Connect
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

const EnvTab = ({
  state,
  scope,
  set,
}: {
  state: CoretexState;
  scope: ConversationScope;
  set: (s: ConversationScope) => void;
}) => {
  const environments = state.env?.environments ?? [];
  if (environments.length === 0)
    return (
      <Empty text="No environments yet. Add variables in the Env vars view." />
    );
  return (
    <div className="flex flex-col gap-1">
      <p className="px-1 pb-1 text-[11px] text-quaternary">
        Attach an environment's variable names (values stay in the vault).
      </p>
      {environments.map((e) => {
        const on = scope.envScope?.environmentId === e.id;
        const toggle = () =>
          set({
            ...scope,
            envScope: on
              ? undefined
              : {
                  projectId: e.projectId,
                  environmentId: e.id,
                  environment: e.name,
                  varNames: e.variables.map((v) => v.name),
                },
          });
        return (
          <button
            key={e.id}
            type="button"
            onClick={toggle}
            className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${on ? "" : "hover:bg-secondary"}`}
            style={
              on
                ? {
                    background:
                      "color-mix(in srgb, var(--brand) 14%, transparent)",
                  }
                : undefined
            }
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: e.color || "var(--brand)" }}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-primary">{e.name}</span>
              <span className="text-[11px] text-quaternary">
                {e.variables.length} variables · {e.kind}
              </span>
            </span>
            {on && (
              <CheckCircle className="size-4 shrink-0 text-brand-secondary" />
            )}
          </button>
        );
      })}
    </div>
  );
};

const ContextTab = ({
  scope,
  set,
}: {
  scope: ConversationScope;
  set: (s: ConversationScope) => void;
}) => {
  const [path, setPath] = useState("");
  const add = () => {
    const p = path.trim();
    if (!p || scope.context.some((c) => c.path === p)) {
      setPath("");
      return;
    }
    const kind: ConversationScope["context"][number]["kind"] =
      /\.[a-z0-9]+$/i.test(p) ? "file" : "folder";
    set({
      ...scope,
      context: [...scope.context, { kind, path: p, label: baseName(p) }],
    });
    setPath("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a file or folder path…"
          className="min-w-0 flex-1 rounded-md px-2 py-1.5 font-mono text-xs text-primary outline-none focus:ring-2 focus:ring-brand"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--c-border)",
          }}
        />
        <button
          type="button"
          onClick={add}
          disabled={!path.trim()}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-tertiary transition hover:bg-secondary hover:text-primary disabled:opacity-40"
          style={SURFACE}
        >
          <Plus className="size-4" />
        </button>
      </div>
      {scope.context.length === 0 ? (
        <Empty text="Attach files, folders, or docs to give the assistant more context." />
      ) : (
        scope.context.map((c) => (
          <div
            key={c.path}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary"
          >
            {c.kind === "folder" ? (
              <Folder className="size-3.5 shrink-0 text-tertiary" />
            ) : c.kind === "doc" ? (
              <Database01 className="size-3.5 shrink-0 text-tertiary" />
            ) : (
              <FileCode02 className="size-3.5 shrink-0 text-tertiary" />
            )}
            <span
              className="min-w-0 flex-1 truncate text-xs text-primary"
              title={c.path}
            >
              {c.label}
            </span>
            <button
              type="button"
              onClick={() =>
                set({
                  ...scope,
                  context: scope.context.filter((x) => x.path !== c.path),
                })
              }
              className="text-quaternary transition hover:text-error-primary"
            >
              <XClose className="size-3" />
            </button>
          </div>
        ))
      )}
    </div>
  );
};

const SearchBox = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) => (
  <div
    className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5"
    style={{
      background: "var(--surface-2)",
      border: "1px solid var(--c-border)",
    }}
  >
    <SearchLg className="size-3.5 text-quaternary" />
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="min-w-0 flex-1 bg-transparent text-xs text-primary outline-none placeholder:text-placeholder"
    />
  </div>
);

const Empty = ({ text }: { text: string }) => (
  <p className="px-2 py-6 text-center text-xs text-quaternary">{text}</p>
);
