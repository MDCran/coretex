import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { WebSocket } from "ws";
import { bridgeAuthProtocols } from "../src/bridge/server.js";
import { ConfigStore } from "../src/config/store.js";
import { DatabaseService } from "../src/db/service.js";
import {
    DB_MAX_CELL_BYTES,
    DB_MAX_RESULT_BYTES,
    DB_MAX_ROWS,
    parseMongoReadSpec,
    parseRedisReadOnlyCommand,
    sanitizeDatabaseError,
    validateConnection,
    validateReadOnlySql,
} from "../src/db/query-safety.js";
import { parseRedisFrame, RedisClient } from "../src/db/redis-client.js";
import type { DbConnection, DbIntrospectionTarget } from "../src/types.js";

type Engine = DbConnection["engine"];
type Status = "PASS" | "SKIP";

interface Outcome {
    engine: Engine | "shared";
    layer: string;
    status: Status;
    detail: string;
}

const outcomes: Outcome[] = [];
const record = (engine: Outcome["engine"], layer: string, status: Status, detail: string): void => {
    outcomes.push({ engine, layer, status, detail });
};

function connection(engine: Engine, patch: Partial<DbConnection> = {}): DbConnection {
    const server = engine !== "sqlite";
    return {
        id: `smoke-${engine}`,
        name: `${engine} smoke`,
        engine,
        ...(server ? { host: "127.0.0.1", database: engine === "redis" ? "0" : "coretex_smoke" } : {}),
        ...(["postgres", "mysql", "mariadb"].includes(engine) ? { user: "coretex" } : {}),
        passwordConfigured: false,
        ...patch,
    };
}

async function makeSqliteFixture(root: string): Promise<{ path: string; invalidPath: string }> {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    const db = new SQL.Database();
    db.run("CREATE TABLE samples (id INTEGER PRIMARY KEY, label TEXT NOT NULL, payload TEXT)");
    const insert = db.prepare("INSERT INTO samples (id, label, payload) VALUES (?, ?, ?)");
    try {
        for (let id = 1; id <= 620; id += 1) insert.run([id, `sample-${id}`, id === 1 ? "x".repeat(DB_MAX_CELL_BYTES + 1024) : null]);
    } finally {
        insert.free();
    }
    db.run("CREATE INDEX samples_label_idx ON samples(label)");
    db.run("CREATE VIEW sample_labels AS SELECT id, label FROM samples");
    const sqlitePath = path.join(root, "fixture.sqlite");
    const invalidPath = path.join(root, "not-a-database.sqlite");
    await writeFile(sqlitePath, Buffer.from(db.export()));
    await writeFile(invalidPath, "this is deliberately not a SQLite database", "utf8");
    db.close();
    return { path: sqlitePath, invalidPath };
}

