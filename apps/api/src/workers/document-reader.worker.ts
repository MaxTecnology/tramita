import { Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { processarDocumento } from '@/modules/document-reader/document-reader.service'

export async function processDocumentReaderJob(job: { data: { receivedDocumentId: string } }): Promise<void> {
  await processarDocumento(job.data.receivedDocumentId)
}

// Se as 3 tentativas (attempts: 3, ver document-reader-queue.ts) se esgotarem, o job BullMQ morre
// silenciosamente — sem isso o documento fica PENDING pra sempre, sem nenhum sinal do que houve.
export async function handleJobFailed(
  job: { attemptsMade: number; opts: { attempts?: number }; data: { receivedDocumentId: string } } | undefined,
  err: unknown,
): Promise<void> {
  if (!job) return
  const tentativasMax = job.opts.attempts ?? 1
  if (job.attemptsMade < tentativasMax) return // ainda vai tentar de novo

  await prisma.receivedDocument.updateMany({
    where: { id: job.data.receivedDocumentId, status: 'PENDING' },
    data: { status: 'NOT_IDENTIFIED', extractedFields: { _erro: err instanceof Error ? err.message : String(err) } },
  })
}

export function startDocumentReaderWorker() {
  const worker = new Worker('document-reader-queue', processDocumentReaderJob, {
    connection: bullmqRedis,
    concurrency: 2, // PDF é entrada não confiável — baixa concorrência, mesmo espírito do INTEGRACAO.md
  })
  worker.on('failed', (job, err) => {
    void handleJobFailed(job, err)
  })
  return worker
}
