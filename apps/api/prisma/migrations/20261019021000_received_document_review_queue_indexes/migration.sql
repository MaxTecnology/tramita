-- CreateIndex
CREATE INDEX "received_documents_organizationId_status_idx" ON "received_documents"("organizationId", "status");

-- CreateIndex
CREATE INDEX "received_documents_status_reviewedAt_idx" ON "received_documents"("status", "reviewedAt");
