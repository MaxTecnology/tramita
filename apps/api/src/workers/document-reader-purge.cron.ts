import { Queue, Worker } from 'bullmq'
import { Prisma } from '@prisma/client'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { deleteFile } from '@/lib/b2'
import { logger } from '@/lib/logger'

const DIAS_RETENCAO_REJECTED = 30

export async function purgeRejectedDocuments(now: Date = new Date()): Promise<number> {
  const limite = new Date(now.getTime() - DIAS_RETENCAO_REJECTED * 24 * 60 * 60 * 1000)
  const expirados = await prisma.receivedDocument.findMany({
    // storageKey: { not: '' } exclui linhas já expurgadas numa execução anterior — sem isso, o cron
    // chamaria deleteFile('') todo dia pra sempre, e deleteFile com chave vazia lista/apaga o bucket
    // inteiro (todas as orgs) via Prefix vazio no S3-compatible API do B2.
    where: { status: 'REJECTED', reviewedAt: { lt: limite }, storageKey: { not: '' } },
    select: { id: true, storageKey: true },
  })

  let expurgados = 0
  for (const doc of expirados) {
    // Um deleteFile que falha (B2 fora do ar, timeout) não pode travar os documentos seguintes da
    // mesma execução — eles continuam íntegros (storageKey nunca vira '') pra tentar de novo na
    // próxima execução do cron, amanhã.
    try {
      await deleteFile(doc.storageKey)
      await prisma.receivedDocument.update({ where: { id: doc.id }, data: { extractedFields: Prisma.JsonNull, storageKey: '' } })
      expurgados++
    } catch (err) {
      logger.error({ err, receivedDocumentId: doc.id, storageKey: doc.storageKey }, 'Falha ao expurgar ReceivedDocument REJECTED (LGPD)')
    }
  }

  return expurgados
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
