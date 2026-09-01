-- CreateEnum
CREATE TYPE "TodoCadence" AS ENUM ('DAILY', 'EVERY_N_DAYS', 'WEEKLY_DOW', 'YEARLY');

-- AlterEnum
ALTER TYPE "TodoStatus" ADD VALUE 'IN_PROGRESS';

-- AlterTable
ALTER TABLE "TodoItem" ADD COLUMN     "date" DATE,
ADD COLUMN     "routineId" TEXT;

-- CreateTable
CREATE TABLE "TodoRoutine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "cadence" "TodoCadence" NOT NULL DEFAULT 'DAILY',
    "intervalN" INTEGER,
    "daysOfWeek" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "yearlyMonth" INTEGER,
    "yearlyDay" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TodoRoutine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "templateId" TEXT,
    "name" TEXT,
    "notes" TEXT,
    "workoutId" TEXT,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TodoRoutine_userId_active_idx" ON "TodoRoutine"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSchedule_workoutId_key" ON "WorkoutSchedule"("workoutId");

-- CreateIndex
CREATE INDEX "WorkoutSchedule_userId_date_idx" ON "WorkoutSchedule"("userId", "date");

-- CreateIndex
CREATE INDEX "TodoItem_userId_date_idx" ON "TodoItem"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TodoItem_routineId_date_key" ON "TodoItem"("routineId", "date");

-- AddForeignKey
ALTER TABLE "TodoRoutine" ADD CONSTRAINT "TodoRoutine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoItem" ADD CONSTRAINT "TodoItem_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "TodoRoutine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSchedule" ADD CONSTRAINT "WorkoutSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSchedule" ADD CONSTRAINT "WorkoutSchedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSchedule" ADD CONSTRAINT "WorkoutSchedule_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

