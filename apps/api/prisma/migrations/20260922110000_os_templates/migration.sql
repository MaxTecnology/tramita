CREATE TABLE "os_templates" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "os_templates_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "os_templates" ADD CONSTRAINT "os_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "os_template_columns" (
  "id" TEXT NOT NULL, "templateId" TEXT NOT NULL, "title" TEXT NOT NULL, "position" INTEGER NOT NULL,
  "statusEffect" "ColumnStatusEffect" NOT NULL DEFAULT 'NONE', "notifyClient" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "os_template_columns_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "os_template_columns" ADD CONSTRAINT "os_template_columns_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "os_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "os_template_column_documents" (
  "id" TEXT NOT NULL, "columnId" TEXT NOT NULL, "name" TEXT NOT NULL, "position" INTEGER NOT NULL,
  CONSTRAINT "os_template_column_documents_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "os_template_column_documents" ADD CONSTRAINT "os_template_column_documents_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "os_template_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "boards" ADD CONSTRAINT "boards_osTemplateId_fkey" FOREIGN KEY ("osTemplateId") REFERENCES "os_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "requests" ADD COLUMN "osTemplateId" TEXT;
ALTER TABLE "requests" ADD CONSTRAINT "requests_osTemplateId_fkey" FOREIGN KEY ("osTemplateId") REFERENCES "os_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
