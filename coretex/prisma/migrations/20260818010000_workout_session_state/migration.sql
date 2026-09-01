-- Persist live-session pause state and distinguish one-off exercise logs.
-- The follow-up ALTERs also normalize installations where a column was added
-- manually without Prisma's expected default or nullability.
ALTER TABLE "Workout"
    ADD COLUMN IF NOT EXISTS "pausedMs" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "isQuickLog" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Workout"
SET "pausedMs" = 0
WHERE "pausedMs" IS NULL;

UPDATE "Workout"
SET "isQuickLog" = false
WHERE "isQuickLog" IS NULL;

ALTER TABLE "Workout"
    ALTER COLUMN "pausedMs" SET DEFAULT 0,
    ALTER COLUMN "pausedMs" SET NOT NULL,
    ALTER COLUMN "isQuickLog" SET DEFAULT false,
    ALTER COLUMN "isQuickLog" SET NOT NULL;
