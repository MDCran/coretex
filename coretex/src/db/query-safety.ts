import type { DbConnection } from "../config/schema.js";

export const DB_QUERY_TIMEOUT_MS = 8_000;
export const DB_MAX_ROWS = 500;
export const DB_MAX_SCHEMA_ITEMS = 250;
export const DB_MAX_QUERY_CHARS = 64 * 1024;
export const DB_MAX_CELL_BYTES = 128 * 1024;
export const DB_MAX_RESULT_BYTES = 2 * 1024 * 1024;

const SUPPORTED_ENGINES = new Set(["sqlite", "postgres", "mysql", "mariadb", "mongo", "redis"]);
const SQL_STARTERS = new Set(["SELECT", "WITH", "EXPLAIN", "SHOW", "PRAGMA", "DESC", "DESCRIBE", "TABLE", "VALUES"]);
const SQL_FORBIDDEN = new Set([
    "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "ATTACH", "DETACH", "REPLACE", "TRUNCATE",
    "GRANT", "REVOKE", "MERGE", "CALL", "DO", "COPY", "VACUUM", "ANALYZE", "REINDEX", "CLUSTER",
    "REFRESH", "LOCK", "UNLOCK", "SET", "RESET", "USE", "LOAD", "HANDLER", "INSTALL", "UNINSTALL",
    "OPTIMIZE", "REPAIR", "KILL", "SHUTDOWN", "INTO",
]);
const SQL_DANGEROUS_FUNCTIONS = new Set([
    "PG_TERMINATE_BACKEND", "PG_CANCEL_BACKEND", "PG_RELOAD_CONF", "PG_ROTATE_LOGFILE", "PG_READ_FILE",
    "PG_READ_BINARY_FILE", "PG_LS_DIR", "PG_STAT_FILE", "LO_IMPORT", "LO_EXPORT", "DBLINK_EXEC", "SET_CONFIG",
    "NEXTVAL", "SETVAL", "LOAD_FILE", "GET_LOCK", "RELEASE_LOCK", "SLEEP", "BENCHMARK", "LOAD_EXTENSION",
    "READFILE", "WRITEFILE", "PG_SLEEP", "PG_SLEEP_FOR", "PG_SLEEP_UNTIL", "PG_ADVISORY_LOCK",
    "PG_ADVISORY_LOCK_SHARED", "PG_ADVISORY_XACT_LOCK", "PG_ADVISORY_XACT_LOCK_SHARED", "PG_TRY_ADVISORY_LOCK",
    "PG_TRY_ADVISORY_LOCK_SHARED", "PG_TRY_ADVISORY_XACT_LOCK", "PG_TRY_ADVISORY_XACT_LOCK_SHARED",
]);
const READ_ONLY_PRAGMAS = new Set([
    "DATABASE_LIST", "TABLE_INFO", "TABLE_XINFO", "INDEX_LIST", "INDEX_INFO", "INDEX_XINFO", "FOREIGN_KEY_LIST",
    "COMPILE_OPTIONS", "INTEGRITY_CHECK", "QUICK_CHECK", "SCHEMA_VERSION", "USER_VERSION", "FREELIST_COUNT",
    "PAGE_COUNT", "PAGE_SIZE", "ENCODING", "COLLATION_LIST", "MODULE_LIST", "FUNCTION_LIST", "PRAGMA_LIST",
]);
const ARGUMENT_PRAGMAS = new Set(["TABLE_INFO", "TABLE_XINFO", "INDEX_LIST", "INDEX_INFO", "INDEX_XINFO", "FOREIGN_KEY_LIST"]);

/** Runtime validation for persisted connection records. Returns a user-safe error or null. */
export function validateConnection(conn: DbConnection | undefined): string | null {
    if (!conn) return "Connection not found.";
    if (!SUPPORTED_ENGINES.has(String(conn.engine))) return `Unsupported database engine: ${String(conn.engine)}.`;
    if (conn.engine === "sqlite") {
        return conn.database?.trim() ? null : "Set the SQLite file path.";
    }
    if (!conn.host?.trim()) return "Host is required.";
    if (conn.port !== undefined && (!Number.isInteger(conn.port) || conn.port < 1 || conn.port > 65_535)) {
        return "Port must be between 1 and 65535.";
    }
    if (conn.engine === "redis") {
        const database = conn.database?.trim();
        if (database && (!/^\d+$/.test(database) || Number(database) > 2_147_483_647)) {
            return "Redis database must be a non-negative numeric index.";
        }
        return null;
    }
    if (!conn.database?.trim()) return "Database name is required.";
    if (conn.engine !== "mongo" && !conn.user?.trim()) return "Username is required.";
    return null;
}

