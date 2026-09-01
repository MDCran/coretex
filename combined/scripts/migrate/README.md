# LifeOS data migration

ETL scripts that copy all data from the four legacy tracker apps into the unified
LifeOS Postgres schema (`combined/prisma/schema.prisma`) and the LifeOS MinIO
bucket. Every migrated row is owned by ONE target LifeOS account (`--user-email`).

## Prerequisites

1. **Target up**: combined app DB (`postgresql://lifeos:lifeos@localhost:5450/lifeos`)
   and MinIO (`localhost:9400`, `minioadmin/minioadmin`, bucket `lifeos`).
   The Prisma client must be generated (`npm run db:generate`) and the schema
   pushed/migrated.
2. **Target account exists**: register the account you pass to `--user-email`
   first. The script looks it up and fails if it is missing.
3. **Source containers up** (start each legacy app's docker stack):
   - apptracker — Postgres `localhost:5440`, MinIO `localhost:9300` bucket `attachments`
   - peptide    — Postgres `localhost:5441` (no S3)
   - workout    — Postgres `localhost:5434`, MinIO `localhost:9000` bucket `workout-media`
   - health     — Postgres `localhost:5433`, LocalStack S3 `localhost:4566` bucket `health-tracker`

If a source DB is unreachable, `migrate-all.ts` logs the failure and continues
with the others (you can re-run just that source later).

## Run

```bash
# everything, in order (apptracker, peptide, workout, health)
npx tsx scripts/migrate/migrate-all.ts --user-email you@example.com

# preview only — prints per-table row counts, writes nothing
npx tsx scripts/migrate/migrate-all.ts --user-email you@example.com --dry-run

# one source at a time
npx tsx scripts/migrate/migrate-apptracker.ts --user-email you@example.com
npx tsx scripts/migrate/migrate-peptide.ts     --user-email you@example.com
npx tsx scripts/migrate/migrate-workout.ts     --user-email you@example.com
npx tsx scripts/migrate/migrate-health.ts      --user-email you@example.com
```

## Flags

| Flag | Meaning |
|---|---|
| `--user-email <email>` | **Required.** Target account that owns all migrated rows. |
| `--dry-run` | Count rows per table per source; do not write DB or S3. |
| `--force` | Re-run a source even if its completion marker exists. |

## Idempotency

Each source writes a marker on success: a `SYSTEM` Notification titled
`migration:<source> completed`. On the next run that source is **skipped** unless
`--force` is given.

> **Caveat:** `--force` does NOT delete previously-migrated rows. Most leaf tables
> are plain `create`s, so re-running with `--force` will **duplicate** them.
> Exceptions that upsert by natural key (safe to re-run): `WaterLog`,
> `SleepEntry`, `NutritionDay`, `BudgetCategory`, `IncomeStream`, `SocialTag`,
> `SocialBattery`, `NutritionGoal`, `UserProfile`. To cleanly re-run a source,
> wipe the target user's data first.

## Override env (optional)

Connection strings default to the values above; override via env if needed:

```
LIFEOS_DATABASE_URL, LIFEOS_S3_ENDPOINT, LIFEOS_S3_ACCESS_KEY,
LIFEOS_S3_SECRET_KEY, LIFEOS_S3_BUCKET, LIFEOS_S3_REGION
```

## S3 object handling

Objects are streamed source→target (GetObject then PutObject, `forcePathStyle`)
and re-keyed to `u/{targetUserId}/{module}/{originalFileName-or-uuid}`; the new
key is stored on the migrated row. Missing source objects are tolerated with a
warning (the row still gets a stable key). Modules: `jobs`, `workouts`, `health`,
`social`, `financial`.

## Type-checking

These scripts are included by the root `tsconfig.json` (`include: ["**/*.ts"]`),
so `npx tsc --noEmit` validates them with the rest of the project. They run with
`tsx` (no build step).

## What is NOT migrated

- Multi-tenant Contexts / ContextMembers (LifeOS is per-user).
- Plaid items, Gmail/Email inbox, AI telemetry (AiCall/AiNarrative), per-app
  Settings, voice config, Stripe/billing, TOTP, API keys, OpenAI usage logs,
  Google Drive tokens.
- health-tracker: identity documents, medical/family history questionnaires,
  referral codes, workout_* tables (those come from workout-tracker instead),
  AI extraction run internals (only the resolved extracted items are kept).
