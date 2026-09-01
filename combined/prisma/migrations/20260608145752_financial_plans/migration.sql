-- CreateEnum
CREATE TYPE "FinancialPlanKind" AS ENUM ('ACCOUNT', 'CARD', 'BROKERAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "FinancialPlanStatus" AS ENUM ('PLANNED', 'OPENED', 'DISMISSED');

-- CreateTable
CREATE TABLE "FinancialPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "FinancialPlanKind" NOT NULL DEFAULT 'CARD',
    "name" TEXT NOT NULL,
    "institutionName" TEXT,
    "accountKind" "FinAccountKind",
    "cardType" "CardType",
    "targetDate" DATE,
    "reason" TEXT,
    "expectedAnnualFee" DECIMAL(12,2),
    "expectedBonus" TEXT,
    "notes" TEXT,
    "status" "FinancialPlanStatus" NOT NULL DEFAULT 'PLANNED',
    "finAccountId" TEXT,
    "creditCardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialPlan_userId_status_targetDate_idx" ON "FinancialPlan"("userId", "status", "targetDate");

-- AddForeignKey
ALTER TABLE "FinancialPlan" ADD CONSTRAINT "FinancialPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialPlan" ADD CONSTRAINT "FinancialPlan_finAccountId_fkey" FOREIGN KEY ("finAccountId") REFERENCES "FinAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialPlan" ADD CONSTRAINT "FinancialPlan_creditCardId_fkey" FOREIGN KEY ("creditCardId") REFERENCES "CreditCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

