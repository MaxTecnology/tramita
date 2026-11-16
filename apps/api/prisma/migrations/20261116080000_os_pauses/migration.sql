-- AlterEnum
ALTER TYPE "InAppType" ADD VALUE 'OS_RELEASED';

-- CreateTable
CREATE TABLE "task_pauses" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "task_pauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_pauses" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "board_pauses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_pauses_taskId_idx" ON "task_pauses"("taskId");

-- CreateIndex
CREATE INDEX "board_pauses_boardId_idx" ON "board_pauses"("boardId");

-- AddForeignKey
ALTER TABLE "task_pauses" ADD CONSTRAINT "task_pauses_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_pauses" ADD CONSTRAINT "board_pauses_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

