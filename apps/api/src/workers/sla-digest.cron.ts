import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { enqueueNotification } from '@/lib/queue'
import { computeSlaLevel, type SlaLevel } from '@/lib/sla'

interface DigestEntry {
  taskTitle: string
  clientName: string
  level: SlaLevel
  dateLabel: string
}

function formatTaskLine(entry: DigestEntry): string {
  const tag = entry.level === 'DUE_CRITICAL' ? 'crítico' : 'atenção'
  return `- ${entry.taskTitle} (${entry.clientName}) — ${entry.dateLabel} [${tag}]`
}

export async function runSlaDigest(now: Date = new Date()): Promise<void> {
  const orgs = await prisma.organization.findMany({
    include: { notificationConfig: true },
  })

  for (const org of orgs) {
    if (org.notificationConfig?.slaDigestEnabled === false) continue

    const config = {
      slaTargetWarningDays: org.notificationConfig?.slaTargetWarningDays ?? 3,
      slaDueCriticalDays: org.notificationConfig?.slaDueCriticalDays ?? 1,
    }

    const tasks = await prisma.task.findMany({
      where: {
        status: { notIn: ['DONE', 'DISREGARDED'] },
        column: { board: { organizationId: org.id, isActive: true } },
        OR: [{ targetDate: { not: null } }, { dueDate: { not: null } }],
      },
      select: {
        id: true,
        title: true,
        targetDate: true,
        dueDate: true,
        assignee: { select: { id: true } },
        column: { select: { board: { select: { client: { select: { name: true } } } } } },
      },
    })

    const admins = await prisma.user.findMany({
      where: { organizationId: org.id, role: { in: ['ORG_ADMIN', 'ORG_MANAGER'] } },
      select: { id: true },
    })

    const byUserId = new Map<string, DigestEntry[]>()

    for (const task of tasks) {
      const level = computeSlaLevel(task.targetDate, task.dueDate, now, config)
      if (level === 'NONE') continue

      const entry: DigestEntry = {
        taskTitle: task.title,
        clientName: task.column.board.client.name,
        level,
        dateLabel: level === 'DUE_CRITICAL'
          ? `vence ${task.dueDate!.toLocaleDateString('pt-BR')}`
          : `meta ${task.targetDate!.toLocaleDateString('pt-BR')}`,
      }

      const recipientIds = task.assignee ? [task.assignee.id] : admins.map((a) => a.id)
      for (const userId of recipientIds) {
        const bucket = byUserId.get(userId) ?? []
        bucket.push(entry)
        byUserId.set(userId, bucket)
      }
    }

    for (const [userId, entries] of byUserId) {
      const criticalCount = entries.filter((e) => e.level === 'DUE_CRITICAL').length
      await enqueueNotification({
        event: 'SLA_DIGEST',
        organizationId: org.id,
        recipientType: 'USER',
        userId,
        metadata: {
          taskCount: String(entries.length),
          criticalCount: String(criticalCount),
          taskListText: entries.map(formatTaskLine).join('\n'),
        },
      })
    }
  }
}

export async function startSlaDigestCronWorker() {
  const cronQueue = new Queue('sla-digest-cron', { connection: bullmqRedis })

  await cronQueue.add('check', {}, {
    repeat: { pattern: '0 8 * * *' },
    jobId: 'sla-digest-check',
  })

  return new Worker('sla-digest-cron', async () => {
    await runSlaDigest()
  }, { connection: bullmqRedis })
}
