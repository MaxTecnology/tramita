-- Integrity the Prisma schema cannot express (requested by the migration review)
-- A model document belongs to exactly one list: documents to ask OR documents to deliver
ALTER TABLE "os_model_documents" ADD CONSTRAINT "os_model_documents_one_owner" CHECK (num_nonnulls("requestModelId", "deliveryModelId") = 1);
-- An OS (or template item) never waits for itself; longer cycles are refused by the service
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_not_self" CHECK ("taskId" <> "dependsOnTaskId");
ALTER TABLE "process_template_item_dependencies" ADD CONSTRAINT "process_template_item_dependencies_not_self" CHECK ("itemId" <> "dependsOnItemId");
