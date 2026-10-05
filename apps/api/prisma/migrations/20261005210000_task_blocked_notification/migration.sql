-- CreateEnumValue (sozinho, sem uso na mesma migration — ALTER TYPE ... ADD VALUE não pode ser
-- usado e consumido na mesma transação/migration)
ALTER TYPE "NotificationEvent" ADD VALUE 'TASK_BLOCKED';

-- AlterTable
ALTER TABLE "notification_configs" ADD COLUMN "taskBlocked" BOOLEAN NOT NULL DEFAULT true;