interface SqlLexResult {
    tokens: string[];
    hasEquals: boolean;
    error?: string;
}

/**
 * Extract SQL keywords while respecting quoted strings/identifiers. Comments are
 * intentionally rejected instead of normalized so they cannot conceal a second
 * statement or a write keyword in a provider-specific grammar.
 */
function lexSql(sql: string): SqlLexResult {
    const tokens: string[] = [];
    let word = "";
    let quote: "'" | "\"" | "`" | "]" | null = null;
    let hasEquals = false;
    let statementEnded = false;
    const flush = (): void => {
        if (word) tokens.push(word.toUpperCase());
        word = "";
    };

    for (let i = 0; i < sql.length; i += 1) {
        const ch = sql[i]!;
        const next = sql[i + 1];
        if (quote) {
            if (quote === "]") {
                if (ch === "]") quote = null;
                continue;
            }
            if (ch === "\\" && quote !== "\"") {
                i += 1;
                continue;
            }
            if (ch === quote) {
                if (next === quote) {
                    i += 1;
                } else {
                    quote = null;
                }
            }
            continue;
        }
        if ((ch === "-" && next === "-") || (ch === "/" && next === "*") || ch === "#") {
            return { tokens, hasEquals, error: "Read-only queries cannot contain SQL comments." };
        }
        if (ch === "$" && (next === "$" || /[A-Za-z_]/.test(next ?? ""))) {
            const tail = sql.slice(i);
            if (/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(tail)) {
                return { tokens, hasEquals, error: "Dollar-quoted SQL blocks are not supported in the read-only viewer." };
            }
        }
        if (ch === "'" || ch === "\"" || ch === "`") {
            flush();
            quote = ch;
            continue;
        }
        if (ch === "[") {
            flush();
            quote = "]";
            continue;
        }
        if (ch === ";") {
            flush();
            if (statementEnded || sql.slice(i + 1).trim().length > 0) {
                return { tokens, hasEquals, error: "Run one read-only statement at a time." };
            }
            statementEnded = true;
            continue;
        }
        if (statementEnded && !/\s/.test(ch)) {
            return { tokens, hasEquals, error: "Run one read-only statement at a time." };
        }
        if (ch === "=") hasEquals = true;
        if (/[A-Za-z0-9_$]/.test(ch)) {
            word += ch;
        } else {
            flush();
        }
    }
    if (quote) return { tokens, hasEquals, error: "The query contains an unterminated quoted value." };
    flush();
    return { tokens, hasEquals };
}

/** Strict, provider-neutral guard used before any SQL reaches a driver. */
export function validateReadOnlySql(sql: string): string | null {
    const trimmed = sql.trim();
    if (!trimmed) return "Enter a query.";
    if (trimmed.length > DB_MAX_QUERY_CHARS) return "Query is too large for the read-only viewer.";
    const lexed = lexSql(trimmed);
    if (lexed.error) return lexed.error;
    const first = lexed.tokens[0];
    if (!first || !SQL_STARTERS.has(first)) {
        return "Read-only viewer: use SELECT, WITH, EXPLAIN, SHOW, PRAGMA, DESCRIBE, TABLE, or VALUES.";
    }
    const forbidden = lexed.tokens.find((token) => SQL_FORBIDDEN.has(token));
    if (forbidden) return `Read-only viewer: ${forbidden} is not allowed.`;
    const dangerous = lexed.tokens.find((token) => SQL_DANGEROUS_FUNCTIONS.has(token));
    if (dangerous) return `Read-only viewer: ${dangerous.toLowerCase()} is not allowed.`;
    if (lexed.tokens.includes("RECURSIVE")) return "Recursive queries are disabled in the read-only viewer.";
    if (first === "PRAGMA") {
        const pragma = lexed.tokens[1];
        if (!pragma || !READ_ONLY_PRAGMAS.has(pragma) || lexed.hasEquals) {
            return "Only read-only schema and diagnostics PRAGMAs are allowed.";
        }
        if (!ARGUMENT_PRAGMAS.has(pragma) && lexed.tokens.length > 2) {
            return `Read-only viewer: PRAGMA ${pragma.toLowerCase()} cannot be assigned a value.`;
        }
    }
    return null;
}

export interface RedisReadCommand {
    command: string;
    args: string[];
}

