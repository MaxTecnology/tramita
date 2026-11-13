-- CreateEnum
CREATE TYPE "InAppType" AS ENUM ('TASK_COMMENT', 'REQUEST_CREATED', 'REQUEST_COMMENT', 'DOCUMENT_UPLOADED', 'APPROVAL_REQUESTED', 'APPROVAL_DECIDED', 'TASK_ASSUMED', 'TASK_ASSIGNED', 'BOARD_ASSIGNED', 'DOCUMENT_RECEIVED', 'DOCUMENT_REJECTED', 'REQUEST_STATUS');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'CLOSED_BY_OFFICE');

-- CreateEnum
CREATE TYPE "ApprovalCloseReason" AS ENUM ('APPROVED_OUTSIDE', 'NO_RESPONSE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEvent" ADD VALUE 'APPROVAL_REQUESTED';
ALTER TYPE "NotificationEvent" ADD VALUE 'APPROVAL_CHANGES_REQUESTED';

-- AlterTable
ALTER TABLE "notification_configs" ADD COLUMN     "approvalChangesRequested" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "approvalRequested" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "in_app_notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "recipientClientUserId" TEXT,
    "type" "InAppType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "taskId" TEXT,
    "boardId" TEXT,
    "requestId" TEXT,
    "approvalId" TEXT,
    "protocolId" TEXT,
    "clientId" TEXT,
    "actorName" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "in_app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_approvals" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "attachmentId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByClientUserId" TEXT,
    "decidedByUserId" TEXT,
    "decisionNote" TEXT,
    "closeReason" "ApprovalCloseReason",
    "proofAttachmentId" TEXT,
    "waitedDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "in_app_notifications_recipientUserId_readAt_createdAt_idx" ON "in_app_notifications"("recipientUserId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "in_app_notifications_recipientClientUserId_readAt_createdAt_idx" ON "in_app_notifications"("recipientClientUserId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "in_app_notifications_taskId_idx" ON "in_app_notifications"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_approvals_attachmentId_key" ON "task_approvals"("attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "task_approvals_proofAttachmentId_key" ON "task_approvals"("proofAttachmentId");

-- CreateIndex
CREATE INDEX "task_approvals_taskId_status_idx" ON "task_approvals"("taskId", "status");

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_recipientClientUserId_fkey" FOREIGN KEY ("recipientClientUserId") REFERENCES "client_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvals" ADD CONSTRAINT "task_approvals_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvals" ADD CONSTRAINT "task_approvals_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "attachments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvals" ADD CONSTRAINT "task_approvals_proofAttachmentId_fkey" FOREIGN KEY ("proofAttachmentId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvals" ADD CONSTRAINT "task_approvals_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvals" ADD CONSTRAINT "task_approvals_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvals" ADD CONSTRAINT "task_approvals_decidedByClientUserId_fkey" FOREIGN KEY ("decidedByClientUserId") REFERENCES "client_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Exactly one recipient: a staff user or a client user
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_one_recipient"
  CHECK (num_nonnulls("recipientUserId", "recipientClientUserId") = 1);
