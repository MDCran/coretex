-- CreateEnum
CREATE TYPE "ReminderCadence" AS ENUM ('ONCE', 'EVERY_N_DAYS', 'WEEKLY', 'MONTHLY_ON_DAY', 'EVERY_N_MONTHS');

-- CreateTable
CREATE TABLE "RecurringReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "icon" TEXT,
    "contactId" TEXT,
    "phone" TEXT,
    "link" TEXT,
    "cadence" "ReminderCadence" NOT NULL DEFAULT 'ONCE',
    "intervalN" INTEGER,
    "dayOfMonth" INTEGER,
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "lastCompletedAt" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT,
    "channel" TEXT,
    "body" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringReminder_userId_nextDueAt_archived_idx" ON "RecurringReminder"("userId", "nextDueAt", "archived");

-- CreateIndex
CREATE INDEX "OutreachDraft_userId_dueAt_idx" ON "OutreachDraft"("userId", "dueAt");

-- AddForeignKey
ALTER TABLE "RecurringReminder" ADD CONSTRAINT "RecurringReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringReminder" ADD CONSTRAINT "RecurringReminder_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "SocialContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDraft" ADD CONSTRAINT "OutreachDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDraft" ADD CONSTRAINT "OutreachDraft_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "SocialContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
