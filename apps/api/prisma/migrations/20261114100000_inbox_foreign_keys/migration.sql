-- Orphans first (rows pointing at tasks/requests/processes already deleted), so the FKs can be created
DELETE FROM "in_app_notifications" n WHERE n."taskId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "tasks" t WHERE t."id" = n."taskId");
DELETE FROM "in_app_notifications" n WHERE n."boardId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "boards" b WHERE b."id" = n."boardId");
DELETE FROM "in_app_notifications" n WHERE n."requestId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "requests" r WHERE r."id" = n."requestId");
DELETE FROM "in_app_notifications" n WHERE NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = n."organizationId");
DELETE FROM "task_approvals" a WHERE NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = a."organizationId");

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvals" ADD CONSTRAINT "task_approvals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (FK columns: keeps the cascade from boards/requests cheap)
CREATE INDEX "in_app_notifications_boardId_idx" ON "in_app_notifications"("boardId");
CREATE INDEX "in_app_notifications_requestId_idx" ON "in_app_notifications"("requestId");
