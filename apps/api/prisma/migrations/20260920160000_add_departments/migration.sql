-- CreateTable
CREATE TABLE "departments" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "departments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "departments_organizationId_name_key" UNIQUE ("organizationId", "name")
);

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable client_assignments: drop old (clientId, userId) uniqueness, add departmentId
ALTER TABLE "client_assignments" DROP CONSTRAINT "client_assignments_clientId_userId_key";

ALTER TABLE "client_assignments" ADD COLUMN "departmentId" TEXT NOT NULL;

ALTER TABLE "client_assignments"
  ADD CONSTRAINT "client_assignments_clientId_departmentId_key" UNIQUE ("clientId", "departmentId");

ALTER TABLE "client_assignments"
  ADD CONSTRAINT "client_assignments_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable tasks
ALTER TABLE "tasks" ADD COLUMN "departmentId" TEXT;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable requests
ALTER TABLE "requests" ADD COLUMN "departmentId" TEXT;

ALTER TABLE "requests"
  ADD CONSTRAINT "requests_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
