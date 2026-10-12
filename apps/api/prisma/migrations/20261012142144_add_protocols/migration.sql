-- CreateEnum
CREATE TYPE "ProtocolStatus" AS ENUM ('SENT', 'VIEWED', 'DOWNLOADED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProtocolEventType" AS ENUM ('SENT', 'VIEWED', 'DOWNLOADED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "NotificationEvent" ADD VALUE 'PROTOCOL_CREATED';

-- AlterTable
ALTER TABLE "notification_configs" ADD COLUMN     "protocolCreated" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "protocolWarningDays" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "protocols" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "attachmentId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "ProtocolStatus" NOT NULL DEFAULT 'SENT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protocols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_events" (
    "id" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "type" "ProtocolEventType" NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorEmail" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protocol_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_counters" (
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "protocol_counters_pkey" PRIMARY KEY ("organizationId","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "protocols_attachmentId_key" ON "protocols"("attachmentId");

-- CreateIndex
CREATE INDEX "protocols_organizationId_status_idx" ON "protocols"("organizationId", "status");

-- CreateIndex
CREATE INDEX "protocols_organizationId_dueDate_idx" ON "protocols"("organizationId", "dueDate");

-- CreateIndex
CREATE INDEX "protocols_clientId_idx" ON "protocols"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "protocols_organizationId_number_key" ON "protocols"("organizationId", "number");

-- CreateIndex
CREATE INDEX "protocol_events_protocolId_createdAt_idx" ON "protocol_events"("protocolId", "createdAt");

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_events" ADD CONSTRAINT "protocol_events_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "protocols"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_counters" ADD CONSTRAINT "protocol_counters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

