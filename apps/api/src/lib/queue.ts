import { Queue } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import type { MessageChannel } from '@prisma/client'

export interface NotificationJob {
  event: string
  organizationId: string
  recipientType?: 'CLIENT' | 'USER'
  clientId?: string
  userId?: string
  taskId?: string
  requestId?: string
  metadata: Record<string, string | undefined>
  channels?: MessageChannel[]  // quando presente, restringe os canais além do que a organização já habilita (interseção, nunca força um canal que a org desligou)
}

export const notificationQueue = new Queue('notification-queue', { connection: bullmqRedis })

export async function enqueueNotification(job: NotificationJob): Promise<void> {
  await notificationQueue.add(job.event, job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  })
}
