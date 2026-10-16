-- Renomeia TaxObligationType -> ObligationType (genérico, não amarrado a "fiscal") — ver decisão
-- com o usuário em 2026-10-16. Ainda em desenvolvimento, sem dados de produção: os únicos dados
-- afetados são os 4 DocumentModel/ObligationType globais semeados via script, que são
-- reconstruídos rodando `pnpm --filter api prisma db seed` depois desta migration.
DELETE FROM "document_models";
DELETE FROM "tax_obligation_types";

-- DropForeignKey
ALTER TABLE "document_models" DROP CONSTRAINT "document_models_taxObligationTypeId_fkey";

-- DropForeignKey
ALTER TABLE "recurring_task_templates" DROP CONSTRAINT "recurring_task_templates_taxObligationTypeId_fkey";

-- DropForeignKey
ALTER TABLE "tax_obligation_types" DROP CONSTRAINT "tax_obligation_types_createdById_fkey";

-- DropForeignKey
ALTER TABLE "tax_obligation_types" DROP CONSTRAINT "tax_obligation_types_organizationId_fkey";

-- AlterTable
ALTER TABLE "document_models" DROP COLUMN "taxObligationTypeId",
ADD COLUMN     "obligationTypeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "recurring_task_templates" DROP COLUMN "taxObligationTypeId",
ADD COLUMN     "obligationTypeId" TEXT;

-- DropTable
DROP TABLE "tax_obligation_types";

-- CreateTable
CREATE TABLE "obligation_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obligation_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "obligation_types_organizationId_code_key" ON "obligation_types"("organizationId", "code");

-- AddForeignKey
ALTER TABLE "recurring_task_templates" ADD CONSTRAINT "recurring_task_templates_obligationTypeId_fkey" FOREIGN KEY ("obligationTypeId") REFERENCES "obligation_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_types" ADD CONSTRAINT "obligation_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_types" ADD CONSTRAINT "obligation_types_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_models" ADD CONSTRAINT "document_models_obligationTypeId_fkey" FOREIGN KEY ("obligationTypeId") REFERENCES "obligation_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
