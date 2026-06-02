import { resolve } from 'node:path'
import { config } from 'dotenv'
config({ path: resolve(import.meta.dirname, '../../.env') })

import { redis } from '@/lib/redis'
import { startNotificationWorker } from '@/workers/notification.worker'
import { startDueDateCronWorker } from '@/workers/duedate.cron'

async function main() {
  await redis.connect()
  startNotificationWorker()
  startDueDateCronWorker()
  console.log('[worker] Notification worker + duedate cron iniciados')
}

main().catch((err) => {
  console.error('[worker] Fatal:', err)
  process.exit(1)
})
