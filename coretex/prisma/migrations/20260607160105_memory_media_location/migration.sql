-- AlterTable
ALTER TABLE "SocialMemory" ADD COLUMN     "location" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "SocialMemoryMedia" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialMemoryMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialMemoryMedia_memoryId_idx" ON "SocialMemoryMedia"("memoryId");

-- AddForeignKey
ALTER TABLE "SocialMemoryMedia" ADD CONSTRAINT "SocialMemoryMedia_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "SocialMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

