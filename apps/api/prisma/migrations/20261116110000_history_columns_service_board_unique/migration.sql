-- Move history keeps the column ids (stage times survive a column rename)
ALTER TABLE "task_history" ADD COLUMN     "fromColumnId" TEXT,
ADD COLUMN     "toColumnId" TEXT;

-- One services board per client (two first OS at the same time created two). Partial index: Prisma
-- cannot express it in the schema; SERVICE_SYSTEM is new, so no existing row can violate it.
CREATE UNIQUE INDEX "boards_client_service_system_key" ON "boards"("clientId") WHERE "type" = 'SERVICE_SYSTEM';
