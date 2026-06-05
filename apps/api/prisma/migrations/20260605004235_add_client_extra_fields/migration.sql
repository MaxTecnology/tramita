-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "clientType" TEXT NOT NULL DEFAULT 'PJ',
ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "phone" TEXT;
