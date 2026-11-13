-- AlterEnum
ALTER TYPE "NotificationEvent" ADD VALUE 'TASK_ASSUMED';

-- AlterTable
ALTER TABLE "notification_configs" ADD COLUMN     "taskAssumed" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "seesDepartmentWork" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "user_departments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_departments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_departments_departmentId_idx" ON "user_departments"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "user_departments_userId_departmentId_key" ON "user_departments"("userId", "departmentId");

-- AddForeignKey
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every existing responsibility (client, department) makes its staff member a member of
-- that department. Staff without responsibilities stays without departments (admin completes it).
INSERT INTO "user_departments" ("id", "userId", "departmentId", "createdAt")
SELECT DISTINCT ON (ca."userId", ca."departmentId") gen_random_uuid()::text, ca."userId", ca."departmentId", now()
FROM "client_assignments" ca
ON CONFLICT ("userId", "departmentId") DO NOTHING;
