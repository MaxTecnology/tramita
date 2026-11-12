import { resolve } from 'node:path'
import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

// With a Prisma Config file the CLI no longer loads .env on its own. Load the monorepo root .env
// (local dev; the CLI runs from apps/api). In production and CI the variables come from the
// environment and there is no file, so this is a no-op — and it never overrides variables already
// set (e.g. DATABASE_URL pointing at the test database).
config({ path: resolve(process.cwd(), '../../.env'), quiet: true })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
})
