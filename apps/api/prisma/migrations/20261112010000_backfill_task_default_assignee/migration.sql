-- Open tasks created without an assignee inherit the department's responsible for that client
-- (ClientAssignment.userId) — same rule the app now applies on creation. Closed tasks are left as-is.
UPDATE "tasks" t
SET "assigneeId" = ca."userId"
FROM "columns" c
JOIN "boards" b ON b."id" = c."boardId"
JOIN "client_assignments" ca ON ca."clientId" = b."clientId"
WHERE t."columnId" = c."id"
  AND ca."departmentId" = t."departmentId"
  AND t."assigneeId" IS NULL
  AND t."status" NOT IN ('DONE', 'DISREGARDED');
