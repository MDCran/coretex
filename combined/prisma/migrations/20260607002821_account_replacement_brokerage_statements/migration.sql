-- AlterTable
ALTER TABLE "CreditCard" ADD COLUMN     "replacedById" TEXT;

-- AlterTable
ALTER TABLE "FinAccount" ADD COLUMN     "replacedById" TEXT;

-- AlterTable
ALTER TABLE "FinStatement" ADD COLUMN     "brokerageAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "FinAccount" ADD CONSTRAINT "FinAccount_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "FinAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditCard" ADD CONSTRAINT "CreditCard_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "CreditCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinStatement" ADD CONSTRAINT "FinStatement_brokerageAccountId_fkey" FOREIGN KEY ("brokerageAccountId") REFERENCES "BrokerageAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

