-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FinAccountKind" ADD VALUE 'CD';
ALTER TYPE "FinAccountKind" ADD VALUE 'BROKERAGE';

-- AlterTable
ALTER TABLE "FinAccount" ADD COLUMN     "alpacaLinked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Holding" ADD COLUMN     "finAccountId" TEXT,
ALTER COLUMN "brokerageAccountId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Holding_finAccountId_idx" ON "Holding"("finAccountId");

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_finAccountId_fkey" FOREIGN KEY ("finAccountId") REFERENCES "FinAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

