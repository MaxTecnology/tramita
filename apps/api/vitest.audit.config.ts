import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config'

// Route audit only (scripts/route-audit): same test database and setup, never part of `pnpm test`.
// Rate limits are raised so the probe's ~1300 requests are not throttled.
export default mergeConfig(base, defineConfig({
  test: {
    include: ['scripts/route-audit/**/*.audit.ts'],
    env: { RATE_LIMIT_MAX: '1000000', RATE_LIMIT_USER_MAX: '1000000' },
  },
}))
