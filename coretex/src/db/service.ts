// Coretex database browser backend. All user-issued operations are read-only,
// bounded, timed out, normalized for IPC, and lazily load optional drivers.
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import type { DbConnection } from "../config/schema.js";
import type {
    DbDatabaseInfo,
    DbIntrospection,
    DbIntrospectionTarget,
    DbSchemaColumn,
    DbSchemaIndex,
    DbSchemaTable,
} from "../types.js";
import { RedisClient, type RedisValue } from "./redis-client.js";
import {
    DB_MAX_CELL_BYTES,
    DB_MAX_QUERY_CHARS,
    DB_MAX_RESULT_BYTES,
    DB_MAX_ROWS,
    DB_MAX_SCHEMA_ITEMS,
    DB_QUERY_TIMEOUT_MS,
    parseMongoReadSpec,
    parseRedisReadOnlyCommand,
    sanitizeDatabaseError,
    validateConnection,
    validateReadOnlySql,
} from "./query-safety.js";

export interface QueryResult {
    columns: string[];
    rows: unknown[][];
    elapsedMs: number;
    truncated?: boolean;
    error?: string;
}
export interface SchemaResult { tables: DbSchemaTable[]; error?: string }
export interface TestResult { ok: boolean; error?: string }
export interface DatabaseListResult { databases: DbDatabaseInfo[]; error?: string }
export interface IntrospectionResult { introspection?: DbIntrospection; error?: string }

const MAX_SQLITE_BYTES = 256 * 1024 * 1024;

function expandHome(value: string): string {
    if (!value.startsWith("~")) return path.resolve(value);
    return path.join(process.env["USERPROFILE"] || process.env["HOME"] || "", value.slice(1));
}

function quoteSqliteOrPg(identifier: string): string {
    return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function quoteMysql(identifier: string): string {
    return `\`${identifier.replace(/`/g, "``")}\``;
}

function withoutTrailingSemicolon(sql: string): string {
    return sql.trim().replace(/;\s*$/, "");
}

function boundedSql(sql: string): string {
    const bare = withoutTrailingSemicolon(sql);
    const first = /^\s*([A-Za-z]+)/.exec(bare)?.[1]?.toUpperCase();
    return first && ["SELECT", "WITH", "VALUES", "TABLE"].includes(first)
        ? `SELECT * FROM (${bare}) AS coretex_readonly_preview LIMIT ${DB_MAX_ROWS + 1}`
        : bare;
}

function truncateUtf8(value: string, maxBytes = DB_MAX_CELL_BYTES): { value: string; truncated: boolean } {
    const encoded = Buffer.from(value, "utf8");
    if (encoded.length <= maxBytes) return { value, truncated: false };
    return { value: `${encoded.subarray(0, maxBytes).toString("utf8")}…`, truncated: true };
}

function normalizeCell(value: unknown): { value: unknown; truncated: boolean } {
    if (value === null || value === undefined || typeof value === "boolean") return { value: value ?? null, truncated: false };
    if (typeof value === "number") return { value: Number.isFinite(value) ? value : String(value), truncated: false };
    if (typeof value === "bigint") return { value: value.toString(), truncated: false };
    if (typeof value === "string") return truncateUtf8(value);
    if (value instanceof Date) return { value: value.toISOString(), truncated: false };
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        const bytes = Buffer.from(value);
        return { value: `<binary · ${bytes.length} bytes>`, truncated: bytes.length > DB_MAX_CELL_BYTES };
    }
    try {
        const json = JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item);
        return truncateUtf8(json ?? String(value));
    } catch {
        return truncateUtf8(String(value));
    }
}

function tabular(columns: string[], sourceRows: unknown[][], start: number): QueryResult {
    const rows: unknown[][] = [];
    let bytes = Buffer.byteLength(JSON.stringify(columns), "utf8");
    let truncated = sourceRows.length > DB_MAX_ROWS;
    for (const source of sourceRows.slice(0, DB_MAX_ROWS)) {
        const row: unknown[] = [];
        let rowBytes = 0;
        for (const cell of source) {
            const normalized = normalizeCell(cell);
            if (normalized.truncated) truncated = true;
            row.push(normalized.value);
            rowBytes += Buffer.byteLength(JSON.stringify(normalized.value) ?? "null", "utf8");
        }
        if (bytes + rowBytes > DB_MAX_RESULT_BYTES) {
            truncated = true;
            break;
        }
        bytes += rowBytes;
        rows.push(row);
    }
    return { columns, rows, elapsedMs: Date.now() - start, ...(truncated ? { truncated: true } : {}) };
}

