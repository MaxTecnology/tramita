-- CreateEnum
ALTER TYPE "TaskStatus" ADD VALUE 'STARTED';

CREATE TYPE "ColumnStatusEffect" AS ENUM ('NONE', 'OPEN', 'STARTED', 'BLOCKED', 'DISREGARDED', 'DONE');
CREATE TYPE "BoardType" AS ENUM ('OS', 'RECURRING_SYSTEM');

-- AlterTable: columns — isFinal -> statusEffect (backfill preserva o comportamento atual)
ALTER TABLE "columns" ADD COLUMN "statusEffect" "ColumnStatusEffect" NOT NULL DEFAULT 'NONE';
ALTER TABLE "columns" ADD COLUMN "notifyClient" BOOLEAN NOT NULL DEFAULT false;
UPDATE "columns" SET "statusEffect" = 'DONE' WHERE "isFinal" = true;
ALTER TABLE "columns" DROP COLUMN "isFinal";

-- CreateTable
CREATE TABLE "column_documents" (
  "id" TEXT NOT NULL,
  "columnId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "column_documents_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "column_documents" ADD CONSTRAINT "column_documents_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: boards — type + osTemplateId (osTemplateId sem FK ainda, a tabela os_templates nasce na Task 2;
-- adicionar a FK agora quebraria a ordem de migrations — fica como coluna solta até a Task 2 criar a tabela
-- e uma migration própria adicionar a constraint)
ALTER TABLE "boards" ADD COLUMN "type" "BoardType" NOT NULL DEFAULT 'OS';
ALTER TABLE "boards" ADD COLUMN "osTemplateId" TEXT;

-- AlterTable: clients — codigo
ALTER TABLE "clients" ADD COLUMN "codigo" TEXT;
CREATE UNIQUE INDEX "clients_codigo_organizationId_key" ON "clients"("codigo", "organizationId");

-- AlterTable: recurring_task_assignments — perde boardId/columnId
-- (sem dado real pra preservar — ambiente de teste, confirmado)
ALTER TABLE "recurring_task_assignments" DROP CONSTRAINT "recurring_task_assignments_boardId_fkey";
ALTER TABLE "recurring_task_assignments" DROP CONSTRAINT "recurring_task_assignments_columnId_fkey";
ALTER TABLE "recurring_task_assignments" DROP COLUMN "boardId";
ALTER TABLE "recurring_task_assignments" DROP COLUMN "columnId";
