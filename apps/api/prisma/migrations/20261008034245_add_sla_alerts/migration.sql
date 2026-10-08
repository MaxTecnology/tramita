-- Remove rows referencing the retired TASK_DUE_DATE_APPROACHING event before the enum swap below
-- (the USING cast fails if any row still holds a value absent from the new enum).
DELETE FROM "notification_logs" WHERE "event" = 'TASK_DUE_DATE_APPROACHING';
DELETE FROM "message_templates" WHERE "event" = 'TASK_DUE_DATE_APPROACHING';

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationEvent_new" AS ENUM ('TASK_CREATED', 'TASK_MOVED', 'TASK_COMPLETED', 'TASK_COMMENT_ADDED', 'TASK_BLOCKED', 'REQUEST_CREATED', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'RECURRING_GENERATION_FAILED', 'DOCUMENT_REJECTED', 'SLA_DIGEST');
ALTER TABLE "message_templates" ALTER COLUMN "event" TYPE "NotificationEvent_new" USING ("event"::text::"NotificationEvent_new");
ALTER TABLE "notification_logs" ALTER COLUMN "event" TYPE "NotificationEvent_new" USING ("event"::text::"NotificationEvent_new");
ALTER TYPE "NotificationEvent" RENAME TO "NotificationEvent_old";
ALTER TYPE "NotificationEvent_new" RENAME TO "NotificationEvent";
DROP TYPE "public"."NotificationEvent_old";
COMMIT;

-- AlterTable
ALTER TABLE "notification_configs" DROP COLUMN "dueDateAlert",
ADD COLUMN     "customSlaSoundKey" TEXT,
ADD COLUMN     "customSlaSoundLabel" TEXT,
ADD COLUMN     "slaDigestEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slaDueCriticalDays" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "slaTargetWarningDays" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "user_sla_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetWarningSound" TEXT NOT NULL DEFAULT 'SOFT_PING',
    "targetWarningVolume" INTEGER NOT NULL DEFAULT 50,
    "dueCriticalSound" TEXT NOT NULL DEFAULT 'BELL',
    "dueCriticalVolume" INTEGER NOT NULL DEFAULT 70,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sla_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_sla_preferences_userId_key" ON "user_sla_preferences"("userId");

-- AddForeignKey
ALTER TABLE "user_sla_preferences" ADD CONSTRAINT "user_sla_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