function emptyQuery(start: number, error: string): QueryResult {
    return { columns: [], rows: [], elapsedMs: Date.now() - start, error };
}

function mongoUri(conn: DbConnection, password?: string): string {
    const host = conn.host?.trim() || "127.0.0.1";
    const port = conn.port ?? 27017;
    const database = conn.database?.trim() || "test";
    const user = conn.user?.trim();
    const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(password ?? "")}@` : "";
    const params = new URLSearchParams();
    if (conn.ssl) params.set("tls", "true");
    if (user) params.set("authSource", database);
    return `mongodb://${auth}${host}:${port}/${encodeURIComponent(database)}${params.size ? `?${params}` : ""}`;
}

function mongoType(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (value instanceof Date) return "date";
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return "binary";
    return typeof value;
}

function redisArray(value: RedisValue): RedisValue[] {
    return Array.isArray(value) ? value : [];
}

function redisTabular(command: string, args: string[], value: RedisValue, start: number): QueryResult {
    const array = redisArray(value);
    if (command === "INFO") {
        const rows = String(value ?? "").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
            const split = line.indexOf(":");
            return split < 0 ? [line, ""] : [line.slice(0, split), line.slice(split + 1)];
        });
        return tabular(["property", "value"], rows, start);
    }
    if (["SCAN", "HSCAN", "SSCAN", "ZSCAN"].includes(command) && array.length === 2) {
        const cursor = String(array[0] ?? "0");
        const items = redisArray(array[1]);
        if (command === "HSCAN" || command === "ZSCAN") {
            const rows: unknown[][] = [];
            for (let i = 0; i < items.length; i += 2) rows.push([items[i], items[i + 1], cursor]);
            return tabular([command === "HSCAN" ? "field" : "member", command === "HSCAN" ? "value" : "score", "nextCursor"], rows, start);
        }
        return tabular([command === "SCAN" ? "key" : "member", "nextCursor"], items.map((item) => [item, cursor]), start);
    }
    if (command === "MGET") return tabular(["key", "value"], args.map((key, index) => [key, array[index]]), start);
    if (command === "HMGET") return tabular(["field", "value"], args.slice(1).map((field, index) => [field, array[index]]), start);
    if ((command === "ZRANGE" || command === "ZREVRANGE") && args.at(-1)?.toUpperCase() === "WITHSCORES") {
        const rows: unknown[][] = [];
        for (let i = 0; i < array.length; i += 2) rows.push([array[i], array[i + 1]]);
        return tabular(["member", "score"], rows, start);
    }
    if (command === "XRANGE" || command === "XREVRANGE") {
        return tabular(["id", "fields"], array.map((entry) => {
            const pair = redisArray(entry);
            return [pair[0], JSON.stringify(pair[1] ?? [])];
        }), start);
    }
    if (Array.isArray(value)) return tabular(["index", "value"], value.map((item, index) => [index, item]), start);
    return tabular(["result"], [[value]], start);
}

export class DatabaseService {
    private sqlitePromise: Promise<SqlJsStatic> | null = null;

    private ensureSqlite(): Promise<SqlJsStatic> {
        if (!this.sqlitePromise) {
            const require = createRequire(import.meta.url);
            const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
            this.sqlitePromise = initSqlJs({ locateFile: () => wasmPath });
        }
        return this.sqlitePromise;
    }

    private async sqliteFile(conn: DbConnection): Promise<{ filePath: string; bytes: Uint8Array }> {
        const filePath = expandHome(conn.database!.trim());
        await access(filePath);
        const info = await stat(filePath);
        if (!info.isFile()) throw new Error("The SQLite path is not a file.");
        if (info.size > MAX_SQLITE_BYTES) throw new Error("SQLite files larger than 256 MB are not supported by the in-memory viewer.");
        return { filePath, bytes: new Uint8Array(await readFile(filePath)) };
    }