export type RedisCommandParseResult = { ok: true; value: RedisReadCommand } | { ok: false; error: string };

const REDIS_READ_COMMANDS = new Set([
    "PING", "DBSIZE", "INFO", "SCAN", "TYPE", "EXISTS", "TTL", "PTTL", "GET", "GETRANGE", "MGET", "STRLEN",
    "HGET", "HMGET", "HEXISTS", "HLEN", "HSCAN", "LINDEX", "LLEN", "LRANGE",
    "SCARD", "SISMEMBER", "SSCAN", "ZCARD", "ZRANGE", "ZREVRANGE", "ZSCORE", "ZRANK", "ZREVRANK",
    "ZSCAN", "XLEN", "XRANGE", "XREVRANGE",
]);
const REDIS_KEYLESS = new Set(["PING", "DBSIZE", "INFO", "SCAN"]);
const REDIS_SCAN_COMMANDS = new Set(["SCAN", "HSCAN", "SSCAN", "ZSCAN"]);
const REDIS_RANGE_COMMANDS = new Set(["LRANGE", "ZRANGE", "ZREVRANGE", "XRANGE", "XREVRANGE"]);

function splitCommandLine(input: string): string[] | null {
    const args: string[] = [];
    let current = "";
    let quote: "'" | "\"" | null = null;
    let escaping = false;
    let started = false;
    for (const ch of input.trim()) {
        if (escaping) {
            current += ch;
            escaping = false;
            started = true;
            continue;
        }
        if (ch === "\\") {
            escaping = true;
            started = true;
            continue;
        }
        if (quote) {
            if (ch === quote) quote = null;
            else current += ch;
            started = true;
            continue;
        }
        if (ch === "'" || ch === "\"") {
            quote = ch;
            started = true;
            continue;
        }
        if (/\s/.test(ch)) {
            if (started) {
                args.push(current);
                current = "";
                started = false;
            }
            continue;
        }
        current += ch;
        started = true;
    }
    if (quote || escaping) return null;
    if (started) args.push(current);
    return args;
}

