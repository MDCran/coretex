-- Dual paper/live Alpaca credentials with an active-mode switch.

ALTER TABLE "AlpacaConnection" ADD COLUMN "paperApiKey" TEXT;
ALTER TABLE "AlpacaConnection" ADD COLUMN "paperApiSecret" TEXT;
ALTER TABLE "AlpacaConnection" ADD COLUMN "liveApiKey" TEXT;
ALTER TABLE "AlpacaConnection" ADD COLUMN "liveApiSecret" TEXT;
ALTER TABLE "AlpacaConnection" ADD COLUMN "activePaper" BOOLEAN NOT NULL DEFAULT true;

UPDATE "AlpacaConnection"
SET
  "paperApiKey" = CASE WHEN "paper" = true THEN "apiKey" ELSE NULL END,
  "paperApiSecret" = CASE WHEN "paper" = true THEN "apiSecret" ELSE NULL END,
  "liveApiKey" = CASE WHEN "paper" = false THEN "apiKey" ELSE NULL END,
  "liveApiSecret" = CASE WHEN "paper" = false THEN "apiSecret" ELSE NULL END,
  "activePaper" = "paper";

ALTER TABLE "AlpacaConnection" DROP COLUMN "apiKey";
ALTER TABLE "AlpacaConnection" DROP COLUMN "apiSecret";
ALTER TABLE "AlpacaConnection" DROP COLUMN "paper";
