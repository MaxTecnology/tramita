-- CreateTable
CREATE TABLE "delay_reasons" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requiresNote" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,

    CONSTRAINT "delay_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delay_reasons_organizationId_name_key" ON "delay_reasons"("organizationId", "name");

-- CreateIndex
CREATE INDEX "boards_delayReasonId_idx" ON "boards"("delayReasonId");

-- CreateIndex
CREATE INDEX "tasks_delayReasonId_idx" ON "tasks"("delayReasonId");

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_delayReasonId_fkey" FOREIGN KEY ("delayReasonId") REFERENCES "delay_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_delayReasonId_fkey" FOREIGN KEY ("delayReasonId") REFERENCES "delay_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delay_reasons" ADD CONSTRAINT "delay_reasons_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

