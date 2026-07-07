-- Soft delete fields for attachments audit trail
ALTER TABLE "attachments" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "attachments" ADD COLUMN "deletedBy" TEXT;
ALTER TABLE "attachments" ADD COLUMN "deletedByClient" TEXT;
ALTER TABLE "attachments" ADD COLUMN "deletedByName" TEXT;
