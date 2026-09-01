// @ts-nocheck
"use client";

// Coretex Relay — Database settings (§11.1). The default store path is a scalar
// key driven through the standard controls; connections are an array collection,
// so every edit recomputes the WHOLE connections array and writes it wholesale
// via actions.updateSettings({ database: { ...settings.database, connections } }).
// Connection passwords are secrets: they never live in settings, only a
// passwordConfigured flag does — the value goes to local credential storage under
// "db.<id>.password". "Test connection" runs a real driver-backed probe through
// the Brain (db:testConnection) and reports the live result.
import { useEffect, useMemo, useRef, useState } from "react";
import type { CoretexConfig } from "@repo/coretex/types";
import type { DbConnection } from "@repo/coretex/types";
import { CheckCircle, Database01, Edit03, Plus, Trash01, XCircle, Zap } from "@untitledui/icons";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RichSelect } from "@/components/base/select/rich-select";
import { Toggle } from "@/components/base/toggle/toggle";
import { DEFAULT_PORTS, ENGINE_DOMAIN, KNOWN_PORTS, engineRichOptions } from "../../database/engine-meta";
import { BrandLogo } from "../../ui/brand-logo";
import { type MenuItem, useContextMenu } from "../../ui/context-menu";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { SettingsSection } from "../controls";
import { SettingsPageHeader } from "../settings-shell";

