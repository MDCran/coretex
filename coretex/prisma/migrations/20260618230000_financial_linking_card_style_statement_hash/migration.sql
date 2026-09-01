ALTER TABLE "PlaidAccount"
    ADD COLUMN IF NOT EXISTS "balanceCurrent" DECIMAL(14, 2),
    ADD COLUMN IF NOT EXISTS "balanceAvailable" DECIMAL(14, 2),
    ADD COLUMN IF NOT EXISTS "balanceLimit" DECIMAL(14, 2),
    ADD COLUMN IF NOT EXISTS "lastBalanceSyncAt" TIMESTAMP(3);

ALTER TABLE "CreditCard"
    ADD COLUMN IF NOT EXISTS "cardStyle" TEXT,
    ADD COLUMN IF NOT EXISTS "cardImageKey" TEXT;

ALTER TABLE "FinStatement"
    ADD COLUMN IF NOT EXISTS "fileSha256" TEXT;

CREATE INDEX IF NOT EXISTS "FinStatement_userId_fileSha256_idx"
    ON "FinStatement"("userId", "fileSha256");
