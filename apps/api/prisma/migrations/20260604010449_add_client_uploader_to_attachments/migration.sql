-- DropForeignKey
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_uploadedBy_fkey";

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "uploadedByClient" TEXT,
ALTER COLUMN "uploadedBy" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadedByClient_fkey" FOREIGN KEY ("uploadedByClient") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
