-- CreateEnum
CREATE TYPE "CardRewardType" AS ENUM ('PERCENT', 'POINTS', 'MILES', 'CASHBACK');

-- CreateTable
CREATE TABLE "CardReward" (
    "id" TEXT NOT NULL,
    "creditCardId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" "CardRewardType" NOT NULL DEFAULT 'PERCENT',
    "rate" DOUBLE PRECISION NOT NULL,
    "cap" TEXT,
    "notes" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CardReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardPerk" (
    "id" TEXT NOT NULL,
    "creditCardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CardPerk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardReward_creditCardId_idx" ON "CardReward"("creditCardId");

-- CreateIndex
CREATE INDEX "CardPerk_creditCardId_idx" ON "CardPerk"("creditCardId");

-- AddForeignKey
ALTER TABLE "CardReward" ADD CONSTRAINT "CardReward_creditCardId_fkey" FOREIGN KEY ("creditCardId") REFERENCES "CreditCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardPerk" ADD CONSTRAINT "CardPerk_creditCardId_fkey" FOREIGN KEY ("creditCardId") REFERENCES "CreditCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

