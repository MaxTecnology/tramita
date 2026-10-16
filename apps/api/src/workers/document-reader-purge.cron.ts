import { Queue, Worker } from 'bullmq'
import { Prisma } from '@prisma/client'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { deleteFile } from '@/lib/b2'

const DIAS_RETENCAO_REJECTED = 30

export async function purgeRejectedDocuments(now: Date = new Date()): Promise<number> {
  const limite = new Date(now.getTime() - DIAS_RETENCAO_REJECTED * 24 * 60 * 60 * 1000)
  const expirados = await prisma.receivedDocument.findMany({
    where: { status: 'REJECTED', reviewedAt: { lt: limite } },
    select: { id: true, storageKey: true },
  })

  for (const doc of expirados) {
    await deleteFile(doc.storageKey)
    await prisma.receivedDocument.update({ where: { id: doc.id }, data: { extractedFields: Prisma.JsonNull, storageKey: '' } })
  }

  return expirados.length
}

export async function startDocumentReaderPurgeCronWorker() {
  const cronQueue = new Queue('document-reader-purge-cron', { connection: bullmqRedis })
  await cronQueue.add('purge', {}, {
    repeat: { pattern: '0 3 * * *', tz: 'America/Sao_Paulo' }, // 3h BRT, fora do horário dos outros crons
    jobId: 'document-reader-purge',
  })
  return new Worker('document-reader-purge-cron', async () => {
    await purgeRejectedDocuments()
  }, { connection: bullmqRedis })
}
