-- Schedules are materialized repeatedly as the dashboard refreshes. Keep exactly
-- one persisted dose for each schedule instant so adherence never double-counts.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "scheduleId", "scheduledAt"
      ORDER BY
        CASE WHEN "loggedAt" IS NOT NULL OR "skippedAt" IS NOT NULL THEN 0 ELSE 1 END,
        "createdAt" ASC,
        "id" ASC
    ) AS row_number
  FROM "TherapeuticDose"
  WHERE "scheduleId" IS NOT NULL
)
DELETE FROM "TherapeuticDose"
WHERE "id" IN (SELECT "id" FROM ranked WHERE row_number > 1);

CREATE UNIQUE INDEX "TherapeuticDose_scheduleId_scheduledAt_key"
ON "TherapeuticDose"("scheduleId", "scheduledAt");
