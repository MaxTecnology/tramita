// apps/web/playwright.config.ts
import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')

loadEnv({ path: resolve(__dirname, '../../.env') })

// Uncommon ports so the e2e never collides with the dev servers (3000/5173) or other local projects.
// Override with E2E_API_PORT / E2E_WEB_PORT if one of them is taken.
const API_PORT = process.env.E2E_API_PORT ?? '3901'
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5901'
const API_URL = `http://localhost:${API_PORT}`
// The specs' fixtures read this to log in against the e2e API
process.env.E2E_API_URL = API_URL

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false, // sequential to avoid DB conflicts
  workers: 1, // fullyParallel:false only serializes within one file — this enforces it across all files too
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter api dev',
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL_TEST ?? '',
        PORT: API_PORT,
        RATE_LIMIT_MAX: '5000', // all specs share 127.0.0.1
        RATE_LIMIT_USER_MAX: '5000',
      },
    },
    {
      command: `pnpm --filter web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        VITE_API_URL: API_URL,
      },
    },
  ],
})
