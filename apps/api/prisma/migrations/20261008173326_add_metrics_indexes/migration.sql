-- CreateIndex
CREATE INDEX "task_history_taskId_action_createdAt_idx" ON "task_history"("taskId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "tasks_completedAt_idx" ON "tasks"("completedAt");

-- CreateIndex
CREATE INDEX "tasks_assigneeId_idx" ON "tasks"("assigneeId");

