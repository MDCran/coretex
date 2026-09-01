-- Public view-only share links for learning notes and flashcard decks.
-- Idempotent; applied via `prisma db execute` (blocked migration history).

CREATE TABLE IF NOT EXISTS "LearningShare" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "noteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearningShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LearningShare_token_key" ON "LearningShare"("token");
CREATE INDEX IF NOT EXISTS "LearningShare_userId_idx" ON "LearningShare"("userId");

DO $$ BEGIN
    ALTER TABLE "LearningShare" ADD CONSTRAINT "LearningShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
