-- AlterEnum
ALTER TYPE "DocumentRequirementStatus" ADD VALUE 'NOT_APPLICABLE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProtocolEventType" ADD VALUE 'PAID';
ALTER TYPE "ProtocolEventType" ADD VALUE 'UNPAID';
ALTER TYPE "ProtocolEventType" ADD VALUE 'AMOUNT_CHANGED';
ALTER TYPE "ProtocolEventType" ADD VALUE 'REPLACED';
ALTER TYPE "ProtocolEventType" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "protocol_events" ADD COLUMN     "detail" TEXT,
ADD COLUMN     "previousAttachmentId" TEXT;

-- AlterTable
ALTER TABLE "protocols" ADD COLUMN     "amount" DECIMAL(12,2),
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "competence" TIMESTAMP(3),
ADD COLUMN     "deliverableId" TEXT,
ADD COLUMN     "fileUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "paidAmount" DECIMAL(12,2),
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paidByClientUserId" TEXT,
ADD COLUMN     "paymentProofAttachmentId" TEXT,
ADD COLUMN     "requiresPayment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "recurring_task_template_documents" ADD COLUMN     "requiresPayment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "task_deliverables" ADD COLUMN     "amount" DECIMAL(12,2),
ADD COLUMN     "paymentDueDate" TIMESTAMP(3),
ADD COLUMN     "requiresPayment" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "protocols_paymentProofAttachmentId_key" ON "protocols"("paymentProofAttachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "protocols_deliverableId_key" ON "protocols"("deliverableId");

-- CreateIndex
CREATE INDEX "protocols_organizationId_requiresPayment_paidAt_idx" ON "protocols"("organizationId", "requiresPayment", "paidAt");

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_paidByClientUserId_fkey" FOREIGN KEY ("paidByClientUserId") REFERENCES "client_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_paymentProofAttachmentId_fkey" FOREIGN KEY ("paymentProofAttachmentId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "task_deliverables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

