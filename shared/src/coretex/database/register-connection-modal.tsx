// @ts-nocheck
"use client";

// Coretex — the "Register connection" dialog (pgAdmin-style). Add or edit a
// database connection: name, engine, and the per-engine connection fields. The
// password is a SECRET — it never lives in the config object; on save it is sent
// to the Brain's local credential store under "db.<id>.password" and only a
// `passwordConfigured` flag is persisted. "Test connection" runs a real
// driver-backed probe through the Brain (db:testConnection) and shows the result
// inline. Save upserts the whole connections array via actions.updateSettings.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  XClose,
  CheckCircle,
  XCircle,
  Loading01,
  Lightning01,
  Server01,
  Database01,
} from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { Toggle } from "@/components/base/toggle/toggle";
import { cx } from "@/utils/cx";
import type { CoretexConfig, DbConnection } from "@repo/coretex/types";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { BrandLogo } from "../ui/brand-logo";
import {
  DEFAULT_PORTS,
  ENGINE_DOMAIN,
  ENGINE_LABEL,
  ENGINE_OPTIONS,
  KNOWN_PORTS,
  engineRichOptions,
} from "./engine-meta";

type Engine = DbConnection["engine"];

function makeId(): string {
  return (
    "db-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

const EngineMark = ({ engine, size }: { engine: Engine; size: number }) => {
  const domain = ENGINE_DOMAIN[engine];
  return domain ? (
    <BrandLogo domain={domain} name={engine} size={size} className="shrink-0" />
  ) : (
    <Database01
      className="shrink-0 text-quaternary"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
};

interface Props {
  settings: CoretexConfig;
  state: CoretexState;
  actions: CoretexActions;
  /** The connection being edited, or null/undefined for a brand-new "Register" flow. */
  editing: DbConnection | null;
  /** Preselect an engine when the flow starts from an engine tile. */
  preferredEngine?: Engine;
  onClose: () => void;
  /** Returns the exact saved draft so the caller never has to read stale settings. */
  onSaved?: (connection: DbConnection) => void;
}

/** A draft connection plus the (never-persisted-plaintext) password field. */
interface Draft extends DbConnection {
  /** Locally-typed password — sent to credential storage on save, never into the config. */
  password: string;
  /** True once the user has manually edited the port (suppresses engine-driven autofill). */
  portTouched: boolean;
}

function toDraft(
  conn: DbConnection | null,
  preferredEngine: Engine = "postgres",
): Draft {
  if (conn) {
    return {
      ...conn,
      password: "",
      portTouched: typeof conn.port === "number" && !KNOWN_PORTS.has(conn.port),
    };
  }
  return {
    id: makeId(),
    name: "",
    engine: preferredEngine,
    host: "localhost",
    port: DEFAULT_PORTS[preferredEngine],
    database: preferredEngine === "redis" ? "0" : "",
    user: "",
    passwordConfigured: false,
    ssl: false,
    password: "",
    portTouched: false,
  };
}

export const RegisterConnectionModal = ({
  settings,
  state,
  actions,
  editing,
  preferredEngine,
  onClose,
  onSaved,
}: Props) => {
  const [draft, setDraft] = useState<Draft>(() =>
    toDraft(editing, preferredEngine),
  );
  const [testing, setTesting] = useState(false);
  const seededFor = useRef<string | null>(editing?.id ?? null);
  const persistedForTest = useRef(false);
  useEffect(() => {
    const key = editing?.id ?? null;
    if (key !== seededFor.current) {
      seededFor.current = key;
      setDraft(toDraft(editing, preferredEngine));
      setTesting(false);
    }
  }, [editing]);

  const testResult = state.db.tests[draft.id];
  useEffect(() => {
    setTesting(false);
  }, [testResult]);

  const isNew = !editing;
  const isFileEngine = draft.engine === "sqlite";
  const isRedis = draft.engine === "redis";
  const supportsSsl = !isFileEngine;
  const engineOptions = useMemo(() => engineRichOptions(), []);

  const set = (patch: Partial<Draft>): void =>
    setDraft((d) => ({ ...d, ...patch }));

  const changeEngine = (engine: Engine): void => {
    const port = draft.portTouched ? draft.port : DEFAULT_PORTS[engine];
    const database =
      engine === "redis" && draft.engine !== "redis"
        ? "0"
        : draft.engine === "redis" && draft.database === "0"
          ? ""
          : draft.database;
    set({ engine, port, database });
  };

  const toConnection = (): DbConnection => {
    const willHavePassword =
      draft.password.length > 0 || draft.passwordConfigured;
    const base: DbConnection = {
      id: draft.id,
      name: draft.name.trim() || ENGINE_LABEL[draft.engine],
      engine: draft.engine,
      passwordConfigured: isFileEngine ? false : willHavePassword,
    };
    if (isFileEngine) {
      base.database = draft.database?.trim() || "";
    } else {
      base.host = draft.host?.trim() || "localhost";
      base.port = draft.port;
      base.database = draft.database?.trim() || "";
      base.user = draft.user?.trim() || "";
      base.ssl = draft.ssl === true;
    }
    return base;
  };

  const persistPassword = (): void => {
    if (!isFileEngine && draft.password.length > 0) {
      actions.setSecret("db." + draft.id + ".password", draft.password);
    }
  };

  const writeConnections = (conn: DbConnection): void => {
    const existing = settings.database.connections;
    const idx = existing.findIndex((c) => c.id === conn.id);
    const next =
      idx === -1
        ? [...existing, conn]
        : existing.map((c) => (c.id === conn.id ? conn : c));
    actions.updateSettings({
      database: { ...settings.database, connections: next },
    });
  };

  const runTest = (): void => {
    persistPassword();
    writeConnections(toConnection());
    persistedForTest.current = true;
    setTesting(true);
    actions.dbTestConnection(draft.id);
    if (draft.password.length > 0)
      set({ password: "", passwordConfigured: true });
  };

  const save = (): void => {
    persistPassword();
    if (isFileEngine && draft.passwordConfigured) {
      actions.setSecret("db." + draft.id + ".password", "");
    }
    const conn = toConnection();
    writeConnections(conn);
    onSaved?.(conn);
    onClose();
  };

  const cancel = (): void => {
    // A new draft is registered briefly so the backend can test it by id.
    // Cancel still discards that temporary connection and its credential.
    if (persistedForTest.current) {
      const connections = editing
        ? settings.database.connections.map((connection) =>
            connection.id === editing.id ? editing : connection,
          )
        : settings.database.connections.filter(
            (connection) => connection.id !== draft.id,
          );
      actions.updateSettings({
        database: { ...settings.database, connections },
      });
      if (!editing) actions.setSecret(`db.${draft.id}.password`, "");
    }
    onClose();
  };

  const redisIndexText = (draft.database ?? "0").trim();
  const redisIndex = Number(redisIndexText);
  const redisIndexValid =
    /^\d+$/.test(redisIndexText) && redisIndex <= 2_147_483_647;
  const mongoPasswordNeedsUser =
    draft.engine === "mongo" &&
    Boolean(draft.password.length > 0 || draft.passwordConfigured) &&
    !draft.user?.trim();
  const canSave = isFileEngine
    ? Boolean(draft.database?.trim())
    : isRedis
      ? Boolean(draft.host?.trim() && redisIndexValid)
      : Boolean(
          draft.host?.trim() &&
          draft.database?.trim() &&
          (draft.engine === "mongo" || draft.user?.trim()) &&
          !mongoPasswordNeedsUser,
        );

  const fieldLabel = "mb-1.5 block text-xs font-medium text-secondary";
  const title = useMemo(
    () => (isNew ? "Register connection" : "Edit connection"),
    [isNew],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onMouseDown={cancel}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl shadow-xl"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--c-border)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: "1px solid var(--c-border)" }}
        >
          <EngineMark engine={draft.engine} size={24} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-primary">
              {title}
            </h2>
            <p className="truncate text-xs text-tertiary">
              {draft.name.trim() || "New database connection"}
            </p>
          </div>
          <button
            type="button"
            onClick={cancel}
            className="rounded p-1 text-quaternary hover:bg-[var(--surface-2)]"
            aria-label="Close"
          >
            <XClose className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={fieldLabel}>Name</label>
              <Input
                aria-label="Connection name"
                value={draft.name}
                placeholder="My database"
                onChange={(v: string) => set({ name: v })}
              />
            </div>
            <div className="col-span-2">
              <label className={fieldLabel}>Engine</label>
              <NativeSelect
                options={engineOptions}
                value={draft.engine}
                rich
                onChange={(e) => changeEngine(e.target.value as Engine)}
              />
            </div>

            {isFileEngine ? (
              <div className="col-span-2">
                <label className={fieldLabel}>Database file</label>
                <Input
                  aria-label="SQLite file path"
                  value={draft.database ?? ""}
                  placeholder="~/.coretex/data.sqlite"
                  onChange={(v: string) => set({ database: v })}
                />
                <p className="mt-1.5 text-xs text-quaternary">
                  SQLite reads a local file — host, port, and credentials aren’t
                  used.
                </p>
              </div>
            ) : (
              <>
                <div className="col-span-2 grid grid-cols-[1fr_120px] gap-3">
                  <div>
                    <label className={fieldLabel}>Host</label>
                    <Input
                      aria-label="Host"
                      value={draft.host ?? ""}
                      placeholder="localhost"
                      onChange={(v: string) => set({ host: v })}
                    />
                  </div>
                  <div>
                    <label className={fieldLabel}>Port</label>
                    <Input
                      aria-label="Port"
                      type="number"
                      value={
                        typeof draft.port === "number" ? String(draft.port) : ""
                      }
                      placeholder={String(DEFAULT_PORTS[draft.engine] ?? "")}
                      onChange={(v: string) => {
                        const n = Number(v);
                        set({
                          port: v === "" || Number.isNaN(n) ? undefined : n,
                          portTouched: true,
                        });
                      }}
                    />
                  </div>
                </div>
                <div className="col-span-2">
                  <label className={fieldLabel}>
                    {isRedis ? "Database index" : "Database name"}
                  </label>
                  <Input
                    aria-label={
                      isRedis ? "Redis database index" : "Database name"
                    }
                    type={isRedis ? "number" : "text"}
                    value={draft.database ?? ""}
                    placeholder={
                      isRedis
                        ? "0"
                        : draft.engine === "mongo"
                          ? "admin"
                          : "postgres"
                    }
                    onChange={(v: string) => set({ database: v })}
                  />
                  {isRedis && (
                    <p
                      className={cx(
                        "mt-1.5 text-xs",
                        redisIndexValid
                          ? "text-quaternary"
                          : "text-error-primary",
                      )}
                    >
                      Use whole digits from 0 to 2,147,483,647. Most standalone
                      servers expose 0–15; Redis Cluster uses DB 0.
                    </p>
                  )}
                </div>
                <div className="col-span-2">
                  <label className={fieldLabel}>
                    Username{" "}
                    {(draft.engine === "mongo" || isRedis) && (
                      <span className="font-normal text-quaternary">
                        (optional)
                      </span>
                    )}
                  </label>
                  <Input
                    aria-label="Username"
                    value={draft.user ?? ""}
                    placeholder={
                      draft.engine === "mongo" || isRedis
                        ? "Leave blank if not required"
                        : "postgres"
                    }
                    onChange={(v: string) => set({ user: v })}
                  />
                </div>
                <div className="col-span-2">
                  <label className={fieldLabel}>Password</label>
                  <Input
                    aria-label="Password"
                    type="password"
                    value={draft.password}
                    placeholder={
                      draft.passwordConfigured
                        ? "••••••••  (saved — leave blank to keep)"
                        : "Enter password"
                    }
                    onChange={(v: string) => set({ password: v })}
                  />
                  <p className="mt-1.5 text-xs text-quaternary">
                    Stored separately in the local credential store, never in
                    connection settings.
                  </p>
                  {mongoPasswordNeedsUser && (
                    <p className="mt-1.5 text-xs text-error-primary">
                      MongoDB requires a username when a password is configured.
                    </p>
                  )}
                </div>
                {supportsSsl && (
                  <div
                    className="col-span-2 mt-1 flex items-center justify-between rounded-lg px-3 py-2.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-secondary">
                        Use SSL / TLS
                      </p>
                      <p className="text-xs text-quaternary">
                        Negotiate an encrypted connection to the server.
                      </p>
                    </div>
                    <Toggle
                      isSelected={draft.ssl === true}
                      onChange={(v: boolean) => set({ ssl: v })}
                      aria-label="Use SSL/TLS"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {(testing || testResult) && (
            <div
              className="mt-4 flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs"
              style={{ background: "var(--surface-2)" }}
            >
              {testing ? (
                <>
                  <Loading01 className="size-4 animate-spin text-quaternary" />
                  <span className="text-tertiary">Testing connection…</span>
                </>
              ) : testResult?.ok ? (
                <>
                  <CheckCircle
                    className="size-4"
                    style={{ color: "var(--c-success)" }}
                  />
                  <span style={{ color: "var(--c-success)" }}>
                    Connected successfully.
                  </span>
                </>
              ) : (
                <>
                  <XCircle
                    className="size-4 shrink-0"
                    style={{ color: "var(--c-error)" }}
                  />
                  <span
                    className="min-w-0 break-words"
                    style={{ color: "var(--c-error)" }}
                  >
                    {testResult?.error ?? "Could not connect."}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-between gap-2 px-5 py-4"
          style={{ borderTop: "1px solid var(--c-border)" }}
        >
          <Button
            size="sm"
            color="secondary"
            iconLeading={isFileEngine ? Database01 : Server01}
            isLoading={testing}
            onClick={runTest}
            isDisabled={!canSave}
          >
            Test connection
          </Button>
          <div className="flex items-center gap-2">
            <Button size="sm" color="secondary" onClick={cancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              color="primary"
              iconLeading={Lightning01}
              onClick={save}
              isDisabled={!canSave}
            >
              {isNew ? "Save connection" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export { ENGINE_DOMAIN, DEFAULT_PORTS, ENGINE_OPTIONS };
