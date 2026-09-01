-- AlterTable
ALTER TABLE "CareerSalaryEntry" ADD COLUMN     "applicationId" TEXT,
ADD COLUMN     "companyId" TEXT;

-- AddForeignKey
ALTER TABLE "CareerSalaryEntry" ADD CONSTRAINT "CareerSalaryEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerSalaryEntry" ADD CONSTRAINT "CareerSalaryEntry_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