function assertPureGuards(sqlitePath: string): void {
    const validConnections: DbConnection[] = [
        connection("sqlite", { database: sqlitePath }),
        connection("postgres"),
        connection("mysql"),
        connection("mariadb"),
        connection("mongo"),
        connection("redis"),
    ];
    for (const conn of validConnections) assert.equal(validateConnection(conn), null, `${conn.engine} should validate`);
    assert.match(validateConnection(undefined) ?? "", /not found/i);
    assert.match(validateConnection(connection("postgres", { port: 0 })) ?? "", /port/i);
    assert.match(validateConnection(connection("redis", { database: "-1" })) ?? "", /non-negative/i);
    assert.match(validateConnection({ ...connection("redis"), engine: "not-real" as Engine }) ?? "", /unsupported/i);
    record("shared", "connection validation", "PASS", "six providers plus invalid engine/port/index cases");

    const allowedSql = [
        "SELECT 1",
        "SELECT ';' AS semicolon;",
        "WITH one AS (SELECT 1 AS value) SELECT value FROM one",
        "EXPLAIN SELECT 1",
        "PRAGMA table_info('samples')",
        "SHOW TABLES",
    ];
    for (const sql of allowedSql) assert.equal(validateReadOnlySql(sql), null, `expected read-only SQL: ${sql}`);

    const rejectedSql = [
        "INSERT INTO samples VALUES (999, 'write', NULL)",
        "SELECT 1; DROP TABLE samples",
        "WITH gone AS (DELETE FROM samples RETURNING *) SELECT * FROM gone",
        "WITH changed AS (UPDATE samples SET label = 'x' RETURNING *) SELECT * FROM changed",
        "EXPLAIN DELETE FROM samples",
        "SELECT * INTO copied_samples FROM samples",
        "SELECT pg_terminate_backend(123)",
        "SELECT pg_sleep(60)",
        "SELECT pg_advisory_lock(123)",
        "SELECT load_extension('anything')",
        "PRAGMA user_version = 123",
        "PRAGMA user_version(123)",
        "PRAGMA page_size(8192)",
        "SELECT 1 -- hidden tail",
        "/* hidden prefix */ SELECT 1",
    ];
    for (const sql of rejectedSql) assert.ok(validateReadOnlySql(sql), `expected SQL rejection: ${sql}`);
    record("shared", "SQL read-only guard", "PASS", "multi-statement, write CTE, function, comment, and PRAGMA bypass regressions");

    const redisAllowed = [
        "PING",
        "SCAN 0 COUNT 100",
        "GET 'key with spaces'",
        "HSCAN smoke:hash 0 COUNT 25",
        "LRANGE smoke:list 0 99",
        "ZRANGE smoke:zset 0 99 WITHSCORES",
        "XRANGE smoke:stream - + COUNT 100",
    ];
    for (const command of redisAllowed) assert.equal(parseRedisReadOnlyCommand(command).ok, true, `expected Redis command: ${command}`);
    const redisRejected = [
        "SET smoke:key changed",
        "DEL smoke:key",
        "EVAL return 1 0",
        "CONFIG GET *",
        "CLIENT LIST",
        "FLUSHALL",
        "KEYS *",
        "SMEMBERS smoke:set",
        "HGETALL smoke:hash",
        `SCAN 0 COUNT ${DB_MAX_ROWS + 1}`,
        `LRANGE smoke:list 0 ${DB_MAX_ROWS}`,
        `XRANGE smoke:stream - + COUNT ${DB_MAX_ROWS + 1}`,
        "GET one\nGET two",
    ];
    for (const command of redisRejected) assert.equal(parseRedisReadOnlyCommand(command).ok, false, `expected Redis rejection: ${command}`);
    const quotedRedis = parseRedisReadOnlyCommand("GET 'key with spaces'");
    assert.deepEqual(quotedRedis.ok ? quotedRedis.value.args : [], ["key with spaces"]);
    record("redis", "read-only command guard", "PASS", "allowlist, quoting, scan/range bounds, and write/admin rejection");

    const mongoSimple = parseMongoReadSpec("samples");
    assert.equal(mongoSimple.ok, true);
    const mongoJson = parseMongoReadSpec(JSON.stringify({ collection: "samples", filter: { id: { $gte: 2 } }, projection: { id: 1, label: 1 }, sort: { id: "desc" }, limit: DB_MAX_ROWS + 100 }));
    assert.equal(mongoJson.ok, true);
    if (mongoJson.ok) assert.equal(mongoJson.value.limit, DB_MAX_ROWS);
    for (const input of [
        "system.users",
        JSON.stringify({ collection: "samples", filter: { $where: "true" } }),
        JSON.stringify({ collection: "samples", filter: { $expr: { $function: { body: "x" } } } }),
        JSON.stringify({ collection: "samples", pipeline: [] }),
        JSON.stringify({ collection: "samples", limit: 0 }),
    ]) {
        assert.equal(parseMongoReadSpec(input).ok, false, `expected MongoDB rejection: ${input}`);
    }
    record("mongo", "bounded document reads", "PASS", "filter/projection/sort grammar, unsafe operators, and hard limit");

    const redisFrames = Buffer.from("+PONG\r\n:2\r\n$5\r\nready\r\n*2\r\n$3\r\none\r\n$3\r\ntwo\r\n", "utf8");
    const pong = parseRedisFrame(redisFrames);
    assert.equal(pong?.value, "PONG");
    const integer = parseRedisFrame(redisFrames, pong!.offset);
    assert.equal(integer?.value, 2);
    const bulk = parseRedisFrame(redisFrames, integer!.offset);
    assert.equal(bulk?.value, "ready");
    const array = parseRedisFrame(redisFrames, bulk!.offset);
    assert.deepEqual(array?.value, ["one", "two"]);
    assert.equal(parseRedisFrame(Buffer.from("$5\r\nrea", "utf8")), null);
    assert.throws(() => parseRedisFrame(Buffer.from(`$${DB_MAX_CELL_BYTES + 1}\r\n`, "utf8")), /limit/i);
    assert.throws(() => parseRedisFrame(Buffer.from("-ERR no\r\n", "utf8")), /ERR no/);
    record("redis", "native RESP2 codec", "PASS", "simple/integer/bulk/array/incomplete/error and size-limit cases");

    const secret = "database-smoke-secret-never-log";
    const safeError = sanitizeDatabaseError(new Error(`connect postgres://coretex:${secret}@db.test/app password=${secret}`), connection("postgres"), secret);
    assert.equal(safeError.includes(secret), false);
    assert.ok(safeError.length <= 500);
    record("shared", "error sanitization", "PASS", "credential redaction and IPC message bounds");
}

