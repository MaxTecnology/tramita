/*
  Warnings:

  - You are about to drop the column `dueMonthOffset` on the `recurring_task_templates` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "recurring_task_templates" DROP COLUMN "dueMonthOffset",
ADD COLUMN     "competenceMonthOffset" INTEGER NOT NULL DEFAULT 1;
