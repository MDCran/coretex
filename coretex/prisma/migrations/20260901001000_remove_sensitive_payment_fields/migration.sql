-- Retain only display-safe last-four values, then permanently remove full
-- payment credentials. CVV must never be stored after authorization.
UPDATE "CreditCard"
SET "last4" = CASE
  WHEN LENGTH(REGEXP_REPLACE(COALESCE("last4", ''), '[^0-9]', '', 'g')) >= 4
    THEN RIGHT(REGEXP_REPLACE(COALESCE("last4", ''), '[^0-9]', '', 'g'), 4)
  WHEN LENGTH(REGEXP_REPLACE(COALESCE("cardNumber", ''), '[^0-9]', '', 'g')) >= 4
    THEN RIGHT(REGEXP_REPLACE(COALESCE("cardNumber", ''), '[^0-9]', '', 'g'), 4)
  ELSE NULL
END;

UPDATE "FinAccount"
SET "last4" = CASE
  WHEN LENGTH(REGEXP_REPLACE(COALESCE("last4", ''), '[^0-9]', '', 'g')) >= 4
    THEN RIGHT(REGEXP_REPLACE(COALESCE("last4", ''), '[^0-9]', '', 'g'), 4)
  WHEN LENGTH(REGEXP_REPLACE(COALESCE("accountNumber", ''), '[^0-9]', '', 'g')) >= 4
    THEN RIGHT(REGEXP_REPLACE(COALESCE("accountNumber", ''), '[^0-9]', '', 'g'), 4)
  ELSE NULL
END;

ALTER TABLE "CreditCard"
  DROP COLUMN "cardNumber",
  DROP COLUMN "cvv";

ALTER TABLE "FinAccount"
  DROP COLUMN "accountNumber",
  DROP COLUMN "routingNumber";

ALTER TABLE "CreditCard"
  ADD CONSTRAINT "CreditCard_last4_digits_check"
  CHECK ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$');

ALTER TABLE "FinAccount"
  ADD CONSTRAINT "FinAccount_last4_digits_check"
  CHECK ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$');

ALTER TABLE "CardNumber"
  ADD CONSTRAINT "CardNumber_last4_digits_check"
  CHECK ("last4" ~ '^[0-9]{4}$');
