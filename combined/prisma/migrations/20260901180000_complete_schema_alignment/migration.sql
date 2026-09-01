-- Bring databases created from the checked-in migration history into parity with
-- prisma/schema.prisma. Every operation is conditional because some local
-- installations received these additions through `prisma db push` before this
-- migration was added.

BEGIN;

-- PostgreSQL does not support CREATE TYPE IF NOT EXISTS, so create each enum in
-- a duplicate-safe block.
DO $$
BEGIN
  CREATE TYPE "JobLevel" AS ENUM ('INTERNSHIP', 'ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SuggestionStatus" AS ENUM ('NEW', 'DISMISSED', 'ADDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "InterviewFormat" AS ENUM ('PHONE', 'VIDEO', 'ONSITE', 'TAKE_HOME', 'PANEL', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "RoundOutcome" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'CANCELLED', 'NO_SHOW', 'WITHDREW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "OfferStatus" AS ENUM ('RECEIVED', 'NEGOTIATING', 'ACCEPTED', 'DECLINED', 'RESCINDED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "NegotiationKind" AS ENUM ('INITIAL', 'COUNTER', 'REVISED', 'FINAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "JobContactKind" AS ENUM ('RECRUITER', 'HIRING_MANAGER', 'REFERRAL', 'INTERVIEWER', 'TEAM_MEMBER', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Columns that were previously present only in databases synchronized with
-- Prisma db push.
ALTER TABLE "FinTransaction"
  ADD COLUMN IF NOT EXISTS "receiptKey" TEXT;

ALTER TABLE "JobApplication"
  ADD COLUMN IF NOT EXISTS "atsMissingKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "atsScore" INTEGER,
  ADD COLUMN IF NOT EXISTS "distanceMiles" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "jdText" TEXT,
  ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nearestLocationId" TEXT,
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "referredByContactId" TEXT,
  ADD COLUMN IF NOT EXISTS "referredByName" TEXT,
  ADD COLUMN IF NOT EXISTS "referredByRelationship" TEXT,
  ADD COLUMN IF NOT EXISTS "targetId" TEXT,
  ADD COLUMN IF NOT EXISTS "thankYouSent" BOOLEAN NOT NULL DEFAULT false;

-- heardFrom changed from the original enum to free-form text. Cast in place so
-- existing values are retained, then remove the now-unused enum.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'JobApplication'
      AND column_name = 'heardFrom'
      AND data_type = 'USER-DEFINED'
  ) THEN
    ALTER TABLE "JobApplication"
      ALTER COLUMN "heardFrom" TYPE TEXT USING "heardFrom"::TEXT;
  END IF;
END $$;

DROP TYPE IF EXISTS "HeardFrom";

ALTER TABLE "JobContact"
  ADD COLUMN IF NOT EXISTS "kind" "JobContactKind";

ALTER TABLE "Settings"
  ADD COLUMN IF NOT EXISTS "accent" TEXT,
  ADD COLUMN IF NOT EXISTS "aiMonthlyLimitUsd" DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS "aiPerSearchLimitUsd" DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS "currency" TEXT,
  ADD COLUMN IF NOT EXISTS "dateFormat" TEXT,
  ADD COLUMN IF NOT EXISTS "moduleAccents" JSONB,
  ADD COLUMN IF NOT EXISTS "timeFormat" TEXT;

ALTER TABLE "Workout"
  ADD COLUMN IF NOT EXISTS "isQuickLog" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pausedMs" INTEGER NOT NULL DEFAULT 0;

-- Integration, career, job-search, and finance tables missing from the former
-- migration history.
CREATE TABLE IF NOT EXISTS "GeniusConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "geniusUserId" TEXT,
  "displayName" TEXT,
  "accessToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GeniusConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JobSearchLocation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "shortLabel" TEXT,
  "lat" DOUBLE PRECISION NOT NULL,
  "lon" DOUBLE PRECISION NOT NULL,
  "placeType" TEXT,
  "countryCode" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "maxResults" INTEGER NOT NULL DEFAULT 50,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobSearchLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JobSearchProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "profileText" TEXT,
  "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "excludeKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "levels" "JobLevel"[] DEFAULT ARRAY[]::"JobLevel"[],
  "distanceMiles" INTEGER NOT NULL DEFAULT 50,
  "allowRemote" BOOLEAN NOT NULL DEFAULT true,
  "includeNewCompanies" BOOLEAN NOT NULL DEFAULT true,
  "minSalary" INTEGER,
  "resultsPerLocation" INTEGER NOT NULL DEFAULT 50,
  "autoGhost" BOOLEAN NOT NULL DEFAULT false,
  "ghostAfterDays" INTEGER NOT NULL DEFAULT 21,
  "followUpAfterDays" INTEGER NOT NULL DEFAULT 7,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobSearchProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SuggestedCompany" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "websiteDomain" TEXT,
  "logoKey" TEXT,
  "industry" TEXT,
  "hqLocation" TEXT,
  "size" TEXT,
  "status" "SuggestionStatus" NOT NULL DEFAULT 'NEW',
  "promotedCompanyId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SuggestedCompany_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JobLead" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT,
  "suggestedCompanyId" TEXT,
  "companyName" TEXT NOT NULL,
  "companyDomain" TEXT,
  "title" TEXT NOT NULL,
  "level" "JobLevel" NOT NULL DEFAULT 'UNKNOWN',
  "descriptionSnippet" TEXT,
  "applicationUrl" TEXT,
  "salaryMin" INTEGER,
  "salaryMax" INTEGER,
  "salaryCurrency" TEXT DEFAULT 'USD',
  "deadline" TIMESTAMP(3),
  "locationText" TEXT,
  "lat" DOUBLE PRECISION,
  "lon" DOUBLE PRECISION,
  "isRemote" BOOLEAN NOT NULL DEFAULT false,
  "nearestLocationId" TEXT,
  "distanceMiles" DOUBLE PRECISION,
  "matchScore" INTEGER,
  "matchReason" TEXT,
  "status" "SuggestionStatus" NOT NULL DEFAULT 'NEW',
  "promotedApplicationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobLead_pkey" PRIMARY KEY ("id")
);

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
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobSearchRun_pkey" PRIMARY KEY ("id")
);

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