async function assertDriverAvailability(): Promise<void> {
    const modules: Array<{ engine: Engine; module: string; detail: string }> = [
        { engine: "sqlite", module: "sql.js", detail: "WASM SQLite" },
        { engine: "postgres", module: "pg", detail: "node-postgres" },
        { engine: "mysql", module: "mysql2/promise", detail: "mysql2 promise client" },
        { engine: "mariadb", module: "mysql2/promise", detail: "mysql2 MariaDB protocol" },
        { engine: "mongo", module: "mongodb", detail: "official MongoDB driver" },
    ];
    for (const item of modules) {
        await import(item.module);
        record(item.engine, "runtime driver", "PASS", item.detail);
    }
    record("redis", "runtime driver", "PASS", "built-in net/tls RESP2 client; no native package required");
}

async function assertRedisTransport(): Promise<void> {
    const received: string[][] = [];
    let serverError: Error | undefined;
    const server = net.createServer((socket) => {
        let buffer = Buffer.alloc(0);
        socket.on("data", (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length > 0) {
                try {
                    const parsed = parseRedisFrame(buffer);
                    if (!parsed) return;
                    buffer = buffer.subarray(parsed.offset);
                    if (!Array.isArray(parsed.value) || parsed.value.some((part) => typeof part !== "string")) throw new Error("Expected a RESP command array.");
                    const command = parsed.value as string[];
                    received.push(command);
                    const name = command[0]?.toUpperCase();
                    socket.write(name === "PING" ? "+PONG\r\n" : name === "AUTH" || name === "SELECT" ? "+OK\r\n" : "-ERR unsupported smoke command\r\n");
                } catch (error) {
                    serverError = error instanceof Error ? error : new Error(String(error));
                    socket.destroy();
                    return;
                }
            }
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not allocate the Redis fixture port.");
    let client: RedisClient | undefined;
    try {
        client = await RedisClient.connect(connection("redis", { host: "127.0.0.1", port: address.port, database: "2", user: "reader" }), "smoke-password");
        assert.equal(await client.command(["PING"]), "PONG");
    } finally {
        client?.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (serverError) throw serverError;
    assert.deepEqual(received.map((command) => command[0]), ["AUTH", "SELECT", "PING"]);
    assert.deepEqual(received[0]?.slice(0, 2), ["AUTH", "reader"]);
    assert.equal(received[1]?.[1], "2");
    record("redis", "isolated RESP transport", "PASS", "username/password auth, logical DB selection, command, and close");
}

async function assertSqliteService(sqlitePath: string, invalidPath: string, coreOnly: boolean): Promise<void> {
    const service = new DatabaseService();
    const conn = connection("sqlite", { database: sqlitePath });

    const tested = await service.test(conn);
    assert.equal(tested.ok, true, tested.error);
    const invalid = await service.test(connection("sqlite", { database: invalidPath }));
    assert.equal(invalid.ok, false, "an existing non-database file must fail SQLite Test connection");

    const schema = await service.schema(conn);
    assert.equal(schema.error, undefined);
    const table = schema.tables.find((item) => item.name === "samples");
    assert.ok(table, "SQLite schema should include samples");
    assert.equal(table.kind, "table");
    assert.ok(table.columns?.some((column) => column.name === "label"));
    assert.ok(schema.tables.some((item) => item.name === "sample_labels" && item.kind === "view"));

    const result = await service.query(conn, "SELECT id, label FROM samples ORDER BY id");
    assert.equal(result.error, undefined);
    assert.equal(result.rows.length, DB_MAX_ROWS);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.columns, ["id", "label"]);

    const oversized = await service.query(conn, "SELECT payload FROM samples WHERE id = 1");
    if (oversized.error) {
        assert.match(oversized.error, /limit|large|size|exceed/i);
    } else {
        assert.ok(Buffer.byteLength(JSON.stringify(oversized), "utf8") <= DB_MAX_RESULT_BYTES + 4096, "result envelope must stay bounded");
        assert.ok(Buffer.byteLength(String(oversized.rows[0]?.[0] ?? ""), "utf8") <= DB_MAX_CELL_BYTES + 64, "cell must stay bounded");
    }

    const rejected = await service.query(conn, "SELECT 1; DROP TABLE samples");
    assert.ok(rejected.error);
    const pragmaRejected = await service.query(conn, "PRAGMA user_version(123)");
    assert.ok(pragmaRejected.error);
    const count = await service.query(conn, "SELECT COUNT(*) AS count FROM samples");
    assert.equal(count.rows[0]?.[0], 620, "rejected statements must not mutate the fixture");

    if (coreOnly) {
        record("sqlite", "extended explorer", "SKIP", "--core-only omitted list/introspect while backend integration was in progress");
        record("sqlite", "isolated service", "PASS", "test/schema/query, truncation, invalid file, and mutation rejection");
    } else {
        const databases = await service.listDatabases(conn);
        assert.equal(databases.error, undefined);
        assert.ok(databases.databases.length >= 1);
        assert.ok(databases.databases.some((database) => database.default));

        const introspected = await service.introspect(conn, { name: "samples", kind: "table" });
        assert.equal(introspected.error, undefined);
        assert.ok(introspected.introspection);
        assert.ok(introspected.introspection?.columns.some((column) => column.name === "id" && column.primaryKey));
        assert.ok(introspected.introspection?.indexes.some((index) => index.name === "samples_label_idx"));
        assert.ok((introspected.introspection?.preview?.rows.length ?? 0) <= DB_MAX_ROWS);

        record("sqlite", "isolated service", "PASS", "test/schema/list/introspect/query, truncation, invalid file, and mutation rejection");
    }
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") return reject(new Error("Could not allocate a test port."));
            server.close((error) => error ? reject(error) : resolve(address.port));
        });
    });
}

