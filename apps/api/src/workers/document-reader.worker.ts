import { Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { processarDocumento } from '@/modules/document-reader/document-reader.service'

export async function processDocumentReaderJob(job: { data: { receivedDocumentId: string } }): Promise<void> {
  await processarDocumento(job.data.receivedDocumentId)
}

export function startDocumentReaderWorker() {
  return new Worker('document-reader-queue', processDocumentReaderJob, {
    connection: bullmqRedis,
    concurrency: 2, // PDF é entrada não confiável — baixa concorrência, mesmo espírito do INTEGRACAO.md
  })
}
