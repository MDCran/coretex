// @ts-nocheck
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Code02,
  Folder,
  LinkExternal01,
  Play,
  RefreshCcw01,
  SearchLg,
  Send01,
  Terminal,
  User01,
  XClose,
  Zap,
} from "@untitledui/icons";
import type { CoretexConfig } from "@repo/coretex/types";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RichSelect } from "@/components/base/select/rich-select";
import { TextArea } from "@/components/base/textarea/textarea";
import { cx } from "@/utils/cx";
import { modelLabel } from "../labels";
import { BrandLogo } from "../ui/brand-logo";
import type { CoretexActions, CoretexState } from "../use-coretex";

type SessionFilter = "live" | "recent";

const REASONING_OPTIONS = [
  {
    value: "none",
    label: "None",
    supportingText: "No additional reasoning when supported",
  },
  {
    value: "low",
    label: "Low",
    supportingText: "Fast edits and simple questions",
  },
  {
    value: "medium",
    label: "Medium",
    supportingText: "Balanced everyday work",
  },
  {
    value: "high",
    label: "High",
    supportingText: "Deeper reasoning for complex tasks",
  },
  {
    value: "xhigh",
    label: "Extra high",
    supportingText: "Maximum depth for difficult work",
  },
  {
    value: "max",
    label: "Max",
    supportingText: "Extended reasoning when the selected model supports it",
  },
  {
    value: "ultra",
    label: "Ultra",
    supportingText: "Highest supported reasoning depth",
  },
];

const PERMISSION_OPTIONS = [
  {
    value: "read-only",
    label: "Read only",
    supportingText: "Safest — inspect and advise without editing files",
  },
  {
    value: "workspace-write",
    label: "Workspace write",
    supportingText: "Allow edits inside the selected workspace",
  },
];

function asTimestamp(value: unknown): number {
  if (typeof value === "number") return value > 1e12 ? value : value * 1000;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function relativeTime(value: unknown): string {
  const timestamp = asTimestamp(value);
  if (!timestamp) return "Unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 45) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function resetTime(value: unknown): string {
  const timestamp = asTimestamp(value);
  if (!timestamp) return "";
  const seconds = Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
  if (seconds < 60) return "in less than a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `on ${new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function shortPath(value?: string): string {
  if (!value) return "No workspace recorded";
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return value;
  return `…${value.includes("\\") ? "\\" : "/"}${parts.slice(-2).join(value.includes("\\") ? "\\" : "/")}`;
}

function isAbsoluteWorkspacePath(value?: string): boolean {
  const path = value?.trim() ?? "";
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path);
}

function sessionTitle(session: Record<string, unknown>): string {
  return String(
    session.title || session.name || session.preview || "Untitled Codex task",
  )
    .replace(/\s+/g, " ")
    .trim();
}

function sessionUpdatedAt(session: Record<string, unknown>): unknown {
  return session.updatedAt ?? session.lastActiveAt ?? session.createdAt;
}

function usageWindowLabel(minutes: unknown, fallback: string): string {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  if (value % 10080 === 0) {
    const weeks = value / 10080;
    return `${weeks === 1 ? "Weekly" : `${weeks}-week`} limit`;
  }
  if (value % 1440 === 0) {
    const days = value / 1440;
    return `${days}-day limit`;
  }
  if (value % 60 === 0) {
    const hours = value / 60;
    return `${hours}-hour limit`;
  }
  return `${value}-minute limit`;
}

function sessionOperationError(error?: string): string {
  if (!error) return "";
  const normalized = error.toLowerCase();
  if (
    normalized.includes("paginated") ||
    normalized.includes("includeTurns".toLowerCase())
  ) {
    return "Full history is unavailable for this older Codex session. Its summary is still shown; update the Codex CLI to improve compatibility.";
  }
  if (normalized.includes("unknown") && normalized.includes("variant")) {
    return "This older Codex session cannot be resumed by the installed Codex CLI. Its summary is still available; update Codex and try again.";
  }
  return error;
}

