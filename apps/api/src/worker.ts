import { resolve } from 'node:path'
import { config } from 'dotenv'
config({ path: resolve(import.meta.dirname, '../../../.env') })

import { startNotificationWorker } from '@/workers/notification.worker'
import { startSlaDigestCronWorker } from '@/workers/sla-digest.cron'
import { startRecurringTasksCronWorker } from '@/workers/recurring-tasks.cron'
import { startDocumentReaderWorker } from '@/workers/document-reader.worker'
import { startDocumentReaderPurgeCronWorker } from '@/workers/document-reader-purge.cron'

async function main() {
  startNotificationWorker()
  await startSlaDigestCronWorker()
  await startRecurringTasksCronWorker()
  startDocumentReaderWorker()
  await startDocumentReaderPurgeCronWorker()
  console.log('[worker] Notification worker + SLA digest cron + recurring tasks cron + document reader worker + document reader purge cron iniciados')
}

main().catch((err) => {
  console.error('[worker] Fatal:', err)
  process.exit(1)
})
