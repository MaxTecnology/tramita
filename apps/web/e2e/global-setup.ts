// apps/web/e2e/global-setup.ts
import { execSync } from 'child_process'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { config as loadEnv } from 'dotenv'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')

// Load root .env so DATABASE_URL_TEST is available
loadEnv({ path: resolve(__dirname, '../../../.env') })

const API_DIR = resolve(__dirname, '../../../apps/api')

function run(cmd: string) {
  if (!process.env.DATABASE_URL_TEST) {
    throw new Error('DATABASE_URL_TEST não está definida — recuse rodar o E2E setup sem ela (evita cair silenciosamente no DATABASE_URL de produção).')
  }
  execSync(cmd, {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST },
    stdio: 'inherit',
  })
}

export default async function globalSetup() {
  run('pnpm exec prisma migrate deploy')
  run('pnpm exec tsx prisma/seed.ts')
  run('pnpm exec tsx prisma/e2e-seed.ts')
}