CREATE TABLE IF NOT EXISTS "GeocodeCache" (
  "id" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "lat" DOUBLE PRECISION,
  "lon" DOUBLE PRECISION,
  "displayName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeocodeCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InterviewRound" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "roundNumber" INTEGER NOT NULL DEFAULT 1,
  "name" TEXT,
  "format" "InterviewFormat" NOT NULL DEFAULT 'VIDEO',
  "scheduledAt" TIMESTAMP(3),
  "durationMinutes" INTEGER,
  "outcome" "RoundOutcome" NOT NULL DEFAULT 'PENDING',
  "selfRating" INTEGER,
  "interviewerNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "notesMarkdown" TEXT,
  "thankYouSent" BOOLEAN NOT NULL DEFAULT false,
  "thankYouSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InterviewRound_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InterviewQuestion" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "applicationId" TEXT,
  "companyId" TEXT,
  "roundId" TEXT,
  "question" TEXT NOT NULL,
  "answer" TEXT,
  "category" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PrepChecklistItem" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "done" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrepChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StarStory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "situation" TEXT,
  "task" TEXT,
  "action" TEXT,
  "result" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StarStory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Offer" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "status" "OfferStatus" NOT NULL DEFAULT 'RECEIVED',
  "baseSalary" INTEGER,
  "bonus" INTEGER,
  "equityValue" INTEGER,
  "equityDescription" TEXT,
  "signOnBonus" INTEGER,
  "ptoDays" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "benefits" TEXT,
  "location" TEXT,
  "remote" BOOLEAN,
  "startDate" TIMESTAMP(3),
  "decisionDeadline" TIMESTAMP(3),
  "notesMarkdown" TEXT,
  "letterFileKey" TEXT,
  "letterFileName" TEXT,
  "receivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NegotiationStep" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "kind" "NegotiationKind" NOT NULL DEFAULT 'COUNTER',
  "date" TIMESTAMP(3),
  "baseSalary" INTEGER,
  "bonus" INTEGER,
  "equityValue" INTEGER,
  "rationale" TEXT,
  "outcome" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NegotiationStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NetworkingOutreach" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "contactId" TEXT,
  "companyId" TEXT,
  "personName" TEXT NOT NULL,
  "channel" "ContactMethod",
  "sentAt" TIMESTAMP(3),
  "responded" BOOLEAN NOT NULL DEFAULT false,
  "respondedAt" TIMESTAMP(3),
  "converted" BOOLEAN NOT NULL DEFAULT false,
  "notesMarkdown" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NetworkingOutreach_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CareerTarget" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "targetRole" TEXT,
  "targetCompanyType" TEXT,
  "targetSalary" INTEGER,
  "targetLocation" TEXT,
  "notesMarkdown" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareerTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TransactionSplit" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "categoryId" TEXT,
  "amount" DECIMAL(14,2) NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransactionSplit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ExchangeRate" (
  "code" TEXT NOT NULL,
  "rateToUsd" DECIMAL(18,8) NOT NULL,
  "asOf" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("code")
);

