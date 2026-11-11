-- Solicitação sempre tem departamento (I6 da spec de cobertura de departamentos)
-- DropForeignKey
ALTER TABLE "requests" DROP CONSTRAINT "requests_departmentId_fkey";

-- AlterTable
ALTER TABLE "requests" ALTER COLUMN "departmentId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

