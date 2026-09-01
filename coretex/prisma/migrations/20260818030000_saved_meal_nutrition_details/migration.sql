ALTER TABLE "SavedMealItem"
ADD COLUMN "productId" TEXT,
ADD COLUMN "source" "FoodSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "servingSize" TEXT,
ADD COLUMN "quantity" DOUBLE PRECISION,
ADD COLUMN "unit" TEXT,
ADD COLUMN "fiberG" DOUBLE PRECISION,
ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "SavedMealItem_productId_idx" ON "SavedMealItem"("productId");

ALTER TABLE "SavedMealItem"
ADD CONSTRAINT "SavedMealItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "FoodProduct"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