-- Named indexes are safe to create repeatedly with IF NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS "GeniusConnection_userId_key" ON "GeniusConnection"("userId");
CREATE INDEX IF NOT EXISTS "JobSearchLocation_userId_idx" ON "JobSearchLocation"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "JobSearchProfile_userId_key" ON "JobSearchProfile"("userId");
CREATE INDEX IF NOT EXISTS "SuggestedCompany_userId_status_idx" ON "SuggestedCompany"("userId", "status");
CREATE INDEX IF NOT EXISTS "SuggestedCompany_userId_name_idx" ON "SuggestedCompany"("userId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "JobLead_promotedApplicationId_key" ON "JobLead"("promotedApplicationId");
CREATE INDEX IF NOT EXISTS "JobLead_userId_status_idx" ON "JobLead"("userId", "status");
CREATE INDEX IF NOT EXISTS "JobLead_companyId_idx" ON "JobLead"("companyId");
CREATE INDEX IF NOT EXISTS "JobLead_suggestedCompanyId_idx" ON "JobLead"("suggestedCompanyId");
CREATE INDEX IF NOT EXISTS "JobLead_nearestLocationId_idx" ON "JobLead"("nearestLocationId");
CREATE INDEX IF NOT EXISTS "JobSearchRun_userId_status_idx" ON "JobSearchRun"("userId", "status");
CREATE INDEX IF NOT EXISTS "JobSearchRun_userId_createdAt_idx" ON "JobSearchRun"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "DeletedSuggestedRole_userId_deletedAt_idx" ON "DeletedSuggestedRole"("userId", "deletedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "GeocodeCache_query_key" ON "GeocodeCache"("query");
CREATE INDEX IF NOT EXISTS "InterviewRound_applicationId_idx" ON "InterviewRound"("applicationId");
CREATE INDEX IF NOT EXISTS "InterviewRound_userId_idx" ON "InterviewRound"("userId");
CREATE INDEX IF NOT EXISTS "InterviewQuestion_userId_idx" ON "InterviewQuestion"("userId");
CREATE INDEX IF NOT EXISTS "InterviewQuestion_applicationId_idx" ON "InterviewQuestion"("applicationId");
CREATE INDEX IF NOT EXISTS "InterviewQuestion_companyId_idx" ON "InterviewQuestion"("companyId");
CREATE INDEX IF NOT EXISTS "PrepChecklistItem_applicationId_idx" ON "PrepChecklistItem"("applicationId");
CREATE INDEX IF NOT EXISTS "StarStory_userId_idx" ON "StarStory"("userId");
CREATE INDEX IF NOT EXISTS "Offer_userId_idx" ON "Offer"("userId");
CREATE INDEX IF NOT EXISTS "Offer_applicationId_idx" ON "Offer"("applicationId");
CREATE INDEX IF NOT EXISTS "NegotiationStep_offerId_idx" ON "NegotiationStep"("offerId");
CREATE INDEX IF NOT EXISTS "NetworkingOutreach_userId_idx" ON "NetworkingOutreach"("userId");
CREATE INDEX IF NOT EXISTS "NetworkingOutreach_contactId_idx" ON "NetworkingOutreach"("contactId");
CREATE INDEX IF NOT EXISTS "NetworkingOutreach_companyId_idx" ON "NetworkingOutreach"("companyId");
CREATE INDEX IF NOT EXISTS "CareerTarget_userId_idx" ON "CareerTarget"("userId");
CREATE INDEX IF NOT EXISTS "TransactionSplit_transactionId_idx" ON "TransactionSplit"("transactionId");
CREATE INDEX IF NOT EXISTS "TransactionSplit_categoryId_idx" ON "TransactionSplit"("categoryId");
CREATE INDEX IF NOT EXISTS "JobApplication_nearestLocationId_idx" ON "JobApplication"("nearestLocationId");
CREATE INDEX IF NOT EXISTS "JobApplication_targetId_idx" ON "JobApplication"("targetId");
CREATE INDEX IF NOT EXISTS "JobApplication_referredByContactId_idx" ON "JobApplication"("referredByContactId");

-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS. Check the target table and
-- constraint name explicitly so this remains safe on db-pushed installations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GeniusConnection_userId_fkey' AND conrelid = '"GeniusConnection"'::regclass) THEN
    ALTER TABLE "GeniusConnection" ADD CONSTRAINT "GeniusConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobApplication_referredByContactId_fkey' AND conrelid = '"JobApplication"'::regclass) THEN
    ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_referredByContactId_fkey" FOREIGN KEY ("referredByContactId") REFERENCES "JobContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobApplication_targetId_fkey' AND conrelid = '"JobApplication"'::regclass) THEN
    ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "CareerTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobApplication_nearestLocationId_fkey' AND conrelid = '"JobApplication"'::regclass) THEN
    ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_nearestLocationId_fkey" FOREIGN KEY ("nearestLocationId") REFERENCES "JobSearchLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobSearchLocation_userId_fkey' AND conrelid = '"JobSearchLocation"'::regclass) THEN
    ALTER TABLE "JobSearchLocation" ADD CONSTRAINT "JobSearchLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobSearchProfile_userId_fkey' AND conrelid = '"JobSearchProfile"'::regclass) THEN
    ALTER TABLE "JobSearchProfile" ADD CONSTRAINT "JobSearchProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SuggestedCompany_userId_fkey' AND conrelid = '"SuggestedCompany"'::regclass) THEN
    ALTER TABLE "SuggestedCompany" ADD CONSTRAINT "SuggestedCompany_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SuggestedCompany_promotedCompanyId_fkey' AND conrelid = '"SuggestedCompany"'::regclass) THEN
    ALTER TABLE "SuggestedCompany" ADD CONSTRAINT "SuggestedCompany_promotedCompanyId_fkey" FOREIGN KEY ("promotedCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobLead_userId_fkey' AND conrelid = '"JobLead"'::regclass) THEN
    ALTER TABLE "JobLead" ADD CONSTRAINT "JobLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobLead_companyId_fkey' AND conrelid = '"JobLead"'::regclass) THEN
    ALTER TABLE "JobLead" ADD CONSTRAINT "JobLead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobLead_suggestedCompanyId_fkey' AND conrelid = '"JobLead"'::regclass) THEN
    ALTER TABLE "JobLead" ADD CONSTRAINT "JobLead_suggestedCompanyId_fkey" FOREIGN KEY ("suggestedCompanyId") REFERENCES "SuggestedCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobLead_nearestLocationId_fkey' AND conrelid = '"JobLead"'::regclass) THEN
    ALTER TABLE "JobLead" ADD CONSTRAINT "JobLead_nearestLocationId_fkey" FOREIGN KEY ("nearestLocationId") REFERENCES "JobSearchLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobLead_promotedApplicationId_fkey' AND conrelid = '"JobLead"'::regclass) THEN
    ALTER TABLE "JobLead" ADD CONSTRAINT "JobLead_promotedApplicationId_fkey" FOREIGN KEY ("promotedApplicationId") REFERENCES "JobApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobSearchRun_userId_fkey' AND conrelid = '"JobSearchRun"'::regclass) THEN
    ALTER TABLE "JobSearchRun" ADD CONSTRAINT "JobSearchRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeletedSuggestedRole_userId_fkey' AND conrelid = '"DeletedSuggestedRole"'::regclass) THEN
    ALTER TABLE "DeletedSuggestedRole" ADD CONSTRAINT "DeletedSuggestedRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InterviewRound_userId_fkey' AND conrelid = '"InterviewRound"'::regclass) THEN
    ALTER TABLE "InterviewRound" ADD CONSTRAINT "InterviewRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InterviewRound_applicationId_fkey' AND conrelid = '"InterviewRound"'::regclass) THEN
    ALTER TABLE "InterviewRound" ADD CONSTRAINT "InterviewRound_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InterviewQuestion_userId_fkey' AND conrelid = '"InterviewQuestion"'::regclass) THEN
    ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InterviewQuestion_applicationId_fkey' AND conrelid = '"InterviewQuestion"'::regclass) THEN
    ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InterviewQuestion_companyId_fkey' AND conrelid = '"InterviewQuestion"'::regclass) THEN
    ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InterviewQuestion_roundId_fkey' AND conrelid = '"InterviewQuestion"'::regclass) THEN
    ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "InterviewRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PrepChecklistItem_userId_fkey' AND conrelid = '"PrepChecklistItem"'::regclass) THEN
    ALTER TABLE "PrepChecklistItem" ADD CONSTRAINT "PrepChecklistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PrepChecklistItem_applicationId_fkey' AND conrelid = '"PrepChecklistItem"'::regclass) THEN
    ALTER TABLE "PrepChecklistItem" ADD CONSTRAINT "PrepChecklistItem_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StarStory_userId_fkey' AND conrelid = '"StarStory"'::regclass) THEN
    ALTER TABLE "StarStory" ADD CONSTRAINT "StarStory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Offer_userId_fkey' AND conrelid = '"Offer"'::regclass) THEN
    ALTER TABLE "Offer" ADD CONSTRAINT "Offer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Offer_applicationId_fkey' AND conrelid = '"Offer"'::regclass) THEN
    ALTER TABLE "Offer" ADD CONSTRAINT "Offer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NegotiationStep_userId_fkey' AND conrelid = '"NegotiationStep"'::regclass) THEN
    ALTER TABLE "NegotiationStep" ADD CONSTRAINT "NegotiationStep_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NegotiationStep_offerId_fkey' AND conrelid = '"NegotiationStep"'::regclass) THEN
    ALTER TABLE "NegotiationStep" ADD CONSTRAINT "NegotiationStep_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NetworkingOutreach_userId_fkey' AND conrelid = '"NetworkingOutreach"'::regclass) THEN
    ALTER TABLE "NetworkingOutreach" ADD CONSTRAINT "NetworkingOutreach_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NetworkingOutreach_contactId_fkey' AND conrelid = '"NetworkingOutreach"'::regclass) THEN
    ALTER TABLE "NetworkingOutreach" ADD CONSTRAINT "NetworkingOutreach_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "JobContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NetworkingOutreach_companyId_fkey' AND conrelid = '"NetworkingOutreach"'::regclass) THEN
    ALTER TABLE "NetworkingOutreach" ADD CONSTRAINT "NetworkingOutreach_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CareerTarget_userId_fkey' AND conrelid = '"CareerTarget"'::regclass) THEN
    ALTER TABLE "CareerTarget" ADD CONSTRAINT "CareerTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TransactionSplit_transactionId_fkey' AND conrelid = '"TransactionSplit"'::regclass) THEN
    ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TransactionSplit_categoryId_fkey' AND conrelid = '"TransactionSplit"'::regclass) THEN
    ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BudgetCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