    private async pgConnect(conn: DbConnection, password?: string): Promise<any> {
        const pg: any = await import("pg").catch(() => null);
        if (!pg) return null;
        const Client = pg.Client ?? pg.default?.Client;
        const client = new Client({
            host: conn.host,
            port: conn.port ?? 5432,
            database: conn.database,
            user: conn.user,
            password,
            connectionTimeoutMillis: DB_QUERY_TIMEOUT_MS,
            query_timeout: DB_QUERY_TIMEOUT_MS,
            statement_timeout: DB_QUERY_TIMEOUT_MS,
            application_name: "coretex-readonly-viewer",
            ...(conn.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
        });
        await client.connect();
        return client;
    }

    private async mysqlConnect(conn: DbConnection, password?: string): Promise<any> {
        const mysql: any = await import("mysql2/promise").catch(() => null);
        if (!mysql) return null;
        return mysql.createConnection({
            host: conn.host,
            port: conn.port ?? 3306,
            database: conn.database,
            user: conn.user,
            password,
            connectTimeout: DB_QUERY_TIMEOUT_MS,
            multipleStatements: false,
            ...(conn.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
        });
    }

    private async mongoConnect(conn: DbConnection, password?: string): Promise<any> {
        const mongo: any = await import("mongodb").catch(() => null);
        if (!mongo) return null;
        const client = new mongo.MongoClient(mongoUri(conn, password), {
            serverSelectionTimeoutMS: DB_QUERY_TIMEOUT_MS,
            connectTimeoutMS: DB_QUERY_TIMEOUT_MS,
            socketTimeoutMS: DB_QUERY_TIMEOUT_MS,
            maxPoolSize: 1,
            retryWrites: false,
        });
        await client.connect();
        return client;
    }

    async query(conn: DbConnection | undefined, input: unknown, password?: string): Promise<QueryResult> {
        const start = Date.now();
        const invalid = validateConnection(conn);
        if (invalid || !conn) return emptyQuery(start, invalid ?? "Connection not found.");
        if (typeof input !== "string") return emptyQuery(start, "Query must be text.");
        if (input.length > DB_MAX_QUERY_CHARS) return emptyQuery(start, "Query is too large for the read-only viewer.");
        try {
            switch (conn.engine) {
                case "sqlite": return await this.querySqlite(conn, input, start);
                case "postgres": return await this.queryPostgres(conn, input, password, start);
                case "mysql":
                case "mariadb": return await this.queryMysql(conn, input, password, start);
                case "mongo": return await this.queryMongo(conn, input, password, start);
                case "redis": return await this.queryRedis(conn, input, password, start);
            }
        } catch (error) {
            return emptyQuery(start, sanitizeDatabaseError(error, conn, password));
        }
    }

    private async querySqlite(conn: DbConnection, sql: string, start: number): Promise<QueryResult> {
        const gate = validateReadOnlySql(sql);
        if (gate) return emptyQuery(start, gate);
        const SQL = await this.ensureSqlite();
        const { bytes } = await this.sqliteFile(conn);
        const db = new SQL.Database(bytes);
        try {
            const results = db.exec(boundedSql(sql));
            if (!results.length) return tabular([], [], start);
            const last = results.at(-1)!;
            return tabular(last.columns, last.values as unknown[][], start);
        } finally {
            db.close();
        }
    }

    private async queryPostgres(conn: DbConnection, sql: string, password: string | undefined, start: number): Promise<QueryResult> {
        const gate = validateReadOnlySql(sql);
        if (gate) return emptyQuery(start, gate);
        const client = await this.pgConnect(conn, password);
        if (!client) return emptyQuery(start, "PostgreSQL driver is not installed.");
        try {
            await client.query("BEGIN READ ONLY");
            await client.query(`SET LOCAL statement_timeout = '${DB_QUERY_TIMEOUT_MS}ms'`);
            const result = await client.query(boundedSql(sql));
            const columns = (result.fields ?? []).map((field: { name: string }) => field.name);
            const rows = (result.rows ?? []).map((row: Record<string, unknown>) => columns.map((column: string) => row[column]));
            return tabular(columns, rows, start);
        } finally {
            await client.query("ROLLBACK").catch(() => undefined);
            await client.end().catch(() => undefined);
        }
    }

    private async queryMysql(conn: DbConnection, sql: string, password: string | undefined, start: number): Promise<QueryResult> {
        const gate = validateReadOnlySql(sql);
        if (gate) return emptyQuery(start, gate);
        const client = await this.mysqlConnect(conn, password);
        if (!client) return emptyQuery(start, "MySQL/MariaDB driver is not installed.");
        try {
            await client.query("START TRANSACTION READ ONLY");
            const [rawRows, fields] = await client.query({ sql: boundedSql(sql), timeout: DB_QUERY_TIMEOUT_MS });
            const dataRows = Array.isArray(rawRows) ? rawRows as Record<string, unknown>[] : [];
            const columns = Array.isArray(fields) ? fields.map((field: { name: string }) => field.name) : (dataRows[0] ? Object.keys(dataRows[0]) : []);
            return tabular(columns, dataRows.map((row) => columns.map((column: string) => row[column])), start);
        } finally {
            await client.query("ROLLBACK").catch(() => undefined);
            await client.end().catch(() => undefined);
        }
    }

    private async queryMongo(conn: DbConnection, input: string, password: string | undefined, start: number): Promise<QueryResult> {
        const parsed = parseMongoReadSpec(input);
        if (!parsed.ok) return emptyQuery(start, parsed.error);
        const client = await this.mongoConnect(conn, password);
        if (!client) return emptyQuery(start, "MongoDB driver is not installed.");
        try {
            const spec = parsed.value;
            const docs = await client.db(conn.database).collection(spec.collection).find(spec.filter, {
                ...(spec.projection ? { projection: spec.projection } : {}),
                ...(spec.sort ? { sort: spec.sort } : {}),
                limit: spec.limit + 1,
                maxTimeMS: DB_QUERY_TIMEOUT_MS,
            }).toArray();
            const columns = [...new Set<string>(docs.flatMap((doc: Record<string, unknown>) => Object.keys(doc)))];
            const rows = docs.map((doc: Record<string, unknown>) => columns.map((column) => doc[column]));
            return tabular(columns, rows, start);
        } finally {
            await client.close().catch(() => undefined);
        }
    }

    private async queryRedis(conn: DbConnection, input: string, password: string | undefined, start: number): Promise<QueryResult> {
        const parsed = parseRedisReadOnlyCommand(input);
        if (!parsed.ok) return emptyQuery(start, parsed.error);
        const client = await RedisClient.connect(conn, password);
        try {
            const { command, args } = parsed.value;
            const wireCommand = command === "GET" ? ["GETRANGE", args[0]!, "0", String(DB_MAX_CELL_BYTES - 1)] : [command, ...args];
            if (["SCAN", "HSCAN", "SSCAN", "ZSCAN"].includes(command) && !args.some((arg) => arg.toUpperCase() === "COUNT")) {
                wireCommand.push("COUNT", String(DB_MAX_ROWS));
            }
            const result = await client.command(wireCommand);
            return redisTabular(command, args, result, start);
        } finally {
            client.close();
        }
    }

    async schema(conn: DbConnection | undefined, password?: string): Promise<SchemaResult> {
        const invalid = validateConnection(conn);
        if (invalid || !conn) return { tables: [], error: invalid ?? "Connection not found." };
        try {
            switch (conn.engine) {
                case "sqlite": return await this.schemaSqlite(conn);
                case "postgres": return await this.schemaPostgres(conn, password);
                case "mysql":
                case "mariadb": return await this.schemaMysql(conn, password);
                case "mongo": return await this.schemaMongo(conn, password);
                case "redis": return await this.schemaRedis(conn, password);
            }
        } catch (error) {
            return { tables: [], error: sanitizeDatabaseError(error, conn, password) };
        }
    }

    private async schemaSqlite(conn: DbConnection): Promise<SchemaResult> {
        const SQL = await this.ensureSqlite();
        const { bytes } = await this.sqliteFile(conn);
        const db = new SQL.Database(bytes);
        try {
            const result = db.exec("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 250");
            const raw = result[0]?.values ?? [];
            const tables: DbSchemaTable[] = raw.map((entry) => {
                const name = String(entry[0]);
                const info = db.exec(`PRAGMA table_info(${JSON.stringify(name)})`)[0]?.values ?? [];
                const columns: DbSchemaColumn[] = info.map((row) => ({
                    name: String(row[1]), type: String(row[2] ?? ""), nullable: Number(row[3]) === 0,
                    ...(row[4] !== null ? { defaultValue: String(row[4]) } : {}), ...(Number(row[5]) > 0 ? { primaryKey: true } : {}),
                }));
                return { name, kind: String(entry[1]) === "view" ? "view" : "table", columns };
            });
            return { tables };
        } finally { db.close(); }
    }

    private async schemaPostgres(conn: DbConnection, password?: string): Promise<SchemaResult> {
        const client = await this.pgConnect(conn, password);
        if (!client) return { tables: [], error: "PostgreSQL driver is not installed." };
        try {
            await client.query("BEGIN READ ONLY");
            const tableResult = await client.query(`SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name LIMIT ${DB_MAX_SCHEMA_ITEMS}`);
            const columnResult = await client.query(`SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name, ordinal_position LIMIT ${DB_MAX_SCHEMA_ITEMS * 100}`);
            const columns = new Map<string, DbSchemaColumn[]>();
            for (const row of columnResult.rows ?? []) {
                const key = `${row.table_schema}.${row.table_name}`;
                const list = columns.get(key) ?? [];
                list.push({ name: String(row.column_name), type: String(row.data_type), nullable: row.is_nullable === "YES", ...(row.column_default !== null ? { defaultValue: String(row.column_default) } : {}) });
                columns.set(key, list);
            }
            return { tables: (tableResult.rows ?? []).map((row: Record<string, unknown>) => {
                const schema = String(row.table_schema); const table = String(row.table_name);
                return { name: schema === "public" ? table : `${schema}.${table}`, schema, kind: String(row.table_type).includes("VIEW") ? "view" : "table", columns: columns.get(`${schema}.${table}`) } as DbSchemaTable;
            }) };
        } finally {
            await client.query("ROLLBACK").catch(() => undefined); await client.end().catch(() => undefined);
        }
    }

    private async schemaMysql(conn: DbConnection, password?: string): Promise<SchemaResult> {
        const client = await this.mysqlConnect(conn, password);
        if (!client) return { tables: [], error: "MySQL/MariaDB driver is not installed." };
        try {
            await client.query("START TRANSACTION READ ONLY");
            const [tableRows] = await client.query({ sql: "SHOW FULL TABLES", timeout: DB_QUERY_TIMEOUT_MS });
            const [columnRows] = await client.query({ sql: `SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME,ORDINAL_POSITION LIMIT ${DB_MAX_SCHEMA_ITEMS * 100}`, values: [conn.database], timeout: DB_QUERY_TIMEOUT_MS });
            const columns = new Map<string, DbSchemaColumn[]>();
            for (const row of columnRows as Record<string, unknown>[]) {
                const table = String(row.TABLE_NAME); const list = columns.get(table) ?? [];
                list.push({ name: String(row.COLUMN_NAME), type: String(row.DATA_TYPE), nullable: row.IS_NULLABLE === "YES", ...(row.COLUMN_DEFAULT !== null ? { defaultValue: String(row.COLUMN_DEFAULT) } : {}), ...(row.COLUMN_KEY === "PRI" ? { primaryKey: true } : {}) });
                columns.set(table, list);
            }
            return { tables: (tableRows as Record<string, unknown>[]).slice(0, DB_MAX_SCHEMA_ITEMS).map((row) => {
                const keys = Object.keys(row); const name = String(row[keys[0]!]);
                return { name, kind: String(row[keys[1]!] ?? "").toUpperCase().includes("VIEW") ? "view" : "table", columns: columns.get(name) } as DbSchemaTable;
            }) };
        } finally { await client.query("ROLLBACK").catch(() => undefined); await client.end().catch(() => undefined); }
    }

    private async schemaMongo(conn: DbConnection, password?: string): Promise<SchemaResult> {
        const client = await this.mongoConnect(conn, password);
        if (!client) return { tables: [], error: "MongoDB driver is not installed." };
        try {
            const collections = await client.db(conn.database).listCollections({}, { nameOnly: true }).toArray();
            const tables: DbSchemaTable[] = [];
            for (const [index, collection] of collections.slice(0, DB_MAX_SCHEMA_ITEMS).entries()) {
                const name = String(collection.name);
                // Sample a bounded subset; listing a database with hundreds of
                // collections must not trigger hundreds of sequential server reads.
                const sample = index < 50 ? await client.db(conn.database).collection(name).findOne({}, { maxTimeMS: DB_QUERY_TIMEOUT_MS }) : null;
                tables.push({ name, kind: "collection", columns: sample ? Object.entries(sample as Record<string, unknown>).map(([field, value]) => ({ name: field, type: mongoType(value) })) : [], ...(index >= 50 ? { metadata: { sampled: false } } : {}) });
            }
            return { tables };
        } finally { await client.close().catch(() => undefined); }
    }

    private async schemaRedis(conn: DbConnection, password?: string): Promise<SchemaResult> {
        const client = await RedisClient.connect(conn, password);
        try {
            const keys: string[] = []; let cursor = "0";
            do {
                const reply = redisArray(await client.command(["SCAN", cursor, "COUNT", String(Math.min(DB_MAX_SCHEMA_ITEMS - keys.length, 100))]));
                cursor = String(reply[0] ?? "0");
                for (const key of redisArray(reply[1])) if (typeof key === "string") keys.push(key);
            } while (cursor !== "0" && keys.length < DB_MAX_SCHEMA_ITEMS);
            const metadata = await Promise.all(keys.slice(0, DB_MAX_SCHEMA_ITEMS).map(async (key) => {
                const [type, ttl] = await Promise.all([client.command(["TYPE", key]), client.command(["TTL", key])]);
                return { name: key, kind: "key" as const, schema: `db ${conn.database?.trim() || "0"}`, metadata: { dataType: String(type ?? "unknown"), ttlSeconds: typeof ttl === "number" ? ttl : -2 } };
            }));
            return { tables: metadata };
        } finally { client.close(); }
    }

    async listDatabases(conn: DbConnection | undefined, password?: string): Promise<DatabaseListResult> {
        const invalid = validateConnection(conn);
        if (invalid || !conn) return { databases: [], error: invalid ?? "Connection not found." };
        try {
            if (conn.engine === "sqlite") {
                const { filePath } = await this.sqliteFile(conn); const info = await stat(filePath);
                return { databases: [{ name: path.basename(filePath), default: true, sizeBytes: info.size, metadata: { path: filePath } }] };
            }
            if (conn.engine === "postgres") {
                const client = await this.pgConnect(conn, password); if (!client) return { databases: [], error: "PostgreSQL driver is not installed." };
                try { await client.query("BEGIN READ ONLY"); const r = await client.query("SELECT datname, datname=current_database() AS current FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname"); return { databases: r.rows.map((row: Record<string, unknown>) => ({ name: String(row.datname), default: row.current === true, system: ["postgres"].includes(String(row.datname)) })) }; }
                finally { await client.query("ROLLBACK").catch(() => undefined); await client.end().catch(() => undefined); }
            }
            if (conn.engine === "mysql" || conn.engine === "mariadb") {
                const client = await this.mysqlConnect(conn, password); if (!client) return { databases: [], error: "MySQL/MariaDB driver is not installed." };
                try { const [rows] = await client.query({ sql: "SHOW DATABASES", timeout: DB_QUERY_TIMEOUT_MS }); return { databases: (rows as Record<string, unknown>[]).map((row) => { const name = String(Object.values(row)[0]); return { name, default: name === conn.database, system: ["information_schema", "mysql", "performance_schema", "sys"].includes(name) }; }) }; }
                finally { await client.end().catch(() => undefined); }
            }
            if (conn.engine === "mongo") {
                const client = await this.mongoConnect(conn, password); if (!client) return { databases: [], error: "MongoDB driver is not installed." };
                try { const result = await client.db(conn.database).admin().listDatabases({ nameOnly: false }); return { databases: result.databases.map((db: Record<string, unknown>) => ({ name: String(db.name), default: db.name === conn.database, system: ["admin", "config", "local"].includes(String(db.name)), ...(typeof db.sizeOnDisk === "number" ? { sizeBytes: db.sizeOnDisk } : {}) })) }; }
                finally { await client.close().catch(() => undefined); }
            }
            const client = await RedisClient.connect(conn, password);
            try {
                const info = String(await client.command(["INFO", "keyspace"]) ?? "");
                const databases: DbDatabaseInfo[] = info.split(/\r?\n/).map((line) => /^db(\d+):keys=(\d+)/.exec(line)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => ({ name: match[1]!, default: match[1] === (conn.database?.trim() || "0"), itemCount: Number(match[2]), metadata: { label: `db${match[1]}` } }));
                if (!databases.some((db) => db.default)) databases.unshift({ name: conn.database?.trim() || "0", default: true, itemCount: 0, metadata: { label: `db${conn.database?.trim() || "0"}` } });
                return { databases };
            } finally { client.close(); }
        } catch (error) { return { databases: [], error: sanitizeDatabaseError(error, conn, password) }; }
    }

    private async indexesFor(conn: DbConnection, table: DbSchemaTable, password?: string): Promise<DbSchemaIndex[]> {
        if (table.kind === "view" || table.kind === "key") return [];
        if (conn.engine === "sqlite") {
            const SQL = await this.ensureSqlite(); const { bytes } = await this.sqliteFile(conn); const db = new SQL.Database(bytes);
            try {
                const rows = db.exec(`PRAGMA index_list(${JSON.stringify(table.name)})`)[0]?.values ?? [];
                return rows.slice(0, 100).map((row) => {
                    const name = String(row[1]);
                    const info = db.exec(`PRAGMA index_info(${JSON.stringify(name)})`)[0]?.values ?? [];
                    return { name, columns: info.map((entry) => String(entry[2])), unique: Number(row[2]) === 1, primary: String(row[3]) === "pk", type: String(row[3] ?? "index") };
                });
            } finally { db.close(); }
        }
        if (conn.engine === "postgres") {
            const client = await this.pgConnect(conn, password); if (!client) return [];
            const schema = table.schema || "public"; const name = table.name.includes(".") ? table.name.split(".").at(-1)! : table.name;
            try {
                await client.query("BEGIN READ ONLY");
                const result = await client.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename=$2 ORDER BY indexname LIMIT 100", [schema, name]);
                return (result.rows ?? []).map((row: Record<string, unknown>) => {
                    const definition = String(row.indexdef ?? ""); const matched = /\(([^)]*)\)/.exec(definition);
                    return { name: String(row.indexname), columns: matched ? matched[1]!.split(",").map((column) => column.trim().replace(/^"|"$/g, "")) : [], unique: /CREATE UNIQUE INDEX/i.test(definition), primary: String(row.indexname).endsWith("_pkey"), type: "btree" };
                });
            } finally { await client.query("ROLLBACK").catch(() => undefined); await client.end().catch(() => undefined); }
        }
        if (conn.engine === "mysql" || conn.engine === "mariadb") {
            const client = await this.mysqlConnect(conn, password); if (!client) return [];
            try {
                const [rows] = await client.query({ sql: `SHOW INDEX FROM ${quoteMysql(table.name)}`, timeout: DB_QUERY_TIMEOUT_MS });
                const groups = new Map<string, DbSchemaIndex>();
                for (const row of rows as Record<string, unknown>[]) {
                    const name = String(row.Key_name); const entry = groups.get(name) ?? { name, columns: [], unique: Number(row.Non_unique) === 0, primary: name === "PRIMARY", type: String(row.Index_type ?? "") };
                    entry.columns.push(String(row.Column_name)); groups.set(name, entry);
                }
                return [...groups.values()].slice(0, 100);
            } finally { await client.end().catch(() => undefined); }
        }
        if (conn.engine === "mongo") {
            const client = await this.mongoConnect(conn, password); if (!client) return [];
            try {
                const indexes = await client.db(conn.database).collection(table.name).listIndexes({ maxTimeMS: DB_QUERY_TIMEOUT_MS }).toArray();
                return indexes.slice(0, 100).map((index: Record<string, unknown>) => ({ name: String(index.name), columns: Object.keys((index.key ?? {}) as Record<string, unknown>), unique: index.unique === true, primary: index.name === "_id_", type: "index" }));
            } catch { return []; }
            finally { await client.close().catch(() => undefined); }
        }
        return [];
    }

    async introspect(conn: DbConnection | undefined, target: unknown, password?: string): Promise<IntrospectionResult> {
        const invalid = validateConnection(conn);
        if (invalid || !conn) return { error: invalid ?? "Connection not found." };
        if (!target || typeof target !== "object" || typeof (target as { name?: unknown }).name !== "string" || !(target as { name: string }).name.trim()) {
            return { error: "Choose a schema item to inspect." };
        }
        const safeTarget = target as DbIntrospectionTarget;
        try {
            const schema = await this.schema(conn, password);
            if (schema.error) return { error: schema.error };
            const table = schema.tables.find((item) => item.name === safeTarget.name && (!safeTarget.schema || item.schema === safeTarget.schema));
            if (!table) return { error: "The selected schema item no longer exists." };
            let previewInput: string;
            if (conn.engine === "sqlite") previewInput = `SELECT * FROM ${quoteSqliteOrPg(table.name)}`;
            else if (conn.engine === "postgres") previewInput = `SELECT * FROM ${quoteSqliteOrPg(table.schema || "public")}.${quoteSqliteOrPg(table.name.includes(".") ? table.name.split(".").at(-1)! : table.name)}`;
            else if (conn.engine === "mysql" || conn.engine === "mariadb") previewInput = `SELECT * FROM ${quoteMysql(table.name)}`;
            else if (conn.engine === "mongo") previewInput = JSON.stringify({ collection: table.name, limit: 100 });
            else {
                const type = String(table.metadata?.dataType ?? ""); const key = JSON.stringify(table.name);
                previewInput = type === "string" ? `GET ${key}` : type === "hash" ? `HSCAN ${key} 0 COUNT 100` : type === "list" ? `LRANGE ${key} 0 99` : type === "set" ? `SSCAN ${key} 0 COUNT 100` : type === "zset" ? `ZRANGE ${key} 0 99 WITHSCORES` : type === "stream" ? `XRANGE ${key} - + COUNT 100` : `TYPE ${key}`;
            }
            const preview = await this.query(conn, previewInput, password);
            const indexes = await this.indexesFor(conn, table, password);
            const introspection: DbIntrospection = {
                target: { name: table.name, kind: table.kind, ...(table.schema ? { schema: table.schema } : {}) },
                columns: table.columns ?? [], indexes, ...(table.metadata ? { metadata: table.metadata } : {}),
                ...(!preview.error ? { preview: { columns: preview.columns, rows: preview.rows, rowCount: preview.rows.length, ...(preview.truncated ? { truncated: true } : {}) } } : {}),
            };
            return preview.error ? { introspection, error: preview.error } : { introspection };
        } catch (error) { return { error: sanitizeDatabaseError(error, conn, password) }; }
    }

    async test(conn: DbConnection | undefined, password?: string): Promise<TestResult> {
        const invalid = validateConnection(conn);
        if (invalid || !conn) return { ok: false, error: invalid ?? "Connection not found." };
        try {
            if (conn.engine === "sqlite") { const result = await this.schemaSqlite(conn); return result.error ? { ok: false, error: result.error } : { ok: true }; }
            if (conn.engine === "redis") { const client = await RedisClient.connect(conn, password); try { await client.command(["PING"]); return { ok: true }; } finally { client.close(); } }
            if (conn.engine === "mongo") { const client = await this.mongoConnect(conn, password); if (!client) return { ok: false, error: "MongoDB driver is not installed." }; try { await client.db(conn.database).command({ ping: 1 }, { maxTimeMS: DB_QUERY_TIMEOUT_MS }); return { ok: true }; } finally { await client.close().catch(() => undefined); } }
            if (conn.engine === "postgres") { const client = await this.pgConnect(conn, password); if (!client) return { ok: false, error: "PostgreSQL driver is not installed." }; try { await client.query("BEGIN READ ONLY"); await client.query("SELECT 1"); return { ok: true }; } finally { await client.query("ROLLBACK").catch(() => undefined); await client.end().catch(() => undefined); } }
            const client = await this.mysqlConnect(conn, password); if (!client) return { ok: false, error: "MySQL/MariaDB driver is not installed." };
            try { await client.query("START TRANSACTION READ ONLY"); await client.query({ sql: "SELECT 1", timeout: DB_QUERY_TIMEOUT_MS }); return { ok: true }; } finally { await client.query("ROLLBACK").catch(() => undefined); await client.end().catch(() => undefined); }
        } catch (error) { return { ok: false, error: sanitizeDatabaseError(error, conn, password) }; }
    }
}
