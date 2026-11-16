-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "deadlineBusinessDays" INTEGER,
ADD COLUMN     "delayNote" TEXT,
ADD COLUMN     "delayReasonId" TEXT,
ADD COLUMN     "delayReasonPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "osModelId" TEXT,
ADD COLUMN     "releasedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "process_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "osModelId" TEXT NOT NULL,
    "columnPosition" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "process_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_template_item_dependencies" (
    "itemId" TEXT NOT NULL,
    "dependsOnItemId" TEXT NOT NULL,

    CONSTRAINT "process_template_item_dependencies_pkey" PRIMARY KEY ("itemId","dependsOnItemId")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("taskId","dependsOnTaskId")
);

-- CreateIndex
CREATE INDEX "process_template_items_templateId_idx" ON "process_template_items"("templateId");

-- CreateIndex
CREATE INDEX "process_template_items_osModelId_idx" ON "process_template_items"("osModelId");

-- CreateIndex
CREATE INDEX "process_template_item_dependencies_dependsOnItemId_idx" ON "process_template_item_dependencies"("dependsOnItemId");

-- CreateIndex
CREATE INDEX "task_dependencies_dependsOnTaskId_idx" ON "task_dependencies"("dependsOnTaskId");

-- CreateIndex
CREATE INDEX "tasks_osModelId_idx" ON "tasks"("osModelId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_osModelId_fkey" FOREIGN KEY ("osModelId") REFERENCES "os_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_template_items" ADD CONSTRAINT "process_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "process_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_template_items" ADD CONSTRAINT "process_template_items_osModelId_fkey" FOREIGN KEY ("osModelId") REFERENCES "os_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_template_item_dependencies" ADD CONSTRAINT "process_template_item_dependencies_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "process_template_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_template_item_dependencies" ADD CONSTRAINT "process_template_item_dependencies_dependsOnItemId_fkey" FOREIGN KEY ("dependsOnItemId") REFERENCES "process_template_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

