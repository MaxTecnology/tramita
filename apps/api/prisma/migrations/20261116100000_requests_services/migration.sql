-- AlterTable
ALTER TABLE "requests" ADD COLUMN     "boardId" TEXT,
ADD COLUMN     "competence" TIMESTAMP(3),
ADD COLUMN     "osModelId" TEXT;

-- CreateIndex
CREATE INDEX "requests_osModelId_idx" ON "requests"("osModelId");

-- CreateIndex
CREATE INDEX "requests_boardId_idx" ON "requests"("boardId");

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_osModelId_fkey" FOREIGN KEY ("osModelId") REFERENCES "os_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "boards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

