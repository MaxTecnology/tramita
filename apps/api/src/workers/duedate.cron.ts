import { Queue, Worker } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { enqueueNotification } from '@/lib/queue'

export function startDueDateCronWorker() {
  const cronQueue = new Queue('duedate-cron', { connection: redis })

  await cronQueue.add('check', {}, {
    repeat: { every: 3_600_000 },
    jobId: 'duedate-check',
  })

  return new Worker('duedate-cron', async () => {
    const now = new Date()
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    const tasks = await prisma.task.findMany({
      where: {
        dueDate: { gte: now, lte: in24h },
        status: { not: 'DONE' },
      },
      include: {
        column: {
          include: { board: { select: { organizationId: true, clientId: true } } },
        },
      },
    })

    for (const task of tasks) {
      await enqueueNotification({
        event: 'TASK_DUE_DATE_APPROACHING',
        taskId: task.id,
        organizationId: task.column.board.organizationId,
        clientId: task.column.board.clientId,
        metadata: {
          taskTitle: task.title,
          dueDate: task.dueDate!.toLocaleDateString('pt-BR'),
        },
      })
    }
  }, { connection: redis })
}
