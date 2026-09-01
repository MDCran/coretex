// @ts-nocheck
"use client";

// Coretex Relay — Running servers, ranked by relevance. Your projects, dev
// servers, Docker stacks, and Coretex services float to the top; Windows/system/
// background listeners are grouped and collapsed. Adds uptime, filter chips,
// search, sort, and an embedded-browser "Open". Data (tier/uptime/docker names)
// comes ranked from the Brain's ServerScanner.

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Code02,
  Copy01,
  Cube01,
  Database01,
  Globe01,
  LinkExternal01,
  RefreshCcw01,
  Server01,
  Signal01,
  Trash01,
} from "@untitledui/icons";
import type {
  RunningServer,
  ServerTier,
  ServerType,
} from "@repo/coretex/types";






import type { CoretexActions, CoretexState } from "../use-coretex";
import { useContextMenu, type MenuItem } from "../ui/context-menu";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { cx } from "@/utils/cx";
import { EmptyState } from "./social/ui";

const cardStyle = {
  background: "var(--surface)",
  border: "1px solid var(--c-border)",
} as const;

const TYPE_META: Record<
  ServerType,
  {
    label: string;
    color: "blue" | "indigo" | "orange" | "success" | "gray";
    icon: typeof Globe01;
  }
> = {
  web: { label: "Web", color: "blue", icon: Globe01 },
  api: { label: "API", color: "indigo", icon: Server01 },
  database: { label: "Database", color: "orange", icon: Database01 },
  dev: { label: "Dev", color: "success", icon: Code02 },
  unknown: { label: "Unknown", color: "gray", icon: Signal01 },
};

const TIER_ORDER: ServerTier[] = [
  "project",
  "dev",
  "docker",
  "coretex",
  "system",
];
const TIER_META: Record<ServerTier, { label: string; icon: typeof Globe01 }> = {
  project: { label: "Your projects", icon: Cube01 },
  dev: { label: "Dev servers", icon: Code02 },
  docker: { label: "Docker", icon: Cube01 },
  coretex: { label: "Coretex", icon: Signal01 },
  system: { label: "System & background", icon: Server01 },
};

type Filter =
  | "all"
  | "web"
  | "api"
  | "database"
  | "dev"
  | "docker"
  | "system"
  | "responding";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "web", label: "Web" },
  { id: "api", label: "API" },
  { id: "database", label: "Database" },
  { id: "dev", label: "Dev" },
  { id: "docker", label: "Docker" },
  { id: "system", label: "System" },
  { id: "responding", label: "Responding" },
];

type Sort = "relevance" | "port" | "uptime" | "type" | "status";

