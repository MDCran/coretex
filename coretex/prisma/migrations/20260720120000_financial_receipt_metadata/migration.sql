ALTER TABLE "FinTransaction"
    ADD COLUMN IF NOT EXISTS "receiptFileName" TEXT,
    ADD COLUMN IF NOT EXISTS "receiptMimeType" TEXT;
