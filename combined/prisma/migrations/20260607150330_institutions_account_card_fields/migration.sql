-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('CREDIT', 'DEBIT', 'CHARGE', 'PREPAID', 'OTHER');

-- AlterEnum
ALTER TYPE "FinAccountKind" ADD VALUE 'MONEY_MARKET';

-- AlterTable
ALTER TABLE "CreditCard" ADD COLUMN     "branchLocation" TEXT,
ADD COLUMN     "cardNumber" TEXT,
ADD COLUMN     "cardType" "CardType" NOT NULL DEFAULT 'CREDIT',
ADD COLUMN     "cvv" TEXT,
ADD COLUMN     "expMonth" INTEGER,
ADD COLUMN     "expYear" INTEGER,
ADD COLUMN     "institutionId" TEXT,
ADD COLUMN     "nickname" TEXT;

-- AlterTable
ALTER TABLE "FinAccount" ADD COLUMN     "accountNumber" TEXT,
ADD COLUMN     "branchLocation" TEXT,
ADD COLUMN     "institutionId" TEXT,
ADD COLUMN     "routingNumber" TEXT;

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstitutionPhone" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phone" TEXT NOT NULL,

    CONSTRAINT "InstitutionPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstitutionEmail" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "InstitutionEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstitutionContact" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,

    CONSTRAINT "InstitutionContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_FinAccountOwners" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FinAccountOwners_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_CreditCardOwners" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CreditCardOwners_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Institution_userId_name_key" ON "Institution"("userId", "name");

-- CreateIndex
CREATE INDEX "InstitutionPhone_institutionId_idx" ON "InstitutionPhone"("institutionId");

-- CreateIndex
CREATE INDEX "InstitutionEmail_institutionId_idx" ON "InstitutionEmail"("institutionId");

-- CreateIndex
CREATE INDEX "InstitutionContact_institutionId_idx" ON "InstitutionContact"("institutionId");

-- CreateIndex
CREATE INDEX "_FinAccountOwners_B_index" ON "_FinAccountOwners"("B");

-- CreateIndex
CREATE INDEX "_CreditCardOwners_B_index" ON "_CreditCardOwners"("B");

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstitutionPhone" ADD CONSTRAINT "InstitutionPhone_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstitutionEmail" ADD CONSTRAINT "InstitutionEmail_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstitutionContact" ADD CONSTRAINT "InstitutionContact_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinAccount" ADD CONSTRAINT "FinAccount_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditCard" ADD CONSTRAINT "CreditCard_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FinAccountOwners" ADD CONSTRAINT "_FinAccountOwners_A_fkey" FOREIGN KEY ("A") REFERENCES "FinAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FinAccountOwners" ADD CONSTRAINT "_FinAccountOwners_B_fkey" FOREIGN KEY ("B") REFERENCES "SocialContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CreditCardOwners" ADD CONSTRAINT "_CreditCardOwners_A_fkey" FOREIGN KEY ("A") REFERENCES "CreditCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CreditCardOwners" ADD CONSTRAINT "_CreditCardOwners_B_fkey" FOREIGN KEY ("B") REFERENCES "SocialContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

