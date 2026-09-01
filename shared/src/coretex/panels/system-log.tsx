// @ts-nocheck
"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Copy01,
  Expand01,
  InfoCircle,
  PauseCircle,
  PlayCircle,
  SearchLg,
  Trash01,
} from "@untitledui/icons";
import type { LogLevel } from "@repo/coretex/types";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import {
  ButtonGroup,
  ButtonGroupItem,
} from "@/components/base/button-group/button-group";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Input } from "@/components/base/input/input";
import { cx } from "@/utils/cx";
import type {
  CoretexActions,
  CoretexLogLine,
  CoretexState,
} from "../use-coretex";

type LogFilter = "all" | LogLevel;

const LEVEL_META = {
  info: {
    label: "Info",
    icon: InfoCircle,
    color: "gray" as const,
    iconClass: "text-fg-quaternary",
    surface: "bg-secondary",
  },
  warn: {
    label: "Warning",
    icon: AlertTriangle,
    color: "warning" as const,
    iconClass: "text-warning-primary",
    surface: "bg-warning-primary",
  },
  error: {
    label: "Error",
    icon: AlertCircle,
    color: "error" as const,
    iconClass: "text-error-primary",
    surface: "bg-error-primary",
  },
};

const timeValue = (timestamp: string): number => {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
};

const localTime = (timestamp: string): string => {
  const parsed = timeValue(timestamp);
  if (!parsed) return "--:--";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(parsed);
};

const fullLocalTime = (timestamp: string): string => {
  const parsed = timeValue(timestamp);
  if (!parsed) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(parsed);
};

const lineText = (line: CoretexLogLine): string =>
  `[${fullLocalTime(line.timestamp)}] [${line.level.toUpperCase()}] ${line.message}`;

function applyFilter(
  logs: CoretexLogLine[],
  filter: LogFilter,
  query: string,
): CoretexLogLine[] {
  const needle = query.trim().toLowerCase();
  return logs.filter((line) => {
    if (filter !== "all" && line.level !== filter) return false;
    if (!needle) return true;
    return (
      line.message.toLowerCase().includes(needle) ||
      line.level.includes(needle) ||
      fullLocalTime(line.timestamp).toLowerCase().includes(needle)
    );
  });
}

/** Count-badge tint per filter — neutral for All/Info, but Warn/Errors pop in their
 * semantic color whenever they're non-zero so a glance at the tab row tells you
 * whether anything needs attention, not just "All" vs "not All". */
const COUNT_BADGE_CLASS: Record<LogFilter, (active: boolean) => string> = {
  all: () =>
    "bg-utility-neutral-50 text-utility-neutral-700 ring-1 ring-utility-neutral-200 ring-inset",
  info: () => "bg-secondary text-quaternary",
  warn: (active) => (active ? "bg-warning-solid text-white" : "bg-warning-primary text-warning-primary"),
  error: (active) => (active ? "bg-error-solid text-white" : "bg-error-primary text-error-primary"),
};

function LogFilters({
  value,
  onChange,
  counts,
  compact = false,
}: {
  value: LogFilter;
  onChange: (filter: LogFilter) => void;
  counts: Record<LogFilter, number>;
  compact?: boolean;
}) {
  const filters: { id: LogFilter; label: string }[] = compact
    ? [
        { id: "all", label: "All" },
        { id: "warn", label: "Warn" },
        { id: "error", label: "Errors" },
      ]
    : [
        { id: "all", label: "All" },
        { id: "info", label: "Info" },
        { id: "warn", label: "Warnings" },
        { id: "error", label: "Errors" },
      ];

  return (
    <ButtonGroup
      size="sm"
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = [...keys][0] as LogFilter | undefined;
        if (next) onChange(next);
      }}
      aria-label="Filter system activity"
    >
      {filters.map((item) => {
        const hasCount = counts[item.id] > 0;
        const badgeToneActive = (item.id === "warn" || item.id === "error") && hasCount;
        return (
          <ButtonGroupItem
            key={item.id}
            id={item.id}
            className="px-2.5 py-1.5 text-xs"
          >
            <span>{item.label}</span>
            <span
              className={cx(
                "inline-flex min-w-5 items-center justify-center rounded-md px-1 py-0.5 text-[11px] leading-none tabular-nums",
                badgeToneActive ? COUNT_BADGE_CLASS[item.id](true) : COUNT_BADGE_CLASS[item.id](false),
              )}
              aria-label={`${counts[item.id]} ${item.label.toLowerCase()} events`}
            >
              {counts[item.id]}
            </span>
          </ButtonGroupItem>
        );
      })}
    </ButtonGroup>
  );
}

