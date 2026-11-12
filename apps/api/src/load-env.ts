import { resolve } from 'node:path'
import { config } from 'dotenv'

// Imported FIRST by the entry points (app.ts, worker.ts). In ESM every static import is evaluated
// before the importing module's body, so calling config() in the entry body ran too late for modules
// that read process.env at import time. As the first import, this module is evaluated before them.
// In production the platform injects the variables and there is no .env file: config() is a no-op.
config({ path: resolve(import.meta.dirname, '../../../.env') })
