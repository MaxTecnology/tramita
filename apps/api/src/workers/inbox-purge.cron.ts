import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// Read notifications are history: after 180 days they go. Unread ones stay until someone reads them.
const RETENTION_DAYS = 180

export async function purgeReadNotifications(now: Date = new Date()): Promise<number> {
  const limit = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { count } = await prisma.inAppNotification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: limit } } })
  return count
}

export async function startInboxPurgeCronWorker() {
  const cronQueue = new Queue('inbox-purge-cron', { connection: bullmqRedis })
  await cronQueue.add('purge', {}, {
    repeat: { pattern: '30 3 * * *', tz: 'America/Sao_Paulo' }, // 3h30 BRT, after the document reader purge
    jobId: 'inbox-purge',
  })
  return new Worker('inbox-purge-cron', async () => {
    const count = await purgeReadNotifications()
    logger.info({ count }, 'Notificações lidas antigas removidas')
  }, { connection: bullmqRedis })
}
