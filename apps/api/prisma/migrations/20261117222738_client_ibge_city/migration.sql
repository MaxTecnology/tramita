-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "ibgeCityCode" INTEGER;

-- CreateIndex
CREATE INDEX "clients_organizationId_estado_idx" ON "clients"("organizationId", "estado");

-- CreateIndex
CREATE INDEX "clients_ibgeCityCode_idx" ON "clients"("ibgeCityCode");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_ibgeCityCode_fkey" FOREIGN KEY ("ibgeCityCode") REFERENCES "municipalities"("ibgeCode") ON DELETE RESTRICT ON UPDATE CASCADE;
