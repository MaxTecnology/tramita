-- CreateTable
CREATE TABLE "os_models" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "departmentId" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "visibleToClient" BOOLEAN NOT NULL DEFAULT true,
    "requiresCompetence" BOOLEAN NOT NULL DEFAULT false,
    "deadlineBusinessDays" INTEGER,
    "autoCompleteOnAllDelivered" BOOLEAN NOT NULL DEFAULT false,
    "usableStandalone" BOOLEAN NOT NULL DEFAULT true,
    "usableInProcess" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "os_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "os_model_documents" (
    "id" TEXT NOT NULL,
    "requestModelId" TEXT,
    "deliveryModelId" TEXT,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "requiresPayment" BOOLEAN NOT NULL DEFAULT false,
    "obligationTypeId" TEXT,

    CONSTRAINT "os_model_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "os_models_organizationId_isActive_idx" ON "os_models"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "os_models_departmentId_idx" ON "os_models"("departmentId");

-- CreateIndex
CREATE INDEX "os_model_documents_requestModelId_idx" ON "os_model_documents"("requestModelId");

-- CreateIndex
CREATE INDEX "os_model_documents_deliveryModelId_idx" ON "os_model_documents"("deliveryModelId");

-- CreateIndex
CREATE INDEX "os_model_documents_obligationTypeId_idx" ON "os_model_documents"("obligationTypeId");

-- CreateIndex
CREATE INDEX "boards_processTemplateId_idx" ON "boards"("processTemplateId");

-- CreateIndex
CREATE INDEX "process_template_column_documents_columnId_idx" ON "process_template_column_documents"("columnId");

-- CreateIndex
CREATE INDEX "process_template_columns_templateId_idx" ON "process_template_columns"("templateId");

-- CreateIndex
CREATE INDEX "process_templates_departmentId_idx" ON "process_templates"("departmentId");

-- CreateIndex
CREATE INDEX "requests_processTemplateId_idx" ON "requests"("processTemplateId");

-- AddForeignKey
ALTER TABLE "os_models" ADD CONSTRAINT "os_models_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_models" ADD CONSTRAINT "os_models_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_model_documents" ADD CONSTRAINT "os_model_documents_requestModelId_fkey" FOREIGN KEY ("requestModelId") REFERENCES "os_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_model_documents" ADD CONSTRAINT "os_model_documents_deliveryModelId_fkey" FOREIGN KEY ("deliveryModelId") REFERENCES "os_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_model_documents" ADD CONSTRAINT "os_model_documents_obligationTypeId_fkey" FOREIGN KEY ("obligationTypeId") REFERENCES "obligation_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