function openSocket(url: string, token: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, bridgeAuthProtocols(token));
        socket.once("open", () => resolve(socket));
        socket.once("error", reject);
    });
}

function request<T extends Record<string, unknown>>(socket: WebSocket, command: Record<string, unknown>, predicate: (value: T) => boolean): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off("message", onMessage);
            reject(new Error(`Timed out waiting for ${String(command.type)}.`));
        }, 12_000);
        const onMessage = (data: WebSocket.RawData): void => {
            let value: T;
            try {
                value = JSON.parse(data.toString()) as T;
            } catch {
                return;
            }
            if (!predicate(value)) return;
            clearTimeout(timer);
            socket.off("message", onMessage);
            resolve(value);
        };
        socket.on("message", onMessage);
        socket.send(JSON.stringify(command));
    });
}

async function assertBridge(root: string, sqlitePath: string): Promise<void> {
    const dataDir = path.join(root, "bridge-data");
    const conn = connection("sqlite", { database: sqlitePath });
    const config = new ConfigStore(dataDir);
    await config.load();
    await config.update({
        database: { ...config.get().database, connections: [conn] },
        docker: { ...config.get().docker, enabled: false, autoRefresh: false },
        ai: { ...config.get().ai, enabled: false },
        aiProviders: config.get().aiProviders.map((provider) => ({ ...provider, enabled: false })),
    });
    const secret = "bridge-smoke-secret-never-log";
    await config.setSecret("db.bridge-smoke.password", secret);
    const protectedFile = await readFile(path.join(dataDir, "secrets.json"), "utf8");
    assert.equal(protectedFile.includes(secret), false, "database credentials must not be stored as literal plaintext");

    const priorDataDir = process.env.CORETEX_DATA_DIR;
    const priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.CORETEX_DATA_DIR = dataDir;
    // The orchestrator imports the LifeOS Prisma client too. Point it at a closed,
    // isolated port before that module is evaluated so this smoke can never fall
    // through to a developer's normal LifeOS database.
    process.env.DATABASE_URL = "postgresql://coretex_smoke:coretex_smoke@127.0.0.1:1/coretex_smoke";
    const { Orchestrator } = await import("../src/orchestrator.js");
    const port = await freePort();
    const orchestrator = new Orchestrator({ wsPort: port, tickIntervalMs: 60_000 });
    let socket: WebSocket | undefined;
    try {
        await orchestrator.start();
        socket = await openSocket(`ws://127.0.0.1:${port}`, orchestrator.getBridgeAuthToken());
        const test = await request<any>(socket, { type: "db:testConnection", connectionId: conn.id, requestId: "test" }, (value) => value.type === "db:testResult" && value.requestId === "test");
        assert.equal(test.ok, true);
        const schema = await request<any>(socket, { type: "db:schema", connectionId: conn.id, requestId: "schema" }, (value) => value.type === "db:schema" && value.requestId === "schema");
        assert.ok(schema.tables.some((table: { name: string }) => table.name === "samples"));
        const databases = await request<any>(socket, { type: "db:listDatabases", connectionId: conn.id, requestId: "databases" }, (value) => value.type === "db:databases" && value.requestId === "databases");
        assert.ok(databases.databases.length >= 1);
        const introspection = await request<any>(
            socket,
            { type: "db:introspect", connectionId: conn.id, target: { name: "samples", kind: "table" }, requestId: "introspection" },
            (value) => value.type === "db:introspection" && value.requestId === "introspection",
        );
        assert.ok(introspection.introspection?.columns.some((column: { name: string }) => column.name === "id"));
        const query = await request<any>(socket, { type: "db:query", connectionId: conn.id, sql: "SELECT id FROM samples ORDER BY id", requestId: "query" }, (value) => value.type === "db:result" && value.requestId === "query");
        assert.equal(query.rowCount, DB_MAX_ROWS);
        assert.equal(query.truncated, true);
        const rejected = await request<any>(socket, { type: "db:query", connectionId: conn.id, sql: "SELECT 1; DROP TABLE samples", requestId: "rejected" }, (value) => value.type === "db:result" && value.requestId === "rejected");
        assert.ok(rejected.error);
        const malformedQuery = await request<any>(socket, { type: "db:query", connectionId: conn.id, sql: null, requestId: "malformed-query" }, (value) => value.type === "db:result" && value.requestId === "malformed-query");
        assert.ok(malformedQuery.error);
        const malformedTarget = await request<any>(socket, { type: "db:introspect", connectionId: conn.id, target: null, requestId: "malformed-target" }, (value) => value.type === "db:introspection" && value.requestId === "malformed-target");
        assert.ok(malformedTarget.error);
        const recovered = await request<any>(socket, { type: "db:query", connectionId: conn.id, sql: "SELECT COUNT(*) AS count FROM samples", requestId: "recovered" }, (value) => value.type === "db:result" && value.requestId === "recovered");
        assert.equal(recovered.rows[0]?.[0], 620, "malformed IPC input must not crash or mutate the Brain");
        record("sqlite", "WebSocket IPC", "PASS", "request correlation and test/schema/list/introspect/query events");
        record("shared", "credential persistence", "PASS", "database password absent from literal on-disk payload");
    } finally {
        socket?.close();
        orchestrator.stop();
        if (priorDataDir === undefined) delete process.env.CORETEX_DATA_DIR;
        else process.env.CORETEX_DATA_DIR = priorDataDir;
        if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = priorDatabaseUrl;
    }
}

