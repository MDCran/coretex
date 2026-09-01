# LifeOS standalone web app

`combined` is the standalone Next.js edition of Coretex's personal workspace.
It includes workouts, nutrition, health, finance, social, career, learning, and
planning modules backed by PostgreSQL and private S3-compatible object storage.

## Local Docker stack

Copy the sanitized environment template and generate two independent secrets:

```powershell
Copy-Item .env.example .env
node -e "const c=require('node:crypto'); console.log('SESSION_SECRET='+c.randomBytes(32).toString('hex')); console.log('DATA_ENCRYPTION_KEY='+c.randomBytes(32).toString('hex'))"
```

Paste the generated values into `.env`, keep `DATA_ENCRYPTION_KEY` stable and
backed up, and never commit that file. OAuth tokens and Alpaca/Plaid credentials
are encrypted with AES-256-GCM before database storage. Docker upgrades run the
idempotent credential migration automatically. For a direct (non-Docker)
upgrade, run it once before production use:

If the standalone app and Coretex desktop point at the same PostgreSQL database,
set the same explicit `DATA_ENCRYPTION_KEY` for both processes. Desktop-only
installs otherwise generate a machine-protected key automatically, which cannot
decrypt rows written with a different standalone key.

```powershell
npm run secrets:encrypt
```

Then run:

```powershell
docker compose up --build
```

The app is available at `http://localhost:3200`. PostgreSQL, Redis, MinIO, its
console, and the app are all bound to loopback by default. The compose file is a
local-development stack, not an Internet-facing production topology.

## Direct development

```powershell
npm ci
npm run db:generate
npm run dev
```

Run `npm run typecheck`, `npm test`, and `npm run build` before submitting a
change. Upload actions allow at most five files, 25 MB each and 50 MB total.
