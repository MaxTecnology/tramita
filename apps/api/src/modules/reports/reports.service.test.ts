import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
} from '@/test/helpers'
import { generateReport } from '@/modules/reports/reports.service'
import { redis } from '@/lib/redis'

// Mock puppeteer to avoid launching real browser in tests
vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setContent: vi.fn().mockResolvedValue(undefined),
        pdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(redis, 'get').mockResolvedValue(null)
  vi.spyOn(redis, 'set').mockResolvedValue('OK')
})

describe('generateReport', () => {
  it('generates PDF buffer for the correct month', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    await createTestTask(col.id, user.id, { title: 'Tarefa do mês' })

    const result = await generateReport(client.id, org.id, '2026-06')

    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns cached PDF on second call', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    await createTestTask(col.id, user.id)

    // First call should generate and cache
    const result1 = await generateReport(client.id, org.id, '2026-05')
    expect(result1).toBeInstanceOf(Buffer)

    // Mock redis to return cached data on second call
    vi.spyOn(redis, 'get').mockResolvedValueOnce(result1.toString('base64'))

    // Second call should return the cached PDF
    const result2 = await generateReport(client.id, org.id, '2026-05')
    expect(result2).toEqual(result1)
  })
})
