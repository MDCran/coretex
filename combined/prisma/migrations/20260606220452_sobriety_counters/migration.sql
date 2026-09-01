-- CreateTable
CREATE TABLE "SobrietyCounter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "icon" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SobrietyCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SobrietyRelapse" (
    "id" TEXT NOT NULL,
    "counterId" TEXT NOT NULL,
    "relapsedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SobrietyRelapse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SobrietyCounter_userId_archived_idx" ON "SobrietyCounter"("userId", "archived");

-- CreateIndex
CREATE INDEX "SobrietyRelapse_counterId_relapsedAt_idx" ON "SobrietyRelapse"("counterId", "relapsedAt");

-- AddForeignKey
ALTER TABLE "SobrietyCounter" ADD CONSTRAINT "SobrietyCounter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SobrietyRelapse" ADD CONSTRAINT "SobrietyRelapse_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "SobrietyCounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
