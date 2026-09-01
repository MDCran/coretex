-- Learning hub overhaul: Academic / Self-Directed / Goal-Based modes + YouTube archive.
-- Written idempotently so it can be applied with `prisma db execute` while the
-- migration history is blocked (P3009), and replays to a no-op under `migrate deploy`.

-- CreateEnum (idempotent)
DO $$ BEGIN CREATE TYPE "GradeLevel" AS ENUM ('HIGH_SCHOOL', 'UNDERGRAD', 'GRAD'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "ClassStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'DROPPED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "HomeworkStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'GRADED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "MilestoneStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DONE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "WatchStatus" AS ENUM ('NOT_WATCHED', 'WATCHING', 'WATCHED'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AlterTable LearningCourse
ALTER TABLE "LearningCourse"
    ADD COLUMN IF NOT EXISTS "provider" TEXT,
    ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT,
    ADD COLUMN IF NOT EXISTS "totalDurationSeconds" INTEGER,
    ADD COLUMN IF NOT EXISTS "timeInvestedMinutes" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "rating" INTEGER,
    ADD COLUMN IF NOT EXISTS "review" TEXT,
    ADD COLUMN IF NOT EXISTS "certificateKey" TEXT,
    ADD COLUMN IF NOT EXISTS "linkedGoalId" TEXT;

-- AlterTable LearningLesson
ALTER TABLE "LearningLesson" ADD COLUMN IF NOT EXISTS "estimatedMinutes" INTEGER;

-- AlterTable LearningGoal
ALTER TABLE "LearningGoal"
    ADD COLUMN IF NOT EXISTS "title" TEXT,
    ADD COLUMN IF NOT EXISTS "color" TEXT,
    ADD COLUMN IF NOT EXISTS "streakCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "lastStudiedOn" DATE,
    ADD COLUMN IF NOT EXISTS "freezeTokens" INTEGER NOT NULL DEFAULT 0;

-- AlterTable LearningResource
ALTER TABLE "LearningResource"
    ADD COLUMN IF NOT EXISTS "goalId" TEXT,
    ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- AlterTable Flashcard (SM-2)
ALTER TABLE "Flashcard"
    ADD COLUMN IF NOT EXISTS "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    ADD COLUMN IF NOT EXISTS "intervalDays" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "repetitions" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);

-- AlterTable LearningSession
ALTER TABLE "LearningSession"
    ADD COLUMN IF NOT EXISTS "subject" TEXT,
    ADD COLUMN IF NOT EXISTS "courseId" TEXT,
    ADD COLUMN IF NOT EXISTS "classId" TEXT,
    ADD COLUMN IF NOT EXISTS "goalId" TEXT,
    ADD COLUMN IF NOT EXISTS "energy" INTEGER,
    ADD COLUMN IF NOT EXISTS "pomodoro" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable LearningClass
CREATE TABLE IF NOT EXISTS "LearningClass" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gradeLevel" "GradeLevel" NOT NULL DEFAULT 'UNDERGRAD',
    "creditHours" DOUBLE PRECISION,
    "term" TEXT,
    "instructor" TEXT,
    "color" TEXT,
    "status" "ClassStatus" NOT NULL DEFAULT 'ACTIVE',
    "gradeWeights" JSONB,
    "absenceLimit" INTEGER,
    "finalGrade" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LearningClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable ClassAssignment
CREATE TABLE IF NOT EXISTS "ClassAssignment" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "HomeworkStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "pointsEarned" DOUBLE PRECISION,
    "pointsPossible" DOUBLE PRECISION,
    "extraCredit" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClassAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable ClassTest
CREATE TABLE IF NOT EXISTS "ClassTest" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "date" TIMESTAMP(3),
    "score" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION,
    "curveAdjustment" DOUBLE PRECISION DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClassTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable ClassAbsence
CREATE TABLE IF NOT EXISTS "ClassAbsence" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "excused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateTable GoalMilestone
CREATE TABLE IF NOT EXISTS "GoalMilestone" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "MilestoneStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GoalMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable VideoGroup
CREATE TABLE IF NOT EXISTS "VideoGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "themeColor" TEXT,
    "coverKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable ArchiveVideo
CREATE TABLE IF NOT EXISTS "ArchiveVideo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT,
    "youtubeId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT,
    "thumbnailUrl" TEXT,
    "durationSeconds" INTEGER,
    "watchStatus" "WatchStatus" NOT NULL DEFAULT 'NOT_WATCHED',
    "watchProgress" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArchiveVideo_pkey" PRIMARY KEY ("id")
);

-- Indexes (idempotent)
CREATE INDEX IF NOT EXISTS "LearningCourse_linkedGoalId_idx" ON "LearningCourse"("linkedGoalId");
CREATE INDEX IF NOT EXISTS "LearningResource_goalId_idx" ON "LearningResource"("goalId");
CREATE INDEX IF NOT EXISTS "Flashcard_userId_dueDate_idx" ON "Flashcard"("userId", "dueDate");
CREATE INDEX IF NOT EXISTS "LearningClass_userId_idx" ON "LearningClass"("userId");
CREATE INDEX IF NOT EXISTS "ClassAssignment_classId_idx" ON "ClassAssignment"("classId");
CREATE INDEX IF NOT EXISTS "ClassTest_classId_idx" ON "ClassTest"("classId");
CREATE INDEX IF NOT EXISTS "ClassAbsence_classId_idx" ON "ClassAbsence"("classId");
CREATE INDEX IF NOT EXISTS "GoalMilestone_goalId_idx" ON "GoalMilestone"("goalId");
CREATE INDEX IF NOT EXISTS "VideoGroup_userId_idx" ON "VideoGroup"("userId");
CREATE INDEX IF NOT EXISTS "ArchiveVideo_userId_idx" ON "ArchiveVideo"("userId");
CREATE INDEX IF NOT EXISTS "ArchiveVideo_groupId_idx" ON "ArchiveVideo"("groupId");
CREATE UNIQUE INDEX IF NOT EXISTS "ArchiveVideo_userId_youtubeId_key" ON "ArchiveVideo"("userId", "youtubeId");

-- Foreign keys (idempotent)
DO $$ BEGIN ALTER TABLE "LearningCourse" ADD CONSTRAINT "LearningCourse_linkedGoalId_fkey" FOREIGN KEY ("linkedGoalId") REFERENCES "LearningGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "LearningResource" ADD CONSTRAINT "LearningResource_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "LearningGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "LearningClass" ADD CONSTRAINT "LearningClass_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ClassAssignment" ADD CONSTRAINT "ClassAssignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "LearningClass"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ClassTest" ADD CONSTRAINT "ClassTest_classId_fkey" FOREIGN KEY ("classId") REFERENCES "LearningClass"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ClassAbsence" ADD CONSTRAINT "ClassAbsence_classId_fkey" FOREIGN KEY ("classId") REFERENCES "LearningClass"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "GoalMilestone" ADD CONSTRAINT "GoalMilestone_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "LearningGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "VideoGroup" ADD CONSTRAINT "VideoGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ArchiveVideo" ADD CONSTRAINT "ArchiveVideo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ArchiveVideo" ADD CONSTRAINT "ArchiveVideo_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "VideoGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
