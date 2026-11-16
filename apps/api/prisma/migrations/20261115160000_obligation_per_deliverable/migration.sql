-- ONE-SHOT migration (do not reuse the backfill after the form saves obligations per delivery: the
-- filters below rely on the new columns being empty when it runs).
-- Robot per delivery: the obligation the document reader recognizes moves from the whole template to
-- each document the office delivers (a payroll template delivers payslips, FGTS and INSS guides).

-- AlterTable
ALTER TABLE "recurring_task_template_documents" ADD COLUMN "obligationTypeId" TEXT;
ALTER TABLE "task_deliverables" ADD COLUMN "obligationTypeId" TEXT;
ALTER TABLE "received_documents" ADD COLUMN "deliverableId" TEXT;

-- Backfill: a template with an obligation and exactly ONE delivery hands the obligation to that
-- delivery and to the open (not delivered) deliverables of the tasks it generated. With zero or
-- several deliveries it cannot be told which one the robot fills: the office marks it in the form.
WITH single AS (
  SELECT t."id" AS template_id, t."obligationTypeId", min(d."id") AS doc_id
  FROM "recurring_task_templates" t
  JOIN "recurring_task_template_documents" d ON d."deliveryTemplateId" = t."id"
  WHERE t."obligationTypeId" IS NOT NULL
  GROUP BY t."id", t."obligationTypeId"
  HAVING count(*) = 1
)
UPDATE "recurring_task_template_documents" d SET "obligationTypeId" = s."obligationTypeId"
FROM single s WHERE d."id" = s.doc_id;

UPDATE "task_deliverables" td SET "obligationTypeId" = d."obligationTypeId"
FROM "tasks" tk, "recurring_task_template_documents" d
WHERE td."taskId" = tk."id"
  AND d."deliveryTemplateId" = tk."recurringTemplateId"
  AND d."obligationTypeId" IS NOT NULL
  AND td."name" = d."name"
  AND td."deliveredAt" IS NULL;

-- The obligation no longer lives on the template
ALTER TABLE "recurring_task_templates" DROP CONSTRAINT "recurring_task_templates_obligationTypeId_fkey";
ALTER TABLE "recurring_task_templates" DROP COLUMN "obligationTypeId";

-- AddForeignKey
ALTER TABLE "recurring_task_template_documents" ADD CONSTRAINT "recurring_task_template_documents_obligationTypeId_fkey" FOREIGN KEY ("obligationTypeId") REFERENCES "obligation_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_deliverables" ADD CONSTRAINT "task_deliverables_obligationTypeId_fkey" FOREIGN KEY ("obligationTypeId") REFERENCES "obligation_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "received_documents" ADD CONSTRAINT "received_documents_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "task_deliverables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex (SET NULL from task_deliverables deletes)
CREATE INDEX "received_documents_deliverableId_idx" ON "received_documents"("deliverableId");
