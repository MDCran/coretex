-- CreateEnum (idempotent)
DO $$ BEGIN
    CREATE TYPE "TodoPriority" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "TodoEnergy" AS ENUM ('DEEP_WORK', 'QUICK', 'COLLABORATIVE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- AlterTable TodoItem
ALTER TABLE "TodoItem"
    ADD COLUMN IF NOT EXISTS "priority" "TodoPriority" NOT NULL DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "category" TEXT,
    ADD COLUMN IF NOT EXISTS "energy" "TodoEnergy",
    ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "links" TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "projectRef" TEXT,
    ADD COLUMN IF NOT EXISTS "projectUrl" TEXT,
    ADD COLUMN IF NOT EXISTS "rolledOver" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "blockedById" TEXT;

-- AlterTable TodoRoutine
ALTER TABLE "TodoRoutine"
    ADD COLUMN IF NOT EXISTS "endDate" DATE,
    ADD COLUMN IF NOT EXISTS "anchorDate" DATE,
    ADD COLUMN IF NOT EXISTS "priority" "TodoPriority" NOT NULL DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS "category" TEXT,
    ADD COLUMN IF NOT EXISTS "energy" "TodoEnergy",
    ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}';

-- Index + self-FK for the dependency link
CREATE INDEX IF NOT EXISTS "TodoItem_blockedById_idx" ON "TodoItem"("blockedById");
DO $$ BEGIN
    ALTER TABLE "TodoItem" ADD CONSTRAINT "TodoItem_blockedById_fkey"
        FOREIGN KEY ("blockedById") REFERENCES "TodoItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateTable TodoSubtask
CREATE TABLE IF NOT EXISTS "TodoSubtask" (
    "id" TEXT NOT NULL,
    "todoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TodoSubtask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TodoSubtask_todoId_idx" ON "TodoSubtask"("todoId");
DO $$ BEGIN
    ALTER TABLE "TodoSubtask" ADD CONSTRAINT "TodoSubtask_todoId_fkey"
        FOREIGN KEY ("todoId") REFERENCES "TodoItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