interface LiveFixture {
    engine: Exclude<Engine, "sqlite">;
    env: string;
    composeUrl: string;
    query: string;
}

const liveFixtures: LiveFixture[] = [
    { engine: "postgres", env: "CORETEX_DATABASE_SMOKE_POSTGRES_URL", composeUrl: "postgresql://coretex:coretex-smoke@127.0.0.1:55432/coretex_smoke", query: "SELECT 1 AS coretex_smoke" },
    { engine: "mysql", env: "CORETEX_DATABASE_SMOKE_MYSQL_URL", composeUrl: "mysql://coretex:coretex-smoke@127.0.0.1:53306/coretex_smoke", query: "SELECT 1 AS coretex_smoke" },
    { engine: "mariadb", env: "CORETEX_DATABASE_SMOKE_MARIADB_URL", composeUrl: "mariadb://coretex:coretex-smoke@127.0.0.1:53307/coretex_smoke", query: "SELECT 1 AS coretex_smoke" },
    { engine: "mongo", env: "CORETEX_DATABASE_SMOKE_MONGO_URL", composeUrl: "mongodb://coretex:coretex-smoke@127.0.0.1:57017/coretex_smoke", query: JSON.stringify({ collection: "samples", sort: { id: 1 }, limit: 10 }) },
    { engine: "redis", env: "CORETEX_DATABASE_SMOKE_REDIS_URL", composeUrl: "redis://:coretex-smoke@127.0.0.1:56379/0", query: "GET smoke:string" },
];

