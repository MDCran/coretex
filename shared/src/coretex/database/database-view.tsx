// @ts-nocheck
"use client";

// Coretex — multi-engine, read-only database explorer. Credentials are stored
// separately from connection settings and every query path is gated server-side.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Copy01,
  Database01,
  Edit03,
  FileCode01,
  Key01,
  Loading01,
  Lock01,
  Plus,
  Play,
  RefreshCcw01,
  Rows01,
  SearchLg,
  Table as TableIcon,
  Terminal,
  Trash01,
  XCircle,
} from "@untitledui/icons";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { cx } from "@/utils/cx";
import type { DbConnection, DbSchemaTable } from "@repo/coretex/types";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { CoretexMonaco } from "../files/monaco-editor";
import { BrandLogo } from "../ui/brand-logo";
import { useContextMenu, type MenuItem } from "../ui/context-menu";
import { RegisterConnectionModal } from "./register-connection-modal";
import {
  ENGINE_DOMAIN,
  ENGINE_LABEL,
  ENGINE_OPTIONS,
  defaultQuery,
  quoteTableRef,
} from "./engine-meta";

const SURFACE = {
  background: "var(--surface)",
  border: "1px solid var(--c-border)",
} as const;

const EngineMark = ({
  engine,
  size,
}: {
  engine: DbConnection["engine"];
  size: number;
}) =>
  ENGINE_DOMAIN[engine] ? (
    <BrandLogo domain={ENGINE_DOMAIN[engine]!} name={engine} size={size} />
  ) : (
    <Database01
      className="text-quaternary"
      style={{ width: size, height: size }}
    />
  );

function connectionLocation(connection: DbConnection): string {
  if (connection.engine === "sqlite")
    return connection.database || "No file selected";
  const server = `${connection.host || "localhost"}${connection.port ? `:${connection.port}` : ""}`;
  if (connection.engine === "redis")
    return `${server} · DB ${connection.database || "0"}`;
  return `${server} · ${connection.database || "No database"}`;
}

