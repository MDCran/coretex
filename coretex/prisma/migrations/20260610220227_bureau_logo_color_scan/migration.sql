-- CreateEnum
CREATE TYPE "CreditBureau" AS ENUM ('EQUIFAX', 'EXPERIAN', 'TRANSUNION');

-- AlterTable
ALTER TABLE "BudgetCategory" ADD COLUMN     "color" TEXT;

-- AlterTable
ALTER TABLE "CreditScoreEntry" ADD COLUMN     "bureau" "CreditBureau",
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "Institution" ADD COLUMN     "logoKey" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "lastSubscriptionScanAt" TIMESTAMP(3);

