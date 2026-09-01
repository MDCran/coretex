# Disposable database acceptance fixtures

The fixture project exposes seeded databases only on high-numbered localhost
ports. Database storage uses container `tmpfs`, so it does not read or reuse any
Coretex or developer database data.

From the repository root:

```powershell
$env:DOCKER_CONFIG = Join-Path $env:TEMP "coretex-docker-smoke-config"
New-Item -ItemType Directory -Force -Path $env:DOCKER_CONFIG | Out-Null
docker compose -f coretex/scripts/database-fixtures/compose.yml up -d --wait
npx tsx coretex/scripts/database-acceptance-smoke.ts --compose-fixture
docker compose -f coretex/scripts/database-fixtures/compose.yml down --remove-orphans
```

The acceptance script always runs SQLite, query-safety, driver-resolution, and
WebSocket wiring checks. `--compose-fixture` additionally requires PostgreSQL,
MySQL, MariaDB, MongoDB, and Redis to pass connection testing, database listing,
schema/key browsing, item introspection, and a bounded read query.

To use equivalent dedicated fixtures without Compose, set these URLs and pass
`--require-live`:

- `CORETEX_DATABASE_SMOKE_POSTGRES_URL`
- `CORETEX_DATABASE_SMOKE_MYSQL_URL`
- `CORETEX_DATABASE_SMOKE_MARIADB_URL`
- `CORETEX_DATABASE_SMOKE_MONGO_URL`
- `CORETEX_DATABASE_SMOKE_REDIS_URL`

Never point the smoke harness at production or personal databases. Although its
queries are read-only, full acceptance expects seeded fixture objects to exist.
