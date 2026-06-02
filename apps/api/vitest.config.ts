import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL_TEST ??
        'postgresql://tramita:tramita@localhost:5433/tramita_test',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      include: ['src/modules/**', 'src/lib/**'],
      thresholds: { lines: 80, functions: 80 },
    },
  },
})
