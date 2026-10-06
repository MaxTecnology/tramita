-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_departmentId_fkey";

-- AlterTable
ALTER TABLE "recurring_task_templates" ADD COLUMN     "priority" "Priority" NOT NULL DEFAULT 'MEDIUM';

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
