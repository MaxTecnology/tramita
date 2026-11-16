import { prisma } from '@/lib/prisma'
import { addBusinessDays } from '@/lib/business-days'
import { loadHolidaySet } from '@/modules/holidays/holidays.service'

// Internal deadline of an OS: N business days after it is released (Task 6 adds the pauses while
// the client is awaited). Tasks without a deadline or not yet released keep their manual target.
export async function scheduleDeadline(taskId: string): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { releasedAt: true, deadlineBusinessDays: true, column: { select: { board: { select: { organizationId: true } } } } },
  })
  if (!task.releasedAt || !task.deadlineBusinessDays) return
  const year = task.releasedAt.getUTCFullYear()
  const holidays = await loadHolidaySet(task.column.board.organizationId, [year, year + 1, year + 2])
  await prisma.task.update({ where: { id: taskId }, data: { targetDate: addBusinessDays(task.releasedAt, task.deadlineBusinessDays, holidays) } })
}

// Process clock: N business days from its opening
export async function scheduleBoardDeadline(boardId: string): Promise<void> {
  const board = await prisma.board.findUniqueOrThrow({ where: { id: boardId }, select: { createdAt: true, deadlineBusinessDays: true, organizationId: true } })
  if (!board.deadlineBusinessDays) return
  const year = board.createdAt.getUTCFullYear()
  const holidays = await loadHolidaySet(board.organizationId, [year, year + 1, year + 2])
  await prisma.board.update({ where: { id: boardId }, data: { targetDate: addBusinessDays(board.createdAt, board.deadlineBusinessDays, holidays) } })
}
