// apps/web/e2e/global-setup.ts
import { execSync } from 'child_process'
import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'

// Load root .env so DATABASE_URL_TEST is available
loadEnv({ path: resolve(__dirname, '../../../.env') })

const API_DIR = resolve(__dirname, '../../../apps/api')

function run(cmd: string) {
  execSync(cmd, {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST! },
    stdio: 'inherit',
  })
}

export default async function globalSetup() {
  run('pnpm exec prisma migrate deploy')
  run('pnpm exec tsx prisma/seed.ts')
  run('pnpm exec tsx prisma/e2e-seed.ts')
}
