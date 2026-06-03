-- AlterTable
ALTER TABLE "boards" ADD COLUMN     "responsibleUserId" TEXT;

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