function fromUrl(engine: LiveFixture["engine"], raw: string): { conn: DbConnection; password?: string } {
    const url = new URL(raw);
    if (engine === "mongo" && url.protocol === "mongodb+srv:") throw new Error("The smoke harness currently expects a direct mongodb:// fixture URL.");
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || (engine === "redis" ? "0" : "coretex_smoke");
    const password = url.password ? decodeURIComponent(url.password) : undefined;
    const secureProtocol = url.protocol === "rediss:";
    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
    const ssl = secureProtocol || url.searchParams.get("tls") === "true" || sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full";
    return {
        conn: connection(engine, {
            host: url.hostname,
            port: url.port ? Number(url.port) : undefined,
            database,
            user: url.username ? decodeURIComponent(url.username) : undefined,
            passwordConfigured: Boolean(password),
            ssl,
        }),
        ...(password ? { password } : {}),
    };
}

async function assertLiveFixtures(useCompose: boolean, requireLive: boolean): Promise<void> {
    const service = new DatabaseService();
    const failures: Error[] = [];
    for (const fixture of liveFixtures) {
        const raw = process.env[fixture.env] || (useCompose ? fixture.composeUrl : undefined);
        if (!raw) {
            record(fixture.engine, "live server fixture", "SKIP", `${fixture.env} not set`);
            if (requireLive) failures.push(new Error(`${fixture.env} is required.`));
            continue;
        }
        try {
            const { conn, password } = fromUrl(fixture.engine, raw);
            assert.equal(validateConnection(conn), null);
            const test = await service.test(conn, password);
            assert.equal(test.ok, true, test.error);
            const databases = await service.listDatabases(conn, password);
            assert.equal(databases.error, undefined);
            assert.ok(databases.databases.length >= 1);
            const schema = await service.schema(conn, password);
            assert.equal(schema.error, undefined);
            assert.ok(schema.tables.length >= 1, `${fixture.engine} fixture should expose at least one item`);
            const target: DbIntrospectionTarget = {
                name: schema.tables[0]!.name,
                kind: schema.tables[0]!.kind,
                ...(schema.tables[0]!.schema ? { schema: schema.tables[0]!.schema } : {}),
            };
            const introspection = await service.introspect(conn, target, password);
            assert.equal(introspection.error, undefined);
            assert.ok(introspection.introspection);
            const query = await service.query(conn, fixture.query, password);
            assert.equal(query.error, undefined);
            assert.ok(query.rows.length >= 1);
            assert.ok(query.rows.length <= DB_MAX_ROWS);
            record(fixture.engine, "live server fixture", "PASS", "test/list/schema/introspect/bounded query");
        } catch (error) {
            failures.push(new Error(`${fixture.engine}: ${error instanceof Error ? error.message : String(error)}`));
        }
    }
    if (failures.length > 0) throw new AggregateError(failures, "One or more live database fixtures failed.");
}

const root = await mkdtemp(path.join(os.tmpdir(), "coretex-database-smoke-"));
try {
    const fixture = await makeSqliteFixture(root);
    const coreOnly = process.argv.includes("--core-only");
    assertPureGuards(fixture.path);
    await assertDriverAvailability();
    await assertRedisTransport();
    await assertSqliteService(fixture.path, fixture.invalidPath, coreOnly);
    if (!coreOnly && !process.argv.includes("--skip-bridge")) await assertBridge(root, fixture.path);
    const useCompose = process.argv.includes("--compose-fixture");
    await assertLiveFixtures(useCompose, useCompose || process.argv.includes("--require-live"));
    console.table(outcomes);
    console.log("Database acceptance smoke passed without touching user connection data.");
} catch (error) {
    console.table(outcomes);
    throw error;
} finally {
    await rm(root, { recursive: true, force: true });
}