function usageWindows(
  usage: any,
): Array<{ key: string; label: string; percent: number; resetAt?: unknown }> {
  if (!usage) return [];
  const values = [
    ["primary", usage.primary ?? usage.fiveHour ?? usage.shortTerm],
    ["secondary", usage.secondary ?? usage.weekly ?? usage.longTerm],
  ] as const;
  return values.flatMap(([key, window]) => {
    if (!window) return [];
    const raw =
      window.usedPercent ??
      window.percentUsed ??
      (window.limit > 0
        ? ((window.limit - (window.remaining ?? 0)) / window.limit) * 100
        : 0);
    const percent = Math.max(0, Math.min(100, Number(raw) || 0));
    return [
      {
        key,
        label:
          window.label ||
          usageWindowLabel(
            window.windowDurationMins,
            key === "primary" ? "Primary limit" : "Secondary limit",
          ),
        percent,
        resetAt: window.resetAt ?? window.resetsAt,
      },
    ];
  });
}

function UsageMeter({
  label,
  percent,
  resetAt,
}: {
  label: string;
  percent: number;
  resetAt?: unknown;
}) {
  const remaining = Math.max(0, 100 - percent);
  return (
    <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">
      <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
        <span className="min-w-0 break-words font-medium text-secondary [overflow-wrap:anywhere]">{label}</span>
        <span className="tabular-nums text-tertiary">
          {remaining.toFixed(0)}% left
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--c-border)]">
        <div
          className={cx(
            "h-full rounded-full transition-[width]",
            percent >= 90
              ? "bg-error-solid"
              : percent >= 70
                ? "bg-warning-solid"
                : "bg-brand-solid",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      {resetAt && (
        <p className="text-[11px] text-quaternary">
          Resets {resetTime(resetAt)}
        </p>
      )}
    </div>
  );
}

function safeOpenAuthUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const trusted = ["openai.com", "chatgpt.com"].some(
      (domain) =>
        parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
    );
    if (parsed.protocol !== "https:" || !trusted) return false;
    window.open(parsed.toString(), "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}

export const ProviderSessionHub = ({
  settings,
  state,
  actions,
  onManageOpenAi,
}: {
  settings: CoretexConfig;
  state: CoretexState;
  actions: CoretexActions;
  onManageOpenAi?: () => void;
}) => {
  const runtime = state.providerSessions ?? {};
  const auth = state.providerAuth ?? {};
  const account = auth.account ?? runtime.account ?? null;
  const sessions = Array.isArray(runtime.sessions) ? runtime.sessions : [];
  const loadedSessionIds = new Set(runtime.loadedSessionIds ?? []);
  const openaiConfig = settings.aiProviders.find(
    (provider) => provider.provider === "openai",
  );
  const accountConnected = account?.status === "connected";
  const apiKeyReady = Boolean(
    openaiConfig?.authMode === "api-key" && openaiConfig?.keyConfigured,
  );
  const accountStatusLabel = accountConnected
    ? account?.authMode === "chatgpt"
      ? "ChatGPT connected"
      : account?.authMode === "apiKey"
        ? "Codex API auth connected"
        : "Codex connected"
    : apiKeyReady
      ? "API key configured separately"
      : "Sign in required";
  const [filter, setFilter] = useState<SessionFilter>("recent");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(12);
  const [showingOlder, setShowingOlder] = useState(false);
  const [model, setModel] = useState("");
  const [modelTouched, setModelTouched] = useState(false);
  const [effort, setEffort] = useState("");
  const [effortTouched, setEffortTouched] = useState(false);
  const [cwd, setCwd] = useState("");
  const [permissionMode, setPermissionMode] = useState<
    "read-only" | "workspace-write"
  >("read-only");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [sessionPrompt, setSessionPrompt] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const workspacePathValid =
    permissionMode === "read-only" || isAbsoluteWorkspacePath(cwd);
  const liveModelCatalogReady =
    Array.isArray(runtime.models) && runtime.models.length > 0;
  const canStart =
    state.connected &&
    accountConnected &&
    liveModelCatalogReady &&
    Boolean(model) &&
    workspacePathValid;

  const modelOptions = useMemo(() => {
    const hasLiveCatalog =
      Array.isArray(runtime.models) && runtime.models.length > 0;
    const rawModels = hasLiveCatalog
      ? [...runtime.models].sort(
          (a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)),
        )
      : [];
    const mapped = rawModels
      .map((item) => {
        const id =
          typeof item === "string"
            ? item
            : (item.model ?? item.id ?? item.slug);
        return {
          value: String(id),
          label:
            typeof item === "string"
              ? modelLabel(item)
              : (item.displayName ?? item.name ?? modelLabel(String(id))),
          supportingText:
            typeof item === "string" ? item : (item.description ?? item.id),
        };
      })
      .filter((item) => item.value && item.value !== "undefined");
    return mapped;
  }, [runtime.models]);

  const reasoningOptions = useMemo(() => {
    const current = runtime.models?.find(
      (item) => item.id === model || item.model === model,
    );
    if (!current?.supportedReasoningEfforts?.length) return REASONING_OPTIONS;
    return current.supportedReasoningEfforts.map((item) => ({
      value: item.effort,
      label:
        item.effort === "xhigh"
          ? "Extra high"
          : item.effort.charAt(0).toUpperCase() + item.effort.slice(1),
      supportingText: item.description,
    }));
  }, [model, runtime.models]);

  useEffect(() => {
    if (modelOptions.length === 0) return;
    const liveDefault = runtime.models?.find((item) => item.isDefault);
    const preferred =
      liveDefault?.model ?? liveDefault?.id ?? modelOptions[0].value;
    if (
      !modelTouched ||
      !model ||
      !modelOptions.some((item) => item.value === model)
    )
      setModel(preferred);
  }, [model, modelOptions, modelTouched, runtime.models]);

  useEffect(() => {
    const current = runtime.models?.find(
      (item) => item.id === model || item.model === model,
    );
    if (effortTouched && reasoningOptions.some((item) => item.value === effort))
      return;
    setEffort(
      current?.defaultReasoningEffort || reasoningOptions[0]?.value || "high",
    );
  }, [effort, effortTouched, model, reasoningOptions, runtime.models]);

  useEffect(() => {
    if (!state.connected) return;
    actions.providerSessionsGet?.("codex", { limit: 50 });
    actions.providerAuthGet?.("codex");
  }, [actions, state.connected]);

  useEffect(() => {
    if (!pendingAction) return;
    const timeout = window.setTimeout(() => setPendingAction(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [pendingAction, runtime]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sessions
      .filter((session) => {
        const live =
          (loadedSessionIds.has(session.id) || session.isLoaded) &&
          session.status === "active";
        if (filter === "live" && !live) return false;
        if (!normalized) return true;
        return [
          sessionTitle(session),
          session.model,
          session.cwd,
          session.id,
        ].some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(normalized),
        );
      })
      .sort(
        (a, b) =>
          asTimestamp(sessionUpdatedAt(b)) - asTimestamp(sessionUpdatedAt(a)),
      );
  }, [filter, loadedSessionIds, query, sessions]);

  useEffect(() => setVisibleCount(12), [filter, query, showingOlder]);

  const liveCount = sessions.filter(
    (session) =>
      (loadedSessionIds.has(session.id) || session.isLoaded) &&
      session.status === "active",
  ).length;
  const limits = usageWindows(runtime.usage ?? auth.usage);
  const selectedDetail = selectedSessionId
    ? (state.providerSessionDetails?.[selectedSessionId] ?? null)
    : null;
  const selectedResultError =
    selectedDetail?.historyWarning ??
    (state.providerSessionResult?.session &&
    (state.providerSessionResult.session.id === selectedSessionId ||
      state.providerSessionResult.session.sessionId === selectedSessionId)
      ? state.providerSessionResult.error
      : undefined);
  const selectedSummary = sessions.find(
    (session) =>
      session.id === selectedSessionId ||
      session.sessionId === selectedSessionId,
  );
  const selectedLoaded = Boolean(
    selectedSummary?.isLoaded ||
    (selectedSummary && loadedSessionIds.has(selectedSummary.id)),
  );
  const selectedLive = selectedSessionId
    ? (state.providerSessionLive?.[selectedSessionId] ??
      (selectedSummary?.sessionId
        ? state.providerSessionLive?.[selectedSummary.sessionId]
        : null))
    : null;
  const selectedWorkspace = cwd.trim() || selectedSummary?.cwd || "";
  const selectedWorkspaceValid =
    permissionMode === "read-only" ||
    isAbsoluteWorkspacePath(selectedWorkspace);

  useEffect(() => {
    const result = state.providerSessionResult;
    if (
      !result?.session ||
      (result.operation !== "start" && result.operation !== "resume")
    )
      return;
    setSelectedSessionId(result.session.id);
    if (result.operation === "start" && !result.error) setInitialPrompt("");
  }, [state.providerSessionResult]);

  const start = () => {
    setPendingAction("start");
    actions.providerSessionStart?.("codex", {
      ...(model ? { model } : {}),
      effort,
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
      permissionMode,
      ...(initialPrompt.trim() ? { initialPrompt: initialPrompt.trim() } : {}),
    });
  };

  const connect = () => {
    setPendingAction("auth");
    actions.providerAuthStart?.("codex", "browser");
  };

  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--c-border)",
      }}
    >
      <div className="flex min-w-0 flex-col gap-4 border-b border-secondary px-5 py-5 sm:px-6 @3xl/settings-page:flex-row @3xl/settings-page:items-start @3xl/settings-page:justify-between">
        <div className="flex min-w-0 flex-1 basis-[22rem] items-start gap-3.5">
          <span
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)]"
            style={{ border: "1px solid var(--c-border)" }}
          >
            <BrandLogo domain="openai.com" name="Codex" size={26} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="break-words text-md font-semibold text-primary [overflow-wrap:anywhere]">
                Codex sessions
              </h2>
              <BadgeWithDot
                type="pill-color"
                size="sm"
                color={
                  accountConnected ? "success" : apiKeyReady ? "brand" : "gray"
                }
              >
                {accountStatusLabel}
              </BadgeWithDot>
              {liveCount > 0 && (
                <Badge size="sm" color="success" type="pill-color">
                  {liveCount} live
                </Badge>
              )}
            </div>
            <p className="mt-1 max-w-2xl break-words text-sm text-tertiary [overflow-wrap:anywhere]">
              Start, resume, and inspect local Codex tasks from Coretex. ChatGPT
              authentication and OpenAI API keys remain separate choices.
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2 @3xl/settings-page:shrink-0">
          <Button
            size="sm"
            color="secondary"
            iconLeading={RefreshCcw01}
            onClick={() => {
              setShowingOlder(false);
              actions.providerSessionsGet?.("codex", { limit: 50 });
              actions.providerAuthGet?.("codex");
            }}
          >
            Refresh
          </Button>
          {!accountConnected && !auth.login && (
            <Button
              size="sm"
              color="primary"
              iconLeading={User01}
              isDisabled={!state.connected || pendingAction === "auth"}
              onClick={connect}
            >
              {pendingAction === "auth"
                ? "Preparing sign-in…"
                : "Connect with ChatGPT"}
            </Button>
          )}
          {!accountConnected && auth.login && (
            <Button
              size="sm"
              color="primary"
              iconLeading={LinkExternal01}
              onClick={() => {
                const url = auth.login?.authUrl ?? auth.login?.verificationUrl;
                if (url) safeOpenAuthUrl(url);
              }}
            >
              Continue sign-in
            </Button>
          )}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-px bg-[var(--c-border)] @6xl/settings-page:grid-cols-[minmax(0,1fr)_minmax(21rem,0.72fr)]">
        <div className="min-w-0 bg-[var(--surface)] p-5 sm:p-6">
          <div className="grid min-w-0 grid-cols-1 gap-3 @3xl/settings-page:grid-cols-3">
            <div
              className="rounded-xl bg-[var(--surface-2)] p-4"
              style={{ border: "1px solid var(--c-border)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-tertiary">
                  Account
                </span>
                <User01 className="size-4 text-quaternary" />
              </div>
              <p className="mt-2 text-sm font-semibold text-primary">
                {accountConnected
                  ? account?.authMode === "chatgpt"
                    ? "ChatGPT connected"
                    : "Codex connected"
                  : apiKeyReady
                    ? "OpenAI API key in Coretex vault"
                    : "Not connected"}
              </p>
              <p className="mt-0.5 truncate text-xs text-tertiary">
                {account?.plan ||
                  (account?.authMode === "chatgpt"
                    ? "ChatGPT authentication"
                    : account?.authMode === "apiKey"
                      ? "App-server API authentication"
                      : apiKeyReady
                        ? "Not applied to the Codex app server"
                        : "Choose an authentication method")}
              </p>
            </div>
            <div
              className="rounded-xl bg-[var(--surface-2)] p-4"
              style={{ border: "1px solid var(--c-border)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-tertiary">
                  Sessions
                </span>
                <Activity className="size-4 text-quaternary" />
              </div>
              <p className="mt-2 text-sm font-semibold text-primary">
                {liveCount} active here · {sessions.length} recent
              </p>
              <p className="mt-0.5 text-xs text-tertiary">
                Coretex cannot see whether a recent thread is active in another
                Codex window
              </p>
            </div>
            <div
              className="rounded-xl bg-[var(--surface-2)] p-4"
              style={{ border: "1px solid var(--c-border)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-tertiary">
                  Model access
                </span>
                <Code02 className="size-4 text-quaternary" />
              </div>
              <p className="mt-2 text-sm font-semibold text-primary">
                {runtime.models?.length ?? modelOptions.length} available
              </p>
              <p className="mt-0.5 truncate text-xs text-tertiary">
                {model ? modelLabel(model) : "Loaded after sign-in"}
              </p>
            </div>
          </div>

          {limits.length > 0 && (
            <div
              className="mt-4 flex min-w-0 flex-wrap gap-3 rounded-xl bg-[var(--surface-2)] p-4 @3xl/settings-page:gap-6"
              style={{ border: "1px solid var(--c-border)" }}
            >
              {limits.map(({ key, ...limit }) => (
                <UsageMeter key={key} {...limit} />
              ))}
            </div>
          )}

          <div className="mt-5 flex flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-3 @3xl/settings-page:flex-row @3xl/settings-page:items-center @3xl/settings-page:justify-between">
              <div
                className="flex rounded-lg bg-[var(--surface-2)] p-1"
                role="tablist"
                aria-label="Codex session filter"
              >
                {(["live", "recent"] as SessionFilter[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={filter === item}
                    onClick={() => {
                      setFilter(item);
                      if (item === "live" && showingOlder) {
                        setShowingOlder(false);
                        actions.providerSessionsGet?.("codex", { limit: 50 });
                      }
                    }}
                    className={cx(
                      "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                      filter === item
                        ? "bg-primary text-primary shadow-xs"
                        : "text-tertiary hover:text-secondary",
                    )}
                  >
                    {item === "live"
                      ? "Active in Coretex"
                      : "Recent on this device"}
                  </button>
                ))}
              </div>
              <div className="w-full @3xl/settings-page:w-64 @3xl/settings-page:shrink-0">
                <Input
                  aria-label="Search Codex sessions"
                  value={query}
                  placeholder="Search sessions"
                  icon={SearchLg}
                  onChange={setQuery}
                />
              </div>
            </div>

            {runtime.error && (
              <div className="rounded-xl border border-warning-subtle bg-warning-primary/5 p-4 text-sm text-warning-primary">
                {runtime.error}
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-secondary px-6 py-8 text-center">
                <Terminal className="size-6 text-quaternary" />
                <p className="mt-2 text-sm font-semibold text-primary">
                  {sessions.length === 0
                    ? "No Codex sessions yet"
                    : "No matching sessions"}
                </p>
                <p className="mt-1 max-w-sm text-xs text-tertiary">
                  {sessions.length === 0
                    ? "Start a task here or refresh to import your recent Codex work."
                    : "Try a different status or search term."}
                </p>
              </div>
            ) : (
              <>
                <div
                  className="overflow-hidden rounded-xl"
                  style={{ border: "1px solid var(--c-border)" }}
                >
                  {filtered.slice(0, visibleCount).map((session, index) => {
                    const loaded =
                      loadedSessionIds.has(session.id) || session.isLoaded;
                    const live = loaded && session.status === "active";
                    const opened = selectedSessionId === session.id;
                    const waitingForApproval =
                      session.activeFlags?.includes("waitingOnApproval");
                    const waitingForInput =
                      session.activeFlags?.includes("waitingOnUserInput");
                    const resumeWorkspace = cwd.trim() || session.cwd || "";
                    const resumeWorkspaceValid =
                      permissionMode === "read-only" ||
                      isAbsoluteWorkspacePath(resumeWorkspace);
                    return (
                      <div
                        key={session.id}
                        className={cx(
                          "flex min-w-0 flex-col gap-3 bg-[var(--surface-2)] px-3.5 py-3 @4xl/settings-page:flex-row @4xl/settings-page:items-center",
                          index > 0 && "border-t border-secondary",
                        )}
                      >
                        <span
                          className="relative grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--surface)]"
                          style={{ border: "1px solid var(--c-border)" }}
                        >
                          <BrandLogo
                            domain="openai.com"
                            name="Codex"
                            size={22}
                          />
                          {live && (
                            <span className="absolute -right-0.5 -bottom-0.5 size-2.5 animate-pulse rounded-full bg-success-solid ring-2 ring-[var(--surface-2)]" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="max-w-full truncate text-sm font-semibold text-primary">
                              {sessionTitle(session)}
                            </p>
                            <BadgeWithDot
                              type="pill-color"
                              size="sm"
                              color={
                                live ? "success" : loaded ? "brand" : "gray"
                              }
                            >
                              {live
                                ? "Active in Coretex"
                                : loaded
                                  ? "Open in Coretex"
                                  : "Recent on this device"}
                            </BadgeWithDot>
                            {waitingForApproval && (
                              <Badge
                                size="sm"
                                color="warning"
                                type="pill-color"
                              >
                                Approval needed
                              </Badge>
                            )}
                            {waitingForInput && (
                              <Badge size="sm" color="brand" type="pill-color">
                                Waiting for input
                              </Badge>
                            )}
                            {opened && (
                              <Badge size="sm" color="brand" type="pill-color">
                                Selected
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-tertiary">
                            <span>
                              {session.model
                                ? modelLabel(String(session.model))
                                : "Default model"}
                            </span>
                            <span>·</span>
                            <span title={session.cwd}>
                              {shortPath(session.cwd)}
                            </span>
                            <span>·</span>
                            <span>
                              {relativeTime(sessionUpdatedAt(session))}
                            </span>
                          </div>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5 self-end @4xl/settings-page:shrink-0 @4xl/settings-page:self-auto">
                          <Button
                            size="sm"
                            color="secondary"
                            iconLeading={LinkExternal01}
                            onClick={() => {
                              setPendingAction(`open:${session.id}`);
                              setSelectedSessionId(session.id);
                              actions.providerSessionOpen?.(
                                "codex",
                                session.id,
                                {
                                  includeTurns: true,
                                },
                              );
                            }}
                          >
                            View history
                          </Button>
                          <Button
                            size="sm"
                            color={live ? "secondary" : "primary"}
                            iconLeading={Play}
                            isDisabled={!resumeWorkspaceValid}
                            onClick={() => {
                              setPendingAction(`resume:${session.id}`);
                              setSelectedSessionId(session.id);
                              actions.providerSessionResume?.(
                                "codex",
                                session.id,
                                {
                                  ...(model ? { model } : {}),
                                  effort,
                                  ...(resumeWorkspace
                                    ? { cwd: resumeWorkspace }
                                    : {}),
                                  permissionMode,
                                },
                              );
                            }}
                          >
                            {live ? "Focus here" : "Resume in Coretex"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-quaternary">
                    Showing {Math.min(visibleCount, filtered.length)} of{" "}
                    {filtered.length} sessions on this page
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {visibleCount < filtered.length && (
                      <Button
                        size="sm"
                        color="secondary"
                        onClick={() => setVisibleCount((count) => count + 12)}
                      >
                        Show more
                      </Button>
                    )}
                    {filter === "recent" && showingOlder && (
                      <Button
                        size="sm"
                        color="secondary"
                        onClick={() => {
                          setShowingOlder(false);
                          actions.providerSessionsGet?.("codex", { limit: 50 });
                        }}
                      >
                        Back to newest
                      </Button>
                    )}
                    {filter === "recent" &&
                      runtime.nextCursor &&
                      visibleCount >= filtered.length && (
                        <Button
                          size="sm"
                          color="secondary"
                          onClick={() => {
                            setShowingOlder(true);
                            actions.providerSessionsGet?.("codex", {
                              cursor: runtime.nextCursor,
                              limit: 50,
                            });
                          }}
                        >
                          Load older sessions
                        </Button>
                      )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <aside className="min-w-0 bg-[var(--surface)] p-5 sm:p-6">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-secondary text-brand-secondary">
              <Zap className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="break-words text-sm font-semibold text-primary [overflow-wrap:anywhere]">
                Create a Codex session
              </h3>
              <p className="break-words text-xs text-tertiary [overflow-wrap:anywhere]">
                Choose the model and safety boundary first.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-secondary">Model</span>
              {modelOptions.length > 0 ? (
                <RichSelect
                  aria-label="Codex model"
                  rich
                  options={modelOptions}
                  value={model}
                  onChange={(event) => {
                    setModelTouched(true);
                    setModel(event.target.value);
                  }}
                />
              ) : (
                <Input
                  aria-label="Codex model"
                  value={model}
                  placeholder="Waiting for live Codex catalog…"
                  isDisabled
                  onChange={(value) => {
                    setModelTouched(true);
                    setModel(value);
                  }}
                />
              )}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-secondary">
                Reasoning
              </span>
              <RichSelect
                aria-label="Codex reasoning effort"
                rich
                options={reasoningOptions}
                value={effort}
                onChange={(event) => {
                  setEffortTouched(true);
                  setEffort(event.target.value);
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between gap-2 text-xs font-medium text-secondary">
                Permission mode
                {permissionMode === "read-only" && (
                  <Badge size="sm" color="success" type="pill-color">
                    Safest
                  </Badge>
                )}
              </span>
              <RichSelect
                aria-label="Codex permission mode"
                rich
                options={PERMISSION_OPTIONS}
                value={permissionMode}
                onChange={(event) => setPermissionMode(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-secondary">
                Workspace folder{" "}
                <span className="font-normal text-quaternary">
                  (
                  {permissionMode === "workspace-write"
                    ? "required"
                    : "optional"}
                  )
                </span>
              </span>
              <Input
                aria-label="Codex workspace folder"
                value={cwd}
                placeholder="L:\\projects\\my-app"
                icon={Folder}
                onChange={setCwd}
              />
              {permissionMode === "workspace-write" && !workspacePathValid && (
                <span className="text-xs text-error-primary">
                  Enter an absolute workspace path before creating or resuming a
                  write-enabled session.
                </span>
              )}
            </label>
            <TextArea
              aria-label="Initial Codex prompt"
              label="Initial prompt"
              value={initialPrompt}
              rows={4}
              placeholder="Describe what you want Codex to work on…"
              hint="Optional. Leave blank to create the session before sending work."
              onChange={setInitialPrompt}
            />
            <Button
              size="md"
              color="primary"
              iconLeading={Play}
              isDisabled={!canStart || pendingAction === "start"}
              onClick={start}
            >
              {pendingAction === "start" ? "Creating…" : "Create session"}
            </Button>
            {!canStart && (
              <p className="text-xs text-tertiary">
                {!state.connected
                  ? "Connect to the Coretex Brain to create a session."
                  : !accountConnected
                    ? "Connect ChatGPT first. A stored OpenAI API key does not sign the Codex app server in."
                    : !liveModelCatalogReady
                      ? "Refresh to load the live Codex model catalog before creating a session."
                      : "Enter an absolute workspace folder before creating a workspace-write session."}
              </p>
            )}
          </div>

          {selectedSessionId && (
            <div className="mt-6 border-t border-secondary pt-5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-primary">
                    Remote prompt
                  </p>
                  <p className="mt-0.5 text-xs text-tertiary">
                    Continue the selected session through Coretex.
                  </p>
                </div>
                <Button
                  size="sm"
                  color="link-gray"
                  iconLeading={XClose}
                  onClick={() => setSelectedSessionId(null)}
                >
                  Close
                </Button>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {selectedDetail?.turns?.length > 0 && (
                  <div
                    className="max-h-56 space-y-2 overflow-y-auto rounded-xl bg-[var(--surface-2)] p-3"
                    style={{ border: "1px solid var(--c-border)" }}
                  >
                    {selectedDetail.turns
                      .flatMap((turn) =>
                        turn.items
                          .filter((item) => item.text?.trim())
                          .map((item) => ({ turn, item })),
                      )
                      .slice(-12)
                      .map(({ turn, item }) => {
                        const user =
                          item.type === "user" || item.type === "userMessage";
                        return (
                          <div
                            key={`${turn.id}:${item.id}`}
                            className={cx(
                              "rounded-lg px-3 py-2",
                              user
                                ? "ml-6 bg-brand-secondary"
                                : "mr-6 bg-[var(--surface)]",
                            )}
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold tracking-wide text-quaternary uppercase">
                                {user ? "You" : "Codex"}
                              </span>
                              {item.status && (
                                <span className="text-[10px] text-quaternary">
                                  {item.status}
                                </span>
                              )}
                            </div>
                            <p className="line-clamp-6 whitespace-pre-wrap text-xs leading-5 text-secondary">
                              {item.text}
                            </p>
                          </div>
                        );
                      })}
                  </div>
                )}
                {selectedLive?.text && (
                  <div
                    className="rounded-xl bg-[var(--surface-2)] p-3"
                    style={{ border: "1px solid var(--c-border)" }}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-quaternary uppercase">
                        <span className="size-1.5 animate-pulse rounded-full bg-success-solid" />
                        Live from Codex
                      </span>
                      {selectedLive.status && (
                        <span className="text-[10px] text-quaternary">
                          {selectedLive.status}
                        </span>
                      )}
                    </div>
                    <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-secondary">
                      {selectedLive.text}
                    </p>
                  </div>
                )}
                {selectedLive?.error && (
                  <p className="rounded-lg bg-error-primary/5 px-3 py-2 text-xs text-error-primary">
                    {selectedLive.error}
                  </p>
                )}
                {selectedResultError && (
                  <p className="rounded-lg bg-warning-primary/5 px-3 py-2 text-xs text-warning-primary">
                    {sessionOperationError(selectedResultError)}
                  </p>
                )}
                <TextArea
                  aria-label="Prompt selected Codex session"
                  value={sessionPrompt}
                  rows={4}
                  placeholder="Ask Codex to inspect, explain, or change something…"
                  onChange={setSessionPrompt}
                />
                <Button
                  size="md"
                  color="primary"
                  iconLeading={Send01}
                  isDisabled={
                    !sessionPrompt.trim() ||
                    !actions.providerSessionPrompt ||
                    !selectedLoaded ||
                    !selectedWorkspaceValid
                  }
                  onClick={() => {
                    const prompt = sessionPrompt.trim();
                    if (!prompt) return;
                    actions.providerSessionPrompt?.(
                      "codex",
                      selectedSessionId,
                      {
                        prompt,
                        ...(model ? { model } : {}),
                        effort,
                        ...(selectedWorkspace
                          ? { cwd: selectedWorkspace }
                          : {}),
                        permissionMode,
                      },
                    );
                    setSessionPrompt("");
                  }}
                >
                  Send to session
                </Button>
                <p className="text-[11px] text-quaternary">
                  {selectedLoaded
                    ? selectedWorkspaceValid
                      ? "Runs through Coretex's managed Codex session using the selected model, reasoning, and permission boundary."
                      : "Enter an absolute workspace folder before sending with workspace-write enabled."
                    : "Resume this recent session in Coretex before sending a prompt."}
                </p>
              </div>
            </div>
          )}

          <div className="mt-6 border-t border-secondary pt-5">
            <div className="flex items-start gap-2.5">
              <Code02 className="mt-0.5 size-4 shrink-0 text-quaternary" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-primary">
                  Authentication choices
                </p>
                <p className="mt-1 text-xs text-tertiary">
                  ChatGPT signs the Codex app server in. A Coretex-vault API key
                  remains available to API-based chat and agents, but does not
                  sign this session runtime in.
                </p>
                {auth.error && (
                  <p className="mt-2 text-xs text-error-primary">
                    {auth.error}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!accountConnected && auth.login ? (
                    <Button
                      size="sm"
                      color="secondary"
                      iconLeading={XClose}
                      onClick={() =>
                        actions.providerAuthCancel?.(
                          "codex",
                          auth.login.loginId,
                        )
                      }
                    >
                      Cancel sign-in
                    </Button>
                  ) : null}
                  {auth.login?.userCode && (
                    <span
                      className="rounded-md bg-[var(--surface-2)] px-2.5 py-1.5 font-mono text-xs font-semibold text-primary"
                      title="Device sign-in code"
                    >
                      {auth.login.userCode}
                    </span>
                  )}
                  {onManageOpenAi && (
                    <Button
                      size="sm"
                      color="link-color"
                      onClick={onManageOpenAi}
                    >
                      Manage API key
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
};
