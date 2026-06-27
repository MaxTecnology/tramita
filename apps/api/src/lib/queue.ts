import { Queue } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'

export interface NotificationJob {
  event: string
  organizationId: string
  recipientType?: 'CLIENT' | 'USER'
  clientId?: string
  userId?: string
  taskId?: string
  requestId?: string
  metadata: Record<string, string | undefined>
}

export const notificationQueue = new Queue('notification-queue', { connection: bullmqRedis })

export async function enqueueNotification(job: NotificationJob): Promise<void> {
  await notificationQueue.add(job.event, job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  })
}
