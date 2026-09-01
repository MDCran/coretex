-- Additive, idempotent schema changes for the AI job-search + appearance work.
-- Migrations are blocked (P3009), so apply via: prisma db execute --file <this> --schema prisma/schema.prisma

-- (1) JobSearchRun: live progress, cost estimate/actual, and halt capability.
CREATE TABLE IF NOT EXISTS "JobSearchRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "params" JSONB,
    "targetCount" INTEGER NOT NULL DEFAULT 50,
    "foundCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "actualCostUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "progress" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobSearchRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "JobSearchRun_userId_status_idx" ON "JobSearchRun"("userId", "status");
CREATE INDEX IF NOT EXISTS "JobSearchRun_userId_createdAt_idx" ON "JobSearchRun"("userId", "createdAt");
DO $$ BEGIN
    ALTER TABLE "JobSearchRun" ADD CONSTRAINT "JobSearchRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- (2) DeletedSuggestedRole: backup of removed suggestions (only Settings can purge).
CREATE TABLE IF NOT EXISTS "DeletedSuggestedRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyDomain" TEXT,
    "title" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "descriptionSnippet" TEXT,
    "applicationUrl" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryCurrency" TEXT DEFAULT 'USD',
    "locationText" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "isRemote" BOOLEAN NOT NULL DEFAULT false,
    "matchScore" INTEGER,
    "matchReason" TEXT,
    "originalStatus" TEXT NOT NULL DEFAULT 'NEW',
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeletedSuggestedRole_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DeletedSuggestedRole_userId_deletedAt_idx" ON "DeletedSuggestedRole"("userId", "deletedAt");
DO $$ BEGIN
    ALTER TABLE "DeletedSuggestedRole" ADD CONSTRAINT "DeletedSuggestedRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- (3) Settings: refined AI limits + appearance prefs (idempotent column adds).
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "aiMonthlyLimitUsd" DECIMAL(8,2);
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "aiPerSearchLimitUsd" DECIMAL(8,2);
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "accent" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "moduleAccents" JSONB;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "dateFormat" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "timeFormat" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "currency" TEXT;
