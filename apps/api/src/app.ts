import { resolve } from 'node:path'
import { config } from 'dotenv'

// Load .env from monorepo root
config({ path: resolve(import.meta.dirname, '../../../.env') })

import { buildApp } from '@/server'

const app = buildApp()

app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
})