/** Parse and bound the Redis console's deliberately small read-only command language. */
export function parseRedisReadOnlyCommand(input: string): RedisCommandParseResult {
    if (!input.trim()) return { ok: false, error: "Enter a Redis read command." };
    if (input.length > DB_MAX_QUERY_CHARS) return { ok: false, error: "Command is too large for the read-only viewer." };
    if (/[\r\n;]/.test(input)) return { ok: false, error: "Run one Redis command at a time." };
    const parts = splitCommandLine(input);
    if (!parts || parts.length === 0) return { ok: false, error: "Check the command's quotes and try again." };
    const command = parts[0]!.toUpperCase();
    const args = parts.slice(1);
    if (!REDIS_READ_COMMANDS.has(command)) return { ok: false, error: `${command} is not available in the read-only Redis viewer.` };
    if (!REDIS_KEYLESS.has(command) && args.length === 0) return { ok: false, error: `${command} requires a key.` };
    const exactArity: Record<string, number> = {
        DBSIZE: 0, TYPE: 1, TTL: 1, PTTL: 1, GET: 1, STRLEN: 1, HGET: 2, HEXISTS: 2, HLEN: 1,
        LINDEX: 2, LLEN: 1, SCARD: 1, SISMEMBER: 2, ZCARD: 1, ZSCORE: 2, ZRANK: 2, ZREVRANK: 2, XLEN: 1,
    };
    if (exactArity[command] !== undefined && args.length !== exactArity[command]) {
        return { ok: false, error: `${command} expects ${exactArity[command]} argument${exactArity[command] === 1 ? "" : "s"}.` };
    }
    if (command === "PING" && args.length > 1) return { ok: false, error: "PING accepts at most one message." };
    if ((command === "MGET" || command === "EXISTS") && args.length < 1) return { ok: false, error: `${command} requires at least one key.` };
    if ((command === "MGET" || command === "EXISTS") && args.length > 100) return { ok: false, error: `${command} is limited to 100 keys.` };
    if (command === "HMGET" && (args.length < 2 || args.length > 101)) return { ok: false, error: "HMGET requires a key and up to 100 fields." };
    if (command === "GETRANGE") {
        if (args.length !== 3 || !/^\d+$/.test(args[1]!) || !/^\d+$/.test(args[2]!)) return { ok: false, error: "GETRANGE requires a key and non-negative start/stop offsets." };
        const start = Number(args[1]); const stop = Number(args[2]);
        if (stop < start || stop - start + 1 > DB_MAX_CELL_BYTES) return { ok: false, error: `GETRANGE is limited to ${DB_MAX_CELL_BYTES} bytes.` };
    }
    if (command === "INFO" && args.length > 1) return { ok: false, error: "INFO accepts at most one section." };
    if (command === "INFO" && args[0] && !/^[A-Za-z_]+$/.test(args[0])) return { ok: false, error: "Invalid INFO section." };
    if (REDIS_SCAN_COMMANDS.has(command)) {
        const offset = command === "SCAN" ? 0 : 1;
        const cursor = args[offset];
        if (cursor === undefined || !/^\d+$/.test(cursor)) return { ok: false, error: `${command} requires a numeric cursor.` };
        for (let i = offset + 1; i < args.length; i += 2) {
            const option = args[i]?.toUpperCase();
            const value = args[i + 1];
            if (!value || (option !== "MATCH" && option !== "COUNT")) return { ok: false, error: `${command} only supports MATCH and COUNT options.` };
            if (option === "COUNT" && (!/^\d+$/.test(value) || Number(value) > DB_MAX_ROWS)) {
                return { ok: false, error: `Redis scan COUNT is limited to ${DB_MAX_ROWS}.` };
            }
        }
    }
    if (REDIS_RANGE_COMMANDS.has(command)) {
        if (args.length < 3) return { ok: false, error: `${command} requires a key and range.` };
        if (command === "LRANGE" || command === "ZRANGE" || command === "ZREVRANGE") {
            const expected = command === "LRANGE" ? 3 : (args.length === 4 && args[3]?.toUpperCase() === "WITHSCORES" ? 4 : 3);
            if (args.length !== expected) return { ok: false, error: `${command} has an invalid argument list.` };
            if (!/^\d+$/.test(args[1]!) || !/^\d+$/.test(args[2]!)) {
                return { ok: false, error: `${command} uses non-negative start and stop offsets in this viewer.` };
            }
            const start = Number(args[1]);
            const stop = Number(args[2]);
            if (stop < start || stop - start + 1 > DB_MAX_ROWS) {
                return { ok: false, error: `${command} ranges are limited to ${DB_MAX_ROWS} items.` };
            }
        }
        if ((command === "ZRANGE" || command === "ZREVRANGE") && args.slice(3).some((arg) => arg.toUpperCase() !== "WITHSCORES")) {
            return { ok: false, error: `${command} only supports the optional WITHSCORES flag.` };
        }
        if (command === "XRANGE" || command === "XREVRANGE") {
            if (args.length !== 5 || args[3]?.toUpperCase() !== "COUNT" || !/^\d+$/.test(args[4]!) || Number(args[4]) < 1 || Number(args[4]) > DB_MAX_ROWS) {
                return { ok: false, error: `${command} requires COUNT between 1 and ${DB_MAX_ROWS}.` };
            }
        }
    }
    return { ok: true, value: { command, args } };
}

export interface MongoReadSpec {
    collection: string;
    filter: Record<string, unknown>;
    projection?: Record<string, 0 | 1>;
    sort?: Record<string, 1 | -1>;
    limit: number;
}

export type MongoReadParseResult = { ok: true; value: MongoReadSpec } | { ok: false; error: string };

function containsForbiddenMongoOperator(value: unknown, depth = 0): boolean {
    if (depth > 20) return true;
    if (Array.isArray(value)) return value.some((item) => containsForbiddenMongoOperator(item, depth + 1));
    if (!value || typeof value !== "object") return false;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (["$where", "$function", "$accumulator", "$out", "$merge"].includes(key.toLowerCase())) return true;
        if (containsForbiddenMongoOperator(child, depth + 1)) return true;
    }
    return false;
}

