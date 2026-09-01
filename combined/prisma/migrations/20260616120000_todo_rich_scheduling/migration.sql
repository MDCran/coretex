-- CreateEnum (idempotent: tolerate a pre-existing type)
DO $$ BEGIN
    CREATE TYPE "TimeOfDay" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING', 'NIGHT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "TodoItem"
    ADD COLUMN IF NOT EXISTS "timeOfDay" "TimeOfDay",
    ADD COLUMN IF NOT EXISTS "startTime" TEXT,
    ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER;

-- AlterTable
ALTER TABLE "TodoRoutine"
    ADD COLUMN IF NOT EXISTS "timeOfDay" "TimeOfDay",
    ADD COLUMN IF NOT EXISTS "startTime" TEXT,
    ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER;

-- Defense-in-depth: durations must be positive when present (idempotent).
DO $$ BEGIN
    ALTER TABLE "TodoItem" ADD CONSTRAINT "TodoItem_durationMinutes_positive" CHECK ("durationMinutes" IS NULL OR "durationMinutes" > 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "TodoRoutine" ADD CONSTRAINT "TodoRoutine_durationMinutes_positive" CHECK ("durationMinutes" IS NULL OR "durationMinutes" > 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