function fmtUptime(ms?: number): string {
  if (!ms || ms < 1000) return "just now";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function matchesFilter(s: RunningServer, f: Filter): boolean {
  switch (f) {
    case "all":
      return true;
    case "web":
      return s.type === "web";
    case "api":
      return s.type === "api";
    case "database":
      return s.type === "database";
    case "dev":
      return s.tier === "dev" || s.type === "dev";
    case "docker":
      return s.tier === "docker";
    case "system":
      return s.tier === "system";
    case "responding":
      return s.statusOk === true;
  }
}

/**
 * Process termination belongs only to user-owned development processes.
 * Docker workloads have lifecycle controls in Docker, Coretex must not stop
 * itself, and background/system listeners are intentionally read-only here.
 */
function canStopServer(server: RunningServer): boolean {
  return (
    server.pid !== undefined &&
    (server.tier === "project" || server.tier === "dev")
  );
}

export const ServersView = ({
  state,
  actions,
  onOpenBrowser,
}: {
  state: CoretexState;
  actions: CoretexActions;
  onOpenBrowser?: (url: string) => void;
}) => {
  const all = state.servers ?? [];
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("relevance");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    system: true,
  });
  const [copied, setCopied] = useState<number | null>(null);
  const ctx = useContextMenu();
  const stopConfirmation = useConfirm();

  const relevantCount = all.filter((s) => s.tier !== "system").length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((s) => {
      if (!matchesFilter(s, filter)) return false;
      if (!q) return true;
      return (
        String(s.port).includes(q) ||
        (s.process ?? "").toLowerCase().includes(q) ||
        (s.tech ?? "").toLowerCase().includes(q) ||
        (s.composeProject ?? "").toLowerCase().includes(q) ||
        (s.containerName ?? "").toLowerCase().includes(q)
      );
    });
  }, [all, filter, query]);

  const groups = useMemo(() => {
    const byTier = new Map<ServerTier, RunningServer[]>();
    for (const s of filtered) {
      const arr = byTier.get(s.tier) ?? [];
      arr.push(s);
      byTier.set(s.tier, arr);
    }
    const cmp = (a: RunningServer, b: RunningServer): number => {
      switch (sort) {
        case "port":
          return a.port - b.port;
        case "uptime":
          return (b.uptimeMs ?? 0) - (a.uptimeMs ?? 0);
        case "type":
          return a.type.localeCompare(b.type);
        case "status":
          return Number(b.statusOk) - Number(a.statusOk) || a.port - b.port;
        default:
          return a.port - b.port;
      }
    };
    return TIER_ORDER.map((tier) => ({
      tier,
      items: (byTier.get(tier) ?? []).sort(cmp),
    })).filter((g) => g.items.length > 0);
  }, [filtered, sort]);

  const copyUrl = (s: RunningServer) => {
    void navigator.clipboard
      ?.writeText(s.url ?? `localhost:${s.port}`)
      .then(() => {
        setCopied(s.port);
        window.setTimeout(() => setCopied(null), 1500);
      });
  };
  const requestStop = (server: RunningServer) => {
    if (!canStopServer(server) || server.pid === undefined) return;
    const owner = server.process || server.tech || `port ${server.port}`;
    stopConfirmation.confirm({
      title: `Stop ${owner}?`,
      description: `This ends process ${server.pid}, which is listening on port ${server.port}. Unsaved work in that process may be lost.`,
      confirmLabel: "Stop process",
      onConfirm: () => actions.killServer(server.pid as number),
    });
  };

  const openServer = (s: RunningServer) => {
    if (!s.url) return;
    if (onOpenBrowser) onOpenBrowser(s.url);
    else window.open(s.url, "_blank", "noopener");
  };

  const serverMenu = (s: RunningServer): MenuItem[] => {
    const openable = s.type !== "database" && !!s.url;
    const items: MenuItem[] = [
      { header: `:${s.port}${s.tech ? ` · ${s.tech}` : ""}` },
      {
        key: "open",
        label: "Open in browser",
        icon: LinkExternal01,
        onClick: () => openServer(s),
        disabled: !openable,
      },
      {
        key: "copy",
        label: "Copy URL",
        icon: Copy01,
        onClick: () => copyUrl(s),
      },
      { separator: true },
      {
        key: "rescan",
        label: "Rescan servers",
        icon: RefreshCcw01,
        onClick: () => actions.scanServers(),
      },
    ];
    if (canStopServer(s)) {
      items.push(
        { separator: true },
        {
          key: "kill",
          label: `Stop process ${s.pid}`,
          icon: Trash01,
          danger: true,
          onClick: () => requestStop(s),
        },
      );
    }
    return items;
  };

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-display-sm font-semibold text-primary">
            Running servers
          </h1>
          <p className="mt-1 text-sm text-tertiary">
            <span className="font-medium text-secondary">{relevantCount}</span>{" "}
            relevant of {all.length} listening ports — your projects, dev
            servers, and Docker stacks first.
          </p>
        </div>
        <Button
          size="sm"
          color="secondary"
          iconLeading={RefreshCcw01}
          onClick={() => actions.scanServers()}
        >
          Rescan
        </Button>
      </div>

      {/* Filters + search + sort */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cx(
                "rounded-lg px-2.5 py-1 text-xs font-medium transition",
                filter === f.id
                  ? ""
                  : "text-tertiary hover:bg-[var(--surface-2)]",
              )}
              style={
                filter === f.id
                  ? { background: "var(--brand)", color: "#fff" }
                  : { border: "1px solid var(--c-border)" }
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto xl:ml-auto">
          <div className="min-w-48 flex-1 sm:w-48 sm:flex-none">
            <Input
              value={query}
              onChange={setQuery}
              placeholder="Search servers"
              size="sm"
            />
          </div>
          <div className="min-w-40 flex-1 sm:w-40 sm:flex-none">
            <NativeSelect
              size="sm"
              aria-label="Sort servers"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              options={[
                { value: "relevance", label: "Sort: Relevance" },
                { value: "port", label: "Sort: Port" },
                { value: "uptime", label: "Sort: Uptime" },
                { value: "type", label: "Sort: Type" },
                { value: "status", label: "Sort: Status" },
              ]}
            />
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div
          className="flex justify-center rounded-xl px-6 py-16"
          style={cardStyle}
        >
          <EmptyState size="md">
            <EmptyState.Header>
              <EmptyState.FeaturedIcon
                color="brand"
                theme="light"
                icon={Signal01}
              />
            </EmptyState.Header>
            <EmptyState.Content>
              <EmptyState.Title>
                {all.length === 0 ? "No servers detected" : "No servers match"}
              </EmptyState.Title>
              <EmptyState.Description>
                {all.length === 0
                  ? "Nothing is listening yet. Start a dev server or Docker stack, then rescan to see it here."
                  : "No running servers match your current filter and search. Try clearing them or rescan for fresh results."}
              </EmptyState.Description>
            </EmptyState.Content>
            <EmptyState.Footer>
              <Button
                size="md"
                color="secondary"
                iconLeading={RefreshCcw01}
                onClick={() => actions.scanServers()}
              >
                Rescan
              </Button>
            </EmptyState.Footer>
          </EmptyState>
        </div>
      ) : (
        groups.map(({ tier, items }) => {
          const tm = TIER_META[tier];
          const TierIcon = tm.icon;
          const isCollapsed = collapsed[tier] === true;
          const responding = items.filter((s) => s.statusOk).length;
          return (
            <div
              key={tier}
              className="overflow-hidden rounded-xl"
              style={cardStyle}
            >
              <button
                type="button"
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [tier]: !c[tier] }))
                }
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition hover:bg-[var(--surface-2)]"
              >
                {isCollapsed ? (
                  <ChevronRight className="size-4 text-quaternary" />
                ) : (
                  <ChevronDown className="size-4 text-quaternary" />
                )}
                <TierIcon className="size-4 text-secondary" />
                <span className="text-sm font-semibold text-primary">
                  {tm.label}
                </span>
                <span className="text-xs text-quaternary">
                  {items.length}
                  {responding > 0 ? ` · ${responding} responding` : ""}
                </span>
              </button>

              {!isCollapsed && (
                <ul className="flex flex-col divide-y divide-[var(--c-border)] border-t border-secondary">
                  {items.map((s) => {
                    const meta = TYPE_META[s.type];
                    const Icon = meta.icon;
                    const openable = s.type !== "database" && s.url;
                    const ownerLabel =
                      s.tier === "docker"
                        ? `${s.containerName ?? "container"}${s.composeProject ? ` · ${s.composeProject}` : ""}`
                        : `${s.process ?? "process"}${s.pid ? ` · process ${s.pid}` : ""}`;
                    return (
                      <li
                        key={`${s.port}-${s.pid ?? 0}`}
                        className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                        onContextMenu={(e) => ctx.open(e, serverMenu(s))}
                      >
                        <span
                          className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                          style={{ background: "var(--surface-2)" }}
                        >
                          <Icon className="size-4 text-secondary" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-primary">
                              :{s.port}
                            </span>
                            <Badge size="sm" color={meta.color}>
                              {meta.label}
                            </Badge>
                            {s.tech && (
                              <span className="text-sm text-secondary">
                                {s.tech}
                              </span>
                            )}
                            <BadgeWithDot
                              size="sm"
                              color={s.statusOk === true || s.type === "database" ? "success" : "gray"}
                            >
                              {s.type === "database"
                                ? "TCP open"
                                : s.statusOk === true
                                  ? "Responding"
                                  : s.statusOk === false
                                    ? "No HTTP response"
                                    : "Listening"}
                            </BadgeWithDot>
                            <span
                              className="text-xs text-quaternary"
                              title={`active for ${fmtUptime(s.uptimeMs)}`}
                            >
                              ↑ {fmtUptime(s.uptimeMs)}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-tertiary">
                            {ownerLabel}
                          </p>
                        </div>
                        <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1 sm:w-auto">
                          {openable && (
                            <Button
                              size="sm"
                              color="tertiary"
                              iconLeading={LinkExternal01}
                              onClick={() =>
                                onOpenBrowser
                                  ? onOpenBrowser(s.url as string)
                                  : window.open(s.url, "_blank", "noopener")
                              }
                            >
                              Open
                            </Button>
                          )}
                          <Button
                            size="sm"
                            color="tertiary"
                            iconLeading={Copy01}
                            onClick={() => copyUrl(s)}
                          >
                            {copied === s.port ? "Copied" : "Copy"}
                          </Button>
                          {canStopServer(s) && (
                            <Button
                              size="sm"
                              color="tertiary-destructive"
                              iconLeading={Trash01}
                              onClick={() => requestStop(s)}
                            >
                              Stop
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })
      )}
      {ctx.node}
      {stopConfirmation.dialog}
    </div>
  );
};
