-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
