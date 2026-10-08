-- AlterTable
ALTER TABLE "notification_configs" ADD COLUMN     "lateClosureThresholdDays" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "completedAt" TIMESTAMP(3);

