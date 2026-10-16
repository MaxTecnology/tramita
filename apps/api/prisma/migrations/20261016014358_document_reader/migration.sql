-- CreateEnum
CREATE TYPE "ReceivedDocumentStatus" AS ENUM ('PENDING', 'ATTACHED', 'NOT_IDENTIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "caepf" TEXT,
ADD COLUMN     "cei" TEXT,
ADD COLUMN     "inscricaoEstadual" TEXT;

-- AlterTable
ALTER TABLE "recurring_task_templates" ADD COLUMN     "taxObligationTypeId" TEXT;

-- CreateTable
CREATE TABLE "tax_obligation_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_obligation_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_models" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "taxObligationTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "definicao" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "received_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "attachmentId" TEXT,
    "fileHash" TEXT NOT NULL,
    "documentNumber" TEXT,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "status" "ReceivedDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "documentModelId" TEXT,
    "modelVersion" INTEGER,
    "confidence" DOUBLE PRECISION,
    "extractedFields" JSONB,
    "taskId" TEXT,
    "how" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "received_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_obligation_types_organizationId_code_key" ON "tax_obligation_types"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "received_documents_attachmentId_key" ON "received_documents"("attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "received_documents_organizationId_fileHash_key" ON "received_documents"("organizationId", "fileHash");

-- AddForeignKey
ALTER TABLE "recurring_task_templates" ADD CONSTRAINT "recurring_task_templates_taxObligationTypeId_fkey" FOREIGN KEY ("taxObligationTypeId") REFERENCES "tax_obligation_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_obligation_types" ADD CONSTRAINT "tax_obligation_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_obligation_types" ADD CONSTRAINT "tax_obligation_types_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_models" ADD CONSTRAINT "document_models_taxObligationTypeId_fkey" FOREIGN KEY ("taxObligationTypeId") REFERENCES "tax_obligation_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_models" ADD CONSTRAINT "document_models_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_models" ADD CONSTRAINT "document_models_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "received_documents" ADD CONSTRAINT "received_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "received_documents" ADD CONSTRAINT "received_documents_documentModelId_fkey" FOREIGN KEY ("documentModelId") REFERENCES "document_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "received_documents" ADD CONSTRAINT "received_documents_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "received_documents" ADD CONSTRAINT "received_documents_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "received_documents" ADD CONSTRAINT "received_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "received_documents" ADD CONSTRAINT "received_documents_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
