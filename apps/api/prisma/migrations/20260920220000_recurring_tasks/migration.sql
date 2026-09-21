-- WARNING: this migration alters the "TaskStatus" enum by REMOVING values
-- (IN_PROGRESS, REVIEW, CANCELLED). Postgres has no direct "DROP VALUE" for
-- enums, so this uses the standard recreate-type dance below. Verified empty
-- "tasks" table in dev/test before writing this (2026-09-20) — if this ever
-- runs against an environment with existing rows using the removed values,
-- add a remap UPDATE (e.g. IN_PROGRESS/REVIEW -> OPEN, CANCELLED ->
-- DISREGARDED) BEFORE the type swap, or the USING cast below will fail.

-- AlterEnum (TaskStatus: OPEN/IN_PROGRESS/REVIEW/DONE/CANCELLED -> OPEN/DONE/DISREGARDED/BLOCKED)
BEGIN;
CREATE TYPE "TaskStatus_new" AS ENUM ('OPEN', 'DONE', 'DISREGARDED', 'BLOCKED');
ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "tasks" ALTER COLUMN "status" TYPE "TaskStatus_new" USING ("status"::text::"TaskStatus_new");
ALTER TYPE "TaskStatus" RENAME TO "TaskStatus_old";
ALTER TYPE "TaskStatus_new" RENAME TO "TaskStatus";
DROP TYPE "TaskStatus_old";
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'OPEN';
COMMIT;

-- AlterEnum (NotificationEvent: add 2 values — Postgres supports ADD VALUE directly)
ALTER TYPE "NotificationEvent" ADD VALUE 'RECURRING_GENERATION_FAILED';
ALTER TYPE "NotificationEvent" ADD VALUE 'DOCUMENT_REJECTED';

-- CreateEnum
CREATE TYPE "RecurrencePeriodicity" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentRequirementStatus" AS ENUM ('PENDING', 'UPLOADED', 'APPROVED', 'REJECTED');

-- AlterTable tasks: creatorId becomes optional, new columns
ALTER TABLE "tasks" ALTER COLUMN "creatorId" DROP NOT NULL;
ALTER TABLE "tasks" ADD COLUMN "competence" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "targetDate" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "recurringTemplateId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "visibleToClient" BOOLEAN NOT NULL DEFAULT true;

-- Re-point tasks_creatorId_fkey: was ON DELETE RESTRICT (required relation),
-- now optional -> Prisma's default for an optional relation with no explicit
-- onDelete is SET NULL (matches tasks_departmentId_fkey precedent from the
-- 20260920160000_add_departments migration).
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_creatorId_fkey";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tasks_competence_idx" ON "tasks"("competence");
CREATE INDEX "tasks_targetDate_idx" ON "tasks"("targetDate");

