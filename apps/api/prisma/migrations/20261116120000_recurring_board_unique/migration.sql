-- One recurring board per client (concurrent first generations could create two). Partial index:
-- Prisma cannot express it in the schema. Checked before deploy: no client has two recurring boards
-- (SELECT "clientId", count(*) FROM boards WHERE type = 'RECURRING_SYSTEM' GROUP BY 1 HAVING count(*) > 1).
CREATE UNIQUE INDEX "boards_client_recurring_system_key" ON "boards"("clientId") WHERE "type" = 'RECURRING_SYSTEM';