/** Collection name shorthand or a bounded JSON `{collection, filter, projection, sort, limit}` spec. */
export function parseMongoReadSpec(input: string): MongoReadParseResult {
    const trimmed = input.trim().replace(/;$/, "");
    if (!trimmed) return { ok: false, error: "Enter a MongoDB collection name or read specification." };
    if (trimmed.length > DB_MAX_QUERY_CHARS) return { ok: false, error: "MongoDB query is too large for the read-only viewer." };
    let raw: Record<string, unknown>;
    if (!trimmed.startsWith("{")) {
        raw = { collection: trimmed };
    } else {
        try {
            const parsed = JSON.parse(trimmed) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
            raw = parsed as Record<string, unknown>;
        } catch {
            return { ok: false, error: "MongoDB read specifications must be valid JSON objects." };
        }
    }
    const collection = typeof raw.collection === "string" ? raw.collection.trim() : "";
    if (!collection || collection.length > 120 || /[\0$]/.test(collection) || collection.startsWith("system.")) {
        return { ok: false, error: "Choose a valid, non-system MongoDB collection." };
    }
    const allowed = new Set(["collection", "filter", "projection", "sort", "limit"]);
    if (Object.keys(raw).some((key) => !allowed.has(key))) return { ok: false, error: "MongoDB reads support collection, filter, projection, sort, and limit only." };
    const filter = raw.filter === undefined ? {} : raw.filter;
    if (!filter || typeof filter !== "object" || Array.isArray(filter) || containsForbiddenMongoOperator(filter)) {
        return { ok: false, error: "MongoDB filter is invalid or uses an unsafe server-side operator." };
    }
    let projection: Record<string, 0 | 1> | undefined;
    if (raw.projection !== undefined) {
        if (!raw.projection || typeof raw.projection !== "object" || Array.isArray(raw.projection)) return { ok: false, error: "MongoDB projection must be an object." };
        projection = {};
        for (const [key, value] of Object.entries(raw.projection as Record<string, unknown>)) {
            if ((value !== 0 && value !== 1 && value !== false && value !== true) || key.includes("$")) return { ok: false, error: "MongoDB projection values must be 0 or 1." };
            projection[key] = value === 0 || value === false ? 0 : 1;
        }
    }
    let sort: Record<string, 1 | -1> | undefined;
    if (raw.sort !== undefined) {
        if (!raw.sort || typeof raw.sort !== "object" || Array.isArray(raw.sort)) return { ok: false, error: "MongoDB sort must be an object." };
        sort = {};
        for (const [key, value] of Object.entries(raw.sort as Record<string, unknown>)) {
            const direction = value === "asc" ? 1 : value === "desc" ? -1 : value;
            if (direction !== 1 && direction !== -1) return { ok: false, error: "MongoDB sort directions must be 1 or -1." };
            sort[key] = direction;
        }
    }
    const requestedLimit = raw.limit === undefined ? 100 : Number(raw.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) return { ok: false, error: "MongoDB limit must be a positive integer." };
    return {
        ok: true,
        value: {
            collection,
            filter: filter as Record<string, unknown>,
            ...(projection ? { projection } : {}),
            ...(sort ? { sort } : {}),
            limit: Math.min(requestedLimit, DB_MAX_ROWS),
        },
    };
}

/** Remove credentials and driver internals before an error crosses IPC. */
export function sanitizeDatabaseError(error: unknown, conn?: DbConnection, password?: string): string {
    const candidate = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
    const code = typeof candidate.code === "string" ? candidate.code : "";
    const raw = error instanceof Error ? error.message : typeof candidate.message === "string" ? candidate.message : String(error);
    if (code === "ECONNREFUSED" || /ECONNREFUSED/i.test(raw)) return "Could not connect to the database server. Verify the host, port, and that the server is running.";
    if (code === "ENOTFOUND" || /getaddrinfo\s+ENOTFOUND/i.test(raw)) return "The database host could not be resolved.";
    if (code === "ETIMEDOUT" || /timed?\s*out|server selection timeout/i.test(raw)) return `The database operation timed out after ${DB_QUERY_TIMEOUT_MS / 1000} seconds.`;
    if (/auth|password|credential|access denied|not authorized|28P01/i.test(raw)) return "Database authentication failed. Check the username, password, and authentication database.";
    if (/certificate|self[- ]signed|ssl|tls/i.test(raw)) return "The secure database connection failed. Check the TLS settings and server certificate.";
    let safe = raw
        .replace(/([a-z][a-z0-9+.-]*:\/\/)(?:[^\s/@:]+(?::[^\s/@]*)?@)/gi, "$1[redacted]@")
        .replace(/\b(password|passwd|pwd)\s*[=:]\s*([^\s,;]+)/gi, "$1=[redacted]")
        .replace(/[\r\n\t]+/g, " ")
        .trim();
    for (const secret of [password, password ? encodeURIComponent(password) : undefined]) {
        if (secret) safe = safe.split(secret).join("[redacted]");
    }
    if (conn?.user && password) safe = safe.replace(new RegExp(`${escapeRegExp(conn.user)}:${escapeRegExp(password)}`, "gi"), "[redacted]");
    return (safe || "The database operation failed.").slice(0, 500);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
