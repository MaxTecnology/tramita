-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('ASAAS', 'MANUAL');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "billingMode" "BillingMode" NOT NULL DEFAULT 'ASAAS',
ADD COLUMN     "manualNextDueDate" TIMESTAMP(3);

-- Offices already created without an Asaas subscription are billed by direct agreement
UPDATE "organizations" SET "billingMode" = 'MANUAL' WHERE "asaasSubscriptionId" IS NULL;
