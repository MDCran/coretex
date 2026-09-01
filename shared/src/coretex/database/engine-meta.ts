// @ts-nocheck
// Shared database engine metadata — logos, ports, labels, and SQL identifier quoting.

import type { DbConnection } from "@repo/coretex/types";
import type { RichSelectOption } from "@/components/base/select/select-native";

export type DbEngine = DbConnection["engine"];

export const ENGINE_OPTIONS: { label: string; value: DbEngine }[] = [
  { label: "PostgreSQL", value: "postgres" },
  { label: "MySQL", value: "mysql" },
  { label: "MariaDB", value: "mariadb" },
  { label: "MongoDB", value: "mongo" },
  { label: "Redis", value: "redis" },
  { label: "SQLite", value: "sqlite" },
];

export const ENGINE_DOMAIN: Partial<Record<DbEngine, string>> = {
  postgres: "postgresql.org",
  mysql: "mysql.com",
  mariadb: "mariadb.org",
  mongo: "mongodb.com",
  redis: "redis.io",
};

export const ENGINE_LABEL: Record<DbEngine, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mongo: "MongoDB",
  redis: "Redis",
  sqlite: "SQLite",
};

export const DEFAULT_PORTS: Partial<Record<DbEngine, number>> = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  mongo: 27017,
  redis: 6379,
};

export const KNOWN_PORTS = new Set(Object.values(DEFAULT_PORTS));

export function engineRichOptions(): RichSelectOption[] {
  return ENGINE_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
    supportingText:
      o.value === "sqlite"
        ? "Local file — no host or credentials"
        : o.value === "mongo"
          ? "Document collections — preview by name"
          : o.value === "redis"
            ? "Key-value store — safe read commands only"
            : `Default port ${DEFAULT_PORTS[o.value] ?? "—"} · read-only SQL`,
    hint: o.label,
  }));
}

export function connectionRichOption(c: DbConnection): RichSelectOption {
  const loc =
    c.engine === "sqlite"
      ? c.database || "No file path"
      : c.engine === "redis"
        ? `${c.host ?? "localhost"}${c.port ? `:${c.port}` : ""} · DB ${c.database || "0"}`
        : `${c.host ?? "localhost"}${c.port ? `:${c.port}` : ""} · ${c.database || "no database"}`;
  return {
    value: c.id,
    label: c.name || ENGINE_LABEL[c.engine],
    supportingText: `${ENGINE_LABEL[c.engine]} · ${loc}`,
    detailText:
      c.engine === "sqlite" ? "Local file" : c.ssl ? "TLS enabled" : "Network",
    hint: `${c.name} (${c.engine})`,
  };
}

/** Quote a table/collection name safely for read-only SELECT templates. */
export function quoteTableRef(engine: DbEngine, name: string): string {
  if (engine === "mongo" || engine === "redis") return name;
  if (engine === "mysql" || engine === "mariadb") {
    return name
      .split(".")
      .map((p) => "`" + p.replace(/`/g, "``") + "`")
      .join(".");
  }
  if (engine === "postgres") {
    return name
      .split(".")
      .map((p) => '"' + p.replace(/"/g, '""') + '"')
      .join(".");
  }
  return '"' + name.replace(/"/g, '""') + '"';
}

export function defaultQuery(engine: DbEngine): string {
  switch (engine) {
    case "postgres":
      return "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2 LIMIT 50;";
    case "mysql":
    case "mariadb":
      return "SHOW TABLES;";
    case "mongo":
      return "";
    case "redis":
      return "SCAN 0 COUNT 100";
    default:
      return "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;";
  }
}
