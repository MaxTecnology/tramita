-- CreateIndex
CREATE INDEX "comments_taskId_createdAt_idx" ON "comments"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "request_comments_requestId_createdAt_idx" ON "request_comments"("requestId", "createdAt");