function redisArgument(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function redisPreviewCommand(table: DbSchemaTable): string {
  const key = redisArgument(table.name);
  const type = String(table.metadata?.dataType || "").toLowerCase();
  if (type === "string") return `GET ${key}`;
  if (type === "hash") return `HSCAN ${key} 0 COUNT 100`;
  if (type === "list") return `LRANGE ${key} 0 99`;
  if (type === "set") return `SSCAN ${key} 0 COUNT 100`;
  if (type === "zset") return `ZRANGE ${key} 0 99 WITHSCORES`;
  if (type === "stream") return `XRANGE ${key} - + COUNT 100`;
  return `TYPE ${key}`;
}

function cellText(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function resultAsCsv(columns: string[], rows: unknown[][]): string {
  const escape = (value: unknown) => {
    const text = cellText(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    columns.map(escape).join(","),
    ...rows.map((row) => row.map(escape).join(",")),
  ].join("\n");
}

function resultAsJson(columns: string[], rows: unknown[][]): string {
  return JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(columns.map((column, index) => [column, row[index]])),
    ),
    null,
    2,
  );
}

const SchemaNode = ({
  table,
  onOpen,
  onMenu,
}: {
  table: DbSchemaTable;
  onOpen: (table: DbSchemaTable) => void;
  onMenu: (event: React.MouseEvent, table: DbSchemaTable) => void;
}) => {
  const [open, setOpen] = useState(false);
  const hasColumns = (table.columns?.length ?? 0) > 0;
  const isKey = table.kind === "key";
  const keyType = isKey ? String(table.metadata?.dataType || "key") : "";
  const ttl = Number(table.metadata?.ttlSeconds);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(table)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(table);
          }
        }}
        onContextMenu={(event) => onMenu(event, table)}
        className="group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-600"
      >
        {hasColumns ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
            className="shrink-0 rounded p-0.5 text-quaternary hover:bg-[var(--surface-2)]"
            aria-label={open ? "Collapse fields" : "Expand fields"}
          >
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="w-[18px] shrink-0" />
        )}
        {isKey ? (
          <Key01 className="size-4 shrink-0 text-brand-600" />
        ) : (
          <TableIcon className="size-4 shrink-0 text-quaternary" />
        )}
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium text-primary"
            title={table.name}
          >
            {table.name}
          </p>
          {isKey && (
            <p className="truncate text-[11px] text-quaternary">
              {keyType}
              {Number.isFinite(ttl)
                ? ttl < 0
                  ? " · no expiry"
                  : ` · TTL ${ttl}s`
                : ""}
            </p>
          )}
        </div>
        {!isKey && table.kind !== "table" && (
          <Badge size="sm" color="gray">
            {table.kind}
          </Badge>
        )}
      </div>
      {open && hasColumns && (
        <div
          className="mb-1 ml-8 border-l py-1 pl-3"
          style={{ borderColor: "var(--c-border)" }}
        >
          {table.columns!.map((column) => (
            <div
              key={column.name}
              className="flex items-center gap-2 py-1 text-[11px]"
              title={`${column.name}: ${column.type}`}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-secondary">
                {column.name}
              </span>
              <span className="max-w-24 truncate text-quaternary">
                {column.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const HeaderStat = ({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) => (
  <div className="min-w-24 px-4 py-1 first:pl-0 last:pr-0">
    <p className="text-lg font-semibold text-primary">{value}</p>
    <p className="text-xs text-quaternary">{label}</p>
  </div>
);

export const DatabaseView = ({
  state,
  actions,
}: {
  state: CoretexState;
  actions: CoretexActions;
}) => {
  const connections = useMemo(
    () => state.settings?.database.connections ?? [],
    [state.settings],
  );
  const projects = state.projects;
  const links = state.settings?.databaseLinks ?? {};
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const [query, setQuery] = useState(
    defaultQuery(connections[0]?.engine ?? "sqlite"),
  );
  const [queryStarted, setQueryStarted] = useState(false);
  const [queryPendingId, setQueryPendingId] = useState<string | null>(null);
  const [schemaPendingId, setSchemaPendingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [connectionSearch, setConnectionSearch] = useState("");
  const [schemaSearch, setSchemaSearch] = useState("");
  const [selectedObject, setSelectedObject] = useState<DbSchemaTable | null>(
    null,
  );
  const [copied, setCopied] = useState<"csv" | "json" | null>(null);
  const [modal, setModal] = useState<{
    editing: DbConnection | null;
    preferredEngine?: DbConnection["engine"];
  }>();
  const [confirmDelete, setConfirmDelete] = useState<DbConnection | null>(null);
  const testedRef = useRef(new Set<string>());
  const resultBeforeRun = useRef(state.db.result);
  const schemaBeforeLoad = useRef<unknown>();
  const testBeforeRun = useRef<unknown>();
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextMenu = useContextMenu();

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (connections.length === 0) {
      if (connectionId) setConnectionId("");
      return;
    }
    if (!connections.some((connection) => connection.id === connectionId)) {
      const first = connections[0];
      setConnectionId(first.id);
      setQuery(defaultQuery(first.engine));
      setQueryStarted(false);
      setQueryPendingId(null);
    }
  }, [connections, connectionId]);

  const connection = connections.find((item) => item.id === connectionId);
  const result =
    state.db.result?.connectionId === connectionId ? state.db.result : null;
  const schema = connectionId ? state.db.schemas[connectionId] : undefined;
  const databaseList = connectionId
    ? state.db.databases?.[connectionId]
    : undefined;
  const inspection = connectionId
    ? state.db.introspections?.[connectionId]
    : undefined;
  const test = connectionId ? state.db.tests[connectionId] : undefined;
  const isMongo = connection?.engine === "mongo";
  const isRedis = connection?.engine === "redis";
  const isCommandMode = isMongo || isRedis;

  const requestSchema = (id: string): void => {
    schemaBeforeLoad.current = state.db.schemas[id];
    setSchemaPendingId(id);
    actions.dbSchema(id);
  };
  const requestTest = (id: string): void => {
    testBeforeRun.current = state.db.tests[id];
    setTestingId(id);
    actions.dbTestConnection(id);
  };

  useEffect(() => {
    if (!connectionId) return;
    requestSchema(connectionId);
    actions.dbListDatabases?.(connectionId);
    if (!testedRef.current.has(connectionId)) {
      testedRef.current.add(connectionId);
      requestTest(connectionId);
    }
  }, [connectionId, connection?.database]);
  useEffect(() => {
    if (
      schemaPendingId &&
      state.db.schemas[schemaPendingId] !== schemaBeforeLoad.current
    )
      setSchemaPendingId(null);
  }, [schemaPendingId, state.db.schemas]);
  useEffect(() => {
    if (testingId && state.db.tests[testingId] !== testBeforeRun.current)
      setTestingId(null);
  }, [testingId, state.db.tests]);
  useEffect(() => {
    if (
      queryPendingId &&
      state.db.result !== resultBeforeRun.current &&
      state.db.result?.connectionId === queryPendingId
    )
      setQueryPendingId(null);
  }, [queryPendingId, state.db.result]);

  const filteredConnections = useMemo(() => {
    const needle = connectionSearch.trim().toLowerCase();
    if (!needle) return connections;
    return connections.filter((item) =>
      `${item.name} ${ENGINE_LABEL[item.engine]} ${connectionLocation(item)}`
        .toLowerCase()
        .includes(needle),
    );
  }, [connections, connectionSearch]);
  const filteredSchema = useMemo(() => {
    const needle = schemaSearch.trim().toLowerCase();
    if (!needle) return schema?.tables ?? [];
    return (schema?.tables ?? []).filter(
      (table) =>
        table.name.toLowerCase().includes(needle) ||
        table.columns?.some((column) =>
          `${column.name} ${column.type}`.toLowerCase().includes(needle),
        ),
    );
  }, [schema, schemaSearch]);
  const databaseOptions = useMemo(() => {
    const items = databaseList?.items ?? [];
    return items.map((item) => ({
      value: item.name,
      label: isRedis
        ? `DB ${item.name}${typeof item.itemCount === "number" ? ` · ${item.itemCount.toLocaleString()} keys` : ""}`
        : item.name,
    }));
  }, [databaseList, isRedis]);
  const inspectedObject =
    selectedObject && inspection?.value?.target.name === selectedObject.name
      ? inspection.value
      : undefined;
  const onlineCount = connections.filter(
    (item) => state.db.tests[item.id]?.ok,
  ).length;
  const engineCount = new Set(connections.map((item) => item.engine)).size;

  const selectConnection = (item: DbConnection): void => {
    setConnectionId(item.id);
    setQuery(defaultQuery(item.engine));
    setQueryStarted(false);
    setQueryPendingId(null);
    setSchemaSearch("");
    setSelectedObject(null);
  };
  const run = (): void => {
    if (!connectionId || !query.trim()) return;
    resultBeforeRun.current = state.db.result;
    setQueryStarted(true);
    setQueryPendingId(connectionId);
    setSelectedObject(null);
    actions.dbQuery(connectionId, query);
  };
  const openTable = (table: DbSchemaTable): void => {
    if (!connection) return;
    const nextQuery = isRedis
      ? redisPreviewCommand(table)
      : isMongo
        ? table.name
        : `SELECT * FROM ${quoteTableRef(connection.engine, table.name)} LIMIT 100;`;
    setQuery(nextQuery);
    resultBeforeRun.current = state.db.result;
    setQueryStarted(true);
    setQueryPendingId(connectionId);
    setSelectedObject(table);
    actions.dbIntrospect?.(connectionId, {
      name: table.name,
      schema: table.schema,
      kind: table.kind,
    });
    actions.dbQuery(connectionId, nextQuery);
  };
  const switchDatabase = (database: string): void => {
    if (!connection || database === connection.database) return;
    actions.updateSettings({
      database: {
        ...state.settings!.database,
        connections: connections.map((item) =>
          item.id === connection.id ? { ...item, database } : item,
        ),
      },
    });
    testedRef.current.delete(connection.id);
    setQuery(defaultQuery(connection.engine));
    setQueryStarted(false);
    setQueryPendingId(null);
    setSelectedObject(null);
  };
  const linkProject = (projectId: string): void => {
    const next = { ...links };
    if (projectId) next[connectionId] = projectId;
    else delete next[connectionId];
    actions.setSetting("databaseLinks", next);
  };
  const deleteConnection = (item: DbConnection): void => {
    actions.updateSettings({
      database: {
        ...state.settings!.database,
        connections: connections.filter(
          (connectionItem) => connectionItem.id !== item.id,
        ),
      },
    });
    if (item.passwordConfigured)
      actions.setSecret(`db.${item.id}.password`, "");
    if (links[item.id]) {
      const nextLinks = { ...links };
      delete nextLinks[item.id];
      actions.setSetting("databaseLinks", nextLinks);
    }
    setConfirmDelete(null);
  };
  const focusEditor = (): void => {
    editorWrapRef.current
      ?.querySelector<HTMLElement>("textarea, input")
      ?.focus();
  };
  const copyText = (text: string, kind?: "csv" | "json"): void => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        if (!kind) return;
        setCopied(kind);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(null), 1800);
      })
      .catch(() => undefined);
  };
  const connectionMenu = (item: DbConnection): MenuItem[] => {
    const itemTest = state.db.tests[item.id];
    return [
      { header: item.name },
      {
        key: "test",
        label: "Test connection",
        icon: itemTest?.ok ? CheckCircle : XCircle,
        onClick: () => requestTest(item.id),
      },
      {
        key: "refresh",
        label: item.engine === "redis" ? "Refresh keyspace" : "Refresh schema",
        icon: RefreshCcw01,
        onClick: () => requestSchema(item.id),
      },
      {
        key: "query",
        label: item.engine === "redis" ? "Open command console" : "Open query",
        icon: Terminal,
        onClick: focusEditor,
      },
      { separator: true },
      {
        key: "edit",
        label: "Edit connection",
        icon: Edit03,
        onClick: () => setModal({ editing: item }),
      },
      {
        key: "delete",
        label: "Delete connection",
        icon: Trash01,
        danger: true,
        onClick: () => setConfirmDelete(item),
      },
      { separator: true },
      {
        key: "copy",
        label: "Copy connection name",
        icon: Copy01,
        onClick: () => copyText(item.name),
      },
    ];
  };
  const tableMenu = (table: DbSchemaTable): MenuItem[] => [
    { header: table.name },
    {
      key: "preview",
      label: isRedis
        ? "Preview key"
        : isMongo
          ? "Preview collection"
          : "Preview first 100 rows",
      icon: table.kind === "key" ? Key01 : TableIcon,
      onClick: () => openTable(table),
    },
    { separator: true },
    {
      key: "copy",
      label: "Copy name",
      icon: Copy01,
      onClick: () => copyText(table.name),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4 sm:p-6">
      {contextMenu.node}
      <header className="shrink-0 rounded-2xl p-5" style={SURFACE}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-950 dark:ring-brand-800">
              <Database01 className="size-5 text-brand-600" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-primary">Database</h1>
                <Badge color="brand" size="sm">
                  {ENGINE_OPTIONS.length} engines
                </Badge>
                <Badge color="gray" size="sm">
                  <span className="flex items-center gap-1">
                    <Lock01 className="size-3" /> Read only
                  </span>
                </Badge>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-tertiary">
                Connect local files and database servers, inspect schemas or
                keyspaces, and explore data with protected read-only queries.
              </p>
            </div>
          </div>
          {connections.length > 0 && (
            <div
              className="hidden divide-x lg:flex"
              style={{ borderColor: "var(--c-border)" }}
            >
              <HeaderStat label="Connections" value={connections.length} />
              <HeaderStat label="Connected" value={onlineCount} />
              <HeaderStat label="Engines" value={engineCount} />
            </div>
          )}
          <Button
            size="sm"
            color="primary"
            iconLeading={Plus}
            onClick={() => setModal({ editing: null })}
          >
            New connection
          </Button>
        </div>
      </header>

      {connections.length === 0 ? (
        <div
          className="mt-4 flex min-h-[520px] flex-1 items-center justify-center rounded-2xl p-6"
          style={{ ...SURFACE, background: "var(--surface-2)" }}
        >
          <div className="w-full max-w-3xl text-center">
            <EmptyState size="sm">
              <EmptyState.Header>
                <EmptyState.FeaturedIcon
                  icon={Database01}
                  color="brand"
                  theme="light"
                />
              </EmptyState.Header>
              <EmptyState.Content>
                <EmptyState.Title>
                  Connect your first data source
                </EmptyState.Title>
                <EmptyState.Description>
                  Credentials stay in the local credential store. Drivers load
                  only when a connection is used.
                </EmptyState.Description>
              </EmptyState.Content>
              <EmptyState.Footer>
                <Button
                  size="sm"
                  color="primary"
                  iconLeading={Plus}
                  onClick={() => setModal({ editing: null })}
                >
                  Register connection
                </Button>
              </EmptyState.Footer>
            </EmptyState>
            <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ENGINE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setModal({ editing: null, preferredEngine: option.value })
                  }
                  className="flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition hover:bg-primary_hover"
                  style={{
                    borderColor: "var(--c-border)",
                    background: "var(--surface)",
                  }}
                >
                  <EngineMark engine={option.value} size={22} />
                  <div>
                    <p className="text-sm font-medium text-primary">
                      {option.label}
                    </p>
                    <p className="text-[11px] text-quaternary">
                      {option.value === "redis"
                        ? "Key-value"
                        : option.value === "mongo"
                          ? "Document"
                          : option.value === "sqlite"
                            ? "Local file"
                            : "Relational"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid min-h-[720px] flex-1 grid-cols-1 gap-4 xl:min-h-0 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="grid min-h-0 grid-rows-[minmax(240px,0.8fr)_minmax(300px,1.2fr)] gap-4">
            <section
              className="flex min-h-0 flex-col overflow-hidden rounded-2xl"
              style={SURFACE}
            >
              <div
                className="flex items-center justify-between gap-2 border-b px-4 py-3"
                style={{ borderColor: "var(--c-border)" }}
              >
                <div>
                  <h2 className="text-sm font-semibold text-primary">
                    Connections
                  </h2>
                  <p className="text-xs text-quaternary">
                    {connections.length} saved locally
                  </p>
                </div>
                <Button
                  size="sm"
                  color="secondary"
                  iconLeading={Plus}
                  onClick={() => setModal({ editing: null })}
                >
                  Add
                </Button>
              </div>
              <div className="px-3 pt-3">
                <Input
                  value={connectionSearch}
                  onChange={setConnectionSearch}
                  placeholder="Search connections"
                  icon={SearchLg}
                  size="sm"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {filteredConnections.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                    <SearchLg className="size-5 text-quaternary" />
                    <p className="mt-2 text-xs text-tertiary">
                      No connections match “{connectionSearch}”.
                    </p>
                  </div>
                ) : (
                  filteredConnections.map((item) => {
                    const itemTest = state.db.tests[item.id];
                    const active = item.id === connectionId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectConnection(item)}
                        onContextMenu={(event) => {
                          selectConnection(item);
                          contextMenu.open(event, connectionMenu(item));
                        }}
                        className={cx(
                          "group mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                          active
                            ? "border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950"
                            : "border-transparent hover:bg-secondary",
                        )}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary ring-1 ring-[var(--c-border)]">
                          <EngineMark engine={item.engine} size={20} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-primary">
                              {item.name}
                            </span>
                            {item.ssl && (
                              <Lock01 className="size-3 shrink-0 text-quaternary" />
                            )}
                          </span>
                          <span className="block truncate text-[11px] text-quaternary">
                            {ENGINE_LABEL[item.engine]} ·{" "}
                            {connectionLocation(item)}
                          </span>
                        </span>
                        {testingId === item.id ? (
                          <Loading01 className="size-3.5 shrink-0 animate-spin text-quaternary" />
                        ) : itemTest ? (
                          <span
                            className={cx(
                              "size-2 shrink-0 rounded-full",
                              itemTest.ok ? "bg-success-500" : "bg-error-500",
                            )}
                            title={
                              itemTest.ok
                                ? "Connected"
                                : itemTest.error || "Connection failed"
                            }
                          />
                        ) : (
                          <span
                            className="size-2 shrink-0 rounded-full bg-gray-300 dark:bg-gray-700"
                            title="Not tested"
                          />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <section
              className="flex min-h-0 flex-col overflow-hidden rounded-2xl"
              style={SURFACE}
            >
              <div
                className="flex items-center justify-between gap-2 border-b px-4 py-3"
                style={{ borderColor: "var(--c-border)" }}
              >
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-primary">
                    {isRedis ? "Keyspace" : isMongo ? "Collections" : "Schema"}
                  </h2>
                  <p className="text-xs text-quaternary">
                    {schema?.tables.length ?? 0}{" "}
                    {isRedis
                      ? "sampled keys"
                      : isMongo
                        ? "collections"
                        : "tables and views"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Refresh ${isRedis ? "keyspace" : "schema"}`}
                  onClick={() => connectionId && requestSchema(connectionId)}
                  className="rounded-lg p-2 text-quaternary transition hover:bg-secondary hover:text-secondary"
                >
                  <RefreshCcw01
                    className={cx(
                      "size-4",
                      schemaPendingId === connectionId && "animate-spin",
                    )}
                  />
                </button>
              </div>
              <div className="px-3 pt-3">
                <Input
                  value={schemaSearch}
                  onChange={setSchemaSearch}
                  placeholder={
                    isRedis
                      ? "Filter sampled keys"
                      : isMongo
                        ? "Filter collections"
                        : "Filter tables or columns"
                  }
                  icon={SearchLg}
                  size="sm"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {schemaPendingId === connectionId ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <Loading01 className="size-5 animate-spin text-brand-600" />
                    <p className="mt-2 text-xs text-tertiary">
                      Loading {isRedis ? "sampled keyspace" : "schema"}…
                    </p>
                  </div>
                ) : schema?.error ? (
                  <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                    <XCircle className="size-5 text-error-500" />
                    <p className="mt-2 line-clamp-3 text-xs text-error-primary">
                      {schema.error}
                    </p>
                    <Button
                      size="sm"
                      color="secondary"
                      iconLeading={RefreshCcw01}
                      onClick={() => requestSchema(connectionId)}
                      className="mt-3"
                    >
                      Retry
                    </Button>
                  </div>
                ) : filteredSchema.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                    {schemaSearch ? (
                      <SearchLg className="size-5 text-quaternary" />
                    ) : isRedis ? (
                      <Key01 className="size-5 text-quaternary" />
                    ) : (
                      <TableIcon className="size-5 text-quaternary" />
                    )}
                    <p className="mt-2 text-xs text-tertiary">
                      {schemaSearch
                        ? "Nothing matches this filter."
                        : isRedis
                          ? "No keys found in this database."
                          : isMongo
                            ? "No collections found."
                            : "No tables or views found."}
                    </p>
                  </div>
                ) : (
                  filteredSchema.map((table) => (
                    <SchemaNode
                      key={`${table.schema || ""}:${table.name}`}
                      table={table}
                      onOpen={openTable}
                      onMenu={(event, item) =>
                        contextMenu.open(event, tableMenu(item))
                      }
                    />
                  ))
                )}
              </div>
              {isRedis && schema && !schema.error && (
                <div
                  className="border-t px-4 py-2 text-[11px] text-quaternary"
                  style={{ borderColor: "var(--c-border)" }}
                >
                  Sampled with SCAN; large keyspaces are intentionally capped.
                </div>
              )}
            </section>
          </aside>

          <main className="flex min-h-0 flex-col gap-4">
            <section className="rounded-2xl px-4 py-3.5" style={SURFACE}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary ring-1 ring-[var(--c-border)]">
                    {connection ? (
                      <EngineMark engine={connection.engine} size={23} />
                    ) : (
                      <Database01 className="size-5 text-quaternary" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-primary">
                        {connection?.name}
                      </h2>
                      {testingId === connectionId ? (
                        <Badge size="sm" color="gray">
                          Testing…
                        </Badge>
                      ) : test?.ok ? (
                        <BadgeWithDot size="sm" color="success">
                          Connected
                        </BadgeWithDot>
                      ) : test ? (
                        <BadgeWithDot size="sm" color="error">
                          Unavailable
                        </BadgeWithDot>
                      ) : (
                        <Badge size="sm" color="gray">
                          Not tested
                        </Badge>
                      )}
                      {connection?.ssl && (
                        <Badge size="sm" color="gray">
                          <span className="flex items-center gap-1">
                            <Lock01 className="size-3" /> TLS
                          </span>
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-quaternary">
                      {connection
                        ? `${ENGINE_LABEL[connection.engine]} · ${connectionLocation(connection)}`
                        : "Select a connection"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    color="secondary"
                    iconLeading={RefreshCcw01}
                    isLoading={testingId === connectionId}
                    onClick={() => connectionId && requestTest(connectionId)}
                  >
                    Test
                  </Button>
                  <Button
                    size="sm"
                    color="secondary"
                    iconLeading={Edit03}
                    onClick={() =>
                      connection && setModal({ editing: connection })
                    }
                  >
                    Edit
                  </Button>
                  {connection?.engine !== "sqlite" &&
                    databaseOptions.length > 1 && (
                      <div className="min-w-40 flex-1 lg:flex-none">
                        <NativeSelect
                          options={databaseOptions}
                          value={connection?.database || (isRedis ? "0" : "")}
                          onChange={(event) =>
                            switchDatabase(event.target.value)
                          }
                          aria-label={
                            isRedis ? "Redis database index" : "Database"
                          }
                        />
                      </div>
                    )}
                  <div className="min-w-44 flex-1 lg:flex-none">
                    <NativeSelect
                      options={[
                        { label: "No linked project", value: "" },
                        ...projects.map((project) => ({
                          label: project.name,
                          value: project.id,
                        })),
                      ]}
                      value={links[connectionId] ?? ""}
                      onChange={(event) => linkProject(event.target.value)}
                      aria-label="Linked project"
                    />
                  </div>
                </div>
              </div>
              {test && !test.ok && testingId !== connectionId && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-error-50 px-3 py-2 text-xs text-error-primary dark:bg-error-950">
                  <XCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span className="min-w-0 break-words">
                    {test.error || "The connection test failed."}
                  </span>
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-2xl" style={SURFACE}>
              <div
                className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center"
                style={{ borderColor: "var(--c-border)" }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  {isRedis ? (
                    <Terminal className="size-4 text-brand-600" />
                  ) : isMongo ? (
                    <Rows01 className="size-4 text-brand-600" />
                  ) : (
                    <FileCode01 className="size-4 text-brand-600" />
                  )}
                  <div>
                    <h3 className="text-sm font-semibold text-primary">
                      {isRedis
                        ? "Redis command"
                        : isMongo
                          ? "Collection preview"
                          : "Read-only query"}
                    </h3>
                    <p className="text-[11px] text-quaternary">
                      {isRedis
                        ? "Allowlisted commands only · previews are capped"
                        : isMongo
                          ? "Collection name or safe JSON find spec · up to 100 documents"
                          : "One protected read-only statement at a time"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isRedis && (
                    <Badge size="sm" color="success">
                      <span className="flex items-center gap-1">
                        <Lock01 className="size-3" /> Safe reads
                      </span>
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    color="primary"
                    iconLeading={Play}
                    onClick={run}
                    isLoading={queryPendingId === connectionId}
                    isDisabled={!connectionId || !query.trim()}
                  >
                    {isRedis
                      ? "Run command"
                      : isMongo
                        ? "Preview"
                        : "Run query"}
                  </Button>
                </div>
              </div>
              <div
                ref={editorWrapRef}
                className={cx(
                  "overflow-hidden",
                  isCommandMode ? "h-28" : "h-44",
                )}
              >
                {isCommandMode ? (
                  <textarea
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={
                      isRedis ? "SCAN 0 COUNT 100" : "Collection name"
                    }
                    spellCheck={false}
                    className="h-full w-full resize-none bg-transparent px-4 py-3 font-mono text-sm leading-6 text-primary outline-none placeholder:text-quaternary"
                    style={{ background: "var(--surface-2)" }}
                    onKeyDown={(event) => {
                      if (
                        (event.ctrlKey || event.metaKey) &&
                        event.key === "Enter"
                      )
                        run();
                    }}
                  />
                ) : (
                  <CoretexMonaco
                    path="query.sql"
                    value={query}
                    onChange={setQuery}
                  />
                )}
              </div>
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-[11px] text-quaternary"
                style={{ borderColor: "var(--c-border)" }}
              >
                <span>
                  {isCommandMode
                    ? "Press Ctrl/⌘ + Enter to run"
                    : "Writes, DDL, and multiple statements are rejected by the database service"}
                </span>
                {!isCommandMode && (
                  <span>Click a table to generate a 100-row preview</span>
                )}
              </div>
            </section>

            <section
              className="flex min-h-[260px] flex-1 flex-col overflow-hidden rounded-2xl"
              style={SURFACE}
            >
              <div
                className="flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2.5"
                style={{ borderColor: "var(--c-border)" }}
              >
                <div className="flex items-center gap-2">
                  <Rows01 className="size-4 text-quaternary" />
                  <h3 className="text-sm font-semibold text-primary">
                    Results
                  </h3>
                  {result &&
                    !result.error &&
                    queryPendingId !== connectionId && (
                      <Badge size="sm" color="gray">
                        {result.rowCount.toLocaleString()} rows ·{" "}
                        {result.elapsedMs.toLocaleString()} ms
                      </Badge>
                    )}
                  {result?.truncated && queryPendingId !== connectionId && (
                    <Badge size="sm" color="warning">
                      Preview capped
                    </Badge>
                  )}
                </div>
                {result &&
                  !result.error &&
                  result.columns.length > 0 &&
                  queryPendingId !== connectionId && (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        color="tertiary"
                        iconLeading={Copy01}
                        onClick={() =>
                          copyText(
                            resultAsCsv(result.columns, result.rows),
                            "csv",
                          )
                        }
                      >
                        {copied === "csv" ? "Copied" : "Copy CSV"}
                      </Button>
                      <Button
                        size="sm"
                        color="tertiary"
                        iconLeading={Copy01}
                        onClick={() =>
                          copyText(
                            resultAsJson(result.columns, result.rows),
                            "json",
                          )
                        }
                      >
                        {copied === "json" ? "Copied" : "Copy JSON"}
                      </Button>
                    </div>
                  )}
              </div>
              {selectedObject && (inspectedObject || inspection?.error) && (
                <div
                  className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-xs"
                  style={{
                    borderColor: "var(--c-border)",
                    background: "var(--surface-2)",
                  }}
                >
                  <span
                    className="max-w-64 truncate font-mono font-medium text-secondary"
                    title={selectedObject.name}
                  >
                    {selectedObject.name}
                  </span>
                  {inspectedObject && (
                    <>
                      {inspectedObject.columns.length > 0 && (
                        <Badge size="sm" color="gray">
                          {inspectedObject.columns.length} fields
                        </Badge>
                      )}
                      {inspectedObject.indexes.length > 0 && (
                        <Badge size="sm" color="gray">
                          {inspectedObject.indexes.length} indexes
                        </Badge>
                      )}
                      {inspectedObject.metadata?.dataType && (
                        <Badge size="sm" color="brand">
                          {String(inspectedObject.metadata.dataType)}
                        </Badge>
                      )}
                      {typeof inspectedObject.metadata?.ttlSeconds ===
                        "number" && (
                        <Badge size="sm" color="gray">
                          {Number(inspectedObject.metadata.ttlSeconds) < 0
                            ? "No expiry"
                            : `TTL ${Number(inspectedObject.metadata.ttlSeconds).toLocaleString()}s`}
                        </Badge>
                      )}
                      {inspectedObject.preview?.truncated && (
                        <Badge size="sm" color="warning">
                          Details capped
                        </Badge>
                      )}
                    </>
                  )}
                  {inspection?.error && !inspectedObject && (
                    <span className="text-error-primary">
                      Details unavailable: {inspection.error}
                    </span>
                  )}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-auto">
                {queryPendingId === connectionId ? (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
                    <Loading01 className="size-6 animate-spin text-brand-600" />
                    <p className="mt-3 text-sm font-medium text-secondary">
                      Running read-only{" "}
                      {isRedis ? "command" : isMongo ? "preview" : "query"}…
                    </p>
                    <p className="mt-1 text-xs text-quaternary">
                      The service will stop slow operations automatically.
                    </p>
                  </div>
                ) : !queryStarted ? (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-secondary">
                      <Rows01 className="size-5 text-quaternary" />
                    </span>
                    <p className="mt-3 text-sm font-medium text-secondary">
                      Nothing to show yet
                    </p>
                    <p className="mt-1 max-w-sm text-xs text-quaternary">
                      {isRedis
                        ? "Choose a sampled key or run an allowlisted command."
                        : isMongo
                          ? "Choose a collection to preview its documents."
                          : "Run a query or choose a table from the schema browser."}
                    </p>
                  </div>
                ) : result?.error ? (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-error-50 dark:bg-error-950">
                      <XCircle className="size-5 text-error-500" />
                    </span>
                    <p className="mt-3 text-sm font-medium text-primary">
                      Couldn’t run this {isRedis ? "command" : "query"}
                    </p>
                    <p className="mt-1 max-w-xl break-words font-mono text-xs text-error-primary">
                      {result.error}
                    </p>
                    <Button
                      size="sm"
                      color="secondary"
                      iconLeading={RefreshCcw01}
                      onClick={run}
                      className="mt-4"
                    >
                      Try again
                    </Button>
                  </div>
                ) : result ? (
                  result.columns.length === 0 ? (
                    <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
                      <CheckCircle className="size-6 text-success-500" />
                      <p className="mt-2 text-sm font-medium text-secondary">
                        Completed in {result.elapsedMs.toLocaleString()} ms
                      </p>
                      <p className="mt-1 text-xs text-quaternary">
                        This operation returned no tabular data.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <table className="w-full border-separate border-spacing-0 text-left text-xs">
                        <thead>
                          <tr>
                            <th
                              className="sticky left-0 top-0 z-20 w-12 border-b border-r px-3 py-2.5 text-right font-medium text-quaternary"
                              style={{
                                borderColor: "var(--c-border)",
                                background: "var(--surface-2)",
                              }}
                            >
                              #
                            </th>
                            {result.columns.map((column, index) => (
                              <th
                                key={`${column}:${index}`}
                                className="sticky top-0 z-10 min-w-32 border-b border-r px-3 py-2.5 font-semibold text-secondary last:border-r-0"
                                style={{
                                  borderColor: "var(--c-border)",
                                  background: "var(--surface-2)",
                                }}
                              >
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((row, rowIndex) => (
                            <tr
                              key={rowIndex}
                              className="hover:bg-primary_hover"
                            >
                              <td
                                className="sticky left-0 border-b border-r px-3 py-2 text-right tabular-nums text-quaternary"
                                style={{
                                  borderColor: "var(--c-border)",
                                  background: "var(--surface)",
                                }}
                              >
                                {rowIndex + 1}
                              </td>
                              {result.columns.map((_, columnIndex) => {
                                const value = row[columnIndex];
                                const text = cellText(value);
                                return (
                                  <td
                                    key={columnIndex}
                                    className="max-w-[360px] border-b border-r px-3 py-2 font-mono text-tertiary last:border-r-0"
                                    style={{ borderColor: "var(--c-border)" }}
                                    title={text}
                                  >
                                    {value === null ? (
                                      <Badge size="sm" color="gray">
                                        null
                                      </Badge>
                                    ) : typeof value === "boolean" ? (
                                      <span
                                        className={
                                          value
                                            ? "text-success-primary"
                                            : "text-quaternary"
                                        }
                                      >
                                        {text}
                                      </span>
                                    ) : (
                                      <span className="block truncate">
                                        {text}
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {result.truncated && (
                        <div
                          className="sticky bottom-0 border-t bg-warning-50 px-4 py-2 text-xs text-warning-primary dark:bg-warning-950"
                          style={{ borderColor: "var(--c-border)" }}
                        >
                          Preview limit reached. Refine the query or scan cursor
                          to inspect a smaller range.
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <div className="flex h-full min-h-48 items-center justify-center text-sm text-tertiary">
                    Waiting for a result…
                  </div>
                )}
              </div>
            </section>
          </main>
        </div>
      )}

      {modal && state.settings && (
        <RegisterConnectionModal
          key={`${modal.editing?.id ?? "new"}:${modal.preferredEngine ?? "postgres"}`}
          settings={state.settings}
          state={state}
          actions={actions}
          editing={modal.editing}
          preferredEngine={modal.preferredEngine}
          onClose={() => setModal(undefined)}
          onSaved={(saved) => {
            setConnectionId(saved.id);
            setQuery(defaultQuery(saved.engine));
            setQueryStarted(false);
            testedRef.current.delete(saved.id);
          }}
        />
      )}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onMouseDown={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-5 shadow-xl"
            style={SURFACE}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-error-50 dark:bg-error-950">
                <AlertTriangle className="size-5 text-error-500" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-primary">
                  Delete connection?
                </h2>
                <p className="mt-1 text-sm text-tertiary">
                  Remove{" "}
                  <span className="font-medium text-secondary">
                    {confirmDelete.name}
                  </span>{" "}
                  from Coretex? Its locally stored password will also be
                  cleared. The database itself is not changed.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                size="sm"
                color="secondary"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                color="primary-destructive"
                iconLeading={Trash01}
                onClick={() => deleteConnection(confirmDelete)}
              >
                Delete connection
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
