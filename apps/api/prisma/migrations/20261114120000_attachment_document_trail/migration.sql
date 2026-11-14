-- CreateEnum
CREATE TYPE "AttachmentReview" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'REPLACED');

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "requirementId" TEXT,
ADD COLUMN     "reviewStatus" "AttachmentReview",
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "uploadedByClientUserId" TEXT;

-- CreateIndex
CREATE INDEX "attachments_requirementId_idx" ON "attachments"("requirementId");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "task_document_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadedByClientUserId_fkey" FOREIGN KEY ("uploadedByClientUserId") REFERENCES "client_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: the file currently linked to each request gets its request and review state (older
-- versions of a request cannot be told apart and stay without a trail)
UPDATE "attachments" a SET
  "requirementId" = r."id",
  "reviewStatus" = (CASE r."status" WHEN 'APPROVED' THEN 'APPROVED' WHEN 'REJECTED' THEN 'REJECTED' ELSE 'PENDING_REVIEW' END)::"AttachmentReview",
  "rejectionReason" = CASE WHEN r."status" = 'REJECTED' THEN r."rejectionReason" END,
  "reviewedAt" = CASE WHEN r."status" IN ('APPROVED', 'REJECTED') THEN r."reviewedAt" END,
  "reviewedById" = CASE WHEN r."status" IN ('APPROVED', 'REJECTED') THEN r."reviewedById" END
FROM "task_document_requirements" r
WHERE r."attachmentId" = a."id";
