import { Queue } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'

export const documentReaderQueue = new Queue('document-reader-queue', { connection: bullmqRedis })

export async function enqueueDocumentReader(receivedDocumentId: string): Promise<void> {
  await documentReaderQueue.add('processar', { receivedDocumentId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  })
}
