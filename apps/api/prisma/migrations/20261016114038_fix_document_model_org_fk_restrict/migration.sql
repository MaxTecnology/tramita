-- DropForeignKey
ALTER TABLE "document_models" DROP CONSTRAINT "document_models_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "tax_obligation_types" DROP CONSTRAINT "tax_obligation_types_organizationId_fkey";

-- AddForeignKey
ALTER TABLE "tax_obligation_types" ADD CONSTRAINT "tax_obligation_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_models" ADD CONSTRAINT "document_models_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