function makeId(): string {
    return "db-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

interface ConnectionCardProps {
    settings: CoretexConfig;
    state: CoretexState;
    actions: CoretexActions;
    conn: DbConnection;
}

const ConnectionCard = ({ settings, state, actions, conn }: ConnectionCardProps) => {
    const [password, setPassword] = useState<string>("");
    const [savedNote, setSavedNote] = useState<string | null>(null);
    const [testing, setTesting] = useState<boolean>(false);
    const testResult = state.db.tests[conn.id];
    const ctx = useContextMenu();
    const deletion = useConfirm();
    const nameWrapRef = useRef<HTMLDivElement | null>(null);
    const engineOptions = useMemo(() => engineRichOptions(), []);

    useEffect(() => {
        setTesting(false);
    }, [testResult]);

    const runTest = (): void => {
        if (password.length > 0) {
            actions.setSecret("db." + conn.id + ".password", password);
            patch({ passwordConfigured: true });
            setPassword("");
            setSavedNote("Password saved.");
        }
        setTesting(true);
        actions.dbTestConnection(conn.id);
    };

    const writeConnections = (next: DbConnection[]): void => {
        actions.updateSettings({
            database: { ...settings.database, connections: next },
        });
    };

    const patch = (changes: Partial<DbConnection>): void => {
        const next = settings.database.connections.map((c) => (c.id === conn.id ? { ...c, ...changes } : c));
        writeConnections(next);
    };

    const remove = (): void => {
        const next = settings.database.connections.filter((c) => c.id !== conn.id);
        writeConnections(next);
        if (conn.passwordConfigured) actions.setSecret("db." + conn.id + ".password", "");
        if (settings.databaseLinks?.[conn.id]) {
            const nextLinks = { ...settings.databaseLinks };
            delete nextLinks[conn.id];
            actions.setSetting("databaseLinks", nextLinks);
        }
    };

    const requestRemove = (): void =>
        deletion.confirm({
            title: "Delete connection?",
            description: (
                <>
                    Remove <span className="font-medium text-secondary">{conn.name}</span> from Coretex? Its locally stored password will be cleared. The
                    database itself is not changed.
                </>
            ),
            confirmLabel: "Delete connection",
            onConfirm: remove,
        });

    const isActive = settings.database.connections[0]?.id === conn.id;
    const setActive = (): void => {
        if (isActive) return;
        const rest = settings.database.connections.filter((c) => c.id !== conn.id);
        writeConnections([conn, ...rest]);
    };

    const editName = (): void => {
        nameWrapRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    };

    const cardMenu = (): MenuItem[] => [
        { header: conn.name },
        {
            key: "test",
            label: "Test connection",
            icon: testResult?.ok ? CheckCircle : XCircle,
            onClick: runTest,
        },
        { key: "edit", label: "Edit name", icon: Edit03, onClick: editName },
        {
            key: "active",
            label: "Set active",
            icon: Zap,
            checked: isActive,
            disabled: isActive,
            onClick: setActive,
        },
        { separator: true },
        {
            key: "delete",
            label: "Delete connection",
            icon: Trash01,
            danger: true,
            onClick: requestRemove,
        },
    ];

    const savePassword = (): void => {
        if (password.length === 0) {
            setSavedNote("Enter a password first.");
            return;
        }
        actions.setSecret("db." + conn.id + ".password", password);
        patch({ passwordConfigured: true });
        setPassword("");
        setSavedNote("Password saved to the local credential store.");
    };

    const isFileEngine = conn.engine === "sqlite";
    const isRedis = conn.engine === "redis";
    const redisIndexText = (conn.database ?? "0").trim();
    const redisIndex = Number(redisIndexText);
    const redisIndexValid = /^\d+$/.test(redisIndexText) && redisIndex <= 2_147_483_647;
    const mongoPasswordNeedsUser = conn.engine === "mongo" && Boolean(password.length > 0 || conn.passwordConfigured) && !conn.user?.trim();

    return (
        <div
            className="rounded-xl p-4"
            style={{
                background: "var(--surface-2)",
                border: "1px solid var(--c-border)",
            }}
            onContextMenu={(e) => ctx.open(e, cardMenu())}
        >
            {ctx.node}
            {deletion.dialog}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                {ENGINE_DOMAIN[conn.engine] ? (
                    <BrandLogo domain={ENGINE_DOMAIN[conn.engine]!} name={conn.engine} size={20} className="shrink-0" />
                ) : (
                    <Database01 className="size-4 shrink-0 text-quaternary" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1" ref={nameWrapRef}>
                    <Input aria-label="Connection name" value={conn.name} placeholder="Connection name" onChange={(v: string) => patch({ name: v })} />
                </div>
                <div className="w-full shrink-0 sm:w-52">
                    <RichSelect
                        aria-label="Database engine"
                        options={engineOptions}
                        value={conn.engine}
                        rich
                        onChange={(e) => {
                            const engine = e.target.value as DbConnection["engine"];
                            const keepPort = typeof conn.port === "number" && !KNOWN_PORTS.has(conn.port);
                            patch({
                                engine,
                                host: engine === "sqlite" ? undefined : (conn.host ?? "localhost"),
                                port: engine === "sqlite" ? undefined : keepPort ? conn.port : DEFAULT_PORTS[engine],
                                database:
                                    engine === "redis" && conn.engine !== "redis" ? "0" : conn.engine === "redis" && conn.database === "0" ? "" : conn.database,
                                user: engine === "sqlite" ? undefined : engine === "redis" && conn.engine !== "redis" ? "" : conn.user,
                                // SQLite does not use the credential, but retaining it makes an
                                // accidental engine change reversible instead of destructive.
                                passwordConfigured: conn.passwordConfigured,
                                ssl: engine === "sqlite" ? undefined : (conn.ssl ?? false),
                            });
                        }}
                    />
                </div>
            </div>

            {isFileEngine ? (
                <div className="mt-4">
                    <label className="mb-1.5 block text-xs font-medium text-secondary">Database file</label>
                    <Input
                        aria-label="Database file path"
                        value={conn.database ?? ""}
                        placeholder="~/.coretex/data.sqlite"
                        onChange={(v: string) => patch({ database: v })}
                    />
                    <p className="mt-2 text-xs text-quaternary">
                        SQLite connects to a local file — host, port, and credentials are not used. Queries are read-only.
                    </p>
                </div>
            ) : (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-secondary">Host</label>
                        <Input aria-label="Host" value={conn.host ?? ""} placeholder="localhost" onChange={(v: string) => patch({ host: v })} />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-secondary">Port</label>
                        <Input
                            aria-label="Port"
                            type="number"
                            value={typeof conn.port === "number" ? String(conn.port) : ""}
                            placeholder={String(DEFAULT_PORTS[conn.engine] ?? "")}
                            onChange={(v: string) => {
                                const n = Number(v);
                                patch({ port: v === "" || Number.isNaN(n) ? undefined : n });
                            }}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-secondary">{isRedis ? "Database index" : "Database"}</label>
                        <Input
                            aria-label={isRedis ? "Redis database index" : "Database"}
                            type={isRedis ? "number" : "text"}
                            value={conn.database ?? ""}
                            placeholder={isRedis ? "0" : conn.engine === "mongo" ? "admin" : "coretex"}
                            onChange={(v: string) => patch({ database: v })}
                        />
                        {isRedis && (
                            <p className={`mt-1.5 text-xs ${redisIndexValid ? "text-quaternary" : "text-error-primary"}`}>
                                Use whole digits from 0 to 2,147,483,647. Most standalone servers expose 0–15; Redis Cluster uses DB 0.
                            </p>
                        )}
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-secondary">
                            User {(conn.engine === "mongo" || isRedis) && <span className="font-normal text-quaternary">(optional)</span>}
                        </label>
                        <Input
                            aria-label="User"
                            value={conn.user ?? ""}
                            placeholder={conn.engine === "mongo" || isRedis ? "Leave blank if not required" : "postgres"}
                            onChange={(v: string) => patch({ user: v })}
                        />
                    </div>
                </div>
            )}

            {!isFileEngine && (
                <>
                    <div className="mt-4">
                        <label className="mb-1.5 block text-xs font-medium text-secondary">Password</label>
                        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start">
                            <div className="flex-1">
                                <Input
                                    aria-label="Password"
                                    type="password"
                                    value={password}
                                    placeholder={conn.passwordConfigured ? "••••••••  (saved)" : "Enter password"}
                                    onChange={(v: string) => {
                                        setPassword(v);
                                        setSavedNote(null);
                                    }}
                                />
                            </div>
                            <Button size="md" color="secondary" onClick={savePassword} isDisabled={conn.engine === "mongo" && !conn.user?.trim()}>
                                Save password
                            </Button>
                        </div>
                        {savedNote ? (
                            <p className="mt-1.5 text-xs text-tertiary">{savedNote}</p>
                        ) : conn.passwordConfigured ? (
                            <p className="mt-1.5 text-xs text-quaternary">A password is stored locally for this connection.</p>
                        ) : (
                            <p className="mt-1.5 text-xs text-quaternary">No password stored yet.</p>
                        )}
                        {mongoPasswordNeedsUser && (
                            <p className="mt-1.5 text-xs text-error-primary">MongoDB requires a username when a password is configured.</p>
                        )}
                    </div>
                    <div
                        className="mt-4 flex items-center justify-between rounded-lg px-3 py-2.5"
                        style={{
                            background: "var(--surface)",
                            border: "1px solid var(--c-border)",
                        }}
                    >
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-secondary">Use SSL / TLS</p>
                            <p className="text-xs text-quaternary">Negotiate an encrypted connection to the server.</p>
                        </div>
                        <Toggle isSelected={conn.ssl === true} onChange={(v: boolean) => patch({ ssl: v })} aria-label="Use SSL/TLS" />
                    </div>
                </>
            )}

            <div className="mt-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0">
                    <Button
                        size="sm"
                        color="secondary"
                        isLoading={testing}
                        isDisabled={(isRedis && !redisIndexValid) || mongoPasswordNeedsUser}
                        onClick={runTest}
                    >
                        Test connection
                    </Button>
                    {testing ? (
                        <p className="mt-1.5 text-xs text-quaternary">Testing connection…</p>
                    ) : testResult ? (
                        <p
                            className="mt-1.5 text-xs"
                            style={{
                                color: testResult.ok ? "var(--c-success)" : "var(--c-error)",
                            }}
                        >
                            {testResult.ok ? "Connected successfully." : `Failed: ${testResult.error ?? "could not connect"}`}
                        </p>
                    ) : null}
                </div>
                <Button size="sm" color="link-destructive" iconLeading={Trash01} onClick={requestRemove}>
                    Delete
                </Button>
            </div>
        </div>
    );
};

export const DatabasePage = ({ settings, state, actions }: { settings: CoretexConfig; state: CoretexState; actions: CoretexActions }) => {
    const connections = settings.database.connections;

    const addConnection = (): void => {
        const conn: DbConnection = {
            id: makeId(),
            name: "New connection",
            engine: "postgres",
            host: "localhost",
            port: 5432,
            database: "",
            user: "",
            passwordConfigured: false,
            ssl: false,
        };
        actions.updateSettings({
            database: { ...settings.database, connections: [...connections, conn] },
        });
    };

    return (
        <div className="flex flex-col gap-6">
            <SettingsPageHeader icon={Database01} title="Database" subtitle="Coretex data store and external database connections for agents and tools." />

            <SettingsSection title="Default store" description="The on-disk store backing Coretex itself.">
                <div className="flex flex-col items-start justify-between gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-6">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-primary">Coretex data store</p>
                        <p className="mt-0.5 text-xs text-tertiary">Where sessions, agent history, and project indexes live.</p>
                    </div>
                    <div className="w-full shrink-0 sm:w-72">
                        <Input aria-label="Coretex data store" value={(settings.database.defaultStore || "~/.coretex").trim() || "~/.coretex"} isDisabled />
                    </div>
                </div>
                <p className="pt-3 text-xs text-quaternary">
                    The store location is fixed at the local <code>~/.coretex</code> directory. Relocating it (with migration) isn’t supported yet.
                </p>
            </SettingsSection>

            <SettingsSection title="Connections" description="External databases available in the Database view (read-only queries).">
                <div className="flex flex-col items-start justify-between gap-3 py-3.5 first:pt-0 sm:flex-row sm:items-center sm:gap-4">
                    <p className="text-xs text-quaternary">
                        Supports PostgreSQL, MySQL, MariaDB, MongoDB, Redis, and SQLite. Passwords stay in the local credential store; SQL and Redis commands
                        are gated to safe reads.
                    </p>
                    <Button className="shrink-0" size="sm" color="secondary" iconLeading={Plus} onClick={addConnection}>
                        Add connection
                    </Button>
                </div>

                <div className="flex flex-col gap-3 pt-3.5">
                    {connections.length === 0 ? (
                        <div className="flex items-center justify-center rounded-xl px-6 py-10" style={{ border: "1px dashed var(--c-border)" }}>
                            <EmptyState size="sm">
                                <EmptyState.Header>
                                    <EmptyState.FeaturedIcon icon={Database01} color="brand" theme="light" />
                                </EmptyState.Header>
                                <EmptyState.Content>
                                    <EmptyState.Title>No connections yet</EmptyState.Title>
                                    <EmptyState.Description>
                                        Add a PostgreSQL, MySQL, MariaDB, MongoDB, Redis, or SQLite connection to browse schemas, keys, and read-only results.
                                    </EmptyState.Description>
                                </EmptyState.Content>
                                <EmptyState.Footer>
                                    <Button size="sm" color="primary" iconLeading={Plus} onClick={addConnection}>
                                        Add connection
                                    </Button>
                                </EmptyState.Footer>
                            </EmptyState>
                        </div>
                    ) : (
                        connections.map((conn) => <ConnectionCard key={conn.id} settings={settings} state={state} actions={actions} conn={conn} />)
                    )}
                </div>
            </SettingsSection>
        </div>
    );
};
