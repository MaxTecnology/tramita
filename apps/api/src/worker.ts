import { resolve } from 'node:path'
import { config } from 'dotenv'
config({ path: resolve(import.meta.dirname, '../../../.env') })

import { startNotificationWorker } from '@/workers/notification.worker'
import { startDueDateCronWorker } from '@/workers/duedate.cron'
import { startRecurringTasksCronWorker } from '@/workers/recurring-tasks.cron'

async function main() {
  startNotificationWorker()
  await startDueDateCronWorker()
  await startRecurringTasksCronWorker()
  console.log('[worker] Notification worker + duedate cron + recurring tasks cron iniciados')
}

main().catch((err) => {
  console.error('[worker] Fatal:', err)
  process.exit(1)
})
