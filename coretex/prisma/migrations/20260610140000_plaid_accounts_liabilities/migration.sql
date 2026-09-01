-- Plaid Accounts + Liabilities sync fields

ALTER TABLE "PlaidItem" ADD COLUMN "lastAccountsSyncAt" TIMESTAMP(3);

ALTER TABLE "PlaidAccount" ADD COLUMN "balanceCurrent" DECIMAL(14,2);
ALTER TABLE "PlaidAccount" ADD COLUMN "balanceAvailable" DECIMAL(14,2);
ALTER TABLE "PlaidAccount" ADD COLUMN "balanceLimit" DECIMAL(14,2);
ALTER TABLE "PlaidAccount" ADD COLUMN "lastBalanceSyncAt" TIMESTAMP(3);

ALTER TABLE "CreditCard" ADD COLUMN "minimumPayment" DECIMAL(12,2);
ALTER TABLE "CreditCard" ADD COLUMN "paymentDueAt" DATE;
ALTER TABLE "CreditCard" ADD COLUMN "lastPaymentAmount" DECIMAL(12,2);
ALTER TABLE "CreditCard" ADD COLUMN "paymentOverdue" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CreditCard" ADD COLUMN "lastStatementBalance" DECIMAL(12,2);

ALTER TABLE "FinTransaction" ADD COLUMN "plaidCategory" TEXT;
