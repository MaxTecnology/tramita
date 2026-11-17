-- CreateEnum
CREATE TYPE "LocationScope" AS ENUM ('FEDERAL', 'STATE', 'CITY');

-- AlterTable
ALTER TABLE "recurring_task_templates" ADD COLUMN     "dueScope" "LocationScope" NOT NULL DEFAULT 'FEDERAL',
ADD COLUMN     "onlyListedLocations" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "recurring_due_rules" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "uf" CHAR(2),
    "ibgeCityCode" INTEGER,
    "dueDayOfPeriod" INTEGER NOT NULL,
    "dueBusinessDayRoll" "BusinessDayRoll" NOT NULL DEFAULT 'NONE',

    CONSTRAINT "recurring_due_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recurring_due_rules_templateId_uf_key" ON "recurring_due_rules"("templateId", "uf");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_due_rules_templateId_ibgeCityCode_key" ON "recurring_due_rules"("templateId", "ibgeCityCode");

-- AddForeignKey
ALTER TABLE "recurring_due_rules" ADD CONSTRAINT "recurring_due_rules_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "recurring_task_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_due_rules" ADD CONSTRAINT "recurring_due_rules_ibgeCityCode_fkey" FOREIGN KEY ("ibgeCityCode") REFERENCES "municipalities"("ibgeCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A rule is for a state or for a city, never both nor neither
ALTER TABLE "recurring_due_rules" ADD CONSTRAINT "recurring_due_rules_one_place_check" CHECK (("uf" IS NULL) <> ("ibgeCityCode" IS NULL));
