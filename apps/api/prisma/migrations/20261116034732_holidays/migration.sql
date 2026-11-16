-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "holidays_organizationId_date_key" ON "holidays"("organizationId", "date");

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