-- AlterTable notification_configs
ALTER TABLE "notification_configs" ADD COLUMN "recurringGenerationFailed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "notification_configs" ADD COLUMN "documentRejected" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable recurring_task_templates
CREATE TABLE "recurring_task_templates" (
  "id"                              TEXT NOT NULL,
  "organizationId"                  TEXT NOT NULL,
  "departmentId"                    TEXT NOT NULL,
  "title"                           TEXT NOT NULL,
  "description"                     TEXT,
  "periodicity"                     "RecurrencePeriodicity" NOT NULL,
  "dueMonthOffset"                  INTEGER NOT NULL DEFAULT 0,
  "dueDayOfPeriod"                  INTEGER NOT NULL,
  "dueRollToBusinessDay"            BOOLEAN NOT NULL DEFAULT false,
  "targetOffsetDays"                INTEGER NOT NULL DEFAULT 0,
  "targetRollToBusinessDay"         BOOLEAN NOT NULL DEFAULT false,
  "generationMonthOffset"           INTEGER NOT NULL DEFAULT 1,
  "generationDayOfPeriod"           INTEGER NOT NULL,
  "autoCompleteOnAllActivitiesDone" BOOLEAN NOT NULL DEFAULT false,
  "notifyViaWhatsapp"               BOOLEAN NOT NULL DEFAULT true,
  "notifyViaEmail"                  BOOLEAN NOT NULL DEFAULT false,
  "visibleToClient"                 BOOLEAN NOT NULL DEFAULT true,
  "isActive"                        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"                       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recurring_task_templates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "recurring_task_templates"
  ADD CONSTRAINT "recurring_task_templates_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_task_templates"
  ADD CONSTRAINT "recurring_task_templates_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable recurring_task_template_documents
CREATE TABLE "recurring_task_template_documents" (
  "id"                 TEXT NOT NULL,
  "requestTemplateId"  TEXT,
  "deliveryTemplateId" TEXT,
  "name"               TEXT NOT NULL,
  "position"           INTEGER NOT NULL,

  CONSTRAINT "recurring_task_template_documents_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "recurring_task_template_documents"
  ADD CONSTRAINT "recurring_task_template_documents_requestTemplateId_fkey"
    FOREIGN KEY ("requestTemplateId") REFERENCES "recurring_task_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_task_template_documents"
  ADD CONSTRAINT "recurring_task_template_documents_deliveryTemplateId_fkey"
    FOREIGN KEY ("deliveryTemplateId") REFERENCES "recurring_task_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable recurring_task_assignments
CREATE TABLE "recurring_task_assignments" (
  "id"         TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "clientId"   TEXT NOT NULL,
  "boardId"    TEXT NOT NULL,
  "columnId"   TEXT NOT NULL,
  "isActive"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "recurring_task_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recurring_task_assignments_templateId_clientId_key" UNIQUE ("templateId", "clientId")
);

ALTER TABLE "recurring_task_assignments"
  ADD CONSTRAINT "recurring_task_assignments_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "recurring_task_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_task_assignments"
  ADD CONSTRAINT "recurring_task_assignments_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_task_assignments"
  ADD CONSTRAINT "recurring_task_assignments_boardId_fkey"
    FOREIGN KEY ("boardId") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_task_assignments"
  ADD CONSTRAINT "recurring_task_assignments_columnId_fkey"
    FOREIGN KEY ("columnId") REFERENCES "columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable recurring_generation_logs
CREATE TABLE "recurring_generation_logs" (
  "id"           TEXT NOT NULL,
  "templateId"   TEXT NOT NULL,
  "clientId"     TEXT NOT NULL,
  "competence"   TIMESTAMP(3) NOT NULL,
  "status"       "GenerationStatus" NOT NULL,
  "taskId"       TEXT,
  "errorMessage" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "recurring_generation_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recurring_generation_logs_templateId_clientId_competence_key" UNIQUE ("templateId", "clientId", "competence")
);

ALTER TABLE "recurring_generation_logs"
  ADD CONSTRAINT "recurring_generation_logs_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "recurring_task_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable task_document_requirements
CREATE TABLE "task_document_requirements" (
  "id"              TEXT NOT NULL,
  "taskId"          TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "status"          "DocumentRequirementStatus" NOT NULL DEFAULT 'PENDING',
  "attachmentId"    TEXT,
  "rejectionReason" TEXT,
  "reviewedById"    TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "position"        INTEGER NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "task_document_requirements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_document_requirements_attachmentId_key" UNIQUE ("attachmentId")
);

ALTER TABLE "task_document_requirements"
  ADD CONSTRAINT "task_document_requirements_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_document_requirements"
  ADD CONSTRAINT "task_document_requirements_attachmentId_fkey"
    FOREIGN KEY ("attachmentId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_document_requirements"
  ADD CONSTRAINT "task_document_requirements_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable task_deliverables
CREATE TABLE "task_deliverables" (
  "id"            TEXT NOT NULL,
  "taskId"        TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "attachmentId"  TEXT,
  "deliveredById" TEXT,
  "deliveredAt"   TIMESTAMP(3),
  "position"      INTEGER NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "task_deliverables_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_deliverables_attachmentId_key" UNIQUE ("attachmentId")
);

ALTER TABLE "task_deliverables"
  ADD CONSTRAINT "task_deliverables_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_deliverables"
  ADD CONSTRAINT "task_deliverables_attachmentId_fkey"
    FOREIGN KEY ("attachmentId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_deliverables"
  ADD CONSTRAINT "task_deliverables_deliveredById_fkey"
    FOREIGN KEY ("deliveredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable tasks: FK to recurring_task_templates (added last since the referenced table now exists)
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_recurringTemplateId_fkey"
    FOREIGN KEY ("recurringTemplateId") REFERENCES "recurring_task_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