function LogFeed({
  logs,
  detailed = false,
  paused = false,
}: {
  logs: CoretexLogLine[];
  detailed?: boolean;
  paused?: boolean;
}) {
  if (logs.length === 0) {
    return (
      <div
        className={cx(
          "flex flex-col items-center justify-center rounded-lg border border-dashed border-secondary px-4 text-center",
          detailed ? "min-h-48 py-10" : "min-h-36 py-6",
        )}
      >
        <span className="grid size-9 place-items-center rounded-lg bg-secondary text-fg-quaternary">
          <Activity className="size-4" />
        </span>
        <p className="mt-2 text-sm font-medium text-secondary">
          No matching activity
        </p>
        <p className="mt-0.5 text-xs text-quaternary">
          New orchestrator and task events will appear here.
        </p>
      </div>
    );
  }

  return (
    <div
      role="log"
      aria-label="System activity"
      aria-live={paused ? "off" : "polite"}
      aria-relevant="additions text"
      className={cx("flex flex-col", detailed ? "gap-1" : "gap-0.5")}
    >
      {logs.map((line, index) => {
        const meta = LEVEL_META[line.level];
        const Icon = meta.icon;
        return (
          <div
            key={`${line.timestamp}:${line.level}:${index}:${line.message}`}
            className={cx(
              "group flex min-w-0 items-start gap-2.5 rounded-lg border-l-2 border-transparent transition hover:bg-primary_hover",
              detailed ? "px-2.5 py-2.5" : "px-2 py-2",
              line.level === "warn" && "bg-warning-primary/10",
              line.level === "error" && "bg-error-primary/10",
            )}
            style={
              line.level === "warn"
                ? { borderLeftColor: "var(--c-warning)" }
                : line.level === "error"
                  ? { borderLeftColor: "var(--c-error)" }
                  : undefined
            }
          >
            <span
              className={cx(
                "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md",
                meta.surface,
              )}
            >
              <Icon className={cx("size-3.5", meta.iconClass)} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {detailed && (
                  <Badge type="color" size="sm" color={meta.color}>
                    {meta.label}
                  </Badge>
                )}
                <time
                  className="text-[11px] text-quaternary tabular-nums"
                  dateTime={line.timestamp}
                  title={fullLocalTime(line.timestamp)}
                >
                  {localTime(line.timestamp)}
                </time>
              </div>
              <p
                className={cx(
                  "mt-0.5 break-words text-xs leading-relaxed",
                  line.level === "info" ? "text-secondary" : meta.iconClass,
                  !detailed && "line-clamp-2",
                )}
              >
                {line.message}
              </p>
            </div>
            {detailed && (
              <ButtonUtility
                size="xs"
                color="tertiary"
                icon={Copy01}
                tooltip="Copy event"
                className="shrink-0 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100"
                onClick={() =>
                  void navigator.clipboard?.writeText(lineText(line))
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export const SystemLog = ({
  state,
}: {
  state: CoretexState;
  actions: CoretexActions;
}) => {
  const [filter, setFilter] = useState<LogFilter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [clearedAt, setClearedAt] = useState(0);
  const [pausedAt, setPausedAt] = useState<number | null>(null);

  const availableLogs = useMemo(
    () => state.logs.filter((line) => timeValue(line.timestamp) > clearedAt),
    [clearedAt, state.logs],
  );
  const capturedLogs = useMemo(
    () =>
      pausedAt === null
        ? availableLogs
        : availableLogs.filter((line) => timeValue(line.timestamp) <= pausedAt),
    [availableLogs, pausedAt],
  );
  const counts = useMemo<Record<LogFilter, number>>(
    () => ({
      all: capturedLogs.length,
      info: capturedLogs.filter((line) => line.level === "info").length,
      warn: capturedLogs.filter((line) => line.level === "warn").length,
      error: capturedLogs.filter((line) => line.level === "error").length,
    }),
    [capturedLogs],
  );
  const filtered = useMemo(
    () => applyFilter(capturedLogs, filter, query),
    [capturedLogs, filter, query],
  );
  const preview = useMemo(() => filtered.slice(-5).reverse(), [filtered]);
  const allVisible = useMemo(() => [...filtered].reverse(), [filtered]);
  const queuedWhilePaused =
    pausedAt === null
      ? 0
      : availableLogs.filter((line) => timeValue(line.timestamp) > pausedAt)
          .length;

  const togglePaused = () =>
    setPausedAt((current) => (current === null ? Date.now() : null));
  const clearLocal = () => {
    setClearedAt(Date.now());
    setPausedAt(null);
    setQuery("");
    setFilter("all");
  };
  const copyVisible = () =>
    void navigator.clipboard?.writeText(
      allVisible.slice().reverse().map(lineText).join("\n"),
    );

  return (
    <>
      <section className="flex min-h-[25rem] flex-col rounded-xl border border-secondary bg-primary p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-fg-quaternary">
              <Activity className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-primary">
                System activity
              </h2>
              <p className="truncate text-xs text-tertiary">
                Orchestrator, task, and agent events
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ButtonUtility
              size="xs"
              color="tertiary"
              icon={pausedAt === null ? PauseCircle : PlayCircle}
              tooltip={
                pausedAt === null
                  ? "Pause live activity"
                  : "Resume live activity"
              }
              onClick={togglePaused}
            />
            <ButtonUtility
              size="xs"
              color="tertiary"
              icon={Expand01}
              tooltip="View all activity"
              onClick={() => setExpanded(true)}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <BadgeWithDot
            type="color"
            size="sm"
            color={
              pausedAt !== null
                ? "warning"
                : state.connected
                  ? "success"
                  : "error"
            }
          >
            {pausedAt !== null
              ? `Paused${queuedWhilePaused > 0 ? ` / ${queuedWhilePaused} new` : ""}`
              : state.connected
                ? "Live"
                : "Disconnected"}
          </BadgeWithDot>
          {(counts.warn > 0 || counts.error > 0) && (
            <span className="flex items-center gap-1.5">
              {counts.warn > 0 && (
                <Badge type="color" size="sm" color="warning">
                  {counts.warn} warning{counts.warn === 1 ? "" : "s"}
                </Badge>
              )}
              {counts.error > 0 && (
                <Badge type="color" size="sm" color="error">
                  {counts.error} error{counts.error === 1 ? "" : "s"}
                </Badge>
              )}
            </span>
          )}
        </div>

        <div className="mt-3 overflow-x-auto pb-0.5">
          <LogFilters
            value={filter}
            onChange={setFilter}
            counts={counts}
            compact
          />
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-lg bg-secondary/40 p-1">
          <LogFeed logs={preview} paused={pausedAt !== null} />
        </div>

        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 inline-flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-medium text-secondary transition hover:bg-primary_hover hover:text-primary focus-visible:outline-2 focus-visible:outline-brand"
        >
          <span>
            {filtered.length === 0
              ? "Open activity viewer"
              : `View ${filtered.length} matching event${filtered.length === 1 ? "" : "s"}`}
          </span>
          <Expand01 className="size-3.5 text-fg-quaternary" />
        </button>
      </section>

      <SlideoutMenu
        isOpen={expanded}
        onOpenChange={setExpanded}
        isDismissable
        dialogClassName="gap-0"
      >
        <SlideoutMenu.Header onClose={() => setExpanded(false)}>
          <div className="flex items-center gap-2.5 pr-8">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-fg-quaternary">
              <Activity className="size-4" />
            </span>
            <div>
              <h1 className="text-md font-semibold text-primary">
                System activity
              </h1>
              <p className="text-xs text-tertiary">
                Live diagnostics from this Coretex session
              </p>
            </div>
          </div>
        </SlideoutMenu.Header>

        <SlideoutMenu.Content className="gap-4 py-5">
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              icon={SearchLg}
              value={query}
              onChange={setQuery}
              placeholder="Search activity"
              aria-label="Search system activity"
            />
            <ButtonUtility
              icon={pausedAt === null ? PauseCircle : PlayCircle}
              tooltip={
                pausedAt === null
                  ? "Pause live activity"
                  : "Resume live activity"
              }
              onClick={togglePaused}
            />
            <ButtonUtility
              icon={Copy01}
              tooltip="Copy visible events"
              isDisabled={allVisible.length === 0}
              onClick={copyVisible}
            />
            <ButtonUtility
              icon={Trash01}
              tooltip="Clear this view"
              isDisabled={availableLogs.length === 0}
              onClick={clearLocal}
            />
          </div>

          <div className="overflow-x-auto pb-0.5">
            <LogFilters value={filter} onChange={setFilter} counts={counts} />
          </div>

          <div className="rounded-xl border border-secondary bg-secondary/30 p-1">
            <LogFeed logs={allVisible} detailed paused={pausedAt !== null} />
          </div>
        </SlideoutMenu.Content>

        <SlideoutMenu.Footer className="flex items-center justify-between gap-3">
          <BadgeWithDot
            type="color"
            size="sm"
            color={
              pausedAt !== null
                ? "warning"
                : state.connected
                  ? "success"
                  : "error"
            }
          >
            {pausedAt !== null
              ? `Paused${queuedWhilePaused > 0 ? ` / ${queuedWhilePaused} queued` : ""}`
              : state.connected
                ? "Receiving live events"
                : "Brain disconnected"}
          </BadgeWithDot>
          <span className="text-xs text-quaternary tabular-nums">
            {allVisible.length} shown / {availableLogs.length} session events
          </span>
        </SlideoutMenu.Footer>
      </SlideoutMenu>
    </>
  );
};
