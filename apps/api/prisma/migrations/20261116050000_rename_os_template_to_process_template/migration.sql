-- "Template de OS" becomes "Modelo de Processo" (an OS is now a single task built from an OSModel;
-- a process is a board assembled from OS). Renames keep the existing data.

-- Board type: OS → PROCESS, plus the per-client board of standalone OS
ALTER TYPE "BoardType" RENAME VALUE 'OS' TO 'PROCESS';
ALTER TYPE "BoardType" ADD VALUE 'SERVICE_SYSTEM';
ALTER TABLE "boards" ALTER COLUMN "type" SET DEFAULT 'PROCESS';

-- Tables
ALTER TABLE "os_templates" RENAME TO "process_templates";
ALTER TABLE "process_templates" RENAME CONSTRAINT "os_templates_pkey" TO "process_templates_pkey";
ALTER TABLE "process_templates" RENAME CONSTRAINT "os_templates_organizationId_fkey" TO "process_templates_organizationId_fkey";

ALTER TABLE "os_template_columns" RENAME TO "process_template_columns";
ALTER TABLE "process_template_columns" RENAME CONSTRAINT "os_template_columns_pkey" TO "process_template_columns_pkey";
ALTER TABLE "process_template_columns" RENAME CONSTRAINT "os_template_columns_templateId_fkey" TO "process_template_columns_templateId_fkey";

ALTER TABLE "os_template_column_documents" RENAME TO "process_template_column_documents";
ALTER TABLE "process_template_column_documents" RENAME CONSTRAINT "os_template_column_documents_pkey" TO "process_template_column_documents_pkey";
ALTER TABLE "process_template_column_documents" RENAME CONSTRAINT "os_template_column_documents_columnId_fkey" TO "process_template_column_documents_columnId_fkey";

-- New template settings
ALTER TABLE "process_templates"
  ADD COLUMN "departmentId" TEXT,
  ADD COLUMN "deadlineBusinessDays" INTEGER,
  ADD COLUMN "clientCanRequest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "process_templates_organizationId_idx" ON "process_templates"("organizationId");

-- Boards
ALTER TABLE "boards" RENAME COLUMN "osTemplateId" TO "processTemplateId";
ALTER TABLE "boards" RENAME CONSTRAINT "boards_osTemplateId_fkey" TO "boards_processTemplateId_fkey";
ALTER TABLE "boards"
  ADD COLUMN "deadlineBusinessDays" INTEGER,
  ADD COLUMN "targetDate" TIMESTAMP(3),
  ADD COLUMN "competence" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "delayReasonId" TEXT,
  ADD COLUMN "delayNote" TEXT,
  ADD COLUMN "delayReasonPending" BOOLEAN NOT NULL DEFAULT false;

-- Requests
ALTER TABLE "requests" RENAME COLUMN "osTemplateId" TO "processTemplateId";
ALTER TABLE "requests" RENAME CONSTRAINT "requests_osTemplateId_fkey" TO "requests_processTemplateId_fkey";
